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

  UPDATE public.profiles
     SET daily_streak = v_day,
         last_daily_claim = v_now,
         updated_at = v_now
   WHERE id = v_user;

  INSERT INTO public.user_credits (user_id, balance, daily_reset_at, updated_at)
  VALUES (v_user, CASE WHEN v_current_balance = -1 THEN -1 ELSE v_amount END, v_now, v_now)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = CASE WHEN public.user_credits.balance = -1 OR EXCLUDED.balance = -1
                       THEN -1
                       ELSE public.user_credits.balance + EXCLUDED.balance
                  END,
        updated_at = EXCLUDED.updated_at
  RETURNING balance INTO v_balance;

  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (v_user, v_amount, 'Premio diario Cupido Leudy · día ' || v_day::text);

  RETURN jsonb_build_object('day', v_day, 'streak', v_day, 'awarded', v_amount, 'balance', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_claim_daily_reward() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_claim_daily_reward() TO authenticated, service_role;

ALTER TABLE public.payment_settings
  ADD COLUMN IF NOT EXISTS paypal_client_id text;
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS paypal_client_id text;

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
    nullif(btrim(app.config ->> 'paypal_client_id'), ''),
    nullif(btrim(app.config ->> 'paypalClientId'), ''),
    nullif(btrim(app.config ->> 'clientId'), '')
  )
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.payment_settings AS payment ON payment.id = 1
  LEFT JOIN public.app_settings AS app ON app.id = 1;
$$;

REVOKE ALL ON FUNCTION public.cupido_public_paypal_client_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupido_public_paypal_client_id() TO anon, authenticated, service_role;
