CREATE TABLE public.songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid(),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  genre TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating',
  error TEXT,
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.songs TO authenticated;
GRANT ALL ON public.songs TO service_role;

ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own songs" ON public.songs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users create own songs" ON public.songs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own songs" ON public.songs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own songs" ON public.songs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX songs_user_created_idx ON public.songs (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER songs_touch_updated_at BEFORE UPDATE ON public.songs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "Users read own song files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users upload own song files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own song files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);