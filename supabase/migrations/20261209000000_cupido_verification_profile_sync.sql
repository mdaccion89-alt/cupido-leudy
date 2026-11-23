-- Keep the public creator badge and the profile verification projection in one
-- transaction for both selfie and video review paths.
CREATE OR REPLACE FUNCTION public.cupido_review_verification(_user_id UUID, _approve BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE frames TEXT[];
BEGIN
  IF auth.uid() IS NULL
     OR (lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
         AND NOT public.has_role(auth.uid(), 'admin')
         AND NOT public.has_role(auth.uid(), 'admin_supremo')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL OR _approve IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  SELECT verification_frames INTO frames
  FROM public.creator_profiles
  WHERE id = _user_id AND verification_status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFICATION_NOT_PENDING'; END IF;
  IF _approve AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = _user_id
      AND ((COALESCE(NULLIF(p.avatar_url, ''), '') <> '')::INTEGER
        + (NULLIF(btrim(p.full_name), '') IS NOT NULL)::INTEGER
        + (p.birth_date IS NOT NULL AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years')::INTEGER
        + (NULLIF(btrim(p.country_code), '') IS NOT NULL)::INTEGER
        + (NULLIF(btrim(p.phone), '') IS NOT NULL)::INTEGER
        + (NULLIF(btrim(p.bio), '') IS NOT NULL)::INTEGER
        + (p.survey_completed IS TRUE)::INTEGER) >= 6
  ) THEN RAISE EXCEPTION 'VERIFICATION_PROFILE_INCOMPLETE'; END IF;
  IF _approve AND COALESCE(array_length(frames, 1), 0) NOT IN (1, 3) THEN
    RAISE EXCEPTION 'VERIFICATION_SELFIE_REQUIRED';
  END IF;

  UPDATE public.creator_profiles
  SET verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      is_verified_blue = _approve
  WHERE id = _user_id;
  UPDATE public.profiles
  SET verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      is_verified = _approve,
      updated_at = now()
  WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;

  INSERT INTO public.notifications (user_id, title, body)
  VALUES (_user_id,
    CASE WHEN _approve THEN 'Verificación aprobada' ELSE 'Verificación rechazada' END,
    CASE WHEN _approve THEN 'Tu verificación fue aprobada. Ya tienes la insignia azul.'
      ELSE 'Tu solicitud fue rechazada. Puedes actualizar tu perfil y volver a solicitarla.' END);
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_review_verification(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_review_verification(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_review_face_verification_video(_request UUID, _approve BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE submission public.cupido_face_verification_videos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL
     OR (lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
         AND NOT public.has_role(auth.uid(), 'admin')
         AND NOT public.has_role(auth.uid(), 'admin_supremo')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _request IS NULL OR _approve IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  SELECT * INTO submission
  FROM public.cupido_face_verification_videos
  WHERE id = _request AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFICATION_NOT_PENDING'; END IF;

  UPDATE public.creator_profiles
  SET verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      is_verified_blue = _approve
  WHERE id = submission.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  UPDATE public.profiles
  SET verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      is_verified = _approve,
      updated_at = now()
  WHERE id = submission.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  UPDATE public.cupido_face_verification_videos
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = _request;

  INSERT INTO public.notifications (user_id, title, body, kind, target_id, action_url)
  VALUES (
    submission.user_id,
    CASE WHEN _approve THEN 'Insignia azul habilitada' ELSE 'Solicitud de insignia rechazada' END,
    CASE WHEN _approve THEN 'El Administrador Oficial aprobó tu video. Tu insignia azul ya está activa.'
      ELSE 'El Administrador Oficial revisó tu video y rechazó la solicitud. Puedes enviar otro video desde tu perfil.' END,
    'verification', submission.id, '/perfil'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_review_face_verification_video(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_review_face_verification_video(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
