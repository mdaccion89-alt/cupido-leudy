create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'admin_supremo', 'user');
  END IF;
END $$;

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin_supremo';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'user';

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  full_name TEXT,
  birth_date DATE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'premium')),
  plan_expires_at TIMESTAMPTZ,
  credits INTEGER NOT NULL DEFAULT 5 CHECK (credits >= -1),
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 5;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 5 CHECK (balance >= -1),
  daily_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_credits DROP CONSTRAINT IF EXISTS user_credits_balance_check;
ALTER TABLE public.user_credits ADD CONSTRAINT user_credits_balance_check CHECK (balance >= -1);
ALTER TABLE public.user_credits ADD COLUMN IF NOT EXISTS daily_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  genre TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating',
  error TEXT,
  storage_path TEXT,
  kind TEXT NOT NULL DEFAULT 'song',
  media_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  voice_type TEXT,
  bpm INTEGER,
  lyrics TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  source_song_id UUID,
  external_job_id TEXT,
  external_model TEXT,
  external_status_url TEXT,
  external_response_url TEXT,
  credits_spent INTEGER NOT NULL DEFAULT 0,
  credits_refunded BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'none' CHECK (review_status IN ('none', 'pending', 'approved', 'rejected')),
  fingerprint TEXT,
  content_id_eligible BOOLEAN NOT NULL DEFAULT false,
  creator_plan TEXT NOT NULL DEFAULT 'free',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'song';
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'audio/mpeg';
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS voice_type TEXT;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS bpm INTEGER;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS lyrics TEXT;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS source_song_id UUID;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS external_job_id TEXT;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS external_model TEXT;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS external_status_url TEXT;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS external_response_url TEXT;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS credits_spent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS credits_refunded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS content_id_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS creator_plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  external_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  distributed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_profiles (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Artista' CHECK (char_length(display_name) BETWEEN 1 AND 60),
  bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 300),
  avatar_url TEXT NOT NULL DEFAULT '',
  is_official BOOLEAN NOT NULL DEFAULT false,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  follower_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_admin BOOLEAN NOT NULL DEFAULT false,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.manual_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  transaction_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  site_title TEXT NOT NULL DEFAULT 'Leudy IA Adobe',
  site_tagline TEXT NOT NULL DEFAULT 'Convierte tus ideas en canciones',
  banner_text TEXT NOT NULL DEFAULT '',
  banner_image_url TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  primary_color TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '',
  songs_enabled BOOLEAN NOT NULL DEFAULT true,
  covers_enabled BOOLEAN NOT NULL DEFAULT true,
  videos_enabled BOOLEAN NOT NULL DEFAULT true,
  purchases_enabled BOOLEAN NOT NULL DEFAULT true,
  gallery_enabled BOOLEAN NOT NULL DEFAULT true,
  custom_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  paypal_email TEXT NOT NULL DEFAULT '',
  paypal_me_link TEXT NOT NULL DEFAULT 'https://paypal.me/eybyproduce',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  site_title TEXT NOT NULL DEFAULT 'Leudy IA Adobe',
  site_tagline TEXT NOT NULL DEFAULT 'Convierte tus ideas en canciones',
  banner_text TEXT NOT NULL DEFAULT '',
  banner_image_url TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  primary_color TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '',
  songs_enabled BOOLEAN NOT NULL DEFAULT true,
  covers_enabled BOOLEAN NOT NULL DEFAULT true,
  videos_enabled BOOLEAN NOT NULL DEFAULT true,
  purchases_enabled BOOLEAN NOT NULL DEFAULT true,
  gallery_enabled BOOLEAN NOT NULL DEFAULT true,
  custom_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  paypal_me_link TEXT NOT NULL DEFAULT 'https://paypal.me/eybyproduce',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS logo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS primary_color TEXT NOT NULL DEFAULT '';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS custom_sections JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS paypal_me_link TEXT NOT NULL DEFAULT 'https://paypal.me/eybyproduce';

CREATE TABLE IF NOT EXISTS public.payment_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  paypal_email TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.paypal_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  plan_id TEXT,
  credits INTEGER NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  paypal_order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at TIMESTAMPTZ
);

ALTER TABLE public.paypal_orders ADD COLUMN IF NOT EXISTS plan_id TEXT;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.try_date(_v TEXT)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _v IS NULL OR _v = '' THEN RETURN NULL; END IF;
  RETURN _v::date;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (role = _role OR (_role = 'admin' AND role = 'admin_supremo'))
  );
$$;

