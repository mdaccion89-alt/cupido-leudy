BEGIN;

-- Promotional views are kept separate from real view and watch-time analytics.
ALTER TABLE public.cupido_posts
  ADD COLUMN IF NOT EXISTS boosted_views BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cupido_posts_boosted_views_nonnegative'
      AND conrelid = 'public.cupido_posts'::regclass
  ) THEN
    ALTER TABLE public.cupido_posts
      ADD CONSTRAINT cupido_posts_boosted_views_nonnegative CHECK (boosted_views >= 0);
  END IF;
END;
$$;

-- Only the named administrator can add or set promotional views on any video.
CREATE OR REPLACE FUNCTION public.cupido_admin_adjust_post_boosted_views(
  _post_id UUID,
  _views BIGINT,
  _mode TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_views BIGINT;
BEGIN
  IF auth.uid() IS NULL
     OR lower(COALESCE(auth.jwt() ->> 'email', '')) <> 'leudyfeliz81@gmail.com' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF _post_id IS NULL OR _views IS NULL OR _views < 0 OR _mode IS NULL OR _mode NOT IN ('set', 'add') THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cupido_posts
     SET boosted_views = CASE WHEN _mode = 'add' THEN boosted_views + _views ELSE _views END
   WHERE id = _post_id
     AND kind = 'video'
     AND (_mode <> 'add' OR boosted_views <= 9223372036854775807 - _views)
   RETURNING boosted_views INTO saved_views;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.cupido_posts WHERE id = _post_id AND kind = 'video') THEN
      RAISE EXCEPTION 'BOOSTED_VIEW_COUNT_OVERFLOW' USING ERRCODE = '22003';
    END IF;
    RAISE EXCEPTION 'VIDEO_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN saved_views;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_admin_adjust_post_boosted_views(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_admin_adjust_post_boosted_views(UUID, BIGINT, TEXT) TO authenticated;

-- The legacy control edited real views_count and could therefore affect eligibility.
DO $$
BEGIN
  IF to_regprocedure('public.cupido_admin_set_post_views(uuid,bigint)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.cupido_admin_set_post_views(UUID, BIGINT) FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

-- The client sends host heartbeats every 15 seconds; rooms expire after 35 seconds.
ALTER TABLE public.cupido_live_rooms
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.cupido_end_stale_lives()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ended_count INTEGER;
BEGIN
  UPDATE public.cupido_live_rooms
     SET is_live = FALSE,
         ended_at = COALESCE(ended_at, now())
   WHERE is_live = TRUE
     AND last_heartbeat_at < now() - INTERVAL '35 seconds';
  GET DIAGNOSTICS ended_count = ROW_COUNT;
  RETURN ended_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_end_stale_lives() TO anon, authenticated;

-- Verified users may start a Live from a fresh profile badge projection too.
CREATE OR REPLACE FUNCTION public.cupido_start_live_room(_title TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE room_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.creator_profiles cp
     WHERE cp.id = auth.uid()
       AND (cp.is_verified_blue IS TRUE OR cp.verification_status = 'approved')
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.is_verified IS TRUE OR p.verification_status = 'approved')
  ) AND lower(COALESCE(auth.jwt() ->> 'email', '')) <> 'leudyfeliz81@gmail.com'
    AND NOT public.has_role(auth.uid(), 'admin')
    AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    RAISE EXCEPTION 'NOT_VERIFIED';
  END IF;

  INSERT INTO public.cupido_live_rooms (host_id, title, last_heartbeat_at)
  VALUES (auth.uid(), COALESCE(NULLIF(BTRIM(_title), ''), 'Live de Cupido Leudy ❤️'), now())
  RETURNING id INTO room_id;
  RETURN room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_start_live_room(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_live_room(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_start_premium_live(_title TEXT, _coins INTEGER, _minutes INTEGER)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE room_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _coins NOT IN (150, 300, 500, 1000) THEN RAISE EXCEPTION 'INVALID_LIVE_TIER'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.creator_profiles cp
     WHERE cp.id = auth.uid()
       AND (cp.is_verified_blue IS TRUE OR cp.verification_status = 'approved')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND (p.is_verified IS TRUE OR p.verification_status = 'approved')
  ) AND lower(COALESCE(auth.jwt() ->> 'email', '')) <> 'leudyfeliz81@gmail.com'
    AND NOT public.has_role(auth.uid(), 'admin')
    AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    RAISE EXCEPTION 'NOT_VERIFIED';
  END IF;
  INSERT INTO public.cupido_live_rooms (host_id, title, premium_coins, premium_minutes, premium_ends_at, last_heartbeat_at)
  VALUES (auth.uid(), COALESCE(NULLIF(BTRIM(_title), ''), 'Live Premium'), _coins, 0, NULL, now())
  RETURNING id INTO room_id;
  RETURN room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'cupido_posts'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_posts;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
