BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS withdrawable_balance NUMERIC(20,2) NOT NULL DEFAULT 0;

-- cupido_balances is the atomic withdrawal ledger. Keep the profile field as
-- its realtime-readable mirror, preserving all existing wallet amounts.
UPDATE public.profiles AS p
SET withdrawable_balance = b.balance
FROM public.cupido_balances AS b
WHERE b.user_id = p.id
  AND p.withdrawable_balance IS DISTINCT FROM b.balance;

CREATE OR REPLACE FUNCTION public.cupido_sync_profile_withdrawable_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET withdrawable_balance = COALESCE(NEW.balance, 0)
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cupido_sync_profile_withdrawable_balance() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cupido_sync_profile_withdrawable_balance ON public.cupido_balances;
CREATE TRIGGER cupido_sync_profile_withdrawable_balance
AFTER INSERT OR UPDATE ON public.cupido_balances
FOR EACH ROW EXECUTE FUNCTION public.cupido_sync_profile_withdrawable_balance();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'profiles'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
