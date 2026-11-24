BEGIN;

-- Keep the legacy profiles.coins name synchronized with the authoritative wallet.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coins INTEGER NOT NULL DEFAULT 0;

UPDATE public.profiles p
SET coins = COALESCE(
  (SELECT c.balance FROM public.user_credits c WHERE c.user_id = p.id),
  p.credits_balance,
  p.credits,
  0
);

CREATE OR REPLACE FUNCTION public.sync_credits_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_sync_setting TEXT := current_setting('cupido.wallet_balance_sync', TRUE);
BEGIN
  PERFORM set_config('cupido.wallet_balance_sync', 'on', TRUE);
  UPDATE public.profiles
  SET coins = NEW.balance,
      credits = NEW.balance,
      credits_balance = NEW.balance,
      updated_at = now()
  WHERE id = NEW.user_id;
  PERFORM set_config('cupido.wallet_balance_sync', COALESCE(previous_sync_setting, 'off'), TRUE);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credits_sync_profile ON public.user_credits;
CREATE TRIGGER credits_sync_profile
  AFTER INSERT OR UPDATE OF balance ON public.user_credits
  FOR EACH ROW EXECUTE FUNCTION public.sync_credits_to_profile();

CREATE OR REPLACE FUNCTION public.cupido_protect_profile_coin_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR COALESCE(current_setting('cupido.wallet_balance_sync', TRUE), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.coins, 0) <> 0 THEN RAISE EXCEPTION 'PROFILE_COINS_SERVER_MANAGED'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.coins IS DISTINCT FROM OLD.coins THEN
    RAISE EXCEPTION 'PROFILE_COINS_SERVER_MANAGED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_protect_profile_coin_mirror ON public.profiles;
CREATE TRIGGER cupido_protect_profile_coin_mirror
  BEFORE INSERT OR UPDATE OF coins ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.cupido_protect_profile_coin_mirror();

-- PayPal calls this only after the provider confirms the captured USD amount.
-- The wallet grant, profile mirror, and order history transition are atomic.
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
  infinite_admin BOOLEAN;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT * INTO order_row
  FROM public.paypal_orders
  WHERE id = _order_id AND user_id = _user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_FOUND'; END IF;
  IF order_row.credits <> _credits THEN RAISE EXCEPTION 'PAYPAL_CREDIT_MISMATCH'; END IF;
  IF (_gran_liga AND (order_row.package_id <> 'gran-liga-100'
       OR order_row.amount::NUMERIC NOT IN (60, 100)
       OR _credits <> 1000000))
     OR (NOT _gran_liga AND order_row.package_id = 'gran-liga-100') THEN
    RAISE EXCEPTION 'PAYPAL_PACKAGE_MISMATCH';
  END IF;

  SELECT lower(COALESCE(email, '')) = 'leudyfeliz81@gmail.com'
  INTO infinite_admin
  FROM auth.users
  WHERE id = _user_id;

  IF order_row.status = 'captured' THEN
    SELECT CASE
             WHEN COALESCE(infinite_admin, FALSE) THEN -1
             ELSE COALESCE(c.balance, p.credits_balance, p.credits, 0)
           END
    INTO resulting_balance
    FROM public.profiles p
    LEFT JOIN public.user_credits c ON c.user_id = p.id
    WHERE p.id = _user_id;
    UPDATE public.profiles p
    SET coins = COALESCE(resulting_balance, p.credits_balance, p.credits, 0),
        credits = COALESCE(resulting_balance, p.credits_balance, p.credits, 0),
        credits_balance = COALESCE(resulting_balance, p.credits_balance, p.credits, 0),
        has_purchased = TRUE,
        has_recharged = TRUE,
        is_gran_liga = is_gran_liga OR _gran_liga,
        updated_at = now()
    WHERE p.id = _user_id;
    RETURN TRUE;
  END IF;

  IF order_row.status <> 'created' THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_PENDING'; END IF;

  IF COALESCE(infinite_admin, FALSE) THEN
    resulting_balance := -1;
  ELSE
    PERFORM public.grant_credits(
      _user_id => _user_id,
      _amount => _credits,
      _reason => 'Compra PayPal ' || _credits || ' monedas'
    );
    SELECT balance INTO resulting_balance
    FROM public.user_credits
    WHERE user_id = _user_id;
  END IF;
  IF resulting_balance IS NULL THEN RAISE EXCEPTION 'CREDIT_GRANT_FAILED'; END IF;

  UPDATE public.profiles
  SET coins = resulting_balance,
      credits = resulting_balance,
      credits_balance = resulting_balance,
      has_purchased = TRUE,
      has_recharged = TRUE,
      is_gran_liga = is_gran_liga OR _gran_liga,
      updated_at = now()
  WHERE id = _user_id;

  UPDATE public.creator_profiles
  SET is_gran_liga = is_gran_liga OR _gran_liga
  WHERE id = _user_id;

  UPDATE public.paypal_orders
  SET status = 'captured', captured_at = now()
  WHERE id = _order_id AND status = 'created';

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_finalize_paypal_package(UUID, UUID, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_finalize_paypal_package(UUID, UUID, INTEGER, BOOLEAN)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
