BEGIN;

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

  IF NOT is_infinite_admin
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = sender AND p.has_recharged)
    AND NOT EXISTS (SELECT 1 FROM public.paypal_orders o WHERE o.user_id = sender AND o.status = 'captured')
  THEN
    RAISE EXCEPTION 'PURCHASE_REQUIRED';
  END IF;

  IF NOT is_infinite_admin THEN
    PERFORM public.consume_credits(gift.credits, 'Regalo Cupido: ' || gift.name);
  END IF;

  INSERT INTO public.cupido_gift_sends (sender_id, receiver_id, gift_id, credits, cash_value)
  VALUES (sender, _receiver, gift.id, gift.credits, gift.cash)
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

REVOKE ALL ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_transfer_gift(UUID, TEXT, UUID) TO authenticated;

COMMIT;
