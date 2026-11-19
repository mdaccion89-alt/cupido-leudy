import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2, PenLine, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CREDIT_COSTS } from "@/lib/credits";
import {
  BPM_MAX,
  BPM_MIN,
  DURATIONS,
  ENGINES,
  GENRES,
  INSTRUMENTAL,
  MAX_GENRE_LENGTH,
  MAX_LYRICS_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  VOICE_TYPES,
  bpmForGenre,
  findBlockedArtist,
  type CreationMode,
  type DurationSeconds,
  type EngineId,
  type StudioMode,
  type VoiceType,
} from "@/lib/music";
import { generateSong, improvePrompt, writeLyrics } from "@/lib/music.functions";
import { OptionGroup } from "./option-group";
import type { StudioTabProps } from "./types";

const QUICK_STYLES = [
  "Dembow",
  "Bachata",
  "Reguetón",
  "Trap",
  "Salsa",
  "Merengue",
  "Pop",
  "Rock",
  "Hip Hop",
  "Dance Pop",
  "Synth-pop",
  "Cyberpunk",
  "Afrobeat",
  "Drill",
  "R&B",
  "Corridos",
  "Electrónica",
  "Lo-Fi",
  "Jazz",
  "Gospel",
  "Balada",
  "K-Pop",
  "House",
] as const;

