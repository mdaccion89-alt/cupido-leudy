-- Allow the named Admin Supremo to load the existing admin dashboard through
-- its authenticated Supabase client, including from the Capacitor APK.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles',
    'user_credits',
    'user_roles',
    'creator_profiles',
    'cupido_login_metadata',
    'cupido_withdrawals'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', table_name);
      EXECUTE format('DROP POLICY IF EXISTS "cupido admin authenticated read" ON public.%I', table_name);
      EXECUTE format(
        'CREATE POLICY "cupido admin authenticated read" ON public.%I FOR SELECT TO authenticated USING (lower(COALESCE(auth.jwt()->>''email'', '''')) = ''leudyfeliz81@gmail.com'')',
        table_name
      );
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "cupido user credits owner read" ON public.user_credits;
CREATE POLICY "cupido user credits owner read" ON public.user_credits
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido user roles owner read" ON public.user_roles;
CREATE POLICY "cupido user roles owner read" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "cupido withdrawals owner read" ON public.cupido_withdrawals;
CREATE POLICY "cupido withdrawals owner read" ON public.cupido_withdrawals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- A restrictive legacy profile policy used has_role(), which is not the
-- authorization rule for this dashboard. Keep profile data private to owners
-- and allow only the one configured admin email to read other profiles.
DROP POLICY IF EXISTS "cupido profiles private guard" ON public.profiles;
CREATE POLICY "cupido profiles private guard" ON public.profiles
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    auth.uid() = id
    OR lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com'
  );

-- The public site row can be read by everyone; only the Admin Supremo may edit it.
DROP POLICY IF EXISTS "cupido admin authenticated update" ON public.site_settings;
CREATE POLICY "cupido admin authenticated update" ON public.site_settings
  FOR UPDATE TO authenticated
  USING (lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com');
GRANT UPDATE ON public.site_settings TO authenticated;

-- PayPal credentials remain unavailable to regular buyers. The storefront
-- gets only the public Client ID through the existing safe Supabase RPC.
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cupido admin authenticated manage payments" ON public.payment_settings;
CREATE POLICY "cupido admin authenticated manage payments" ON public.payment_settings
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt()->>'email', '')) = 'leudyfeliz81@gmail.com');
GRANT SELECT, INSERT, UPDATE ON public.payment_settings TO authenticated;
