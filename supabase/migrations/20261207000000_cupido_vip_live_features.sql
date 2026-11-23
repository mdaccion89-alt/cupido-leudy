ALTER TABLE public.cupido_live_rooms
  ADD COLUMN IF NOT EXISTS coin_goal BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.cupido_pk_requests
  DROP CONSTRAINT IF EXISTS cupido_pk_requests_status_check;
ALTER TABLE public.cupido_pk_requests
  ADD CONSTRAINT cupido_pk_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'ended'));

CREATE TABLE IF NOT EXISTS public.cupido_live_pk_battles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE REFERENCES public.cupido_pk_requests(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenger_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '3 minutes'),
  finished_at TIMESTAMPTZ,
  host_coins BIGINT NOT NULL DEFAULT 0,
  challenger_coins BIGINT NOT NULL DEFAULT 0,
  winner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (host_id <> challenger_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cupido_live_pk_battles_one_active_room_idx
  ON public.cupido_live_pk_battles (room_id) WHERE finished_at IS NULL;
ALTER TABLE public.cupido_live_pk_battles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_live_pk_battles_participants_read ON public.cupido_live_pk_battles;
CREATE POLICY cupido_live_pk_battles_participants_read ON public.cupido_live_pk_battles
  FOR SELECT TO authenticated USING (
    auth.uid() IN (host_id, challenger_id)
    OR EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live)
  );
