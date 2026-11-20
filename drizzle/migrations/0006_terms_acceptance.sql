-- Aceptación del Manual de Uso y Normas (idempotente).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.cupido_terms_acceptance (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cupido_terms_acceptance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own terms acceptance" ON public.cupido_terms_acceptance;
CREATE POLICY "Users read own terms acceptance" ON public.cupido_terms_acceptance FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own terms acceptance" ON public.cupido_terms_acceptance;
CREATE POLICY "Users insert own terms acceptance" ON public.cupido_terms_acceptance FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.cupido_terms_acceptance TO authenticated;

CREATE OR REPLACE FUNCTION public.cupido_accept_terms(_version TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.cupido_terms_acceptance (user_id, version, accepted_at)
  VALUES (auth.uid(), _version, now())
  ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, accepted_at = now();
  UPDATE public.profiles SET terms_accepted_at = now(), updated_at = now() WHERE id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.cupido_accept_terms(TEXT) TO authenticated;

DO $$
DECLARE admin_id UUID;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE lower(email) = 'leudyfeliz81@gmail.com' LIMIT 1;
  IF admin_id IS NOT NULL THEN
    INSERT INTO public.cupido_terms_acceptance (user_id, version) VALUES (admin_id, '2026-01')
      ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, accepted_at = now();
    UPDATE public.profiles SET terms_accepted_at = now() WHERE id = admin_id;
  END IF;
END $$;
