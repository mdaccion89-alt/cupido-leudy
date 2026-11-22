import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coffee, Flame, Phone, Radio, ShoppingBag, Users } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { DailyReward } from "@/components/cupido/daily-reward";
import { LiveRoom } from "@/components/cupido/live-room";
import { GranLigaStar, VerifiedBadge } from "@/components/cupido/verified-badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { BRAND, CALL_COSTS } from "@/lib/cupido";
import { SUPREME_ADMIN_EMAIL } from "@/lib/posts";

export const Route = createFileRoute("/llamadas")({
  head: () => ({ meta: [{ title: `Llamadas en vivo — ${BRAND}` }] }),
  component: CallsPage,
});

type CallRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  mode: "hot" | "cafe";
  status: string;
  credits_spent: number;
  created_at: string;
};

type LiveRow = {
  id: string;
  host_id: string;
  title: string;
  viewer_count: number;
  host_name: string;
  host_avatar: string;
  is_verified_blue: boolean;
  is_gran_liga: boolean;
  email: string | null;
};

type ActiveLive = {
  roomId: string;
  hostId: string;
  hostName: string;
  hostIsGranLiga: boolean;
  role: "host" | "viewer";
  stream?: MediaStream | null;
};

function CallsPage() {
  const { session } = useAuth();
  const account = useAccount();
  const queryClient = useQueryClient();
  const viewerId = session?.user.id ?? null;
  const [liveTitle, setLiveTitle] = useState("");
  const [activeLive, setActiveLive] = useState<ActiveLive | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const pendingStreamRef = useRef<MediaStream | null>(null);

  const calls = useQuery({
    queryKey: ["cupido-call-history", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_calls")
        .select("id,caller_id,callee_id,mode,status,credits_spent,created_at")
        .or(`caller_id.eq.${viewerId},callee_id.eq.${viewerId}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as CallRow[];
    },
  });

  const myProfile = useQuery({
    queryKey: ["cupido-my-verification", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_profiles")
        .select("display_name,is_verified_blue,is_gran_liga,is_official,is_super_admin")
        .eq("id", viewerId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const liveRooms = useQuery({
    queryKey: ["cupido-live-rooms", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data: rooms, error } = await supabase
        .from("cupido_live_rooms")
        .select("id,host_id,title,viewer_count")
        .eq("is_live", true)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      const ids = [...new Set((rooms ?? []).map((room) => room.host_id))];
      const profiles = ids.length
        ? (await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url,is_verified_blue,is_gran_liga,is_official,is_super_admin").in("id", ids)).data ?? []
        : [];
      return (rooms ?? []).map<LiveRow>((room) => {
        const profile = profiles.find((row) => row.id === room.host_id);
        return {
          id: room.id,
          host_id: room.host_id,
          title: room.title,
          viewer_count: room.viewer_count,
          host_name: profile?.display_name ?? "Miembro de Cupido",
          host_avatar: profile?.avatar_url ?? "",
          is_verified_blue: profile?.is_verified_blue ?? false,
          is_gran_liga: profile?.is_gran_liga ?? false,
          email: profile?.is_official || profile?.is_super_admin ? SUPREME_ADMIN_EMAIL : null,
        };
      });
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(("cupido-live-list") + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_live_rooms" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-rooms", viewerId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, viewerId]);

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase
      .channel((`cupido-call-history-${viewerId}`) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_calls" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-call-history", viewerId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, viewerId]);

  useEffect(
    () => () => {
      pendingStreamRef.current?.getTracks().forEach((track) => track.stop());
      pendingStreamRef.current = null;
    },
    [],
  );

  const startLive = useMutation({
    mutationFn: async () => {
      setStartingLive(true);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA_UNAVAILABLE");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        throw new Error("CAMERA_DENIED");
      }
      pendingStreamRef.current = stream;
      try {
        const { data, error } = await supabase.rpc("cupido_start_live_room", { _title: liveTitle.trim() });
        if (error) throw error;
        return { roomId: data as string, stream };
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        pendingStreamRef.current = null;
        throw error;
      } finally {
        setStartingLive(false);
      }
    },
    onSuccess: ({ roomId, stream }) => {
      setActiveLive({
        roomId,
        hostId: viewerId!,
        hostName: myProfile.data?.display_name ?? "Tú",
        hostIsGranLiga: Boolean(myProfile.data?.is_gran_liga),
        role: "host",
        stream,
      });
      pendingStreamRef.current = null;
      setLiveTitle("");
      void queryClient.invalidateQueries({ queryKey: ["cupido-live-rooms", viewerId] });
    },
    onError: (error) => {
      const code = error instanceof Error ? error.message : "";
      if (code === "CAMERA_DENIED")
        toast.error("Permite cámara y micrófono antes de iniciar el Live.");
      else if (code === "CAMERA_UNAVAILABLE")
        toast.error("Este navegador no permite usar cámara o micrófono.");
      else if (code.includes("NOT_VERIFIED"))
        toast.error("Necesitas Insignia Azul o ser Admin Supremo para iniciar un Live.");
      else toast.error(`No se pudo iniciar el Live. ${code ? `Motivo: ${code}.` : ""}`);
    },
  });

  const refreshAfterLive = () => {
    setActiveLive(null);
    void queryClient.invalidateQueries({ queryKey: ["cupido-live-rooms", viewerId] });
  };

  const canHostLive = Boolean(account.isSupremeAdmin || account.isGranLiga || myProfile.data?.is_gran_liga || myProfile.data?.is_official || myProfile.data?.is_super_admin || myProfile.data?.is_verified_blue);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <header className="rounded-3xl border border-pink-400/25 bg-gradient-to-br from-pink-500/15 via-fuchsia-500/10 to-transparent p-7">
        <p className="inline-flex items-center gap-2 rounded-full border border-pink-300/30 bg-pink-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-pink-200">
          <Phone className="size-3.5" /> Llamadas en vivo
        </p>
        <h1 className="mt-4 font-display text-3xl text-white sm:text-4xl">
          Conexiones reales, voz real y Lives ❤️
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Inicia una llamada desde el chat con la persona que te interesa. Las notas de voz son gratis;
          las llamadas usan monedas brillantes y se conectan por WebRTC con señalización Supabase Realtime.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/chat">
              <Phone className="size-4" /> Abrir chat
            </Link>
          </Button>
          <Button asChild variant="glass">
            <Link to="/tienda">
              <ShoppingBag className="size-4" /> Comprar monedas brillantes
            </Link>
          </Button>
        </div>
      </header>

      <section className="mt-6 max-w-xl">
        <DailyReward />
      </section>

      <section className="mt-6 rounded-3xl border border-pink-400/25 bg-pink-500/[0.07] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-display text-xl text-white">
              <Radio className="size-5 animate-pulse text-pink-400" /> Lives de Cupido
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Solo perfiles con Insignia Azul pueden transmitir. Todos pueden mirar y regalar.
            </p>
          </div>
          {canHostLive ? (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <input
                value={liveTitle}
                onChange={(event) => setLiveTitle(event.target.value)}
                placeholder="Título de tu Live…"
                className="h-9 min-w-48 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
              />
              <Button
                onClick={() => startLive.mutate()}
                disabled={startLive.isPending || startingLive}
                className="gap-2"
              >
                {startLive.isPending || startingLive ? (
                  "Iniciando…"
                ) : (
                  <><Radio className="size-4" /> Iniciar Live</>
                )}
              </Button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200">
              <VerifiedBadge verified className="size-4" /> Insignia Azul requerida para transmitir
            </span>
          )}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {(liveRooms.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay Lives activos en este momento.</p>
          ) : (
            liveRooms.data!.map((room) => (
              <div key={room.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-pink-500/20 text-lg">
                  <GranLigaStar active={room.is_gran_liga} />
                  {room.host_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-medium text-white">
                    {room.title}
                    <VerifiedBadge email={room.email} verified={room.is_verified_blue} granLiga={room.is_gran_liga} className="size-4" />
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {room.host_name} · <Users className="inline size-3" /> {room.viewer_count} viendo
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    setActiveLive({ roomId: room.id, hostId: room.host_id, hostName: room.host_name, hostIsGranLiga: room.is_gran_liga, role: "viewer" })
                  }
                >
                  Ver Live
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-orange-400/25 bg-orange-500/10 p-5">
          <Flame className="size-6 text-orange-300" />
          <h2 className="mt-3 font-display text-xl text-white">Sala Hot</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {CALL_COSTS.hot} monedas brillantes por llamada. Conversación apasionada y directa con consentimiento.
          </p>
        </div>
        <div className="rounded-2xl border border-sky-400/25 bg-sky-500/10 p-5">
          <Coffee className="size-6 text-sky-300" />
          <h2 className="mt-3 font-display text-xl text-white">Sala Café</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {CALL_COSTS.cafe} monedas brillantes por llamada. Para conocerse tranquilo y tomar un café virtual.
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl text-white">Tus monedas brillantes</h2>
          <p className="flex items-center gap-1.5 font-display text-2xl text-amber-200">
            <CoinIcon className="size-6" />
            {account.loading ? "..." : account.balanceUnavailable ? "—" : account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}
          </p>
        </div>
        <h3 className="mt-6 font-display text-lg text-white">Historial reciente</h3>
        <div className="mt-3 space-y-2">
          {(calls.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {viewerId ? "Aún no tienes llamadas." : "Inicia sesión para ver tu historial."}
            </p>
          ) : (
            calls.data!.map((call) => (
              <div
                key={call.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-4 py-3 text-sm"
              >
                <span className="text-white">
                  {call.mode === "hot" ? "🔥 Hot" : "☕ Café"} · {call.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(call.created_at).toLocaleString("es")}
                </span>
                <span className="flex items-center gap-1 text-amber-200">
                  <CoinIcon className="size-3.5" /> {call.credits_spent}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {activeLive && viewerId && (
        <LiveRoom
          roomId={activeLive.roomId}
          hostId={activeLive.hostId}
          hostName={activeLive.hostName}
          hostIsGranLiga={activeLive.hostIsGranLiga}
          viewerId={viewerId}
          role={activeLive.role}
          initialStream={activeLive.stream ?? null}
          onClose={refreshAfterLive}
          onEnded={refreshAfterLive}
        />
      )}
    </main>
  );
}
