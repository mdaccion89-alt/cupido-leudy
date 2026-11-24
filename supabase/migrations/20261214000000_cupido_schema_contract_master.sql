BEGIN;

-- Canonical gift ledger plus aliases found in deployed Cupido schema variants.
-- This table is created only when absent; existing rows and unrelated columns remain.
CREATE TABLE IF NOT EXISTS public.cupido_gift_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID,
  receiver_id UUID,
  gift_id TEXT,
  gift_name TEXT,
  credits INTEGER NOT NULL DEFAULT 0,
  coin_cost INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  cash_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cash NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cash_earned NUMERIC(12, 2) NOT NULL DEFAULT 0,
  usd_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  live_room_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipient_id UUID,
  to_user_id UUID,
  sender_user_id UUID,
  from_user_id UUID
);

ALTER TABLE public.cupido_gift_sends
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS sender_id UUID,
  ADD COLUMN IF NOT EXISTS receiver_id UUID,
  ADD COLUMN IF NOT EXISTS recipient_id UUID,
  ADD COLUMN IF NOT EXISTS to_user_id UUID,
  ADD COLUMN IF NOT EXISTS sender_user_id UUID,
  ADD COLUMN IF NOT EXISTS from_user_id UUID,
  ADD COLUMN IF NOT EXISTS gift_id TEXT,
  ADD COLUMN IF NOT EXISTS gift_name TEXT,
  ADD COLUMN IF NOT EXISTS credits INTEGER,
  ADD COLUMN IF NOT EXISTS coin_cost INTEGER,
  ADD COLUMN IF NOT EXISTS coins INTEGER,
  ADD COLUMN IF NOT EXISTS cash_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS cash NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS cash_earned NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS usd_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS live_room_id UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Preserve deployed data and migrate whichever cost/recipient aliases already exist.
DO $$
BEGIN
  IF to_regclass('public.cupido_gifts') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.cupido_gift_sends AS s
      SET credits = COALESCE(NULLIF(s.credits, 0), NULLIF(s.coin_cost, 0),
                             NULLIF(s.coins, 0), g.credits, 0),
          cash_value = COALESCE(NULLIF(s.cash_value, 0), NULLIF(s.cash, 0),
                                NULLIF(s.cash_earned, 0), NULLIF(s.usd_value, 0), g.cash, 0),
          gift_name = COALESCE(NULLIF(s.gift_name, ''), g.name)
      FROM public.cupido_gifts AS g
      WHERE g.id::text = s.gift_id::text
        AND (s.credits IS NULL OR s.credits = 0 OR s.gift_name IS NULL OR s.gift_name = '')
    $sql$;
    EXECUTE $sql$
      UPDATE public.cupido_gift_sends AS s
      SET cash_value = COALESCE(NULLIF(s.cash_value, 0), NULLIF(s.cash, 0),
                                NULLIF(s.cash_earned, 0), NULLIF(s.usd_value, 0), g.cash, 0)
      FROM public.cupido_gifts AS g
      WHERE g.id::text = s.gift_id::text
        AND (s.cash_value IS NULL OR s.cash_value = 0)
    $sql$;
  END IF;

  UPDATE public.cupido_gift_sends AS s
  SET sender_id = COALESCE(s.sender_id, NULLIF(s.sender_user_id::text, '')::uuid,
                           NULLIF(s.from_user_id::text, '')::uuid),
      receiver_id = COALESCE(s.receiver_id, NULLIF(s.recipient_id::text, '')::uuid,
                             NULLIF(s.to_user_id::text, '')::uuid),
      credits = COALESCE(NULLIF(s.credits, 0), NULLIF(s.coin_cost, 0), NULLIF(s.coins, 0), 0),
      coin_cost = COALESCE(NULLIF(s.coin_cost, 0), NULLIF(s.credits, 0), NULLIF(s.coins, 0), 0),
      coins = COALESCE(NULLIF(s.coins, 0), NULLIF(s.credits, 0), NULLIF(s.coin_cost, 0), 0),
      cash_value = COALESCE(NULLIF(s.cash_value, 0), NULLIF(s.cash, 0),
                            NULLIF(s.cash_earned, 0), NULLIF(s.usd_value, 0), 0),
      cash = COALESCE(NULLIF(s.cash, 0), NULLIF(s.cash_value, 0), NULLIF(s.cash_earned, 0), NULLIF(s.usd_value, 0), 0),
      cash_earned = COALESCE(NULLIF(s.cash_earned, 0), NULLIF(s.cash_value, 0), NULLIF(s.cash, 0), NULLIF(s.usd_value, 0), 0),
      usd_value = COALESCE(NULLIF(s.usd_value, 0), NULLIF(s.cash_value, 0), NULLIF(s.cash, 0), NULLIF(s.cash_earned, 0), 0),
      created_at = COALESCE(s.created_at, now());