REVOKE ALL ON public.cupido_live_pk_battles FROM anon, authenticated;
GRANT SELECT ON public.cupido_live_pk_battles TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_open_pk_battle_on_accept()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    INSERT INTO public.cupido_live_pk_battles (room_id, request_id, host_id, challenger_id)
    VALUES (NEW.room_id, NEW.id, NEW.host_id, NEW.requester_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cupido_pk_request_start_battle ON public.cupido_pk_requests;
CREATE TRIGGER cupido_pk_request_start_battle
AFTER UPDATE OF status ON public.cupido_pk_requests
FOR EACH ROW EXECUTE FUNCTION public.cupido_open_pk_battle_on_accept();

CREATE OR REPLACE FUNCTION public.cupido_set_live_coin_goal(_room UUID, _goal BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _goal IS NULL OR _goal < 0 OR _goal > 10000000 THEN RAISE EXCEPTION 'INVALID_COIN_GOAL'; END IF;
  UPDATE public.cupido_live_rooms
     SET coin_goal = _goal
   WHERE id = _room AND host_id = auth.uid() AND is_live;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_NOT_ACTIVE'; END IF;
  RETURN _goal;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_set_live_coin_goal(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_set_live_coin_goal(UUID, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_live_top_fans(_room UUID)
RETURNS TABLE(user_id UUID, display_name TEXT, avatar_url TEXT, coins BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms WHERE id = _room AND is_live) THEN
    RAISE EXCEPTION 'LIVE_NOT_ACTIVE';
  END IF;
  RETURN QUERY
  SELECT g.sender_id, COALESCE(p.display_name, 'Miembro')::TEXT, COALESCE(p.avatar_url, '')::TEXT,
         SUM(g.credits)::BIGINT
  FROM public.cupido_gift_sends g
  LEFT JOIN public.cupido_public_profiles p ON p.id = g.sender_id
  WHERE g.live_room_id = _room
  GROUP BY g.sender_id, p.display_name, p.avatar_url
  ORDER BY SUM(g.credits) DESC, MAX(g.created_at) ASC
  LIMIT 3;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_get_live_top_fans(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_get_live_top_fans(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_live_gift_total(_room UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE gift_total BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms WHERE id = _room) THEN
    RAISE EXCEPTION 'LIVE_NOT_FOUND';
  END IF;
  SELECT COALESCE(SUM(credits), 0)::BIGINT INTO gift_total
  FROM public.cupido_gift_sends WHERE live_room_id = _room;
  RETURN gift_total;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_get_live_gift_total(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_get_live_gift_total(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_weekly_ranking()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  WITH incoming AS (
    SELECT receiver_id AS user_id, SUM(credits)::BIGINT AS coins
    FROM public.cupido_gift_sends
    WHERE created_at >= date_trunc('week', now())
    GROUP BY receiver_id
    UNION ALL
    SELECT callee_id, SUM(credits_spent)::BIGINT
    FROM public.cupido_calls
    WHERE created_at >= date_trunc('week', now()) AND cash_earned > 0
    GROUP BY callee_id
  ), creators AS (
    SELECT user_id, SUM(coins)::BIGINT AS coins FROM incoming GROUP BY user_id
  ), outgoing AS (
    SELECT sender_id AS user_id, SUM(credits)::BIGINT AS coins
    FROM public.cupido_gift_sends
    WHERE created_at >= date_trunc('week', now())
    GROUP BY sender_id
    UNION ALL
    SELECT caller_id, SUM(credits_spent)::BIGINT
    FROM public.cupido_calls
    WHERE created_at >= date_trunc('week', now()) AND cash_earned > 0
    GROUP BY caller_id
  ), fans AS (
    SELECT user_id, SUM(coins)::BIGINT AS coins FROM outgoing GROUP BY user_id
  )
  SELECT jsonb_build_object(
    'week_starts_at', date_trunc('week', now()),
    'creators', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id', x.user_id, 'display_name', p.display_name,
        'avatar_url', p.avatar_url, 'coins', x.coins) ORDER BY x.coins DESC)
      FROM (SELECT * FROM creators ORDER BY coins DESC LIMIT 10) x
      LEFT JOIN public.cupido_public_profiles p ON p.id = x.user_id
    ), '[]'::JSONB),
    'fans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id', x.user_id, 'display_name', p.display_name,
        'avatar_url', p.avatar_url, 'coins', x.coins) ORDER BY x.coins DESC)
      FROM (SELECT * FROM fans ORDER BY coins DESC LIMIT 10) x
      LEFT JOIN public.cupido_public_profiles p ON p.id = x.user_id
    ), '[]'::JSONB)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_get_weekly_ranking() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_get_weekly_ranking() TO authenticated;

CREATE TABLE IF NOT EXISTS public.cupido_live_treasures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL UNIQUE REFERENCES public.cupido_live_rooms(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_coins INTEGER NOT NULL DEFAULT 25 CHECK (total_coins = 25),
  claim_limit INTEGER NOT NULL DEFAULT 5 CHECK (claim_limit = 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 seconds')
);
CREATE TABLE IF NOT EXISTS public.cupido_live_treasure_claims (
  treasure_id UUID NOT NULL REFERENCES public.cupido_live_treasures(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 5 CHECK (coins = 5),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (treasure_id, user_id)
);
ALTER TABLE public.cupido_live_treasures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupido_live_treasure_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_live_treasures_live_read ON public.cupido_live_treasures;
CREATE POLICY cupido_live_treasures_live_read ON public.cupido_live_treasures
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = room_id AND r.is_live
  ));
REVOKE ALL ON public.cupido_live_treasures, public.cupido_live_treasure_claims FROM anon, authenticated;
GRANT SELECT ON public.cupido_live_treasures TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_start_live_treasure(_room UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); treasure_id UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r
    WHERE r.id = _room AND r.is_live
      AND (r.host_id = actor OR EXISTS (
        SELECT 1 FROM public.creator_profiles cp WHERE cp.id = actor
          AND (cp.is_verified_blue OR cp.is_premium OR cp.is_gran_liga)
      ))
  ) THEN RAISE EXCEPTION 'TREASURE_FORBIDDEN'; END IF;
  INSERT INTO public.cupido_live_treasures (room_id, host_id)
  VALUES (_room, (SELECT host_id FROM public.cupido_live_rooms WHERE id = _room))
  RETURNING id INTO treasure_id;
  RETURN treasure_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'TREASURE_ALREADY_DROPPED';
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_start_live_treasure(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_live_treasure(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_claim_live_treasure(_treasure UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor UUID := auth.uid(); treasure_row public.cupido_live_treasures%ROWTYPE;
        current_claims INTEGER; reward INTEGER;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com' THEN
    RETURN jsonb_build_object('claimed', false, 'coins', 0, 'reason', 'INFINITE_BALANCE');
  END IF;
  SELECT * INTO treasure_row FROM public.cupido_live_treasures WHERE id = _treasure FOR UPDATE;
  IF NOT FOUND OR treasure_row.expires_at <= now()
     OR NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = treasure_row.room_id AND r.is_live) THEN
    RAISE EXCEPTION 'TREASURE_EXPIRED';
  END IF;
  SELECT COUNT(*) INTO current_claims FROM public.cupido_live_treasure_claims WHERE treasure_id = _treasure;
  IF current_claims >= treasure_row.claim_limit THEN RAISE EXCEPTION 'TREASURE_EMPTY'; END IF;
  reward := treasure_row.total_coins / treasure_row.claim_limit;
  INSERT INTO public.cupido_live_treasure_claims (treasure_id, user_id, coins)
  VALUES (_treasure, actor, reward);
  PERFORM public.apply_daily_refill(actor);
  INSERT INTO public.user_credits (user_id, balance, daily_reset_at, updated_at)
  VALUES (actor, reward, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = CASE WHEN public.user_credits.balance = -1 THEN -1
                       ELSE public.user_credits.balance + EXCLUDED.balance END,
        updated_at = now();
  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (actor, reward, 'Cofre del tesoro en Live');
  RETURN jsonb_build_object('claimed', true, 'coins', reward);
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_claim_live_treasure(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_claim_live_treasure(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_live_pk_state(_room UUID)
RETURNS TABLE(battle_id UUID, challenger_id UUID, challenger_name TEXT, started_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, host_coins BIGINT, challenger_coins BIGINT,
  winner_id UUID, seconds_left INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  RETURN QUERY
  SELECT b.id, b.challenger_id, COALESCE(p.display_name, 'Rival PK')::TEXT,
    b.started_at, b.ends_at, b.finished_at,
    COALESCE((SELECT SUM(g.credits) FROM public.cupido_gift_sends g
      WHERE g.live_room_id = _room AND g.receiver_id = b.host_id
        AND g.created_at >= b.started_at AND g.created_at <= b.ends_at), 0)::BIGINT,
    COALESCE((SELECT SUM(g.credits) FROM public.cupido_gift_sends g
      WHERE g.live_room_id = _room AND g.receiver_id = b.challenger_id
        AND g.created_at >= b.started_at AND g.created_at <= b.ends_at), 0)::BIGINT,
    b.winner_id, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (b.ends_at - now())))::INTEGER)
  FROM public.cupido_live_pk_battles b
  LEFT JOIN public.cupido_public_profiles p ON p.id = b.challenger_id
  WHERE b.room_id = _room ORDER BY b.started_at DESC LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_get_live_pk_state(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_get_live_pk_state(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_finish_live_pk_battle(_battle UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE battle public.cupido_live_pk_battles%ROWTYPE;
        host_total BIGINT; challenger_total BIGINT; winner UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO battle FROM public.cupido_live_pk_battles WHERE id = _battle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PK_BATTLE_NOT_FOUND'; END IF;
  IF auth.uid() <> battle.host_id AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    RAISE EXCEPTION 'PK_FINISH_FORBIDDEN';
  END IF;
  IF battle.finished_at IS NOT NULL THEN
    RETURN jsonb_build_object('finished', true, 'winner_id', battle.winner_id,
      'host_coins', battle.host_coins, 'challenger_coins', battle.challenger_coins);
  END IF;
  IF now() < battle.ends_at THEN RAISE EXCEPTION 'PK_BATTLE_STILL_ACTIVE'; END IF;
  SELECT COALESCE(SUM(credits), 0)::BIGINT INTO host_total
    FROM public.cupido_gift_sends WHERE live_room_id = battle.room_id AND receiver_id = battle.host_id
      AND created_at >= battle.started_at AND created_at <= battle.ends_at;
  SELECT COALESCE(SUM(credits), 0)::BIGINT INTO challenger_total
    FROM public.cupido_gift_sends WHERE live_room_id = battle.room_id AND receiver_id = battle.challenger_id
      AND created_at >= battle.started_at AND created_at <= battle.ends_at;
  winner := CASE WHEN host_total = challenger_total THEN NULL
                 WHEN host_total > challenger_total THEN battle.host_id ELSE battle.challenger_id END;
  UPDATE public.cupido_live_pk_battles SET finished_at = now(), host_coins = host_total,
    challenger_coins = challenger_total, winner_id = winner WHERE id = _battle;
  UPDATE public.cupido_pk_requests SET status = 'ended', answered_at = now() WHERE id = battle.request_id;
  RETURN jsonb_build_object('finished', true, 'winner_id', winner,
    'host_coins', host_total, 'challenger_coins', challenger_total);
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_finish_live_pk_battle(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_finish_live_pk_battle(UUID) TO authenticated;

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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public' AND tablename = 'cupido_live_pk_battles') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_live_pk_battles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public' AND tablename = 'cupido_live_treasures') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_live_treasures';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public' AND tablename = 'cupido_matches') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cupido_matches';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
