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
  if (typeof MediaRecorder === "undefined") throw new Error("Este navegador no admite filtros de video.");

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  video.muted = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("No se pudo leer el video."));
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(1280, video.videoWidth || 640);
  canvas.height = Math.max(1, Math.round(canvas.width * (video.videoHeight || 480) / (video.videoWidth || 640)));
  const context = canvas.getContext("2d");
  if (!context || !canvas.captureStream) {
    URL.revokeObjectURL(url);
    throw new Error("Este navegador no admite filtros de video.");
  }
  const stream = canvas.captureStream(24);
  const audioContext = new AudioContext();
  const audioOutput = audioContext.createMediaStreamDestination();
  const source = audioContext.createMediaElementSource(video);
  source.connect(audioOutput);
  audioOutput.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  const type = recorderType();
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  const recording = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error("No se pudo filtrar el video."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  });
  let frameId = 0;
  const paint = () => {
    if (video.readyState >= 2) {
      context.filter = mediaFilterCss(filter);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    if (!video.ended) frameId = requestAnimationFrame(paint);
  };
  try {
    await audioContext.resume();
    await video.play();
    recorder.start(250);
    paint();
    await new Promise<void>((resolve) => { video.onended = () => resolve(); });
    if (recorder.state !== "inactive") recorder.stop();
    const blob = await recording;
    return new File([blob], outputName(file.name, "webm"), { type: blob.type, lastModified: Date.now() });
  } finally {
    cancelAnimationFrame(frameId);
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    await audioContext.close().catch(() => undefined);
    video.pause();
    video.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
