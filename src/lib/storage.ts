import { supabase } from "@/integrations/supabase/client";

export const PUBLIC_IMAGE_BUCKETS = ["media", "avatars", "cupido-media"] as const;
export const SUPPORTED_VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "mkv", "3gp", "m4v"] as const;

export function safeExtension(name: string, fallback: string): string {
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned || fallback;
}

const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
};

const VIDEO_EXTENSION_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
  m4v: "video/mp4",
};

export function isVideoFile(file: File): boolean {
  const extension = safeExtension(file.name, "").toLowerCase();
  return file.type.startsWith("video/") || SUPPORTED_VIDEO_EXTENSIONS.includes(extension as (typeof SUPPORTED_VIDEO_EXTENSIONS)[number]);
}

export function videoFileExtension(file: File): string {
  const extension = safeExtension(file.name, "").toLowerCase();
  if (SUPPORTED_VIDEO_EXTENSIONS.includes(extension as (typeof SUPPORTED_VIDEO_EXTENSIONS)[number])) return extension;
  return VIDEO_MIME_EXTENSIONS[file.type.toLowerCase()] ?? "mp4";
}

export function videoContentType(file: File, extension = videoFileExtension(file)): string {
  if (file.type.startsWith("video/")) return file.type;
  return (VIDEO_EXTENSION_TYPES[extension] ?? file.type) || "video/mp4";
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

export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    let url = "";
    let timer = 0;
    const video = document.createElement("video");
    const finish = (duration: number | null) => {
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // An Android WebView decoder can throw while releasing an unsupported codec.
      }
      if (url) {
        try { URL.revokeObjectURL(url); } catch { /* The temporary URL may already be released. */ }
      }
      resolve(duration);
    };
    try {
      url = URL.createObjectURL(file);
      video.preload = "metadata";
      video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
      video.onerror = () => finish(null);
      timer = window.setTimeout(() => finish(null), 4_000);
      video.src = url;
    } catch {
      finish(null);
    }
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
