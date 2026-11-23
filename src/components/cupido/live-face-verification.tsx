import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Check, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyCupidoFaceSequence, verifyCupidoLiveFace } from "@/lib/cupido.functions";
import { mediaPermissionMessage, requestNativeMediaPermissions } from "@/lib/native-media-permissions";

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
        <video ref={videoRef} muted playsInline webkit-playsinline="true" className="aspect-video w-full object-cover" />
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

const VIDEO_STEPS = [
  "Coloca tu cara dentro del óvalo",
  "Mira hacia la izquierda",
  "Mira hacia la derecha",
] as const;

export function FaceVideoVerification({ onComplete }: { onComplete: (video: Blob) => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [step, setStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const stopStream = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => stopStream, []);

  const startRecording = async () => {
    setError("");
    setStep(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este dispositivo no permite grabar video desde la cámara.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const mimeType = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const clip = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        stopStream();
        setRecording(false);
        if (!clip.size) {
          setError("No se pudo grabar el video. Inténtalo de nuevo.");
          return;
        }
        setUploading(true);
        void onComplete(clip)
          .catch((uploadError: unknown) => setError(uploadError instanceof Error ? uploadError.message : "No se pudo enviar el video."))
          .finally(() => setUploading(false));
      };
      recorder.start(250);
      setRecording(true);
      let currentStep = 0;
      timerRef.current = window.setInterval(() => {
        currentStep += 1;
        if (currentStep >= VIDEO_STEPS.length) {
          if (timerRef.current !== null) window.clearInterval(timerRef.current);
          timerRef.current = null;
          recorder.stop();
          return;
        }
        setStep(currentStep);
      }, 3500);
    } catch {
      stopStream();
      setError("No pudimos abrir la cámara frontal. Revisa los permisos e inténtalo de nuevo.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} muted playsInline webkit-playsinline="true" className="size-full object-cover" />
        <svg aria-hidden="true" viewBox="0 0 640 640" className="absolute inset-0 size-full">
          <path d="M0 0h640v640H0z M320 72c-91 0-139 67-139 169 0 116 57 233 139 233s139-117 139-233c0-102-48-169-139-169z" fillRule="evenodd" fill="rgba(0,0,0,.48)" />
          <path d="M320 72c-91 0-139 67-139 169 0 116 57 233 139 233s139-117 139-233c0-102-48-169-139-169z" fill="none" stroke="#7dd3fc" strokeWidth="6" />
        </svg>
        <p className="absolute inset-x-3 bottom-4 rounded-xl bg-black/75 px-3 py-2 text-center text-sm font-semibold text-white">
          {VIDEO_STEPS[step]}
        </p>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {recording ? `Grabando paso ${step + 1} de 3…` : "Video corto real: rostro al frente, giro a la izquierda y giro a la derecha."}
      </p>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <Button type="button" onClick={() => void startRecording()} disabled={recording || uploading} className="w-full gap-2">
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        {uploading ? "Enviando video al Administrador Oficial…" : recording ? "Grabando verificación…" : "Grabar video y habilitar insignia"}
      </Button>
    </div>
  );
}

export function FaceSelfieVerification({ onComplete }: { onComplete: (selfie: Blob) => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const stopCamera = (updateState = true) => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (updateState) setCameraReady(false);
  };

  useEffect(() => () => stopCamera(false), []);

  const openCamera = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo no permite abrir la cámara.");
      return;
    }
    try {
      await requestNativeMediaPermissions({ camera: true, microphone: false });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (cause) {
      stopCamera();
      setError(mediaPermissionMessage(cause) ?? "No pudimos abrir la cámara frontal. Revisa los permisos e inténtalo otra vez.");
    }
  };

  const takeSelfie = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setError("Espera a que la cámara muestre tu rostro.");
      return;
    }
    setError("");
    setSending(true);
    canvas.width = Math.min(video.videoWidth, 900);
    canvas.height = Math.round(video.videoHeight * (canvas.width / video.videoWidth));
    const context = canvas.getContext("2d");
    if (!context) { setSending(false); setError("No se pudo preparar la selfie."); return; }
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const selfie = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!selfie) { setSending(false); setError("No se pudo tomar la selfie. Inténtalo otra vez."); return; }
    stopCamera();
    try {
      await onComplete(selfie);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la selfie.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-black">
        <video ref={videoRef} muted playsInline webkit-playsinline="true" className="size-full scale-x-[-1] object-cover" />
        {!cameraReady && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-zinc-400">Toma una selfie actual con la cámara frontal y buena iluminación.</div>}
        {cameraReady && <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-xl bg-black/70 px-3 py-2 text-center text-xs text-white">Centra tu rostro y mira a la cámara.</div>}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!cameraReady ? (
        <Button type="button" onClick={() => void openCamera()} disabled={sending} className="w-full gap-2"><Camera className="size-4" /> Abrir cámara frontal</Button>
      ) : (
        <Button type="button" onClick={() => void takeSelfie()} disabled={sending} className="w-full gap-2"><Check className="size-4" /> {sending ? "Enviando selfie…" : "Tomar selfie y solicitar revisión"}</Button>
      )}
      <p className="text-center text-xs text-muted-foreground">La selfie se guarda de forma privada para que el equipo de administración revise la solicitud.</p>
    </div>
  );
}
