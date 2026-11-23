ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS theme_preset TEXT NOT NULL DEFAULT 'cafe'
  CHECK (theme_preset IN ('cafe', 'dark', 'rosa', 'neon'));

CREATE OR REPLACE FUNCTION public.cupido_count_followers(_following UUID)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::BIGINT
  FROM public.follows AS f
  JOIN public.creator_profiles AS follower ON follower.id = f.follower_id
  WHERE f.following_id = _following
    AND follower.is_cupido_active = TRUE;
$$;

CREATE OR REPLACE FUNCTION public.cupido_count_followers_batch(_following UUID[])
RETURNS TABLE(following_id UUID, follower_count BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT requested.following_id, count(follower.id)::BIGINT
  FROM unnest(_following) AS requested(following_id)
  LEFT JOIN public.follows AS f ON f.following_id = requested.following_id
  LEFT JOIN public.creator_profiles AS follower
    ON follower.id = f.follower_id AND follower.is_cupido_active = TRUE
  GROUP BY requested.following_id;
$$;

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
  SELECT COALESCE(cp.is_official, FALSE) OR lower(COALESCE(p.email, '')) = 'leudyfeliz81@gmail.com',
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

GRANT EXECUTE ON FUNCTION public.cupido_count_followers(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_count_followers_batch(UUID[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_list_followers(UUID) TO anon, authenticated;

-- Keep ordinary verification requirements while allowing the protected
-- server-side admin action to grant or remove a badge directly.
CREATE OR REPLACE FUNCTION public.cupido_enforce_verified_badge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  official_account BOOLEAN := FALSE;
  privileged_service BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
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
     AND NEW.verification_status = 'approved' THEN
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

CREATE OR REPLACE FUNCTION public.sync_follower_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target UUID;
  total BIGINT;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.following_id ELSE NEW.following_id END;
  SELECT count(*)::BIGINT INTO total
  FROM public.follows AS f
  JOIN public.creator_profiles AS follower ON follower.id = f.follower_id
  WHERE f.following_id = target AND follower.is_cupido_active = TRUE;

  UPDATE public.creator_profiles SET follower_count = total::INTEGER WHERE id = target;
  INSERT INTO public.cupido_follower_count_events (user_id, follower_count, updated_at)
  VALUES (target, total, now())
  ON CONFLICT (user_id) DO UPDATE
    SET follower_count = EXCLUDED.follower_count, updated_at = now();

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_refresh_count_when_follower_activates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target UUID := NEW.id;
  total BIGINT;
BEGIN
  SELECT count(*)::BIGINT INTO total
  FROM public.follows AS f
  JOIN public.creator_profiles AS follower ON follower.id = f.follower_id AND follower.is_cupido_active = TRUE
  WHERE f.following_id = target;
  UPDATE public.creator_profiles SET follower_count = total::INTEGER WHERE id = target;
  INSERT INTO public.cupido_follower_count_events (user_id, follower_count, updated_at)
  VALUES (target, total, now())
  ON CONFLICT (user_id) DO UPDATE
    SET follower_count = EXCLUDED.follower_count, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_refresh_active_follower_count ON public.creator_profiles;
CREATE TRIGGER cupido_refresh_active_follower_count
AFTER INSERT OR UPDATE OF is_cupido_active ON public.creator_profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_refresh_count_when_follower_activates();

ALTER TABLE public.cupido_live_rooms
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.live_streams
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.cupido_sync_live_stream()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target UUID;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.live_streams WHERE id = target;
    RETURN OLD;
  END IF;
  INSERT INTO public.live_streams (id, host_id, title, status, viewers_count, started_at, ended_at, last_heartbeat_at)
  VALUES (
    NEW.id, NEW.host_id, NEW.title,
    CASE WHEN NEW.is_live THEN 'live' ELSE 'ended' END,
    GREATEST(0, NEW.viewer_count), NEW.created_at, NEW.ended_at, NEW.last_heartbeat_at
  )
  ON CONFLICT (id) DO UPDATE SET
    host_id = EXCLUDED.host_id,
    title = EXCLUDED.title,
    status = EXCLUDED.status,
    viewers_count = EXCLUDED.viewers_count,
    ended_at = EXCLUDED.ended_at,
    last_heartbeat_at = EXCLUDED.last_heartbeat_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_live_stream_sync ON public.cupido_live_rooms;
CREATE TRIGGER cupido_live_stream_sync
AFTER INSERT OR UPDATE OF is_live, viewer_count, title, ended_at, last_heartbeat_at OR DELETE
ON public.cupido_live_rooms
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_live_stream();

CREATE OR REPLACE FUNCTION public.cupido_live_heartbeat(_room UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.cupido_live_rooms
  SET last_heartbeat_at = now()
  WHERE id = _room AND host_id = auth.uid() AND is_live = TRUE;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_end_stale_lives()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ended_count INTEGER;
BEGIN
  UPDATE public.cupido_live_rooms
  SET is_live = FALSE, ended_at = now()
  WHERE is_live = TRUE AND last_heartbeat_at < now() - INTERVAL '45 seconds';
  GET DIAGNOSTICS ended_count = ROW_COUNT;
  RETURN ended_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_live_heartbeat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_end_stale_lives() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_follow_new_profile_from_official()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE official_id UUID;
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'leudyfeliz81@gmail.com' THEN RETURN NEW; END IF;
  SELECT id INTO official_id
  FROM public.profiles
  WHERE lower(email) = 'leudyfeliz81@gmail.com'
  ORDER BY created_at ASC
  LIMIT 1;
  IF official_id IS NULL OR official_id = NEW.id THEN RETURN NEW; END IF;
  INSERT INTO public.follows (follower_id, following_id)
  VALUES (official_id, NEW.id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_official_follows_each_new_profile ON public.profiles;
CREATE TRIGGER cupido_official_follows_each_new_profile
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_follow_new_profile_from_official();