END;
$$;

ALTER TABLE public.cupido_gift_sends
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN credits SET DEFAULT 0,
  ALTER COLUMN credits SET NOT NULL,
  ALTER COLUMN coin_cost SET DEFAULT 0,
  ALTER COLUMN coin_cost SET NOT NULL,
  ALTER COLUMN coins SET DEFAULT 0,
  ALTER COLUMN coins SET NOT NULL,
  ALTER COLUMN cash_value SET DEFAULT 0,
  ALTER COLUMN cash_value SET NOT NULL,
  ALTER COLUMN cash SET DEFAULT 0,
  ALTER COLUMN cash SET NOT NULL,
  ALTER COLUMN cash_earned SET DEFAULT 0,
  ALTER COLUMN cash_earned SET NOT NULL,
  ALTER COLUMN usd_value SET DEFAULT 0,
  ALTER COLUMN usd_value SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cupido_gift_sends_id_uidx
  ON public.cupido_gift_sends (id);
CREATE INDEX IF NOT EXISTS cupido_gift_sends_receiver_created_idx
  ON public.cupido_gift_sends (receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_gift_sends_live_room_idx
  ON public.cupido_gift_sends (live_room_id) WHERE live_room_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cupido_sync_gift_send_compat_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sender UUID;
  receiver UUID;
  amount INTEGER;
  payout NUMERIC(12, 2);
  row_json JSONB := to_jsonb(NEW);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN sender := NEW.sender_id;
    ELSIF NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id THEN sender := NEW.sender_user_id;
    ELSIF NEW.from_user_id IS DISTINCT FROM OLD.from_user_id THEN sender := NEW.from_user_id;
    END IF;
    IF NEW.receiver_id IS DISTINCT FROM OLD.receiver_id THEN receiver := NEW.receiver_id;
    ELSIF NEW.recipient_id IS DISTINCT FROM OLD.recipient_id THEN receiver := NEW.recipient_id;
    ELSIF NEW.to_user_id IS DISTINCT FROM OLD.to_user_id THEN receiver := NEW.to_user_id;
    END IF;
    IF NEW.credits IS DISTINCT FROM OLD.credits THEN amount := NEW.credits;
    ELSIF NEW.coin_cost IS DISTINCT FROM OLD.coin_cost THEN amount := NEW.coin_cost;
    ELSIF NEW.coins IS DISTINCT FROM OLD.coins THEN amount := NEW.coins;
    END IF;
    IF NEW.cash_value IS DISTINCT FROM OLD.cash_value THEN payout := NEW.cash_value;
    ELSIF NEW.cash IS DISTINCT FROM OLD.cash THEN payout := NEW.cash;
    ELSIF NEW.cash_earned IS DISTINCT FROM OLD.cash_earned THEN payout := NEW.cash_earned;
    ELSIF NEW.usd_value IS DISTINCT FROM OLD.usd_value THEN payout := NEW.usd_value;
    END IF;
  END IF;

  sender := COALESCE(sender,
    NULLIF(row_json->>'sender_id', '')::uuid,
    NULLIF(row_json->>'sender_user_id', '')::uuid,
    NULLIF(row_json->>'from_user_id', '')::uuid);
  receiver := COALESCE(receiver,
    NULLIF(row_json->>'receiver_id', '')::uuid,
    NULLIF(row_json->>'recipient_id', '')::uuid,
    NULLIF(row_json->>'to_user_id', '')::uuid);
  amount := COALESCE(amount,
    NULLIF(NULLIF(row_json->>'credits', '')::integer, 0),
    NULLIF(NULLIF(row_json->>'coin_cost', '')::integer, 0),
    NULLIF(NULLIF(row_json->>'coins', '')::integer, 0),
    0);
  payout := COALESCE(payout,
    NULLIF(NULLIF(row_json->>'cash_value', '')::numeric, 0),
    NULLIF(NULLIF(row_json->>'cash', '')::numeric, 0),
    NULLIF(NULLIF(row_json->>'cash_earned', '')::numeric, 0),
    NULLIF(NULLIF(row_json->>'usd_value', '')::numeric, 0),
    0);

  IF receiver IS NULL THEN RAISE EXCEPTION 'GIFT_RECEIVER_REQUIRED'; END IF;
  IF sender IS NULL THEN RAISE EXCEPTION 'GIFT_SENDER_REQUIRED'; END IF;
  IF amount < 0 THEN RAISE EXCEPTION 'GIFT_COIN_COST_INVALID'; END IF;

  NEW := jsonb_populate_record(NEW, jsonb_build_object(
    'sender_id', sender::text,
    'sender_user_id', sender::text,
    'from_user_id', sender::text,
    'receiver_id', receiver::text,
    'recipient_id', receiver::text,
    'to_user_id', receiver::text,
    'credits', amount,
    'coin_cost', amount,
    'coins', amount,
    'cash_value', payout,
    'cash', payout,
    'cash_earned', payout,
    'usd_value', payout,
    'gift_name', COALESCE(NULLIF(NEW.gift_name, ''), NEW.gift_id),
    'created_at', COALESCE(NEW.created_at, now())
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_sync_gift_receiver_columns ON public.cupido_gift_sends;
DROP TRIGGER IF EXISTS cupido_sync_gift_send_compat_columns ON public.cupido_gift_sends;
CREATE TRIGGER cupido_sync_gift_send_compat_columns
BEFORE INSERT OR UPDATE ON public.cupido_gift_sends
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_gift_send_compat_columns();

ALTER TABLE public.cupido_gift_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_gift_sends_participant_read ON public.cupido_gift_sends;
CREATE POLICY cupido_gift_sends_participant_read ON public.cupido_gift_sends
  FOR SELECT TO authenticated
  USING (
    sender_id = auth.uid()
    OR receiver_id = auth.uid()
    OR live_room_id IS NOT NULL
  );
GRANT SELECT ON public.cupido_gift_sends TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cupido_gift_sends FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(
  _receiver UUID,
  _gift_id TEXT,
  _room UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender UUID := auth.uid();
  sender_email TEXT;
  gift public.cupido_gifts%ROWTYPE;
  send_id UUID;
  infinite_admin BOOLEAN;
  new_balance INTEGER;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  SELECT lower(COALESCE(u.email, '')) INTO sender_email FROM auth.users AS u WHERE u.id = sender;
  infinite_admin := sender_email = 'leudyfeliz81@gmail.com';
  IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = _receiver) THEN
    RAISE EXCEPTION 'INVALID_RECEIVER';
  END IF;

  SELECT * INTO gift
  FROM public.cupido_gifts
  WHERE id = _gift_id
    AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
      OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;

  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms AS r
    WHERE r.id = _room AND r.is_live
      AND (r.host_id = _receiver OR EXISTS (
        SELECT 1 FROM public.cupido_live_pk_battles AS b
        WHERE b.room_id = _room AND b.challenger_id = _receiver
          AND b.finished_at IS NULL AND b.ends_at > now()
      ))
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;

  IF gift.id = 'gran-liga-diamond' AND NOT infinite_admin
     AND NOT EXISTS (
       SELECT 1 FROM public.creator_profiles AS cp
       WHERE cp.id = sender AND cp.is_gran_liga
     ) THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;

  IF NOT infinite_admin THEN
    PERFORM public.apply_daily_refill(sender);
    UPDATE public.user_credits
    SET balance = balance - gift.credits, updated_at = now()
    WHERE user_id = sender AND balance >= gift.credits
    RETURNING balance INTO new_balance;
    IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
    VALUES (sender, -gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;

  INSERT INTO public.cupido_gift_sends (
    sender_id, sender_user_id, from_user_id,
    receiver_id, recipient_id, to_user_id,
    gift_id, gift_name, credits, coin_cost, coins, cash_value, live_room_id
  ) VALUES (
    sender, sender, sender,
    _receiver, _receiver, _receiver,
    gift.id, gift.name, gift.credits, gift.credits, gift.credits, gift.cash, _room
  ) RETURNING id INTO send_id;

  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.cupido_balances.balance + EXCLUDED.balance,
        updated_at = now();

  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (
    _receiver,
    'Recibiste un regalo',
    CASE WHEN gift.id = 'gran-liga-diamond'
      THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
      ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.'
    END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END,
    sender,
    send_id
  );
  RETURN send_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_gift(
  _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC
)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, NULL)
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_live_gift(
  _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC, _room UUID
)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, _room)
$$;

REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;
REVOKE ALL ON FUNCTION public.cupido_send_live_gift(UUID, TEXT, INTEGER, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_send_live_gift(UUID, TEXT, INTEGER, NUMERIC, UUID) TO authenticated;

CREATE INDEX IF NOT EXISTS cupido_gift_sends_live_created_idx
  ON public.cupido_gift_sends (live_room_id, created_at DESC)
  WHERE live_room_id IS NOT NULL;

-- Public post/story upload bucket used by the Android feed and story composer.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cupido-media', 'cupido-media', TRUE, 52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif',
        'video/mp4','video/quicktime','video/webm','video/x-matroska',
        'video/3gpp','video/x-m4v','video/hevc','video/h265','application/octet-stream']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = TRUE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS cupido_media_public_read ON storage.objects;
CREATE POLICY cupido_media_public_read ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id IN ('media', 'cupido-media'));
DROP POLICY IF EXISTS cupido_media_owner_insert ON storage.objects;
CREATE POLICY cupido_media_owner_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id IN ('media', 'cupido-media')
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
DROP POLICY IF EXISTS cupido_media_owner_update ON storage.objects;
CREATE POLICY cupido_media_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('media', 'cupido-media') AND (storage.foldername(name))[1] = auth.uid()::TEXT)
  WITH CHECK (bucket_id IN ('media', 'cupido-media') AND (storage.foldername(name))[1] = auth.uid()::TEXT);
