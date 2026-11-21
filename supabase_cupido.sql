-- Cupido Leudy ❤️ — migración idempotente (ejecutar en el SQL Editor de Supabase)
-- Citas, chat social, videos cortos, verificación azul, regalos, retiros y términos.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas en perfiles existentes (no rompe autenticación ni créditos)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS theme_mode TEXT NOT NULL DEFAULT 'dark' CHECK (theme_mode IN ('dark', 'light')),
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sounds_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'DO',
  ADD COLUMN IF NOT EXISTS looking_for TEXT NOT NULL DEFAULT 'amistad',
  ADD COLUMN IF NOT EXISTS drinks BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_kids BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selfie_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS verification_frames TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'none'
    CHECK (verification_status IN ('none', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS is_verified_blue BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_cupido_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS friend_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. Tablas de la plataforma
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cupido_terms_acceptance (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_likes (
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('interested', 'pass')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, target_id),
  CHECK (actor_id <> target_id)
);

CREATE TABLE IF NOT EXISTS public.cupido_friends (
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE TABLE IF NOT EXISTS public.cupido_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  caption TEXT NOT NULL DEFAULT '',
  media_path TEXT NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_post_likes (
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('hot', 'cafe')),
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'rejected')),
  credits_spent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_gift_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gift_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  cash_value NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_balances (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cupido_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  country_code TEXT NOT NULL,
  method TEXT NOT NULL,
  account_details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cupido_posts_created_idx ON public.cupido_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_messages_conversation_idx ON public.cupido_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS cupido_friends_addressee_idx ON public.cupido_friends (addressee_id, status);
CREATE INDEX IF NOT EXISTS cupido_withdrawals_status_idx ON public.cupido_withdrawals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_gift_sends_receiver_idx ON public.cupido_gift_sends (receiver_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Funciones de negocio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cupido_accept_terms(_version TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.cupido_terms_acceptance (user_id, version, accepted_at)
  VALUES (auth.uid(), _version, now())
  ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, accepted_at = now();
  UPDATE public.profiles SET terms_accepted_at = now(), updated_at = now() WHERE id = auth.uid();
END $$;

-- El Admin Supremo acepta los términos al instante, sin modal.
CREATE OR REPLACE FUNCTION public.cupido_admin_auto_terms()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF public.has_role(auth.uid(), 'admin') THEN
    PERFORM public.cupido_accept_terms('2026-01');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_admin_auto_follow()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE admin_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF lower(coalesce(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' THEN
    UPDATE public.creator_profiles SET is_super_admin = true WHERE id = auth.uid();
  END IF;
  SELECT id INTO admin_id FROM public.profiles
    WHERE lower(email) = 'leudyfeliz81@gmail.com'
    ORDER BY created_at ASC
    LIMIT 1;
  IF admin_id IS NULL OR admin_id = auth.uid() THEN RETURN; END IF;
  INSERT INTO public.follows (follower_id, following_id)
  VALUES (admin_id, auth.uid())
  ON CONFLICT (follower_id, following_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_save_profile(
  _display_name TEXT, _bio TEXT, _country_code TEXT,
  _looking_for TEXT, _drinks BOOLEAN, _has_kids BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.creator_profiles SET
    display_name = left(coalesce(nullif(trim(_display_name), ''), 'Miembro'), 60),
    bio = left(coalesce(_bio, ''), 300),
    country_code = coalesce(nullif(_country_code, ''), 'DO'),
    looking_for = coalesce(nullif(_looking_for, ''), 'amistad'),
    drinks = coalesce(_drinks, false),
    has_kids = coalesce(_has_kids, false)
  WHERE id = auth.uid();
  UPDATE public.profiles SET display_name = left(coalesce(nullif(trim(_display_name), ''), 'Miembro'), 60),
    country_code = coalesce(nullif(_country_code, ''), 'DO'), updated_at = now() WHERE id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.cupido_set_avatar(_url TEXT, _moderation TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.creator_profiles
  SET avatar_url = left(coalesce(_url, ''), 1000),
      moderation_status = CASE WHEN _moderation IN ('pending','rejected') THEN _moderation ELSE 'approved' END
  WHERE id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.cupido_submit_selfie(_path TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.creator_profiles SET selfie_path = left(_path, 1000),
    verification_status = 'pending' WHERE id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.cupido_review_verification(_user_id UUID, _approve BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.creator_profiles SET
    verification_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    is_verified_blue = _approve
  WHERE id = _user_id;
  INSERT INTO public.notifications (user_id, title, body) VALUES (
    _user_id,
    CASE WHEN _approve THEN 'Verificación aprobada' ELSE 'Verificación rechazada' END,
    CASE WHEN _approve THEN 'Tu selfie fue aprobada. Ya tienes la insignia azul verificada.'
         ELSE 'Tu selfie no cumplió los requisitos. Puedes enviar otra.' END
  );
END $$;

CREATE OR REPLACE FUNCTION public.cupido_open_conversation(_other UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := auth.uid(); a UUID; b UUID; cid UUID;
BEGIN
  IF me IS NULL OR _other IS NULL OR _other = me THEN RAISE EXCEPTION 'INVALID'; END IF;
  IF me < _other THEN a := me; b := _other; ELSE a := _other; b := me; END IF;
  INSERT INTO public.cupido_conversations (participant_a, participant_b) VALUES (a, b)
    ON CONFLICT (participant_a, participant_b) DO NOTHING;
  SELECT id INTO cid FROM public.cupido_conversations WHERE participant_a = a AND participant_b = b;
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_can_access_conversation(_conversation UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cupido_conversations c
    WHERE c.id = _conversation AND auth.uid() IN (c.participant_a, c.participant_b)
  )
$$;

CREATE OR REPLACE FUNCTION public.cupido_send_gift(
  _receiver UUID, _gift_id TEXT, _credits INTEGER, _cash_value NUMERIC
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = auth.uid() THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;
  IF _credits IS NULL OR _credits <= 0 OR _cash_value IS NULL OR _cash_value <= 0 THEN
    RAISE EXCEPTION 'INVALID_GIFT';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    UPDATE public.user_credits SET balance = balance - _credits, updated_at = now()
      WHERE user_id = auth.uid() AND balance >= _credits;
    IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
      VALUES (auth.uid(), -_credits, 'Regalo enviado en Cupido Leudy');
  END IF;
  INSERT INTO public.cupido_balances (user_id, balance) VALUES (_receiver, _cash_value)
    ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + _cash_value,
      updated_at = now();
  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
    VALUES (auth.uid(), _receiver, _gift_id, _credits, _cash_value) RETURNING id INTO gid;
  INSERT INTO public.notifications (user_id, title, body) VALUES (
    _receiver, 'Recibiste un regalo ❤️', 'El valor de tu regalo ya está disponible como saldo retirable.'
  );
  RETURN gid;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_request_withdrawal(
  _amount NUMERIC, _country_code TEXT, _method TEXT, _account_details TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount IS NULL OR _amount < 20 THEN RAISE EXCEPTION 'MINIMUM_20_USD'; END IF;
  UPDATE public.cupido_balances SET balance = balance - _amount, updated_at = now()
    WHERE user_id = auth.uid() AND balance >= _amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  INSERT INTO public.cupido_withdrawals (user_id, amount, country_code, method, account_details)
  VALUES (auth.uid(), _amount, left(coalesce(_country_code,'DO'),2), left(coalesce(_method,'PayPal'),60),
    left(coalesce(_account_details,''), 500)) RETURNING id INTO wid;
  RETURN wid;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_review_withdrawal(_id UUID, _approve BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO w FROM public.cupido_withdrawals WHERE id = _id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_PENDING'; END IF;
  UPDATE public.cupido_withdrawals SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    reviewed_at = now() WHERE id = _id;
  IF NOT _approve THEN
    INSERT INTO public.cupido_balances (user_id, balance) VALUES (w.user_id, w.amount)
      ON CONFLICT (user_id) DO UPDATE SET balance = public.cupido_balances.balance + w.amount,
        updated_at = now();
  END IF;
  INSERT INTO public.notifications (user_id, title, body) VALUES (
    w.user_id,
    CASE WHEN _approve THEN 'Retiro aprobado' ELSE 'Retiro rechazado' END,
    CASE WHEN _approve THEN 'Tu retiro fue aprobado y enviado al método elegido.'
         ELSE 'Tu retiro fue rechazado; el saldo fue devuelto.' END
  );
END $$;

CREATE OR REPLACE FUNCTION public.cupido_start_call(_callee UUID, _mode TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cost INTEGER; cid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _callee IS NULL OR _callee = auth.uid() THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;
  cost := CASE WHEN _mode = 'hot' THEN 100 ELSE 50 END;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    PERFORM public.consume_credits(cost, 'Llamada ' || _mode || ' en Cupido Leudy');
  ELSE
    cost := 0;
  END IF;
  INSERT INTO public.cupido_calls (caller_id, callee_id, mode, credits_spent)
    VALUES (auth.uid(), _callee, _mode, cost) RETURNING id INTO cid;
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_answer_call(_id UUID, _accept BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO c FROM public.cupido_calls WHERE id = _id AND status = 'ringing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_RINGING'; END IF;
  IF auth.uid() <> c.callee_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.cupido_calls SET status = CASE WHEN _accept THEN 'active' ELSE 'rejected' END WHERE id = _id;
  IF NOT _accept AND c.credits_spent > 0 THEN
    UPDATE public.user_credits SET balance = balance + c.credits_spent, updated_at = now()
      WHERE user_id = c.caller_id;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
      VALUES (c.caller_id, c.credits_spent, 'Reembolso por llamada rechazada');
    UPDATE public.cupido_calls SET credits_spent = 0 WHERE id = _id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_end_call(_id UUID, _status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO c FROM public.cupido_calls WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF auth.uid() NOT IN (c.caller_id, c.callee_id) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF c.status IN ('ended', 'rejected') THEN RETURN; END IF;
  UPDATE public.cupido_calls SET status = CASE WHEN _status = 'rejected' THEN 'rejected' ELSE 'ended' END
    WHERE id = _id;
  IF c.credits_spent > 0 AND _status = 'rejected' THEN
    UPDATE public.user_credits SET balance = balance + c.credits_spent, updated_at = now()
      WHERE user_id = c.caller_id;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
      VALUES (c.caller_id, c.credits_spent, 'Reembolso por llamada rechazada');
    UPDATE public.cupido_calls SET credits_spent = 0 WHERE id = _id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Triggers de contadores
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cupido_sync_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.cupido_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  END IF;
  UPDATE public.cupido_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_sync_friend_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'accepted' THEN
    UPDATE public.creator_profiles SET friend_count = friend_count + 1 WHERE id IN (NEW.requester_id, NEW.addressee_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'accepted' AND NEW.status = 'accepted' THEN
    UPDATE public.creator_profiles SET friend_count = friend_count + 1 WHERE id IN (NEW.requester_id, NEW.addressee_id);
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'accepted' THEN
    UPDATE public.creator_profiles SET friend_count = GREATEST(0, friend_count - 1) WHERE id IN (OLD.requester_id, OLD.addressee_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cupido_post_likes_count ON public.cupido_post_likes;
CREATE TRIGGER cupido_post_likes_count AFTER INSERT OR DELETE ON public.cupido_post_likes
  FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_like_count();

DROP TRIGGER IF EXISTS cupido_friends_count ON public.cupido_friends;
CREATE TRIGGER cupido_friends_count AFTER INSERT OR UPDATE OR DELETE ON public.cupido_friends
  FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_friend_count();

-- ---------------------------------------------------------------------------
-- 5. Permisos y RLS
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.cupido_posts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
-- La insignia azul y la revisión solo cambian por RPC de administración.
REVOKE UPDATE ON public.creator_profiles FROM authenticated;
GRANT UPDATE (display_name, bio, avatar_url, country_code, looking_for, drinks, has_kids)
  ON public.creator_profiles TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_accept_terms(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_admin_auto_terms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_admin_auto_follow() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_save_profile(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_set_avatar(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_submit_selfie(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_review_verification(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_open_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_can_access_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_review_withdrawal(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_start_call(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_end_call(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_answer_call(UUID, BOOLEAN) TO authenticated;

ALTER TABLE public.cupido_terms_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_gift_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cupido terms own" ON public.cupido_terms_acceptance FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cupido likes own" ON public.cupido_likes FOR SELECT TO authenticated USING (auth.uid() IN (actor_id, target_id));
CREATE POLICY "cupido likes insert" ON public.cupido_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id);
CREATE POLICY "cupido likes delete" ON public.cupido_likes FOR DELETE TO authenticated USING (auth.uid() = actor_id);
CREATE POLICY "cupido friends read" ON public.cupido_friends FOR SELECT TO authenticated USING (auth.uid() IN (requester_id, addressee_id));
CREATE POLICY "cupido friends insert" ON public.cupido_friends FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "cupido friends accept" ON public.cupido_friends FOR UPDATE TO authenticated USING (auth.uid() = addressee_id) WITH CHECK (auth.uid() = addressee_id);
CREATE POLICY "cupido friends delete" ON public.cupido_friends FOR DELETE TO authenticated USING (auth.uid() IN (requester_id, addressee_id));
CREATE POLICY "cupido posts read" ON public.cupido_posts FOR SELECT TO anon, authenticated USING (moderation_status = 'approved' OR user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cupido posts insert" ON public.cupido_posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cupido posts delete" ON public.cupido_posts FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cupido post likes read" ON public.cupido_post_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "cupido post likes insert" ON public.cupido_post_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cupido post likes delete" ON public.cupido_post_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cupido conversations read" ON public.cupido_conversations FOR SELECT TO authenticated USING (auth.uid() IN (participant_a, participant_b));
CREATE POLICY "cupido messages read" ON public.cupido_messages FOR SELECT TO authenticated USING (public.cupido_can_access_conversation(conversation_id));
CREATE POLICY "cupido messages insert" ON public.cupido_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id AND public.cupido_can_access_conversation(conversation_id));
CREATE POLICY "cupido calls read" ON public.cupido_calls FOR SELECT TO authenticated USING (auth.uid() IN (caller_id, callee_id) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cupido gifts read" ON public.cupido_gift_sends FOR SELECT TO authenticated USING (auth.uid() IN (sender_id, receiver_id) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cupido reports insert" ON public.cupido_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "cupido reports read" ON public.cupido_reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cupido reports admin update" ON public.cupido_reports FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cupido balance read" ON public.cupido_balances FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cupido withdrawals read" ON public.cupido_withdrawals FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 6. Storage y Realtime
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES
  ('cupido-media', 'cupido-media', true),
  ('cupido-voice', 'cupido-voice', false),
  ('cupido-private', 'cupido-private', false),
  ('media', 'media', true),
  ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Anyone reads public media" ON storage.objects;
CREATE POLICY "Anyone reads public media" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('media', 'avatars'));
DROP POLICY IF EXISTS "Users add own public media" ON storage.objects;
CREATE POLICY "Users add own public media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('media', 'avatars') AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Users update own public media" ON storage.objects;
CREATE POLICY "Users update own public media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('media', 'avatars') AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Users delete own public media" ON storage.objects;
CREATE POLICY "Users delete own public media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('media', 'avatars') AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "cupido media public read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'cupido-media');
CREATE POLICY "cupido media upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cupido-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "cupido media update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cupido-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "cupido media delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cupido-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "cupido voice read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cupido-voice' AND public.cupido_can_access_conversation(((storage.foldername(name))[1])::uuid));
CREATE POLICY "cupido voice upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cupido-voice' AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.cupido_can_access_conversation(((storage.foldername(name))[1])::uuid));
CREATE POLICY "cupido voice delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cupido-voice' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "cupido private own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cupido-private' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "cupido private admin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cupido-private' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cupido private upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cupido-private' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "cupido private delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cupido-private' AND (storage.foldername(name))[1] = auth.uid()::text);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cupido_messages', 'cupido_conversations', 'cupido_posts', 'cupido_friends', 'cupido_calls']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Identidad de marca y Administrador Supremo
-- ---------------------------------------------------------------------------
UPDATE public.app_settings SET site_title = 'Cupido Leudy ❤️',
  site_tagline = 'Personas reales, conexiones reales',
  banner_text = 'Encuentra conexiones reales. Verificación azul, seguridad y diversión.'
WHERE id = 1;
UPDATE public.site_settings SET site_title = 'Cupido Leudy ❤️',
  site_tagline = 'Personas reales, conexiones reales',
  banner_text = 'Encuentra conexiones reales. Verificación azul, seguridad y diversión.'
WHERE id = 1;

-- Créditos de bienvenida: 500 para correo, Google y teléfono.
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 500;
ALTER TABLE public.user_credits ALTER COLUMN balance SET DEFAULT 500;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dname TEXT;
DECLARE is_admin_email BOOLEAN;
BEGIN
  is_admin_email := lower(COALESCE(NEW.email, '')) = 'leudyfeliz81@gmail.com';
  dname := CASE WHEN is_admin_email THEN 'Cupido Leudy Cuenta Oficial'
    ELSE left(COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1), 'Artista'), 60) END;
  INSERT INTO public.profiles (id, email, display_name, full_name, birth_date, credits, is_admin)
  VALUES (NEW.id, NEW.email, dname, NULLIF(left(NEW.raw_user_meta_data->>'full_name', 120), ''), public.try_date(NEW.raw_user_meta_data->>'birth_date'), 500, is_admin_email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.creator_profiles (id, display_name, is_official, is_premium)
  VALUES (NEW.id, dname, is_admin_email, is_admin_email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_credits (user_id, balance, daily_reset_at) VALUES (NEW.id, 500, now())
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (NEW.id, 500, 'Créditos de bienvenida');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  IF is_admin_email THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin_supremo') ON CONFLICT DO NOTHING;
    UPDATE public.user_credits SET balance = -1, updated_at = now() WHERE user_id = NEW.id;
    UPDATE public.profiles SET credits = -1, plan = 'premium', plan_expires_at = NULL, is_admin = true WHERE id = NEW.id;
    UPDATE public.creator_profiles SET is_official = true, is_premium = true WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  user_email TEXT;
  user_name TEXT;
  admin_email BOOLEAN;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT lower(COALESCE(u.email, '')), u.email INTO user_email, user_name FROM auth.users u WHERE u.id = uid;
  IF user_email IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  admin_email := user_email = 'leudyfeliz81@gmail.com';

  INSERT INTO public.profiles (id, email, display_name, full_name, credits, is_admin)
  VALUES (uid, user_email, CASE WHEN admin_email THEN 'Cupido Leudy Cuenta Oficial' ELSE left(split_part(COALESCE(user_name, user_email), '@', 1), 60) END, NULL, 500, admin_email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.creator_profiles (id, display_name, is_official, is_premium)
  SELECT uid, CASE WHEN admin_email THEN 'Cupido Leudy Cuenta Oficial' ELSE left(split_part(COALESCE(user_name, user_email), '@', 1), 60) END, admin_email, admin_email
  WHERE NOT EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = uid);

  UPDATE public.creator_profiles SET is_cupido_active = true WHERE id = uid;

  INSERT INTO public.user_credits (user_id, balance, daily_reset_at)
  VALUES (uid, CASE WHEN admin_email THEN -1 ELSE 500 END, now())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'user') ON CONFLICT DO NOTHING;
  IF admin_email THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin_supremo') ON CONFLICT DO NOTHING;
    UPDATE public.user_credits SET balance = -1, updated_at = now() WHERE user_id = uid;
    UPDATE public.profiles SET credits = -1, plan = 'premium', plan_expires_at = NULL, is_admin = true WHERE id = uid;
    UPDATE public.creator_profiles SET is_official = true, is_premium = true, is_cupido_active = true WHERE id = uid;
  END IF;
END;
$$;

DO $$
DECLARE admin_id UUID;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE lower(email) = 'leudyfeliz81@gmail.com' LIMIT 1;
  IF admin_id IS NOT NULL THEN
    INSERT INTO public.cupido_terms_acceptance (user_id, version) VALUES (admin_id, '2026-01')
      ON CONFLICT (user_id) DO UPDATE SET version = '2026-01', accepted_at = now();
    UPDATE public.profiles SET terms_accepted_at = now() WHERE id = admin_id;
    UPDATE public.profiles SET display_name = 'Cupido Leudy Cuenta Oficial' WHERE id = admin_id;
    UPDATE public.creator_profiles SET display_name = 'Cupido Leudy Cuenta Oficial', is_verified_blue = true, verification_status = 'approved',
      moderation_status = 'approved', is_official = true, is_premium = true, is_cupido_active = true WHERE id = admin_id;
  END IF;
END $$;

-- Historias auténticas: visibles durante 24 horas, con respuesta por el chat existente.
CREATE TABLE IF NOT EXISTS public.cupido_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  caption TEXT NOT NULL DEFAULT '',
  filter_name TEXT NOT NULL DEFAULT 'normal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS cupido_stories_active_idx ON public.cupido_stories (expires_at DESC);
ALTER TABLE public.cupido_stories ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.cupido_stories TO anon, authenticated;
GRANT INSERT, DELETE ON public.cupido_stories TO authenticated;
DROP POLICY IF EXISTS "cupido stories live read" ON public.cupido_stories;
CREATE POLICY "cupido stories live read" ON public.cupido_stories FOR SELECT TO anon, authenticated
  USING (expires_at > now() AND (SELECT is_cupido_active FROM public.creator_profiles WHERE id = user_id));
DROP POLICY IF EXISTS "cupido stories own insert" ON public.cupido_stories;
CREATE POLICY "cupido stories own insert" ON public.cupido_stories FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido stories own delete" ON public.cupido_stories;
CREATE POLICY "cupido stories own delete" ON public.cupido_stories FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_stories;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.cupido_count_followers(_following UUID)
RETURNS BIGINT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM public.follows WHERE following_id = _following;
$$;

CREATE OR REPLACE FUNCTION public.cupido_list_followers(_following UUID)
RETURNS TABLE(follower_id UUID, display_name TEXT, avatar_url TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.follower_id, coalesce(cp.display_name, 'Miembro de Cupido'), coalesce(cp.avatar_url, '')
  FROM public.follows f
  JOIN public.creator_profiles cp ON cp.id = f.follower_id AND cp.is_cupido_active = true
  WHERE f.following_id = _following
  ORDER BY f.created_at DESC
  LIMIT 200;
$$;
GRANT EXECUTE ON FUNCTION public.cupido_count_followers(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_list_followers(UUID) TO anon, authenticated;

INSERT INTO storage.buckets (id, name, public) VALUES
  ('cupido-private', 'cupido-private', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "cupido private read own" ON storage.objects;
CREATE POLICY "cupido private read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cupido-private' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "cupido private read admin" ON storage.objects;
CREATE POLICY "cupido private read admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cupido-private' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "cupido private upload" ON storage.objects;
CREATE POLICY "cupido private upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cupido-private' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "cupido private delete" ON storage.objects;
CREATE POLICY "cupido private delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cupido-private' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "cupido admin update posts" ON public.cupido_posts;
CREATE POLICY "cupido admin update posts" ON public.cupido_posts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
