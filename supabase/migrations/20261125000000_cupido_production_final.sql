CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Wall comments: public reads, authenticated owner writes, and safe realtime publication.
ALTER TABLE public.cupido_post_comments
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.cupido_post_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cupido post comments public read" ON public.cupido_post_comments;
DROP POLICY IF EXISTS "cupido post comments own insert" ON public.cupido_post_comments;
DROP POLICY IF EXISTS "cupido post comments own delete" ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_select_all ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_insert_owner ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_delete_owner ON public.cupido_post_comments;
CREATE POLICY cupido_post_comments_select_all ON public.cupido_post_comments
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY cupido_post_comments_insert_owner ON public.cupido_post_comments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND char_length(btrim(body)) BETWEEN 1 AND 500);
CREATE POLICY cupido_post_comments_delete_owner ON public.cupido_post_comments
  FOR DELETE TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.cupido_post_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.cupido_post_comments TO authenticated;
DROP TRIGGER IF EXISTS cupido_notify_post_comment ON public.cupido_post_comments;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_post_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_post_comments;
  END IF;
END;
$$;

-- Private chat images share the same participant checks as text and voice notes.
ALTER TABLE public.cupido_messages ADD COLUMN IF NOT EXISTS media_path TEXT NOT NULL DEFAULT '';
DROP POLICY IF EXISTS cupido_messages_participant_insert ON public.cupido_messages;
CREATE POLICY cupido_messages_participant_insert ON public.cupido_messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_id = auth.uid()
    AND public.cupido_can_access_conversation(conversation_id)
    AND (body <> '' OR audio_path <> '' OR media_path <> '')
  );
INSERT INTO storage.buckets (id, name, public)
VALUES ('cupido-chat-media', 'cupido-chat-media', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;
DROP POLICY IF EXISTS cupido_chat_media_participant_read ON storage.objects;
DROP POLICY IF EXISTS cupido_chat_media_participant_insert ON storage.objects;
CREATE POLICY cupido_chat_media_participant_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'cupido-chat-media'
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND public.cupido_can_access_conversation(split_part(name, '/', 1)::UUID)
  );
CREATE POLICY cupido_chat_media_participant_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'cupido-chat-media'
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND split_part(name, '/', 2) = auth.uid()::TEXT
    AND public.cupido_can_access_conversation(split_part(name, '/', 1)::UUID)
  );

-- Real frontal-camera video review queue delivered to the official admin panel.
CREATE TABLE IF NOT EXISTS public.cupido_face_verification_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS cupido_face_verification_pending_idx
  ON public.cupido_face_verification_videos (created_at DESC) WHERE status = 'pending';
ALTER TABLE public.cupido_face_verification_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_face_verification_owner_read ON public.cupido_face_verification_videos;
DROP POLICY IF EXISTS cupido_face_verification_admin_read ON public.cupido_face_verification_videos;
CREATE POLICY cupido_face_verification_owner_read ON public.cupido_face_verification_videos
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY cupido_face_verification_admin_read ON public.cupido_face_verification_videos
  FOR SELECT TO authenticated USING (
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_supremo')
  );
GRANT SELECT ON public.cupido_face_verification_videos TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('cupido-private', 'cupido-private', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;
DROP POLICY IF EXISTS cupido_private_verification_owner_insert ON storage.objects;
DROP POLICY IF EXISTS cupido_private_verification_admin_read ON storage.objects;
CREATE POLICY cupido_private_verification_owner_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'cupido-private'
    AND split_part(name, '/', 1) = auth.uid()::TEXT
    AND split_part(name, '/', 2) = 'verification'
  );
CREATE POLICY cupido_private_verification_admin_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'cupido-private'
    AND split_part(name, '/', 2) = 'verification'
    AND (
      split_part(name, '/', 1) = auth.uid()::TEXT
      OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'admin_supremo')
    )
  );

