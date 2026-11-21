-- Interactive verification, unrestricted display names, social engagement,
-- comment reports, support tickets, and real-time notifications for Cupido.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Names accept Unicode, emoji, punctuation, digits and spaces. Only length is
-- constrained here; the UI requires a non-empty value (anonymous auth remains valid).
CREATE OR REPLACE FUNCTION public.cupido_validate_profile_names()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF char_length(COALESCE(NEW.display_name, '')) > 40 OR char_length(COALESCE(NEW.full_name, '')) > 40 THEN
    RAISE EXCEPTION 'PROFILE_NAME_TOO_LONG';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.display_name IS DISTINCT FROM OLD.display_name AND NULLIF(btrim(NEW.display_name), '') IS NULL THEN
    RAISE EXCEPTION 'DISPLAY_NAME_REQUIRED';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.full_name IS DISTINCT FROM OLD.full_name AND NULLIF(btrim(NEW.full_name), '') IS NULL THEN
    RAISE EXCEPTION 'FULL_NAME_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_validate_profile_names ON public.profiles;
CREATE TRIGGER cupido_validate_profile_names BEFORE INSERT OR UPDATE OF display_name, full_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_validate_profile_names();
DROP TRIGGER IF EXISTS cupido_validate_creator_names ON public.creator_profiles;
CREATE TRIGGER cupido_validate_creator_names BEFORE INSERT OR UPDATE OF display_name, full_name ON public.creator_profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_validate_profile_names();

