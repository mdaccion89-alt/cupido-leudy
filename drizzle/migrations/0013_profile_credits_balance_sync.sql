ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits_balance INTEGER;

UPDATE public.profiles p
SET credits = COALESCE(uc.balance, p.credits),
    credits_balance = COALESCE(uc.balance, p.credits_balance, p.credits)
FROM public.user_credits uc
WHERE uc.user_id = p.id;

UPDATE public.profiles
SET credits_balance = credits
WHERE credits_balance IS NULL;

ALTER TABLE public.profiles ALTER COLUMN credits_balance SET DEFAULT 500;
ALTER TABLE public.profiles ALTER COLUMN credits_balance SET NOT NULL;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_credits_balance_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_credits_balance_check CHECK (credits_balance >= -1);

ALTER TABLE public.cupido_posts ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.creator_profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE public.creator_profiles c
SET is_super_admin = true
FROM public.profiles p
WHERE p.id = c.id AND lower(p.email) = 'leudyfeliz81@gmail.com';

CREATE OR REPLACE FUNCTION public.sync_credits_to_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
  SET credits = NEW.balance,
      credits_balance = NEW.balance,
      updated_at = now()
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credits_sync_profile ON public.user_credits;
CREATE TRIGGER credits_sync_profile
AFTER INSERT OR UPDATE OF balance ON public.user_credits
FOR EACH ROW EXECUTE FUNCTION public.sync_credits_to_profile();

CREATE OR REPLACE FUNCTION public.consume_credits(_amount INTEGER, _reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF public.has_role(auth.uid(), 'admin') THEN
    UPDATE public.profiles SET credits = -1, credits_balance = -1, updated_at = now() WHERE id = auth.uid();
    RETURN -1;
  END IF;
  PERFORM public.apply_daily_refill(auth.uid());
  UPDATE public.user_credits SET balance = balance - _amount, updated_at = now()
    WHERE user_id = auth.uid() AND balance >= _amount
    RETURNING balance INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (auth.uid(), -_amount, _reason);
  RETURN new_balance;
END;
$$;

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

GRANT EXECUTE ON FUNCTION public.cupido_admin_auto_follow() TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_register_post_share(_post UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT user_id INTO owner_id FROM public.cupido_posts WHERE id = _post;
  IF owner_id IS NULL THEN RETURN; END IF;
  UPDATE public.cupido_posts SET shares_count = shares_count + 1 WHERE id = _post;
  IF owner_id <> auth.uid() THEN
    PERFORM public.cupido_create_notification(
      owner_id,
      '↗️ Tu publicación fue compartida',
      'Alguien compartió tu publicación en Cupido Leudy ❤️',
      'share',
      auth.uid(),
      _post
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_register_post_share(UUID) TO authenticated;
