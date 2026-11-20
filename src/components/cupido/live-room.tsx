import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Gift, Loader2, PhoneOff, Radio, Users, X } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAccount } from "@/lib/account";
import { canSendGift, FREE_GIFT_MAX_CREDITS, giftErrorMessage, type Gift as GiftType } from "@/lib/cupido";
import { supabase } from "@/integrations/supabase/client";
import { type Json } from "@/integrations/supabase/types";

type LiveRoomProps = {
  roomId: string;
  hostId: string;
  hostName: string;
  viewerId: string;
  role: "host" | "viewer";
  onClose: () => void;
  onEnded: () => void;
  initialStream?: MediaStream | null;
};

type LiveSignal =
  | { kind: "join"; sender: string; receiver?: string }
  | { kind: "offer" | "answer"; sender: string; receiver?: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; sender: string; receiver?: string; candidate: RTCIceCandidateInit }
  | { kind: "end"; sender: string; receiver?: string };

type PresenceMeta = { user_id: string; role: "host" | "viewer" };

export function LiveRoom({
  roomId,
  hostId,
  hostName,
  viewerId,
  role,
  onClose,
  onEnded,
  initialStream,
}: LiveRoomProps) {
  const account = useAccount();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const pendingJoinsRef = useRef<string[]>([]);
  const [ready, setReady] = useState(false);
  const [sendingGift, setSendingGift] = useState(false);
  const [viewers, setViewers] = useState(0);

  const sendSignal = useCallback(
    async (signal: LiveSignal) => {
      const { receiver, ...payload } = signal;
      const { error } = await supabase.from("cupido_live_signals").insert({
        room_id: roomId,
        sender_id: viewerId,
        receiver_id: receiver ?? null,
        payload: payload as unknown as Json,
      });
      if (error) throw error;
    },
    [roomId, viewerId],
  );

  const createHostPeer = useCallback(
    async (peerId: string) => {
      if (!localStreamRef.current || peersRef.current.has(peerId)) return;
      const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      localStreamRef.current.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current!));
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          void sendSignal({ kind: "ice", sender: viewerId, receiver: peerId, candidate: event.candidate.toJSON() });
        }
      };
      peersRef.current.set(peerId, peer);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal({ kind: "offer", sender: viewerId, receiver: peerId, sdp: offer });
    },
    [sendSignal, viewerId],
  );

  useEffect(() => {
    let disposed = false;

    const start = async () => {
      try {
        if (role === "host") {
          const stream = initialStream ?? (await navigator.mediaDevices.getUserMedia({ video: true, audio: true }));
          if (disposed) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          localStreamRef.current = stream;
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
          for (const peerId of pendingJoinsRef.current) await createHostPeer(peerId);
          pendingJoinsRef.current = [];
        } else {
          await supabase.from("cupido_live_viewers").upsert({ room_id: roomId, user_id: viewerId });
          const offerPeer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
          peersRef.current.set(hostId, offerPeer);
          offerPeer.ontrack = (event) => {
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0] ?? null;
          };
          offerPeer.onicecandidate = (event) => {
            if (event.candidate) {
              void sendSignal({ kind: "ice", sender: viewerId, receiver: hostId, candidate: event.candidate.toJSON() });
            }
          };
          await sendSignal({ kind: "join", sender: viewerId });
        }
        setReady(true);
      } catch (error) {
        const message =
          error instanceof Error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
            ? "Permite cámara y micrófono para iniciar el Live."
            : "No se pudo iniciar el video en vivo. Revisa permisos de cámara y micrófono.";
        toast.error(message);
        onClose();
      }
    };

    void start();

    const roomChannel = supabase
      .channel(`cupido-live-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cupido_live_rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === "UPDATE" || payload.eventType === "DELETE") onEnded();
        },
      )
      .subscribe();

    const presenceChannel = supabase
      .channel(`cupido-live-presence-${roomId}`)
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState<PresenceMeta>();
        const ids = new Set<string>();
        Object.values(state)
          .flat()
          .forEach((meta) => {
            if (meta.role !== "host" && meta.user_id) ids.add(meta.user_id);
          });
        setViewers(ids.size);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ user_id: viewerId, role, online_at: new Date().toISOString() });
        }
      });

    const signalsChannel = supabase
      .channel(`cupido-live-signals-${roomId}-${viewerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cupido_live_signals", filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const signal = payload.new as unknown as LiveSignal & { receiver?: string };
          if (signal.sender === viewerId) return;
          if (signal.receiver && signal.receiver !== viewerId) return;

          try {
            if (signal.kind === "join" && role === "host") {
              if (localStreamRef.current) await createHostPeer(signal.sender);
              else pendingJoinsRef.current.push(signal.sender);
              return;
            }
            if (signal.kind === "end") {
              onEnded();
              return;
            }
            if (signal.kind === "offer" && role === "viewer") {
              const peer = peersRef.current.get(hostId);
              if (!peer) return;
              await peer.setRemoteDescription(signal.sdp);
              const pending = pendingIceRef.current.get(hostId) ?? [];
              for (const candidate of pending) await peer.addIceCandidate(candidate);
              pendingIceRef.current.delete(hostId);
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              await sendSignal({ kind: "answer", sender: viewerId, receiver: hostId, sdp: answer });
              return;
            }
            if (signal.kind === "answer" && role === "host") {
              const peer = peersRef.current.get(signal.sender);
              if (!peer) return;
              await peer.setRemoteDescription(signal.sdp);
              const pending = pendingIceRef.current.get(signal.sender) ?? [];
              for (const candidate of pending) await peer.addIceCandidate(candidate);
              pendingIceRef.current.delete(signal.sender);
              return;
            }
            if (signal.kind === "ice") {
              const peerId = role === "host" ? signal.sender : hostId;
              const peer = peersRef.current.get(peerId);
              if (!peer) {
                const pending = pendingIceRef.current.get(peerId) ?? [];
                pending.push(signal.candidate);
                pendingIceRef.current.set(peerId, pending);
                return;
              }
              if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
            }
          } catch {
            toast.error("Falló la conexión de video en vivo.");
          }
        },
      )
      .subscribe();

    return () => {
      disposed = true;
      if (role === "host") void sendSignal({ kind: "end", sender: viewerId }).catch(() => undefined);
      void supabase.from("cupido_live_viewers").delete().eq("room_id", roomId).eq("user_id", viewerId).then(() => undefined);
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      void supabase.removeChannel(roomChannel);
      void supabase.removeChannel(presenceChannel);
      void supabase.removeChannel(signalsChannel);
    };
  }, [roomId, hostId, viewerId, role, onClose, onEnded, initialStream, createHostPeer, sendSignal]);

  const sendGift = async (gift: GiftType) => {
    if (!canSendGift(gift, account)) {
      toast.error(
        account.hasPurchased || account.isAdmin
          ? "No tienes monedas brillantes suficientes."
          : `Los regalos de más de ${FREE_GIFT_MAX_CREDITS} monedas requieren compra o recarga.`,
      );
      return;
    }
    setSendingGift(true);
    const { error } = await supabase.rpc("cupido_send_live_gift", {
      _room: roomId,
      _receiver: hostId,
      _gift_id: gift.id,
      _credits: gift.credits,
      _cash_value: gift.cash,
    });
    setSendingGift(false);
    if (error) {
      toast.error(giftErrorMessage(error.message, "No se pudo enviar el regalo en vivo."));
      return;
    }
    account.refresh();
    toast.success(`Regalo ${gift.emoji} enviado a ${hostName} ❤️`);
  };

  const endLive = async () => {
    const { error } = await supabase.rpc("cupido_end_live_room", { _id: roomId });
    if (error) toast.error("No se pudo finalizar el Live.");
    else onEnded();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-5 animate-pulse text-pink-400" />
            {role === "host" ? "Tu Live está en vivo" : `Live de ${hostName}`}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Users className="size-3.5" /> {viewers} viendo</span>
            <span className="flex items-center gap-1"><CoinIcon className="size-3.5" /> Monedas brillantes activas</span>
            {!ready && <Loader2 className="size-3.5 animate-spin" />}
          </DialogDescription>
        </DialogHeader>
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
          <video
            ref={role === "host" ? localVideoRef : remoteVideoRef}
            autoPlay
            playsInline
            muted={role === "host"}
            className="h-full w-full object-cover"
          />
          <span className="absolute left-3 top-3 rounded-full bg-pink-600 px-2.5 py-1 text-xs font-bold text-white">
            ● EN VIVO
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {role === "viewer" ? (
            <Button variant="destructive" onClick={onClose} className="gap-2">
              <X className="size-4" /> Salir
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => void endLive()} className="gap-2">
              <PhoneOff className="size-4" /> Finalizar Live
            </Button>
          )}
        </div>
        <div className="mt-3 rounded-2xl border border-pink-400/20 bg-pink-500/[0.06] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-display text-base text-white">
              <Gift className="size-4 text-pink-300" /> 99 regalos para {role === "host" ? "tu audiencia" : hostName}
            </p>
            <p className="flex items-center gap-1 text-xs text-amber-200">
              <CoinIcon className="size-3.5" />
              {account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}
            </p>
          </div>
          <GiftGrid compact onSelect={(gift) => void sendGift(gift)} disabled={sendingGift} />
          {!account.hasPurchased && !account.isAdmin && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
              <CreditCard className="size-3" /> Hasta {FREE_GIFT_MAX_CREDITS} monedas son gratis; para regalos
              superiores compra o recarga en la tienda.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
