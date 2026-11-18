import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CREDIT_COSTS } from "@/lib/credits";
import { MAX_PROMPT_LENGTH, MAX_TITLE_LENGTH } from "@/lib/music";
import type { ActionResult } from "@/lib/music.functions";
import { startInstrumentalForVocal } from "@/lib/studio.functions";
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

export function InstrumentalTab({
  signedIn,
  userId,
  requireSignIn,
  onPendingChange,
  onResult,
  refresh,
  disabledReason,
}: Props) {
  const startFn = useServerFn(startInstrumentalForVocal);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState("");

  const mutation = useMutation({
    mutationFn: async (): Promise<ActionResult> => {
      if (!userId) throw new Error("Inicia sesión para continuar.");
      if (!file) throw new Error("Sube la voz a la que quieres añadir el instrumental.");
      if (!prompt.trim()) throw new Error("Describe el estilo del instrumental.");

      setStage("Subiendo la voz…");
      onPendingChange(true, "Subiendo la voz…");
      const sourcePath = await uploadOwnFile(userId, file, file.name, "vocals");

      setStage("Creando el instrumental…");
      onPendingChange(true, "Creando el instrumental…");
      return startFn({
        data: { title: title.trim(), prompt: prompt.trim(), sourcePath },
      });
    },
    onSettled: () => {
      setStage("");
      onPendingChange(false, "");
    },
    onSuccess: (result) => {
      onResult(result, result.ok ? "¡Instrumental añadido a tu voz!" : "");
      refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo añadir el instrumental."),
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
        Sube una grabación de tu voz y describimos la música que debe acompañarla.
      </p>

      <div className="space-y-1">
        <Label htmlFor="instrumental-title">Título</Label>
        <Input
          id="instrumental-title"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Instrumental para voz"
          className="rounded-xl border-border bg-surface/80"
        />
      </div>

      <div className="space-y-2">
        <Label>Voz (acapella)</Label>
        <FilePicker accept="audio/*" file={file} onChange={setFile} label="Sube tu voz" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="instrumental-prompt">Estilo del instrumental</Label>
        <Textarea
          id="instrumental-prompt"
          value={prompt}
          maxLength={MAX_PROMPT_LENGTH}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ej.: bachata suave con guitarra, bongó y un groove romántico…"
          className="min-h-24 resize-none rounded-xl border-border bg-surface/80 p-4"
        />
      </div>

      {!signedIn && (
        <p className="text-sm text-muted-foreground">Inicia sesión para usar esta herramienta.</p>
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
        disabled={
          signedIn && (!file || !prompt.trim() || mutation.isPending || Boolean(disabledReason))
        }
        onClick={start}
      >
        {mutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
        {mutation.isPending
          ? "Añadiendo instrumental…"
          : signedIn
            ? `Agregar Instrumental · ${CREDIT_COSTS.song} crédito`
            : "Inicia sesión para continuar"}
      </Button>
    </div>
  );
}
