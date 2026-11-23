-- Editing ordinary profile fields must not be blocked by the badge completeness
-- check. Keep new verification approvals gated, and revoke an existing badge
-- when its owner edits their profile into an incomplete state.
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
      IF TG_OP = 'UPDATE'
         AND OLD.is_verified_blue
         AND OLD.verification_status = 'approved'
         AND auth.uid() = NEW.id THEN
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