DROP POLICY IF EXISTS cupido_media_owner_delete ON storage.objects;
CREATE POLICY cupido_media_owner_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id IN ('media', 'cupido-media')
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- Idempotently ensure the chat audio/photo buckets and conversation-scoped uploads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('cupido-chat-media', 'cupido-chat-media', TRUE, 10485760,
   ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']::text[]),
  ('cupido-voice', 'cupido-voice', TRUE, 20971520,
   ARRAY['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/aac']::text[])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = TRUE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS cupido_chat_media_public_read ON storage.objects;
CREATE POLICY cupido_chat_media_public_read ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'cupido-chat-media');
DROP POLICY IF EXISTS cupido_chat_media_sender_insert ON storage.objects;
CREATE POLICY cupido_chat_media_sender_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'cupido-chat-media'
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND split_part(name, '/', 2) = auth.uid()::TEXT
    AND public.cupido_can_access_conversation(split_part(name, '/', 1)::UUID)
  );
DROP POLICY IF EXISTS cupido_voice_public_read ON storage.objects;
CREATE POLICY cupido_voice_public_read ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'cupido-voice');
DROP POLICY IF EXISTS cupido_voice_sender_insert ON storage.objects;
CREATE POLICY cupido_voice_sender_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'cupido-voice'
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND split_part(name, '/', 2) = auth.uid()::TEXT
    AND public.cupido_can_access_conversation(split_part(name, '/', 1)::UUID)
  );

