-- Gran Liga is now offered at US$60 (40% off its former US$100 price).
-- Keep the previous amount valid for orders created before this promotion.
CREATE OR REPLACE FUNCTION public.cupido_finalize_paypal_package(
  _order_id UUID,
  _user_id UUID,
  _credits INTEGER,
  _gran_liga BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_row public.paypal_orders%ROWTYPE;
  resulting_balance INTEGER;
  infinite_admin BOOLEAN;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT * INTO order_row FROM public.paypal_orders
  WHERE id = _order_id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_FOUND'; END IF;
  IF order_row.credits <> _credits THEN RAISE EXCEPTION 'PAYPAL_CREDIT_MISMATCH'; END IF;
  IF (_gran_liga AND (order_row.package_id <> 'gran-liga-100' OR order_row.amount::NUMERIC NOT IN (60, 100) OR _credits <> 1000000))
     OR (NOT _gran_liga AND order_row.package_id = 'gran-liga-100') THEN
    RAISE EXCEPTION 'PAYPAL_PACKAGE_MISMATCH';
  END IF;
  SELECT lower(coalesce(email, '')) = 'leudyfeliz81@gmail.com'
    INTO infinite_admin FROM auth.users WHERE id = _user_id;
  IF order_row.status = 'captured' THEN
    UPDATE public.profiles SET has_purchased = TRUE, has_recharged = TRUE,
      is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
    RETURN TRUE;
  END IF;
  IF order_row.status <> 'created' THEN RAISE EXCEPTION 'PAYPAL_ORDER_NOT_PENDING'; END IF;
  IF coalesce(infinite_admin, false) THEN
    resulting_balance := -1;
  ELSE
    PERFORM public.grant_credits(_user_id => _user_id, _amount => _credits,
      _reason => 'Compra PayPal ' || _credits || ' monedas');
    SELECT balance INTO resulting_balance FROM public.user_credits WHERE user_id = _user_id;
  END IF;
  IF resulting_balance IS NULL THEN RAISE EXCEPTION 'CREDIT_GRANT_FAILED'; END IF;
  UPDATE public.profiles SET credits = resulting_balance, credits_balance = resulting_balance,
    has_purchased = TRUE, has_recharged = TRUE,
    is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
  UPDATE public.creator_profiles SET is_gran_liga = is_gran_liga OR _gran_liga WHERE id = _user_id;
  UPDATE public.paypal_orders SET status = 'captured', captured_at = now()
  WHERE id = _order_id AND status = 'created';
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_finalize_paypal_package(UUID, UUID, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupido_finalize_paypal_package(UUID, UUID, INTEGER, BOOLEAN)
  TO service_role;
