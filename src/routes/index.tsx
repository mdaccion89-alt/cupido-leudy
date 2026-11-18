import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import heroWaves from "@/assets/hero-waves.jpg";
import { CreationsList } from "@/components/studio/creations-list";
import { MediaPlayer } from "@/components/studio/media-player";
import { SiteHeader } from "@/components/studio/site-header";
import { SongTab } from "@/components/studio/song-tab";
import { isWorking, type Song } from "@/components/studio/types";
import { supabase } from "@/integrations/supabase/client";
import { useAccount, useSiteSettings } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import type { ActionResult } from "@/lib/music.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Leudy IA Adobe — Crea música con inteligencia artificial" },
      {
        name: "description",
        content:
          "Describe tu canción, elige género, voz y BPM, y Leudy IA Adobe la compone por ti.",
      },
      { property: "og:title", content: "Leudy IA Adobe — Crea música con IA" },
      {
        property: "og:description",
        content:
          "Genera canciones de dembow, reguetón, bachata, salsa, trap y más a partir de una idea.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

function Studio() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useSiteSettings();
  const { isAdmin } = useAccount();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoPlayKey, setAutoPlayKey] = useState<string | null>(null);
  const [pending, setPending] = useState<{ on: boolean; label: string }>({ on: false, label: "" });
  const [elapsed, setElapsed] = useState(0);

  const songsQuery = useQuery({
    queryKey: ["songs", userId],
    enabled: Boolean(userId),
    refetchInterval: (query) => (query.state.data?.some(isWorking) || pending.on ? 5000 : false),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("songs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Song[];
    },
  });
  const songs = songsQuery.data ?? [];
  const selected = songs.find((s) => s.id === selectedId) ?? null;

  const mediaQuery = useQuery({
    queryKey: ["song-media", selected?.id, selected?.storage_path],
    enabled: Boolean(selected?.storage_path),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("songs")
        .download(selected!.storage_path!);
      if (error) throw error;
      return data.type ? data : new Blob([data], { type: selected!.media_type });
    },
  });

  useEffect(() => {
    if (!pending.on) return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 500);
    return () => clearInterval(t);
  }, [pending.on]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["songs", userId] });
    queryClient.invalidateQueries({ queryKey: ["account", userId] });
  };

  const onResult = (r: ActionResult, msg: string) => {
    refresh();
    if (r.ok) {
      setSelectedId(r.songId);
      setAutoPlayKey(r.songId);
      if (msg) toast.success(msg);
    } else toast.error(r.message);
  };

  const onDelete = async (song: Song) => {
    if (!confirm(`¿Eliminar "${song.title}"?`)) return undefined;
    if (song.storage_path) await supabase.storage.from("songs").remove([song.storage_path]);
    const { error } = await supabase.from("songs").delete().eq("id", song.id);
    if (error) {
      toast.error("No se pudo eliminar.");
      return undefined;
    }
    if (selectedId === song.id) setSelectedId(null);
    refresh();
    return undefined;
  };

  const onTogglePublic = async (song: Song) => {
    const next = !song.is_public;
    const { error } = await supabase
      .from("songs")
      .update({ is_public: next, published_at: next ? new Date().toISOString() : null })
      .eq("id", song.id);
    if (error) {
      toast.error("No se pudo actualizar.");
      return undefined;
    }
    toast.success(next ? "Publicada en la galería" : "Retirada de la galería");
    refresh();
    return undefined;
  };

  const composing = pending.on || Boolean(selected && isWorking(selected));

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px]">
        <img
          src={settings.banner_image || heroWaves}
          alt=""
          width={1920}
          height={1088}
          className="h-full w-full object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/60 to-background" />
      </div>
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        <section className="animate-float-in pb-10 pt-8 sm:pt-14">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
            <Sparkles className="size-3.5 text-primary" /> {settings.site_title}
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] sm:text-6xl">
            {settings.site_tagline}
          </h1>
          {settings.banner_text && (
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">{settings.banner_text}</p>
          )}
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
          <div className="panel grain p-6 sm:p-8">
            <SongTab
              signedIn={Boolean(session)}
              userId={userId}
              songs={songs}
              requireSignIn={() => navigate({ to: "/auth" })}
              onPendingChange={(on, label) => setPending({ on, label })}
              onResult={onResult}
              disabledReason={
                settings.songs_enabled
                  ? undefined
                  : "La creación de canciones está desactivada por ahora."
              }
              isAdmin={isAdmin}
            />
          </div>
          <MediaPlayer
            song={pending.on ? null : selected}
            blob={pending.on ? null : (mediaQuery.data ?? null)}
            loadingMedia={mediaQuery.isFetching}
            composing={composing}
            composingLabel={pending.label || "Creando…"}
            elapsed={elapsed}
            autoPlayKey={autoPlayKey}
            onTogglePublic={onTogglePublic}
            galleryEnabled={settings.gallery_enabled}
            userId={userId}
          />
        </section>

        <section className="mt-20">
          <h2 className="mb-6 text-2xl font-semibold sm:text-3xl">Mis Creaciones</h2>
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
            <p className="text-muted-foreground">
              Inicia sesión para guardar y escuchar tus canciones.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
