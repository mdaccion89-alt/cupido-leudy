-- A missed mobile heartbeat must never end a public Live. This legacy RPC was
-- previously called from feed queries and closed rooms after 45 seconds.
-- Keep its signature for older clients and scheduled jobs, but make it harmless.
CREATE OR REPLACE FUNCTION public.cupido_end_stale_lives()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.cupido_end_stale_lives() IS
  'Deprecated no-op: public Live rooms are ended only by the host or an administrator.';
