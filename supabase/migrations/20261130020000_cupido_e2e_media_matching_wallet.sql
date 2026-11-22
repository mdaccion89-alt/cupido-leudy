BEGIN;

-- Durable media presentation metadata. The original media remains in Storage;
-- browsers apply these filters and glowing emoji overlays at render time.
ALTER TABLE public.cupido_posts
  ADD COLUMN IF NOT EXISTS filter_name TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS emoji_overlay TEXT NOT NULL DEFAULT '[]';

ALTER TABLE public.cupido_stories
  ADD COLUMN IF NOT EXISTS filter_name TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS emoji_overlay TEXT NOT NULL DEFAULT '[]';

CREATE OR REPLACE FUNCTION public.cupido_validate_media_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE overlay_json JSONB;
BEGIN
  IF NEW.filter_name NOT IN ('normal', 'warm', 'glam', 'mono', 'vintage', 'neon') THEN
    RAISE EXCEPTION 'INVALID_MEDIA_FILTER';
  END IF;
  BEGIN
    overlay_json := COALESCE(NULLIF(NEW.emoji_overlay, ''), '[]')::JSONB;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'INVALID_EMOJI_OVERLAY';
  END;
  IF jsonb_typeof(overlay_json) <> 'array' OR jsonb_array_length(overlay_json) > 4 THEN
    RAISE EXCEPTION 'INVALID_EMOJI_OVERLAY';
  END IF;
  NEW.emoji_overlay := overlay_json::TEXT;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_posts_media_metadata ON public.cupido_posts;
CREATE TRIGGER cupido_posts_media_metadata
  BEFORE INSERT OR UPDATE OF filter_name, emoji_overlay ON public.cupido_posts
  FOR EACH ROW EXECUTE FUNCTION public.cupido_validate_media_metadata();

DROP TRIGGER IF EXISTS cupido_stories_media_metadata ON public.cupido_stories;
CREATE TRIGGER cupido_stories_media_metadata
  BEFORE INSERT OR UPDATE OF filter_name, emoji_overlay ON public.cupido_stories
  FOR EACH ROW EXECUTE FUNCTION public.cupido_validate_media_metadata();

-- Story lifetime is assigned by PostgreSQL, so the client cannot extend it.
CREATE OR REPLACE FUNCTION public.cupido_set_story_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.expires_at := now() + INTERVAL '24 hours';
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.expires_at := OLD.expires_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_stories_server_expiry ON public.cupido_stories;
CREATE TRIGGER cupido_stories_server_expiry
  BEFORE INSERT OR UPDATE OF created_at, expires_at ON public.cupido_stories
  FOR EACH ROW EXECUTE FUNCTION public.cupido_set_story_expiry();

ALTER TABLE public.cupido_stories ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cupido_stories'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.cupido_stories', pol.policyname);
  END LOOP;
END;
$$;
CREATE POLICY cupido_stories_active_public_read ON public.cupido_stories
  FOR SELECT TO anon, authenticated USING (expires_at > now() AND EXISTS (
    SELECT 1 FROM public.creator_profiles cp WHERE cp.id = user_id AND cp.is_cupido_active
  ));
CREATE POLICY cupido_stories_owner_insert ON public.cupido_stories
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY cupido_stories_owner_update ON public.cupido_stories
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY cupido_stories_owner_delete ON public.cupido_stories
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.cupido_stories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.cupido_stories TO authenticated;

-- The media bucket is public for playback. Upload, replacement and deletion are
-- limited to object paths whose first folder is the authenticated user UUID.
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;
DROP POLICY IF EXISTS cupido_media_public_read ON storage.objects;
DROP POLICY IF EXISTS cupido_media_owner_insert ON storage.objects;
DROP POLICY IF EXISTS cupido_media_owner_update ON storage.objects;
DROP POLICY IF EXISTS cupido_media_owner_delete ON storage.objects;
CREATE POLICY cupido_media_public_read ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'media');
CREATE POLICY cupido_media_owner_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'media' AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
CREATE POLICY cupido_media_owner_update ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'media' AND (storage.foldername(name))[1] = auth.uid()::TEXT
  ) WITH CHECK (
    bucket_id = 'media' AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
CREATE POLICY cupido_media_owner_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'media' AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- Recharge status means a verified PayPal capture, never the welcome grant or
-- an administrative/manual balance edit.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_recharged BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE public.profiles p
SET has_recharged = TRUE
WHERE EXISTS (
  SELECT 1 FROM public.paypal_orders o
  WHERE o.user_id = p.id AND o.status = 'captured'
);

CREATE OR REPLACE FUNCTION public.cupido_protect_recharge_flag()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.has_recharged := FALSE;
    ELSE
      NEW.has_recharged := OLD.has_recharged;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_profiles_protect_recharge ON public.profiles;
CREATE TRIGGER cupido_profiles_protect_recharge
  BEFORE INSERT OR UPDATE OF has_recharged ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.cupido_protect_recharge_flag();

-- Remove legacy role-based infinite balances. Only the named account keeps the
-- sentinel value; other accounts with legacy negative balances are normalized.
UPDATE public.user_credits c SET balance = 0, updated_at = now()
WHERE c.balance < 0 AND NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = c.user_id AND lower(COALESCE(u.email, '')) = 'leudyfeliz81@gmail.com'
);
UPDATE public.profiles p SET credits = GREATEST(COALESCE(c.balance, 0), 0),
  credits_balance = GREATEST(COALESCE(c.balance, 0), 0), updated_at = now()