-- A profile's interest count is maintained transactionally by the RPC triggers.
ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS interested_count BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.cupido_set_like(_kind TEXT, _remove BOOLEAN, _target UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _target IS NULL OR _target = actor THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  IF _kind NOT IN ('interested', 'pass') THEN RAISE EXCEPTION 'INVALID_LIKE_KIND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target) THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;

  IF COALESCE(_remove, FALSE) THEN
    DELETE FROM public.cupido_likes WHERE actor_id = actor AND target_id = _target AND kind = _kind;
    RETURN FOUND;
  END IF;

  INSERT INTO public.cupido_likes (actor_id, target_id, kind)
  VALUES (actor, _target, _kind)
  ON CONFLICT (actor_id, target_id) DO UPDATE
    SET kind = EXCLUDED.kind, created_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_set_like(TEXT, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_set_like(TEXT, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_sync_interested_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.kind = 'interested' THEN
    UPDATE public.creator_profiles SET interested_count = GREATEST(0, interested_count - 1) WHERE id = OLD.target_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.kind = 'interested' THEN
    UPDATE public.creator_profiles SET interested_count = interested_count + 1 WHERE id = NEW.target_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_sync_interested_count ON public.cupido_likes;
CREATE TRIGGER cupido_sync_interested_count
AFTER INSERT OR UPDATE OR DELETE ON public.cupido_likes
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_interested_count();
UPDATE public.creator_profiles cp
SET interested_count = (SELECT count(*) FROM public.cupido_likes l WHERE l.target_id = cp.id AND l.kind = 'interested');

CREATE OR REPLACE VIEW public.cupido_public_profiles
WITH (security_barrier = TRUE)
AS
SELECT
  cp.id, cp.display_name, cp.avatar_url, cp.bio, cp.country_code, cp.age, cp.gender,
  cp.looking_for, cp.zodiac, cp.smokes, cp.drinks, cp.has_kids, cp.hobbies,
  cp.survey_completed, cp.is_verified_blue, cp.is_super_admin, cp.is_official,
  cp.is_cupido_active, cp.is_premium, cp.friend_count, cp.follower_count,
  cp.created_at, cp.hide_followers, cp.verification_status, cp.interested_count
FROM public.creator_profiles AS cp;
GRANT SELECT ON public.cupido_public_profiles TO anon, authenticated;

-- Parent links and comment hearts are public-readable and owner-writable.
ALTER TABLE public.cupido_post_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id UUID REFERENCES public.cupido_post_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS likes_count BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS cupido_post_comments_parent_idx
  ON public.cupido_post_comments (parent_comment_id, created_at);

CREATE OR REPLACE FUNCTION public.cupido_validate_comment_parent()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL THEN
    IF NEW.parent_comment_id = NEW.id OR NOT EXISTS (
      SELECT 1 FROM public.cupido_post_comments p
      WHERE p.id = NEW.parent_comment_id AND p.post_id = NEW.post_id
    ) THEN RAISE EXCEPTION 'INVALID_COMMENT_PARENT'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_validate_comment_parent ON public.cupido_post_comments;
CREATE TRIGGER cupido_validate_comment_parent
BEFORE INSERT OR UPDATE OF post_id, parent_comment_id ON public.cupido_post_comments
FOR EACH ROW EXECUTE FUNCTION public.cupido_validate_comment_parent();

CREATE TABLE IF NOT EXISTS public.cupido_comment_likes (
  comment_id UUID NOT NULL REFERENCES public.cupido_post_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
ALTER TABLE public.cupido_comment_likes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_comment_likes_public_read ON public.cupido_comment_likes;
CREATE POLICY cupido_comment_likes_public_read ON public.cupido_comment_likes
  FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.cupido_comment_likes FROM anon, authenticated;
GRANT SELECT ON public.cupido_comment_likes TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_toggle_comment_like(_comment UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_post_comments WHERE id = _comment) THEN RAISE EXCEPTION 'COMMENT_NOT_FOUND'; END IF;
  DELETE FROM public.cupido_comment_likes WHERE comment_id = _comment AND user_id = actor;
  IF FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.cupido_comment_likes (comment_id, user_id) VALUES (_comment, actor) ON CONFLICT DO NOTHING;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_toggle_comment_like(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_toggle_comment_like(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_sync_comment_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comment_uuid UUID := COALESCE(NEW.comment_id, OLD.comment_id);
BEGIN
  UPDATE public.cupido_post_comments
  SET likes_count = (SELECT count(*) FROM public.cupido_comment_likes WHERE comment_id = comment_uuid)
  WHERE id = comment_uuid;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_sync_comment_like_count ON public.cupido_comment_likes;
CREATE TRIGGER cupido_sync_comment_like_count
AFTER INSERT OR DELETE ON public.cupido_comment_likes
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_comment_like_count();
UPDATE public.cupido_post_comments c
SET likes_count = (SELECT count(*) FROM public.cupido_comment_likes l WHERE l.comment_id = c.id);

CREATE OR REPLACE FUNCTION public.cupido_notify_comment_like()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recipient UUID; actor_name TEXT; comment_post UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT user_id, post_id INTO recipient, comment_post
  FROM public.cupido_post_comments WHERE id = NEW.comment_id;
  IF recipient IS NOT NULL AND recipient <> NEW.user_id THEN
    actor_name := public.cupido_actor_handle(NEW.user_id);
    PERFORM public.cupido_emit_notification(
      recipient, 'A ' || actor_name || ' le gustó tu comentario',
      'A ' || actor_name || ' le gustó tu comentario.', 'comment_like', NEW.user_id,
      NEW.comment_id, '/muro?post=' || comment_post::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_notify_comment_like ON public.cupido_comment_likes;
CREATE TRIGGER cupido_notify_comment_like AFTER INSERT OR DELETE ON public.cupido_comment_likes
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_comment_like();

-- Reports attach to the comment/post and retain the offender in reported_id for
-- the existing moderation queue and its user-suspension action.
CREATE TABLE IF NOT EXISTS public.cupido_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cupido_reports
  ADD COLUMN IF NOT EXISTS reported_comment_id UUID REFERENCES public.cupido_post_comments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reported_post_id UUID REFERENCES public.cupido_posts(id) ON DELETE SET NULL;
ALTER TABLE public.cupido_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_reports_admin_read ON public.cupido_reports;
DROP POLICY IF EXISTS cupido_reports_owner_read ON public.cupido_reports;
CREATE POLICY cupido_reports_admin_read ON public.cupido_reports
  FOR SELECT TO authenticated USING (
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo')
  );
DROP POLICY IF EXISTS cupido_reports_admin_update ON public.cupido_reports;
CREATE POLICY cupido_reports_admin_update ON public.cupido_reports
  FOR UPDATE TO authenticated USING (
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo')
  ) WITH CHECK (
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo')
  );
REVOKE ALL ON public.cupido_reports FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.cupido_reports TO authenticated;

DROP POLICY IF EXISTS cupido_post_comments_admin_delete ON public.cupido_post_comments;
CREATE POLICY cupido_post_comments_admin_delete ON public.cupido_post_comments
  FOR DELETE TO authenticated USING (
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo')
  );
GRANT DELETE ON public.cupido_post_comments TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_report_comment(_comment UUID, _reason TEXT DEFAULT 'Comentario ofensivo o spam')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid(); comment_row public.cupido_post_comments%ROWTYPE; report_uuid UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO comment_row FROM public.cupido_post_comments WHERE id = _comment;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMMENT_NOT_FOUND'; END IF;
  IF comment_row.user_id = actor THEN RAISE EXCEPTION 'CANNOT_REPORT_OWN_COMMENT'; END IF;
  INSERT INTO public.cupido_reports (reporter_id, reported_id, reason, reported_comment_id, reported_post_id)
  VALUES (actor, comment_row.user_id, left(COALESCE(NULLIF(btrim(_reason), ''), 'Comentario ofensivo o spam'), 500), comment_row.id, comment_row.post_id)
  RETURNING id INTO report_uuid;
  PERFORM public.cupido_emit_notification(
    (SELECT id FROM public.profiles WHERE lower(email) = 'leudyfeliz81@gmail.com' ORDER BY created_at LIMIT 1),
    'Nuevo comentario reportado', 'Hay un comentario nuevo en la cola de revisión.', 'report', actor, report_uuid, '/admin'
  );
  RETURN report_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_report_comment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_report_comment(UUID, TEXT) TO authenticated;

-- Comments notify the post author; replies also notify the parent comment author.
CREATE OR REPLACE FUNCTION public.cupido_notify_post_comment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE post_owner UUID; parent_owner UUID; actor_name TEXT;
BEGIN
  SELECT user_id INTO post_owner FROM public.cupido_posts WHERE id = NEW.post_id;
  actor_name := public.cupido_actor_handle(NEW.user_id);
  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT user_id INTO parent_owner FROM public.cupido_post_comments WHERE id = NEW.parent_comment_id;
    IF parent_owner IS NOT NULL AND parent_owner <> NEW.user_id THEN
      PERFORM public.cupido_emit_notification(
        parent_owner, actor_name || ' respondió a tu comentario',
        left(actor_name || ': ' || NEW.body, 300), 'comment_reply', NEW.user_id,
        NEW.parent_comment_id, '/muro?post=' || NEW.post_id::TEXT
      );
    END IF;
  END IF;
  IF post_owner IS NOT NULL AND post_owner <> NEW.user_id AND post_owner IS DISTINCT FROM parent_owner THEN
    PERFORM public.cupido_emit_notification(
      post_owner, actor_name || ' comentó tu publicación',
      left(actor_name || ': ' || NEW.body, 300), 'comment', NEW.user_id,
      NEW.post_id, '/muro?post=' || NEW.post_id::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_notify_post_comment ON public.cupido_post_comments;
CREATE TRIGGER cupido_notify_post_comment AFTER INSERT ON public.cupido_post_comments
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_post_comment();

CREATE OR REPLACE FUNCTION public.cupido_notify_friend_accepted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_name TEXT;
BEGIN
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    actor_name := public.cupido_actor_handle(NEW.addressee_id);
    PERFORM public.cupido_emit_notification(
      NEW.requester_id, actor_name || ' aceptó tu solicitud de amistad',
      actor_name || ' aceptó tu solicitud de amistad.', 'friend_accepted', NEW.addressee_id,
      NEW.requester_id, '/perfil?userId=' || NEW.addressee_id::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_notify_friend_accepted ON public.friend_requests;
CREATE TRIGGER cupido_notify_friend_accepted AFTER UPDATE OF status ON public.friend_requests
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_friend_accepted();

-- Keep existing gift accounting and enrich its notification with the gift and payout.
CREATE OR REPLACE FUNCTION public.cupido_enrich_gift_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gift_row public.cupido_gift_sends%ROWTYPE; sender_name TEXT; gift_name TEXT;
BEGIN
  IF NEW.kind NOT IN ('gift', 'live_gift') THEN RETURN NEW; END IF;
  SELECT * INTO gift_row FROM public.cupido_gift_sends WHERE id = NEW.target_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  sender_name := public.cupido_actor_handle(gift_row.sender_id);
  SELECT name INTO gift_name FROM public.cupido_gifts WHERE id = gift_row.gift_id;
  NEW.title := 'Recibiste un regalo';
  NEW.body := left(sender_name || ' te envió ' || COALESCE(gift_name, 'un regalo') ||
    ' (+$' || to_char(gift_row.cash_value, 'FM999999990.00') || ' saldo retirable).', 400);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_enrich_gift_notification ON public.cupido_gift_sends;
DROP TRIGGER IF EXISTS cupido_enrich_gift_notification ON public.notifications;
CREATE TRIGGER cupido_enrich_gift_notification BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.cupido_enrich_gift_notification();

-- Real support tickets. Users create/read their tickets; only admins can reply.
CREATE TABLE IF NOT EXISTS public.cupido_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'responded', 'closed')),
  admin_reply TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cupido_support_tickets_status_created_idx
  ON public.cupido_support_tickets (status, created_at DESC);
ALTER TABLE public.cupido_support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_support_tickets_owner_read ON public.cupido_support_tickets;
DROP POLICY IF EXISTS cupido_support_tickets_admin_read ON public.cupido_support_tickets;
CREATE POLICY cupido_support_tickets_owner_read ON public.cupido_support_tickets
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY cupido_support_tickets_admin_read ON public.cupido_support_tickets
  FOR SELECT TO authenticated USING (
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo')
  );
REVOKE ALL ON public.cupido_support_tickets FROM anon, authenticated;
GRANT SELECT ON public.cupido_support_tickets TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_open_support_ticket(_subject TEXT, _message TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor UUID := auth.uid(); ticket_uuid UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF char_length(btrim(COALESCE(_subject, ''))) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'INVALID_TICKET_SUBJECT'; END IF;
  IF char_length(btrim(COALESCE(_message, ''))) NOT BETWEEN 5 AND 4000 THEN RAISE EXCEPTION 'INVALID_TICKET_MESSAGE'; END IF;
  INSERT INTO public.cupido_support_tickets (user_id, subject, message)
  VALUES (actor, btrim(_subject), btrim(_message)) RETURNING id INTO ticket_uuid;
  PERFORM public.cupido_emit_notification(
    (SELECT id FROM public.profiles WHERE lower(email) = 'leudyfeliz81@gmail.com' ORDER BY created_at LIMIT 1),
    'Nuevo ticket de soporte', left(btrim(_subject), 300), 'support_ticket', actor, ticket_uuid, '/admin'
  );
  RETURN ticket_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_open_support_ticket(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_open_support_ticket(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_reply_support_ticket(_ticket UUID, _reply TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ticket_row public.cupido_support_tickets%ROWTYPE; actor_name TEXT;
BEGIN
  IF lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF char_length(btrim(COALESCE(_reply, ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'INVALID_TICKET_REPLY'; END IF;
  UPDATE public.cupido_support_tickets SET admin_reply = btrim(_reply), status = 'responded', updated_at = now(), responded_at = now()
  WHERE id = _ticket RETURNING * INTO ticket_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_NOT_FOUND'; END IF;
  actor_name := public.cupido_actor_handle(auth.uid());
  PERFORM public.cupido_emit_notification(
    ticket_row.user_id, 'Respuesta del Administrador', left(btrim(_reply), 300),
    'support_reply', auth.uid(), ticket_row.id, '/'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_reply_support_ticket(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_reply_support_ticket(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_admin_remove_reported_comment(_report UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comment_uuid UUID;
BEGIN
  IF lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT reported_comment_id INTO comment_uuid FROM public.cupido_reports WHERE id = _report;
  IF comment_uuid IS NULL THEN RAISE EXCEPTION 'COMMENT_REPORT_NOT_FOUND'; END IF;
  DELETE FROM public.cupido_post_comments WHERE id = comment_uuid;
  UPDATE public.cupido_reports SET status = 'reviewed' WHERE id = _report;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_admin_remove_reported_comment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_admin_suspend_reported_user(_report UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE offender UUID;
BEGIN
  IF lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT reported_id INTO offender FROM public.cupido_reports WHERE id = _report;
  IF offender IS NULL THEN RAISE EXCEPTION 'REPORT_NOT_FOUND'; END IF;
  UPDATE public.creator_profiles SET is_cupido_active = FALSE WHERE id = offender;
  UPDATE public.cupido_reports SET status = 'reviewed' WHERE id = _report;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_admin_suspend_reported_user(UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_comment_likes') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_comment_likes;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_support_tickets') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_support_tickets;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_likes') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_likes;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
