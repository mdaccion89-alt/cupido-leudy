ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS ads_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS ad_reward_balance integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.cupido_admob_reward_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  transaction_id text UNIQUE,
  reward_amount integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  CONSTRAINT cupido_admob_reward_sessions_reward_amount_check
    CHECK (reward_amount IS NULL OR reward_amount = 15)
);

CREATE INDEX IF NOT EXISTS cupido_admob_reward_sessions_user_day_idx
  ON public.cupido_admob_reward_sessions (user_id, created_at DESC);

ALTER TABLE public.cupido_admob_reward_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cupido_admob_reward_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cupido_admob_reward_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.cupido_admob_start_reward_session(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_day_start timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_claimed integer := 0;
  v_session_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AD_REWARD_USER_REQUIRED'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || ':' || v_day_start::text, 0));
  PERFORM 1 FROM auth.users WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AD_REWARD_PROFILE_NOT_FOUND'; END IF;

  SELECT
    (SELECT count(*)::integer FROM public.cupido_reward_claims
      WHERE user_id = _user_id AND reward_type = 'ad' AND created_at >= v_day_start)
    +
    (SELECT count(*)::integer FROM public.cupido_admob_reward_sessions
      WHERE user_id = _user_id AND created_at >= v_day_start
        AND (status = 'confirmed' OR (status = 'pending' AND created_at > v_now - interval '15 minutes')))
  INTO v_claimed;

  IF v_claimed >= 5 THEN RAISE EXCEPTION 'AD_REWARD_DAILY_LIMIT'; END IF;

  INSERT INTO public.cupido_admob_reward_sessions (user_id, status, created_at)
  VALUES (_user_id, 'pending', v_now)
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object('session_id', v_session_id, 'remaining', greatest(0, 4 - v_claimed));
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_admob_cancel_reward_session(_user_id uuid, _session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  UPDATE public.cupido_admob_reward_sessions
     SET status = 'cancelled'
   WHERE id = _session_id AND user_id = _user_id AND status = 'pending';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_admob_reward_status(_user_id uuid, _session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.cupido_admob_reward_sessions%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO v_session
    FROM public.cupido_admob_reward_sessions
   WHERE id = _session_id AND user_id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AD_REWARD_SESSION_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'status', v_session.status,
    'awarded', CASE WHEN v_session.status = 'confirmed' THEN 15 ELSE 0 END,
    'confirmed_at', v_session.confirmed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_admob_confirm_reward(
  _session_id uuid,
  _user_id uuid,
  _transaction_id text,
  _reward_amount integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_day_start timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_session public.cupido_admob_reward_sessions%ROWTYPE;
  v_current_balance integer;
  v_balance integer;
  v_claimed integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF _reward_amount <> 15 OR _transaction_id IS NULL OR length(_transaction_id) > 256 THEN
    RAISE EXCEPTION 'AD_REWARD_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || ':' || v_day_start::text, 0));
  PERFORM 1 FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AD_REWARD_PROFILE_NOT_FOUND'; END IF;

  SELECT * INTO v_session
    FROM public.cupido_admob_reward_sessions
   WHERE id = _session_id AND user_id = _user_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AD_REWARD_SESSION_NOT_FOUND'; END IF;
  IF v_session.status = 'confirmed' AND v_session.transaction_id = _transaction_id THEN
    SELECT coalesce(balance, 0) INTO v_balance FROM public.user_credits WHERE user_id = _user_id;
    RETURN jsonb_build_object('status', 'confirmed', 'awarded', 15, 'balance', coalesce(v_balance, 0));
  END IF;
  IF v_session.status <> 'pending' OR v_session.created_at < v_now - interval '24 hours' THEN
    RAISE EXCEPTION 'AD_REWARD_SESSION_EXPIRED';
  END IF;

  SELECT count(*)::integer INTO v_claimed
    FROM public.cupido_reward_claims
   WHERE user_id = _user_id AND reward_type = 'ad' AND created_at >= v_day_start;
  SELECT v_claimed + count(*)::integer INTO v_claimed
    FROM public.cupido_admob_reward_sessions
   WHERE user_id = _user_id AND created_at >= v_day_start AND status = 'confirmed';
  IF v_claimed >= 5 THEN RAISE EXCEPTION 'AD_REWARD_DAILY_LIMIT'; END IF;

  IF EXISTS (SELECT 1 FROM public.cupido_admob_reward_sessions WHERE transaction_id = _transaction_id) THEN
    RAISE EXCEPTION 'AD_REWARD_TRANSACTION_REPLAY';
  END IF;

  SELECT coalesce(c.balance, p.credits_balance, p.credits, 0)
    INTO v_current_balance
    FROM public.profiles p
    LEFT JOIN public.user_credits c ON c.user_id = p.id
   WHERE p.id = _user_id;

  INSERT INTO public.user_credits (user_id, balance, ad_reward_balance, daily_reset_at, updated_at)
  VALUES (_user_id, CASE WHEN v_current_balance = -1 THEN -1 ELSE v_current_balance + 15 END, 15, v_now, v_now)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = CASE
          WHEN public.user_credits.balance = -1 OR EXCLUDED.balance = -1 THEN -1
          ELSE public.user_credits.balance + 15
        END,
        ad_reward_balance = coalesce(public.user_credits.ad_reward_balance, 0) + 15,
        updated_at = EXCLUDED.updated_at
  RETURNING balance INTO v_balance;

  UPDATE public.profiles
     SET credits = v_balance,
         credits_balance = v_balance,
         coins = v_balance,
         updated_at = v_now
   WHERE id = _user_id;

  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (_user_id, 15, 'Recompensa AdMob verificada por SSV · Cupido Leudy');

  UPDATE public.cupido_admob_reward_sessions
     SET status = 'confirmed', transaction_id = _transaction_id, reward_amount = 15, confirmed_at = v_now
   WHERE id = _session_id;

  RETURN jsonb_build_object('status', 'confirmed', 'awarded', 15, 'balance', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_admob_start_reward_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cupido_admob_cancel_reward_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cupido_admob_reward_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cupido_admob_confirm_reward(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_admob_start_reward_session(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cupido_admob_cancel_reward_session(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cupido_admob_reward_status(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cupido_admob_confirm_reward(uuid, uuid, text, integer) TO service_role;

-- Disable the old server-only endpoint: it trusted the client-side ad callback.
REVOKE ALL ON FUNCTION public.cupido_claim_ad_reward(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- AdMob earned credits remain separate from the welcome balance until spent.
-- They can fund gifts without marking the account as having made a real purchase.
CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(_receiver uuid, _gift_id text, _room uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender uuid := auth.uid();
  sender_email text;
  sender_has_purchased boolean := false;
  gift public.cupido_gifts%ROWTYPE;
  send_id uuid;
  infinite_admin boolean;
  new_balance integer;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  SELECT lower(coalesce(u.email, '')) INTO sender_email FROM auth.users AS u WHERE u.id = sender;
  infinite_admin := sender_email = 'leudyfeliz81@gmail.com';
  IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = _receiver) THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;

  SELECT * INTO gift
    FROM public.cupido_gifts
   WHERE id = _gift_id
     AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
       OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;

  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms AS r
     WHERE r.id = _room AND r.is_live
       AND (r.host_id = _receiver OR EXISTS (
         SELECT 1 FROM public.cupido_live_pk_battles AS b
          WHERE b.room_id = _room AND b.challenger_id = _receiver
            AND b.finished_at IS NULL AND b.ends_at > now()
       ))
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;

  IF gift.id = 'gran-liga-diamond' AND NOT infinite_admin
     AND NOT EXISTS (SELECT 1 FROM public.creator_profiles AS cp WHERE cp.id = sender AND cp.is_gran_liga) THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;

  IF NOT infinite_admin THEN
    SELECT coalesce(p.has_purchased, false) INTO sender_has_purchased
      FROM public.profiles AS p WHERE p.id = sender;
    IF NOT sender_has_purchased AND NOT EXISTS (
      SELECT 1 FROM public.user_credits AS c
       WHERE c.user_id = sender AND coalesce(c.ad_reward_balance, 0) >= gift.credits
    ) THEN
      RAISE EXCEPTION 'PURCHASE_REQUIRED';
    END IF;

    PERFORM public.apply_daily_refill(sender);
    UPDATE public.user_credits
       SET balance = balance - gift.credits,
           ad_reward_balance = greatest(coalesce(ad_reward_balance, 0) - gift.credits, 0),
           updated_at = now()
     WHERE user_id = sender AND balance >= gift.credits
       AND (sender_has_purchased OR coalesce(ad_reward_balance, 0) >= gift.credits)
     RETURNING balance INTO new_balance;
    IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
    VALUES (sender, -gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;

  INSERT INTO public.cupido_gift_sends (
    sender_id, sender_user_id, from_user_id,
    receiver_id, recipient_id, to_user_id,
    gift_id, gift_name, credits, coin_cost, coins, cash_value, live_room_id
  ) VALUES (
    sender, sender, sender,
    _receiver, _receiver, _receiver,
    gift.id, gift.name, gift.credits, gift.credits, gift.credits, gift.cash, _room
  ) RETURNING id INTO send_id;

  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.cupido_balances.balance + EXCLUDED.balance,
        updated_at = now();

  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (
    _receiver,
    'Recibiste un regalo',
    CASE WHEN gift.id = 'gran-liga-diamond'
      THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
      ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.'
    END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END,
    sender,
    send_id
  );
  RETURN send_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_transfer_gift(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(uuid, text, uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'site_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