-- Private upload buckets used by the studio, verification, and song server functions.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('uploads', 'uploads', FALSE, 26214400),
  ('cupido-private', 'cupido-private', FALSE, 52428800),
  ('songs', 'songs', FALSE, 104857600),
  ('site', 'site', FALSE, 52428800)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

DROP POLICY IF EXISTS cupido_uploads_owner_insert ON storage.objects;
CREATE POLICY cupido_uploads_owner_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'uploads' AND split_part(name, '/', 1) = auth.uid()::TEXT
  );
DROP POLICY IF EXISTS cupido_uploads_owner_read ON storage.objects;
CREATE POLICY cupido_uploads_owner_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'uploads' AND split_part(name, '/', 1) = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS cupido_private_verification_owner_insert ON storage.objects;
CREATE POLICY cupido_private_verification_owner_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'cupido-private'
    AND split_part(name, '/', 1) = auth.uid()::TEXT
    AND split_part(name, '/', 2) = 'verification'
  );
DROP POLICY IF EXISTS cupido_private_verification_admin_read ON storage.objects;
CREATE POLICY cupido_private_verification_admin_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'cupido-private'
    AND split_part(name, '/', 2) = 'verification'
    AND (
      split_part(name, '/', 1) = auth.uid()::TEXT
      OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    )
  );

-- Keep the live gift table available to authenticated Realtime subscribers.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'cupido_gift_sends'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_gift_sends;
  END IF;
END;
$$;

