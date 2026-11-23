-- Normalize gift recipients across deployed schema variants before any RPC inserts.
ALTER TABLE public.cupido_gift_sends
  ADD COLUMN IF NOT EXISTS receiver_id UUID,
  ADD COLUMN IF NOT EXISTS live_room_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cupido_gift_sends' AND column_name = 'recipient_id'
  ) THEN
    EXECUTE 'UPDATE public.cupido_gift_sends SET receiver_id = COALESCE(receiver_id, NULLIF(recipient_id::text, '''')::uuid) WHERE receiver_id IS NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cupido_gift_sends' AND column_name = 'to_user_id'
  ) THEN
    EXECUTE 'UPDATE public.cupido_gift_sends SET receiver_id = COALESCE(receiver_id, NULLIF(to_user_id::text, '''')::uuid) WHERE receiver_id IS NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cupido_gift_sends' AND column_name = 'recipient_id'
  ) THEN
    EXECUTE 'UPDATE public.cupido_gift_sends SET recipient_id = receiver_id WHERE receiver_id IS NOT NULL AND recipient_id IS DISTINCT FROM receiver_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cupido_gift_sends' AND column_name = 'to_user_id'
  ) THEN
    EXECUTE 'UPDATE public.cupido_gift_sends SET to_user_id = receiver_id WHERE receiver_id IS NOT NULL AND to_user_id IS DISTINCT FROM receiver_id';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_sync_gift_receiver_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  receiver UUID;
BEGIN
  receiver := COALESCE(
    NULLIF(to_jsonb(NEW)->>'receiver_id', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'recipient_id', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'to_user_id', '')::uuid
  );
  IF receiver IS NULL THEN
    RAISE EXCEPTION 'GIFT_RECEIVER_REQUIRED';
  END IF;
  NEW := jsonb_populate_record(NEW, jsonb_build_object(
    'receiver_id', receiver::text,
    'recipient_id', receiver::text,
    'to_user_id', receiver::text
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_sync_gift_receiver_columns ON public.cupido_gift_sends;
CREATE TRIGGER cupido_sync_gift_receiver_columns
BEFORE INSERT OR UPDATE ON public.cupido_gift_sends
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_gift_receiver_columns();

CREATE INDEX IF NOT EXISTS cupido_gift_sends_receiver_created_idx
  ON public.cupido_gift_sends (receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_gift_sends_live_room_idx
  ON public.cupido_gift_sends (live_room_id) WHERE live_room_id IS NOT NULL;

-- Keep the public profile projection and the private profile verification state aligned.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'none';

UPDATE public.profiles AS p
SET is_verified = cp.is_verified_blue,
    verification_status = cp.verification_status
FROM public.creator_profiles AS cp
WHERE cp.id = p.id
  AND (p.is_verified IS DISTINCT FROM cp.is_verified_blue
       OR p.verification_status IS DISTINCT FROM cp.verification_status);

CREATE OR REPLACE FUNCTION public.cupido_admin_set_user_verified(_user_id UUID, _verified BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL OR _verified IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  UPDATE public.creator_profiles
  SET is_verified_blue = _verified,
      verification_status = CASE WHEN _verified THEN 'approved' ELSE 'rejected' END
  WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  UPDATE public.profiles
  SET is_verified = _verified,
      verification_status = CASE WHEN _verified THEN 'approved' ELSE 'rejected' END,
      updated_at = now()
  WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;

  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id, action_url)
  VALUES (
    _user_id,
    CASE WHEN _verified THEN 'Insignia azul activada' ELSE 'Insignia azul retirada' END,
    CASE WHEN _verified THEN 'El Administrador Oficial activó tu insignia azul.'
      ELSE 'El Administrador Oficial retiró tu insignia azul.' END,
    'verification', auth.uid(), _user_id, '/perfil'
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_admin_set_user_verified(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_admin_set_user_verified(UUID, BOOLEAN) TO authenticated;

-- A single atomic gift path is shared by direct chat, regular Lives, and PK Lives.
CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(_receiver UUID, _gift_id TEXT, _room UUID DEFAULT NULL)
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
  is_infinite_admin BOOLEAN;
  new_balance INTEGER;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  SELECT lower(COALESCE(u.email, '')) INTO sender_email FROM auth.users u WHERE u.id = sender;
  is_infinite_admin := sender_email = 'leudyfeliz81@gmail.com';
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _receiver) THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;

  SELECT * INTO gift FROM public.cupido_gifts
  WHERE id = _gift_id AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
    OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;
  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = _room AND r.is_live
      AND (r.host_id = _receiver OR EXISTS (
        SELECT 1 FROM public.cupido_live_pk_battles b WHERE b.room_id = _room
          AND b.challenger_id = _receiver AND b.finished_at IS NULL AND b.ends_at > now()
      ))
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;
  IF gift.id = 'gran-liga-diamond' AND NOT is_infinite_admin
    AND NOT EXISTS (SELECT 1 FROM public.creator_profiles cp WHERE cp.id = sender AND cp.is_gran_liga) THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;
  IF NOT is_infinite_admin THEN
    PERFORM public.apply_daily_refill(sender);
    UPDATE public.user_credits SET balance = balance - gift.credits, updated_at = now()
    WHERE user_id = sender AND balance >= gift.credits RETURNING balance INTO new_balance;
    IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
    VALUES (sender, -gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;

  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value, live_room_id)
  VALUES (sender, _receiver, gift.id, gift.credits, gift.cash, _room) RETURNING id INTO send_id;
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + EXCLUDED.balance,
    updated_at = now();
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (_receiver, 'Recibiste un regalo', CASE WHEN gift.id = 'gran-liga-diamond'
      THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
      ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.' END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END, sender, send_id);
  RETURN send_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) TO authenticated;

DO $$
DECLARE table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY['profiles', 'creator_profiles', 'cupido_gift_sends', 'cupido_balances', 'cupido_live_rooms'] LOOP
      IF to_regclass(format('public.%I', table_name)) IS NOT NULL
         AND NOT EXISTS (
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
