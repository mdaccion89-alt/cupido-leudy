ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS brand_effect TEXT NOT NULL DEFAULT 'diamond';

ALTER TABLE public.cupido_posts
  ADD COLUMN IF NOT EXISTS views_count BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.cupido_admin_set_post_views(
  _post_id UUID,
  _views_count BIGINT
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

  IF _post_id IS NULL OR _views_count IS NULL OR _views_count < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cupido_posts
     SET views_count = _views_count
   WHERE id = _post_id
     AND user_id = auth.uid()
     AND kind = 'video'
   RETURNING views_count INTO saved_views;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VIDEO_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN saved_views;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_admin_set_post_views(UUID, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cupido_admin_set_post_views(UUID, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.cupido_admin_set_post_views(UUID, BIGINT) TO authenticated;

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
