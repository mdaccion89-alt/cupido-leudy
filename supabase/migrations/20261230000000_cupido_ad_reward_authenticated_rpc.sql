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

CREATE OR REPLACE FUNCTION public.cupido_claim_ad_reward_authenticated(_claim_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_day_start timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_current_balance integer;
  v_balance integer;
  v_claimed integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AD_REWARD_AUTH_REQUIRED';
  END IF;
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF _claim_key IS NULL
     OR length(_claim_key) <> 36
     OR _claim_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'AD_REWARD_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_day_start::text, 0));

  SELECT coalesce(c.balance, p.credits_balance, p.credits, 0)
    INTO v_current_balance
    FROM public.profiles AS p
    LEFT JOIN public.user_credits AS c ON c.user_id = p.id
   WHERE p.id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AD_REWARD_PROFILE_NOT_FOUND';
  END IF;

  SELECT count(*)::integer INTO v_claimed
    FROM public.cupido_reward_claims
   WHERE user_id = v_user_id
     AND reward_type = 'ad'
     AND created_at >= v_day_start;
  IF v_claimed >= 5 THEN
    RAISE EXCEPTION 'AD_REWARD_DAILY_LIMIT';
  END IF;

  INSERT INTO public.cupido_reward_claims (user_id, reward_type, claim_key, created_at)
  VALUES (v_user_id, 'ad', 'client:' || _claim_key, v_now)
  ON CONFLICT (user_id, reward_type, claim_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT coalesce(balance, 0) INTO v_balance FROM public.user_credits WHERE user_id = v_user_id;
    RETURN jsonb_build_object(
      'status', 'confirmed',
      'awarded', 0,
      'balance', coalesce(v_balance, 0),
      'remaining', greatest(0, 4 - v_claimed)
    );
  END IF;

  INSERT INTO public.user_credits (user_id, balance, ad_reward_balance, daily_reset_at, updated_at)
  VALUES (
    v_user_id,
    CASE WHEN v_current_balance = -1 THEN -1 ELSE v_current_balance + 15 END,
    15,
    v_now,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE
    SET balance = CASE
          WHEN public.user_credits.balance = -1 OR EXCLUDED.balance = -1 THEN -1
          ELSE public.user_credits.balance + 15
        END,
        ad_reward_balance = coalesce(public.user_credits.ad_reward_balance, 0) + 15,
        daily_reset_at = EXCLUDED.daily_reset_at,
        updated_at = EXCLUDED.updated_at
  RETURNING balance INTO v_balance;

  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (v_user_id, 15, 'Recompensa por anuncio · Cupido Leudy');

  RETURN jsonb_build_object(
    'status', 'confirmed',
    'awarded', 15,
    'balance', v_balance,
    'remaining', greatest(0, 4 - v_claimed)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_claim_ad_reward_authenticated(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_claim_ad_reward_authenticated(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
