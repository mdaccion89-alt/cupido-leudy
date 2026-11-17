REVOKE INSERT, UPDATE ON public.songs FROM authenticated;
GRANT UPDATE (title, is_public, published_at) ON public.songs TO authenticated;
DROP POLICY IF EXISTS "Users create own songs" ON public.songs;

CREATE POLICY "Admin uploads site files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin updates site files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'site' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin deletes site files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site' AND public.has_role(auth.uid(), 'admin'));