BEGIN;

-- Withdrawable balance is mirrored from the existing atomic ledger.
-- No wallet rows or balances are deleted by this migration.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS withdrawable_balance NUMERIC(20,2) NOT NULL DEFAULT 0;

UPDATE public.profiles AS p
SET withdrawable_balance = b.balance
FROM public.cupido_balances AS b
WHERE b.user_id = p.id
  AND p.withdrawable_balance IS DISTINCT FROM b.balance;

CREATE OR REPLACE FUNCTION public.cupido_sync_profile_withdrawable_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET withdrawable_balance = COALESCE(NEW.balance, 0)
   WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_sync_profile_withdrawable_balance() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cupido_sync_profile_withdrawable_balance ON public.cupido_balances;
CREATE TRIGGER cupido_sync_profile_withdrawable_balance
AFTER INSERT OR UPDATE ON public.cupido_balances
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_profile_withdrawable_balance();

CREATE TABLE IF NOT EXISTS public.cupido_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  country_code TEXT NOT NULL,
  method TEXT NOT NULL,
  account_details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE public.cupido_withdrawals
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS account_details TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE public.cupido_withdrawals
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS cupido_withdrawals_user_created_idx
  ON public.cupido_withdrawals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_withdrawals_pending_idx
  ON public.cupido_withdrawals (status, created_at DESC);

ALTER TABLE public.cupido_withdrawals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.cupido_withdrawals TO authenticated;

DROP POLICY IF EXISTS "cupido withdrawals owner read" ON public.cupido_withdrawals;
CREATE POLICY "cupido withdrawals owner read" ON public.cupido_withdrawals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cupido withdrawals admin read" ON public.cupido_withdrawals;
CREATE POLICY "cupido withdrawals admin read" ON public.cupido_withdrawals
  FOR SELECT TO authenticated USING (
    lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_supremo')
  );

CREATE OR REPLACE FUNCTION public.cupido_request_withdrawal(
  _amount NUMERIC,
  _country_code TEXT,
  _method TEXT,
  _account_details TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_id UUID := auth.uid();
  available NUMERIC(20,2);
  withdrawal_id UUID;
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _amount IS NULL OR _amount < 20 THEN RAISE EXCEPTION 'MINIMUM_WITHDRAWAL_USD_20'; END IF;
  IF _amount <> round(_amount, 2) THEN RAISE EXCEPTION 'INVALID_WITHDRAWAL_AMOUNT'; END IF;
  IF NULLIF(btrim(_country_code), '') IS NULL
     OR NULLIF(btrim(_method), '') IS NULL
     OR NULLIF(btrim(_account_details), '') IS NULL THEN
    RAISE EXCEPTION 'WITHDRAWAL_DETAILS_REQUIRED';
  END IF;
  IF lower(btrim(_method)) = 'paypal'
     AND btrim(_account_details) !~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$' THEN
    RAISE EXCEPTION 'INVALID_PAYPAL_EMAIL';
  END IF;

  SELECT balance INTO available
    FROM public.cupido_balances
   WHERE user_id = current_id
   FOR UPDATE;
  IF COALESCE(available, 0) < _amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_WITHDRAWABLE_BALANCE';
  END IF;

  UPDATE public.cupido_balances
     SET balance = balance - _amount, updated_at = now()
   WHERE user_id = current_id;

  INSERT INTO public.cupido_withdrawals
    (user_id, amount, country_code, method, account_details, status)
  VALUES
    (current_id, _amount, upper(btrim(_country_code)), btrim(_method), btrim(_account_details), 'pending')
  RETURNING id INTO withdrawal_id;
  RETURN withdrawal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

ALTER TABLE public.cupido_posts
  ADD COLUMN IF NOT EXISTS hide_likes BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_comments BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.cupido_post_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_post_comments_visibility_guard ON public.cupido_post_comments;
CREATE POLICY cupido_post_comments_visibility_guard ON public.cupido_post_comments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cupido_posts p
      WHERE p.id = post_id AND COALESCE(p.hide_comments, FALSE) = FALSE
    )
  );

