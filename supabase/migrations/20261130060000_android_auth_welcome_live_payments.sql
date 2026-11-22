-- Give every new account a real 500-credit welcome balance. Credits remain
-- locked by consume_credits until PayPal confirms the first real recharge.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_purchased boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_recharged boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.cupido_protect_recharge_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN NEW.has_recharged := false;
    ELSE NEW.has_recharged := OLD.has_recharged;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_profiles_protect_recharge ON public.profiles;
CREATE TRIGGER cupido_profiles_protect_recharge
  BEFORE INSERT OR UPDATE OF has_recharged ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.cupido_protect_recharge_flag();

CREATE OR REPLACE FUNCTION public.sync_credits_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET credits = NEW.balance,
         credits_balance = NEW.balance,
         updated_at = now()
   WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credits_sync_profile ON public.user_credits;
CREATE TRIGGER credits_sync_profile
  AFTER INSERT OR UPDATE OF balance ON public.user_credits
  FOR EACH ROW EXECUTE FUNCTION public.sync_credits_to_profile();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dname text;
  welcome_balance integer;
  inserted_user uuid;
BEGIN
  dname := left(coalesce(
    nullif(NEW.raw_user_meta_data->>'full_name', ''),
    nullif(NEW.raw_user_meta_data->>'name', ''),
    split_part(coalesce(NEW.email, ''), '@', 1),
    'Miembro de Cupido'
  ), 60);
  welcome_balance := CASE
    WHEN lower(coalesce(NEW.email, '')) = 'leudyfeliz81@gmail.com' THEN -1
    ELSE 500
  END;

  INSERT INTO public.profiles
    (id, email, display_name, full_name, birth_date, credits, credits_balance, has_recharged)
  VALUES
    (NEW.id, NEW.email, dname,
     nullif(left(NEW.raw_user_meta_data->>'full_name', 120), ''),
     public.try_date(NEW.raw_user_meta_data->>'birth_date'),
     welcome_balance, welcome_balance, false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.creator_profiles (id, display_name, is_official)
  VALUES (NEW.id, dname, lower(coalesce(NEW.email, '')) = 'leudyfeliz81@gmail.com')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_credits (user_id, balance, daily_reset_at)
  VALUES (NEW.id, welcome_balance, now())
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO inserted_user;

  IF inserted_user IS NOT NULL AND welcome_balance = 500 THEN
    INSERT INTO public.credit_transactions (user_id, delta, reason)
    VALUES (NEW.id, 500, 'Monedas de bienvenida Cupido Leudy');
  END IF;

  UPDATE public.profiles
     SET credits = welcome_balance,
         credits_balance = welcome_balance,
         has_recharged = false,
         updated_at = now()
   WHERE id = NEW.id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  IF lower(coalesce(NEW.email, '')) = 'leudyfeliz81@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Repair legacy five-credit welcome rows. Paid balances and paid history stay intact.
WITH welcome_rows AS (
  INSERT INTO public.user_credits (user_id, balance, daily_reset_at)
  SELECT u.id,
         CASE WHEN lower(coalesce(u.email, '')) = 'leudyfeliz81@gmail.com' THEN -1 ELSE 500 END,
         now()
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.user_credits c WHERE c.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.paypal_orders o WHERE o.user_id = u.id AND o.status = 'captured')
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id, balance
)
INSERT INTO public.credit_transactions (user_id, delta, reason)
SELECT user_id, 500, 'Monedas de bienvenida Cupido Leudy'
  FROM welcome_rows WHERE balance = 500;

UPDATE public.user_credits c
   SET balance = 500, daily_reset_at = now(), updated_at = now()
  FROM auth.users u
 WHERE u.id = c.user_id
   AND c.balance >= 0 AND c.balance < 500
   AND lower(coalesce(u.email, '')) <> 'leudyfeliz81@gmail.com'
   AND NOT EXISTS (
     SELECT 1 FROM public.paypal_orders o
      WHERE o.user_id = c.user_id AND o.status = 'captured'
   );

