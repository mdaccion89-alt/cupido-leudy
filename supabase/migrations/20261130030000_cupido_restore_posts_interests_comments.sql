BEGIN;

-- Posts are public content. Preserve the public profile view while keeping the
-- underlying creator_profiles table protected by its owner-only RLS policies.
ALTER TABLE public.cupido_posts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_name TEXT;
BEGIN
  FOR policy_name IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cupido_posts' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.cupido_posts', policy_name);
  END LOOP;
END;
$$;
CREATE POLICY cupido_posts_public_read ON public.cupido_posts
  FOR SELECT TO anon, authenticated USING (TRUE);
GRANT SELECT ON public.cupido_posts TO anon, authenticated;
ALTER VIEW public.cupido_public_profiles SET (security_invoker = FALSE);
GRANT SELECT ON public.cupido_public_profiles TO anon, authenticated;

-- Keep likes writable only through the authenticated, validated RPC.
ALTER TABLE public.cupido_likes ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_name TEXT;
BEGIN
  FOR policy_name IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cupido_likes'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.cupido_likes', policy_name);
  END LOOP;
END;
$$;
CREATE POLICY cupido_likes_participant_read ON public.cupido_likes
  FOR SELECT TO authenticated USING (auth.uid() IN (actor_id, target_id));
REVOKE INSERT, UPDATE, DELETE ON public.cupido_likes FROM anon, authenticated;
GRANT SELECT ON public.cupido_likes TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_set_like(_kind TEXT, _remove BOOLEAN, _target UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _target IS NULL OR _target = actor THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('interested', 'pass', 'like') THEN RAISE EXCEPTION 'INVALID_LIKE_KIND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target) THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF _kind = 'interested' AND EXISTS (
    SELECT 1 FROM public.cupido_likes WHERE actor_id = actor AND target_id = _target AND kind = 'pass'
  ) THEN RAISE EXCEPTION 'PROFILE_ALREADY_PASSED'; END IF;
  IF COALESCE(_remove, FALSE) THEN
    IF _kind = 'pass' THEN RAISE EXCEPTION 'PASS_IS_PERMANENT'; END IF;
    DELETE FROM public.cupido_likes WHERE actor_id = actor AND target_id = _target AND kind = _kind;
    RETURN FOUND;
  END IF;
  IF _kind = 'pass' THEN
    DELETE FROM public.cupido_likes WHERE actor_id = actor AND target_id = _target AND kind = 'interested';
  END IF;
  INSERT INTO public.cupido_likes (actor_id, target_id, kind)
  VALUES (actor, _target, _kind)
  ON CONFLICT (actor_id, target_id, kind) DO UPDATE SET created_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_set_like(TEXT, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_set_like(TEXT, BOOLEAN, UUID) TO authenticated;

-- Clean stale restrictive comment policies, then permit public reads and
-- owner-only writes. The RPC derives user_id from the session, never the client.
ALTER TABLE public.cupido_post_comments ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_name TEXT;
BEGIN
  FOR policy_name IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cupido_post_comments'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.cupido_post_comments', policy_name);
  END LOOP;
END;
$$;
CREATE POLICY cupido_post_comments_select_all ON public.cupido_post_comments
  FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY cupido_post_comments_insert_owner ON public.cupido_post_comments
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND char_length(btrim(body)) BETWEEN 1 AND 500
  );
CREATE POLICY cupido_post_comments_delete_owner ON public.cupido_post_comments
  FOR DELETE TO authenticated USING (
    user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
      OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
  );
GRANT SELECT ON public.cupido_post_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.cupido_post_comments TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_add_post_comment(
  _post UUID,
  _body TEXT,
  _parent UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  comment_uuid UUID;
  comment_body TEXT := btrim(COALESCE(_body, ''));
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _post IS NULL OR NOT EXISTS (SELECT 1 FROM public.cupido_posts WHERE id = _post) THEN
    RAISE EXCEPTION 'POST_NOT_FOUND';
  END IF;
  IF char_length(comment_body) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_COMMENT_BODY'; END IF;
  IF _parent IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_post_comments
    WHERE id = _parent AND post_id = _post
  ) THEN RAISE EXCEPTION 'INVALID_COMMENT_PARENT'; END IF;

  INSERT INTO public.cupido_post_comments (post_id, user_id, body, parent_comment_id)
  VALUES (_post, actor, comment_body, _parent)
  RETURNING id INTO comment_uuid;
  RETURN comment_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_add_post_comment(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_add_post_comment(UUID, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