CREATE OR REPLACE FUNCTION public.effective_plan(_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') THEN 'premium'
    ELSE COALESCE((
      SELECT CASE WHEN p.plan <> 'free' AND (p.plan_expires_at IS NULL OR p.plan_expires_at > now()) THEN p.plan ELSE 'free' END
      FROM public.profiles p WHERE p.id = _user_id
    ), 'free')
  END;
$$;

CREATE OR REPLACE FUNCTION public.apply_daily_refill(_uid UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_balance INTEGER;
BEGIN
  IF public.has_role(_uid, 'admin') THEN RETURN; END IF;
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

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_user_id UUID, _delta INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _delta = 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  INSERT INTO public.user_credits (user_id, balance) VALUES (_user_id, GREATEST(-1, _delta))
    ON CONFLICT (user_id) DO UPDATE SET balance = GREATEST(-1, public.user_credits.balance + _delta), updated_at = now()
    RETURNING balance INTO new_balance;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (_user_id, _delta, 'Ajuste del administrador');
  RETURN new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_credits_to_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET credits = NEW.balance, updated_at = now() WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.sync_premium_flag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.creator_profiles SET is_premium = (NEW.plan = 'premium' OR public.has_role(NEW.id, 'admin')) WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_site_settings_to_app()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.app_settings (
    id, site_title, site_tagline, banner_text, banner_image_url, logo_url, primary_color, accent_color,
    songs_enabled, covers_enabled, videos_enabled, purchases_enabled, gallery_enabled, custom_sections,
    paypal_me_link, updated_at
  ) VALUES (
    NEW.id, NEW.site_title, NEW.site_tagline, NEW.banner_text, NEW.banner_image_url, NEW.logo_url,
    NEW.primary_color, NEW.accent_color, NEW.songs_enabled, NEW.covers_enabled, NEW.videos_enabled,
    NEW.purchases_enabled, NEW.gallery_enabled, NEW.custom_sections, NEW.paypal_me_link, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    site_title = EXCLUDED.site_title,
    site_tagline = EXCLUDED.site_tagline,
    banner_text = EXCLUDED.banner_text,
    banner_image_url = EXCLUDED.banner_image_url,
    logo_url = EXCLUDED.logo_url,
    primary_color = EXCLUDED.primary_color,
    accent_color = EXCLUDED.accent_color,
    songs_enabled = EXCLUDED.songs_enabled,
    covers_enabled = EXCLUDED.covers_enabled,
    videos_enabled = EXCLUDED.videos_enabled,
    purchases_enabled = EXCLUDED.purchases_enabled,
    gallery_enabled = EXCLUDED.gallery_enabled,
    custom_sections = EXCLUDED.custom_sections,
    paypal_me_link = EXCLUDED.paypal_me_link,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_payment_settings_to_app()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.app_settings (id, paypal_email, updated_at) VALUES (NEW.id, NEW.paypal_email, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET paypal_email = EXCLUDED.paypal_email, updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dname TEXT;
DECLARE is_admin_email BOOLEAN;
BEGIN
  is_admin_email := lower(COALESCE(NEW.email, '')) = 'leudyfeliz81@gmail.com';
  dname := left(COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1), 'Artista'), 60);
  INSERT INTO public.profiles (id, email, display_name, full_name, birth_date, credits, is_admin)
  VALUES (NEW.id, NEW.email, dname, NULLIF(left(NEW.raw_user_meta_data->>'full_name', 120), ''), public.try_date(NEW.raw_user_meta_data->>'birth_date'), 5, is_admin_email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.creator_profiles (id, display_name, is_official, is_premium)
  VALUES (NEW.id, dname, is_admin_email, is_admin_email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_credits (user_id, balance, daily_reset_at) VALUES (NEW.id, 5, now())
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (NEW.id, 5, 'Créditos de bienvenida');
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

CREATE OR REPLACE FUNCTION public.handle_user_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'leudyfeliz81@gmail.com' THEN
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
  VALUES (uid, user_email, left(split_part(COALESCE(user_name, user_email), '@', 1), 60), NULL, 5, admin_email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.creator_profiles (id, display_name, is_official, is_premium)
  SELECT uid, left(split_part(COALESCE(user_name, user_email), '@', 1), 60), admin_email, admin_email
  WHERE NOT EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = uid);

  INSERT INTO public.user_credits (user_id, balance, daily_reset_at)
  VALUES (uid, CASE WHEN admin_email THEN -1 ELSE 5 END, now())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'user') ON CONFLICT DO NOTHING;
  IF admin_email THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin_supremo') ON CONFLICT DO NOTHING;
    UPDATE public.user_credits SET balance = -1, updated_at = now() WHERE user_id = uid;
    UPDATE public.profiles SET credits = -1, plan = 'premium', plan_expires_at = NULL, is_admin = true WHERE id = uid;
    UPDATE public.creator_profiles SET is_official = true, is_premium = true WHERE id = uid;
  END IF;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.admin_set_plan(_user_id UUID, _plan TEXT, _days INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _plan NOT IN ('free', 'pro', 'premium') THEN RAISE EXCEPTION 'INVALID_PLAN'; END IF;
  UPDATE public.profiles SET plan = _plan,
    plan_expires_at = CASE WHEN _plan = 'free' OR _days IS NULL OR _days <= 0 THEN NULL ELSE now() + make_interval(days => _days) END,
    updated_at = now()
  WHERE id = _user_id;
END;
$$;

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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_user_confirmed();

DROP TRIGGER IF EXISTS songs_touch_updated_at ON public.songs;
CREATE TRIGGER songs_touch_updated_at BEFORE UPDATE ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS distributions_touch_updated_at ON public.distributions;
CREATE TRIGGER distributions_touch_updated_at BEFORE UPDATE ON public.distributions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS site_settings_touch ON public.site_settings;
CREATE TRIGGER site_settings_touch BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS payment_settings_touch ON public.payment_settings;
CREATE TRIGGER payment_settings_touch BEFORE UPDATE ON public.payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS app_settings_touch ON public.app_settings;
CREATE TRIGGER app_settings_touch BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS site_settings_sync_app ON public.site_settings;
CREATE TRIGGER site_settings_sync_app AFTER INSERT OR UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_site_settings_to_app();

DROP TRIGGER IF EXISTS payment_settings_sync_app ON public.payment_settings;
CREATE TRIGGER payment_settings_sync_app AFTER INSERT OR UPDATE ON public.payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_payment_settings_to_app();

DROP TRIGGER IF EXISTS credits_sync_profile ON public.user_credits;
CREATE TRIGGER credits_sync_profile AFTER INSERT OR UPDATE OF balance ON public.user_credits
  FOR EACH ROW EXECUTE FUNCTION public.sync_credits_to_profile();

DROP TRIGGER IF EXISTS follows_count ON public.follows;
CREATE TRIGGER follows_count AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.sync_follower_count();

DROP TRIGGER IF EXISTS profiles_premium_sync ON public.profiles;
CREATE TRIGGER profiles_premium_sync AFTER UPDATE OF plan ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_premium_flag();

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, UPDATE (display_name, full_name, birth_date) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
GRANT SELECT ON public.songs TO anon, authenticated;
GRANT UPDATE (title, is_public, published_at) ON public.songs TO authenticated;
GRANT ALL ON public.songs TO service_role;
GRANT SELECT ON public.distributions TO authenticated;
GRANT ALL ON public.distributions TO service_role;
GRANT SELECT ON public.creator_profiles TO anon, authenticated;
GRANT UPDATE (display_name, bio, avatar_url) ON public.creator_profiles TO authenticated;
GRANT ALL ON public.creator_profiles TO service_role;
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
GRANT SELECT ON public.manual_payments TO authenticated;
GRANT ALL ON public.manual_payments TO service_role;
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
GRANT SELECT, UPDATE ON public.payment_settings TO authenticated;
GRANT ALL ON public.payment_settings TO service_role;
GRANT SELECT ON public.paypal_orders TO authenticated;
GRANT ALL ON public.paypal_orders TO service_role;

REVOKE INSERT, UPDATE ON public.songs FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_daily_refill(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_review_cover(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_plan(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_my_profile() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.effective_plan(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_my_credits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credits(INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_cover(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_plan(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_license(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.try_date(TEXT) TO authenticated, service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypal_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own profile or admin" ON public.profiles;
CREATE POLICY "Read own profile or admin" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Update own profile" ON public.profiles;
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Read own credits or admin" ON public.user_credits;
CREATE POLICY "Read own credits or admin" ON public.user_credits FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Read own credit history or admin" ON public.credit_transactions;
CREATE POLICY "Read own credit history or admin" ON public.credit_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users view own songs" ON public.songs;
CREATE POLICY "Users view own songs" ON public.songs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone reads approved public songs" ON public.songs;
CREATE POLICY "Anyone reads approved public songs" ON public.songs FOR SELECT TO anon, authenticated
  USING (is_public AND status = 'ready' AND review_status IN ('none', 'approved'));

DROP POLICY IF EXISTS "Admin reads all songs" ON public.songs;
CREATE POLICY "Admin reads all songs" ON public.songs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users update own songs" ON public.songs;
CREATE POLICY "Users update own songs" ON public.songs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (is_public = false OR review_status IN ('none', 'approved')));

DROP POLICY IF EXISTS "Read own distributions or admin" ON public.distributions;
CREATE POLICY "Read own distributions or admin" ON public.distributions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone reads creator profiles" ON public.creator_profiles;
CREATE POLICY "Anyone reads creator profiles" ON public.creator_profiles FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Owner edits creator profile" ON public.creator_profiles;
CREATE POLICY "Owner edits creator profile" ON public.creator_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Read own follows" ON public.follows;
CREATE POLICY "Read own follows" ON public.follows FOR SELECT TO authenticated USING (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Follow as self" ON public.follows;
CREATE POLICY "Follow as self" ON public.follows FOR INSERT TO authenticated WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Unfollow as self" ON public.follows;
CREATE POLICY "Unfollow as self" ON public.follows FOR DELETE TO authenticated USING (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Read own notifications" ON public.notifications;
CREATE POLICY "Read own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Mark own notifications" ON public.notifications;
CREATE POLICY "Mark own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Read own support thread or admin" ON public.support_messages;
CREATE POLICY "Read own support thread or admin" ON public.support_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Write support as user or admin" ON public.support_messages;
CREATE POLICY "Write support as user or admin" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id AND from_admin = false) OR (from_admin = true AND public.has_role(auth.uid(), 'admin')));

DROP POLICY IF EXISTS "Read own manual payments or admin" ON public.manual_payments;
CREATE POLICY "Read own manual payments or admin" ON public.manual_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone reads app settings" ON public.app_settings;
CREATE POLICY "Anyone reads app settings" ON public.app_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin updates app settings" ON public.app_settings;
CREATE POLICY "Admin updates app settings" ON public.app_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone reads site settings" ON public.site_settings;
CREATE POLICY "Anyone reads site settings" ON public.site_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin updates site settings" ON public.site_settings;
CREATE POLICY "Admin updates site settings" ON public.site_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin reads payment settings" ON public.payment_settings;
CREATE POLICY "Admin reads payment settings" ON public.payment_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin updates payment settings" ON public.payment_settings;
CREATE POLICY "Admin updates payment settings" ON public.payment_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Read own orders or admin" ON public.paypal_orders;
CREATE POLICY "Read own orders or admin" ON public.paypal_orders FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

INSERT INTO storage.buckets (id, name, public) VALUES
  ('songs', 'songs', false),
  ('uploads', 'uploads', false),
  ('site', 'site', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Users read own released song files" ON storage.objects;
CREATE POLICY "Users read own released song files" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'songs'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT EXISTS (
      SELECT 1 FROM public.songs s
      WHERE s.storage_path = storage.objects.name AND s.review_status IN ('pending', 'rejected')
    )
  );

DROP POLICY IF EXISTS "Users upload own song files" ON storage.objects;
CREATE POLICY "Users upload own song files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users update own song files" ON storage.objects;
CREATE POLICY "Users update own song files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own song files" ON storage.objects;
CREATE POLICY "Users delete own song files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Admin reads all song files" ON storage.objects;
CREATE POLICY "Admin reads all song files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'songs' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin deletes song files" ON storage.objects;
CREATE POLICY "Admin deletes song files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'songs' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users read own uploads" ON storage.objects;
CREATE POLICY "Users read own uploads" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users add own uploads" ON storage.objects;
CREATE POLICY "Users add own uploads" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own uploads" ON storage.objects;
CREATE POLICY "Users delete own uploads" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Anyone reads site files" ON storage.objects;
CREATE POLICY "Anyone reads site files" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'site');

DROP POLICY IF EXISTS "Admin uploads site files" ON storage.objects;
CREATE POLICY "Admin uploads site files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin updates site files" ON storage.objects;
CREATE POLICY "Admin updates site files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'site' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin deletes site files" ON storage.objects;
CREATE POLICY "Admin deletes site files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site' AND public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS songs_user_created_idx ON public.songs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS songs_public_idx ON public.songs (is_public, published_at DESC) WHERE is_public;
CREATE INDEX IF NOT EXISTS songs_review_idx ON public.songs (review_status, created_at DESC) WHERE review_status = 'pending';
CREATE INDEX IF NOT EXISTS credit_transactions_user_idx ON public.credit_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_thread_idx ON public.support_messages (user_id, created_at);
CREATE INDEX IF NOT EXISTS distributions_user_idx ON public.distributions (user_id, created_at DESC);

INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.payment_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE admin_id UUID;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE lower(email) = 'leudyfeliz81@gmail.com' LIMIT 1;
  IF admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, display_name, plan, credits, is_admin)
    VALUES (admin_id, 'leudyfeliz81@gmail.com', 'Leudy', 'premium', -1, true)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      plan = 'premium',
      plan_expires_at = NULL,
      credits = -1,
      is_admin = true,
      updated_at = now();
    INSERT INTO public.user_credits (user_id, balance, daily_reset_at) VALUES (admin_id, -1, now())
    ON CONFLICT (user_id) DO UPDATE SET balance = -1, updated_at = now();
    INSERT INTO public.user_roles (user_id, role) VALUES (admin_id, 'user') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (admin_id, 'admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (admin_id, 'admin_supremo') ON CONFLICT DO NOTHING;
    INSERT INTO public.creator_profiles (id, display_name, is_official, is_premium)
    VALUES (admin_id, 'Leudy', true, true)
    ON CONFLICT (id) DO UPDATE SET is_official = true, is_premium = true;
  END IF;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['creator_profiles', 'notifications', 'support_messages', 'user_credits']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_engine_settings (
  provider_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'ok', 'error')),
  status_detail TEXT NOT NULL DEFAULT '',
  last_checked_at TIMESTAMPTZ,
  last_latency_ms INTEGER,
  quota_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  paid_authorized_at TIMESTAMPTZ,
  paid_authorized_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_engine_routes (
  function_key TEXT NOT NULL CHECK (function_key IN ('text', 'image', 'transcription')),
  provider_key TEXT NOT NULL REFERENCES public.ai_engine_settings (provider_key) ON DELETE CASCADE,
  model TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 100),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (function_key, provider_key)
);

CREATE TABLE IF NOT EXISTS public.ai_engine_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  function_key TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_engine_logs_created_idx ON public.ai_engine_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_engine_routes_priority_idx ON public.ai_engine_routes (function_key, enabled, priority);

ALTER TABLE public.ai_engine_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_engine_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_engine_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated reads AI engine settings" ON public.ai_engine_settings;
CREATE POLICY "Authenticated reads AI engine settings" ON public.ai_engine_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage AI engine settings" ON public.ai_engine_settings;
CREATE POLICY "Admins manage AI engine settings" ON public.ai_engine_settings
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated reads AI engine routes" ON public.ai_engine_routes;
CREATE POLICY "Authenticated reads AI engine routes" ON public.ai_engine_routes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage AI engine routes" ON public.ai_engine_routes;
CREATE POLICY "Admins manage AI engine routes" ON public.ai_engine_routes
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users read own AI engine logs" ON public.ai_engine_logs;
CREATE POLICY "Users read own AI engine logs" ON public.ai_engine_logs
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all AI engine logs" ON public.ai_engine_logs;
CREATE POLICY "Admins read all AI engine logs" ON public.ai_engine_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins insert AI engine logs" ON public.ai_engine_logs;
CREATE POLICY "Admins insert AI engine logs" ON public.ai_engine_logs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.ai_engine_settings TO authenticated;
GRANT SELECT ON public.ai_engine_routes TO authenticated;
GRANT SELECT ON public.ai_engine_logs TO authenticated;
GRANT ALL ON public.ai_engine_settings TO service_role;
GRANT ALL ON public.ai_engine_routes TO service_role;
GRANT ALL ON public.ai_engine_logs TO service_role;

INSERT INTO public.ai_engine_settings (provider_key, model) VALUES
  ('gemini', 'gemini-2.5-flash-lite'),
  ('cloudflare', '@cf/meta/llama-3.1-8b-instruct'),
  ('ollama', 'llama3.2'),
  ('groq', 'openai/gpt-oss-20b'),
  ('flux', '@cf/black-forest-labs/flux-1-schnell'),
  ('stable-diffusion', '@cf/stabilityai/stable-diffusion-xl-base-1.0')
ON CONFLICT (provider_key) DO NOTHING;

INSERT INTO public.ai_engine_routes (function_key, provider_key, model, priority, enabled) VALUES
  ('text', 'gemini', 'gemini-2.5-flash-lite', 1, true),
  ('text', 'cloudflare', '@cf/meta/llama-3.1-8b-instruct', 2, true),
  ('text', 'groq', 'openai/gpt-oss-20b', 3, true),
  ('text', 'ollama', 'llama3.2', 4, true),
  ('image', 'flux', '@cf/black-forest-labs/flux-1-schnell', 1, true),
  ('image', 'stable-diffusion', '@cf/stabilityai/stable-diffusion-xl-base-1.0', 2, true),
  ('transcription', 'groq', 'whisper-large-v3-turbo', 1, true)
ON CONFLICT (function_key, provider_key) DO NOTHING;
