-- Attach live gifts and private-call earnings to a room, then expose a small
-- aggregate to every authenticated participant without exposing transactions.
ALTER TABLE public.cupido_gift_sends
  ADD COLUMN IF NOT EXISTS live_room_id UUID REFERENCES public.cupido_live_rooms(id) ON DELETE SET NULL;

ALTER TABLE public.cupido_calls
  ADD COLUMN IF NOT EXISTS live_room_id UUID REFERENCES public.cupido_live_rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_earned NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS cupido_gift_sends_live_room_idx
  ON public.cupido_gift_sends (live_room_id) WHERE live_room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cupido_calls_live_room_idx
  ON public.cupido_calls (live_room_id) WHERE live_room_id IS NOT NULL;

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
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _receiver) THEN
    RAISE EXCEPTION 'INVALID_RECEIVER';
  END IF;

  SELECT * INTO gift FROM public.cupido_gifts
  WHERE id = _gift_id
    AND ((sort_order BETWEEN 1 AND 99 AND credits BETWEEN 5 AND 5000)
      OR (id = 'gran-liga-diamond' AND sort_order = 100 AND credits = 1000000 AND cash = 60.00))
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;

  IF _room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cupido_live_rooms r WHERE r.id = _room AND r.host_id = _receiver AND r.is_live
  ) THEN
    RAISE EXCEPTION 'LIVE_NOT_ACTIVE';
  END IF;

  IF gift.id = 'gran-liga-diamond'
    AND NOT is_infinite_admin
    AND NOT EXISTS (SELECT 1 FROM public.creator_profiles cp WHERE cp.id = sender AND cp.is_gran_liga)
  THEN
    RAISE EXCEPTION 'GRAN_LIGA_REQUIRED';
  END IF;

  IF NOT is_infinite_admin THEN
    PERFORM public.apply_daily_refill(sender);
    UPDATE public.user_credits
       SET balance = balance - gift.credits, updated_at = now()
     WHERE user_id = sender AND balance >= gift.credits
     RETURNING balance INTO new_balance;
    IF new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    INSERT INTO public.credit_transactions (user_id, delta, reason)
    VALUES (sender, -gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;

  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value, live_room_id)
  VALUES (sender, _receiver, gift.id, gift.credits, gift.cash, _room)
  RETURNING id INTO send_id;

  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (_receiver, gift.cash, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.cupido_balances.balance + EXCLUDED.balance,
        updated_at = now();

  INSERT INTO public.notifications (user_id, title, body, kind, actor_id, target_id)
  VALUES (
    _receiver,
    'Recibiste un regalo',
    CASE WHEN gift.id = 'gran-liga-diamond'
      THEN 'Diamante Gran Liga: recibiste US$60.00 de saldo retirable.'
      ELSE 'Tu saldo retirable se actualizó con un regalo de Cupido.'
    END,
    CASE WHEN _room IS NULL THEN 'gift' ELSE 'live_gift' END,
    sender,
    send_id
  );

  RETURN send_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cupido_start_call(
  _callee UUID,
  _mode TEXT,
  _video BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  cost INTEGER;
  call_id UUID;
  is_infinite_admin BOOLEAN;
  live_room UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _callee IS NULL OR _callee = actor THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;
  IF _mode IS NULL OR _mode NOT IN ('hot', 'cafe') THEN RAISE EXCEPTION 'INVALID_CALL_MODE'; END IF;
  is_infinite_admin := lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com';
  IF NOT is_infinite_admin AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = actor AND p.has_recharged
  ) AND NOT EXISTS (
    SELECT 1 FROM public.paypal_orders o WHERE o.user_id = actor AND o.status = 'captured'
  ) THEN RAISE EXCEPTION 'PURCHASE_REQUIRED'; END IF;

  SELECT COALESCE(cp.call_minute_price, CASE WHEN _mode = 'hot' THEN 100 ELSE 50 END)
  INTO cost FROM public.creator_profiles cp WHERE cp.id = _callee;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;

  SELECT id INTO live_room FROM public.cupido_live_rooms
  WHERE host_id = _callee AND is_live IS TRUE
  ORDER BY created_at DESC LIMIT 1;

  IF is_infinite_admin THEN
    cost := 0;
  ELSE
    PERFORM public.consume_credits(cost, 'Llamada privada · ' || cost || ' monedas por minuto');
  END IF;

  INSERT INTO public.cupido_calls
    (caller_id, callee_id, mode, video, credits_spent, minute_price, live_room_id, cash_earned)
  VALUES (actor, _callee, _mode, COALESCE(_video, FALSE), cost, cost, live_room, 0)
  RETURNING id INTO call_id;
  RETURN call_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_bill_call_minute(_call UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  call_row public.cupido_calls%ROWTYPE;
  minute_cost INTEGER;
  live_room UUID;
  usd_rate NUMERIC;
  payout NUMERIC(12, 2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO call_row FROM public.cupido_calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND OR call_row.caller_id <> auth.uid() THEN RAISE EXCEPTION 'CALL_BILLING_FORBIDDEN'; END IF;
  IF call_row.status <> 'active' THEN RETURN FALSE; END IF;
  IF lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
     OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_supremo') THEN RETURN TRUE; END IF;

  minute_cost := COALESCE(call_row.minute_price, CASE WHEN call_row.mode = 'hot' THEN 100 ELSE 50 END);
  BEGIN
    PERFORM public.consume_credits(minute_cost, 'Minuto de llamada Cupido');
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.cupido_calls SET status = 'ended', ended_at = now() WHERE id = _call;
    RETURN FALSE;
  END;

  live_room := call_row.live_room_id;
  IF live_room IS NULL THEN
    SELECT id INTO live_room FROM public.cupido_live_rooms
    WHERE host_id = call_row.callee_id AND is_live IS TRUE
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(cash) / NULLIF(SUM(credits), 0), 0.001)
  INTO usd_rate FROM public.cupido_gifts
  WHERE sort_order BETWEEN 1 AND 99 AND credits > 0;
  payout := round(minute_cost * COALESCE(usd_rate, 0.001), 2);

  UPDATE public.cupido_calls
  SET credits_spent = credits_spent + minute_cost,
      cash_earned = cash_earned + payout,
      live_room_id = COALESCE(call_row.live_room_id, live_room)
  WHERE id = _call;

  IF payout > 0 THEN
    INSERT INTO public.cupido_balances (user_id, balance, updated_at)
    VALUES (call_row.callee_id, payout, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance = public.cupido_balances.balance + EXCLUDED.balance,
          updated_at = now();
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_bill_call_minute(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_bill_call_minute(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_get_live_earnings(_room UUID)
RETURNS TABLE(received_coins BIGINT, usd_value NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cupido_live_rooms WHERE id = _room) THEN
    RAISE EXCEPTION 'LIVE_NOT_FOUND';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(g.credits) FROM public.cupido_gift_sends g WHERE g.live_room_id = _room), 0)::BIGINT
      + COALESCE((SELECT SUM(c.credits_spent) FROM public.cupido_calls c WHERE c.live_room_id = _room AND c.cash_earned > 0), 0)::BIGINT,
    COALESCE((SELECT SUM(g.cash_value) FROM public.cupido_gift_sends g WHERE g.live_room_id = _room), 0)::NUMERIC
      + COALESCE((SELECT SUM(c.cash_earned) FROM public.cupido_calls c WHERE c.live_room_id = _room AND c.cash_earned > 0), 0)::NUMERIC;
END;
$$;
REVOKE ALL ON FUNCTION public.cupido_get_live_earnings(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_get_live_earnings(UUID) TO authenticated;

-- Only an accepted call earns the host the already charged first minute.
CREATE OR REPLACE FUNCTION public.cupido_credit_accepted_live_call()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  usd_rate NUMERIC;
  payout NUMERIC(12, 2);
BEGIN
  IF NEW.status IS DISTINCT FROM 'active'
    OR OLD.status IS NOT DISTINCT FROM 'active'
    OR NEW.live_room_id IS NULL
    OR NEW.credits_spent <= 0
    OR NEW.cash_earned > 0
  THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(cash) / NULLIF(SUM(credits), 0), 0.001)
  INTO usd_rate FROM public.cupido_gifts
  WHERE sort_order BETWEEN 1 AND 99 AND credits > 0;
  payout := round(NEW.credits_spent * COALESCE(usd_rate, 0.001), 2);
  IF payout <= 0 THEN RETURN NEW; END IF;

  UPDATE public.cupido_calls SET cash_earned = payout WHERE id = NEW.id;
  INSERT INTO public.cupido_balances (user_id, balance, updated_at)
  VALUES (NEW.callee_id, payout, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.cupido_balances.balance + EXCLUDED.balance,
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_calls_credit_accepted_live_call ON public.cupido_calls;
CREATE TRIGGER cupido_calls_credit_accepted_live_call
AFTER UPDATE OF status ON public.cupido_calls
FOR EACH ROW EXECUTE FUNCTION public.cupido_credit_accepted_live_call();

CREATE OR REPLACE FUNCTION public.cupido_broadcast_live_earnings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
DECLARE topic_room UUID;
BEGIN
  topic_room := NEW.live_room_id;
  IF topic_room IS NULL THEN RETURN NEW; END IF;
  PERFORM realtime.send(
    jsonb_build_object('room_id', topic_room),
    'earnings-updated',
    'cupido-live-gifts-' || topic_room::TEXT,
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupido_gift_sends_broadcast_live_earnings ON public.cupido_gift_sends;
CREATE TRIGGER cupido_gift_sends_broadcast_live_earnings
AFTER INSERT ON public.cupido_gift_sends
FOR EACH ROW EXECUTE FUNCTION public.cupido_broadcast_live_earnings();

DROP TRIGGER IF EXISTS cupido_calls_broadcast_live_earnings ON public.cupido_calls;
CREATE TRIGGER cupido_calls_broadcast_live_earnings
AFTER INSERT OR UPDATE ON public.cupido_calls
FOR EACH ROW EXECUTE FUNCTION public.cupido_broadcast_live_earnings();