UPDATE public.profiles p
   SET has_recharged = true,
       has_purchased = true,
       updated_at = now()
 WHERE EXISTS (
   SELECT 1 FROM public.paypal_orders o
    WHERE o.user_id = p.id AND o.status = 'captured'
 );

UPDATE public.user_credits c
   SET balance = -1, updated_at = now()
  FROM auth.users u
 WHERE u.id = c.user_id
   AND lower(coalesce(u.email, '')) = 'leudyfeliz81@gmail.com';

UPDATE public.profiles p
   SET credits = -1, credits_balance = -1, updated_at = now()
  FROM auth.users u
 WHERE u.id = p.id
   AND lower(coalesce(u.email, '')) = 'leudyfeliz81@gmail.com';

CREATE OR REPLACE FUNCTION public.consume_credits(_amount integer, _reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF lower(coalesce(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' THEN RETURN -1; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.has_recharged
  ) AND NOT EXISTS (
    SELECT 1 FROM public.paypal_orders o
     WHERE o.user_id = auth.uid() AND o.status = 'captured'
  ) THEN
    RAISE EXCEPTION 'PURCHASE_REQUIRED';
  END IF;
  PERFORM public.apply_daily_refill(auth.uid());
  UPDATE public.user_credits
     SET balance = balance - _amount, updated_at = now()
   WHERE user_id = auth.uid() AND balance >= _amount
   RETURNING balance INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (auth.uid(), -_amount, coalesce(nullif(btrim(_reason), ''), 'Uso de monedas'));
  RETURN new_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_credits(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_credits(integer, text) TO authenticated, service_role;

-- Active stories are readable; each signed-in user can publish and delete only their own.
ALTER TABLE public.cupido_stories
  ALTER COLUMN media_url DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS background_gradient text NOT NULL DEFAULT 'pink';
ALTER TABLE public.cupido_stories
  DROP CONSTRAINT IF EXISTS cupido_stories_media_type_check,
  ADD CONSTRAINT cupido_stories_media_type_check
    CHECK (media_type IN ('image', 'video', 'text'));
ALTER TABLE public.cupido_stories
  DROP CONSTRAINT IF EXISTS cupido_stories_background_gradient_check,
  ADD CONSTRAINT cupido_stories_background_gradient_check
    CHECK (background_gradient IN ('pink', 'sunset', 'ocean', 'gold'));
ALTER TABLE public.cupido_stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_stories_active_read ON public.cupido_stories;
DROP POLICY IF EXISTS cupido_stories_active_public_read ON public.cupido_stories;
DROP POLICY IF EXISTS cupido_stories_owner_insert ON public.cupido_stories;
DROP POLICY IF EXISTS cupido_stories_owner_update ON public.cupido_stories;
DROP POLICY IF EXISTS cupido_stories_owner_delete ON public.cupido_stories;
CREATE POLICY cupido_stories_active_read ON public.cupido_stories
  FOR SELECT TO anon, authenticated USING (expires_at > now());
CREATE POLICY cupido_stories_owner_insert ON public.cupido_stories
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY cupido_stories_owner_update ON public.cupido_stories
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY cupido_stories_owner_delete ON public.cupido_stories
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.cupido_stories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.cupido_stories TO authenticated;

-- Discovery reads only active live rooms; realtime Presence supplies viewer counts.
ALTER TABLE public.live_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS live_streams_active_read ON public.live_streams;
CREATE POLICY live_streams_active_read ON public.live_streams
  FOR SELECT TO anon, authenticated USING (status = 'live' OR host_id = auth.uid());
DROP POLICY IF EXISTS cupido_live_rooms_active_read ON public.cupido_live_rooms;
CREATE POLICY cupido_live_rooms_active_read ON public.cupido_live_rooms
  FOR SELECT TO anon, authenticated USING (is_live OR host_id = auth.uid());
GRANT SELECT ON public.live_streams, public.cupido_live_rooms TO anon, authenticated;
GRANT ALL ON public.live_streams, public.cupido_live_rooms TO service_role;

-- Persist PayPal rows through the backend service-role client and let users read their own.
ALTER TABLE public.paypal_orders
  ADD COLUMN IF NOT EXISTS amount_usd numeric(12, 2);
UPDATE public.paypal_orders SET amount_usd = amount::numeric WHERE amount_usd IS NULL;
ALTER TABLE public.paypal_orders
  ALTER COLUMN amount_usd SET NOT NULL,
  ALTER COLUMN currency SET DEFAULT 'USD',
  ALTER COLUMN status SET DEFAULT 'created',
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.paypal_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_paypal_orders_owner_read ON public.paypal_orders;
CREATE POLICY cupido_paypal_orders_owner_read ON public.paypal_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.paypal_orders TO authenticated;
GRANT ALL ON public.paypal_orders TO service_role;

CREATE OR REPLACE FUNCTION public.cupido_finalize_paypal_package(
  _order_id uuid, _user_id uuid, _credits integer, _gran_liga boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_row public.paypal_orders%ROWTYPE;
  resulting_balance integer;
  infinite_admin boolean;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO order_row FROM public.paypal_orders
   WHERE id = _order_id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_FOUND'; END IF;
  IF order_row.credits <> _credits THEN RAISE EXCEPTION 'PAYPAL_CREDIT_MISMATCH'; END IF;
  IF (_gran_liga AND (order_row.package_id <> 'gran-liga-100'
       OR order_row.amount::numeric <> 100 OR _credits <> 1000000))
     OR (NOT _gran_liga AND order_row.package_id = 'gran-liga-100') THEN
    RAISE EXCEPTION 'PAYPAL_PACKAGE_MISMATCH';
  END IF;
  SELECT lower(coalesce(email, '')) = 'leudyfeliz81@gmail.com'
    INTO infinite_admin FROM auth.users WHERE id = _user_id;
  IF order_row.status = 'captured' THEN
    UPDATE public.profiles SET has_purchased = true, has_recharged = true,
      is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
    RETURN true;
  END IF;
  IF order_row.status <> 'created' THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_PENDING'; END IF;
  IF coalesce(infinite_admin, false) THEN
    resulting_balance := -1;
  ELSE
    PERFORM public.grant_credits(_user_id => _user_id, _amount => _credits,
      _reason => 'Compra PayPal ' || _credits || ' monedas');
    SELECT balance INTO resulting_balance FROM public.user_credits WHERE user_id = _user_id;
  END IF;
  IF resulting_balance IS NULL THEN RAISE EXCEPTION 'CREDIT_GRANT_FAILED'; END IF;
  UPDATE public.profiles SET credits = resulting_balance, credits_balance = resulting_balance,
    has_purchased = true, has_recharged = true,
    is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
  UPDATE public.creator_profiles SET is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
  UPDATE public.paypal_orders SET status = 'captured', captured_at = now()
   WHERE id = _order_id AND status = 'created';
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_finalize_paypal_package(uuid, uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_finalize_paypal_package(uuid, uuid, integer, boolean)
  TO service_role;

-- Expose only PayPal's public client ID, never its secret.
ALTER TABLE public.payment_settings ADD COLUMN IF NOT EXISTS paypal_client_id text;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS paypal_client_id text;
CREATE OR REPLACE FUNCTION public.cupido_public_paypal_client_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    nullif(btrim(payment.paypal_client_id), ''),
    nullif(btrim(app.paypal_client_id), ''),
    nullif(btrim(app.config->>'paypal_client_id'), ''),
    nullif(btrim(app.config->>'paypalClientId'), ''),
    nullif(btrim(app.config->>'clientId'), '')
  )
  FROM (SELECT 1) singleton
  LEFT JOIN public.payment_settings payment ON payment.id = 1
  LEFT JOIN public.app_settings app ON app.id = 1;
$$;
REVOKE ALL ON FUNCTION public.cupido_public_paypal_client_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupido_public_paypal_client_id()
  TO anon, authenticated, service_role;
