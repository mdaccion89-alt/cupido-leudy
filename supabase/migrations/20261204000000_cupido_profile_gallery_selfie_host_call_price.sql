-- Profile media uses the existing public media bucket. Verification evidence
-- remains private in cupido-private and is reviewed through creator_profiles.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS call_minute_price INTEGER NOT NULL DEFAULT 50;

ALTER TABLE public.creator_profiles
  DROP CONSTRAINT IF EXISTS creator_profiles_call_minute_price_check,
  ADD CONSTRAINT creator_profiles_call_minute_price_check
    CHECK (call_minute_price IN (25, 50, 75, 100, 150, 200));

CREATE OR REPLACE VIEW public.cupido_public_profiles
WITH (security_barrier = TRUE)
AS
SELECT
  cp.id, cp.display_name, cp.avatar_url, cp.bio, cp.country_code, cp.age, cp.gender,
  cp.looking_for, cp.zodiac, cp.smokes, cp.drinks, cp.has_kids, cp.hobbies,
  cp.survey_completed, cp.is_verified_blue, cp.is_super_admin, cp.is_official,
  cp.is_cupido_active, cp.is_premium, cp.friend_count, cp.follower_count,
  cp.created_at, cp.hide_followers, cp.verification_status, cp.interested_count,
  cp.is_gran_liga, cp.call_minute_price
