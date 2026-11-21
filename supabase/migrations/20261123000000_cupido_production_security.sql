-- Production safeguards for profile privacy, verified badges, real post metrics and branding.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hide_followers BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hide_followers BOOLEAN NOT NULL DEFAULT FALSE,
  ALTER COLUMN is_verified_blue SET DEFAULT FALSE;

UPDATE public.creator_profiles AS cp
SET full_name = COALESCE(NULLIF(p.full_name, ''), cp.full_name),
    display_name = COALESCE(NULLIF(p.display_name, ''), cp.display_name)
FROM public.profiles AS p
WHERE p.id = cp.id;

GRANT UPDATE (hide_followers) ON public.profiles TO authenticated;
GRANT UPDATE (hide_followers) ON public.creator_profiles TO authenticated;
GRANT UPDATE (display_name, full_name) ON public.creator_profiles TO authenticated;

ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.creator_profiles TO authenticated;
DROP POLICY IF EXISTS "cupido creator profiles owner read" ON public.creator_profiles;
CREATE POLICY "cupido creator profiles owner read" ON public.creator_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin') OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com');
DROP POLICY IF EXISTS "cupido creator profiles private read guard" ON public.creator_profiles;
CREATE POLICY "cupido creator profiles private read guard" ON public.creator_profiles
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin') OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com');
DROP POLICY IF EXISTS "cupido creator profiles own update" ON public.creator_profiles;
CREATE POLICY "cupido creator profiles own update" ON public.creator_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin') OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com')
  WITH CHECK (auth.uid() = id OR public.has_role(auth.uid(), 'admin') OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com');
DROP POLICY IF EXISTS "cupido creator profiles update guard" ON public.creator_profiles;
CREATE POLICY "cupido creator profiles update guard" ON public.creator_profiles
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin') OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com')
  WITH CHECK (auth.uid() = id OR public.has_role(auth.uid(), 'admin') OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com');

CREATE OR REPLACE FUNCTION public.cupido_sync_hide_followers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'profiles' THEN
    UPDATE public.creator_profiles SET hide_followers = NEW.hide_followers WHERE id = NEW.id;
  ELSE
    UPDATE public.profiles SET hide_followers = NEW.hide_followers WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_sync_hide_followers_from_profile ON public.profiles;
CREATE TRIGGER cupido_sync_hide_followers_from_profile
AFTER UPDATE OF hide_followers ON public.profiles
FOR EACH ROW WHEN (OLD.hide_followers IS DISTINCT FROM NEW.hide_followers)
EXECUTE FUNCTION public.cupido_sync_hide_followers();

DROP TRIGGER IF EXISTS cupido_sync_hide_followers_from_creator ON public.creator_profiles;
CREATE TRIGGER cupido_sync_hide_followers_from_creator
AFTER UPDATE OF hide_followers ON public.creator_profiles
FOR EACH ROW WHEN (OLD.hide_followers IS DISTINCT FROM NEW.hide_followers)
EXECUTE FUNCTION public.cupido_sync_hide_followers();

ALTER TABLE public.cupido_posts
  ADD COLUMN IF NOT EXISTS dislikes_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saves_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_count BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.cupido_post_likes (
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.cupido_post_dislikes (
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.cupido_post_saves (
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.cupido_post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cupido_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_post_dislikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_post_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cupido post likes public read" ON public.cupido_post_likes;
CREATE POLICY "cupido post likes public read" ON public.cupido_post_likes
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "cupido post likes own insert" ON public.cupido_post_likes;
CREATE POLICY "cupido post likes own insert" ON public.cupido_post_likes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido post likes own delete" ON public.cupido_post_likes;
CREATE POLICY "cupido post likes own delete" ON public.cupido_post_likes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cupido post dislikes public read" ON public.cupido_post_dislikes;
CREATE POLICY "cupido post dislikes public read" ON public.cupido_post_dislikes
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "cupido post dislikes own insert" ON public.cupido_post_dislikes;
CREATE POLICY "cupido post dislikes own insert" ON public.cupido_post_dislikes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido post dislikes own delete" ON public.cupido_post_dislikes;
CREATE POLICY "cupido post dislikes own delete" ON public.cupido_post_dislikes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cupido post saves owner read" ON public.cupido_post_saves;
CREATE POLICY "cupido post saves owner read" ON public.cupido_post_saves
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido post saves own insert" ON public.cupido_post_saves;
CREATE POLICY "cupido post saves own insert" ON public.cupido_post_saves
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido post saves own delete" ON public.cupido_post_saves;
CREATE POLICY "cupido post saves own delete" ON public.cupido_post_saves
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cupido post comments public read" ON public.cupido_post_comments;
CREATE POLICY "cupido post comments public read" ON public.cupido_post_comments
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "cupido post comments own insert" ON public.cupido_post_comments;
CREATE POLICY "cupido post comments own insert" ON public.cupido_post_comments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido post comments own delete" ON public.cupido_post_comments;
CREATE POLICY "cupido post comments own delete" ON public.cupido_post_comments
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT ON public.cupido_post_likes, public.cupido_post_dislikes, public.cupido_post_comments TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.cupido_post_likes, public.cupido_post_dislikes, public.cupido_post_saves, public.cupido_post_comments TO authenticated;
CREATE OR REPLACE FUNCTION public.cupido_sync_post_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE counter_column TEXT;
BEGIN
  counter_column := CASE TG_TABLE_NAME
    WHEN 'cupido_post_likes' THEN 'likes_count'
    WHEN 'cupido_post_dislikes' THEN 'dislikes_count'
    WHEN 'cupido_post_saves' THEN 'saves_count'
    ELSE 'comments_count'
  END;
  IF TG_OP = 'INSERT' THEN
    EXECUTE format('UPDATE public.cupido_posts SET %I = %I + 1 WHERE id = $1', counter_column, counter_column) USING NEW.post_id;
    RETURN NEW;
  END IF;
  EXECUTE format('UPDATE public.cupido_posts SET %I = GREATEST(0, %I - 1) WHERE id = $1', counter_column, counter_column) USING OLD.post_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cupido_count_post_likes ON public.cupido_post_likes;
CREATE TRIGGER cupido_count_post_likes AFTER INSERT OR DELETE ON public.cupido_post_likes
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_post_counter();
DROP TRIGGER IF EXISTS cupido_count_post_dislikes ON public.cupido_post_dislikes;
CREATE TRIGGER cupido_count_post_dislikes AFTER INSERT OR DELETE ON public.cupido_post_dislikes
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_post_counter();
DROP TRIGGER IF EXISTS cupido_count_post_saves ON public.cupido_post_saves;
CREATE TRIGGER cupido_count_post_saves AFTER INSERT OR DELETE ON public.cupido_post_saves
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_post_counter();
DROP TRIGGER IF EXISTS cupido_count_post_comments ON public.cupido_post_comments;
CREATE TRIGGER cupido_count_post_comments AFTER INSERT OR DELETE ON public.cupido_post_comments
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_post_counter();

UPDATE public.cupido_posts AS p SET
  likes_count = (SELECT count(*) FROM public.cupido_post_likes AS x WHERE x.post_id = p.id),
  dislikes_count = (SELECT count(*) FROM public.cupido_post_dislikes AS x WHERE x.post_id = p.id),
  comments_count = (SELECT count(*) FROM public.cupido_post_comments AS x WHERE x.post_id = p.id),
  saves_count = (SELECT count(*) FROM public.cupido_post_saves AS x WHERE x.post_id = p.id);

CREATE OR REPLACE FUNCTION public.cupido_toggle_post_like(_post UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_id UUID := auth.uid();
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  DELETE FROM public.cupido_post_likes WHERE post_id = _post AND user_id = current_id;
  IF FOUND THEN RETURN FALSE; END IF;
  DELETE FROM public.cupido_post_dislikes WHERE post_id = _post AND user_id = current_id;
  INSERT INTO public.cupido_post_likes (post_id, user_id) VALUES (_post, current_id) ON CONFLICT DO NOTHING;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_toggle_post_dislike(_post UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_id UUID := auth.uid();
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  DELETE FROM public.cupido_post_dislikes WHERE post_id = _post AND user_id = current_id;
  IF FOUND THEN RETURN FALSE; END IF;
  DELETE FROM public.cupido_post_likes WHERE post_id = _post AND user_id = current_id;
  INSERT INTO public.cupido_post_dislikes (post_id, user_id) VALUES (_post, current_id) ON CONFLICT DO NOTHING;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_toggle_post_save(_post UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_id UUID := auth.uid();
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  DELETE FROM public.cupido_post_saves WHERE post_id = _post AND user_id = current_id;
  IF FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.cupido_post_saves (post_id, user_id) VALUES (_post, current_id) ON CONFLICT DO NOTHING;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_toggle_post_like(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_toggle_post_dislike(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_toggle_post_save(UUID) TO authenticated;

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cupido private follower lists guard" ON public.follows;
CREATE POLICY "cupido private follower lists guard" ON public.follows
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    NOT EXISTS (
      SELECT 1
      FROM public.creator_profiles AS cp
      LEFT JOIN public.profiles AS p ON p.id = cp.id
      WHERE cp.id IN (follows.follower_id, follows.following_id)
        AND (cp.is_official OR lower(COALESCE(p.email, '')) = 'leudyfeliz81@gmail.com')
    )
    AND (
      public.has_role(auth.uid(), 'admin')
      OR follower_id = auth.uid()
      OR following_id = auth.uid()
      OR NOT EXISTS (
        SELECT 1 FROM public.creator_profiles AS cp
        LEFT JOIN public.profiles AS p ON p.id = cp.id
        WHERE cp.id = follows.following_id
          AND (COALESCE(cp.hide_followers, FALSE) OR COALESCE(p.hide_followers, FALSE))
      )
    )
  );

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS app_logo_url TEXT NOT NULL DEFAULT '';

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cupido public site settings read" ON public.site_settings;
CREATE POLICY "cupido public site settings read" ON public.site_settings
  FOR SELECT TO anon, authenticated USING (id = 1);
DROP POLICY IF EXISTS "cupido public site settings guard" ON public.site_settings;
CREATE POLICY "cupido public site settings guard" ON public.site_settings
  AS RESTRICTIVE FOR SELECT TO anon, authenticated USING (id = 1);
GRANT SELECT ON public.site_settings TO anon, authenticated;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS app_logo_url TEXT NOT NULL DEFAULT '';

UPDATE public.site_settings
SET app_logo_url = COALESCE(NULLIF(app_logo_url, ''), logo_url, '')
WHERE app_logo_url = '';

CREATE OR REPLACE FUNCTION public.cupido_sync_app_logo_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.app_logo_url := COALESCE(NULLIF(NEW.app_logo_url, ''), NEW.logo_url, '');
    NEW.logo_url := COALESCE(NULLIF(NEW.logo_url, ''), NEW.app_logo_url, '');
  ELSIF NEW.logo_url IS DISTINCT FROM OLD.logo_url
        AND NEW.app_logo_url IS NOT DISTINCT FROM OLD.app_logo_url THEN
    NEW.app_logo_url := NEW.logo_url;
  ELSIF NEW.app_logo_url IS DISTINCT FROM OLD.app_logo_url
        AND NEW.logo_url IS NOT DISTINCT FROM OLD.logo_url THEN
    NEW.logo_url := NEW.app_logo_url;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_sync_app_logo_url ON public.site_settings;
CREATE TRIGGER cupido_sync_app_logo_url
BEFORE INSERT OR UPDATE OF logo_url, app_logo_url ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_app_logo_url();

-- Keep legacy approved accounts only when they are the official account.
UPDATE public.creator_profiles AS cp
SET is_verified_blue = (
  (cp.verification_status = 'approved' AND COALESCE(array_length(cp.verification_frames, 1), 0) = 3
   AND EXISTS (
     SELECT 1 FROM public.profiles AS p
     WHERE p.id = cp.id
       AND COALESCE(NULLIF(p.avatar_url, ''), '') <> ''
       AND NULLIF(btrim(p.full_name), '') IS NOT NULL
       AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years'
       AND NULLIF(btrim(p.country_code), '') IS NOT NULL
       AND NULLIF(btrim(p.phone), '') IS NOT NULL
       AND NULLIF(btrim(p.bio), '') IS NOT NULL
       AND p.survey_completed IS TRUE
   ))
  OR EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = cp.id AND lower(p.email) = 'leudyfeliz81@gmail.com'
  )
),
verification_status = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = cp.id AND lower(p.email) = 'leudyfeliz81@gmail.com'
  ) THEN 'approved'
  WHEN cp.verification_status = 'approved' AND (
    COALESCE(array_length(cp.verification_frames, 1), 0) <> 3
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = cp.id
        AND COALESCE(NULLIF(p.avatar_url, ''), '') <> ''
        AND NULLIF(btrim(p.full_name), '') IS NOT NULL
        AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years'
        AND NULLIF(btrim(p.country_code), '') IS NOT NULL
        AND NULLIF(btrim(p.phone), '') IS NOT NULL
        AND NULLIF(btrim(p.bio), '') IS NOT NULL
        AND p.survey_completed IS TRUE
    )
  ) THEN 'none'
  ELSE cp.verification_status
END;

CREATE OR REPLACE FUNCTION public.cupido_enforce_verified_badge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  official_account BOOLEAN := FALSE;
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

  IF NEW.is_verified_blue AND NOT official_account AND NEW.verification_status = 'approved' THEN
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

DROP TRIGGER IF EXISTS cupido_enforce_verified_badge ON public.creator_profiles;
CREATE TRIGGER cupido_enforce_verified_badge
BEFORE INSERT OR UPDATE ON public.creator_profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_enforce_verified_badge();

CREATE OR REPLACE FUNCTION public.cupido_submit_live_verification(_frames TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_id UUID := auth.uid();
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF COALESCE(array_length(_frames, 1), 0) <> 3
     OR EXISTS (SELECT 1 FROM unnest(_frames) AS frame WHERE frame IS NULL OR btrim(frame) = '' OR frame NOT LIKE current_id::TEXT || '/verification/%') THEN
    RAISE EXCEPTION 'THREE_LIVE_POSES_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = current_id
      AND COALESCE(NULLIF(p.avatar_url, ''), '') <> ''
      AND NULLIF(btrim(p.full_name), '') IS NOT NULL
      AND p.birth_date IS NOT NULL
      AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years'
      AND NULLIF(btrim(p.country_code), '') IS NOT NULL
      AND NULLIF(btrim(p.phone), '') IS NOT NULL
      AND NULLIF(btrim(p.bio), '') IS NOT NULL
      AND p.survey_completed IS TRUE
  ) THEN RAISE EXCEPTION 'VERIFICATION_PROFILE_INCOMPLETE'; END IF;

  UPDATE public.creator_profiles
  SET verification_frames = _frames,
      selfie_path = _frames[1],
      verification_status = 'pending',
      is_verified_blue = FALSE
  WHERE id = current_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_review_verification(_user_id UUID, _approve BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  frames TEXT[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT verification_frames INTO frames
  FROM public.creator_profiles
  WHERE id = _user_id AND verification_status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFICATION_NOT_PENDING'; END IF;

  IF _approve AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = _user_id
      AND COALESCE(NULLIF(p.avatar_url, ''), '') <> ''
      AND NULLIF(btrim(p.full_name), '') IS NOT NULL
      AND p.birth_date IS NOT NULL
      AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years'
      AND NULLIF(btrim(p.country_code), '') IS NOT NULL
      AND NULLIF(btrim(p.phone), '') IS NOT NULL
      AND NULLIF(btrim(p.bio), '') IS NOT NULL
      AND p.survey_completed IS TRUE
  ) THEN RAISE EXCEPTION 'VERIFICATION_PROFILE_INCOMPLETE'; END IF;
  IF _approve AND COALESCE(array_length(frames, 1), 0) <> 3 THEN RAISE EXCEPTION 'THREE_LIVE_POSES_REQUIRED'; END IF;

  UPDATE public.creator_profiles
  SET verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      is_verified_blue = _approve
  WHERE id = _user_id;

  INSERT INTO public.notifications (user_id, title, body)
  VALUES (
    _user_id,
    CASE WHEN _approve THEN 'Verificación aprobada' ELSE 'Verificación rechazada' END,
    CASE WHEN _approve THEN 'Tu verificación fue aprobada. Ya tienes la insignia azul.'
      ELSE 'Tu solicitud de verificación fue rechazada. Puedes actualizar tu perfil y volver a solicitarla.' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_submit_live_verification(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_review_verification(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_list_followers(_following UUID)
RETURNS TABLE(follower_id UUID, display_name TEXT, avatar_url TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  official BOOLEAN := FALSE;
  hidden BOOLEAN := FALSE;
BEGIN
  SELECT
    COALESCE(cp.is_official, FALSE) OR lower(COALESCE(p.email, '')) = 'leudyfeliz81@gmail.com',
    COALESCE(cp.hide_followers, FALSE) OR COALESCE(p.hide_followers, FALSE)
  INTO official, hidden
  FROM public.creator_profiles AS cp
  LEFT JOIN public.profiles AS p ON p.id = cp.id
  WHERE cp.id = _following;

  IF COALESCE(official, FALSE) THEN RAISE EXCEPTION 'OFFICIAL_FOLLOWERS_PRIVATE'; END IF;
  IF COALESCE(hidden, FALSE) AND auth.uid() IS DISTINCT FROM _following
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'FOLLOWERS_PRIVATE';
  END IF;

  RETURN QUERY
  SELECT f.follower_id, COALESCE(cp.display_name, 'Miembro de Cupido'), COALESCE(cp.avatar_url, '')
  FROM public.follows AS f
  JOIN public.creator_profiles AS cp ON cp.id = f.follower_id AND cp.is_cupido_active = TRUE
  WHERE f.following_id = _following
  ORDER BY f.created_at DESC
  LIMIT 200;
END;
$$;

CREATE TABLE IF NOT EXISTS public.cupido_post_metric_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('view', 'share')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, metric)
);

ALTER TABLE public.cupido_post_metric_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cupido post metric events owner read" ON public.cupido_post_metric_events;
CREATE POLICY "cupido post metric events owner read"
ON public.cupido_post_metric_events FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.cupido_register_post_view(_post UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inserted_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  INSERT INTO public.cupido_post_metric_events (post_id, user_id, metric)
  SELECT p.id, auth.uid(), 'view'
  FROM public.cupido_posts AS p
  WHERE p.id = _post AND (p.moderation_status = 'approved' OR p.user_id = auth.uid())
  ON CONFLICT (post_id, user_id, metric) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count > 0 THEN
    UPDATE public.cupido_posts SET views_count = views_count + 1 WHERE id = _post;
  END IF;
  RETURN (SELECT views_count FROM public.cupido_posts WHERE id = _post);
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_register_post_share(_post UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inserted_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  INSERT INTO public.cupido_post_metric_events (post_id, user_id, metric)
  SELECT p.id, auth.uid(), 'share'
  FROM public.cupido_posts AS p
  WHERE p.id = _post AND (p.moderation_status = 'approved' OR p.user_id = auth.uid())
  ON CONFLICT (post_id, user_id, metric) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count > 0 THEN
    UPDATE public.cupido_posts SET shares_count = shares_count + 1 WHERE id = _post;
  END IF;
  RETURN (SELECT shares_count FROM public.cupido_posts WHERE id = _post);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_register_post_view(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_register_post_share(UUID) TO authenticated;
GRANT SELECT ON public.cupido_post_metric_events TO authenticated;

CREATE OR REPLACE VIEW public.cupido_public_profiles
WITH (security_barrier = TRUE)
AS
SELECT
  cp.id, cp.display_name, cp.avatar_url, cp.bio, cp.country_code, cp.age, cp.gender,
  cp.looking_for, cp.zodiac, cp.smokes, cp.drinks, cp.has_kids, cp.hobbies,
  cp.survey_completed, cp.is_verified_blue, cp.is_super_admin, cp.is_official,
  cp.is_cupido_active, cp.is_premium, cp.friend_count, cp.follower_count,
  cp.created_at, cp.hide_followers, cp.verification_status
FROM public.creator_profiles AS cp;

GRANT SELECT ON public.cupido_public_profiles TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'creator_profiles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.creator_profiles;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'site_settings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_post_likes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_post_likes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_post_dislikes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_post_dislikes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_post_comments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_post_comments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_post_saves') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_post_saves;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;
