-- ===== Private profile data and plans =====
ALTER TABLE public.profiles
  ADD COLUMN full_name TEXT,
  ADD COLUMN birth_date DATE,
  ADD COLUMN plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN plan_expires_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check CHECK (plan IN ('free', 'pro', 'premium'));
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (display_name, full_name, birth_date) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.effective_plan(_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE WHEN p.plan <> 'free' AND (p.plan_expires_at IS NULL OR p.plan_expires_at > now()) THEN p.plan ELSE 'free' END
    FROM public.profiles p WHERE p.id = _user_id
  ), 'free')
$$;
GRANT EXECUTE ON FUNCTION public.effective_plan(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.try_date(_v TEXT)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _v IS NULL OR _v = '' THEN RETURN NULL; END IF;
  RETURN _v::date;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

-- ===== Public creator profiles and follows =====
CREATE TABLE public.creator_profiles (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Artista' CHECK (char_length(display_name) BETWEEN 1 AND 60),
  bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 300),
  avatar_url TEXT NOT NULL DEFAULT '',
  is_official BOOLEAN NOT NULL DEFAULT false,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  follower_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.creator_profiles TO anon, authenticated;
GRANT UPDATE (display_name, bio) ON public.creator_profiles TO authenticated;
GRANT ALL ON public.creator_profiles TO service_role;
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads creator profiles" ON public.creator_profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Owner edits creator profile" ON public.creator_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

INSERT INTO public.creator_profiles (id, display_name)
  SELECT p.id, left(COALESCE(NULLIF(p.display_name, ''), 'Artista'), 60) FROM public.profiles p
  ON CONFLICT (id) DO NOTHING;
UPDATE public.creator_profiles c SET is_official = true
  FROM public.user_roles r WHERE r.user_id = c.id AND r.role = 'admin';

CREATE TABLE public.follows (
  follower_id UUID NOT NULL,
  following_id UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own follows" ON public.follows FOR SELECT TO authenticated USING (auth.uid() = follower_id);
CREATE POLICY "Follow as self" ON public.follows FOR INSERT TO authenticated WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Unfollow as self" ON public.follows FOR DELETE TO authenticated USING (auth.uid() = follower_id);

CREATE OR REPLACE FUNCTION public.sync_follower_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.creator_profiles SET follower_count = follower_count + 1 WHERE id = NEW.following_id;
    RETURN NEW;
  ELSE
    UPDATE public.creator_profiles SET follower_count = GREATEST(0, follower_count - 1) WHERE id = OLD.following_id;
    RETURN OLD;
  END IF;
END;
$$;
CREATE TRIGGER follows_count AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.sync_follower_count();

-- Keep the public premium flag in sync with the private plan.
CREATE OR REPLACE FUNCTION public.sync_premium_flag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.creator_profiles SET is_premium = (NEW.plan = 'premium') WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_premium_sync AFTER UPDATE OF plan ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_premium_flag();

-- ===== Daily free credits =====
ALTER TABLE public.user_credits ADD COLUMN daily_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.apply_daily_refill(_uid UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_balance INTEGER;
BEGIN
  INSERT INTO public.user_credits (user_id, balance, daily_reset_at) VALUES (_uid, 5, now())
    ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO old_balance FROM public.user_credits
    WHERE user_id = _uid AND daily_reset_at <= now() - interval '24 hours' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.user_credits SET balance = GREATEST(balance, 5), daily_reset_at = now(), updated_at = now() WHERE user_id = _uid;
    IF old_balance < 5 THEN
      INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (_uid, 5 - old_balance, 'Créditos diarios');
    END IF;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_daily_refill(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_my_credits()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('balance', -1, 'next_refill_at', NULL);
  END IF;
  PERFORM public.apply_daily_refill(auth.uid());
  SELECT balance, daily_reset_at INTO c FROM public.user_credits WHERE user_id = auth.uid();
  RETURN jsonb_build_object('balance', c.balance, 'next_refill_at', c.daily_reset_at + interval '24 hours');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_my_credits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_my_credits() TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_credits(_amount INTEGER, _reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF public.has_role(auth.uid(), 'admin') THEN RETURN -1; END IF;
  PERFORM public.apply_daily_refill(auth.uid());
  UPDATE public.user_credits SET balance = balance - _amount, updated_at = now()
    WHERE user_id = auth.uid() AND balance >= _amount
    RETURNING balance INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (auth.uid(), -_amount, _reason);
  RETURN new_balance;
END;
$$;

-- ===== Signup / confirmation =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dname TEXT;
BEGIN
  dname := left(COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1), 'Artista'), 60);
  INSERT INTO public.profiles (id, email, display_name, full_name, birth_date)
  VALUES (NEW.id, NEW.email, dname, NULLIF(left(NEW.raw_user_meta_data->>'full_name', 120), ''), public.try_date(NEW.raw_user_meta_data->>'birth_date'))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.creator_profiles (id, display_name, is_official)
  VALUES (NEW.id, dname, NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) = 'leudyfeliz81@gmail.com')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_credits (user_id, balance, daily_reset_at) VALUES (NEW.id, 5, now()) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (NEW.id, 5, 'Créditos de bienvenida');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  IF NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) = 'leudyfeliz81@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(NEW.email) = 'leudyfeliz81@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    UPDATE public.creator_profiles SET is_official = true WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- ===== Songs: reviews, fingerprint, Content ID, expiry =====
ALTER TABLE public.songs
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN fingerprint TEXT,
  ADD COLUMN content_id_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN creator_plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE public.songs ADD CONSTRAINT songs_review_status_check CHECK (review_status IN ('none', 'pending', 'approved', 'rejected'));
CREATE INDEX songs_review_idx ON public.songs (review_status, created_at DESC) WHERE review_status = 'pending';

CREATE POLICY "Admin reads all songs" ON public.songs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Users update own songs" ON public.songs;
CREATE POLICY "Users update own songs" ON public.songs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (is_public = false OR review_status IN ('none', 'approved')));

