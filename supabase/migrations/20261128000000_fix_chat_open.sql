BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cupido_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_b UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_a, participant_b),
  CHECK (participant_a < participant_b)
);

ALTER TABLE public.cupido_conversations
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cupido_conversations' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.cupido_conversations ADD COLUMN id UUID DEFAULT gen_random_uuid();
    UPDATE public.cupido_conversations SET id = gen_random_uuid() WHERE id IS NULL;
    ALTER TABLE public.cupido_conversations ADD PRIMARY KEY (id);
  END IF;
END $$;

DO $$
DECLARE policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cupido_conversations'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.cupido_conversations', policy_row.policyname);
  END LOOP;
END $$;

DO $$
DECLARE constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.cupido_conversations'::regclass
      AND contype IN ('f', 'u', 'c')
  LOOP
    EXECUTE format('ALTER TABLE public.cupido_conversations DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  has_participant_a BOOLEAN;
  has_participant_b BOOLEAN;
  has_user_a BOOLEAN;
  has_user_b BOOLEAN;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cupido_conversations' AND column_name = 'participant_a'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cupido_conversations' AND column_name = 'participant_b'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cupido_conversations' AND column_name = 'user_a'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cupido_conversations' AND column_name = 'user_b')
  INTO has_participant_a, has_participant_b, has_user_a, has_user_b;

  IF NOT has_participant_a AND has_user_a THEN
    ALTER TABLE public.cupido_conversations RENAME COLUMN user_a TO participant_a;
    has_participant_a := TRUE;
    has_user_a := FALSE;
  END IF;

  IF NOT has_participant_b AND has_user_b THEN
    ALTER TABLE public.cupido_conversations RENAME COLUMN user_b TO participant_b;
    has_participant_b := TRUE;
    has_user_b := FALSE;
  END IF;

  IF NOT has_participant_a THEN
    ALTER TABLE public.cupido_conversations ADD COLUMN participant_a UUID;
  END IF;

  IF NOT has_participant_b THEN
    ALTER TABLE public.cupido_conversations ADD COLUMN participant_b UUID;
  END IF;
END $$;

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cupido_conversations' AND column_name = 'user_a'
  ) THEN
    UPDATE public.cupido_conversations SET participant_a = COALESCE(participant_a, user_a);
    ALTER TABLE public.cupido_conversations DROP COLUMN user_a;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cupido_conversations' AND column_name = 'user_b'
  ) THEN
    UPDATE public.cupido_conversations SET participant_b = COALESCE(participant_b, user_b);
    ALTER TABLE public.cupido_conversations DROP COLUMN user_b;
  END IF;
END $$;

DO $$
DECLARE invalid_ids UUID[];
BEGIN
  SELECT array_agg(c.id)
  INTO invalid_ids
  FROM public.cupido_conversations c
  WHERE c.participant_a IS NULL
     OR c.participant_b IS NULL
     OR c.participant_a = c.participant_b
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.participant_a)
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.participant_b);

  IF invalid_ids IS NOT NULL THEN
    IF to_regclass('public.cupido_messages') IS NOT NULL THEN
      DELETE FROM public.cupido_messages WHERE conversation_id = ANY (invalid_ids);
    END IF;
    DELETE FROM public.cupido_conversations WHERE id = ANY (invalid_ids);
  END IF;
END $$;

UPDATE public.cupido_conversations SET created_at = now() WHERE created_at IS NULL;

WITH ranked AS (
  SELECT
    c.id,
    row_number() OVER (
      PARTITION BY LEAST(c.participant_a, c.participant_b), GREATEST(c.participant_a, c.participant_b)
      ORDER BY c.created_at, c.id
    ) AS rn,
    first_value(c.id) OVER (
      PARTITION BY LEAST(c.participant_a, c.participant_b), GREATEST(c.participant_a, c.participant_b)
      ORDER BY c.created_at, c.id
    ) AS keeper_id
  FROM public.cupido_conversations c
), moved AS (
  UPDATE public.cupido_messages m
  SET conversation_id = ranked.keeper_id
  FROM ranked
  WHERE m.conversation_id = ranked.id
    AND ranked.rn > 1
    AND ranked.keeper_id <> ranked.id
  RETURNING m.id
)
DELETE FROM public.cupido_conversations c
USING ranked
WHERE c.id = ranked.id
  AND ranked.rn > 1;

UPDATE public.cupido_conversations
SET participant_a = LEAST(participant_a, participant_b),
    participant_b = GREATEST(participant_a, participant_b)
WHERE participant_a > participant_b;

ALTER TABLE public.cupido_conversations ALTER COLUMN participant_a SET NOT NULL;
ALTER TABLE public.cupido_conversations ALTER COLUMN participant_b SET NOT NULL;
ALTER TABLE public.cupido_conversations ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.cupido_conversations
  ADD CONSTRAINT cupido_conversations_participant_a_fkey
  FOREIGN KEY (participant_a) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.cupido_conversations
  ADD CONSTRAINT cupido_conversations_participant_b_fkey
  FOREIGN KEY (participant_b) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.cupido_conversations
  ADD CONSTRAINT cupido_conversations_participant_a_participant_b_key
  UNIQUE (participant_a, participant_b);
ALTER TABLE public.cupido_conversations
  ADD CONSTRAINT cupido_conversations_participant_a_participant_b_check
  CHECK (participant_a < participant_b);

ALTER TABLE public.cupido_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY cupido_conversations_participant_read ON public.cupido_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() IN (participant_a, participant_b));

CREATE POLICY cupido_conversations_participant_insert ON public.cupido_conversations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (participant_a, participant_b) AND participant_a < participant_b);

GRANT SELECT, INSERT ON public.cupido_conversations TO authenticated;
GRANT ALL ON public.cupido_conversations TO service_role;

DROP FUNCTION IF EXISTS public.cupido_open_conversation(UUID);
DROP FUNCTION IF EXISTS public.cupido_get_or_create_conversation(UUID);

CREATE OR REPLACE FUNCTION public.cupido_open_conversation(_other UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me UUID := auth.uid();
  low UUID;
  high UUID;
  conversation_id UUID;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF _other IS NULL OR _other = me THEN
    RAISE EXCEPTION 'INVALID_RECIPIENT' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _other) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  low := LEAST(me, _other);
  high := GREATEST(me, _other);

  INSERT INTO public.cupido_conversations (participant_a, participant_b)
  VALUES (low, high)
  ON CONFLICT ON CONSTRAINT cupido_conversations_participant_a_participant_b_key DO NOTHING;

  SELECT id INTO conversation_id
  FROM public.cupido_conversations
  WHERE participant_a = low AND participant_b = high;

  IF conversation_id IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_CREATE_FAILED' USING ERRCODE = 'P0001';
  END IF;

  RETURN conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_get_or_create_conversation(_other UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.cupido_open_conversation(_other);
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_can_access_conversation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cupido_open_conversation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cupido_get_or_create_conversation(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cupido_can_access_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_open_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_get_or_create_conversation(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
