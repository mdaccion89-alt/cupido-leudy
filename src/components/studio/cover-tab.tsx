import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CREDIT_COSTS } from "@/lib/credits";
import { MAX_TITLE_LENGTH } from "@/lib/music";
import type { ActionResult } from "@/lib/music.functions";
import { checkJob, startCover } from "@/lib/studio.functions";
import { uploadOwnFile } from "@/lib/uploads";
import { FilePicker } from "./file-picker";

type Props = {
  signedIn: boolean;
  userId: string | null;
  requireSignIn: () => void;
  onPendingChange: (pending: boolean, label: string) => void;
  onResult: (result: ActionResult, successMessage: string) => void;
  refresh: () => void;
  disabledReason?: string;
};

export function CoverTab({
  signedIn,
  userId,
  requireSignIn,
  onPendingChange,
  onResult,
  refresh,
  disabledReason,
}: Props) {
  const startCoverFn = useServerFn(startCover);
  const checkJobFn = useServerFn(checkJob);
  const [file, setFile] = useState<File | null>(null);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("");

  const mutation = useMutation({
    mutationFn: async (): Promise<ActionResult> => {
      if (!userId) throw new Error("Inicia sesión para continuar.");
      if (!file) throw new Error("Sube el audio de la canción base.");

      setStage("Subiendo el audio…");
      onPendingChange(true, "Subiendo el audio…");
      const sourcePath = await uploadOwnFile(userId, file, file.name, "covers");
      const voicePath = voiceFile
        ? await uploadOwnFile(userId, voiceFile, voiceFile.name, "voices")
        : undefined;

      setStage("Iniciando el cover…");
      onPendingChange(true, "Iniciando el cover…");
      const started = await startCoverFn({
        data: { title: title.trim(), sourcePath, ...(voicePath ? { voicePath } : {}) },
      });
      if (!started.ok) return started;
      refresh();

      setStage("Procesando el cover…");
      onPendingChange(true, "Procesando el cover…");
      for (let attempt = 0; attempt < 200; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const state = await checkJobFn({ data: { songId: started.songId } });
        if (state.status === "ready") return { ok: true, songId: started.songId };
        if (state.status === "failed" || state.status === "missing")
          return {
            ok: false,
            status: 500,
            message: state.error ?? "No se pudo completar el cover.",
          };
      }
      return {
        ok: false,
        status: 504,
        message: "El cover está tardando demasiado. Revisa Mis Creaciones en unos minutos.",
      };
    },
    onSettled: () => {
      setStage("");
      onPendingChange(false, "");
    },
    onSuccess: (result) => {
      onResult(result, result.ok ? "¡Tu cover está listo!" : "");
      refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo crear el cover."),
  });

  const start = () => {
    if (!signedIn) {
      requireSignIn();
      return;
    }
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Sube una canción y crea una versión con la voz de referencia que elijas.
      </p>

      <div className="space-y-1">
        <Label htmlFor="cover-title">Título</Label>
        <Input
          id="cover-title"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Cover IA"
          className="rounded-xl border-border bg-surface/80"
        />
      </div>

      <div className="space-y-2">
        <Label>Canción base</Label>
        <FilePicker
          accept="audio/*"
          file={file}
          onChange={setFile}
          label="Sube el audio original"
        />
      </div>

      <div className="space-y-2">
        <Label>Voz de referencia (opcional)</Label>
        <FilePicker
          accept="audio/*"
          file={voiceFile}
          onChange={setVoiceFile}
          label="Sube una muestra de voz"
        />
      </div>

      {!signedIn && (
        <p className="text-sm text-muted-foreground">
          Inicia sesión para subir audio y guardar tus covers.
        </p>
      )}
      {disabledReason && <p className="text-sm text-destructive">{disabledReason}</p>}
      {stage && (
        <p className="flex items-center gap-2 text-sm text-primary">
          <Loader2 className="size-4 animate-spin" /> {stage}
        </p>
      )}

      <Button
        variant="hero"
        size="xl"
        className="w-full whitespace-normal px-6"
        disabled={signedIn && (!file || mutation.isPending || Boolean(disabledReason))}
        onClick={start}
      >
        {mutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
        {mutation.isPending
          ? "Creando cover…"
          : signedIn
            ? `Crear Cover · ${CREDIT_COSTS.cover} créditos`
            : "Inicia sesión para crear covers"}
      </Button>

      {mutation.isSuccess && mutation.data.ok && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Download className="size-4" /> Escucha y descarga el resultado en Mis Creaciones.
        </p>
      )}
    </div>
  );
}
