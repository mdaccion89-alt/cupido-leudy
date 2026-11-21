BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS friend_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_id UUID,
  ADD COLUMN IF NOT EXISTS action_url TEXT;

CREATE TABLE IF NOT EXISTS public.cupido_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_b UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_a, participant_b),
  CHECK (participant_a < participant_b)
);

CREATE TABLE IF NOT EXISTS public.cupido_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.cupido_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  audio_path TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(body) <= 4000)
);

CREATE INDEX IF NOT EXISTS cupido_messages_conversation_created_idx
  ON public.cupido_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE INDEX IF NOT EXISTS friend_requests_addressee_status_idx
  ON public.friend_requests (addressee_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cupido_friends (
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

INSERT INTO public.friend_requests (requester_id, addressee_id, status, created_at)
SELECT requester_id, addressee_id, status, created_at
FROM public.cupido_friends
ON CONFLICT (requester_id, addressee_id) DO UPDATE
SET status = EXCLUDED.status;

CREATE TABLE IF NOT EXISTS public.cupido_follower_count_events (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  follower_count BIGINT NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_live_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Live de Cupido Leudy ❤️',
  is_live BOOLEAN NOT NULL DEFAULT true,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

ALTER TABLE public.cupido_live_rooms
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Live de Cupido Leudy ❤️',
  ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS viewer_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.cupido_live_viewers (
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.cupido_live_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cupido_live_signals_room_created_idx
  ON public.cupido_live_signals (room_id, created_at);

CREATE TABLE IF NOT EXISTS public.live_streams (
  id UUID PRIMARY KEY REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Live de Cupido Leudy ❤️',
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  viewers_count INTEGER NOT NULL DEFAULT 0 CHECK (viewers_count >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS live_streams_status_started_idx
  ON public.live_streams (status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.live_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES public.live_streams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_comments_stream_created_idx
  ON public.live_comments (stream_id, created_at);

CREATE OR REPLACE FUNCTION public.cupido_can_access_conversation(_conversation UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cupido_conversations c
    WHERE c.id = _conversation AND auth.uid() IN (c.participant_a, c.participant_b)
  );
$$;

ALTER TABLE public.cupido_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_follower_count_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cupido_conversations_participant_read ON public.cupido_conversations;
CREATE POLICY cupido_conversations_participant_read ON public.cupido_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() IN (participant_a, participant_b));

DROP POLICY IF EXISTS cupido_messages_participant_read ON public.cupido_messages;
CREATE POLICY cupido_messages_participant_read ON public.cupido_messages
  FOR SELECT TO authenticated
  USING (public.cupido_can_access_conversation(conversation_id));

DROP POLICY IF EXISTS cupido_messages_participant_insert ON public.cupido_messages;
CREATE POLICY cupido_messages_participant_insert ON public.cupido_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.cupido_can_access_conversation(conversation_id)
    AND (body <> '' OR audio_path <> '')
  );

DROP POLICY IF EXISTS cupido_messages_sender_delete ON public.cupido_messages;
CREATE POLICY cupido_messages_sender_delete ON public.cupido_messages
  FOR DELETE TO authenticated USING (sender_id = auth.uid());

DROP POLICY IF EXISTS friend_requests_participant_select ON public.friend_requests;
CREATE POLICY friend_requests_participant_select ON public.friend_requests
  FOR SELECT TO authenticated
  USING (auth.uid() IN (requester_id, addressee_id));

DROP POLICY IF EXISTS friend_requests_requester_insert ON public.friend_requests;
CREATE POLICY friend_requests_requester_insert ON public.friend_requests
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid() AND addressee_id <> auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS friend_requests_addressee_update ON public.friend_requests;
CREATE POLICY friend_requests_addressee_update ON public.friend_requests
  FOR UPDATE TO authenticated
  USING (addressee_id = auth.uid())
  WITH CHECK (addressee_id = auth.uid() AND status IN ('accepted', 'rejected'));

DROP POLICY IF EXISTS friend_requests_participant_delete ON public.friend_requests;
CREATE POLICY friend_requests_participant_delete ON public.friend_requests
  FOR DELETE TO authenticated USING (auth.uid() IN (requester_id, addressee_id));

DROP POLICY IF EXISTS cupido_follows_owner_read ON public.follows;
CREATE POLICY cupido_follows_owner_read ON public.follows
  FOR SELECT TO authenticated USING (follower_id = auth.uid() OR following_id = auth.uid());

DROP POLICY IF EXISTS cupido_follows_owner_insert ON public.follows;
CREATE POLICY cupido_follows_owner_insert ON public.follows
  FOR INSERT TO authenticated WITH CHECK (follower_id = auth.uid() AND follower_id <> following_id);

DROP POLICY IF EXISTS cupido_follows_owner_delete ON public.follows;
CREATE POLICY cupido_follows_owner_delete ON public.follows
  FOR DELETE TO authenticated USING (follower_id = auth.uid());

DROP POLICY IF EXISTS cupido_notifications_owner_read ON public.notifications;
CREATE POLICY cupido_notifications_owner_read ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS cupido_notifications_owner_update ON public.notifications;
CREATE POLICY cupido_notifications_owner_update ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS cupido_follower_count_events_public_read ON public.cupido_follower_count_events;
CREATE POLICY cupido_follower_count_events_public_read ON public.cupido_follower_count_events
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS cupido_live_rooms_active_read ON public.cupido_live_rooms;
CREATE POLICY cupido_live_rooms_active_read ON public.cupido_live_rooms
  FOR SELECT TO authenticated USING (is_live OR host_id = auth.uid());

DROP POLICY IF EXISTS cupido_live_viewers_read ON public.cupido_live_viewers;
CREATE POLICY cupido_live_viewers_read ON public.cupido_live_viewers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cupido_live_viewers_join ON public.cupido_live_viewers;
CREATE POLICY cupido_live_viewers_join ON public.cupido_live_viewers
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS cupido_live_viewers_refresh ON public.cupido_live_viewers;
CREATE POLICY cupido_live_viewers_refresh ON public.cupido_live_viewers
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS cupido_live_viewers_leave ON public.cupido_live_viewers;
CREATE POLICY cupido_live_viewers_leave ON public.cupido_live_viewers
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS cupido_live_signals_read ON public.cupido_live_signals;
CREATE POLICY cupido_live_signals_read ON public.cupido_live_signals
  FOR SELECT TO authenticated USING (
    sender_id = auth.uid() OR receiver_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.host_id = auth.uid())
  );

DROP POLICY IF EXISTS cupido_live_signals_send ON public.cupido_live_signals;
CREATE POLICY cupido_live_signals_send ON public.cupido_live_signals
  FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS live_streams_active_read ON public.live_streams;
CREATE POLICY live_streams_active_read ON public.live_streams
  FOR SELECT TO authenticated USING (status = 'live' OR host_id = auth.uid());

DROP POLICY IF EXISTS live_comments_live_read ON public.live_comments;
CREATE POLICY live_comments_live_read ON public.live_comments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.live_streams s
      WHERE s.id = stream_id AND (s.status = 'live' OR s.host_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS live_comments_live_insert ON public.live_comments;
CREATE POLICY live_comments_live_insert ON public.live_comments
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.live_streams s WHERE s.id = stream_id AND s.status = 'live')
  );

GRANT SELECT ON public.cupido_conversations, public.cupido_messages TO authenticated;
GRANT INSERT, DELETE ON public.cupido_messages TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.friend_requests TO authenticated;
REVOKE UPDATE ON public.friend_requests FROM authenticated;
GRANT UPDATE (status, updated_at) ON public.friend_requests TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read) ON public.notifications TO authenticated;
GRANT SELECT ON public.cupido_follower_count_events TO anon, authenticated;
GRANT SELECT ON public.cupido_live_rooms, public.live_streams, public.live_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupido_live_viewers TO authenticated;
GRANT SELECT, INSERT ON public.cupido_live_signals TO authenticated;
GRANT ALL ON public.friend_requests, public.live_streams, public.live_comments,
  public.cupido_follower_count_events TO service_role;

CREATE OR REPLACE FUNCTION public.cupido_can_access_conversation(_conversation UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cupido_conversations c
    WHERE c.id = _conversation AND auth.uid() IN (c.participant_a, c.participant_b)
  );
$$;

CREATE OR REPLACE FUNCTION public.cupido_open_conversation(_other UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me UUID := auth.uid();
  participant_low UUID;
  participant_high UUID;
  conversation_id UUID;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _other IS NULL OR _other = me THEN RAISE EXCEPTION 'INVALID_RECIPIENT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _other) THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  participant_low := LEAST(me, _other);
  participant_high := GREATEST(me, _other);

  INSERT INTO public.cupido_conversations (participant_a, participant_b)
  VALUES (participant_low, participant_high)
  ON CONFLICT (participant_a, participant_b) DO NOTHING;

  SELECT id INTO conversation_id
  FROM public.cupido_conversations
  WHERE participant_a = participant_low AND participant_b = participant_high;

  IF conversation_id IS NULL THEN RAISE EXCEPTION 'CONVERSATION_CREATE_FAILED'; END IF;
  RETURN conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_sync_friend_request_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    target := OLD.requester_id;
    UPDATE public.creator_profiles cp SET friend_count = (
      SELECT count(*)::INTEGER FROM public.friend_requests fr
      WHERE fr.status = 'accepted' AND target IN (fr.requester_id, fr.addressee_id)
    ) WHERE cp.id = target;
    target := OLD.addressee_id;
    UPDATE public.creator_profiles cp SET friend_count = (
      SELECT count(*)::INTEGER FROM public.friend_requests fr
      WHERE fr.status = 'accepted' AND target IN (fr.requester_id, fr.addressee_id)
    ) WHERE cp.id = target;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    target := NEW.requester_id;
    UPDATE public.creator_profiles cp SET friend_count = (
      SELECT count(*)::INTEGER FROM public.friend_requests fr
      WHERE fr.status = 'accepted' AND target IN (fr.requester_id, fr.addressee_id)
    ) WHERE cp.id = target;
    target := NEW.addressee_id;
    UPDATE public.creator_profiles cp SET friend_count = (
      SELECT count(*)::INTEGER FROM public.friend_requests fr
      WHERE fr.status = 'accepted' AND target IN (fr.requester_id, fr.addressee_id)
    ) WHERE cp.id = target;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_requests_sync_count ON public.friend_requests;
DROP TRIGGER IF EXISTS friend_requests_touch_updated_at ON public.friend_requests;
CREATE OR REPLACE FUNCTION public.cupido_touch_friend_request()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER friend_requests_touch_updated_at
BEFORE UPDATE ON public.friend_requests
FOR EACH ROW EXECUTE FUNCTION public.cupido_touch_friend_request();

CREATE TRIGGER friend_requests_sync_count
AFTER INSERT OR UPDATE OR DELETE ON public.friend_requests
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_friend_request_count();

UPDATE public.creator_profiles cp
SET friend_count = (
  SELECT count(*)::INTEGER FROM public.friend_requests fr
  WHERE fr.status = 'accepted' AND cp.id IN (fr.requester_id, fr.addressee_id)
);

CREATE OR REPLACE FUNCTION public.sync_follower_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target UUID; total BIGINT;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.following_id ELSE NEW.following_id END;
  SELECT count(*) INTO total FROM public.follows WHERE following_id = target;

  UPDATE public.creator_profiles SET follower_count = total::INTEGER WHERE id = target;
  INSERT INTO public.cupido_follower_count_events (user_id, follower_count, updated_at)
  VALUES (target, total, now())
  ON CONFLICT (user_id) DO UPDATE
  SET follower_count = EXCLUDED.follower_count, updated_at = now();

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follows_count ON public.follows;
CREATE TRIGGER follows_count AFTER INSERT OR DELETE ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.sync_follower_count();

INSERT INTO public.cupido_follower_count_events (user_id, follower_count)
SELECT cp.id, count(f.follower_id)
FROM public.creator_profiles cp
LEFT JOIN public.follows f ON f.following_id = cp.id
GROUP BY cp.id
ON CONFLICT (user_id) DO UPDATE
SET follower_count = EXCLUDED.follower_count, updated_at = now();

UPDATE public.creator_profiles cp
SET follower_count = (
  SELECT count(*)::INTEGER FROM public.follows f WHERE f.following_id = cp.id
);

CREATE OR REPLACE FUNCTION public.cupido_actor_handle(_user UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT '@' || COALESCE(
      NULLIF(cp.display_name, ''),
      NULLIF(p.display_name, ''),
      NULLIF(split_part(p.email, '@', 1), ''),
      'Usuario'
    )
    FROM public.profiles p
    LEFT JOIN public.creator_profiles cp ON cp.id = p.id
    WHERE p.id = _user
  ), '@Usuario')
$$;

CREATE OR REPLACE FUNCTION public.cupido_emit_notification(
  _user UUID,
  _title TEXT,
  _body TEXT,
  _kind TEXT,
  _actor UUID,
  _target UUID,
  _action_url TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user IS NULL OR _user = _actor THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user AND p.notifications_enabled = false
  ) THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = _user AND n.kind = _kind
      AND n.actor_id IS NOT DISTINCT FROM _actor
      AND n.target_id IS NOT DISTINCT FROM _target
      AND n.created_at > now() - interval '1 hour'
  ) THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id, action_url)
  VALUES (_user, left(_title, 160), left(_body, 400), _kind, _actor, _target, _action_url);
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_emit_notification(UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_notify_follow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.notifications
    WHERE user_id = OLD.following_id AND actor_id = OLD.follower_id AND kind = 'follow' AND target_id = OLD.follower_id;
    RETURN OLD;
  END IF;
  IF NEW.follower_id = NEW.following_id THEN RETURN NEW; END IF;
  actor_name := public.cupido_actor_handle(NEW.follower_id);
  PERFORM public.cupido_emit_notification(
    NEW.following_id, actor_name || ' empezó a seguirte',
    actor_name || ' empezó a seguirte.', 'follow', NEW.follower_id, NEW.follower_id,
    '/perfil?userId=' || NEW.follower_id::TEXT
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_notify_follow ON public.follows;
CREATE TRIGGER cupido_notify_follow AFTER INSERT OR DELETE ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_follow();

CREATE OR REPLACE FUNCTION public.cupido_notify_profile_like()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_name TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.kind = 'interested' THEN
    DELETE FROM public.notifications
    WHERE user_id = OLD.target_id AND actor_id = OLD.actor_id AND kind = 'interest' AND target_id = OLD.actor_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.kind = 'interested' AND NEW.actor_id <> NEW.target_id THEN
    actor_name := public.cupido_actor_handle(NEW.actor_id);
    PERFORM public.cupido_emit_notification(
      NEW.target_id, 'A ' || actor_name || ' le interesas',
      'A ' || actor_name || ' le interesas.', 'interest', NEW.actor_id, NEW.actor_id,
      '/perfil?userId=' || NEW.actor_id::TEXT
    );
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_notify_profile_like ON public.cupido_likes;
CREATE TRIGGER cupido_notify_profile_like AFTER INSERT OR UPDATE OR DELETE ON public.cupido_likes
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_profile_like();

CREATE OR REPLACE FUNCTION public.cupido_notify_post_like()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE post_owner UUID; actor_name TEXT;
BEGIN
  SELECT user_id INTO post_owner FROM public.cupido_posts WHERE id = COALESCE(NEW.post_id, OLD.post_id);
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.notifications
    WHERE user_id = post_owner AND kind = 'like' AND actor_id = OLD.user_id AND target_id = OLD.post_id;
    RETURN OLD;
  END IF;
  IF post_owner IS NOT NULL AND post_owner <> NEW.user_id THEN
    actor_name := public.cupido_actor_handle(NEW.user_id);
    PERFORM public.cupido_emit_notification(
      post_owner, 'A ' || actor_name || ' le gustó tu publicación',
      'A ' || actor_name || ' le gustó tu publicación.', 'like', NEW.user_id, NEW.post_id,
      '/muro?post=' || NEW.post_id::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_notify_post_like ON public.cupido_post_likes;
CREATE TRIGGER cupido_notify_post_like AFTER INSERT OR DELETE ON public.cupido_post_likes
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_post_like();

CREATE OR REPLACE FUNCTION public.cupido_notify_post_comment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE post_owner UUID; actor_name TEXT;
BEGIN
  SELECT user_id INTO post_owner FROM public.cupido_posts WHERE id = NEW.post_id;
  IF post_owner IS NOT NULL AND post_owner <> NEW.user_id THEN
    actor_name := public.cupido_actor_handle(NEW.user_id);
    PERFORM public.cupido_emit_notification(
      post_owner, actor_name || ' comentó tu publicación',
      LEFT(actor_name || ': ' || NEW.body, 300), 'comment', NEW.user_id, NEW.post_id,
      '/muro?post=' || NEW.post_id::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_notify_post_comment ON public.cupido_post_comments;
CREATE TRIGGER cupido_notify_post_comment AFTER INSERT ON public.cupido_post_comments
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_post_comment();

CREATE OR REPLACE FUNCTION public.cupido_notify_friend_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  actor_name := public.cupido_actor_handle(NEW.requester_id);
  PERFORM public.cupido_emit_notification(
    NEW.addressee_id, actor_name || ' te envió una solicitud de amistad',
    actor_name || ' te envió una solicitud de amistad.', 'friend', NEW.requester_id,
    NEW.requester_id, '/perfil?userId=' || NEW.requester_id::TEXT
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_notify_friend_request ON public.friend_requests;
CREATE TRIGGER cupido_notify_friend_request AFTER INSERT ON public.friend_requests
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_friend_request();

CREATE OR REPLACE FUNCTION public.cupido_sync_live_stream()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target UUID;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.live_streams WHERE id = target;
    RETURN OLD;
  END IF;
  INSERT INTO public.live_streams (id, host_id, title, status, viewers_count, started_at, ended_at)
  VALUES (
    NEW.id, NEW.host_id, NEW.title,
    CASE WHEN NEW.is_live THEN 'live' ELSE 'ended' END,
    GREATEST(0, NEW.viewer_count), NEW.created_at, NEW.ended_at
  )
  ON CONFLICT (id) DO UPDATE SET
    host_id = EXCLUDED.host_id,
    title = EXCLUDED.title,
    status = EXCLUDED.status,
    viewers_count = EXCLUDED.viewers_count,
    ended_at = EXCLUDED.ended_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_live_stream_sync ON public.cupido_live_rooms;
CREATE TRIGGER cupido_live_stream_sync
AFTER INSERT OR UPDATE OF is_live, viewer_count, title, ended_at OR DELETE ON public.cupido_live_rooms
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_live_stream();

CREATE OR REPLACE FUNCTION public.cupido_sync_live_viewers()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_room UUID;
BEGIN
  target_room := CASE WHEN TG_OP = 'DELETE' THEN OLD.room_id ELSE NEW.room_id END;
  UPDATE public.cupido_live_rooms
  SET viewer_count = (SELECT count(*)::INTEGER FROM public.cupido_live_viewers WHERE room_id = target_room)
  WHERE id = target_room;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_live_viewers_count ON public.cupido_live_viewers;
CREATE TRIGGER cupido_live_viewers_count
AFTER INSERT OR UPDATE OR DELETE ON public.cupido_live_viewers
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_live_viewers();

CREATE OR REPLACE FUNCTION public.cupido_notify_live_start()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_name TEXT;
BEGIN
  IF NEW.is_live AND (
    TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.is_live = false)
  ) THEN
    actor_name := public.cupido_actor_handle(NEW.host_id);
    PERFORM public.cupido_emit_notification(
      f.follower_id,
      actor_name || ' está transmitiendo en vivo',
      actor_name || ' está transmitiendo en vivo. Toca para entrar.',
      'live', NEW.host_id, NEW.id, '/directo?liveId=' || NEW.id::TEXT
    )
    FROM public.follows f
    WHERE f.following_id = NEW.host_id AND f.follower_id <> NEW.host_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_notify_live_start ON public.cupido_live_rooms;
CREATE TRIGGER cupido_notify_live_start
AFTER INSERT OR UPDATE OF is_live ON public.cupido_live_rooms
FOR EACH ROW EXECUTE FUNCTION public.cupido_notify_live_start();

INSERT INTO public.live_streams (id, host_id, title, status, viewers_count, started_at, ended_at)
SELECT id, host_id, title, CASE WHEN is_live THEN 'live' ELSE 'ended' END,
       GREATEST(0, viewer_count), created_at, ended_at
FROM public.cupido_live_rooms
ON CONFLICT (id) DO UPDATE SET
  host_id = EXCLUDED.host_id,
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  viewers_count = EXCLUDED.viewers_count,
  ended_at = EXCLUDED.ended_at;

CREATE OR REPLACE FUNCTION public.cupido_start_live_room(_title TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.creator_profiles cp WHERE cp.id = auth.uid() AND cp.is_verified_blue
  ) AND lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
    AND NOT public.has_role(auth.uid(), 'admin')
    AND NOT public.has_role(auth.uid(), 'admin_supremo')
  THEN
    RAISE EXCEPTION 'NOT_VERIFIED';
  END IF;

  INSERT INTO public.cupido_live_rooms (host_id, title)
  VALUES (auth.uid(), COALESCE(NULLIF(BTRIM(_title), ''), 'Live de Cupido Leudy ❤️'))
  RETURNING id INTO room_id;
  RETURN room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_end_live_room(_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.cupido_live_rooms
  SET is_live = false, ended_at = now()
  WHERE id = _id
    AND (host_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo'));
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_can_access_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_open_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_start_live_room(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_end_live_room(UUID) TO authenticated;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'friend_requests', 'cupido_follower_count_events', 'live_streams', 'live_comments',
    'cupido_conversations', 'cupido_messages', 'cupido_live_rooms',
    'cupido_live_viewers', 'cupido_live_signals', 'notifications'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
