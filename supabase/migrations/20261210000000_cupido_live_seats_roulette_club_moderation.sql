-- Realtime guest seats, creator clubs, live roulette, and room moderation.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cupido_live_guest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'invited', 'accepted', 'rejected', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cupido_live_guest_sessions_room_status_idx
  ON public.cupido_live_guest_sessions (room_id, status, created_at DESC);
WITH duplicate_requests AS (
  SELECT id, row_number() OVER (PARTITION BY room_id, guest_id ORDER BY created_at DESC, id DESC) AS position
  FROM public.cupido_live_guest_sessions WHERE status = 'requested'
)
UPDATE public.cupido_live_guest_sessions sessions
SET status = 'ended', updated_at = now()
FROM duplicate_requests duplicates
WHERE sessions.id = duplicates.id AND duplicates.position > 1;
CREATE UNIQUE INDEX IF NOT EXISTS cupido_live_guest_sessions_one_request_idx
  ON public.cupido_live_guest_sessions (room_id, guest_id)
  WHERE status = 'requested';
CREATE UNIQUE INDEX IF NOT EXISTS cupido_live_guest_sessions_one_seat_idx
  ON public.cupido_live_guest_sessions (room_id)
  WHERE status IN ('invited', 'accepted');
ALTER TABLE public.cupido_live_guest_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_live_guest_sessions_live_read ON public.cupido_live_guest_sessions;
CREATE POLICY cupido_live_guest_sessions_live_read ON public.cupido_live_guest_sessions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live)
  );