-- Return missing names from the app's statically referenced public relations,
-- RPCs and storage buckets. Empty result means those references exist on this DB.
WITH expected(kind, object_name) AS (
  VALUES
    ('relation','app_settings'),('relation','creator_profiles'),('relation','cupido_balances'),
    ('relation','cupido_calls'),('relation','cupido_comment_likes'),('relation','cupido_conversations'),
    ('relation','cupido_creator_club_subscriptions'),('relation','cupido_creator_clubs'),
    ('relation','cupido_face_verification_videos'),('relation','cupido_gift_sends'),
    ('relation','cupido_group_invites'),('relation','cupido_groups'),('relation','cupido_likes'),
    ('relation','cupido_live_guest_sessions'),('relation','cupido_live_room_moderators'),
    ('relation','cupido_live_rooms'),('relation','cupido_live_roulette_configs'),
    ('relation','cupido_live_signals'),('relation','cupido_live_treasures'),('relation','cupido_live_viewers'),
    ('relation','cupido_login_metadata'),('relation','cupido_message_hides'),('relation','cupido_messages'),
    ('relation','cupido_pk_requests'),('relation','cupido_post_comments'),('relation','cupido_post_dislikes'),
    ('relation','cupido_post_likes'),('relation','cupido_post_saves'),('relation','cupido_posts'),
    ('relation','cupido_public_profiles'),('relation','cupido_referrals'),('relation','cupido_reports'),
    ('relation','cupido_saved_posts'),('relation','cupido_stories'),('relation','cupido_story_hearts'),
    ('relation','cupido_story_hides'),('relation','cupido_story_views'),('relation','cupido_support_tickets'),
    ('relation','cupido_user_blocks'),('relation','cupido_withdrawals'),('relation','follows'),
    ('relation','friend_requests'),('relation','live_comments'),('relation','notifications'),
    ('relation','payment_settings'),('relation','paypal_orders'),('relation','profiles'),
    ('relation','site_settings'),('relation','support_messages'),('relation','user_credits'),
    ('relation','user_roles'),('relation','songs'),('relation','stories'),
    ('relation','cupido_friends'),('relation','cupido_group_members'),
    ('relation','cupido_live_access'),('relation','cupido_live_moderation_log'),
    ('relation','cupido_post_metric_events'),('relation','cupido_story_reports'),
    ('relation','cupido_terms_acceptance'),('relation','cupido_video_watch_events'),
    ('relation','credit_transactions'),('relation','live_streams'),('relation','manual_payments'),
    ('relation','messages'),('relation','posts'),('relation','cupido_follower_count_events'),
    ('column','cupido_gift_sends.credits'),('column','cupido_gift_sends.coins'),
    ('column','cupido_gift_sends.coin_cost'),('column','cupido_gift_sends.cash_value'),
    ('column','cupido_gift_sends.receiver_id'),('column','cupido_gift_sends.live_room_id'),
    ('signature','public.cupido_transfer_gift(uuid,text,uuid)'),
    ('signature','public.cupido_send_gift(uuid,text,integer,numeric)'),
    ('signature','public.cupido_send_live_gift(uuid,text,integer,numeric,uuid)'),
    ('trigger','cupido_gift_sends.cupido_sync_gift_send_compat_columns'),
    ('policy','cupido_gift_sends.cupido_gift_sends_participant_read'),
    ('rpc','admin_adjust_credits'),('rpc','admin_set_plan'),('rpc','consume_credits'),
    ('rpc','cupido_accept_terms'),('rpc','cupido_adapt_legacy_profile'),('rpc','cupido_add_post_comment'),
    ('rpc','cupido_admin_auto_follow'),('rpc','cupido_admin_auto_terms'),
    ('rpc','cupido_admin_remove_reported_comment'),('rpc','cupido_admin_set_user_verified'),
    ('rpc','cupido_admin_suspend_reported_user'),('rpc','cupido_answer_call'),
    ('rpc','cupido_bill_call_minute'),('rpc','cupido_claim_ad_reward'),('rpc','cupido_claim_daily_reward'),
    ('rpc','cupido_claim_live_treasure'),('rpc','cupido_count_followers'),('rpc','cupido_count_followers_batch'),
    ('rpc','cupido_create_group'),('rpc','cupido_create_notification'),('rpc','cupido_delete_message'),
    ('rpc','cupido_edit_message'),('rpc','cupido_end_call'),('rpc','cupido_end_live_guest'),
    ('rpc','cupido_end_live_room'),('rpc','cupido_end_stale_lives'),('rpc','cupido_finalize_paypal_package'),
    ('rpc','cupido_finish_live_pk_battle'),('rpc','cupido_get_live_earnings'),
    ('rpc','cupido_get_live_gift_total'),('rpc','cupido_get_live_pk_state'),('rpc','cupido_get_live_top_fans'),
    ('rpc','cupido_get_studio_analytics'),('rpc','cupido_get_video_watch_seconds'),
    ('rpc','cupido_get_weekly_ranking'),('rpc','cupido_invite_group_friend'),('rpc','cupido_invite_live_guest'),
    ('rpc','cupido_list_followers'),('rpc','cupido_list_friends'),('rpc','cupido_live_heartbeat'),
    ('rpc','cupido_moderate_live_user'),('rpc','cupido_open_conversation'),('rpc','cupido_open_support_ticket'),
    ('rpc','cupido_pay_live_entry'),('rpc','cupido_promote_post'),('rpc','cupido_public_paypal_client_id'),
    ('rpc','cupido_record_video_watch'),('rpc','cupido_register_post_share'),
    ('rpc','cupido_register_post_view'),('rpc','cupido_reply_support_ticket'),('rpc','cupido_report_comment'),
    ('rpc','cupido_request_live_guest'),('rpc','cupido_request_pk'),('rpc','cupido_request_withdrawal'),
    ('rpc','cupido_respond_group_invite'),('rpc','cupido_respond_live_guest'),('rpc','cupido_respond_pk'),
    ('rpc','cupido_review_face_verification_video'),('rpc','cupido_review_verification'),
    ('rpc','cupido_review_withdrawal'),('rpc','cupido_send_gift'),('rpc','cupido_send_live_comment'),
    ('rpc','cupido_send_live_gift'),('rpc','cupido_set_creator_club_price'),('rpc','cupido_set_like'),
    ('rpc','cupido_set_live_call_minute_price'),('rpc','cupido_set_live_coin_goal'),
    ('rpc','cupido_set_live_moderator'),('rpc','cupido_set_live_roulette'),('rpc','cupido_start_call'),
    ('rpc','cupido_start_live_room'),('rpc','cupido_start_live_treasure'),('rpc','cupido_start_premium_live'),
    ('rpc','cupido_story_view'),('rpc','cupido_submit_face_verification_selfie'),
    ('rpc','cupido_submit_face_verification_video'),('rpc','cupido_subscribe_creator_club'),
    ('rpc','cupido_sync_my_profile'),('rpc','cupido_toggle_comment_like'),('rpc','cupido_toggle_post_dislike'),
    ('rpc','cupido_toggle_post_like'),('rpc','cupido_toggle_post_save'),('rpc','cupido_transfer_gift'),
    ('rpc','cupido_unread_message_count'),('rpc','cupido_update_login_metadata'),('rpc','effective_plan'),
    ('rpc','ensure_my_profile'),('rpc','grant_credits'),('rpc','has_role'),('rpc','refresh_my_credits'),
    ('rpc','verify_license'),
    ('bucket','cupido-chat-media'),('bucket','cupido-media'),('bucket','cupido-private'),
    ('bucket','cupido-voice'),('bucket','media'),('bucket','site'),('bucket','songs'),('bucket','uploads')
)
SELECT expected.kind, expected.object_name AS missing_object
FROM expected
WHERE CASE expected.kind
  WHEN 'relation' THEN to_regclass(format('public.%I', expected.object_name)) IS NULL
  WHEN 'rpc' THEN NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = expected.object_name
  )
  WHEN 'bucket' THEN NOT EXISTS (
    SELECT 1 FROM storage.buckets b WHERE b.id = expected.object_name
  )
  WHEN 'column' THEN NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = split_part(expected.object_name, '.', 1)
      AND c.column_name = split_part(expected.object_name, '.', 2)
  )
  WHEN 'signature' THEN to_regprocedure(expected.object_name) IS NULL
  WHEN 'trigger' THEN NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = to_regclass('public.' || split_part(expected.object_name, '.', 1))
      AND t.tgname = split_part(expected.object_name, '.', 2)
      AND NOT t.tgisinternal
  )
  WHEN 'policy' THEN NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = split_part(expected.object_name, '.', 1)
      AND p.policyname = split_part(expected.object_name, '.', 2)
  )
  ELSE TRUE
END
ORDER BY expected.kind, expected.object_name;

NOTIFY pgrst, 'reload schema';
COMMIT;
