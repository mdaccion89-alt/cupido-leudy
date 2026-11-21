-- Public profiles are exposed through a safe projection; contact and account fields stay private.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS zodiac TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS smokes BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hobbies TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS survey_completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS zodiac TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS smokes BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hobbies TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS survey_completed BOOLEAN NOT NULL DEFAULT FALSE;

GRANT UPDATE (display_name, bio, avatar_url, country_code, looking_for, drinks, has_kids, age, gender, zodiac, smokes, hobbies, survey_completed)
  ON public.creator_profiles TO authenticated;

ALTER TABLE public.cupido_posts
  ALTER COLUMN media_path DROP NOT NULL;

DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.cupido_posts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.cupido_posts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.cupido_posts
  ADD CONSTRAINT cupido_posts_kind_check CHECK (kind IN ('photo', 'video', 'text'));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cupido profiles owner read" ON public.profiles;
CREATE POLICY "cupido profiles owner read" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "cupido profiles private guard" ON public.profiles;
CREATE POLICY "cupido profiles private guard" ON public.profiles
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "cupido profiles private insert guard" ON public.profiles;
CREATE POLICY "cupido profiles private insert guard" ON public.profiles
  AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "cupido profiles private update guard" ON public.profiles;
CREATE POLICY "cupido profiles private update guard" ON public.profiles
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "cupido profiles own insert" ON public.profiles;
CREATE POLICY "cupido profiles own insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "cupido profiles own update" ON public.profiles;
CREATE POLICY "cupido profiles own update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "cupido posts read" ON public.cupido_posts;
DROP POLICY IF EXISTS "cupido posts public read" ON public.cupido_posts;
DROP POLICY IF EXISTS "cupido posts own insert guard" ON public.cupido_posts;
CREATE POLICY "cupido posts public read" ON public.cupido_posts
  FOR SELECT TO anon, authenticated
  USING (moderation_status = 'approved' OR user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "cupido posts insert" ON public.cupido_posts;
CREATE POLICY "cupido posts insert" ON public.cupido_posts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cupido posts own insert guard" ON public.cupido_posts
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

GRANT SELECT ON public.cupido_posts TO anon, authenticated;
GRANT INSERT ON public.cupido_posts TO authenticated;

-- This view contains only fields intended for public profiles.
CREATE OR REPLACE VIEW public.cupido_public_profiles
WITH (security_barrier = TRUE)
AS
SELECT
  id,
  display_name,
  avatar_url,
  bio,
  country_code,
  age,
  gender,
  looking_for,
  zodiac,
  smokes,
  drinks,
  has_kids,
  hobbies,
  survey_completed,
  is_verified_blue,
  is_super_admin,
  is_official,
  is_cupido_active,
  is_premium,
  friend_count,
  follower_count,
  created_at
FROM public.creator_profiles;

GRANT SELECT ON public.cupido_public_profiles TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_posts;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_follow_official_after_profile_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  official_id UUID;
  registered_birth_date DATE;
BEGIN
  SELECT public.try_date(u.raw_user_meta_data->>'birth_date')
  INTO registered_birth_date
  FROM auth.users AS u
  WHERE u.id = NEW.id;

  IF registered_birth_date IS NOT NULL
     AND registered_birth_date > (CURRENT_DATE - INTERVAL '18 years')::date THEN
    RAISE EXCEPTION 'MUST_BE_ADULT';
  END IF;

  SELECT p.id INTO official_id
  FROM public.profiles AS p
  WHERE lower(p.email) = 'leudyfeliz81@gmail.com'
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF official_id IS NULL OR official_id = NEW.id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.follows (follower_id, following_id)
  VALUES (official_id, NEW.id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  INSERT INTO public.follows (follower_id, following_id)
  VALUES (NEW.id, official_id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_profiles_auto_follow_official ON public.profiles;
CREATE TRIGGER cupido_profiles_auto_follow_official
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_follow_official_after_profile_insert();

DO $$
DECLARE official_id UUID;
BEGIN
  SELECT id INTO official_id
  FROM public.profiles
  WHERE lower(email) = 'leudyfeliz81@gmail.com'
  ORDER BY created_at ASC
  LIMIT 1;

  IF official_id IS NOT NULL THEN
    INSERT INTO public.follows (follower_id, following_id)
    SELECT official_id, p.id FROM public.profiles AS p WHERE p.id <> official_id
    ON CONFLICT (follower_id, following_id) DO NOTHING;

    INSERT INTO public.follows (follower_id, following_id)
    SELECT p.id, official_id FROM public.profiles AS p WHERE p.id <> official_id
    ON CONFLICT (follower_id, following_id) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_admin_auto_follow()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  official_id UUID;
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN RETURN; END IF;

  IF lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' THEN
    UPDATE public.creator_profiles SET is_super_admin = TRUE, is_official = TRUE
    WHERE id = current_user_id;
  END IF;

  SELECT id INTO official_id
  FROM public.profiles
  WHERE lower(email) = 'leudyfeliz81@gmail.com'
  ORDER BY created_at ASC
  LIMIT 1;

  IF official_id IS NULL OR official_id = current_user_id THEN RETURN; END IF;

  INSERT INTO public.follows (follower_id, following_id)
  VALUES (official_id, current_user_id), (current_user_id, official_id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_admin_auto_follow() TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_sync_my_profile()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata JSONB;
  profile_name TEXT;
  birthday DATE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT raw_user_meta_data INTO metadata
  FROM auth.users
  WHERE id = auth.uid();

  IF metadata IS NULL THEN RETURN; END IF;

  birthday := public.try_date(metadata->>'birth_date');
  IF birthday IS NOT NULL AND birthday > (CURRENT_DATE - INTERVAL '18 years')::date THEN
    RAISE EXCEPTION 'MUST_BE_ADULT';
  END IF;

  profile_name := left(COALESCE(
    NULLIF(metadata->>'display_name', ''),
    NULLIF(metadata->>'full_name', ''),
    'Miembro de Cupido'
  ), 60);

  UPDATE public.profiles
  SET display_name = profile_name,
      full_name = COALESCE(NULLIF(metadata->>'full_name', ''), full_name),
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

GRANT EXECUTE ON FUNCTION public.cupido_sync_my_profile() TO authenticated;
