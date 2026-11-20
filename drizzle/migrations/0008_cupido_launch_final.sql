ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS verification_frames TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.payment_settings
  ADD COLUMN IF NOT EXISTS paypal_business_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS paypal_client_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS paypal_secret TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS paypal_mode TEXT NOT NULL DEFAULT 'live' CHECK (paypal_mode IN ('sandbox', 'live'));

CREATE TABLE IF NOT EXISTS public.cupido_referrals (
  referee_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rewarded', 'invalid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cupido_referrals_referrer_idx ON public.cupido_referrals (referrer_id);

ALTER TABLE public.cupido_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cupido referrals select own" ON public.cupido_referrals;
CREATE POLICY "cupido referrals select own" ON public.cupido_referrals
  FOR SELECT TO authenticated
  USING (referee_id = auth.uid() OR referrer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_calls;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_register_referral(_referrer UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referee UUID := auth.uid();
BEGIN
  IF v_referee IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF _referrer IS NULL OR _referrer = v_referee THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _referrer) THEN
    RETURN;
  END IF;
  INSERT INTO public.cupido_referrals (referee_id, referrer_id)
  VALUES (v_referee, _referrer)
  ON CONFLICT (referee_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_submit_live_verification(_frames TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_old TEXT[] := '{}';
  v_selfie TEXT := '';
  v_delete TEXT[] := '{}';
  v_frame TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF _frames IS NULL OR cardinality(_frames) <> 3 THEN
    RAISE EXCEPTION 'Se requieren exactamente 3 capturas faciales.';
  END IF;

  FOREACH v_frame IN ARRAY _frames LOOP
    IF v_frame IS NULL OR v_frame = '' OR v_frame NOT LIKE v_user::text || '/verification/%' THEN
      RAISE EXCEPTION 'Ruta de captura no válida.';
    END IF;
  END LOOP;

  SELECT verification_frames, selfie_path INTO v_old, v_selfie
  FROM public.creator_profiles
  WHERE id = v_user;

  v_delete := coalesce(v_old, '{}');
  IF v_selfie LIKE v_user::text || '/selfies/%' THEN
    v_delete := array_append(v_delete, v_selfie);
  END IF;

  IF cardinality(v_delete) > 0 THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'cupido-private' AND name = ANY(v_delete);
  END IF;

  UPDATE public.creator_profiles
  SET selfie_path = _frames[1],
      verification_frames = _frames,
      verification_status = 'pending',
      is_verified_blue = false
  WHERE id = v_user;

  UPDATE public.cupido_referrals
  SET status = 'verified', verified_at = now()
  WHERE referee_id = v_user AND status = 'pending';

  INSERT INTO public.notifications (user_id, kind, title, body)
  VALUES (
    v_user,
    'verification',
    'Verificación recibida',
    'Tus 3 capturas faciales fueron enviadas. El Admin Supremo revisará tu solicitud.'
  );
END $$;

DROP FUNCTION IF EXISTS public.cupido_review_verification(UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.cupido_review_verification(
  _user_id UUID,
  _approve BOOLEAN,
  _frames TEXT[] DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_admin_email TEXT := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_stored TEXT[] := '{}';
  v_selfie TEXT := '';
  v_delete TEXT[] := '{}';
  v_referrer UUID;
BEGIN
  IF v_admin_email <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT verification_frames, selfie_path INTO v_stored, v_selfie
  FROM public.creator_profiles
  WHERE id = _user_id;

  v_delete := coalesce(v_stored, '{}');
  IF v_selfie LIKE _user_id::text || '/%' THEN
    v_delete := array_append(v_delete, v_selfie);
  END IF;
  IF _frames IS NOT NULL AND cardinality(_frames) > 0 THEN
    v_delete := array_cat(v_delete, _frames);
  END IF;

  IF v_delete IS NOT NULL AND cardinality(v_delete) > 0 THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'cupido-private' AND name = ANY(v_delete);
  END IF;

  UPDATE public.creator_profiles
  SET verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      is_verified_blue = _approve,
      selfie_path = '',
      verification_frames = '{}'
  WHERE id = _user_id;

  IF _approve THEN
    UPDATE public.cupido_referrals
    SET status = 'rewarded', rewarded_at = now()
    WHERE referee_id = _user_id AND status = 'verified' AND rewarded_at IS NULL
    RETURNING referrer_id INTO v_referrer;

    IF v_referrer IS NOT NULL THEN
      PERFORM public.grant_credits(
        v_referrer,
        200,
        'Invitado verificado en Cupido Leudy ❤️'
      );
      INSERT INTO public.notifications (user_id, actor_id, kind, title, body)
      VALUES (
        v_referrer,
        _user_id,
        'referral',
        '¡Referido verificado! +200 monedas',
        'Tu invitado completó la verificación facial en vivo y recibiste 200 monedas brillantes.'
      );
    END IF;
  ELSE
    UPDATE public.cupido_referrals
    SET status = 'invalid'
    WHERE referee_id = _user_id AND status = 'verified';
  END IF;

  INSERT INTO public.notifications (user_id, kind, title, body)
  VALUES (
    _user_id,
    'verification',
    CASE WHEN _approve THEN 'Insignia azul aprobada' ELSE 'Verificación rechazada' END,
    CASE WHEN _approve
      THEN 'Tu identidad fue verificada. Ya puedes transmitir Lives y destacar con insignia azul.'
      ELSE 'Revisa tus capturas y vuelve a intentarlo cuando quieras.'
    END
  );
END $$;

CREATE OR REPLACE FUNCTION public.cupido_official_auto_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin UUID;
BEGIN
  SELECT id INTO v_admin
  FROM auth.users
  WHERE lower(email) = 'leudyfeliz81@gmail.com'
  LIMIT 1;

  IF v_admin IS NOT NULL AND v_admin <> NEW.id THEN
    INSERT INTO public.follows (follower_id, following_id)
    VALUES (v_admin, NEW.id)
    ON CONFLICT (follower_id, following_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cupido_official_auto_follow_trg ON public.profiles;
CREATE TRIGGER cupido_official_auto_follow_trg
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_official_auto_follow();

CREATE OR REPLACE FUNCTION public.cupido_save_profile(
  _display_name TEXT,
  _bio TEXT,
  _country_code TEXT,
  _looking_for TEXT,
  _drinks BOOLEAN,
  _has_kids BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF v_email = 'leudyfeliz81@gmail.com' THEN
    v_name := 'Cupido Leudy Cuenta Oficial';
  ELSE
    v_name := nullif(btrim(_display_name), '');
  END IF;

  UPDATE public.profiles
  SET display_name = coalesce(v_name, display_name),
      country_code = coalesce(nullif(btrim(_country_code), ''), country_code),
      terms_accepted_at = coalesce(terms_accepted_at, now())
  WHERE id = v_user;

  UPDATE public.creator_profiles
  SET display_name = coalesce(v_name, display_name),
      bio = coalesce(_bio, bio),
      country_code = coalesce(nullif(btrim(_country_code), ''), country_code),
      looking_for = coalesce(_looking_for, looking_for),
      drinks = coalesce(_drinks, drinks),
      has_kids = coalesce(_has_kids, has_kids)
  WHERE id = v_user;
END $$;

DO $$
DECLARE
  v_admin UUID;
BEGIN
  SELECT id INTO v_admin
  FROM auth.users
  WHERE lower(email) = 'leudyfeliz81@gmail.com'
  LIMIT 1;

  IF v_admin IS NOT NULL THEN
    UPDATE public.profiles
    SET display_name = 'Cupido Leudy Cuenta Oficial'
    WHERE id = v_admin;

    UPDATE public.creator_profiles
    SET display_name = 'Cupido Leudy Cuenta Oficial',
        is_official = true,
        is_verified_blue = true,
        verification_status = 'approved',
        moderation_status = 'approved',
        is_premium = true
    WHERE id = v_admin;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_admin, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.follows (follower_id, following_id)
    SELECT v_admin, id FROM public.creator_profiles WHERE id <> v_admin
    ON CONFLICT (follower_id, following_id) DO NOTHING;
  END IF;
END $$;

DROP POLICY IF EXISTS "cupido private admin delete" ON storage.objects;
CREATE POLICY "cupido private admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cupido-private' AND public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.cupido_referrals TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_register_referral(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_submit_live_verification(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_review_verification(UUID, BOOLEAN, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_save_profile(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
