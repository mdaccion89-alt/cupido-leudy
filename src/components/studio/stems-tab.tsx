import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, Loader2, Scissors } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CREDIT_COSTS } from "@/lib/credits";
import { MAX_TITLE_LENGTH } from "@/lib/music";
import type { ActionResult } from "@/lib/music.functions";
import { getStemManifest, startStemSeparation } from "@/lib/studio.functions";
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

type Stem = { name: string; url: string };

export function StemsTab({
  signedIn,
  userId,
  requireSignIn,
  onPendingChange,
  onResult,
  refresh,
  disabledReason,
}: Props) {
  const startFn = useServerFn(startStemSeparation);
  const manifestFn = useServerFn(getStemManifest);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("");
  const [stems, setStems] = useState<Stem[]>([]);

  const mutation = useMutation({
    mutationFn: async (): Promise<ActionResult> => {
      if (!userId) throw new Error("Inicia sesión para continuar.");
      if (!file) throw new Error("Sube la canción que quieres separar.");

      setStage("Subiendo la canción…");
      onPendingChange(true, "Subiendo la canción…");
      const sourcePath = await uploadOwnFile(userId, file, file.name, "stems");

      setStage("Separando los stems…");
      onPendingChange(true, "Separando los stems…");
      const result = await startFn({ data: { title: title.trim(), sourcePath } });
      if (!result.ok) return result;

      const manifest = await manifestFn({ data: { songId: result.songId } });
      if (manifest.ok) setStems(manifest.stems);
      else toast.error(manifest.message);
      return result;
    },
    onSettled: () => {
      setStage("");
      onPendingChange(false, "");
    },
    onSuccess: (result) => {
      onResult(result, result.ok ? "¡Stems separados y listos para descargar!" : "");
      refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo separar la canción."),
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
    setStems([]);
    mutation.mutate();
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Separa tu canción en voz, batería, bajo, otros, guitarra y piano.
      </p>

      <div className="space-y-1">
        <Label htmlFor="stems-title">Título</Label>
        <Input
          id="stems-title"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Stems de mi canción"
          className="rounded-xl border-border bg-surface/80"
        />
      </div>

      <div className="space-y-2">
        <Label>Canción</Label>
        <FilePicker accept="audio/*" file={file} onChange={setFile} label="Sube la canción" />
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
        disabled={signedIn && (!file || mutation.isPending || Boolean(disabledReason))}
        onClick={start}
      >
        {mutation.isPending ? <Loader2 className="animate-spin" /> : <Scissors />}
        {mutation.isPending
          ? "Separando…"
          : signedIn
            ? `Separar Stems · ${CREDIT_COSTS.song} crédito`
            : "Inicia sesión para continuar"}
      </Button>

      {stems.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-surface/60 p-4">
          <p className="font-display text-sm">Stems listos</p>
          <div className="flex flex-wrap gap-2">
            {stems.map((stem) => (
              <Button key={stem.name} asChild variant="glass" size="sm">
                <a href={stem.url} download={`${stem.name}.mp3`}>
                  <Download /> {stem.name}
                </a>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