DROP POLICY IF EXISTS "Users read own song files" ON storage.objects;
CREATE POLICY "Users read own released song files" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'songs'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT EXISTS (
      SELECT 1 FROM public.songs s
      WHERE s.storage_path = storage.objects.name AND s.review_status IN ('pending', 'rejected')
    )
  );
CREATE POLICY "Admin reads all song files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'songs' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin deletes song files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'songs' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone reads site files" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'site');

-- Public license verification: safe fields only.
CREATE OR REPLACE FUNCTION public.verify_license(_song_id UUID)
RETURNS TABLE (id UUID, title TEXT, kind TEXT, genre TEXT, voice_type TEXT, created_at TIMESTAMPTZ, fingerprint TEXT, content_id_eligible BOOLEAN, review_status TEXT, creator_name TEXT, creator_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.title, s.kind, s.genre, s.voice_type, s.created_at, s.fingerprint, s.content_id_eligible, s.review_status,
         COALESCE(NULLIF(p.full_name, ''), c.display_name, 'Artista'), s.user_id
  FROM public.songs s
  LEFT JOIN public.profiles p ON p.id = s.user_id
  LEFT JOIN public.creator_profiles c ON c.id = s.user_id
  WHERE s.id = _song_id AND s.status = 'ready'
$$;
GRANT EXECUTE ON FUNCTION public.verify_license(UUID) TO anon, authenticated, service_role;

-- ===== Notifications =====
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Mark own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_review_cover(_song_id UUID, _approve BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT id, user_id, title INTO s FROM public.songs WHERE id = _song_id AND review_status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_PENDING'; END IF;
  UPDATE public.songs SET review_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    is_public = CASE WHEN _approve THEN is_public ELSE false END
  WHERE id = _song_id;
  INSERT INTO public.notifications (user_id, title, body) VALUES (
    s.user_id,
    CASE WHEN _approve THEN 'Cover aprobado' ELSE 'Cover rechazado' END,
    CASE WHEN _approve THEN 'Tu cover "' || s.title || '" fue aprobado. Ya puedes escucharlo y descargarlo.'
         ELSE 'Tu cover "' || s.title || '" fue rechazado y eliminado tras la revisión.' END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_review_cover(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_cover(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_plan(_user_id UUID, _plan TEXT, _days INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _plan NOT IN ('free', 'pro', 'premium') THEN RAISE EXCEPTION 'INVALID_PLAN'; END IF;
  UPDATE public.profiles SET plan = _plan,
    plan_expires_at = CASE WHEN _plan = 'free' OR _days IS NULL OR _days <= 0 THEN NULL ELSE now() + make_interval(days => _days) END
  WHERE id = _user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_plan(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_plan(UUID, TEXT, INTEGER) TO authenticated;

-- ===== Support chat =====
CREATE TABLE public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  from_admin BOOLEAN NOT NULL DEFAULT false,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own support thread or admin" ON public.support_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Write support as user or admin" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id AND from_admin = false) OR (from_admin = true AND public.has_role(auth.uid(), 'admin')));
CREATE INDEX support_messages_thread_idx ON public.support_messages (user_id, created_at);

-- ===== Manual PayPal.me payments (validated by admin) =====
CREATE TABLE public.manual_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  product_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  transaction_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
GRANT SELECT ON public.manual_payments TO authenticated;
GRANT ALL ON public.manual_payments TO service_role;
ALTER TABLE public.manual_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own manual payments or admin" ON public.manual_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.paypal_orders ADD COLUMN plan_id TEXT;

-- ===== Site settings extras =====
ALTER TABLE public.site_settings
  ADD COLUMN logo_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN primary_color TEXT NOT NULL DEFAULT '',
  ADD COLUMN accent_color TEXT NOT NULL DEFAULT '',
  ADD COLUMN custom_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN paypal_me_link TEXT NOT NULL DEFAULT 'https://paypal.me/eybyproduce';

-- ===== Live updates =====
ALTER PUBLICATION supabase_realtime ADD TABLE public.creator_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_credits;