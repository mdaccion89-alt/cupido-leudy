import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Check, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyCupidoFaceSequence, verifyCupidoLiveFace } from "@/lib/cupido.functions";

const VALIDATION_ERROR = "Se presentó un error en la validación facial. Inténtalo otra vez siguiendo la instrucción en pantalla";
const LIVE_STEPS = [
  { pose: "front", label: "Mira de frente a la cámara sin moverte", hint: "Centra el rostro, mantén los ojos abiertos y busca buena iluminación." },
  { pose: "right", label: "Gira tu rostro hacia la derecha", hint: "Gira lentamente hacia tu hombro derecho y mantén la pose." },
  { pose: "left", label: "Gira tu rostro hacia la izquierda", hint: "Gira lentamente hacia tu hombro izquierdo y mantén la pose." },
] as const;

type LiveFaceVerificationProps = { onComplete: (frames: string[]) => Promise<void> };

export function LiveFaceVerification({ onComplete }: LiveFaceVerificationProps) {
  const verify = useServerFn(verifyCupidoLiveFace);
  const verifySequence = useServerFn(verifyCupidoFaceSequence);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [step, setStep] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [capturing, setCapturing] = useState(false);
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
    setCapturing(false);
    setCountdown(0);
  };

  useEffect(() => stopCamera, []);

  const validatePose = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const instruction = LIVE_STEPS[step];
    if (!video || !canvas || !video.videoWidth || !instruction) {
      setError(VALIDATION_ERROR);
      setCapturing(false);
      return;
    }

    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    if (!context) {
      setError(VALIDATION_ERROR);
      setCapturing(false);
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL("image/jpeg", 0.72);
    try {
      const check = await verify({ data: { frame, pose: instruction.pose } });
      if (!check.ok || !check.passed) {
        setError(VALIDATION_ERROR);
        setMessage("");
        setCapturing(false);
        return;
      }
      const nextFrames = [...frames.slice(0, step), frame];
      setFrames(nextFrames);
      setError("");
      if (step < LIVE_STEPS.length - 1) {
        setStep(step + 1);
        setMessage("Pose validada. Sigue la siguiente instrucción.");
        setCapturing(false);
        return;
      }
      const sequenceCheck = await verifySequence({ data: { frames: nextFrames } });
      if (!sequenceCheck.ok || !sequenceCheck.passed) {
        setFrames([]);
        setStep(0);
        setError(VALIDATION_ERROR);
        setMessage("");
        setCapturing(false);
        return;
      }
      stopCamera();
      setSaving(true);
      setMessage("Las tres poses pasaron la validación. Enviando al Panel Admin...");
      await onComplete(nextFrames);
    } catch {
      setError(VALIDATION_ERROR);
      setMessage("");
    } finally {
      setSaving(false);
      setCapturing(false);
    }
  };

  const capture = () => {
    if (!running || capturing || saving) return;
    setError("");
    setMessage("");
    setCapturing(true);
    let remaining = 3;
    setCountdown(remaining);
    timerRef.current = window.setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        void validatePose();
      }
    }, 1000);
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
    } catch {
      setError("No pudimos abrir tu cámara. Revisa los permisos e inténtalo de nuevo.");
    }
  };

  return (
    <div className="rounded-2xl border border-sky-400/25 bg-sky-500/[0.06] p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-sky-300" />
        <p className="text-sm font-medium text-white">Verificación facial guiada · Escudo Cupido</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Cada paso se valida con Gemini antes de continuar. Las tres poses aprobadas se envían juntas al Panel Admin.</p>

      <div className="relative mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/40">
        <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
        {running && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 p-3 text-center">
            <p className="text-sm font-medium text-white">Paso {step + 1} de 3 · {LIVE_STEPS[step]?.label}</p>
            <p className="text-xs text-slate-200">{LIVE_STEPS[step]?.hint}</p>
            {countdown > 0 && <p className="mt-1 font-display text-2xl text-pink-300">{countdown}</p>}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="mt-3 grid grid-cols-3 gap-2">
        {LIVE_STEPS.map((item, index) => (
          <div key={item.pose} className={`rounded-xl border px-2 py-2 text-center text-[11px] ${frames[index] ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : index === step ? "border-sky-300/40 bg-sky-400/10 text-sky-100" : "border-white/10 text-muted-foreground"}`}>
            {frames[index] ? <><Check className="mr-1 inline size-3.5" />Validada</> : `Paso ${index + 1}`}
          </div>
        ))}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {message && <p className="mt-3 text-xs text-sky-200">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {!running ? (
          <Button onClick={() => void start()} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {saving ? "Enviando verificación..." : frames.length === 3 ? "Repetir verificación" : "Iniciar cámara"}
          </Button>
        ) : (
          <>
            <Button onClick={capture} disabled={capturing || saving} className="gap-2">
              {capturing ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              {capturing ? "Validando pose..." : "Capturar y validar paso " + (step + 1)}
            </Button>
            <Button variant="glass" onClick={stopCamera} disabled={capturing} className="gap-2">
              <RotateCcw className="size-4" /> Cancelar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
