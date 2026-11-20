-- Public image buckets for avatars, logos, banners and posts.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('media', 'media', true),
  ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Anyone reads public media" ON storage.objects;
CREATE POLICY "Anyone reads public media" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('media', 'avatars'));

DROP POLICY IF EXISTS "Users add own public media" ON storage.objects;
CREATE POLICY "Users add own public media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('media', 'avatars') AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users update own public media" ON storage.objects;
CREATE POLICY "Users update own public media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('media', 'avatars') AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own public media" ON storage.objects;
CREATE POLICY "Users delete own public media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('media', 'avatars') AND (storage.foldername(name))[1] = auth.uid()::text);
