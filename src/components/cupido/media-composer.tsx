import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImagePlus, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MEDIA_FILTERS, applyMediaFilter, mediaFilterCss, type MediaFilterId } from "@/lib/media-filters";

type MediaComposerProps = {
  disabled?: boolean;
  onFile: (file: File, filter: MediaFilterId) => Promise<void> | void;
  galleryLabel?: string;
  cameraOnly?: boolean;
  onFilterChange?: (filter: MediaFilterId) => void;
};

export function MediaComposer({ disabled = false, onFile, galleryLabel = "Galería", cameraOnly = false, onFilterChange }: MediaComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const [filter, setFilter] = useState<MediaFilterId>("normal");
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);

  const stopCamera = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
    timeoutRef.current = null;
    countdownRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
  };

  useEffect(() => stopCamera, []);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setWorking(true);
    try {
      const filtered = await applyMediaFilter(file, filter);
      await onFile(filtered, filter);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo procesar el archivo.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setWorking(false);
    }
  };

  const startCamera = async () => {
    if (typeof MediaRecorder === "undefined" || !canvasRef.current?.captureStream) {
      toast.error("Este dispositivo no admite grabación de video en el navegador.");
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: true });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      }
      streamRef.current = stream;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) throw new Error("No se pudo abrir la vista de cámara.");
      video.srcObject = stream;
      await video.play();
      await new Promise<void>((resolve) => {
        const waitForFrame = () => video.videoWidth ? resolve() : requestAnimationFrame(waitForFrame);
        waitForFrame();
      });
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar la cámara.");
      const output = canvas.captureStream(24);
      stream.getAudioTracks().forEach((track) => output.addTrack(track));
      const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
      const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(output, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => toast.error("No se pudo guardar el video grabado.");
      recorder.onstop = () => {
        output.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        if (blob.size) {
          const file = new File([blob], `cupido-${Date.now()}.webm`, { type: blob.type });
          setWorking(true);
          void Promise.resolve(onFile(file, filter)).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : "No se pudo publicar el video.");
          }).finally(() => setWorking(false));
        }
      };
      const paint = () => {
        if (video.readyState >= 2) {
          context.filter = mediaFilterCss(filter);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        if (recorder.state === "recording") frameRef.current = requestAnimationFrame(paint);
      };
      recorder.start(250);
      setSecondsLeft(30);
      setRecording(true);
      paint();
      countdownRef.current = window.setInterval(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000);
      timeoutRef.current = window.setTimeout(stopCamera, 30_000);
    } catch (error) {
      stopCamera();
      toast.error(error instanceof Error ? error.message : "No se pudo abrir la cámara.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="cupido-media-filter">Filtro</label>
      <select
        id="cupido-media-filter"
        value={filter}
        disabled={disabled || recording || working}
        onChange={(event) => {
          const next = event.target.value as MediaFilterId;
          setFilter(next);
          onFilterChange?.(next);
        }}
        className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      >
        {MEDIA_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      {!cameraOnly && <>
        <input ref={inputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(event) => void chooseFile(event)} />
        <Button variant="outline" size="sm" className="gap-2" onClick={() => inputRef.current?.click()} disabled={disabled || working || recording}>
          {working ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {working ? "Procesando..." : galleryLabel}
        </Button>
      </>}
      {!recording ? (
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void startCamera()} disabled={disabled || working}>
          <Camera className="size-4" /> Grabar video
        </Button>
      ) : (
        <Button variant="destructive" size="sm" className="gap-2" onClick={stopCamera}>
          <Square className="size-3.5 fill-current" /> Detener y publicar ({secondsLeft}s)
        </Button>
      )}
      <video ref={videoRef} muted playsInline className={recording ? "max-h-40 w-full rounded-xl object-cover" : "hidden"} style={{ filter: mediaFilterCss(filter) }} />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
