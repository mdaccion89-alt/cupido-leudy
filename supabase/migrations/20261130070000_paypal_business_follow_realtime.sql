-- PayPal secrets are read and written only by authenticated admin server functions.
ALTER TABLE public.payment_settings
  ADD COLUMN IF NOT EXISTS paypal_client_id text,
  ADD COLUMN IF NOT EXISTS paypal_secret text,
  ADD COLUMN IF NOT EXISTS paypal_mode text;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS paypal_client_id text,
  ADD COLUMN IF NOT EXISTS paypal_mode text;

-- Keep the secret only in payment_settings; app_settings may have public read access.
INSERT INTO public.payment_settings AS existing (id, paypal_business_name, paypal_email, paypal_client_id, paypal_secret, paypal_mode)
SELECT 1,
       coalesce(nullif(app.config->>'paypal_business_name', ''), nullif(app.config->>'business_name', ''), ''),
       coalesce(nullif(app.config->>'paypal_email', ''), nullif(app.config->>'admin_paypal_email', ''), ''),
       coalesce(nullif(app.config->>'paypal_client_id', ''), nullif(app.config->>'paypalClientId', ''), nullif(app.config->>'clientId', ''), ''),
       coalesce(nullif(app.config->>'paypal_secret', ''), nullif(app.config->>'paypalSecret', ''), ''),
       coalesce(nullif(app.config->>'paypal_mode', ''), nullif(app.config->>'mode', ''), 'live')
  FROM public.app_settings AS app
 WHERE app.id = 1 AND app.config ?| ARRAY['paypal_secret', 'paypalSecret']
ON CONFLICT (id) DO UPDATE
   SET paypal_secret = coalesce(nullif(existing.paypal_secret, ''), EXCLUDED.paypal_secret),
       paypal_client_id = coalesce(nullif(existing.paypal_client_id, ''), EXCLUDED.paypal_client_id),
       paypal_email = coalesce(nullif(existing.paypal_email, ''), EXCLUDED.paypal_email),
       paypal_business_name = coalesce(nullif(existing.paypal_business_name, ''), EXCLUDED.paypal_business_name),
       paypal_mode = coalesce(nullif(existing.paypal_mode, ''), EXCLUDED.paypal_mode);

-- Move the public client ID and mode, then remove any legacy secret from JSON.
UPDATE public.app_settings
   SET paypal_client_id = coalesce(nullif(paypal_client_id, ''), nullif(config->>'paypal_client_id', ''), nullif(config->>'paypalClientId', '')),
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
ALTER TABLE public.cupido_follower_count_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupido_follower_count_events_public_read ON public.cupido_follower_count_events;
CREATE POLICY cupido_follower_count_events_public_read
  ON public.cupido_follower_count_events FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.cupido_follower_count_events TO anon, authenticated;

DO $$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY['follows', 'cupido_follower_count_events', 'notifications'] LOOP
      IF to_regclass('public.' || table_name) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = table_name
         ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
      END IF;
    END LOOP;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
