BEGIN;

-- Withdrawal metadata does not change the USD ledger or payment methods.
ALTER TABLE public.cupido_withdrawals
  ADD COLUMN IF NOT EXISTS daily_request_number INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_priority TEXT;

-- Populate a stable priority for existing requests without touching amounts.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, date_trunc('day', created_at)
      ORDER BY created_at, id
    )::INTEGER AS request_number
  FROM public.cupido_withdrawals
)
UPDATE public.cupido_withdrawals AS w
SET daily_request_number = ranked.request_number,
    delivery_priority = CASE
      WHEN ranked.request_number = 1 THEN 'same_day'
      ELSE 'additional_1_2_days'
    END
FROM ranked
WHERE ranked.id = w.id
  AND (w.daily_request_number IS DISTINCT FROM ranked.request_number
       OR w.delivery_priority IS DISTINCT FROM CASE
         WHEN ranked.request_number = 1 THEN 'same_day'
         ELSE 'additional_1_2_days'
       END);

ALTER TABLE public.cupido_withdrawals
  ALTER COLUMN daily_request_number SET DEFAULT 1,
  ALTER COLUMN daily_request_number SET NOT NULL,
  ALTER COLUMN delivery_priority SET DEFAULT 'same_day',
  ALTER COLUMN delivery_priority SET NOT NULL;

CREATE INDEX IF NOT EXISTS cupido_withdrawals_user_priority_day_idx
  ON public.cupido_withdrawals (user_id, created_at DESC, delivery_priority);

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
  method_key TEXT := lower(btrim(COALESCE(_method, '')));
  destination TEXT := btrim(COALESCE(_account_details, ''));
  email_pattern CONSTANT TEXT := '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$';
  phone_digits TEXT;
  destination_lines TEXT[];
  requests_today INTEGER;
  new_request_number INTEGER;
  new_priority TEXT;
BEGIN
  IF current_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF _amount IS NULL OR _amount::TEXT = 'NaN' OR _amount < 0.01 THEN
    RAISE EXCEPTION 'MINIMUM_WITHDRAWAL_USD_0_01';
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

  -- Serialize requests per account, including accounts whose ledger row is absent.
  PERFORM pg_advisory_xact_lock(hashtextextended(current_id::TEXT, 0));

  SELECT count(*)::INTEGER
    INTO requests_today
    FROM public.cupido_withdrawals
   WHERE user_id = current_id
     AND created_at >= date_trunc('day', now())
     AND created_at < date_trunc('day', now()) + INTERVAL '1 day';
  new_request_number := COALESCE(requests_today, 0) + 1;
  new_priority := CASE
    WHEN new_request_number = 1 THEN 'same_day'
    ELSE 'additional_1_2_days'
  END;

  -- cupido_balances is the sole withdrawable USD ledger. Coin/credit balances
  -- and the profile mirror are deliberately never used to fund a withdrawal.
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
    (user_id, amount, country_code, method, account_details, status,
     daily_request_number, delivery_priority)
  VALUES
    (current_id, _amount, upper(btrim(_country_code)), btrim(_method), destination, 'pending',
     new_request_number, new_priority)
  RETURNING id INTO withdrawal_id;

  RETURN withdrawal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupido_request_withdrawal(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
