-- Enable row-change notifications used for live story views and account balances.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'cupido_story_views',
      'user_credits',
      'profiles',
      'cupido_balances'
    ] LOOP
      IF to_regclass('public.' || table_name) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM pg_publication_tables
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