REVOKE ALL ON public.cupido_live_guest_sessions FROM anon, authenticated;
GRANT SELECT ON public.cupido_live_guest_sessions TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_request_live_guest(_room UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); request_id UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms WHERE id = _room AND is_live AND host_id <> actor) THEN
    RAISE EXCEPTION 'LIVE_NOT_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_live_pk_battles WHERE room_id = _room AND finished_at IS NULL AND ends_at > now()) THEN
    RAISE EXCEPTION 'LIVE_PK_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_live_guest_sessions WHERE room_id = _room AND status IN ('invited', 'accepted')) THEN
    RAISE EXCEPTION 'LIVE_GUEST_SEAT_TAKEN';
  END IF;
  SELECT id INTO request_id FROM public.cupido_live_guest_sessions
  WHERE room_id = _room AND guest_id = actor AND status = 'requested'
  ORDER BY created_at DESC LIMIT 1;
  IF request_id IS NOT NULL THEN RETURN request_id; END IF;
  INSERT INTO public.cupido_live_guest_sessions (room_id, guest_id, status)
  VALUES (_room, actor, 'requested') RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_request_live_guest(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_request_live_guest(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_invite_live_guest(_room UUID, _guest UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); request_id UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _guest IS NULL OR _guest = actor THEN RAISE EXCEPTION 'INVALID_GUEST'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms WHERE id = _room AND is_live AND host_id = actor) THEN
    RAISE EXCEPTION 'LIVE_HOST_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_viewers WHERE room_id = _room AND user_id = _guest) THEN
    RAISE EXCEPTION 'GUEST_NOT_IN_LIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_live_pk_battles WHERE room_id = _room AND finished_at IS NULL AND ends_at > now()) THEN
    RAISE EXCEPTION 'LIVE_PK_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_live_guest_sessions WHERE room_id = _room AND status IN ('invited', 'accepted')) THEN
    RAISE EXCEPTION 'LIVE_GUEST_SEAT_TAKEN';
  END IF;
  UPDATE public.cupido_live_guest_sessions
  SET invited_by = actor, status = 'invited', updated_at = now()
  WHERE room_id = _room AND guest_id = _guest AND status = 'requested'
  RETURNING id INTO request_id;
  IF request_id IS NULL THEN
    INSERT INTO public.cupido_live_guest_sessions (room_id, guest_id, invited_by, status)
    VALUES (_room, _guest, actor, 'invited') RETURNING id INTO request_id;
  END IF;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_invite_live_guest(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_invite_live_guest(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_respond_live_guest(_request UUID, _accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); seat public.cupido_live_guest_sessions%ROWTYPE; host_user UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _request IS NULL OR _accept IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO seat FROM public.cupido_live_guest_sessions WHERE id = _request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_GUEST_REQUEST_NOT_FOUND'; END IF;
  SELECT host_id INTO host_user FROM public.cupido_live_rooms WHERE id = seat.room_id AND is_live;
  IF host_user IS NULL THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;

  IF seat.status = 'requested' AND actor = host_user THEN
    IF _accept AND NOT EXISTS (SELECT 1 FROM public.cupido_live_viewers WHERE room_id = seat.room_id AND user_id = seat.guest_id) THEN
      RAISE EXCEPTION 'GUEST_NOT_IN_LIVE';
    END IF;
    IF _accept AND EXISTS (SELECT 1 FROM public.cupido_live_pk_battles WHERE room_id = seat.room_id AND finished_at IS NULL AND ends_at > now()) THEN
      RAISE EXCEPTION 'LIVE_PK_ACTIVE';
    END IF;
  ELSIF seat.status = 'invited' AND actor = seat.guest_id THEN
    IF _accept AND NOT EXISTS (SELECT 1 FROM public.cupido_live_viewers WHERE room_id = seat.room_id AND user_id = actor) THEN
      RAISE EXCEPTION 'GUEST_NOT_IN_LIVE';
    END IF;
    IF _accept AND EXISTS (SELECT 1 FROM public.cupido_live_pk_battles WHERE room_id = seat.room_id AND finished_at IS NULL AND ends_at > now()) THEN
      RAISE EXCEPTION 'LIVE_PK_ACTIVE';
    END IF;
  ELSE
    RAISE EXCEPTION 'LIVE_GUEST_RESPONSE_FORBIDDEN';
  END IF;

  UPDATE public.cupido_live_guest_sessions
  SET status = CASE WHEN _accept THEN 'accepted' ELSE 'rejected' END, updated_at = now()
  WHERE id = _request;
  RETURN CASE WHEN _accept THEN 'accepted' ELSE 'rejected' END;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_respond_live_guest(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_respond_live_guest(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_end_live_guest(_room UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); changed INTEGER;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.cupido_live_guest_sessions s
  SET status = 'ended', updated_at = now()
  FROM public.cupido_live_rooms r
  WHERE s.room_id = _room AND r.id = s.room_id AND r.is_live
    AND s.status IN ('requested', 'invited', 'accepted')
    AND (r.host_id = actor OR s.guest_id = actor);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed = 0 THEN RAISE EXCEPTION 'LIVE_GUEST_SESSION_NOT_FOUND'; END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_end_live_guest(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_end_live_guest(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_end_guest_seats_with_room()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.is_live IS TRUE AND NEW.is_live IS FALSE THEN
    UPDATE public.cupido_live_guest_sessions
    SET status = 'ended', updated_at = now()
    WHERE room_id = NEW.id AND status IN ('requested', 'invited', 'accepted');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_end_guest_seats_with_room() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cupido_end_guest_seats_on_room_end ON public.cupido_live_rooms;
CREATE TRIGGER cupido_end_guest_seats_on_room_end
AFTER UPDATE OF is_live ON public.cupido_live_rooms
FOR EACH ROW EXECUTE FUNCTION public.cupido_end_guest_seats_with_room();

CREATE TABLE IF NOT EXISTS public.cupido_creator_clubs (
  creator_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_price INTEGER NOT NULL CHECK (monthly_price BETWEEN 100 AND 100000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cupido_creator_club_subscriptions (
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fan_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_id, fan_id),
  CHECK (creator_id <> fan_id)
);
CREATE INDEX IF NOT EXISTS cupido_creator_club_subscriptions_active_idx
  ON public.cupido_creator_club_subscriptions (creator_id, expires_at DESC);
ALTER TABLE public.cupido_creator_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_creator_club_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_creator_clubs_read ON public.cupido_creator_clubs;
CREATE POLICY cupido_creator_clubs_read ON public.cupido_creator_clubs FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS cupido_creator_club_subscriptions_active_read ON public.cupido_creator_club_subscriptions;
CREATE POLICY cupido_creator_club_subscriptions_active_read ON public.cupido_creator_club_subscriptions
  FOR SELECT TO authenticated USING (expires_at > now());
REVOKE ALL ON public.cupido_creator_clubs, public.cupido_creator_club_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.cupido_creator_clubs, public.cupido_creator_club_subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_set_creator_club_price(_monthly_price INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _monthly_price IS NULL OR _monthly_price NOT BETWEEN 100 AND 100000 THEN RAISE EXCEPTION 'INVALID_CLUB_PRICE'; END IF;
  INSERT INTO public.cupido_creator_clubs (creator_id, monthly_price, updated_at)
  VALUES (actor, _monthly_price, now())
  ON CONFLICT (creator_id) DO UPDATE SET monthly_price = EXCLUDED.monthly_price, updated_at = now();
  RETURN _monthly_price;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_set_creator_club_price(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_set_creator_club_price(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_subscribe_creator_club(_creator UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); club_price INTEGER; current_expiry TIMESTAMPTZ; next_expiry TIMESTAMPTZ;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _creator IS NULL OR _creator = actor THEN RAISE EXCEPTION 'INVALID_CREATOR'; END IF;
  SELECT monthly_price INTO club_price FROM public.cupido_creator_clubs WHERE creator_id = _creator FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CREATOR_CLUB_NOT_CONFIGURED'; END IF;
  SELECT expires_at INTO current_expiry FROM public.cupido_creator_club_subscriptions
  WHERE creator_id = _creator AND fan_id = actor FOR UPDATE;
  IF current_expiry > now() THEN RETURN current_expiry; END IF;
  PERFORM public.consume_credits(club_price, 'Club VIP mensual de creador');
  next_expiry := now() + INTERVAL '1 month';
  INSERT INTO public.cupido_creator_club_subscriptions (creator_id, fan_id, expires_at)
  VALUES (_creator, actor, next_expiry)
  ON CONFLICT (creator_id, fan_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, created_at = now();
  RETURN next_expiry;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_subscribe_creator_club(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_subscribe_creator_club(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS public.cupido_live_roulette_configs (
  room_id UUID PRIMARY KEY REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_gift_id TEXT NOT NULL REFERENCES public.cupido_gifts(id),
  prizes TEXT[] NOT NULL CHECK (array_length(prizes, 1) BETWEEN 2 AND 6),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (array_position(prizes, NULL) IS NULL)
);
CREATE TABLE IF NOT EXISTS public.cupido_live_roulette_spins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  gift_send_id UUID NOT NULL UNIQUE REFERENCES public.cupido_gift_sends(id) ON DELETE CASCADE,
  trigger_gift_id TEXT NOT NULL REFERENCES public.cupido_gifts(id),
  spun_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prize_index INTEGER NOT NULL CHECK (prize_index BETWEEN 1 AND 6),
  prize TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cupido_live_roulette_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_roulette_spins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_live_roulette_configs_live_read ON public.cupido_live_roulette_configs;
CREATE POLICY cupido_live_roulette_configs_live_read ON public.cupido_live_roulette_configs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live)
  );
DROP POLICY IF EXISTS cupido_live_roulette_spins_live_read ON public.cupido_live_roulette_spins;
CREATE POLICY cupido_live_roulette_spins_live_read ON public.cupido_live_roulette_spins
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live)
  );
REVOKE ALL ON public.cupido_live_roulette_configs, public.cupido_live_roulette_spins FROM anon, authenticated;
GRANT SELECT ON public.cupido_live_roulette_configs, public.cupido_live_roulette_spins TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_set_live_roulette(_room UUID, _trigger_gift_id TEXT, _prizes TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); clean_prizes TEXT[];
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms WHERE id = _room AND host_id = actor AND is_live) THEN
    RAISE EXCEPTION 'LIVE_HOST_REQUIRED';
  END IF;
  SELECT array_agg(btrim(prize) ORDER BY ordinality) INTO clean_prizes
  FROM unnest(COALESCE(_prizes, ARRAY[]::TEXT[])) WITH ORDINALITY AS p(prize, ordinality)
  WHERE NULLIF(btrim(prize), '') IS NOT NULL;
  IF COALESCE(array_length(clean_prizes, 1), 0) NOT BETWEEN 2 AND 6 THEN RAISE EXCEPTION 'ROULETTE_NEEDS_TWO_TO_SIX_PRIZES'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(clean_prizes) AS prize WHERE length(prize) > 80) THEN RAISE EXCEPTION 'ROULETTE_PRIZE_TOO_LONG'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_gifts WHERE id = _trigger_gift_id) THEN RAISE EXCEPTION 'ROULETTE_TRIGGER_GIFT_NOT_FOUND'; END IF;
  INSERT INTO public.cupido_live_roulette_configs (room_id, host_id, trigger_gift_id, prizes, enabled, updated_at)
  VALUES (_room, actor, _trigger_gift_id, clean_prizes, TRUE, now())
  ON CONFLICT (room_id) DO UPDATE
    SET host_id = EXCLUDED.host_id, trigger_gift_id = EXCLUDED.trigger_gift_id,
        prizes = EXCLUDED.prizes, enabled = TRUE, updated_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_set_live_roulette(UUID, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_set_live_roulette(UUID, TEXT, TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_spin_live_roulette_after_gift()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE config public.cupido_live_roulette_configs%ROWTYPE; selected_index INTEGER;
BEGIN
  IF NEW.live_room_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO config FROM public.cupido_live_roulette_configs
  WHERE room_id = NEW.live_room_id AND enabled AND trigger_gift_id = NEW.gift_id;
  IF NOT FOUND OR COALESCE(array_length(config.prizes, 1), 0) < 2 THEN RETURN NEW; END IF;
  selected_index := 1 + floor(random() * array_length(config.prizes, 1))::INTEGER;
  INSERT INTO public.cupido_live_roulette_spins
    (room_id, gift_send_id, trigger_gift_id, spun_by, prize_index, prize)
  VALUES (NEW.live_room_id, NEW.id, NEW.gift_id, NEW.sender_id, selected_index, config.prizes[selected_index])
  ON CONFLICT (gift_send_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_spin_live_roulette_after_gift() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cupido_live_roulette_spin_after_gift ON public.cupido_gift_sends;
CREATE TRIGGER cupido_live_roulette_spin_after_gift
AFTER INSERT ON public.cupido_gift_sends
FOR EACH ROW EXECUTE FUNCTION public.cupido_spin_live_roulette_after_gift();

CREATE TABLE IF NOT EXISTS public.cupido_live_room_moderators (
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  moderator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appointed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, moderator_id)
);
CREATE TABLE IF NOT EXISTS public.cupido_live_room_mutes (
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muted_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public.cupido_live_room_moderators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_room_mutes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_live_room_moderators_live_read ON public.cupido_live_room_moderators;
CREATE POLICY cupido_live_room_moderators_live_read ON public.cupido_live_room_moderators
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live)
  );
REVOKE ALL ON public.cupido_live_room_moderators, public.cupido_live_room_mutes FROM anon, authenticated;
GRANT SELECT ON public.cupido_live_room_moderators TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_set_live_moderator(_room UUID, _user UUID, _enabled BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _user IS NULL OR _enabled IS NULL OR _user = actor THEN RAISE EXCEPTION 'INVALID_MODERATOR'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms WHERE id = _room AND host_id = actor AND is_live) THEN
    RAISE EXCEPTION 'LIVE_HOST_REQUIRED';
  END IF;
  IF _enabled THEN
    IF NOT EXISTS (SELECT 1 FROM public.cupido_live_viewers WHERE room_id = _room AND user_id = _user) THEN RAISE EXCEPTION 'MODERATOR_NOT_IN_LIVE'; END IF;
    INSERT INTO public.cupido_live_room_moderators (room_id, moderator_id, appointed_by)
    VALUES (_room, _user, actor) ON CONFLICT (room_id, moderator_id) DO NOTHING;
  ELSE
    DELETE FROM public.cupido_live_room_moderators WHERE room_id = _room AND moderator_id = _user;
    DELETE FROM public.cupido_live_room_mutes WHERE room_id = _room AND (user_id = _user OR muted_by = _user);
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_set_live_moderator(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_set_live_moderator(UUID, UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_moderate_live_user(_room UUID, _user UUID, _minutes INTEGER DEFAULT 10)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); host_user UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _user IS NULL OR _user = actor OR _minutes IS NULL OR _minutes NOT BETWEEN 0 AND 1440 THEN RAISE EXCEPTION 'INVALID_MUTE_DURATION'; END IF;
  SELECT host_id INTO host_user FROM public.cupido_live_rooms WHERE id = _room AND is_live;
  IF host_user IS NULL THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;
  IF actor <> host_user AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_room_moderators WHERE room_id = _room AND moderator_id = actor
  ) THEN RAISE EXCEPTION 'LIVE_MODERATOR_REQUIRED'; END IF;
  IF _user = host_user THEN RAISE EXCEPTION 'CANNOT_MUTE_LIVE_HOST'; END IF;
  IF _minutes = 0 THEN
    DELETE FROM public.cupido_live_room_mutes WHERE room_id = _room AND user_id = _user;
  ELSE
    INSERT INTO public.cupido_live_room_mutes (room_id, user_id, muted_by, muted_until)
    VALUES (_room, _user, actor, now() + make_interval(mins => _minutes))
    ON CONFLICT (room_id, user_id) DO UPDATE
      SET muted_by = EXCLUDED.muted_by, muted_until = EXCLUDED.muted_until, created_at = now();
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_moderate_live_user(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_moderate_live_user(UUID, UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_send_live_comment(_room UUID, _body TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); clean_body TEXT; normalized_body TEXT; comment_id UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  clean_body := btrim(COALESCE(_body, ''));
  IF length(clean_body) = 0 OR length(clean_body) > 500 THEN RAISE EXCEPTION 'LIVE_COMMENT_LENGTH_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms WHERE id = _room AND is_live) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_live_room_mutes WHERE room_id = _room AND user_id = actor AND muted_until > now()) THEN
    RAISE EXCEPTION 'LIVE_CHAT_MUTED';
  END IF;
  IF clean_body ~* '(https?://|www\.|(^|[[:space:]])([[:alnum:]-]+\.)+[[:alpha:]]{2,}([/:?#][^[:space:]]*)?)' THEN
    RAISE EXCEPTION 'LIVE_LINK_BLOCKED';
  END IF;
  normalized_body := lower(translate(clean_body, 'áéíóúüñ', 'aeiouun'));
  IF normalized_body ~* '(^|[^[:alnum:]])(puta|puto|mierda|cabron|cabrón|pendejo|pendeja|verga|chingar|chingada|joder|fuck|shit|bitch|asshole)([^[:alnum:]]|$)' THEN
    RAISE EXCEPTION 'LIVE_OFFENSIVE_WORD_BLOCKED';
  END IF;
  INSERT INTO public.live_comments (stream_id, user_id, body)
  VALUES (_room, actor, clean_body) RETURNING id INTO comment_id;
  RETURN comment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_send_live_comment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_send_live_comment(UUID, TEXT) TO authenticated;
REVOKE INSERT ON public.live_comments FROM PUBLIC, anon, authenticated;

DO $$
DECLARE table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'cupido_live_guest_sessions', 'cupido_creator_clubs', 'cupido_creator_club_subscriptions',
      'cupido_live_roulette_configs', 'cupido_live_roulette_spins',
      'cupido_live_room_moderators', 'live_comments'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = table_name
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
      END IF;
    END LOOP;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
