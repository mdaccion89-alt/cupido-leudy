ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS banner_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS banner_image_url TEXT NOT NULL DEFAULT '';

UPDATE public.site_settings
   SET banner_text = COALESCE(banner_text, ''),
       banner_image_url = COALESCE(banner_image_url, '')
 WHERE id = 1;

INSERT INTO public.site_settings (id)
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM public.site_settings WHERE id = 1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cupido public site settings read" ON public.site_settings;
CREATE POLICY "cupido public site settings read" ON public.site_settings
  FOR SELECT TO anon, authenticated USING (id = 1);

DROP POLICY IF EXISTS "cupido public site settings guard" ON public.site_settings;
CREATE POLICY "cupido public site settings guard" ON public.site_settings
  AS RESTRICTIVE FOR SELECT TO anon, authenticated USING (id = 1);

DROP POLICY IF EXISTS "cupido admin authenticated update" ON public.site_settings;
CREATE POLICY "cupido admin authenticated update" ON public.site_settings
  FOR UPDATE TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'leudyfeliz81@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'leudyfeliz81@gmail.com');

GRANT SELECT ON public.site_settings TO anon;
GRANT SELECT, UPDATE ON public.site_settings TO authenticated;

ALTER TABLE public.cupido_live_rooms
  ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS cupido_live_rooms_active_heartbeat_idx
  ON public.cupido_live_rooms (is_live, last_heartbeat_at);

GRANT SELECT ON public.cupido_posts TO anon, authenticated;
GRANT SELECT ON public.cupido_live_rooms TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_end_stale_lives()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ended_count INTEGER;
BEGIN
  UPDATE public.cupido_live_rooms
     SET is_live = false,
         ended_at = COALESCE(ended_at, now())
   WHERE is_live = true
     AND last_heartbeat_at < now() - INTERVAL '35 seconds';
  GET DIAGNOSTICS ended_count = ROW_COUNT;
  RETURN ended_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_end_stale_lives() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupido_end_stale_lives() TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'site_settings'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
