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
  minimum_amount NUMERIC(20,2) := 50;
BEGIN
  IF current_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF EXISTS (SELECT 1 FROM public.creator_profiles WHERE id = current_id AND is_gran_liga)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = current_id AND is_gran_liga) THEN
    minimum_amount := 20;
  END IF;
  IF _amount IS NULL OR _amount < minimum_amount THEN
    RAISE EXCEPTION 'MINIMUM_WITHDRAWAL_USD_%', minimum_amount;
  END IF;
  IF NULLIF(btrim(_country_code), '') IS NULL
     OR NULLIF(btrim(_method), '') IS NULL
     OR NULLIF(btrim(_account_details), '') IS NULL THEN
    RAISE EXCEPTION 'WITHDRAWAL_DETAILS_REQUIRED';
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
GRANT EXECUTE ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
