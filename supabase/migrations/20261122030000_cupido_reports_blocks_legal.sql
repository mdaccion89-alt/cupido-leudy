-- Persist user reports in the existing moderation queue and provide private block lists.
ALTER TABLE public.cupido_reports
  ADD COLUMN IF NOT EXISTS reported_post_id UUID REFERENCES public.cupido_posts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.cupido_user_blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT cupido_user_blocks_no_self CHECK (blocker_id <> blocked_id)
);

ALTER TABLE public.cupido_user_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_user_blocks_owner_read ON public.cupido_user_blocks;
CREATE POLICY cupido_user_blocks_owner_read ON public.cupido_user_blocks
  FOR SELECT TO authenticated USING (blocker_id = auth.uid());
REVOKE ALL ON public.cupido_user_blocks FROM anon, authenticated;
GRANT SELECT ON public.cupido_user_blocks TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_report_user(
  _target UUID,
  _reason TEXT DEFAULT 'Perfil reportado por la comunidad',
  _post UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  report_uuid UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _target IS NULL OR _target = actor THEN RAISE EXCEPTION 'INVALID_REPORT_TARGET'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _target) THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF _post IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_posts WHERE id = _post AND user_id = _target
  ) THEN RAISE EXCEPTION 'POST_NOT_OWNED_BY_TARGET'; END IF;

  INSERT INTO public.cupido_reports (reporter_id, reported_id, reason, reported_post_id)
  VALUES (
    actor,
    _target,
    left(COALESCE(NULLIF(btrim(_reason), ''), 'Perfil reportado por la comunidad'), 500),
    _post
  )
  RETURNING id INTO report_uuid;
  RETURN report_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_block_user(_target UUID, _blocked BOOLEAN DEFAULT TRUE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _target IS NULL OR _target = actor THEN RAISE EXCEPTION 'INVALID_BLOCK_TARGET'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _target) THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  IF COALESCE(_blocked, TRUE) THEN
    INSERT INTO public.cupido_user_blocks (blocker_id, blocked_id)
    VALUES (actor, _target)
    ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
  ELSE
    DELETE FROM public.cupido_user_blocks WHERE blocker_id = actor AND blocked_id = _target;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_get_blocked_users()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT blocked_id FROM public.cupido_user_blocks WHERE blocker_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.cupido_report_user(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_block_user(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cupido_get_blocked_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_report_user(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_block_user(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_get_blocked_users() TO authenticated;

NOTIFY pgrst, 'reload schema';
