BEGIN;

ALTER TABLE public.cupido_calls ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sounds_enabled BOOLEAN NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.cupido_sync_sound_preference()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.sound_enabled := COALESCE(NEW.sound_enabled, NEW.sounds_enabled, true);
    NEW.sounds_enabled := NEW.sound_enabled;
  ELSIF NEW.sound_enabled IS DISTINCT FROM OLD.sound_enabled THEN
    NEW.sounds_enabled := NEW.sound_enabled;
  ELSIF NEW.sounds_enabled IS DISTINCT FROM OLD.sounds_enabled THEN
    NEW.sound_enabled := NEW.sounds_enabled;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_sync_sound_preference ON public.profiles;
CREATE TRIGGER cupido_sync_sound_preference BEFORE INSERT OR UPDATE OF sound_enabled, sounds_enabled ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_sound_preference();
UPDATE public.profiles SET sound_enabled = sounds_enabled;
GRANT UPDATE (sound_enabled, sounds_enabled) ON public.profiles TO authenticated;

-- Private chat: quoted replies, edits, soft deletion and one unread row per message.
ALTER TABLE public.cupido_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.cupido_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_for_all_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.cupido_message_hides (
  message_id UUID NOT NULL REFERENCES public.cupido_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
ALTER TABLE public.cupido_message_hides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_message_hides_owner_read ON public.cupido_message_hides;
CREATE POLICY cupido_message_hides_owner_read ON public.cupido_message_hides
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.cupido_message_hides FROM anon, authenticated;
GRANT SELECT ON public.cupido_message_hides TO authenticated;
CREATE INDEX IF NOT EXISTS cupido_messages_unread_idx
  ON public.cupido_messages (created_at DESC) WHERE read_at IS NULL AND deleted_for_all_at IS NULL;

CREATE OR REPLACE FUNCTION public.cupido_edit_message(_message UUID, _body TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF char_length(btrim(COALESCE(_body, ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'INVALID_MESSAGE'; END IF;
  UPDATE public.cupido_messages SET body = btrim(_body), edited_at = now()
  WHERE id = _message AND sender_id = auth.uid() AND deleted_for_all_at IS NULL
    AND public.cupido_can_access_conversation(conversation_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'MESSAGE_NOT_EDITABLE'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_edit_message(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_edit_message(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_delete_message(_message UUID, _for_all BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE message_row public.cupido_messages%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO message_row FROM public.cupido_messages WHERE id = _message FOR UPDATE;
  IF NOT FOUND OR NOT public.cupido_can_access_conversation(message_row.conversation_id) THEN RAISE EXCEPTION 'MESSAGE_NOT_FOUND'; END IF;
  IF _for_all THEN
    IF message_row.sender_id <> auth.uid() THEN RAISE EXCEPTION 'MESSAGE_DELETE_FOR_ALL_FORBIDDEN'; END IF;
    UPDATE public.cupido_messages SET body = '', audio_path = '', media_path = '', deleted_for_all_at = now()
    WHERE id = _message;
  ELSE
    INSERT INTO public.cupido_message_hides (message_id, user_id) VALUES (_message, auth.uid()) ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_delete_message(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_delete_message(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_unread_message_count()
RETURNS BIGINT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM public.cupido_messages m
  JOIN public.cupido_conversations c ON c.id = m.conversation_id
  WHERE auth.uid() IN (c.participant_a, c.participant_b)
    AND m.sender_id <> auth.uid() AND m.read_at IS NULL AND m.deleted_for_all_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.cupido_message_hides h WHERE h.message_id = m.id AND h.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.cupido_unread_message_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_unread_message_count() TO authenticated;

GRANT UPDATE (read_at) ON public.cupido_messages TO authenticated;
DROP POLICY IF EXISTS cupido_messages_recipient_read_update ON public.cupido_messages;
CREATE POLICY cupido_messages_recipient_read_update ON public.cupido_messages
  FOR UPDATE TO authenticated
  USING (sender_id <> auth.uid() AND public.cupido_can_access_conversation(conversation_id))
  WITH CHECK (sender_id <> auth.uid() AND public.cupido_can_access_conversation(conversation_id));

-- Premium Live entry is charged once; the host's withdrawable balance is credited atomically.
ALTER TABLE public.cupido_live_rooms
  ADD COLUMN IF NOT EXISTS premium_coins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_ends_at TIMESTAMPTZ;
ALTER TABLE public.live_streams
  ADD COLUMN IF NOT EXISTS premium_coins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_ends_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.cupido_sync_live_stream()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.live_streams WHERE id = target;
    RETURN OLD;
  END IF;
  INSERT INTO public.live_streams (id, host_id, title, status, viewers_count, started_at, ended_at, premium_coins, premium_minutes, premium_ends_at)
  VALUES (NEW.id, NEW.host_id, NEW.title, CASE WHEN NEW.is_live THEN 'live' ELSE 'ended' END,
    GREATEST(0, NEW.viewer_count), NEW.created_at, NEW.ended_at, NEW.premium_coins, NEW.premium_minutes, NEW.premium_ends_at)
  ON CONFLICT (id) DO UPDATE SET host_id = EXCLUDED.host_id, title = EXCLUDED.title, status = EXCLUDED.status,
    viewers_count = EXCLUDED.viewers_count, ended_at = EXCLUDED.ended_at, premium_coins = EXCLUDED.premium_coins,
    premium_minutes = EXCLUDED.premium_minutes, premium_ends_at = EXCLUDED.premium_ends_at;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_live_stream_sync ON public.cupido_live_rooms;
CREATE TRIGGER cupido_live_stream_sync AFTER INSERT OR UPDATE OR DELETE ON public.cupido_live_rooms
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_live_stream();

CREATE TABLE IF NOT EXISTS public.cupido_live_access (
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paid_coins INTEGER NOT NULL CHECK (paid_coins > 0),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public.cupido_live_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_live_access_owner_read ON public.cupido_live_access;
CREATE POLICY cupido_live_access_owner_read ON public.cupido_live_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.cupido_live_access FROM anon, authenticated;
GRANT SELECT ON public.cupido_live_access TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_start_premium_live(_title TEXT, _coins INTEGER, _minutes INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room_uuid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF (_coins, _minutes) NOT IN ((150, 15), (300, 30), (500, 45), (1000, 60)) THEN RAISE EXCEPTION 'INVALID_LIVE_TIER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_profiles cp WHERE cp.id = auth.uid() AND (cp.is_verified_blue OR cp.is_official OR cp.is_super_admin))
     AND lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN RAISE EXCEPTION 'NOT_VERIFIED'; END IF;
  INSERT INTO public.cupido_live_rooms (host_id, title, premium_coins, premium_minutes, premium_ends_at)
  VALUES (auth.uid(), COALESCE(NULLIF(btrim(_title), ''), 'Live Premium'), _coins, _minutes, now() + make_interval(mins => _minutes))
  RETURNING id INTO room_uuid;
  RETURN room_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_pay_live_entry(_room UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE live_row public.cupido_live_rooms%ROWTYPE; actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO live_row FROM public.cupido_live_rooms WHERE id = _room AND is_live FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_NOT_AVAILABLE'; END IF;
  IF live_row.host_id = actor THEN RETURN TRUE; END IF;
  IF live_row.premium_coins <= 0 THEN RAISE EXCEPTION 'LIVE_NOT_AVAILABLE'; END IF;
  IF live_row.premium_ends_at IS NULL OR live_row.premium_ends_at <= now() THEN RAISE EXCEPTION 'LIVE_NOT_AVAILABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_live_access WHERE room_id = _room AND user_id = actor) THEN RETURN TRUE; END IF;
  PERFORM public.consume_credits(live_row.premium_coins, 'Entrada a Live Premium');
  INSERT INTO public.cupido_live_access (room_id, user_id, paid_coins) VALUES (_room, actor, live_row.premium_coins);
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (live_row.host_id, live_row.premium_coins::NUMERIC / 100, now())
  ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + EXCLUDED.balance, updated_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_pay_live_entry(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_pay_live_entry(UUID) TO authenticated;

DROP POLICY IF EXISTS cupido_live_rooms_active_read ON public.cupido_live_rooms;
CREATE POLICY cupido_live_rooms_active_read ON public.cupido_live_rooms
  FOR SELECT TO authenticated USING (
    (is_live AND (premium_coins = 0 OR host_id = auth.uid() OR (premium_ends_at > now() AND EXISTS (
      SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = id AND a.user_id = auth.uid()
    )))) OR host_id = auth.uid()
  );
DROP POLICY IF EXISTS cupido_live_viewers_join ON public.cupido_live_viewers;
CREATE POLICY cupido_live_viewers_join ON public.cupido_live_viewers
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live
        AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR (r.premium_ends_at > now() AND EXISTS (
          SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
        )))
    )
  );
DROP POLICY IF EXISTS cupido_live_signals_read ON public.cupido_live_signals;
CREATE POLICY cupido_live_signals_read ON public.cupido_live_signals FOR SELECT TO authenticated USING (
  (sender_id = auth.uid() OR receiver_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.host_id = auth.uid()
  )) AND EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live
      AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR (r.premium_ends_at > now() AND EXISTS (
        SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
      )))
  )
);
DROP POLICY IF EXISTS cupido_live_signals_send ON public.cupido_live_signals;
CREATE POLICY cupido_live_signals_send ON public.cupido_live_signals FOR INSERT TO authenticated WITH CHECK (
  sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live
    AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR (r.premium_ends_at > now() AND EXISTS (
      SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
    ))))
);
DROP POLICY IF EXISTS live_comments_live_insert ON public.live_comments;
CREATE POLICY live_comments_live_insert ON public.live_comments FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = stream_id AND r.is_live
    AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR (r.premium_ends_at > now() AND EXISTS (
      SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
    ))))
);
DROP POLICY IF EXISTS live_comments_live_read ON public.live_comments;
CREATE POLICY live_comments_live_read ON public.live_comments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = stream_id AND r.is_live
    AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR (r.premium_ends_at > now() AND EXISTS (
      SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
    ))))
);

-- Per-minute call billing charges the caller and ends the room on insufficient balance.
CREATE OR REPLACE FUNCTION public.cupido_bill_call_minute(_call UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE call_row public.cupido_calls%ROWTYPE; minute_cost INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO call_row FROM public.cupido_calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND OR call_row.caller_id <> auth.uid() THEN RAISE EXCEPTION 'CALL_BILLING_FORBIDDEN'; END IF;
  IF call_row.status <> 'active' THEN RETURN FALSE; END IF;
  IF lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
     OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo') THEN RETURN TRUE; END IF;
  minute_cost := CASE WHEN call_row.mode = 'hot' THEN 100 ELSE 50 END;
  BEGIN
    PERFORM public.consume_credits(minute_cost, 'Minuto de llamada Cupido');
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.cupido_calls SET status = 'ended', ended_at = now() WHERE id = _call;
    RETURN FALSE;
  END;
  UPDATE public.cupido_calls SET credits_spent = credits_spent + minute_cost WHERE id = _call;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_bill_call_minute(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_bill_call_minute(UUID) TO authenticated;

-- Story interactions: owner-only views, hearts, reports and per-viewer hiding.
CREATE TABLE IF NOT EXISTS public.cupido_story_views (
  story_id UUID NOT NULL REFERENCES public.cupido_stories(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);
CREATE TABLE IF NOT EXISTS public.cupido_story_hearts (
  story_id UUID NOT NULL REFERENCES public.cupido_stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.cupido_story_hides (
  story_owner UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_owner, user_id), CHECK (story_owner <> user_id)
);
CREATE TABLE IF NOT EXISTS public.cupido_story_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.cupido_stories(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (story_id, reporter_id)
);
ALTER TABLE public.cupido_story_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_story_hearts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_story_hides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_story_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_story_views_owner_read ON public.cupido_story_views;
CREATE POLICY cupido_story_views_owner_read ON public.cupido_story_views FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cupido_stories s WHERE s.id = story_id AND s.user_id = auth.uid()));
DROP POLICY IF EXISTS cupido_story_hearts_participant_read ON public.cupido_story_hearts;
CREATE POLICY cupido_story_hearts_participant_read ON public.cupido_story_hearts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS cupido_story_hides_owner_read ON public.cupido_story_hides;
CREATE POLICY cupido_story_hides_owner_read ON public.cupido_story_hides FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS cupido_story_reports_admin_read ON public.cupido_story_reports;
CREATE POLICY cupido_story_reports_admin_read ON public.cupido_story_reports FOR SELECT TO authenticated
  USING (lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' OR public.has_role(auth.uid(), 'admin_supremo'));
REVOKE ALL ON public.cupido_story_views, public.cupido_story_hearts, public.cupido_story_hides, public.cupido_story_reports FROM anon, authenticated;
GRANT SELECT ON public.cupido_story_views, public.cupido_story_hearts, public.cupido_story_hides, public.cupido_story_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_story_view(_story UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  INSERT INTO public.cupido_story_views (story_id, viewer_id)
  SELECT id, auth.uid() FROM public.cupido_stories WHERE id = _story AND expires_at > now()
  ON CONFLICT (story_id, viewer_id) DO UPDATE SET viewed_at = now();
END;
$$;
CREATE OR REPLACE FUNCTION public.cupido_toggle_story_heart(_story UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  DELETE FROM public.cupido_story_hearts WHERE story_id = _story AND user_id = auth.uid();
  IF FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.cupido_story_hearts (story_id, user_id)
  SELECT id, auth.uid() FROM public.cupido_stories WHERE id = _story AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'STORY_NOT_AVAILABLE'; END IF;
  RETURN TRUE;
END;
$$;
CREATE OR REPLACE FUNCTION public.cupido_hide_story_user(_owner UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR _owner = auth.uid() THEN RAISE EXCEPTION 'INVALID_STORY_HIDE'; END IF;
  INSERT INTO public.cupido_story_hides (story_owner, user_id) VALUES (_owner, auth.uid()) ON CONFLICT DO NOTHING;
END;
$$;
CREATE OR REPLACE FUNCTION public.cupido_report_story(_story UUID, _reason TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE report_uuid UUID; owner_uuid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT user_id INTO owner_uuid FROM public.cupido_stories WHERE id = _story AND expires_at > now();
  IF owner_uuid IS NULL OR owner_uuid = auth.uid() THEN RAISE EXCEPTION 'STORY_NOT_REPORTABLE'; END IF;
  INSERT INTO public.cupido_story_reports (story_id, reporter_id, reason) VALUES (_story, auth.uid(), left(btrim(_reason), 500))
  ON CONFLICT (story_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason
  RETURNING id INTO report_uuid;
  INSERT INTO public.cupido_reports (reporter_id, reported_id, reason, status)
  VALUES (auth.uid(), owner_uuid, 'Historia denunciada: ' || left(btrim(_reason), 450), 'pending');
  RETURN report_uuid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_story_view(UUID), public.cupido_toggle_story_heart(UUID), public.cupido_hide_story_user(UUID), public.cupido_report_story(UUID, TEXT) TO authenticated;

-- Country/locale and IP are stored separately so the user's profile row never exposes an IP.
CREATE TABLE IF NOT EXISTS public.cupido_login_metadata (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT '',
  last_ip INET,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cupido_login_metadata ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_login_metadata_admin_read ON public.cupido_login_metadata;
CREATE POLICY cupido_login_metadata_admin_read ON public.cupido_login_metadata FOR SELECT TO authenticated
  USING (lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' OR public.has_role(auth.uid(), 'admin_supremo'));
REVOKE ALL ON public.cupido_login_metadata FROM anon, authenticated;
GRANT SELECT ON public.cupido_login_metadata TO authenticated;
CREATE OR REPLACE FUNCTION public.cupido_update_login_metadata(_country TEXT, _language TEXT, _ip TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  INSERT INTO public.cupido_login_metadata (user_id, country_code, language_code, last_ip, updated_at)
  VALUES (auth.uid(), upper(left(COALESCE(_country, ''), 2)), left(COALESCE(_language, ''), 12),
    CASE WHEN COALESCE(_ip, '') ~ '^[0-9a-fA-F:.]+$' THEN _ip::INET ELSE NULL END, now())
  ON CONFLICT (user_id) DO UPDATE SET country_code = EXCLUDED.country_code, language_code = EXCLUDED.language_code,
    last_ip = COALESCE(EXCLUDED.last_ip, public.cupido_login_metadata.last_ip), updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_update_login_metadata(TEXT, TEXT, TEXT) TO authenticated;

CREATE TABLE IF NOT EXISTS public.cupido_live_moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('nudity', 'violence', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cupido_live_moderation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_live_moderation_log_admin_read ON public.cupido_live_moderation_log;
CREATE POLICY cupido_live_moderation_log_admin_read ON public.cupido_live_moderation_log FOR SELECT TO authenticated
  USING (lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' OR public.has_role(auth.uid(), 'admin_supremo'));
REVOKE ALL ON public.cupido_live_moderation_log FROM anon, authenticated;
GRANT SELECT ON public.cupido_live_moderation_log TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_close_moderated_live(_room UUID, _category TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room_row public.cupido_live_rooms%ROWTYPE; official_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF _category NOT IN ('nudity', 'violence', 'other') THEN RAISE EXCEPTION 'INVALID_MODERATION_CATEGORY'; END IF;
  SELECT * INTO room_row FROM public.cupido_live_rooms WHERE id = _room FOR UPDATE;
  IF NOT FOUND OR NOT room_row.is_live OR room_row.premium_coins > 0 THEN RETURN FALSE; END IF;
  UPDATE public.cupido_live_rooms SET is_live = false, ended_at = now() WHERE id = _room;
  INSERT INTO public.cupido_live_moderation_log (room_id, host_id, category)
  VALUES (_room, room_row.host_id, _category);
  SELECT id INTO official_id FROM public.profiles WHERE lower(email) = 'leudyfeliz81@gmail.com' ORDER BY created_at LIMIT 1;
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id, action_url)
  VALUES (room_row.host_id, 'Advertencia oficial del Administrador',
    CASE WHEN _category = 'nudity' THEN 'Tu Live público se cerró automáticamente por detectar desnudez. Revisa las normas de la comunidad.'
         WHEN _category = 'violence' THEN 'Tu Live público se cerró automáticamente por detectar violencia. Revisa las normas de la comunidad.'
         ELSE 'Tu Live público se cerró automáticamente por infringir las normas de la comunidad.' END,
    'live_moderation', official_id, _room, '/directo');
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_close_moderated_live(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_close_moderated_live(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.cupido_admin_remove_badge(_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR (lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
      AND NOT public.has_role(auth.uid(), 'admin_supremo')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.creator_profiles SET is_verified_blue = false, verification_status = 'rejected' WHERE id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id, action_url)
  VALUES (_user, 'Insignia azul retirada', 'El Administrador Oficial retiró tu insignia azul de verificación.',
    'verification', auth.uid(), _user, '/perfil');
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_admin_remove_badge(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_admin_remove_badge(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_list_friends(_user UUID)
RETURNS TABLE(friend_id UUID, display_name TEXT, avatar_url TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT friend.id, friend.display_name, friend.avatar_url
  FROM public.friend_requests f
  JOIN public.creator_profiles owner ON owner.id = _user
  JOIN public.creator_profiles friend ON friend.id = CASE WHEN f.requester_id = _user THEN f.addressee_id ELSE f.requester_id END
  WHERE f.status = 'accepted' AND _user IN (f.requester_id, f.addressee_id)
    AND (_user = auth.uid() OR NOT owner.hide_followers)
  ORDER BY friend.display_name
$$;
REVOKE ALL ON FUNCTION public.cupido_list_friends(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_list_friends(UUID) TO authenticated;

COMMIT;
