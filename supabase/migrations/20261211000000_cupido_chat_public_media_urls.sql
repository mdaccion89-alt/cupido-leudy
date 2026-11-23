BEGIN;

-- Chat messages now store public URLs. Keep object keys owner-scoped by conversation and sender.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('cupido-chat-media', 'cupido-chat-media', TRUE, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']::text[]),
  ('cupido-voice', 'cupido-voice', TRUE, 20971520,
    ARRAY['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/aac']::text[])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = TRUE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS cupido_chat_media_public_read ON storage.objects;
CREATE POLICY cupido_chat_media_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'cupido-chat-media');

DROP POLICY IF EXISTS cupido_chat_media_sender_insert ON storage.objects;
CREATE POLICY cupido_chat_media_sender_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cupido-chat-media'
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND split_part(name, '/', 2) = auth.uid()::text
    AND public.cupido_can_access_conversation(split_part(name, '/', 1)::uuid)
  );

DROP POLICY IF EXISTS cupido_voice_public_read ON storage.objects;
CREATE POLICY cupido_voice_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'cupido-voice');

DROP POLICY IF EXISTS cupido_voice_sender_insert ON storage.objects;
CREATE POLICY cupido_voice_sender_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cupido-voice'
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND split_part(name, '/', 2) = auth.uid()::text
    AND public.cupido_can_access_conversation(split_part(name, '/', 1)::uuid)
  );

-- Retain the legacy RPC signatures while routing every gift through the atomic balance engine.
CREATE OR REPLACE FUNCTION public.cupido_send_gift(
  _receiver uuid,
  _gift_id text,
  _credits integer,
  _cash_value numeric
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, NULL)
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_live_gift(
  _receiver uuid,
  _gift_id text,
  _credits integer,
  _cash_value numeric,
  _room uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cupido_transfer_gift(_receiver, _gift_id, _room)
$$;

REVOKE ALL ON FUNCTION public.cupido_send_gift(uuid, text, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_send_gift(uuid, text, integer, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.cupido_send_live_gift(uuid, text, integer, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_send_live_gift(uuid, text, integer, numeric, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
