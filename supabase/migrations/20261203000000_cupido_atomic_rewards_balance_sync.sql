-- Keep daily claims on the database clock, serialize simultaneous requests,
-- and synchronize both wallet sources in the same transaction.
CREATE OR REPLACE FUNCTION public.cupido_claim_daily_reward()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_streak integer;
  v_last_claim timestamptz;
  v_now timestamptz := clock_timestamp();
  v_day integer;
  v_amount integer;
  v_balance integer;
  v_current_balance integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT p.daily_streak, p.last_daily_claim,
         coalesce(c.balance, p.credits_balance, p.credits, 0)
    INTO v_streak, v_last_claim, v_current_balance
    FROM public.profiles AS p
    LEFT JOIN public.user_credits AS c ON c.user_id = p.id
   WHERE p.id = v_user
   FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF v_last_claim IS NOT NULL AND v_now < v_last_claim + interval '24 hours' THEN
    RAISE EXCEPTION 'DAILY_REWARD_ALREADY_CLAIMED';
  END IF;

  IF v_last_claim IS NULL OR v_now >= v_last_claim + interval '48 hours' THEN
    v_day := 1;
  ELSE
    v_day := mod(greatest(coalesce(v_streak, 0), 0), 5) + 1;
  END IF;
  v_amount := CASE v_day WHEN 1 THEN 10 WHEN 2 THEN 20 WHEN 3 THEN 30 WHEN 4 THEN 40 ELSE 100 END;

  INSERT INTO public.cupido_reward_claims (user_id, reward_type, claim_key)
  VALUES (v_user, 'daily-' || v_day::text, to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
  ON CONFLICT (user_id, reward_type, claim_key) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_REWARD_ALREADY_CLAIMED';
  END IF;

  INSERT INTO public.user_credits (user_id, balance, daily_reset_at, updated_at)
  VALUES (
    v_user,
    CASE WHEN v_current_balance = -1 THEN -1 ELSE v_current_balance + v_amount END,
    v_now,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE
    SET balance = CASE
          WHEN public.user_credits.balance = -1 OR EXCLUDED.balance = -1 THEN -1
          ELSE public.user_credits.balance + v_amount
        END,
        updated_at = EXCLUDED.updated_at
  RETURNING balance INTO v_balance;

  UPDATE public.profiles
     SET daily_streak = v_day,
         last_daily_claim = v_now,
         credits = v_balance,
         credits_balance = v_balance,
         updated_at = v_now
   WHERE id = v_user;

  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (v_user, v_amount, 'Premio diario Cupido Leudy · día ' || v_day::text);

  RETURN jsonb_build_object('day', v_day, 'streak', v_day, 'awarded', v_amount, 'balance', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_claim_daily_reward() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_claim_daily_reward() TO authenticated, service_role;

-- The server calls this only after the native rewarded-ad event. Locking the
-- profile row makes the daily cap and the +25 credit grant atomic across devices.
CREATE OR REPLACE FUNCTION public.cupido_claim_ad_reward(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_day_start timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_current_balance integer;
  v_balance integer;
  v_claimed integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT coalesce(c.balance, p.credits_balance, p.credits, 0)
    INTO v_current_balance
    FROM public.profiles AS p
    LEFT JOIN public.user_credits AS c ON c.user_id = p.id
   WHERE p.id = _user_id
   FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AD_REWARD_PROFILE_NOT_FOUND';
  END IF;

  SELECT count(*)::integer INTO v_claimed
    FROM public.cupido_reward_claims
   WHERE user_id = _user_id
     AND reward_type = 'ad'
     AND created_at >= v_day_start;
  IF v_claimed >= 5 THEN
    RAISE EXCEPTION 'AD_REWARD_DAILY_LIMIT';
  END IF;

  INSERT INTO public.cupido_reward_claims (user_id, reward_type, claim_key, created_at)
  VALUES (
    _user_id,
    'ad',
    to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '-' || gen_random_uuid()::text,
    v_now
  );

  INSERT INTO public.user_credits (user_id, balance, daily_reset_at, updated_at)
  VALUES (
    _user_id,
    CASE WHEN v_current_balance = -1 THEN -1 ELSE v_current_balance + 25 END,
    v_now,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE
    SET balance = CASE
          WHEN public.user_credits.balance = -1 OR EXCLUDED.balance = -1 THEN -1
          ELSE public.user_credits.balance + 25
        END,
        updated_at = EXCLUDED.updated_at
  RETURNING balance INTO v_balance;

  UPDATE public.profiles
     SET credits = v_balance,
         credits_balance = v_balance,
         updated_at = v_now
   WHERE id = _user_id;

  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (_user_id, 25, 'Recompensa por anuncio · Cupido Leudy');

  RETURN jsonb_build_object(
    'awarded', 25,
    'day', 0,
    'streak', 0,
    'balance', v_balance,
    'claimed', v_claimed + 1,
    'remaining', 5 - v_claimed - 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_claim_ad_reward(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_claim_ad_reward(UUID) TO service_role;
