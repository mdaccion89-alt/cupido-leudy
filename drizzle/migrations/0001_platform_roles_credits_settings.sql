CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own profile or admin" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_credits (
  user_id UUID PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own credits or admin" ON public.user_credits FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own credit history or admin" ON public.credit_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX credit_transactions_user_idx ON public.credit_transactions (user_id, created_at DESC);

-- Signup: profile, 3 free credits, admin role only for the verified admin email.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_credits (user_id, balance) VALUES (NEW.id, 3) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (NEW.id, 3, 'Créditos de bienvenida');
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
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER on_auth_user_confirmed AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_user_confirmed();

-- Spend the caller's own credits (admins are unlimited). Returns new balance, or -1 for unlimited.
CREATE OR REPLACE FUNCTION public.consume_credits(_amount INTEGER, _reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF public.has_role(auth.uid(), 'admin') THEN RETURN -1; END IF;
  UPDATE public.user_credits SET balance = balance - _amount, updated_at = now()
    WHERE user_id = auth.uid() AND balance >= _amount
    RETURNING balance INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (auth.uid(), -_amount, _reason);
  RETURN new_balance;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_credits(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_credits(INTEGER, TEXT) TO authenticated, service_role;

-- Server-only: add credits (refunds, purchases).
CREATE OR REPLACE FUNCTION public.grant_credits(_user_id UUID, _amount INTEGER, _reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance INTEGER;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  INSERT INTO public.user_credits (user_id, balance) VALUES (_user_id, _amount)
    ON CONFLICT (user_id) DO UPDATE SET balance = public.user_credits.balance + _amount, updated_at = now()
    RETURNING balance INTO new_balance;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (_user_id, _amount, _reason);
  RETURN new_balance;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT) TO service_role;

-- Admin: give or remove credits for any user.
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_user_id UUID, _delta INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _delta = 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  INSERT INTO public.user_credits (user_id, balance) VALUES (_user_id, GREATEST(0, _delta))
    ON CONFLICT (user_id) DO UPDATE SET balance = GREATEST(0, public.user_credits.balance + _delta), updated_at = now()
    RETURNING balance INTO new_balance;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (_user_id, _delta, 'Ajuste del administrador');
  RETURN new_balance;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(UUID, INTEGER) TO authenticated, service_role;

CREATE TABLE public.site_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  site_title TEXT NOT NULL DEFAULT 'Cupido Leudy ❤️',
  site_tagline TEXT NOT NULL DEFAULT 'Personas reales, conexiones reales',
  banner_text TEXT NOT NULL DEFAULT '',
  banner_image_url TEXT NOT NULL DEFAULT '',
  songs_enabled BOOLEAN NOT NULL DEFAULT true,
  covers_enabled BOOLEAN NOT NULL DEFAULT true,
  videos_enabled BOOLEAN NOT NULL DEFAULT true,
  purchases_enabled BOOLEAN NOT NULL DEFAULT true,
  gallery_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads site settings" ON public.site_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin updates site settings" ON public.site_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER site_settings_touch BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.site_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.payment_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  paypal_email TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.payment_settings TO authenticated;
GRANT ALL ON public.payment_settings TO service_role;
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin reads payment settings" ON public.payment_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin updates payment settings" ON public.payment_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER payment_settings_touch BEFORE UPDATE ON public.payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.payment_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.paypal_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  package_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  paypal_order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at TIMESTAMPTZ
);
GRANT SELECT ON public.paypal_orders TO authenticated;
GRANT ALL ON public.paypal_orders TO service_role;
ALTER TABLE public.paypal_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own orders or admin" ON public.paypal_orders FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.songs
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'song',
  ADD COLUMN media_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  ADD COLUMN voice_type TEXT,
  ADD COLUMN bpm INTEGER,
  ADD COLUMN lyrics TEXT,
  ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN source_song_id UUID,
  ADD COLUMN external_job_id TEXT,
  ADD COLUMN external_model TEXT,
  ADD COLUMN external_status_url TEXT,
  ADD COLUMN external_response_url TEXT,
  ADD COLUMN credits_spent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN credits_refunded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN published_at TIMESTAMPTZ;
CREATE INDEX songs_public_idx ON public.songs (is_public, published_at DESC) WHERE is_public;

CREATE POLICY "Users read own uploads" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users add own uploads" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own uploads" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users update own song files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);