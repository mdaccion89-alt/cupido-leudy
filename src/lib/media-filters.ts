export const MEDIA_FILTERS = [
  { id: "normal", label: "Normal", css: "none" },
  { id: "warm", label: "Cálido", css: "sepia(0.25) saturate(1.25) hue-rotate(-8deg)" },
  { id: "glam", label: "Glam", css: "brightness(1.08) saturate(1.35) contrast(1.04)" },
  { id: "mono", label: "Blanco y negro", css: "grayscale(1)" },
  { id: "vintage", label: "Vintage", css: "sepia(0.35) contrast(0.92) brightness(1.04)" },
  { id: "neon", label: "Neón", css: "saturate(1.8) hue-rotate(25deg) contrast(1.1)" },
] as const;

export type MediaFilterId = (typeof MEDIA_FILTERS)[number]["id"];

export function mediaFilterCss(filter: MediaFilterId): string {
  return MEDIA_FILTERS.find((item) => item.id === filter)?.css ?? "none";
}

function outputName(name: string, extension: string) {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "cupido-media";
  return `${stem}.${extension}`;
}

function recorderType(): string | undefined {
  const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return options.find((type) => MediaRecorder.isTypeSupported(type));
}

export async function applyMediaFilter(file: File, filter: MediaFilterId): Promise<File> {
  if (filter === "normal") return file;
  if (file.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo procesar la imagen.");
    context.filter = mediaFilterCss(filter);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("No se pudo aplicar el filtro.")), "image/jpeg", 0.9);
    });
    return new File([blob], outputName(file.name, "jpg"), { type: "image/jpeg", lastModified: Date.now() });
  }
  if (!file.type.startsWith("video/")) return file;
  if (typeof MediaRecorder === "undefined") return file;

  const video = document.createElement("video");
  let url = "";
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let recorder: MediaRecorder | null = null;
  let frameId = 0;
  let playbackTimer = 0;
  let metadataTimer = 0;
  try {
    url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.playsInline = true;
    video.muted = true;
    const metadataReady = await new Promise<boolean>((resolve) => {
      const finish = (ready: boolean) => {
        window.clearTimeout(metadataTimer);
        video.onloadedmetadata = null;
        video.onerror = null;
        resolve(ready);
      };
      video.onloadedmetadata = () => finish(video.videoWidth > 0 && video.videoHeight > 0);
      video.onerror = () => finish(false);
      metadataTimer = window.setTimeout(() => finish(false), 4_000);
      video.src = url;
    });
    if (!metadataReady) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1280, video.videoWidth || 640);
    canvas.height = Math.max(1, Math.round(canvas.width * (video.videoHeight || 480) / (video.videoWidth || 640)));
    const context = canvas.getContext("2d");
    if (!context || !canvas.captureStream) return file;

    stream = canvas.captureStream(24);
    audioContext = new AudioContext();
    const audioOutput = audioContext.createMediaStreamDestination();
    source = audioContext.createMediaElementSource(video);
    source.connect(audioOutput);
    audioOutput.stream.getAudioTracks().forEach((track) => stream?.addTrack(track));
    const type = recorderType();
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const recording = new Promise<Blob | null>((resolve) => {
      recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = () => resolve(null);
      recorder!.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: recorder?.mimeType || "video/webm" }) : null);
    });
    const paint = () => {
      if (video.readyState >= 2) {
        context.filter = mediaFilterCss(filter);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      if (!video.ended) frameId = requestAnimationFrame(paint);
    };

    await audioContext.resume();
    await video.play();
    recorder.start(250);
    paint();
    const maxWait = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(180_000, video.duration * 1000 + 5_000)
      : 35_000;
    const reachedEnd = await Promise.race([
      new Promise<boolean>((resolve) => { video.onended = () => resolve(true); }),
      new Promise<boolean>((resolve) => { playbackTimer = window.setTimeout(() => resolve(false), maxWait); }),
    ]);
    if (playbackTimer) window.clearTimeout(playbackTimer);
    if (!reachedEnd) {
      if (recorder.state !== "inactive") recorder.stop();
      await recording;
      return file;
    }
    if (recorder.state !== "inactive") recorder.stop();
    const blob = await recording;
    if (!blob?.size) return file;
    return new File([blob], outputName(file.name, "webm"), { type: blob.type, lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    window.clearTimeout(metadataTimer);
    window.clearTimeout(playbackTimer);
    cancelAnimationFrame(frameId);
    if (recorder?.state !== "inactive") recorder?.stop();
    stream?.getTracks().forEach((track) => track.stop());
    try { source?.disconnect(); } catch { /* The audio graph may already be closed. */ }
    await audioContext?.close().catch(() => undefined);
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch { /* A decoder failure must fall back to the source file. */ }
    if (url) {
      try { URL.revokeObjectURL(url); } catch { /* The temporary URL may already be released. */ }
    }
  }
}
