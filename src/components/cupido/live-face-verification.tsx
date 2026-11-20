import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyCupidoLiveFace } from "@/lib/cupido.functions";

const LIVE_STEPS = [
  { label: "Mira de frente", hint: "Coloca tu rostro centrado y sin lentes oscuros." },
  { label: "Gira hacia la derecha", hint: "Gira lentamente tu rostro hacia tu hombro derecho." },
  { label: "Gira hacia la izquierda", hint: "Gira lentamente tu rostro hacia tu hombro izquierdo." },
];

type LiveFaceVerificationProps = {
  onComplete: (frames: string[]) => Promise<void>;
};

export function LiveFaceVerification({ onComplete }: LiveFaceVerificationProps) {
  const verify = useServerFn(verifyCupidoLiveFace);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [step, setStep] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const stopCamera = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    setCountdown(0);
  };

  useEffect(() => stopCamera, []);

  const capture = async (index: number, captured: string[]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setError("La cámara no está lista. Inténtalo de nuevo.");
      stopCamera();
      return;
    }
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("No se pudo capturar el video.");
      stopCamera();
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    const nextFrames = [...captured, dataUrl];
    setFrames(nextFrames);
    if (timerRef.current !== null) window.clearInterval(timerRef.current);

    if (index < LIVE_STEPS.length - 1) {
      setStep(index + 1);
      schedule(index + 1, nextFrames);
      return;
    }

    stopCamera();
    setSaving(true);
    try {
      const check = await verify({ data: { frames: nextFrames } });
      const detail = check.ok ? check.reason : check.message;
      setMessage(detail || "Capturas enviadas para revisión.");
      await onComplete(nextFrames);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la verificación.");
    } finally {
      setSaving(false);
    }
  };

  const schedule = (index: number, captured: string[]) => {
    let remaining = 3;
    setCountdown(remaining);
    timerRef.current = window.setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) void capture(index, captured);
    }, 900);
  };

  const start = async () => {
    setError("");
    setMessage("");
    setFrames([]);
    setStep(0);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Tu navegador no permite acceso a la cámara.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setRunning(true);
      schedule(0, []);
    } catch {
      setError("No pudimos abrir tu cámara. Revisa los permisos e inténtalo de nuevo.");
    }
  };

  return (
    <div className="rounded-2xl border border-sky-400/25 bg-sky-500/[0.06] p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-sky-300" />
        <p className="text-sm font-medium text-white">Verificación facial en vivo · 3 poses</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Usa tu cámara frontal. No se permite subir fotos desde la galería.
      </p>

      <div className="relative mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/40">
        <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
        {running ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/65 p-3 text-center">
            <p className="text-sm font-medium text-white">{LIVE_STEPS[step]?.label}</p>
            <p className="text-xs text-slate-300">{LIVE_STEPS[step]?.hint}</p>
            <p className="mt-1 font-display text-2xl text-pink-300">{countdown}</p>
          </div>
        ) : null}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="mt-3 grid grid-cols-3 gap-2">
        {LIVE_STEPS.map((item, index) => (
          <div
            key={item.label}
            className={`rounded-xl border px-2 py-2 text-center text-[11px] ${
              frames[index] ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-white/10 text-muted-foreground"
            }`}
          >
            {frames[index] ? "Capturada" : item.label}
          </div>
        ))}
      </div>

      {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}
      {message ? <p className="mt-3 text-xs text-sky-200">{message}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void start()} disabled={running || saving} className="gap-2">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          {saving ? "Enviando capturas…" : frames.length === 3 ? "Repetir verificación" : "Iniciar cámara"}
        </Button>
        {running ? (
          <Button variant="glass" onClick={stopCamera} className="gap-2">
            <RotateCcw className="size-4" /> Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