CREATE OR REPLACE FUNCTION public.cupido_add_post_comment(
  _post UUID,
  _body TEXT,
  _parent UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  comment_uuid UUID;
  comment_body TEXT := btrim(COALESCE(_body, ''));
  comments_disabled BOOLEAN;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _post IS NULL THEN RAISE EXCEPTION 'POST_NOT_FOUND'; END IF;

  SELECT COALESCE(hide_comments, FALSE) INTO comments_disabled
    FROM public.cupido_posts WHERE id = _post FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_NOT_FOUND'; END IF;
  IF comments_disabled THEN RAISE EXCEPTION 'COMMENTS_DISABLED'; END IF;
  IF char_length(comment_body) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_COMMENT_BODY'; END IF;
  IF _parent IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_post_comments WHERE id = _parent AND post_id = _post
  ) THEN
    RAISE EXCEPTION 'INVALID_COMMENT_PARENT';
  END IF;

  INSERT INTO public.cupido_post_comments (post_id, user_id, body, parent_comment_id)
  VALUES (_post, actor, comment_body, _parent)
  RETURNING id INTO comment_uuid;
  RETURN comment_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_add_post_comment(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_add_post_comment(UUID, TEXT, UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS public.cupido_saved_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.cupido_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);

ALTER TABLE public.cupido_saved_posts
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS post_id UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS cupido_saved_posts_user_post_uidx
  ON public.cupido_saved_posts (user_id, post_id);
CREATE INDEX IF NOT EXISTS cupido_saved_posts_user_created_idx
  ON public.cupido_saved_posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cupido_saved_posts_post_idx
  ON public.cupido_saved_posts (post_id);

ALTER TABLE public.cupido_saved_posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.cupido_saved_posts TO authenticated;

DROP POLICY IF EXISTS "cupido saved posts owner read" ON public.cupido_saved_posts;
CREATE POLICY "cupido saved posts owner read" ON public.cupido_saved_posts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido saved posts owner insert" ON public.cupido_saved_posts;
CREATE POLICY "cupido saved posts owner insert" ON public.cupido_saved_posts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido saved posts owner delete" ON public.cupido_saved_posts;
CREATE POLICY "cupido saved posts owner delete" ON public.cupido_saved_posts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Backfill missing saves without removing or replacing any existing records.
INSERT INTO public.cupido_saved_posts (user_id, post_id, created_at)
SELECT legacy.user_id, legacy.post_id, legacy.created_at
FROM public.cupido_post_saves AS legacy
WHERE NOT EXISTS (
  SELECT 1 FROM public.cupido_saved_posts AS saved
  WHERE saved.user_id = legacy.user_id AND saved.post_id = legacy.post_id
);

CREATE OR REPLACE FUNCTION public.cupido_mirror_saved_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_post UUID;
  target_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post := OLD.post_id;
    target_user := OLD.user_id;
    DELETE FROM public.cupido_post_saves WHERE post_id = target_post AND user_id = target_user;
    RETURN OLD;
  END IF;
  target_post := NEW.post_id;
  target_user := NEW.user_id;
  INSERT INTO public.cupido_post_saves (post_id, user_id)
  VALUES (target_post, target_user)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_mirror_post_save()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_post UUID;
  target_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post := OLD.post_id;
    target_user := OLD.user_id;
    DELETE FROM public.cupido_saved_posts WHERE post_id = target_post AND user_id = target_user;
    RETURN OLD;
  END IF;
  target_post := NEW.post_id;
  target_user := NEW.user_id;
  INSERT INTO public.cupido_saved_posts (post_id, user_id)
  VALUES (target_post, target_user)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_mirror_saved_post ON public.cupido_saved_posts;
CREATE TRIGGER cupido_mirror_saved_post
AFTER INSERT OR DELETE ON public.cupido_saved_posts
FOR EACH ROW EXECUTE FUNCTION public.cupido_mirror_saved_post();

DROP TRIGGER IF EXISTS cupido_mirror_post_save ON public.cupido_post_saves;
CREATE TRIGGER cupido_mirror_post_save
AFTER INSERT OR DELETE ON public.cupido_post_saves
FOR EACH ROW EXECUTE FUNCTION public.cupido_mirror_post_save();

CREATE OR REPLACE FUNCTION public.cupido_toggle_post_save(_post UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_id UUID := auth.uid();
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  DELETE FROM public.cupido_saved_posts WHERE post_id = _post AND user_id = current_id;
  IF FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.cupido_saved_posts (post_id, user_id)
  VALUES (_post, current_id)
  ON CONFLICT (user_id, post_id) DO NOTHING;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_toggle_post_save(UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_withdrawals'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_withdrawals;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_saved_posts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_saved_posts;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
