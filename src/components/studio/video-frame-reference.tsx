import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Image as ImageIcon, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { captureVideoFrame } from "@/lib/firefly.functions";
import { uploadOwnFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { captureFrameFromVideoUrl, uploadCapturedFrame } from "./video-frame-capture";

export type VideoReferenceClip = { songId: string; url: string; label: string };

export function VideoFrameReference({
  userId,
  referencePath,
  onReferenceChange,
  clips,
  disabled = false,
}: {
  userId: string | null;
  referencePath: string | null;
  onReferenceChange: (path: string | null, previewUrl: string | null) => void;
  clips: VideoReferenceClip[];
  disabled?: boolean;
}) {
  const captureFn = useServerFn(captureVideoFrame);
  const [mode, setMode] = useState<"upload" | "capture">("upload");
  const [selectedClip, setSelectedClip] = useState("");
  const [seconds, setSeconds] = useState("0");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const applyPreview = (path: string, blob: Blob) => {
    if (preview) URL.revokeObjectURL(preview);
    const next = URL.createObjectURL(blob);
    setPreview(next);
    onReferenceChange(path, next);
  };

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    if (!userId) {
      toast.error("Inicia sesión para guardar la referencia.");
      return;
    }
    setBusy(true);
    try {
      const path = await uploadOwnFile(userId, file, file.name, "references");
      applyPreview(path, file);
      toast.success("Imagen de referencia guardada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo subir la imagen.");
    } finally {
      setBusy(false);
    }
  };

  const captureFromClip = async () => {
    if (!userId) {
      toast.error("Inicia sesión para guardar el fotograma.");
      return;
    }
    const clip = clips.find((item) => item.songId === selectedClip);
    if (!clip) {
      toast.error("Selecciona un video generado.");
      return;
    }
    setBusy(true);
    try {
      const result = await captureFn({
        data: { videoSongId: clip.songId, seconds: Number(seconds) || 0 },
      });
      if (!result.ok) throw new Error(result.message);
      const captured = await captureFrameFromVideoUrl(result.videoUrl, result.seconds);
      const path = await uploadCapturedFrame(userId, captured.blob, captured.seconds);
      applyPreview(path, captured.blob);
      toast.success(`Fotograma capturado en ${captured.seconds.toFixed(1)} s.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo capturar el fotograma.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-display text-sm">Imagen de referencia</span>
          <p className="mt-1 text-xs text-muted-foreground">
            Sube una guía desde tu dispositivo o captura un fotograma real de un video generado.
          </p>
        </div>
        {referencePath && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              if (preview) URL.revokeObjectURL(preview);
              setPreview(null);
              onReferenceChange(null, null);
            }}
          >
            <X /> Quitar
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="chip"
          size="pill"
          data-active={mode === "upload"}
          disabled={disabled}
          onClick={() => setMode("upload")}
        >
          <ImageIcon /> Subir imagen
        </Button>
        <Button
          type="button"
          variant="chip"
          size="pill"
          data-active={mode === "capture"}
          disabled={disabled || clips.length === 0}
          onClick={() => setMode("capture")}
        >
          <Scissors /> Desde video
        </Button>
      </div>

      {mode === "upload" ? (
        <label
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-surface/70 p-3 text-sm",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          <Camera className="size-5 text-primary" />
          <span>{busy ? "Subiendo…" : "Elegir imagen de referencia"}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={disabled}
            onChange={(event) => {
              void uploadImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Video generado</Label>
            <Select value={selectedClip} onValueChange={setSelectedClip} disabled={disabled}>
              <SelectTrigger className="rounded-xl border-border bg-surface/80">
                <SelectValue placeholder="Elige un clip" />
              </SelectTrigger>
              <SelectContent>
                {clips.map((clip) => (
                  <SelectItem key={clip.songId} value={clip.songId}>
                    {clip.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="video-frame-seconds">Segundo del fotograma</Label>
            <Input
              id="video-frame-seconds"
              type="number"
              min={0}
              max={60}
              step={0.1}
              value={seconds}
              className="w-32 rounded-lg bg-surface/80 tabular-nums"
              disabled={disabled}
              onChange={(event) => setSeconds(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="glass"
            onClick={() => void captureFromClip()}
            disabled={disabled || busy || !selectedClip}
          >
            <Scissors /> {busy ? "Capturando…" : "Capturar frame"}
          </Button>
        </div>
      )}

      {preview && (
        <img
          src={preview}
          alt="Referencia seleccionada"
          className="w-full rounded-xl border border-border object-contain"
        />
      )}
    </div>
  );
}
