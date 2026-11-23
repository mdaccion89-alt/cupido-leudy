CREATE OR REPLACE FUNCTION public.cupido_enforce_verified_badge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  official_account BOOLEAN := FALSE;
  privileged_service BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  privileged_admin BOOLEAN := lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com';
BEGIN
  SELECT lower(p.email) = 'leudyfeliz81@gmail.com'
  INTO official_account
  FROM public.profiles AS p
  WHERE p.id = NEW.id;
  official_account := COALESCE(official_account, FALSE);

  IF TG_OP = 'UPDATE'
     AND (NEW.is_verified_blue IS DISTINCT FROM OLD.is_verified_blue
          OR NEW.verification_status IS DISTINCT FROM OLD.verification_status)
     AND NOT official_account
     AND NOT privileged_service
     AND NOT privileged_admin
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT (NEW.id = auth.uid()
              AND NEW.verification_status = 'pending'
              AND COALESCE(array_length(NEW.verification_frames, 1), 0) = 3
              AND NOT EXISTS (
                SELECT 1 FROM unnest(NEW.verification_frames) AS frame
                WHERE frame IS NULL OR frame NOT LIKE auth.uid()::TEXT || '/verification/%'
              )) THEN
    RAISE EXCEPTION 'VERIFICATION_REQUIRES_ADMIN_APPROVAL';
  END IF;

  IF official_account THEN
    NEW.is_verified_blue := TRUE;
    NEW.verification_status := 'approved';
  ELSIF NEW.is_verified_blue AND NEW.verification_status <> 'approved' THEN
    NEW.is_verified_blue := FALSE;
  END IF;

  IF NEW.is_verified_blue AND NOT official_account AND NOT privileged_service
     AND NOT privileged_admin AND NEW.verification_status = 'approved' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = NEW.id
        AND COALESCE(NULLIF(p.avatar_url, ''), NULLIF(NEW.avatar_url, '')) IS NOT NULL
        AND NULLIF(btrim(p.full_name), '') IS NOT NULL
        AND p.birth_date IS NOT NULL
        AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years'
        AND NULLIF(btrim(p.country_code), '') IS NOT NULL
        AND NULLIF(btrim(p.phone), '') IS NOT NULL
        AND NULLIF(btrim(p.bio), '') IS NOT NULL
        AND p.survey_completed IS TRUE
    ) OR COALESCE(array_length(NEW.verification_frames, 1), 0) <> 3 THEN
      RAISE EXCEPTION 'VERIFICATION_PROFILE_INCOMPLETE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
  IF _user_id IS NULL OR _verified IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  UPDATE public.creator_profiles
  SET is_verified_blue = _verified,
      verification_status = CASE WHEN _verified THEN 'approved' ELSE 'rejected' END
  WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id, action_url)
  VALUES (
    _user_id,
    CASE WHEN _verified THEN 'Insignia azul activada' ELSE 'Insignia azul retirada' END,
    CASE WHEN _verified THEN 'El Administrador Oficial activó tu insignia azul.'
      ELSE 'El Administrador Oficial retiró tu insignia azul.' END,
    'verification', auth.uid(), _user_id, '/perfil'
  );
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_admin_delete_user(_user_id UUID)
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
  IF _user_id IS NULL OR _user_id = auth.uid() THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;

  DELETE FROM auth.users WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_user_id UUID, _delta INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resulting_balance INTEGER;
BEGIN
  IF auth.uid() IS NULL
     OR lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL OR _delta IS NULL OR _delta = 0
     OR _delta > 1000000 OR _delta < -1000000 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  INSERT INTO public.user_credits (user_id, balance, daily_reset_at, updated_at)
  VALUES (_user_id, GREATEST(0, _delta), now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = CASE WHEN public.user_credits.balance = -1 THEN -1
                       ELSE GREATEST(0, public.user_credits.balance + _delta) END,
        updated_at = now()
  RETURNING balance INTO resulting_balance;

  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (_user_id, _delta, 'Ajuste administrativo de monedas');
  RETURN resulting_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_plan(_user_id UUID, _plan TEXT, _days INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL OR _plan IS NULL OR _plan NOT IN ('free', 'pro', 'premium')
     OR _days IS NULL OR _days < 1 OR _days > 3650 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  UPDATE public.profiles
     SET plan = _plan,
         plan_expires_at = CASE WHEN _plan = 'free' THEN NULL
                                ELSE now() + make_interval(days => _days) END,
         updated_at = now()
   WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_admin_set_user_verified(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_admin_delete_user(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_adjust_credits(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_plan(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_admin_set_user_verified(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_admin_delete_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_plan(UUID, TEXT, INTEGER) TO authenticated;
