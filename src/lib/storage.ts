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

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Formato de imagen no compatible."));
    image.src = src;
  });
}

export async function compressImageFile(file: File, targetBytes = 150 * 1024): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  try {
    const image = await loadImage(await readAsDataUrl(file));
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= targetBytes) break;
      quality -= 0.1;
    }
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer el video."));
    };
    video.src = url;
  });
}

export async function uploadPublicImage(
  userId: string,
  file: Blob,
  folder: string,
  extension: string,
): Promise<{ bucket: string; path: string; url: string }> {
  const path = publicImagePath(userId, folder, extension);
  let lastError = "";

  for (const bucket of ["media", ...PUBLIC_IMAGE_BUCKETS.filter((name) => name !== "media")]) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
    if (!error) return { bucket, path, url: publicImageUrl(bucket, path) };
    lastError = error.message;
  }

  throw new Error(lastError || "No se pudo subir la imagen.");
}
