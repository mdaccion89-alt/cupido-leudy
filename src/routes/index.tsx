import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import heroWaves from "@/assets/hero-waves.jpg";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AudioPlayer } from "@/components/studio/audio-player";
import { CreationsList } from "@/components/studio/creations-list";
import { SiteHeader } from "@/components/studio/site-header";
import type { Song } from "@/components/studio/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { DURATIONS, GENRES, MAX_PROMPT_LENGTH, type DurationSeconds, type Genre } from "@/lib/music";
import { generateSong } from "@/lib/music.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Leudy IA Adobe — Crea música con inteligencia artificial" },
      {
        name: "description",
        content: "Describe tu canción, elige el género y la duración, y Leudy IA Adobe la compone por ti en segundos.",
      },
      { property: "og:title", content: "Leudy IA Adobe — Crea música con IA" },
      {
        property: "og:description",
        content: "Genera canciones de reguetón, pop, electrónica, rock y lo-fi a partir de una simple descripción.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

const EXAMPLES = [
  "Una canción de verano sobre bailar en la playa hasta el amanecer",
  "Un tema nostálgico sobre volver al barrio donde crecí",
  "Música para estudiar de noche con lluvia en la ventana",
];

function Studio() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const generate = useServerFn(generateSong);

  const [prompt, setPrompt] = useState("");
  const [genre, setGenre] = useState<Genre>("Reguetón");
  const [duration, setDuration] = useState<DurationSeconds>(60);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoPlayKey, setAutoPlayKey] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const songsQuery = useQuery({
    queryKey: ["songs", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from("songs").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Song[];
    },
  });
  const songs = songsQuery.data ?? [];
  const selected = songs.find((s) => s.id === selectedId) ?? null;

  const audioQuery = useQuery({
    queryKey: ["song-audio", selected?.id],
    enabled: Boolean(selected?.storage_path),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("songs").download(selected!.storage_path!);
      if (error) throw error;
      return data.type === "audio/mpeg" ? data : new Blob([data], { type: "audio/mpeg" });
    },
  });

  const mutation = useMutation({
    mutationFn: () => generate({ data: { prompt, genre, duration } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["songs", userId] });
      if (result.ok) {
        setSelectedId(result.songId);
        setAutoPlayKey(result.songId);
        toast.success("¡Tu canción está lista!");
      } else {
        toast.error(result.message);
      }
    },
    onError: async (err) => {
      await queryClient.invalidateQueries({ queryKey: ["songs", userId] });
      toast.error(err instanceof Error ? err.message : "No se pudo generar la canción.");
    },
  });

  useEffect(() => {
    if (!mutation.isPending) return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 500);
    return () => clearInterval(t);
  }, [mutation.isPending]);

  useEffect(() => {
    if (audioQuery.error) toast.error("No se pudo cargar el audio de esta canción.");
  }, [audioQuery.error]);

  const canGenerate = prompt.trim().length >= 3 && !mutation.isPending;

  const onGenerate = () => {
    if (!session) {
      navigate({ to: "/auth" });
      return;
    }
    if (!canGenerate) return;
    if (mutation.isPending) return;
    queryClient.invalidateQueries({ queryKey: ["songs", userId] });
    mutation.mutate();
  };

  const onDelete = async (song: Song) => {
    if (!confirm(`¿Eliminar "${song.title}"?`)) return;
    if (song.storage_path) await supabase.storage.from("songs").remove([song.storage_path]);
    const { error } = await supabase.from("songs").delete().eq("id", song.id);
    if (error) {
      toast.error("No se pudo eliminar la canción.");
      return;
    }
    if (selectedId === song.id) setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: ["songs", userId] });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px]">
        <img src={heroWaves} alt="" width={1920} height={1088} className="h-full w-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/60 to-background" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        <section className="animate-float-in pb-10 pt-8 sm:pt-14">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
            <Sparkles className="size-3.5 text-primary" /> Estudio de música con IA
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] sm:text-6xl">
            Convierte tus ideas en <span className="text-gradient">canciones</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Escribe lo que imaginas, elige el estilo y la duración. Nosotros ponemos el ritmo.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
          <div className="panel grain p-6 sm:p-8" style={{ animationDelay: "80ms" }}>
            <label htmlFor="prompt" className="mb-3 block font-display text-sm">
              Describe tu canción
            </label>
            <Textarea
              id="prompt"
              value={prompt}
              maxLength={MAX_PROMPT_LENGTH}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ej.: Una canción alegre sobre un amor de verano en Santo Domingo, con coro pegajoso…"
              className="min-h-36 resize-none rounded-xl border-border bg-surface/80 p-4 text-base placeholder:text-muted-foreground/70 focus-visible:ring-primary/50"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setPrompt(ex)}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {ex.split(" ").slice(0, 4).join(" ")}…
                  </button>
                ))}
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {prompt.length}/{MAX_PROMPT_LENGTH}
              </span>
            </div>

            <fieldset className="mt-7">
              <legend className="mb-3 font-display text-sm">Género musical</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {GENRES.map((g) => (
                  <Button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={genre === g}
                    data-active={genre === g}
                    variant="chip"
                    size="pill"
                    onClick={() => setGenre(g)}
                  >
                    {g}
                  </Button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-7">
              <legend className="mb-3 font-display text-sm">Duración</legend>
              <div className="grid grid-cols-4 gap-2 rounded-2xl border border-border bg-surface/80 p-1.5" role="radiogroup">
                {DURATIONS.map((d) => (
                  <Button
                    key={d.seconds}
                    type="button"
                    role="radio"
                    aria-checked={duration === d.seconds}
                    data-active={duration === d.seconds}
                    variant="chip"
                    className="h-11 rounded-xl border-transparent bg-transparent px-2"
                    onClick={() => setDuration(d.seconds)}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </fieldset>

            <Button
              variant="hero"
              size="xl"
              className="mt-8 w-full animate-pulse-glow whitespace-normal px-6"
              disabled={Boolean(session) && !canGenerate}
              onClick={onGenerate}
            >
              <Wand2 />
              {mutation.isPending ? "Generando…" : session ? "Generar Música" : "Inicia sesión para generar"}
            </Button>
          </div>

          <AudioPlayer
            song={mutation.isPending ? null : selected}
            blob={mutation.isPending ? null : (audioQuery.data ?? null)}
            loadingAudio={audioQuery.isFetching}
            composing={mutation.isPending}
            elapsed={elapsed}
            autoPlayKey={autoPlayKey}
          />
        </section>

        <section className="mt-20">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold sm:text-3xl">Mis Creaciones</h2>
              <p className="mt-1 text-sm text-muted-foreground">Escucha y descarga tus canciones anteriores.</p>
            </div>
            {songs.length > 0 && <span className="text-sm text-muted-foreground">{songs.length} canciones</span>}
          </div>
          {session ? (
            <CreationsList
              songs={songs}
              loading={songsQuery.isLoading}
              selectedId={selectedId}
              onSelect={(s) => {
                setSelectedId(s.id);
                setAutoPlayKey(s.id);
              }}
              onDelete={onDelete}
            />
          ) : (
            <div className="panel flex flex-col items-center gap-4 p-10 text-center">
              <p className="font-display">Inicia sesión para guardar y escuchar tus canciones</p>
              <Button variant="hero" size="pill" onClick={() => navigate({ to: "/auth" })}>
                Iniciar sesión
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
