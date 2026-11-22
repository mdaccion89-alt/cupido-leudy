-- Text status stories, usable by every registered user and visible while active.
ALTER TABLE public.cupido_stories
  ALTER COLUMN media_url DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS background_gradient TEXT NOT NULL DEFAULT 'pink';

ALTER TABLE public.cupido_stories
  DROP CONSTRAINT IF EXISTS cupido_stories_media_type_check,
  ADD CONSTRAINT cupido_stories_media_type_check
    CHECK (media_type IN ('image', 'video', 'text'));

ALTER TABLE public.cupido_stories
  DROP CONSTRAINT IF EXISTS cupido_stories_background_gradient_check,
  ADD CONSTRAINT cupido_stories_background_gradient_check
    CHECK (background_gradient IN ('pink', 'sunset', 'ocean', 'gold'));

ALTER TABLE public.cupido_stories ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cupido_stories'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.cupido_stories', policy_row.policyname);
  END LOOP;
END;
$$;

CREATE POLICY cupido_stories_active_read ON public.cupido_stories
  FOR SELECT TO anon, authenticated USING (expires_at > now());
CREATE POLICY cupido_stories_owner_insert ON public.cupido_stories
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY cupido_stories_owner_delete ON public.cupido_stories
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.cupido_stories TO anon, authenticated;
GRANT INSERT, DELETE ON public.cupido_stories TO authenticated;
