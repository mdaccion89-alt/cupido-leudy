BEGIN;

CREATE TABLE IF NOT EXISTS public.cupido_saved_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS cupido_saved_posts_user_created_idx
  ON public.cupido_saved_posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_saved_posts_post_idx
  ON public.cupido_saved_posts (post_id);

ALTER TABLE public.cupido_saved_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cupido saved posts owner read" ON public.cupido_saved_posts;
CREATE POLICY "cupido saved posts owner read" ON public.cupido_saved_posts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cupido saved posts owner insert" ON public.cupido_saved_posts;
CREATE POLICY "cupido saved posts owner insert" ON public.cupido_saved_posts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "cupido saved posts owner delete" ON public.cupido_saved_posts;
CREATE POLICY "cupido saved posts owner delete" ON public.cupido_saved_posts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON public.cupido_saved_posts TO authenticated;

INSERT INTO public.cupido_saved_posts (user_id, post_id, created_at)
SELECT user_id, post_id, created_at FROM public.cupido_post_saves
ON CONFLICT (user_id, post_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cupido_mirror_saved_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_post UUID;
  target_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post := OLD.post_id;
    target_user := OLD.user_id;
    DELETE FROM public.cupido_post_saves WHERE post_id = target_post AND user_id = target_user;
    RETURN OLD;
  END IF;
  target_post := NEW.post_id;
  target_user := NEW.user_id;
  INSERT INTO public.cupido_post_saves (post_id, user_id)
  VALUES (target_post, target_user)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_mirror_saved_post ON public.cupido_saved_posts;
CREATE TRIGGER cupido_mirror_saved_post
  AFTER INSERT OR DELETE ON public.cupido_saved_posts
  FOR EACH ROW EXECUTE FUNCTION public.cupido_mirror_saved_post();

CREATE OR REPLACE FUNCTION public.cupido_mirror_post_save()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_post UUID;
  target_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post := OLD.post_id;
    target_user := OLD.user_id;
    DELETE FROM public.cupido_saved_posts WHERE post_id = target_post AND user_id = target_user;
    RETURN OLD;
  END IF;
  target_post := NEW.post_id;
  target_user := NEW.user_id;
  INSERT INTO public.cupido_saved_posts (post_id, user_id)
  VALUES (target_post, target_user)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_mirror_post_save ON public.cupido_post_saves;
CREATE TRIGGER cupido_mirror_post_save
  AFTER INSERT OR DELETE ON public.cupido_post_saves
  FOR EACH ROW EXECUTE FUNCTION public.cupido_mirror_post_save();

CREATE OR REPLACE FUNCTION public.cupido_toggle_post_save(_post UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_id UUID := auth.uid();
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  DELETE FROM public.cupido_saved_posts WHERE post_id = _post AND user_id = current_id;
  IF FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.cupido_saved_posts (post_id, user_id) VALUES (_post, current_id)
  ON CONFLICT DO NOTHING;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_toggle_post_save(UUID) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_saved_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_saved_posts;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
