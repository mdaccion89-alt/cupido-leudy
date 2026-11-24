BEGIN;

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
  method_key TEXT := translate(
    lower(btrim(COALESCE(_method, ''))),
    'áéíóúüñçãõêô',
    'aeiouuncaoeo'
  );
  destination TEXT := btrim(COALESCE(_account_details, ''));
  email_pattern CONSTANT TEXT := '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$';
  phone_digits TEXT;
  destination_lines TEXT[];
BEGIN
  IF current_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF _amount IS NULL OR _amount::TEXT = 'NaN' OR _amount < 20 THEN
    RAISE EXCEPTION 'MINIMUM_WITHDRAWAL_USD_20';
  END IF;
  IF _amount <> round(_amount, 2) THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_AMOUNT';
  END IF;
  IF NULLIF(btrim(COALESCE(_country_code, '')), '') IS NULL
     OR method_key = ''
     OR destination = '' THEN
    RAISE EXCEPTION 'WITHDRAWAL_DETAILS_REQUIRED';
  END IF;
  IF char_length(destination) > 500 THEN
    RAISE EXCEPTION 'WITHDRAWAL_DESTINATION_TOO_LONG';
  END IF;

  IF method_key ~ '(paypal|payoneer)' THEN
    IF destination !~ email_pattern THEN
      RAISE EXCEPTION 'INVALID_DESTINATION_EMAIL';
    END IF;
  ELSIF method_key ~ 'zelle' THEN
    phone_digits := regexp_replace(destination, '[^0-9]', '', 'g');
    IF destination !~ email_pattern
       AND NOT (
         destination ~ '^[+0-9().[:space:]-]+$'
         AND char_length(phone_digits) BETWEEN 10 AND 15
       ) THEN
      RAISE EXCEPTION 'INVALID_ZELLE_DESTINATION';
    END IF;
  ELSIF method_key ~ '(transferencia bancaria|banco rd|bank rd|bank transfer|wire transfer)' THEN
    destination_lines := string_to_array(destination, E'\n');
    IF COALESCE(destination_lines[1], '') !~* '^Banco:[[:space:]]*[^[:space:]]'
       OR COALESCE(destination_lines[2], '') !~* '^Titular:[[:space:]]*[^[:space:]]'
       OR COALESCE(destination_lines[3], '') !~* '^N[uú]mero de cuenta:[[:space:]]*[^[:space:]]' THEN
      RAISE EXCEPTION 'BANK_DESTINATION_REQUIRED';
    END IF;
  ELSIF method_key ~ '(binance|usdt|crypto|cripto|wallet|billetera)' THEN
    IF destination !~ '^[A-Za-z0-9._:-]{6,128}$' THEN
      RAISE EXCEPTION 'INVALID_CRYPTO_DESTINATION';
    END IF;
  END IF;

  SELECT balance
    INTO available
    FROM public.cupido_balances
   WHERE user_id = current_id
   FOR UPDATE;
  IF COALESCE(available, 0) < _amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_WITHDRAWABLE_BALANCE';
  END IF;

  UPDATE public.cupido_balances
     SET balance = balance - _amount,
         updated_at = now()
   WHERE user_id = current_id;

  INSERT INTO public.cupido_withdrawals
    (user_id, amount, country_code, method, account_details, status)
  VALUES
    (current_id, _amount, upper(btrim(_country_code)), btrim(_method), destination, 'pending')
  RETURNING id INTO withdrawal_id;

  RETURN withdrawal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
