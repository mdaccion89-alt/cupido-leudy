import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, PenLine, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { CREDIT_COSTS } from "@/lib/credits";
import {
  BPM_MAX,
  BPM_MIN,
  DURATIONS,
  GENRES,
  GENRE_DEFAULT_BPM,
  INSTRUMENTAL,
  MAX_LYRICS_LENGTH,
  MAX_PROMPT_LENGTH,
  VOICE_TYPES,
  findBlockedArtist,
  type DurationSeconds,
  type Genre,
  type StudioMode,
  type VoiceType,
} from "@/lib/music";
import { generateSong, writeLyrics, type ActionResult } from "@/lib/music.functions";
import { OptionGroup } from "./option-group";
import type { StudioTabProps } from "./types";

export function SongTab({
  signedIn,
  requireSignIn,
  onPendingChange,
  onResult,
  disabledReason,
  isAdmin,
}: StudioTabProps) {
  const generate = useServerFn(generateSong);
  const lyricsFn = useServerFn(writeLyrics);
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [genre, setGenre] = useState<Genre>("Reguetón");
  const [voice, setVoice] = useState<VoiceType>("Masculina");
  const [bpm, setBpm] = useState(GENRE_DEFAULT_BPM["Reguetón"]);
  const [duration, setDuration] = useState<DurationSeconds>(60);
  const [mode, setMode] = useState<StudioMode>("standard");
  const [advanced, setAdvanced] = useState({ key: "", mood: "", instruments: "", extra: "" });

  const lyricsMutation = useMutation({
    mutationFn: () => lyricsFn({ data: { idea: prompt, genre, voice } }),
    onSuccess: (r) => {
      if (r.ok) {
        setLyrics(r.lyrics);
        toast.success("Letra lista. Puedes editarla antes de generar.");
      } else toast.error(r.message);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo escribir la letra."),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const blocked = findBlockedArtist(`${prompt}\n${lyrics}`);
      if (blocked)
        throw new Error(
          `No podemos imitar ni nombrar a artistas reales como ${blocked}. Usa una descripción original.`,
        );
      onPendingChange(true, "Componiendo tu canción…");
      return generate({
        data: {
          prompt,
          lyrics,
          genre,
          voice,
          bpm,
          duration,
          ...(isAdmin ? { mode } : {}),
          ...(mode === "admin_pro" ? { advanced } : {}),
        },
      });
    },
    onSettled: () => onPendingChange(false, ""),
    onSuccess: (r: ActionResult) => onResult(r, "¡Tu canción está lista!"),
    onError: (e) =>
      onResult(
        { ok: false, status: 400, message: e instanceof Error ? e.message : "No se pudo generar." },
        "",
      ),
  });

  const canGenerate =
    (prompt.trim().length >= 3 || lyrics.trim().length >= 3) &&
    !mutation.isPending &&
    !disabledReason;

  return (
    <div className="space-y-7">
      <div>
        <label htmlFor="song-prompt" className="mb-3 block font-display text-sm">
          Describe tu canción
        </label>
        <Textarea
          id="song-prompt"
          value={prompt}
          maxLength={MAX_PROMPT_LENGTH}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ej.: Una canción alegre sobre un amor de verano en Santo Domingo, con coro pegajoso…"
          className="min-h-24 resize-none rounded-xl border-border bg-surface/80 p-4 text-base placeholder:text-muted-foreground/70"
        />
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="song-lyrics" className="font-display text-sm">
            Letra <span className="font-sans text-xs text-muted-foreground">(opcional)</span>
          </label>
          <Button
            type="button"
            variant="glass"
            size="sm"
            disabled={
              lyricsMutation.isPending || prompt.trim().length < 3 || voice === INSTRUMENTAL
            }
            onClick={() => (signedIn ? lyricsMutation.mutate() : requireSignIn())}
          >
            {lyricsMutation.isPending ? <Loader2 className="animate-spin" /> : <PenLine />}
            Escribir letra profesional con IA
          </Button>
        </div>
        <Textarea
          id="song-lyrics"
          value={lyrics}
          maxLength={MAX_LYRICS_LENGTH}
          onChange={(e) => setLyrics(e.target.value)}
          disabled={voice === INSTRUMENTAL}
          placeholder={"[Verso 1]\nEscribe aquí tu letra…\n\n[Coro]\n…"}
          className="min-h-36 resize-y rounded-xl border-border bg-surface/80 p-4 font-mono text-sm placeholder:text-muted-foreground/60"
        />
      </div>

      <OptionGroup
        label="Género musical"
        options={GENRES.map((g) => ({ value: g, label: g }))}
        value={genre}
        onChange={(g) => {
          setGenre(g);
          setBpm(GENRE_DEFAULT_BPM[g]);
        }}
      />

      <OptionGroup
        label="Tipo de voz"
        options={VOICE_TYPES.map((v) => ({ value: v, label: v }))}
        value={voice}
        onChange={setVoice}
      />

      <div className="grid gap-7 sm:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-display text-sm">BPM</span>
            <span className="rounded-full bg-primary/15 px-3 py-0.5 text-sm tabular-nums text-primary">
              {bpm}
            </span>
          </div>
          <Slider
            aria-label="BPM"
            min={BPM_MIN}
            max={BPM_MAX}
            step={1}
            value={[bpm]}
            onValueChange={([v]) => setBpm(v ?? bpm)}
            className="py-3"
          />
        </div>
        <OptionGroup
          label="Duración"
          variant="segmented"
          options={DURATIONS.map((d) => ({ value: d.seconds, label: d.label }))}
          value={duration}
          onChange={(v) => setDuration(v as DurationSeconds)}
        />
      </div>

      {isAdmin && (
        <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <OptionGroup
            label="Modo de estudio (Admin Supremo)"
            options={[
              { value: "standard", label: "Estándar" },
              { value: "user_pro", label: "Pro usuario" },
              { value: "admin_pro", label: "Pro Admin" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as StudioMode)}
          />
          {mode === "admin_pro" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Tonalidad</Label>
                <Input
                  value={advanced.key}
                  onChange={(e) => setAdvanced({ ...advanced, key: e.target.value })}
                  placeholder="Ej.: D menor"
                />
              </div>
              <div className="space-y-1">
                <Label>Estado de ánimo</Label>
                <Input
                  value={advanced.mood}
                  onChange={(e) => setAdvanced({ ...advanced, mood: e.target.value })}
                  placeholder="Ej.: nostálgico"
                />
              </div>
              <div className="space-y-1">
                <Label>Instrumentos destacados</Label>
                <Input
                  value={advanced.instruments}
                  onChange={(e) => setAdvanced({ ...advanced, instruments: e.target.value })}
                  placeholder="Ej.: piano, requinto"
                />
              </div>
              <div className="space-y-1">
                <Label>Notas del productor</Label>
                <Input
                  value={advanced.extra}
                  onChange={(e) => setAdvanced({ ...advanced, extra: e.target.value })}
                  placeholder="Ej.: final con coro"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {disabledReason && <p className="text-sm text-destructive">{disabledReason}</p>}

      <Button
        variant="hero"
        size="xl"
        className="w-full whitespace-normal px-6"
        disabled={signedIn && !canGenerate}
        onClick={() => (signedIn ? mutation.mutate() : requireSignIn())}
      >
        {mutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
        {mutation.isPending
          ? "Generando…"
          : signedIn
            ? `Generar Canción · ${CREDIT_COSTS.song} crédito`
            : "Inicia sesión para generar"}
      </Button>
    </div>
  );
}
