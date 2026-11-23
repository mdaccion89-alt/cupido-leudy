import { useCallback, useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LockKeyhole, Radio, ShoppingBag, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { LiveRoom } from "@/components/cupido/live-room";
import { FaceVideoVerification } from "@/components/cupido/live-face-verification";
import { GranLigaStar, VerifiedBadge } from "@/components/cupido/verified-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/cupido";
import { fetchBlockedUserIds } from "@/lib/safety";
import { useLivePresenceCounts } from "@/lib/use-live-presence-counts";

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
  is_gran_liga: boolean;
  is_official: boolean;
  premium_coins: number;
  premium_minutes: number;
  premium_ends_at: string | null;
};

type ActiveDirect = {
  roomId: string;
  hostId: string;
  hostName: string;
  hostAvatar?: string;
  hostIsGranLiga: boolean;
  role: "host" | "viewer";
  stream?: MediaStream | null;
  premium_ends_at?: string | null;
};

const PREMIUM_LIVE_TIERS = [150, 300, 500, 1000] as const;

function DirectPage() {
  const { session, onlineUserIds } = useAuth();
  const account = useAccount();
  const viewerId = session?.user.id ?? null;
  const { liveId } = Route.useSearch();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [premiumTier, setPremiumTier] = useState(0);
  const [entryStream, setEntryStream] = useState<StreamRow | null>(null);
  const [payingEntry, setPayingEntry] = useState(false);
  const [active, setActive] = useState<ActiveDirect | null>(null);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const autoOpened = useRef<string | null>(null);

  const profile = useQuery({
    queryKey: ["cupido-direct-profile", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_profiles")
        .select("display_name,is_verified_blue,is_gran_liga,is_official,is_super_admin,verification_status")
        .eq("id", viewerId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const streams = useQuery({
    queryKey: ["cupido-direct-streams", viewerId],
    queryFn: async (): Promise<StreamRow[]> => {
      try {
        await supabase.rpc("cupido_end_stale_lives");
        const blockedIds = new Set(await fetchBlockedUserIds(viewerId));
        const { data: liveRows, error } = await supabase
          .from("live_streams")
          .select("id,host_id,title,viewers_count,started_at,status,premium_coins,premium_minutes,premium_ends_at")
          .eq("status", "live")
          .neq("host_id", viewerId ?? "00000000-0000-0000-0000-000000000000")
          .order("started_at", { ascending: false });
        if (error) {
          console.error("[directo] No se pudieron cargar los Directos activos.", error);
          return [];
        }
        const visibleLiveRows = (liveRows ?? []).filter((stream) => !blockedIds.has(stream.host_id));
        const hostIds = [...new Set(visibleLiveRows.map((stream) => stream.host_id))];
        const { data: profiles, error: profilesError } = hostIds.length
          ? await supabase
              .from("cupido_public_profiles")
              .select("id,display_name,avatar_url,is_verified_blue,is_gran_liga,is_official,is_super_admin")
              .in("id", hostIds)
          : { data: [], error: null };
        if (profilesError) console.warn("[directo] Se mostrarán los Lives sin datos públicos de anfitrión.", profilesError);
        const profileById = new Map((profiles ?? []).map((host) => [host.id, host]));
        return visibleLiveRows.map<StreamRow>((stream) => {
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
            is_gran_liga: Boolean(host?.is_gran_liga),
            is_official: Boolean(host?.is_official || host?.is_super_admin),
            premium_coins: stream.premium_coins ?? 0,
            premium_minutes: stream.premium_minutes ?? 0,
            premium_ends_at: stream.premium_ends_at ?? null,
          };
        });
      } catch (error) {
        console.error("[directo] Error inesperado leyendo Directos activos.", error);
        return [];
      }
    },
    staleTime: 0,
    refetchInterval: 20_000,
    retry: 2,
  });

  const livePresenceCounts = useLivePresenceCounts(streams.data?.map((stream) => stream.id) ?? [], active?.roomId);

  useEffect(() => {
    const channelName = `cupido-direct-list-${viewerId ?? "guest"}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel((channelName) + "-" + crypto.randomUUID())
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
    if (stream.premium_coins > 0) setEntryStream(stream);
    else setActive({ roomId: stream.id, hostId: stream.host_id, hostName: stream.host_name, hostAvatar: stream.host_avatar, hostIsGranLiga: stream.is_gran_liga, role: "viewer" });
  }, [liveId, streams.data, viewerId]);

  const startDirect = async () => {
    if (!viewerId) {
      toast.error("Inicia sesión para transmitir en Directo.");
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      const coins = PREMIUM_LIVE_TIERS[Math.max(0, premiumTier - 1)]!;
      const { data: roomId, error } = premiumTier === 0
        ? await supabase.rpc("cupido_start_live_room", { _title: title.trim() })
        : await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: { message: string } | null }> })
            .rpc("cupido_start_premium_live", { _title: title.trim(), _coins: coins, _minutes: 0 });
      if (error) throw error;
      if (!roomId) throw new Error("No se recibió el id del Live.");
      setActive({
        roomId,
        hostId: viewerId,
        hostName: profile.data?.display_name?.trim() || "Tú",
        hostIsGranLiga: Boolean(profile.data?.is_gran_liga),
        role: "host",
      });
      setTitle("");
      void queryClient.invalidateQueries({ queryKey: ["cupido-direct-streams"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar el Directo.");
    } finally {
      setStarting(false);
    }
  };

  const dismissDirect = useCallback(() => {
    setActive(null);
    void queryClient.invalidateQueries({ queryKey: ["cupido-direct-streams"] });
  }, [queryClient]);

  const closeDirect = useCallback(() => {
    if (active?.role === "host") {
      void supabase.rpc("cupido_end_live_room", { _id: active.roomId });
    }
    dismissDirect();
  }, [active, dismissDirect]);

  const enterStream = (stream: StreamRow) => {
    if (!viewerId) { toast.info("Inicia sesiÃ³n para entrar, comentar o enviar regalos."); return; }
    if (stream.host_id === viewerId) { toast.info("Tu transmisiÃ³n ya estÃ¡ activa."); return; }
    if (stream.premium_coins > 0) { setEntryStream(stream); return; }
    setActive({ roomId: stream.id, hostId: stream.host_id, hostName: stream.host_name, hostAvatar: stream.host_avatar, hostIsGranLiga: stream.is_gran_liga, role: "viewer" });
  };

  const payAndEnter = async () => {
    if (!entryStream || !viewerId || payingEntry) return;
    setPayingEntry(true);
    const { data, error } = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string } | null }> })
      .rpc("cupido_pay_live_entry", { _room: entryStream.id });
    setPayingEntry(false);
    if (error || !data) { toast.error(error?.message.includes("INSUFFICIENT") ? "No tienes monedas suficientes. Recarga y vuelve a entrar." : "No se pudo pagar la entrada a este Live."); return; }
    const stream = entryStream;
    setEntryStream(null);
    account.refresh();
    setActive({ roomId: stream.id, hostId: stream.host_id, hostName: stream.host_name, hostAvatar: stream.host_avatar, hostIsGranLiga: stream.is_gran_liga, role: "viewer" });
  };

  const canHost = Boolean(account.isSupremeAdmin || account.isGranLiga || profile.data?.is_gran_liga || profile.data?.is_official || profile.data?.is_super_admin || profile.data?.is_verified_blue);

  const submitFaceVideo = async (video: Blob) => {
    if (!viewerId) throw new Error("Inicia sesión para solicitar la insignia.");
    if (video.size < 1 || video.size > 20 * 1024 * 1024) throw new Error("El video debe pesar menos de 20 MB.");
    const extension = video.type.includes("mp4") ? "mp4" : "webm";
    const path = `${viewerId}/verification/${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("cupido-private").upload(path, video, {
      contentType: video.type || "video/webm",
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { error } = await supabase.rpc("cupido_submit_face_verification_video", { _video_path: path });
    if (error) throw error;
    setVerificationOpen(false);
    toast.success("Video enviado al Administrador Oficial para revisión.");
    await profile.refetch();
  };

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
              <p className="mt-1 text-xs text-muted-foreground">Se necesita insignia azul para transmitir. Elige entrada gratis o Premium.</p>
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
                <select value={premiumTier} onChange={(event) => setPremiumTier(Number(event.target.value))} aria-label="Tarifa del Live" className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value={0}>Gratis</option>
                  {PREMIUM_LIVE_TIERS.map((coins, index) => <option key={coins} value={index + 1}>{coins.toLocaleString("es")} monedas · entrada única</option>)}
                </select>
                <Button onClick={() => void startDirect()} disabled={starting} className="gap-2">
                  {starting ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
                  {starting ? "Iniciando…" : "Transmitir"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-sky-200">La insignia azul habilita las transmisiones.</span>
                {profile.data?.verification_status === "pending" ? (
                  <span className="text-xs text-muted-foreground">Solicitud en revisión</span>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setVerificationOpen(true)}>Habilitar insignia</Button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="mt-7">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-white">Directos activos</h2>
            <p className="mt-1 text-xs text-muted-foreground">Los Lives gratis revisan fotogramas automáticamente para detectar desnudez y violencia.</p>
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
          <div className="grid grid-cols-2 gap-3">
            {streams.data.map((stream) => {
              const openStream = () => {
                if (stream.host_id === viewerId) {
                  toast.info("Tu transmisión ya está activa.");
                  return;
                }
                if (!viewerId) {
                  toast.info("Inicia sesión para entrar, comentar o enviar regalos.");
                  return;
                }
                enterStream(stream);
              };
              return (
                <div
                  key={stream.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Entrar al directo de ${stream.host_name}`}
                  onClick={openStream}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openStream();
                    }
                  }}
                  className="group relative aspect-[3/4] cursor-pointer overflow-hidden rounded-2xl border border-pink-400/25 bg-pink-500/[0.06] shadow-lg transition active:scale-[0.98]"
                >
                  <img src={stream.host_avatar || "/favicon.ico"} alt="" className="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-105" />
                  <GranLigaStar active={stream.is_gran_liga} />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/90" />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-rose-600/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow">
                    <span className="size-1.5 animate-pulse rounded-full bg-white" /> EN VIVO
                  </span>
                  {stream.premium_coins > 0 && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-1 text-[10px] font-bold text-amber-100"><LockKeyhole className="size-3" /> {stream.premium_coins.toLocaleString("es")} monedas · entrada única</span>}
                  <div className="absolute inset-x-0 bottom-0 p-3 pr-14">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-white">{stream.title || "Directo en vivo"} ✨</h3>
                    <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-[11px] text-white/85">
                      <Link to="/perfil" search={{ userId: stream.host_id }} onClick={(event) => event.stopPropagation()} className="truncate hover:underline">{stream.host_name} ❤️</Link>
                      <VerifiedBadge verified={stream.is_verified_blue} official={stream.is_official} granLiga={stream.is_gran_liga} className="size-4" />
                    </p>
                    <p className={`mt-1 flex items-center gap-1 text-[10px] ${onlineUserIds.includes(stream.host_id) ? "text-emerald-300" : "text-white/60"}`}>
                      <span className={`size-1.5 rounded-full ${onlineUserIds.includes(stream.host_id) ? "bg-emerald-400" : "bg-zinc-500"}`} />
                      {onlineUserIds.includes(stream.host_id) ? "En línea" : "Desconectado"}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-pink-200"><Users className="size-3" /> {livePresenceCounts[stream.id] ?? stream.viewers_count} viendo</p>
                  </div>
                  <span className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full bg-purple-600 text-white shadow-[0_0_18px_rgba(168,85,247,0.7)] transition group-hover:bg-purple-500">
                    <Video className="size-5" />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {active && viewerId && (
        <LiveRoom
          roomId={active.roomId}
          hostId={active.hostId}
          hostName={active.hostName}
          hostAvatar={active.hostAvatar}
          hostIsGranLiga={active.hostIsGranLiga}
          viewerId={viewerId}
          role={active.role}
          initialStream={active.stream ?? null}
          premiumEndsAt={active.premium_ends_at ?? null}
          onClose={closeDirect}
          onEnded={dismissDirect}
        />
      )}

      <Dialog open={verificationOpen} onOpenChange={setVerificationOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Habilitar insignia azul</DialogTitle></DialogHeader>
          <FaceVideoVerification onComplete={submitFaceVideo} />
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(entryStream)} onOpenChange={(open) => !open && setEntryStream(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><LockKeyhole className="size-5 text-amber-200" /> Live Premium</DialogTitle><DialogDescription>La entrada única desbloquea el video y el chat mientras el Live siga activo. El pago se acredita al saldo retirable del anfitrión.</DialogDescription></DialogHeader>
          <p className="text-center font-display text-2xl text-amber-100">{entryStream?.premium_coins.toLocaleString("es")} monedas · entrada única</p>
          <div className="flex flex-wrap justify-center gap-2"><Button onClick={() => void payAndEnter()} disabled={payingEntry}>{payingEntry ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />} Pagar y desbloquear</Button><Button asChild variant="outline"><Link to="/tienda"><ShoppingBag className="size-4" /> Recargar con PayPal / tarjeta</Link></Button></div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
