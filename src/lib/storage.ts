import { supabase } from "@/integrations/supabase/client";

export const PUBLIC_IMAGE_BUCKETS = ["media", "avatars", "cupido-media"] as const;

export function safeExtension(name: string, fallback: string): string {
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned || fallback;
}

export function publicImagePath(userId: string, folder: string, extension: string): string {
  return `${userId}/${folder}/${crypto.randomUUID()}.${extension}`;
}

export function publicImageUrl(bucket: string, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function uploadPublicImage(
  userId: string,
  file: Blob,
  folder: string,
  extension: string,
): Promise<{ bucket: string; path: string; url: string }> {
  const path = publicImagePath(userId, folder, extension);
  let lastError = "";

  for (const bucket of PUBLIC_IMAGE_BUCKETS) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
    if (!error) return { bucket, path, url: publicImageUrl(bucket, path) };
    lastError = error.message;
  }

  throw new Error(lastError || "No se pudo subir la imagen.");
}