FROM auth.users u LEFT JOIN public.user_credits c ON c.user_id = u.id
WHERE p.id = u.id AND lower(COALESCE(u.email, '')) <> 'leudyfeliz81@gmail.com'
  AND (p.credits < 0 OR p.credits_balance < 0);

CREATE OR REPLACE FUNCTION public.consume_credits(_amount INTEGER, _reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' THEN RETURN -1; END IF;
  PERFORM public.apply_daily_refill(auth.uid());
  UPDATE public.user_credits SET balance = balance - _amount, updated_at = now()
  WHERE user_id = auth.uid() AND balance >= _amount RETURNING balance INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (auth.uid(), -_amount, COALESCE(NULLIF(btrim(_reason), ''), 'Uso de monedas'));
  RETURN new_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_credits(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_credits(INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_finalize_paypal_package(
  _order_id UUID,
  _user_id UUID,
  _credits INTEGER,
  _gran_liga BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_row public.paypal_orders%ROWTYPE;
  resulting_balance INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT * INTO order_row FROM public.paypal_orders
  WHERE id = _order_id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_FOUND'; END IF;
  IF order_row.credits <> _credits THEN RAISE EXCEPTION 'PAYPAL_CREDIT_MISMATCH'; END IF;
  IF (_gran_liga AND (order_row.package_id <> 'gran-liga-100' OR order_row.amount::NUMERIC <> 100 OR _credits <> 1000000))
     OR (NOT _gran_liga AND order_row.package_id = 'gran-liga-100') THEN
    RAISE EXCEPTION 'PAYPAL_PACKAGE_MISMATCH';
  END IF;
  IF order_row.status = 'captured' THEN
    UPDATE public.profiles SET has_purchased = TRUE, has_recharged = TRUE,
      is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
    RETURN TRUE;
  END IF;
  IF order_row.status <> 'created' THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_PENDING'; END IF;
  PERFORM public.grant_credits(_user_id => _user_id, _amount => _credits,
    _reason => 'Compra PayPal ' || _credits || ' monedas');
  SELECT balance INTO resulting_balance FROM public.user_credits WHERE user_id = _user_id;
  IF resulting_balance IS NULL THEN RAISE EXCEPTION 'CREDIT_GRANT_FAILED'; END IF;
  UPDATE public.profiles SET credits = resulting_balance, credits_balance = resulting_balance,
    has_purchased = TRUE, has_recharged = TRUE,
    is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
  UPDATE public.creator_profiles SET is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
  UPDATE public.paypal_orders SET status = 'captured', captured_at = now()
  WHERE id = _order_id AND status = 'created';
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_finalize_paypal_package(UUID, UUID, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_finalize_paypal_package(UUID, UUID, INTEGER, BOOLEAN)
  TO service_role;

-- A free welcome balance cannot be spent until a verified recharge. Only the
-- named official administrator bypasses both the recharge and balance checks.
CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(_receiver UUID, _gift_id TEXT, _room UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender UUID := auth.uid();
  gift public.cupido_gifts%ROWTYPE;
  send_id UUID;
  is_infinite_admin BOOLEAN;
  is_gran_liga BOOLEAN;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  SELECT * INTO gift FROM public.cupido_gifts
  WHERE id = _gift_id AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
    OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _receiver) THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms WHERE id = _room AND host_id = _receiver AND is_live
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;
  is_infinite_admin := lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com';
  SELECT COALESCE(cp.is_gran_liga, FALSE) INTO is_gran_liga
  FROM public.creator_profiles cp WHERE cp.id = sender;
  IF gift.id = 'gran-liga-diamond' AND NOT COALESCE(is_gran_liga, FALSE) AND NOT is_infinite_admin THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;
  IF NOT is_infinite_admin AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = sender AND p.has_recharged
  ) AND NOT EXISTS (
    SELECT 1 FROM public.paypal_orders o WHERE o.user_id = sender AND o.status = 'captured'
  ) THEN
    RAISE EXCEPTION 'PURCHASE_REQUIRED';
  END IF;
  IF NOT is_infinite_admin THEN
    PERFORM public.consume_credits(gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;
  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
  VALUES (sender, _receiver, gift.id, gift.credits, gift.cash) RETURNING id INTO send_id;
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + EXCLUDED.balance,
    updated_at = now();
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (_receiver, 'Recibiste un regalo',
    CASE WHEN gift.id = 'gran-liga-diamond' THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
      ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.' END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END, sender, send_id);
  RETURN send_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_gift(
  _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC
)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, NULL)
$$;
CREATE OR REPLACE FUNCTION public.cupido_send_live_gift(
  _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC, _room UUID
)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, _room)
$$;
REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_send_live_gift(UUID, TEXT, INTEGER, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_live_gift(UUID, TEXT, INTEGER, NUMERIC, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_start_premium_live(_title TEXT, _coins INTEGER, _minutes INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room_uuid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _coins NOT IN (150, 300, 500, 1000) THEN RAISE EXCEPTION 'INVALID_LIVE_TIER'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.creator_profiles cp WHERE cp.id = auth.uid()
      AND (cp.is_verified_blue OR cp.is_gran_liga OR cp.is_official OR cp.is_super_admin)
  ) AND lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
    AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    RAISE EXCEPTION 'NOT_VERIFIED';
  END IF;
  INSERT INTO public.cupido_live_rooms (host_id, title, premium_coins, premium_minutes, premium_ends_at)
  VALUES (auth.uid(), COALESCE(NULLIF(btrim(_title), ''), 'Live Premium'), _coins, 0, NULL)
  RETURNING id INTO room_uuid;
  RETURN room_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_pay_live_entry(_room UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  live_row public.cupido_live_rooms%ROWTYPE;
  actor UUID := auth.uid();
  is_infinite_admin BOOLEAN;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO live_row FROM public.cupido_live_rooms WHERE id = _room AND is_live FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_NOT_AVAILABLE'; END IF;
  IF live_row.host_id = actor THEN RETURN TRUE; END IF;
  IF live_row.premium_coins <= 0 THEN RAISE EXCEPTION 'LIVE_NOT_AVAILABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_live_access WHERE room_id = _room AND user_id = actor) THEN RETURN TRUE; END IF;
  is_infinite_admin := lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com';
  IF NOT is_infinite_admin AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = actor AND p.has_recharged
  ) AND NOT EXISTS (
    SELECT 1 FROM public.paypal_orders o WHERE o.user_id = actor AND o.status = 'captured'
  ) THEN
    RAISE EXCEPTION 'PURCHASE_REQUIRED';
  END IF;
  IF NOT is_infinite_admin THEN
    PERFORM public.consume_credits(live_row.premium_coins, 'Entrada a Live Premium');
  END IF;
  INSERT INTO public.cupido_live_access (room_id, user_id, paid_coins)
  VALUES (_room, actor, live_row.premium_coins);
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (live_row.host_id, live_row.premium_coins::NUMERIC / 100, now())
  ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + EXCLUDED.balance,
    updated_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_pay_live_entry(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_pay_live_entry(UUID) TO authenticated;

-- Paid services may not consume the welcome grant before the first confirmed
-- purchase. Private calls retain their per-minute billing after that purchase.
CREATE OR REPLACE FUNCTION public.cupido_start_call(
  _callee UUID,
  _mode TEXT,
  _video BOOLEAN DEFAULT FALSE
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor UUID := auth.uid();
  cost INTEGER;
  call_id UUID;
  is_infinite_admin BOOLEAN;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _callee IS NULL OR _callee = actor THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;
  IF _mode IS NULL OR _mode NOT IN ('hot', 'cafe') THEN RAISE EXCEPTION 'INVALID_CALL_MODE'; END IF;
  is_infinite_admin := lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com';
  IF NOT is_infinite_admin AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = actor AND p.has_recharged
  ) AND NOT EXISTS (
    SELECT 1 FROM public.paypal_orders o WHERE o.user_id = actor AND o.status = 'captured'
  ) THEN RAISE EXCEPTION 'PURCHASE_REQUIRED'; END IF;
  cost := CASE WHEN _mode = 'hot' THEN 100 ELSE 50 END;
  IF is_infinite_admin THEN cost := 0;
  ELSE PERFORM public.consume_credits(cost, 'Llamada ' || _mode || ' en Cupido Leudy'); END IF;
  INSERT INTO public.cupido_calls (caller_id, callee_id, mode, video, credits_spent)
  VALUES (actor, _callee, _mode, COALESCE(_video, FALSE), cost) RETURNING id INTO call_id;
  RETURN call_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_bill_call_minute(_call UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  call_row public.cupido_calls%ROWTYPE;
  minute_cost INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO call_row FROM public.cupido_calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND OR call_row.caller_id <> auth.uid() THEN RAISE EXCEPTION 'CALL_BILLING_FORBIDDEN'; END IF;
  IF call_row.status <> 'active' THEN RETURN FALSE; END IF;
  IF lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' THEN RETURN TRUE; END IF;
  minute_cost := CASE WHEN call_row.mode = 'hot' THEN 100 ELSE 50 END;
  BEGIN
    PERFORM public.consume_credits(minute_cost, 'Minuto de llamada Cupido');
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.cupido_calls SET status = 'ended', ended_at = now() WHERE id = _call;
    RETURN FALSE;
  END;
  UPDATE public.cupido_calls SET credits_spent = credits_spent + minute_cost WHERE id = _call;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_bill_call_minute(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_bill_call_minute(UUID) TO authenticated;

-- Permanent pass records and mutual-interest matches. A match also creates a
-- normal one-to-one conversation and sends both users a notification.
ALTER TABLE public.cupido_likes
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'interested';
CREATE UNIQUE INDEX IF NOT EXISTS cupido_likes_actor_target_kind_uidx
  ON public.cupido_likes (actor_id, target_id, kind);
CREATE TABLE IF NOT EXISTS public.cupido_matches (
  user_low UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_high UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);
ALTER TABLE public.cupido_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_matches_participant_read ON public.cupido_matches;
CREATE POLICY cupido_matches_participant_read ON public.cupido_matches
  FOR SELECT TO authenticated USING (auth.uid() IN (user_low, user_high));
REVOKE ALL ON public.cupido_matches FROM anon, authenticated;
GRANT SELECT ON public.cupido_matches TO authenticated;

ALTER TABLE public.cupido_likes ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cupido_likes'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.cupido_likes', pol.policyname);
  END LOOP;
END;
$$;
CREATE POLICY cupido_likes_participant_read ON public.cupido_likes
  FOR SELECT TO authenticated USING (auth.uid() IN (actor_id, target_id));
REVOKE INSERT, UPDATE, DELETE ON public.cupido_likes FROM anon, authenticated;
GRANT SELECT ON public.cupido_likes TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_set_like(_kind TEXT, _remove BOOLEAN, _target UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _target IS NULL OR _target = actor THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('interested', 'pass', 'like') THEN RAISE EXCEPTION 'INVALID_LIKE_KIND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target) THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF _kind = 'interested' AND EXISTS (
    SELECT 1 FROM public.cupido_likes WHERE actor_id = actor AND target_id = _target AND kind = 'pass'
  ) THEN RAISE EXCEPTION 'PROFILE_ALREADY_PASSED'; END IF;
  IF COALESCE(_remove, FALSE) THEN
    IF _kind = 'pass' THEN RAISE EXCEPTION 'PASS_IS_PERMANENT'; END IF;
    DELETE FROM public.cupido_likes WHERE actor_id = actor AND target_id = _target AND kind = _kind;
    RETURN FOUND;
  END IF;
  IF _kind = 'pass' THEN
    DELETE FROM public.cupido_likes WHERE actor_id = actor AND target_id = _target AND kind = 'interested';
  END IF;
  INSERT INTO public.cupido_likes (actor_id, target_id, kind)
  VALUES (actor, _target, _kind)
  ON CONFLICT (actor_id, target_id, kind) DO UPDATE SET created_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_set_like(TEXT, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_set_like(TEXT, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_promote_post(_post UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = actor AND is_gran_liga) THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;
  IF lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor AND p.has_recharged)
     AND NOT EXISTS (SELECT 1 FROM public.paypal_orders o WHERE o.user_id = actor AND o.status = 'captured') THEN
    RAISE EXCEPTION 'PURCHASE_REQUIRED';
  END IF;
  PERFORM 1 FROM public.cupido_posts WHERE id = _post AND user_id = actor AND NOT is_promoted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_NOT_FOUND'; END IF;
  IF lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com' THEN
    PERFORM public.consume_credits(500, 'Promoción de publicación en el muro');
  END IF;
  PERFORM set_config('cupido.promoting_post', 'true', TRUE);
  UPDATE public.cupido_posts SET is_promoted = TRUE WHERE id = _post;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_promote_post(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_promote_post(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_create_mutual_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  low_user UUID;
  high_user UUID;
  conversation_id UUID;
  inserted_rows INTEGER := 0;
  inserted_match BOOLEAN := FALSE;
BEGIN
  IF NEW.kind <> 'interested' OR NOT EXISTS (
    SELECT 1 FROM public.cupido_likes l
    WHERE l.actor_id = NEW.target_id AND l.target_id = NEW.actor_id AND l.kind = 'interested'
  ) THEN RETURN NEW; END IF;
  low_user := LEAST(NEW.actor_id, NEW.target_id);
  high_user := GREATEST(NEW.actor_id, NEW.target_id);
  INSERT INTO public.cupido_matches (user_low, user_high) VALUES (low_user, high_user)
  ON CONFLICT (user_low, user_high) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  inserted_match := inserted_rows > 0;
  INSERT INTO public.cupido_conversations (participant_a, participant_b)
  VALUES (low_user, high_user)
  ON CONFLICT (participant_a, participant_b) DO NOTHING;
  SELECT id INTO conversation_id FROM public.cupido_conversations
  WHERE participant_a = low_user AND participant_b = high_user;
  IF inserted_match THEN
    PERFORM public.cupido_emit_notification(NEW.target_id, 'Tienes un nuevo match',
      'Hay interés mutuo. Ya pueden conversar.', 'match', NEW.actor_id, conversation_id,
      '/chat?userId=' || NEW.actor_id::TEXT);
    PERFORM public.cupido_emit_notification(NEW.actor_id, 'Tienes un nuevo match',
      'Hay interés mutuo. Ya pueden conversar.', 'match', NEW.target_id, conversation_id,
      '/chat?userId=' || NEW.target_id::TEXT);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_mutual_interest_match ON public.cupido_likes;
CREATE TRIGGER cupido_mutual_interest_match
  AFTER INSERT OR UPDATE OF kind ON public.cupido_likes
  FOR EACH ROW EXECUTE FUNCTION public.cupido_create_mutual_match();

-- Repair and retain the canonical comment columns used by all four surfaces.
ALTER TABLE public.cupido_post_comments
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD COLUMN IF NOT EXISTS parent_comment_id UUID REFERENCES public.cupido_post_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS likes_count BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS cupido_post_comments_post_created_idx
  ON public.cupido_post_comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS cupido_post_comments_parent_idx
  ON public.cupido_post_comments (parent_comment_id, created_at);
ALTER TABLE public.cupido_post_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cupido post comments public read" ON public.cupido_post_comments;
DROP POLICY IF EXISTS "cupido post comments own insert" ON public.cupido_post_comments;
DROP POLICY IF EXISTS "cupido post comments own delete" ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_select_all ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_insert_owner ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_delete_owner ON public.cupido_post_comments;
CREATE POLICY cupido_post_comments_select_all ON public.cupido_post_comments
  FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY cupido_post_comments_insert_owner ON public.cupido_post_comments
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND char_length(btrim(body)) BETWEEN 1 AND 500
  );
CREATE POLICY cupido_post_comments_delete_owner ON public.cupido_post_comments
  FOR DELETE TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.cupido_post_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.cupido_post_comments TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_validate_comment_parent()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_post_comments parent
    WHERE parent.id = NEW.parent_comment_id AND parent.post_id = NEW.post_id AND parent.id <> NEW.id
  ) THEN RAISE EXCEPTION 'INVALID_COMMENT_PARENT'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_validate_comment_parent ON public.cupido_post_comments;
CREATE TRIGGER cupido_validate_comment_parent
  BEFORE INSERT OR UPDATE OF post_id, parent_comment_id ON public.cupido_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.cupido_validate_comment_parent();
ALTER TABLE public.cupido_post_comments REPLICA IDENTITY FULL;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['cupido_posts', 'cupido_stories', 'cupido_post_comments', 'cupido_likes', 'cupido_matches'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = table_name) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
