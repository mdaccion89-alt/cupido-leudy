-- PayPal secrets are read and written only by authenticated admin server functions.
ALTER TABLE public.payment_settings
  ADD COLUMN IF NOT EXISTS paypal_client_id text,
  ADD COLUMN IF NOT EXISTS paypal_secret text,
  ADD COLUMN IF NOT EXISTS paypal_mode text;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS paypal_client_id text,
  ADD COLUMN IF NOT EXISTS paypal_secret text,
  ADD COLUMN IF NOT EXISTS paypal_mode text;

-- Move legacy credentials out of the general-purpose JSON config before removing those keys.
UPDATE public.app_settings
   SET paypal_client_id = coalesce(nullif(paypal_client_id, ''), nullif(config->>'paypal_client_id', ''), nullif(config->>'paypalClientId', '')),
       paypal_secret = coalesce(nullif(paypal_secret, ''), nullif(config->>'paypal_secret', ''), nullif(config->>'paypalSecret', '')),
       paypal_mode = coalesce(nullif(paypal_mode, ''), nullif(config->>'paypal_mode', ''), nullif(config->>'mode', '')),
       config = config - 'paypal_secret' - 'paypalSecret'
 WHERE config ?| ARRAY['paypal_secret', 'paypalSecret'];

-- Public client credentials are safe to read; PayPal secrets stay server-only.
CREATE OR REPLACE FUNCTION public.cupido_public_paypal_client_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    nullif(btrim(payment.paypal_client_id), ''),
    nullif(btrim(app.paypal_client_id), ''),
    nullif(btrim(app.config->>'paypal_client_id'), ''),
    nullif(btrim(app.config->>'paypalClientId'), ''),
    nullif(btrim(app.config->>'clientId'), '')
  )
  FROM (SELECT 1) singleton
  LEFT JOIN public.payment_settings payment ON payment.id = 1
  LEFT JOIN public.app_settings app ON app.id = 1;
$$;
REVOKE ALL ON FUNCTION public.cupido_public_paypal_client_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupido_public_paypal_client_id()
  TO anon, authenticated, service_role;

-- Publish follows so profile, video and Live follow state updates immediately.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'follows'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.follows;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
