BEGIN;

-- Keep stored profile names authoritative while still syncing other signup metadata.
CREATE OR REPLACE FUNCTION public.cupido_sync_my_profile()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata JSONB;
  profile_name TEXT;
  saved_display_name TEXT;
  saved_creator_name TEXT;
  birthday DATE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT raw_user_meta_data INTO metadata
  FROM auth.users
  WHERE id = auth.uid();
  IF metadata IS NULL THEN RETURN; END IF;

  SELECT NULLIF(btrim(p.display_name), ''),
         NULLIF(btrim(cp.display_name), '')
  INTO saved_display_name, saved_creator_name
  FROM public.profiles p
  LEFT JOIN public.creator_profiles cp ON cp.id = p.id
  WHERE p.id = auth.uid();

  birthday := public.try_date(metadata->>'birth_date');
  IF birthday IS NOT NULL AND birthday > (CURRENT_DATE - INTERVAL '18 years')::date THEN
    RAISE EXCEPTION 'MUST_BE_ADULT';
  END IF;

  profile_name := left(COALESCE(
    saved_display_name,
    saved_creator_name,
    NULLIF(btrim(metadata->>'display_name'), ''),
    NULLIF(btrim(metadata->>'username'), ''),
    NULLIF(btrim(metadata->>'name'), ''),
    NULLIF(btrim(metadata->>'full_name'), ''),
    'Miembro de Cupido'
  ), 60);

  UPDATE public.profiles
  SET display_name = COALESCE(NULLIF(btrim(display_name), ''), profile_name),
      full_name = COALESCE(
        NULLIF(btrim(full_name), ''),
        NULLIF(btrim(metadata->>'full_name'), ''),
        NULLIF(btrim(metadata->>'name'), ''),
        profile_name
      ),
      birth_date = COALESCE(birthday, birth_date),
      age = CASE WHEN birthday IS NULL THEN age ELSE date_part('year', age(CURRENT_DATE, birthday))::integer END,
      phone = COALESCE(NULLIF(metadata->>'phone', ''), phone),
      country_code = COALESCE(NULLIF(metadata->>'country_code', ''), country_code),
      looking_for = COALESCE(NULLIF(metadata->>'looking_for', ''), looking_for),
      zodiac = COALESCE(NULLIF(metadata->>'zodiac', ''), zodiac),
      smokes = COALESCE((metadata->>'smokes')::boolean, smokes),
      drinks = COALESCE((metadata->>'drinks')::boolean, drinks),
      has_kids = COALESCE((metadata->>'has_kids')::boolean, has_kids),
      hobbies = COALESCE(NULLIF(metadata->>'hobbies', ''), hobbies),
      survey_completed = COALESCE((metadata->>'survey_completed')::boolean, survey_completed),
      updated_at = now()
  WHERE id = auth.uid();

  UPDATE public.creator_profiles
  SET display_name = profile_name,
      age = CASE WHEN birthday IS NULL THEN age ELSE date_part('year', age(CURRENT_DATE, birthday))::integer END,
      country_code = COALESCE(NULLIF(metadata->>'country_code', ''), country_code),
      looking_for = COALESCE(NULLIF(metadata->>'looking_for', ''), looking_for),
      zodiac = COALESCE(NULLIF(metadata->>'zodiac', ''), zodiac),
      smokes = COALESCE((metadata->>'smokes')::boolean, smokes),
      drinks = COALESCE((metadata->>'drinks')::boolean, drinks),
      has_kids = COALESCE((metadata->>'has_kids')::boolean, has_kids),
      hobbies = COALESCE(NULLIF(metadata->>'hobbies', ''), hobbies),
      survey_completed = COALESCE((metadata->>'survey_completed')::boolean, survey_completed)
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_sync_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_sync_my_profile() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
