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
import { MAX_LYRICS_LENGTH, MAX_TITLE_LENGTH } from "@/lib/music";
import type { ActionResult } from "@/lib/music.functions";
import { startVocalForInstrumental } from "@/lib/studio.functions";
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

export function VocalTab({
  signedIn,
  userId,
  requireSignIn,
  onPendingChange,
  onResult,
  refresh,
  disabledReason,
}: Props) {
  const startFn = useServerFn(startVocalForInstrumental);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [language, setLanguage] = useState("es");
  const [country, setCountry] = useState("ES");
  const [stage, setStage] = useState("");

  const mutation = useMutation({
    mutationFn: async (): Promise<ActionResult> => {
      if (!userId) throw new Error("Inicia sesión para continuar.");
      if (!file) throw new Error("Sube el instrumental al que quieres añadir la voz.");
      if (lyrics.trim().length < 3) throw new Error("Escribe la letra que debe cantar la voz.");

      setStage("Subiendo el instrumental…");
      onPendingChange(true, "Subiendo el instrumental…");
      const sourcePath = await uploadOwnFile(userId, file, file.name, "instrumentals");

      setStage("Añadiendo la voz…");
      onPendingChange(true, "Añadiendo la voz…");
      return startFn({
        data: {
          title: title.trim(),
          lyrics: lyrics.trim(),
          language: language.trim() || "es",
          country: country.trim() || "ES",
          sourcePath,
        },
      });
    },
    onSettled: () => {
      setStage("");
      onPendingChange(false, "");
    },
    onSuccess: (result) => {
      onResult(result, result.ok ? "¡Voz añadida a tu instrumental!" : "");
      refresh();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo añadir la voz."),
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
        Sube tu beat, escribe la letra y añade una voz original sobre la música.
      </p>

      <div className="space-y-1">
        <Label htmlFor="vocal-title">Título</Label>
        <Input
          id="vocal-title"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Voz sobre instrumental"
          className="rounded-xl border-border bg-surface/80"
        />
      </div>

      <div className="space-y-2">
        <Label>Instrumental (beat)</Label>
        <FilePicker accept="audio/*" file={file} onChange={setFile} label="Sube tu instrumental" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="vocal-lyrics">Letra</Label>
        <Textarea
          id="vocal-lyrics"
          value={lyrics}
          maxLength={MAX_LYRICS_LENGTH}
          onChange={(event) => setLyrics(event.target.value)}
          placeholder={"[Verso 1]\nEscribe aquí tu letra…\n\n[Coro]\n…"}
          className="min-h-36 resize-y rounded-xl border-border bg-surface/80 p-4 font-mono text-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="vocal-language">Idioma</Label>
          <Input
            id="vocal-language"
            value={language}
            maxLength={20}
            onChange={(event) => setLanguage(event.target.value)}
            className="rounded-xl border-border bg-surface/80"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="vocal-country">País</Label>
          <Input
            id="vocal-country"
            value={country}
            maxLength={20}
            onChange={(event) => setCountry(event.target.value)}
            className="rounded-xl border-border bg-surface/80"
          />
        </div>
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
          signedIn &&
          (!file || lyrics.trim().length < 3 || mutation.isPending || Boolean(disabledReason))
        }
        onClick={start}
      >
        {mutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
        {mutation.isPending
          ? "Añadiendo voz…"
          : signedIn
            ? `Agregar Voz · ${CREDIT_COSTS.song} crédito`
            : "Inicia sesión para continuar"}
      </Button>
    </div>
  );
}
