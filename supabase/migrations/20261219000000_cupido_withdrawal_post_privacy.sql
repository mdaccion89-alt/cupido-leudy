BEGIN;

-- Keep the existing withdrawable ledger intact. The function below locks and
-- debits cupido_balances in the same transaction that creates the request.
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

-- Restrictive policy supplements existing owner insert policies so a direct
-- table insert cannot bypass the disabled-comments setting.
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
  IF _post IS NULL THEN
    RAISE EXCEPTION 'POST_NOT_FOUND';
  END IF;
  SELECT COALESCE(hide_comments, FALSE) INTO comments_disabled
    FROM public.cupido_posts WHERE id = _post FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_NOT_FOUND'; END IF;
  IF comments_disabled THEN RAISE EXCEPTION 'COMMENTS_DISABLED'; END IF;
  IF char_length(comment_body) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_COMMENT_BODY'; END IF;
  IF _parent IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_post_comments
    WHERE id = _parent AND post_id = _post
  ) THEN RAISE EXCEPTION 'INVALID_COMMENT_PARENT'; END IF;

  INSERT INTO public.cupido_post_comments (post_id, user_id, body, parent_comment_id)
  VALUES (_post, actor, comment_body, _parent)
  RETURNING id INTO comment_uuid;
  RETURN comment_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_add_post_comment(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_add_post_comment(UUID, TEXT, UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cupido_withdrawals'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_withdrawals;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