FROM public.creator_profiles AS cp;
GRANT SELECT ON public.cupido_public_profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_my_gift_balance()
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE total NUMERIC(20,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT COALESCE(balance, 0) INTO total FROM public.cupido_balances WHERE user_id = auth.uid();
  RETURN COALESCE(total, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_get_my_gift_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_get_my_gift_balance() TO authenticated;

ALTER TABLE public.cupido_calls
  ADD COLUMN IF NOT EXISTS minute_price INTEGER NOT NULL DEFAULT 50;

UPDATE public.cupido_calls
SET minute_price = CASE WHEN mode = 'hot' THEN 100 ELSE 50 END
WHERE minute_price = 50;

ALTER TABLE public.cupido_calls
  DROP CONSTRAINT IF EXISTS cupido_calls_minute_price_check,
  ADD CONSTRAINT cupido_calls_minute_price_check CHECK (minute_price >= 0);

CREATE OR REPLACE FUNCTION public.cupido_set_live_call_minute_price(_room UUID, _price INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _price IS NULL OR _price NOT IN (25, 50, 75, 100, 150, 200) THEN RAISE EXCEPTION 'INVALID_CALL_PRICE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms
    WHERE id = _room AND host_id = auth.uid() AND is_live IS TRUE
  ) THEN RAISE EXCEPTION 'LIVE_HOST_REQUIRED'; END IF;
  UPDATE public.creator_profiles SET call_minute_price = _price WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  RETURN _price;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_set_live_call_minute_price(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_set_live_call_minute_price(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_start_call(
  _callee UUID,
  _mode TEXT,
  _video BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  cost INTEGER;
  call_id UUID;
  is_infinite_admin BOOLEAN;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _callee IS NULL OR _callee = actor THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;
  IF _mode IS NULL OR _mode NOT IN ('hot', 'cafe') THEN RAISE EXCEPTION 'INVALID_CALL_MODE'; END IF;
  is_infinite_admin := lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com';
  IF NOT is_infinite_admin AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = actor AND p.has_recharged
  ) AND NOT EXISTS (
    SELECT 1 FROM public.paypal_orders o WHERE o.user_id = actor AND o.status = 'captured'
  ) THEN RAISE EXCEPTION 'PURCHASE_REQUIRED'; END IF;
  SELECT COALESCE(cp.call_minute_price, CASE WHEN _mode = 'hot' THEN 100 ELSE 50 END)
  INTO cost FROM public.creator_profiles cp WHERE cp.id = _callee;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;
  IF is_infinite_admin THEN cost := 0;
  ELSE PERFORM public.consume_credits(cost, 'Llamada privada · ' || cost || ' monedas por minuto'); END IF;
  INSERT INTO public.cupido_calls (caller_id, callee_id, mode, video, credits_spent, minute_price)
  VALUES (actor, _callee, _mode, COALESCE(_video, FALSE), cost, cost)
  RETURNING id INTO call_id;
  RETURN call_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_bill_call_minute(_call UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  call_row public.cupido_calls%ROWTYPE;
  minute_cost INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO call_row FROM public.cupido_calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND OR call_row.caller_id <> auth.uid() THEN RAISE EXCEPTION 'CALL_BILLING_FORBIDDEN'; END IF;
  IF call_row.status <> 'active' THEN RETURN FALSE; END IF;
  IF lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
     OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo') THEN RETURN TRUE; END IF;
  minute_cost := COALESCE(call_row.minute_price, CASE WHEN call_row.mode = 'hot' THEN 100 ELSE 50 END);
  BEGIN
    PERFORM public.consume_credits(minute_cost, 'Minuto de llamada Cupido');
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.cupido_calls SET status = 'ended', ended_at = now() WHERE id = _call;
    RETURN FALSE;
  END;
  UPDATE public.cupido_calls SET credits_spent = credits_spent + minute_cost WHERE id = _call;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_bill_call_minute(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_bill_call_minute(UUID) TO authenticated;

-- Eligibility is six of the seven established profile fields. Bio is one
-- optional field; omitting it does not prevent a complete six-field request.
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
  SELECT lower(p.email) = 'leudyfeliz81@gmail.com' INTO official_account
  FROM public.profiles AS p WHERE p.id = NEW.id;
  official_account := COALESCE(official_account, FALSE);

  IF TG_OP = 'UPDATE'
     AND (NEW.is_verified_blue IS DISTINCT FROM OLD.is_verified_blue
          OR NEW.verification_status IS DISTINCT FROM OLD.verification_status)
     AND NOT official_account AND NOT privileged_service AND NOT privileged_admin
     AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'admin_supremo')
     AND NOT (NEW.id = auth.uid() AND NEW.verification_status = 'pending'
              AND COALESCE(array_length(NEW.verification_frames, 1), 0) IN (1, 3)
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
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.id
        AND ((COALESCE(NULLIF(p.avatar_url, ''), NULLIF(NEW.avatar_url, '')) IS NOT NULL)::INTEGER
          + (NULLIF(btrim(p.full_name), '') IS NOT NULL)::INTEGER
          + (p.birth_date IS NOT NULL AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years')::INTEGER
          + (NULLIF(btrim(p.country_code), '') IS NOT NULL)::INTEGER
          + (NULLIF(btrim(p.phone), '') IS NOT NULL)::INTEGER
          + (NULLIF(btrim(p.bio), '') IS NOT NULL)::INTEGER
          + (p.survey_completed IS TRUE)::INTEGER) >= 6
    ) OR COALESCE(array_length(NEW.verification_frames, 1), 0) NOT IN (1, 3) THEN
      IF TG_OP = 'UPDATE' AND OLD.is_verified_blue AND OLD.verification_status = 'approved' AND auth.uid() = NEW.id THEN
        NEW.is_verified_blue := FALSE;
        NEW.verification_status := 'rejected';
      ELSE
        RAISE EXCEPTION 'VERIFICATION_PROFILE_INCOMPLETE';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_enforce_verified_badge ON public.creator_profiles;
CREATE TRIGGER cupido_enforce_verified_badge
BEFORE INSERT OR UPDATE ON public.creator_profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_enforce_verified_badge();

CREATE OR REPLACE FUNCTION public.cupido_submit_face_verification_selfie(_selfie_path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE current_id UUID := auth.uid();
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _selfie_path IS NULL OR _selfie_path !~* ('^' || current_id::TEXT || '/verification/[^/]+\.(jpg|jpeg|png|webp)$') THEN
    RAISE EXCEPTION 'INVALID_VERIFICATION_SELFIE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = current_id
      AND ((COALESCE(NULLIF(p.avatar_url, ''), '') <> '')::INTEGER
        + (NULLIF(btrim(p.full_name), '') IS NOT NULL)::INTEGER
        + (p.birth_date IS NOT NULL AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years')::INTEGER
        + (NULLIF(btrim(p.country_code), '') IS NOT NULL)::INTEGER
        + (NULLIF(btrim(p.phone), '') IS NOT NULL)::INTEGER
        + (NULLIF(btrim(p.bio), '') IS NOT NULL)::INTEGER
        + (p.survey_completed IS TRUE)::INTEGER) >= 6
  ) THEN RAISE EXCEPTION 'VERIFICATION_PROFILE_INCOMPLETE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'cupido-private' AND name = _selfie_path) THEN
    RAISE EXCEPTION 'VERIFICATION_SELFIE_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = current_id AND verification_status = 'pending') THEN
    RAISE EXCEPTION 'VERIFICATION_ALREADY_PENDING';
  END IF;
  UPDATE public.creator_profiles
  SET verification_frames = ARRAY[_selfie_path], selfie_path = _selfie_path,
      verification_status = 'pending', is_verified_blue = FALSE
  WHERE id = current_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_submit_face_verification_selfie(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_submit_face_verification_selfie(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_submit_face_verification_video(_video_path TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE current_id UUID := auth.uid(); request_id UUID;
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _video_path IS NULL OR _video_path !~ ('^' || current_id::TEXT || '/verification/[^/]+\.(webm|mp4)$') THEN
    RAISE EXCEPTION 'INVALID_VERIFICATION_VIDEO';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = current_id
      AND ((COALESCE(NULLIF(p.avatar_url, ''), '') <> '')::INTEGER
        + (NULLIF(btrim(p.full_name), '') IS NOT NULL)::INTEGER
        + (p.birth_date IS NOT NULL AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years')::INTEGER
        + (NULLIF(btrim(p.country_code), '') IS NOT NULL)::INTEGER
        + (NULLIF(btrim(p.phone), '') IS NOT NULL)::INTEGER
        + (NULLIF(btrim(p.bio), '') IS NOT NULL)::INTEGER
        + (p.survey_completed IS TRUE)::INTEGER) >= 6
  ) THEN RAISE EXCEPTION 'VERIFICATION_PROFILE_INCOMPLETE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'cupido-private' AND name = _video_path) THEN
    RAISE EXCEPTION 'VERIFICATION_VIDEO_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_face_verification_videos WHERE user_id = current_id AND status = 'pending') THEN
    RAISE EXCEPTION 'VERIFICATION_ALREADY_PENDING';
  END IF;
  IF EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = current_id AND verification_status = 'pending') THEN
    RAISE EXCEPTION 'VERIFICATION_ALREADY_PENDING';
  END IF;
  INSERT INTO public.cupido_face_verification_videos (user_id, video_path)
  VALUES (current_id, _video_path) RETURNING id INTO request_id;
  UPDATE public.creator_profiles
  SET verification_frames = ARRAY[_video_path, _video_path, _video_path], selfie_path = _video_path,
      verification_status = 'pending', is_verified_blue = FALSE
  WHERE id = current_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_submit_face_verification_video(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_submit_face_verification_video(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_review_verification(_user_id UUID, _approve BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE frames TEXT[];
BEGIN
  IF lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT verification_frames INTO frames FROM public.creator_profiles
  WHERE id = _user_id AND verification_status = 'pending' FOR UPDATE;
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
  IF _approve AND COALESCE(array_length(frames, 1), 0) NOT IN (1, 3) THEN RAISE EXCEPTION 'VERIFICATION_SELFIE_REQUIRED'; END IF;
  UPDATE public.creator_profiles
  SET verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      is_verified_blue = _approve
  WHERE id = _user_id;
  INSERT INTO public.notifications (user_id, title, body)
  VALUES (_user_id,
    CASE WHEN _approve THEN 'Verificación aprobada' ELSE 'Verificación rechazada' END,
    CASE WHEN _approve THEN 'Tu verificación fue aprobada. Ya tienes la insignia azul.'
      ELSE 'Tu solicitud fue rechazada. Puedes actualizar tu perfil y volver a solicitarla.' END);
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_review_verification(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_review_verification(UUID, BOOLEAN) TO authenticated;
