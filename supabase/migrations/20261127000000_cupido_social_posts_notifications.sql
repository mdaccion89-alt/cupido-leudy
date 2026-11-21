BEGIN;

ALTER TABLE public.cupido_posts
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shared_post_id UUID REFERENCES public.cupido_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cupido_posts_profile_pinned_created_idx
  ON public.cupido_posts (user_id, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_posts_shared_post_idx
  ON public.cupido_posts (shared_post_id) WHERE shared_post_id IS NOT NULL;

DROP POLICY IF EXISTS "cupido posts update own or supreme" ON public.cupido_posts;
CREATE POLICY "cupido posts update own or supreme" ON public.cupido_posts
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.creator_profiles cp
      WHERE cp.id = auth.uid() AND cp.is_super_admin = TRUE
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.creator_profiles cp
      WHERE cp.id = auth.uid() AND cp.is_super_admin = TRUE
    )
  );

DROP POLICY IF EXISTS "cupido posts delete own or supreme" ON public.cupido_posts;
CREATE POLICY "cupido posts delete own or supreme" ON public.cupido_posts
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.creator_profiles cp
      WHERE cp.id = auth.uid() AND cp.is_super_admin = TRUE
    )
  );

GRANT UPDATE, DELETE ON public.cupido_posts TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_notify_post_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_name TEXT;
  mentioned_id UUID;
BEGIN
  actor_name := public.cupido_actor_handle(NEW.user_id);
  FOR mentioned_id IN
    SELECT DISTINCT (mention_match[2])::UUID
    FROM regexp_matches(
      COALESCE(NEW.caption, ''),
      '@\[([^]]+)\]\(([0-9a-fA-F-]{36})\)',
      'g'
    ) AS mention_match
    WHERE (mention_match[2])::UUID <> NEW.user_id
  LOOP
    PERFORM public.cupido_emit_notification(
      mentioned_id,
      'Te mencionaron en una publicación',
      '@' || actor_name || ' te mencionó en una publicación.',
      'mention', NEW.user_id, NEW.id,
      '/muro?post=' || NEW.id::TEXT
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_notify_post_mentions ON public.cupido_posts;
CREATE TRIGGER cupido_notify_post_mentions
  AFTER INSERT OR UPDATE OF caption ON public.cupido_posts
  FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_post_mentions();

CREATE OR REPLACE FUNCTION public.cupido_notify_comment_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_name TEXT;
  mentioned_id UUID;
BEGIN
  actor_name := public.cupido_actor_handle(NEW.user_id);
  FOR mentioned_id IN
    SELECT DISTINCT (mention_match[2])::UUID
    FROM regexp_matches(
      COALESCE(NEW.body, ''),
      '@\[([^]]+)\]\(([0-9a-fA-F-]{36})\)',
      'g'
    ) AS mention_match
    WHERE (mention_match[2])::UUID <> NEW.user_id
  LOOP
    PERFORM public.cupido_emit_notification(
      mentioned_id,
      'Te mencionaron en un comentario',
      '@' || actor_name || ' te mencionó en un comentario.',
      'mention', NEW.user_id, NEW.post_id,
      '/muro?post=' || NEW.post_id::TEXT
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_notify_comment_mentions ON public.cupido_post_comments;
CREATE TRIGGER cupido_notify_comment_mentions
  AFTER INSERT OR UPDATE OF body ON public.cupido_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_comment_mentions();

NOTIFY pgrst, 'reload schema';

COMMIT;