function cleanStyle(value: string): string {
  return value
    .replace(/[<>{}`$\\|^~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

type SongPreview = {
  songId: string;
  title: string;
  url: string;
  lyrics: string;
  chords: string;
  structure: string;
};

export function SongTab({
  signedIn,
  requireSignIn,
  onPendingChange,
  onResult,
  disabledReason,
  isAdmin,
}: StudioTabProps) {
  const lyricsFn = useServerFn(writeLyrics);
  const improveFn = useServerFn(improvePrompt);
  const generateFn = useServerFn(generateSong);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [styles, setStyles] = useState<string[]>(["Reguetón"]);
  const [styleSearch, setStyleSearch] = useState("");
  const [stylesOpen, setStylesOpen] = useState(false);
  const [engine, setEngine] = useState<EngineId>("musicgen-free");
  const [creationMode, setCreationMode] = useState<CreationMode>("simple");
  const [voice, setVoice] = useState<VoiceType>("Masculina");
  const [instrumental, setInstrumental] = useState(false);
  const [bpm, setBpm] = useState(bpmForGenre("Reguetón"));
  const [duration, setDuration] = useState<DurationSeconds>(60);
  const [mode, setMode] = useState<StudioMode>("standard");
  const [advanced, setAdvanced] = useState({ key: "", mood: "", instruments: "", extra: "" });
  const [preview, setPreview] = useState<SongPreview | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const genre = styles.join(", ").slice(0, MAX_GENRE_LENGTH) || "Reguetón";
  const effectiveVoice: VoiceType = instrumental ? INSTRUMENTAL : voice;
  const styleText = styles.join(", ");

  const setStyleList = (next: string[]) => {
    const unique = [...new Set(next.map(cleanStyle).filter(Boolean))].slice(0, 100);
    setStyles(unique);
    const first = unique[0];
    if (first) setBpm(bpmForGenre(first));
  };

  const toggleStyle = (style: string) => {
    const clean = cleanStyle(style);
    if (!clean) return;
    setStyleList(styles.includes(clean) ? styles.filter((s) => s !== clean) : [...styles, clean]);
  };

  const improveMutation = useMutation({
    mutationFn: () => improveFn({ data: { prompt, genre, voice: effectiveVoice } }),
    onSuccess: (r) => {
      if (r.ok) {
        setPrompt(r.prompt);
        toast.success("Prompt mejorado con IA.");
      } else toast.error(r.message);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo mejorar el prompt."),
  });

  const lyricsMutation = useMutation({
    mutationFn: () => lyricsFn({ data: { idea: prompt, genre, voice: effectiveVoice } }),
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
      const blocked = findBlockedArtist(`${title}\n${prompt}\n${lyrics}`);
      if (blocked)
        throw new Error(
          `No podemos imitar ni nombrar a artistas reales como ${blocked}. Usa una descripción original.`,
        );
      onPendingChange(true, "Componiendo tu canción con MusicGen…");
      const result = await generateFn({
        data: {
          prompt,
          lyrics,
          title,
          genre,
          voice: effectiveVoice,
          bpm,
          duration,
          engine,
          creationMode,
          ...(isAdmin ? { mode } : {}),
          ...(creationMode === "custom" ? { advanced } : {}),
        },
      });
      if (!result.ok) throw new Error(result.message);
      if (!result.audioBase64) throw new Error("El motor de música no devolvió audio.");
      const mediaType = result.mediaType || "video/mp4";
      const response = await fetch(`data:${mediaType};base64,${result.audioBase64}`);
      const blob = await response.blob();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      const songTitle = result.title || title || prompt.slice(0, 60);
      return {
        studioResult: {
          ok: true as const,
          songId: result.songId,
          blob,
          mediaType,
          title: songTitle,
          kind: "audio" as const,
        },
        songPreview: {
          songId: result.songId,
          title: songTitle,
          url,
          lyrics: result.lyrics,
          chords: result.chords,
          structure: result.structure,
        },
      };
    },
    onSettled: () => onPendingChange(false, ""),
    onSuccess: ({ studioResult, songPreview }) => {
      setPreview(songPreview);
      onResult(studioResult, "¡Tu canción y su letra están listas!");
    },
    onError: (e) =>
      onResult(
        { ok: false, status: 400, message: e instanceof Error ? e.message : "No se pudo generar." },
        "",
      ),
  });

  const canGenerate =
    (prompt.trim().length >= 3 || lyrics.trim().length >= 3) &&
    (creationMode !== "custom" || Object.values(advanced).some(Boolean)) &&
    !mutation.isPending &&
    !disabledReason;

  return (
    <div className="space-y-7">
      <div className="space-y-1">
        <Label htmlFor="song-title">Título de la canción</Label>
        <Input
          id="song-title"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Dale un nombre a tu creación (opcional)"
          className="rounded-xl border-border bg-surface/80"
        />
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="song-prompt" className="font-display text-sm">
            Describe tu canción
          </label>
          <Button
            type="button"
            variant="glass"
            size="sm"
            disabled={improveMutation.isPending || prompt.trim().length < 3}
            onClick={() => (signedIn ? improveMutation.mutate() : requireSignIn())}
          >
            {improveMutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}✨
            Mejorar
          </Button>
        </div>
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
            disabled={lyricsMutation.isPending || prompt.trim().length < 3 || instrumental}
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
          disabled={instrumental}
          placeholder={"[Verso 1]\nEscribe aquí tu letra…\n\n[Coro]\n…"}
          className="min-h-36 resize-y rounded-xl border-border bg-surface/80 p-4 font-mono text-sm placeholder:text-muted-foreground/60"
        />
      </div>

      <OptionGroup
        label="Motor / Versión"
        options={ENGINES.map((e) => ({ value: e.id, label: e.label }))}
        value={engine}
        onChange={setEngine}
      />

      <OptionGroup
        label="Creación"
        variant="segmented"
        options={[
          { value: "simple", label: "Sencillo" },
          { value: "custom", label: "Personalizado" },
        ]}
        value={creationMode}
        onChange={(v) => setCreationMode(v as CreationMode)}
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-display text-sm">Estilos musicales</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={styles.length === 0}
              onClick={() => setStyleList([])}
            >
              <X /> Limpiar
            </Button>
            <Button type="button" variant="glass" size="sm" onClick={() => setStylesOpen(true)}>
              Todos los estilos &gt;
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_STYLES.map((style) => (
            <Button
              key={style}
              type="button"
              variant="chip"
              size="pill"
              aria-pressed={styles.includes(style)}
              data-active={styles.includes(style)}
              onClick={() => toggleStyle(style)}
            >
              {style}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="song-style">Estilo</Label>
          <Input
            id="song-style"
            value={styleText}
            placeholder="Dembow, Bachata, Trap…"
            onChange={(e) => setStyleList(e.target.value.split(/[,;]+/))}
            className="rounded-xl border-border bg-surface/80"
          />
        </div>
        <CommandDialog open={stylesOpen} onOpenChange={setStylesOpen}>
          <DialogTitle className="sr-only">Todos los estilos</DialogTitle>
          <CommandInput
            value={styleSearch}
            onValueChange={setStyleSearch}
            placeholder="Buscar estilo musical…"
          />
          <CommandList>
            <CommandEmpty>No se encontraron estilos.</CommandEmpty>
            <CommandGroup heading={styleSearch ? "Crear estilo" : "Estilos disponibles"}>
              {cleanStyle(styleSearch) &&
                !(GENRES as readonly string[]).includes(cleanStyle(styleSearch)) && (
                  <CommandItem
                    value={`crear-${styleSearch}`}
                    onSelect={() => {
                      toggleStyle(cleanStyle(styleSearch));
                      setStyleSearch("");
                      setStylesOpen(false);
                    }}
                  >
                    Añadir “{cleanStyle(styleSearch)}”
                  </CommandItem>
                )}
              {GENRES.filter((g) => g.toLowerCase().includes(styleSearch.trim().toLowerCase())).map(
                (style) => (
                  <CommandItem
                    key={style}
                    value={style}
                    onSelect={() => {
                      toggleStyle(style);
                      setStylesOpen(false);
                    }}
                  >
                    {style}
                  </CommandItem>
                ),
              )}
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface/60 p-4">
        <div>
          <Label htmlFor="song-instrumental">Instrumental (sin voz)</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Desactiva la letra y genera solo música.
          </p>
        </div>
        <Switch id="song-instrumental" checked={instrumental} onCheckedChange={setInstrumental} />
      </div>

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

      {creationMode === "custom" && (
        <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="font-display text-sm">Ajustes personalizados</p>
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
        </div>
      )}

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

      {preview && (
        <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4 backdrop-blur">
          <p className="font-display text-sm">{preview.title}</p>
          <audio controls src={preview.url} className="w-full" />
          <Button asChild variant="glass" size="sm">
            <a
              href={preview.url}
              download={`${preview.title.replace(/[\\/:*?"<>|]/g, "") || "leudy-ia"}.mp4`}
            >
              Descargar .mp4
            </a>
          </Button>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Estructura</p>
            <p className="text-sm">{preview.structure}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Acordes</p>
            <p className="text-sm">{preview.chords}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Letra</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-background/60 p-3 text-sm">
              {preview.lyrics}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
