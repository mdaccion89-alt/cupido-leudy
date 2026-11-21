import { useCallback, useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Radio, ShoppingBag, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { LiveRoom } from "@/components/cupido/live-room";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/cupido";

export const Route = createFileRoute("/directo")({
  validateSearch: (search: { liveId?: string }) => ({ liveId: typeof search.liveId === "string" ? search.liveId : undefined }),
  head: () => ({ meta: [{ title: `Directo — ${BRAND}` }] }),
  component: DirectPage,
});

type StreamRow = {
  id: string;
  host_id: string;
  title: string;
  viewers_count: number;
  started_at: string;
  host_name: string;
  host_avatar: string;
  is_verified_blue: boolean;
  is_official: boolean;
};

type ActiveDirect = {
  roomId: string;
  hostId: string;
  hostName: string;
  role: "host" | "viewer";
  stream?: MediaStream | null;
};

function DirectPage() {
  const { session } = useAuth();
  const account = useAccount();
  const viewerId = session?.user.id ?? null;
  const { liveId } = Route.useSearch();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState<ActiveDirect | null>(null);
  const pendingStream = useRef<MediaStream | null>(null);
  const autoOpened = useRef<string | null>(null);

  const profile = useQuery({
    queryKey: ["cupido-direct-profile", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_profiles")
        .select("display_name,is_verified_blue")
        .eq("id", viewerId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const streams = useQuery({
    queryKey: ["cupido-direct-streams"],
    queryFn: async () => {
      const { data: liveRows, error } = await supabase
        .from("live_streams")
        .select("id,host_id,title,viewers_count,started_at,status")
        .eq("status", "live")
        .order("started_at", { ascending: false });
      if (error) throw error;
      const hostIds = [...new Set((liveRows ?? []).map((stream) => stream.host_id))];
      const { data: profiles, error: profilesError } = hostIds.length
        ? await supabase
            .from("cupido_public_profiles")
            .select("id,display_name,avatar_url,is_verified_blue,is_official,is_super_admin")
            .in("id", hostIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileById = new Map((profiles ?? []).map((host) => [host.id, host]));
      return (liveRows ?? []).map<StreamRow>((stream) => {
        const host = profileById.get(stream.host_id);
        return {
          id: stream.id,
          host_id: stream.host_id,
          title: stream.title,
          viewers_count: stream.viewers_count,
          started_at: stream.started_at,
          host_name: host?.display_name?.trim() || "Miembro de Cupido",
          host_avatar: host?.avatar_url ?? "",
          is_verified_blue: Boolean(host?.is_verified_blue),
          is_official: Boolean(host?.is_official || host?.is_super_admin),
        };
      });
    },
    staleTime: 0,
  });

  useEffect(() => {
    const channelName = `cupido-direct-list-${viewerId ?? "guest"}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_streams" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-direct-streams"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, viewerId]);

  useEffect(() => {
    if (!liveId || liveId === autoOpened.current || !streams.data) return;
    const stream = streams.data.find((row) => row.id === liveId);
    if (!stream || stream.host_id === viewerId) return;
    autoOpened.current = liveId;
    setActive({ roomId: stream.id, hostId: stream.host_id, hostName: stream.host_name, role: "viewer" });
  }, [liveId, streams.data, viewerId]);

  useEffect(() => () => {
    pendingStream.current?.getTracks().forEach((track) => track.stop());
    pendingStream.current = null;
  }, []);

  const startDirect = async () => {
    if (!viewerId) {
      toast.error("Inicia sesión para transmitir en Directo.");
      return;
    }
    if (starting) return;
    setStarting(true);
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este dispositivo no permite usar la cámara.");
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      pendingStream.current = stream;
      const { data: roomId, error } = await supabase.rpc("cupido_start_live_room", { _title: title.trim() });
      if (error) throw error;
      setActive({
        roomId,
        hostId: viewerId,
        hostName: profile.data?.display_name?.trim() || "Tú",
        role: "host",
        stream,
      });
      pendingStream.current = null;
      setTitle("");
      void queryClient.invalidateQueries({ queryKey: ["cupido-direct-streams"] });
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      pendingStream.current = null;
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar el Directo.");
    } finally {
      setStarting(false);
    }
  };

  const closeDirect = useCallback(() => {
    setActive(null);
    void queryClient.invalidateQueries({ queryKey: ["cupido-direct-streams"] });
  }, [queryClient]);

  const canHost = Boolean(account.isAdmin || profile.data?.is_verified_blue);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="rounded-3xl border border-pink-400/25 bg-gradient-to-br from-pink-500/15 via-fuchsia-500/10 to-transparent p-6 sm:p-8">
        <p className="inline-flex items-center gap-2 rounded-full border border-pink-300/30 bg-pink-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-pink-200">
          <Radio className="size-3.5 animate-pulse" /> Directo en vivo
        </p>
        <h1 className="mt-4 font-display text-3xl text-white sm:text-4xl">Conexiones reales, ahora mismo ❤️</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Transmite desde tu cámara o entra a cualquier sala activa. Video, audio y chat en tiempo real.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link to="/tienda"><ShoppingBag className="size-4" /> Recargar monedas</Link></Button>
          {!viewerId && <Button asChild><Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link></Button>}
        </div>
      </header>

      {viewerId && (
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl text-white">Iniciar una transmisión</h2>
              <p className="mt-1 text-xs text-muted-foreground">Se necesita insignia azul para transmitir. Todos pueden entrar y participar.</p>
            </div>
            {canHost ? (
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={100}
                  placeholder="Título del Directo…"
                  className="h-10 min-w-48 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
                />
                <Button onClick={() => void startDirect()} disabled={starting} className="gap-2">
                  {starting ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
                  {starting ? "Iniciando…" : "Transmitir"}
                </Button>
              </div>
            ) : <span className="text-xs text-sky-200">La insignia azul habilita las transmisiones.</span>}
          </div>
        </section>
      )}

      <section className="mt-7">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-white">Directos activos</h2>
            <p className="mt-1 text-xs text-muted-foreground">Todas las personas pueden ver estas salas públicas.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-500/10 px-3 py-1.5 text-xs text-pink-200">
            <Users className="size-3.5" /> {streams.data?.length ?? 0} en vivo
          </span>
        </div>
        {streams.isLoading ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Buscando transmisiones…</p>
        ) : streams.isError ? (
          <p className="rounded-2xl border border-red-400/20 bg-red-500/5 p-4 text-sm text-red-200">
            {streams.error instanceof Error ? streams.error.message : "No se pudieron cargar los directos."}
          </p>
        ) : !streams.data?.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
            No hay transmisiones activas. Vuelve pronto ❤️
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {streams.data.map((stream) => (
              <article key={stream.id} className="rounded-2xl border border-pink-400/20 bg-pink-500/[0.06] p-4">
                <div className="flex items-start gap-3">
                  <img src={stream.host_avatar || "/favicon.ico"} alt="" className="size-12 rounded-full border border-white/15 object-cover" />
                  <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-1 truncate font-medium text-white">
                      {stream.title}
                      <VerifiedBadge verified={stream.is_verified_blue} className="size-4" />
                    </h3>
                    <p className="truncate text-xs text-muted-foreground">{stream.host_name}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-pink-200"><Users className="size-3" /> {stream.viewers_count} viendo</p>
                  </div>
                </div>
                {stream.host_id === viewerId ? (
                  <p className="mt-4 rounded-lg bg-black/20 px-3 py-2 text-center text-xs text-pink-200">Tu transmisión está activa</p>
                ) : (
                  <Button
                    className="mt-4 w-full gap-2"
                    onClick={() => setActive({ roomId: stream.id, hostId: stream.host_id, hostName: stream.host_name, role: "viewer" })}
                    disabled={!viewerId}
                  >
                    <Radio className="size-4" /> Entrar al Directo
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {active && viewerId && (
        <LiveRoom
          roomId={active.roomId}
          hostId={active.hostId}
          hostName={active.hostName}
          viewerId={viewerId}
          role={active.role}
          initialStream={active.stream ?? null}
          onClose={closeDirect}
          onEnded={closeDirect}
        />
      )}
    </main>
  );
}
