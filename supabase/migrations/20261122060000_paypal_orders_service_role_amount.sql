ALTER TABLE public.paypal_orders
  ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(12, 2);

UPDATE public.paypal_orders
SET amount_usd = amount::NUMERIC
WHERE amount_usd IS NULL;

ALTER TABLE public.paypal_orders
  ALTER COLUMN amount_usd SET NOT NULL,
  ALTER COLUMN currency SET DEFAULT 'USD',
  ALTER COLUMN status SET DEFAULT 'created',
  ALTER COLUMN created_at SET DEFAULT now();

GRANT ALL ON TABLE public.paypal_orders TO service_role;
