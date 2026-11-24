-- Keep the badge projection and all selfie verification requests in sync when
-- the official administrator grants a user's blue badge.
CREATE OR REPLACE FUNCTION public.cupido_admin_set_user_verified(_user_id UUID, _verified BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL OR _verified IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  UPDATE public.creator_profiles
  SET is_verified_blue = _verified,
      verification_status = CASE WHEN _verified THEN 'approved' ELSE 'rejected' END
  WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  UPDATE public.profiles
  SET is_verified = _verified,
      verification_status = CASE WHEN _verified THEN 'approved' ELSE 'rejected' END,
      updated_at = now()
  WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;

  IF _verified THEN
    UPDATE public.cupido_face_verification_videos
    SET status = 'approved',
        reviewed_at = COALESCE(reviewed_at, now()),
        reviewed_by = auth.uid()
    WHERE user_id = _user_id
      AND status IS DISTINCT FROM 'approved';
  END IF;

  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id, action_url)
  VALUES (
    _user_id,
    CASE WHEN _verified THEN 'Insignia azul activada' ELSE 'Insignia azul retirada' END,
    CASE WHEN _verified THEN 'El Administrador Oficial activo tu insignia azul.'
      ELSE 'El Administrador Oficial retiro tu insignia azul.' END,
    'verification', auth.uid(), _user_id, '/perfil'
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_admin_set_user_verified(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_admin_set_user_verified(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
