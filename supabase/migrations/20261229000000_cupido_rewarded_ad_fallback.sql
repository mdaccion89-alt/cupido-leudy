ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS ad_reward_balance integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.cupido_reward_claims (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_type text NOT NULL,
  claim_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cupido_reward_claims_user_type_key_key UNIQUE (user_id, reward_type, claim_key)
);

ALTER TABLE public.cupido_reward_claims
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT clock_timestamp();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.cupido_reward_claims'::regclass
       AND conname = 'cupido_reward_claims_user_type_key_key'
  ) THEN
    ALTER TABLE public.cupido_reward_claims
      ADD CONSTRAINT cupido_reward_claims_user_type_key_key UNIQUE (user_id, reward_type, claim_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cupido_reward_claims_user_day_idx
  ON public.cupido_reward_claims (user_id, created_at DESC);

ALTER TABLE public.cupido_reward_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cupido_reward_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cupido_reward_claims TO service_role;

INSERT INTO public.cupido_reward_claims (user_id, reward_type, claim_key, created_at)
SELECT user_id, 'ad', 'ssv:' || transaction_id, confirmed_at
  FROM public.cupido_admob_reward_sessions
 WHERE status = 'confirmed' AND transaction_id IS NOT NULL
ON CONFLICT (user_id, reward_type, claim_key) DO NOTHING;

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
        AND status = 'pending' AND created_at > v_now - interval '15 minutes')
  INTO v_claimed;

  IF v_claimed >= 5 THEN RAISE EXCEPTION 'AD_REWARD_DAILY_LIMIT'; END IF;

  INSERT INTO public.cupido_admob_reward_sessions (user_id, status, created_at)
  VALUES (_user_id, 'pending', v_now)
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object('session_id', v_session_id, 'remaining', greatest(0, 4 - v_claimed));
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_admob_claim_client_reward(
  _user_id uuid,
  _session_id uuid,
  _claim_key text
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
  IF _user_id IS NULL OR _session_id IS NULL OR _claim_key IS NULL THEN RAISE EXCEPTION 'AD_REWARD_INVALID'; END IF;
  IF length(_claim_key) <> 36 OR _claim_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
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

  IF v_session.status = 'confirmed' THEN
    SELECT coalesce(balance, 0) INTO v_balance FROM public.user_credits WHERE user_id = _user_id;
    RETURN jsonb_build_object(
      'status', 'confirmed',
      'awarded', CASE WHEN v_session.transaction_id = 'client:' || _claim_key THEN 15 ELSE 0 END,
      'balance', coalesce(v_balance, 0),
      'remaining', 0
    );
  END IF;
  IF v_session.status <> 'pending' OR v_session.created_at < v_now - interval '24 hours' THEN
    RAISE EXCEPTION 'AD_REWARD_SESSION_EXPIRED';
  END IF;

  SELECT count(*)::integer INTO v_claimed
    FROM public.cupido_reward_claims
   WHERE user_id = _user_id AND reward_type = 'ad' AND created_at >= v_day_start;
  IF v_claimed >= 5 THEN RAISE EXCEPTION 'AD_REWARD_DAILY_LIMIT'; END IF;

  INSERT INTO public.cupido_reward_claims (user_id, reward_type, claim_key, created_at)
  VALUES (_user_id, 'ad', 'client:' || _claim_key, v_now)
  ON CONFLICT (user_id, reward_type, claim_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT coalesce(balance, 0) INTO v_balance FROM public.user_credits WHERE user_id = _user_id;
    RETURN jsonb_build_object(
      'status', 'confirmed',
      'awarded', 0,
      'balance', coalesce(v_balance, 0),
      'remaining', greatest(0, 4 - v_claimed)
    );
  END IF;

  SELECT coalesce(c.balance, p.credits_balance, p.credits, 0)
    INTO v_current_balance
    FROM public.profiles AS p
    LEFT JOIN public.user_credits AS c ON c.user_id = p.id
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
  VALUES (_user_id, 15, 'Recompensa por anuncio · Cupido Leudy');

  UPDATE public.cupido_admob_reward_sessions
     SET status = 'confirmed',
         transaction_id = 'client:' || _claim_key,
         reward_amount = 15,
         confirmed_at = v_now
   WHERE id = _session_id;

  RETURN jsonb_build_object(
    'status', 'confirmed',
    'awarded', 15,
    'balance', v_balance,
    'remaining', greatest(0, 4 - v_claimed)
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

  IF v_session.status = 'confirmed' THEN
    SELECT coalesce(balance, 0) INTO v_balance FROM public.user_credits WHERE user_id = _user_id;
    RETURN jsonb_build_object(
      'status', 'confirmed',
      'awarded', CASE WHEN v_session.transaction_id = _transaction_id THEN 15 ELSE 0 END,
      'balance', coalesce(v_balance, 0)
    );
  END IF;
  IF v_session.status <> 'pending' OR v_session.created_at < v_now - interval '24 hours' THEN
    RAISE EXCEPTION 'AD_REWARD_SESSION_EXPIRED';
  END IF;

  SELECT count(*)::integer INTO v_claimed
    FROM public.cupido_reward_claims
   WHERE user_id = _user_id AND reward_type = 'ad' AND created_at >= v_day_start;
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

  INSERT INTO public.cupido_reward_claims (user_id, reward_type, claim_key, created_at)
  VALUES (_user_id, 'ad', 'ssv:' || _transaction_id, v_now)
  ON CONFLICT (user_id, reward_type, claim_key) DO NOTHING;

  UPDATE public.cupido_admob_reward_sessions
     SET status = 'confirmed', transaction_id = _transaction_id, reward_amount = 15, confirmed_at = v_now
   WHERE id = _session_id;

  RETURN jsonb_build_object('status', 'confirmed', 'awarded', 15, 'balance', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_admob_start_reward_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cupido_admob_claim_client_reward(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cupido_admob_confirm_reward(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_admob_start_reward_session(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cupido_admob_claim_client_reward(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cupido_admob_confirm_reward(uuid, uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
