-- Cupido Leudy: códigos personales de referidos y bonos en monedas no retirables.
-- Los dos bonos se escriben de forma atómica exclusivamente en user_credits.balance.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE OR REPLACE FUNCTION public.cupido_generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT;
  v_attempt INTEGER;
BEGIN
  FOR v_attempt IN 1..100 LOOP
    v_code := UPPER(SUBSTRING(REPLACE(pg_catalog.gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 6));
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'REFERRAL_CODE_GENERATION_FAILED';
END;
$$;

DO $$
DECLARE
  v_profile RECORD;
BEGIN
  FOR v_profile IN SELECT id FROM public.profiles WHERE referral_code IS NULL LOOP
    UPDATE public.profiles
    SET referral_code = public.cupido_generate_referral_code()
    WHERE id = v_profile.id AND referral_code IS NULL;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_unique_idx
  ON public.profiles (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cupido_assign_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.referral_code := public.cupido_generate_referral_code();
  ELSE
    NEW.referral_code := OLD.referral_code;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_generate_referral_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cupido_assign_referral_code() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cupido_assign_referral_code ON public.profiles;
CREATE TRIGGER cupido_assign_referral_code
  BEFORE INSERT OR UPDATE OF referral_code ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.cupido_assign_referral_code();

CREATE TABLE IF NOT EXISTS public.cupido_referrals (
  referee_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rewarded', 'invalid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ
);

-- Older installations may already have this table without its reward state columns.
ALTER TABLE public.cupido_referrals
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rewarded_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cupido_referrals'::regclass
      AND conname = 'cupido_referrals_status_check'
  ) THEN
    ALTER TABLE public.cupido_referrals
      ADD CONSTRAINT cupido_referrals_status_check
      CHECK (status IN ('pending', 'verified', 'rewarded', 'invalid')) NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS cupido_referrals_referrer_idx
  ON public.cupido_referrals (referrer_id);
CREATE INDEX IF NOT EXISTS cupido_referrals_referrer_rewarded_idx
  ON public.cupido_referrals (referrer_id, rewarded_at)
  WHERE status = 'rewarded';

ALTER TABLE public.cupido_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cupido referrals select own" ON public.cupido_referrals;
CREATE POLICY "cupido referrals select own" ON public.cupido_referrals
  FOR SELECT TO authenticated
  USING (referee_id = auth.uid() OR referrer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.cupido_referrals TO authenticated;

-- Disable the old client-callable UUID variant; only the authenticated server function
-- can call the atomic code-based operation with the verified account id.
DO $$
BEGIN
  IF to_regprocedure('public.cupido_register_referral(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.cupido_register_referral(UUID) FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_register_referral(_referee UUID, _referral_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_code TEXT := UPPER(BTRIM(COALESCE(_referral_code, '')));
  v_referrer UUID;
  v_user_created_at TIMESTAMPTZ;
  v_signup_code TEXT;
BEGIN
  IF _referee IS NULL OR v_code !~ '^[A-Z0-9]{6}$' THEN
    RETURN FALSE;
  END IF;

  -- Bind email/phone signup to the metadata captured then. OAuth providers do not
  -- accept user_metadata on redirect, so permit an unbound code only during the
  -- first ten minutes of a newly created account.
  SELECT created_at, UPPER(COALESCE(raw_user_meta_data->>'referral_code', ''))
    INTO v_user_created_at, v_signup_code
  FROM auth.users
  WHERE id = _referee;
  IF v_user_created_at IS NULL
     OR v_user_created_at < now() - INTERVAL '30 days'
     OR (v_signup_code <> v_code AND (
       v_signup_code <> '' OR v_user_created_at < now() - INTERVAL '10 minutes'
     )) THEN
    RETURN FALSE;
  END IF;

  SELECT id INTO v_referrer
  FROM public.profiles
  WHERE referral_code = v_code;
  IF v_referrer IS NULL OR v_referrer = _referee THEN
    RETURN FALSE;
  END IF;

  -- Auth flows normally create this row already. This also makes the operation safe
  -- when profile creation and the first signed-in event race each other.
  INSERT INTO public.profiles (id) VALUES (_referee)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles
  SET referred_by = v_referrer
  WHERE id = _referee AND referred_by IS NULL;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.cupido_referrals (referee_id, referrer_id, status, verified_at, rewarded_at)
  VALUES (_referee, v_referrer, 'rewarded', now(), now())
  ON CONFLICT (referee_id) DO NOTHING;
  IF NOT FOUND THEN
    UPDATE public.profiles SET referred_by = NULL
    WHERE id = _referee AND referred_by = v_referrer;
    RETURN FALSE;
  END IF;

  INSERT INTO public.user_credits (user_id, balance, updated_at)
  VALUES (_referee, 50, now())
  ON CONFLICT (user_id) DO UPDATE
  SET balance = CASE WHEN public.user_credits.balance = -1
                     THEN -1 ELSE public.user_credits.balance + 50 END,
      updated_at = now();

  INSERT INTO public.user_credits (user_id, balance, updated_at)
  VALUES (v_referrer, 100, now())
  ON CONFLICT (user_id) DO UPDATE
  SET balance = CASE WHEN public.user_credits.balance = -1
                     THEN -1 ELSE public.user_credits.balance + 100 END,
      updated_at = now();

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_register_referral(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_register_referral(UUID, TEXT) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cupido_referrals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_referrals;
  END IF;
END;
$$;
