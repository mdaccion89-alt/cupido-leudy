import { uploadOwnFile } from "@/lib/uploads";

function waitForEvent(target: HTMLVideoElement, event: string, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("El video tardó demasiado en responder."));
    }, timeoutMs);
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("No se pudo leer el video."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onSuccess);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onSuccess, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

export async function captureFrameFromVideoUrl(
  videoUrl: string,
  seconds = 0,
): Promise<{ blob: Blob; seconds: number }> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  const metadata = waitForEvent(video, "loadedmetadata");
  video.load();
  await metadata;

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const target = Math.max(0, Math.min(seconds, Math.max(0, duration - 0.05)));
  const seeking = waitForEvent(video, "seeked");
  video.currentTime = target;
  await seeking;

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("El video no tiene fotogramas legibles.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo capturar el fotograma.");
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo convertir el fotograma en imagen.");
  video.removeAttribute("src");
  video.load();
  return { blob, seconds: target };
}

export async function uploadCapturedFrame(
  userId: string,
  blob: Blob,
  seconds: number,
): Promise<string> {
  return uploadOwnFile(
    userId,
    blob,
    `frame-${Math.round(seconds * 10)}-${Date.now()}.png`,
    "frames",
  );
}