CREATE OR REPLACE FUNCTION public.cupido_submit_face_verification_video(_video_path TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_id UUID := auth.uid();
  request_id UUID;
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _video_path IS NULL OR _video_path NOT LIKE current_id::TEXT || '/verification/%'
     OR _video_path !~ '\.(webm|mp4)$' THEN RAISE EXCEPTION 'INVALID_VERIFICATION_VIDEO'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = current_id AND COALESCE(NULLIF(p.avatar_url, ''), '') <> ''
      AND NULLIF(btrim(p.full_name), '') IS NOT NULL
      AND p.birth_date <= CURRENT_DATE - INTERVAL '18 years'
      AND NULLIF(btrim(p.country_code), '') IS NOT NULL
      AND NULLIF(btrim(p.phone), '') IS NOT NULL
      AND NULLIF(btrim(p.bio), '') IS NOT NULL AND p.survey_completed IS TRUE
  ) THEN RAISE EXCEPTION 'VERIFICATION_PROFILE_INCOMPLETE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'cupido-private' AND name = _video_path
  ) THEN RAISE EXCEPTION 'VERIFICATION_VIDEO_NOT_FOUND'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.cupido_face_verification_videos
    WHERE user_id = current_id AND status = 'pending'
  ) THEN RAISE EXCEPTION 'VERIFICATION_ALREADY_PENDING'; END IF;
  INSERT INTO public.cupido_face_verification_videos (user_id, video_path)
  VALUES (current_id, _video_path) RETURNING id INTO request_id;
  UPDATE public.creator_profiles
  SET verification_frames = ARRAY[_video_path, _video_path, _video_path],
      selfie_path = _video_path, verification_status = 'pending', is_verified_blue = FALSE
  WHERE id = current_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  RETURN request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_submit_face_verification_video(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_review_face_verification_video(_request UUID, _approve BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  submission public.cupido_face_verification_videos%ROWTYPE;
BEGIN
  IF lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
     AND NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO submission FROM public.cupido_face_verification_videos
  WHERE id = _request AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFICATION_NOT_PENDING'; END IF;
  UPDATE public.creator_profiles
  SET verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      is_verified_blue = _approve
  WHERE id = submission.user_id;
  UPDATE public.cupido_face_verification_videos
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = _request;
  INSERT INTO public.notifications (user_id, title, body, kind, target_id, action_url)
  VALUES (
    submission.user_id,
    CASE WHEN _approve THEN 'Insignia azul habilitada' ELSE 'Solicitud de insignia rechazada' END,
    CASE WHEN _approve THEN 'El Administrador Oficial aprobó tu video. Tu insignia azul ya está activa.'
      ELSE 'El Administrador Oficial revisó tu video y rechazó la solicitud. Puedes enviar otro video desde tu perfil.' END,
    'verification', submission.id, '/perfil'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_review_face_verification_video(UUID, BOOLEAN) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'cupido_face_verification_videos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_face_verification_videos;
  END IF;
END;
$$;

-- Store real watch seconds per viewer/video. The heartbeat is bounded and cannot be replayed rapidly.
ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS video_watch_seconds BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.cupido_video_watch_events (
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  watched_seconds BIGINT NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, viewer_id)
);
ALTER TABLE public.cupido_video_watch_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cupido_video_watch_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_record_video_watch(_post UUID, _seconds INTEGER)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer UUID := auth.uid();
  owner_id UUID;
  total_seconds BIGINT;
  credited_seconds BIGINT;
BEGIN
  IF viewer IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _seconds IS NULL OR _seconds < 0 OR _seconds > 30 THEN RAISE EXCEPTION 'INVALID_WATCH_HEARTBEAT'; END IF;
  SELECT user_id INTO owner_id FROM public.cupido_posts
  WHERE id = _post AND kind = 'video' AND moderation_status = 'approved';
  IF owner_id IS NULL OR owner_id = viewer THEN RETURN 0; END IF;
  IF _seconds = 0 THEN
    INSERT INTO public.cupido_video_watch_events (post_id, viewer_id, watched_seconds, last_heartbeat_at)
    VALUES (_post, viewer, 0, now())
    ON CONFLICT (post_id, viewer_id) DO NOTHING;
    RETURN 0;
  END IF;
  IF _seconds < 5 THEN RAISE EXCEPTION 'INVALID_WATCH_HEARTBEAT'; END IF;
  INSERT INTO public.cupido_video_watch_events (post_id, viewer_id, watched_seconds, last_heartbeat_at)
  VALUES (_post, viewer, 0, now())
  ON CONFLICT (post_id, viewer_id) DO NOTHING;
  SELECT LEAST(_seconds::BIGINT, FLOOR(EXTRACT(EPOCH FROM now() - last_heartbeat_at))::BIGINT)
  INTO credited_seconds
  FROM public.cupido_video_watch_events
  WHERE post_id = _post AND viewer_id = viewer
  FOR UPDATE;
  IF credited_seconds IS NULL OR credited_seconds < 5 THEN RETURN 0; END IF;
  UPDATE public.cupido_video_watch_events
  SET watched_seconds = watched_seconds + credited_seconds,
      last_heartbeat_at = now()
  WHERE post_id = _post AND viewer_id = viewer
  RETURNING watched_seconds INTO total_seconds;
  IF NOT FOUND THEN RETURN 0; END IF;
  UPDATE public.creator_profiles
  SET video_watch_seconds = video_watch_seconds + credited_seconds
  WHERE id = owner_id;
  RETURN total_seconds;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_record_video_watch(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_video_watch_seconds(_user UUID)
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() = _user
    THEN COALESCE((SELECT video_watch_seconds FROM public.creator_profiles WHERE id = _user), 0)
    ELSE 0 END
$$;
GRANT EXECUTE ON FUNCTION public.cupido_get_video_watch_seconds(UUID) TO authenticated;

-- Prices are authoritative in cupido_gifts; client-supplied coin and cash values are ignored.
WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY sort_order, id) AS position
  FROM public.cupido_gifts
)
UPDATE public.cupido_gifts g
SET credits = CASE
      WHEN ranked.position <= 55 THEN (ARRAY[5, 10, 20, 50, 75, 100])[(ranked.position - 1) % 6 + 1]
      ELSE (ARRAY[120, 160, 220, 300, 400, 550, 700, 900, 1200, 1600, 2000, 2500])[(ranked.position - 56) % 12 + 1]
    END,
    cash = CASE
      WHEN ranked.position <= 55 THEN (ARRAY[5, 10, 20, 50, 75, 100])[(ranked.position - 1) % 6 + 1] / 1000.0
      ELSE (ARRAY[120, 160, 220, 300, 400, 550, 700, 900, 1200, 1600, 2000, 2500])[(ranked.position - 56) % 12 + 1] / 1000.0
    END
FROM ranked WHERE ranked.id = g.id AND ranked.position <= 99;

CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(_receiver UUID, _gift_id TEXT, _room UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sender UUID := auth.uid();
  gift public.cupido_gifts%ROWTYPE;
  payout NUMERIC(12,3);
  send_id UUID;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  SELECT * INTO gift FROM public.cupido_gifts WHERE id = _gift_id;
  IF NOT FOUND OR gift.credits < 5 OR gift.credits > 2500 THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;
  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms WHERE id = _room AND host_id = _receiver AND is_live
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;
  PERFORM public.consume_credits(gift.credits, 'Regalo Cupido: ' || gift.name);
  payout := gift.cash;
  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
  VALUES (sender, _receiver, gift.id, gift.credits, payout) RETURNING id INTO send_id;
  IF payout > 0 THEN
    INSERT INTO public.cupido_balances (user_id, balance, updated_at)
    VALUES (_receiver, payout, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance = public.cupido_balances.balance + EXCLUDED.balance, updated_at = now();
  END IF;
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (_receiver, 'Recibiste un regalo', 'Tu saldo retirable se actualizó con un regalo de Cupido.',
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END, sender, send_id);
  RETURN send_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_gift(_receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, NULL)
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_live_gift(_receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC, _room UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, _room)
$$;
GRANT EXECUTE ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_live_gift(UUID, TEXT, INTEGER, NUMERIC, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;

-- Withdrawal requests use only earned gift balance and need no earlier purchase.
CREATE OR REPLACE FUNCTION public.cupido_request_withdrawal(
  _amount NUMERIC,
  _country_code TEXT,
  _method TEXT,
  _account_details TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_id UUID := auth.uid();
  available NUMERIC(12,3);
  withdrawal_id UUID;
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount < 20 OR _amount > 100000 THEN RAISE EXCEPTION 'MINIMUM_WITHDRAWAL_USD_20'; END IF;
  IF NULLIF(btrim(_country_code), '') IS NULL OR NULLIF(btrim(_method), '') IS NULL
     OR NULLIF(btrim(_account_details), '') IS NULL THEN RAISE EXCEPTION 'WITHDRAWAL_DETAILS_REQUIRED'; END IF;
  SELECT balance INTO available FROM public.cupido_balances WHERE user_id = current_id FOR UPDATE;
  IF COALESCE(available, 0) < _amount THEN RAISE EXCEPTION 'INSUFFICIENT_WITHDRAWABLE_BALANCE'; END IF;
  UPDATE public.cupido_balances SET balance = balance - _amount, updated_at = now()
  WHERE user_id = current_id;
  INSERT INTO public.cupido_withdrawals (user_id, amount, country_code, method, account_details, status)
  VALUES (current_id, _amount, upper(btrim(_country_code)), btrim(_method), btrim(_account_details), 'pending')
  RETURNING id INTO withdrawal_id;
  RETURN withdrawal_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

GRANT INSERT ON public.live_comments TO authenticated;

-- Hosting requires a blue badge or the official/supreme admin account.
CREATE OR REPLACE FUNCTION public.cupido_start_live_room(_title TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.creator_profiles cp
    WHERE cp.id = auth.uid() AND (cp.is_verified_blue OR cp.is_official OR cp.is_super_admin)
  ) AND lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
    AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    RAISE EXCEPTION 'NOT_VERIFIED';
  END IF;
  INSERT INTO public.cupido_live_rooms (host_id, title)
  VALUES (auth.uid(), COALESCE(NULLIF(BTRIM(_title), ''), 'Live de Cupido Leudy ❤️'))
  RETURNING id INTO room_id;
  RETURN room_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_start_live_room(TEXT) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_balances'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_balances;
  END IF;
END;
$$;

-- Only the supreme admin has complimentary calls; every other account pays from its credit balance.
CREATE OR REPLACE FUNCTION public.cupido_start_call(_callee UUID, _mode TEXT, _video BOOLEAN DEFAULT FALSE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cost INTEGER;
  call_id UUID;
  is_supreme BOOLEAN := lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin_supremo');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _callee IS NULL OR _callee = auth.uid() THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;
  IF _mode NOT IN ('hot', 'cafe') THEN RAISE EXCEPTION 'INVALID_CALL_MODE'; END IF;
  cost := CASE WHEN _mode = 'hot' THEN 100 ELSE 50 END;
  IF NOT is_supreme THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.paypal_orders WHERE user_id = auth.uid() AND status = 'captured'
    ) AND NOT COALESCE((SELECT has_purchased FROM public.profiles WHERE id = auth.uid()), FALSE) THEN
      RAISE EXCEPTION 'PURCHASE_REQUIRED';
    END IF;
    PERFORM public.consume_credits(cost, 'Llamada privada ' || _mode);
  ELSE
    cost := 0;
  END IF;
  INSERT INTO public.cupido_calls (caller_id, callee_id, mode, video, credits_spent)
  VALUES (auth.uid(), _callee, _mode, COALESCE(_video, FALSE), cost)
  RETURNING id INTO call_id;
  RETURN call_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) TO authenticated;
