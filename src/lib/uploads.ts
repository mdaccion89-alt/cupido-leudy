import { supabase } from "@/integrations/supabase/client";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function uploadOwnFile(userId: string, file: Blob, name: string, folder: string): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("El archivo supera los 25 MB.");
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("uploads").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new Error("No se pudo subir el archivo.");
  return path;
}
