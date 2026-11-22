-- Preserve the catalog-priced gift transfer while keeping the site admin's
-- coin balance infinite. The Diamond Gran Liga always credits its catalog cash.
CREATE OR REPLACE FUNCTION public.cupido_transfer_gift(_receiver UUID, _gift_id TEXT, _room UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender UUID := auth.uid();
  gift public.cupido_gifts%ROWTYPE;
  send_id UUID;
  is_admin BOOLEAN;
  is_gran_liga BOOLEAN;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _receiver IS NULL OR _receiver = sender THEN RAISE EXCEPTION 'INVALID_RECEIVER'; END IF;

  SELECT * INTO gift FROM public.cupido_gifts
  WHERE id = _gift_id AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
    OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;

  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms
    WHERE id = _room AND host_id = _receiver AND is_live
  ) THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;

  is_admin := lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
    OR public.has_role(sender, 'admin')
    OR public.has_role(sender, 'admin_supremo');
  SELECT COALESCE(cp.is_gran_liga, FALSE) INTO is_gran_liga
  FROM public.creator_profiles cp WHERE cp.id = sender;
  IF gift.id = 'gran-liga-diamond' AND NOT COALESCE(is_gran_liga, FALSE) AND NOT is_admin THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;
  IF gift.credits > 500 AND NOT is_admin
     AND NOT COALESCE(is_gran_liga, FALSE)
     AND NOT EXISTS (SELECT 1 FROM public.paypal_orders WHERE user_id = sender AND status = 'captured') THEN
    RAISE EXCEPTION 'PURCHASE_REQUIRED';
  END IF;

  IF NOT is_admin THEN
    PERFORM public.consume_credits(gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;
  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
  VALUES (sender, _receiver, gift.id, gift.credits, gift.cash)
  RETURNING id INTO send_id;
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.cupido_balances.balance + EXCLUDED.balance,
        updated_at = EXCLUDED.updated_at;
  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (_receiver, 'Recibiste un regalo',
    CASE WHEN gift.id = 'gran-liga-diamond' THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
      ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.' END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END, sender, send_id);
  RETURN send_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) TO authenticated;

-- Keep the deployed gift endpoint stable: PostgREST matches argument names,
-- and the UUID is the send receipt. The client treats any error-free RPC as sent.
DROP FUNCTION IF EXISTS public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC);
CREATE FUNCTION public.cupido_send_gift(
  _receiver UUID,
  _gift_id TEXT,
  _credits INTEGER,
  _cash_value NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Price and payout are read from the server-owned catalog by this function.
  RETURN public.cupido_transfer_gift(_receiver, _gift_id, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_send_gift(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;

-- Public wall comments use these canonical columns for reads, replies and realtime.
ALTER TABLE public.cupido_post_comments
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD COLUMN IF NOT EXISTS parent_comment_id UUID REFERENCES public.cupido_post_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS likes_count BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS cupido_post_comments_post_created_idx
  ON public.cupido_post_comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS cupido_post_comments_parent_idx
  ON public.cupido_post_comments (parent_comment_id, created_at);

ALTER TABLE public.cupido_post_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cupido post comments public read" ON public.cupido_post_comments;
DROP POLICY IF EXISTS "cupido post comments own insert" ON public.cupido_post_comments;
DROP POLICY IF EXISTS "cupido post comments own delete" ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_select_all ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_insert_owner ON public.cupido_post_comments;
DROP POLICY IF EXISTS cupido_post_comments_delete_owner ON public.cupido_post_comments;
CREATE POLICY cupido_post_comments_select_all ON public.cupido_post_comments
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY cupido_post_comments_insert_owner ON public.cupido_post_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND char_length(btrim(body)) BETWEEN 1 AND 500);
CREATE POLICY cupido_post_comments_delete_owner ON public.cupido_post_comments
  FOR DELETE TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.cupido_post_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.cupido_post_comments TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_validate_comment_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_post_comments parent
    WHERE parent.id = NEW.parent_comment_id
      AND parent.post_id = NEW.post_id
      AND parent.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'INVALID_COMMENT_PARENT';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_validate_comment_parent ON public.cupido_post_comments;
CREATE TRIGGER cupido_validate_comment_parent
  BEFORE INSERT OR UPDATE OF post_id, parent_comment_id ON public.cupido_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.cupido_validate_comment_parent();

ALTER TABLE public.cupido_post_comments REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cupido_post_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_post_comments;
  END IF;
END;
$$;

-- A Premium Live is unlocked by a single coin payment and stays open until the
-- host ends it. _minutes remains accepted for PostgREST compatibility only.
CREATE OR REPLACE FUNCTION public.cupido_start_premium_live(_title TEXT, _coins INTEGER, _minutes INTEGER)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE room_uuid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _coins NOT IN (150, 300, 500, 1000) THEN RAISE EXCEPTION 'INVALID_LIVE_TIER'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.creator_profiles cp
    WHERE cp.id = auth.uid()
      AND (cp.is_verified_blue OR cp.is_gran_liga OR cp.is_official OR cp.is_super_admin)
  ) AND lower(COALESCE(auth.jwt()->>'email', '')) <> 'leudyfeliz81@gmail.com'
    AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    RAISE EXCEPTION 'NOT_VERIFIED';
  END IF;
  INSERT INTO public.cupido_live_rooms (host_id, title, premium_coins, premium_minutes, premium_ends_at)
  VALUES (
    auth.uid(),
    COALESCE(NULLIF(btrim(_title), ''), 'Live Premium'),
    _coins,
    0,
    NULL
  )
  RETURNING id INTO room_uuid;
  RETURN room_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_premium_live(TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_pay_live_entry(_room UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  live_row public.cupido_live_rooms%ROWTYPE;
  actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO live_row FROM public.cupido_live_rooms WHERE id = _room AND is_live FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_NOT_AVAILABLE'; END IF;
  IF live_row.host_id = actor THEN RETURN TRUE; END IF;
  IF live_row.premium_coins <= 0 THEN RAISE EXCEPTION 'LIVE_NOT_AVAILABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public.cupido_live_access WHERE room_id = _room AND user_id = actor) THEN RETURN TRUE; END IF;
  PERFORM public.consume_credits(live_row.premium_coins, 'Entrada a Live Premium');
  INSERT INTO public.cupido_live_access (room_id, user_id, paid_coins)
  VALUES (_room, actor, live_row.premium_coins);
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (live_row.host_id, live_row.premium_coins::NUMERIC / 100, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.cupido_balances.balance + EXCLUDED.balance,
        updated_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_pay_live_entry(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_pay_live_entry(UUID) TO authenticated;

-- Preserve the paid access row for the full lifetime of its active Live.
DROP POLICY IF EXISTS cupido_live_rooms_active_read ON public.cupido_live_rooms;
CREATE POLICY cupido_live_rooms_active_read ON public.cupido_live_rooms
  FOR SELECT TO authenticated USING (
    (is_live AND (premium_coins = 0 OR host_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = id AND a.user_id = auth.uid()
    ))) OR host_id = auth.uid()
  );
DROP POLICY IF EXISTS cupido_live_viewers_join ON public.cupido_live_viewers;
CREATE POLICY cupido_live_viewers_join ON public.cupido_live_viewers
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live
        AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
        ))
    )
  );
DROP POLICY IF EXISTS cupido_live_signals_read ON public.cupido_live_signals;
CREATE POLICY cupido_live_signals_read ON public.cupido_live_signals FOR SELECT TO authenticated USING (
  (sender_id = auth.uid() OR receiver_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.host_id = auth.uid()
  )) AND EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live
      AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
      ))
  )
);
DROP POLICY IF EXISTS cupido_live_signals_send ON public.cupido_live_signals;
CREATE POLICY cupido_live_signals_send ON public.cupido_live_signals FOR INSERT TO authenticated WITH CHECK (
  sender_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live
      AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
      ))
  )
);
DROP POLICY IF EXISTS live_comments_live_insert ON public.live_comments;
CREATE POLICY live_comments_live_insert ON public.live_comments FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = stream_id AND r.is_live
      AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
      ))
  )
);
DROP POLICY IF EXISTS live_comments_live_read ON public.live_comments;
CREATE POLICY live_comments_live_read ON public.live_comments FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = stream_id AND r.is_live
      AND (r.premium_coins = 0 OR r.host_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.cupido_live_access a WHERE a.room_id = r.id AND a.user_id = auth.uid()
      ))
  )
);

NOTIFY pgrst, 'reload schema';
