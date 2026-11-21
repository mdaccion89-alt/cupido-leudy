ALTER TABLE public.cupido_calls
  ADD COLUMN IF NOT EXISTS video BOOLEAN NOT NULL DEFAULT FALSE;

DROP FUNCTION IF EXISTS public.cupido_start_call(UUID, TEXT);

CREATE FUNCTION public.cupido_start_call(
  _callee UUID,
  _mode TEXT,
  _video BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cost INTEGER;
  cid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _callee IS NULL OR _callee = auth.uid() THEN RAISE EXCEPTION 'INVALID_CALLEE'; END IF;
  IF _mode NOT IN ('hot', 'cafe') THEN RAISE EXCEPTION 'INVALID_CALL_MODE'; END IF;

  cost := CASE WHEN _mode = 'hot' THEN 100 ELSE 50 END;
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'admin_supremo') THEN
    IF NOT COALESCE((SELECT has_purchased FROM public.profiles WHERE id = auth.uid()), FALSE)
       AND NOT EXISTS (
         SELECT 1 FROM public.paypal_orders
         WHERE user_id = auth.uid() AND status = 'captured'
       ) THEN
      RAISE EXCEPTION 'PURCHASE_REQUIRED';
    END IF;
    PERFORM public.consume_credits(cost, 'Llamada ' || _mode || ' en Cupido Leudy');
  ELSE
    cost := 0;
  END IF;

  INSERT INTO public.cupido_calls (caller_id, callee_id, mode, video, credits_spent)
  VALUES (auth.uid(), _callee, _mode, COALESCE(_video, FALSE), cost)
  RETURNING id INTO cid;
  RETURN cid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cupido_start_call(UUID, TEXT, BOOLEAN) TO authenticated;
