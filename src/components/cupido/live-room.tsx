import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Gift, Loader2, MessageCircle, Mic, MicOff, PhoneOff, Radio, Send, Users, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Link } from "@tanstack/react-router";
import { useAccount } from "@/lib/account";
import { showInterstitialAd } from "@/lib/admob";
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

type PresenceMeta = { user_id: string; role: "host" | "viewer"; display_name?: string };
type LiveComment = { id: string; stream_id: string; user_id: string; body: string; created_at: string; display_name: string };

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
  const [liveMuted, setLiveMuted] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [joinMessages, setJoinMessages] = useState<string[]>([]);
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

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
      [...localStreamRef.current.getAudioTracks(), ...localStreamRef.current.getVideoTracks()].forEach((track) => {
        peer.addTrack(track, localStreamRef.current!);
      });
      peer.ontrack = (event) => {
        if (role !== "host" || event.track.kind !== "audio" || !remoteAudioRef.current) return;
        remoteAudioRef.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void remoteAudioRef.current.play().catch(() => undefined);
      };
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
    [role, sendSignal, viewerId],
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
          const viewerStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(() => null);
          if (viewerStream) localStreamRef.current = viewerStream;
          else toast.info("El Live se reproducirá sin micrófono. Puedes revisar los permisos del dispositivo.");
          await supabase.from("cupido_live_viewers").upsert({ room_id: roomId, user_id: viewerId });
          const offerPeer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
          peersRef.current.set(hostId, offerPeer);
          offerPeer.ontrack = (event) => {
            if (!remoteVideoRef.current) return;
            remoteVideoRef.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
            void remoteVideoRef.current.play().catch(() => undefined);
          };
          viewerStream?.getAudioTracks().forEach((track) => offerPeer.addTrack(track, viewerStream));
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
          const updatedRoom = payload.new as { is_live?: boolean };
          if (payload.eventType === "DELETE" || (payload.eventType === "UPDATE" && updatedRoom.is_live === false)) onEnded();
        },
      )
      .subscribe();

    const presenceChannel = supabase
      .channel(`cupido-live-presence-${roomId}-${viewerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on("presence", { event: "join" }, (payload) => {
        const joined = (payload.newPresences ?? []) as unknown as PresenceMeta[];
        for (const person of joined) {
          if (person.user_id === viewerId || person.role !== "viewer") continue;
          const name = person.display_name?.trim() || "Usuario";
          const message = `${name.startsWith("@") ? name : `@${name}`} se unió a la transmisión`;
          setJoinMessages((current) => [...current.slice(-4), message]);
        }
      })
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
          const { data: profile } = await supabase
            .from("cupido_public_profiles")
            .select("display_name")
            .eq("id", viewerId)
            .maybeSingle();
          await presenceChannel.track({
            user_id: viewerId,
            role,
            display_name: role === "host" ? hostName : profile?.display_name ?? "@Usuario",
            online_at: new Date().toISOString(),
          });
        }
      });

    const signalsChannel = supabase
      .channel(`cupido-live-signals-${roomId}-${viewerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

  useEffect(() => {
    let cancelled = false;
    const loadComments = async () => {
      const { data, error } = await supabase
        .from("live_comments")
        .select("id,stream_id,user_id,body,created_at")
        .eq("stream_id", roomId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((row) => row.user_id))];
      const profiles = ids.length
        ? await supabase.from("cupido_public_profiles").select("id,display_name").in("id", ids)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.display_name]));
      if (!cancelled) {
        setComments((current) => {
          const currentById = new Map(current.map((comment) => [comment.id, comment]));
          for (const row of data ?? []) {
            currentById.set(row.id, {
              ...row,
              display_name: names.get(row.user_id)?.trim() || "@Usuario",
            });
          }
          return [...currentById.values()].sort((left, right) => left.created_at.localeCompare(right.created_at)).slice(-100);
        });
      }
    };

    void loadComments().catch((error: unknown) => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : "No se pudo cargar el chat del Live.");
    });
    const channel = supabase
      .channel(`cupido-live-comments-${roomId}-${viewerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_comments", filter: `stream_id=eq.${roomId}` }, (payload) => {
        const row = payload.new as { id: string; stream_id: string; user_id: string; body: string; created_at: string };
        void supabase
          .from("cupido_public_profiles")
          .select("display_name")
          .eq("id", row.user_id)
          .maybeSingle()
          .then(({ data: profile }) => {
            if (cancelled) return;
            setComments((current) => current.some((comment) => comment.id === row.id)
              ? current
              : [...current, { ...row, display_name: profile?.display_name?.trim() || "@Usuario" }].slice(-100));
          });
      })
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [roomId, viewerId]);

  const sendLiveComment = async () => {
    const body = commentText.trim().slice(0, 500);
    if (!body || sendingComment) return;
    setSendingComment(true);
    try {
      const [{ data, error }, { data: profile }] = await Promise.all([
        supabase
          .from("live_comments")
          .insert({ stream_id: roomId, user_id: viewerId, body })
          .select("id,stream_id,user_id,body,created_at")
          .single(),
        supabase.from("cupido_public_profiles").select("display_name").eq("id", viewerId).maybeSingle(),
      ]);
      if (error) throw error;
      if (data) {
        setComments((current) => current.some((comment) => comment.id === data.id)
          ? current
          : [...current, { ...data, display_name: role === "host" ? hostName : profile?.display_name?.trim() || "@Usuario" }].slice(-100));
      }
      setCommentText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el comentario.");
    } finally {
      setSendingComment(false);
    }
  };

  const sendGift = async (gift: GiftType) => {
    if (!canSendGift(gift, account)) {
      toast.error(
        account.hasPurchased || account.isAdmin
          ? "No tienes monedas brillantes suficientes."
          : `Los regalos de más de ${FREE_GIFT_MAX_CREDITS} monedas requieren una recarga real.`,
      );
      return;
    }
    setSendingGift(true);
    const { data, error } = await supabase.rpc("cupido_send_live_gift", {
      _room: roomId,
      _receiver: hostId,
      _gift_id: gift.id,
      _credits: gift.credits,
      _cash_value: gift.cash,
    });
    setSendingGift(false);
    if (error || !data) {
      toast.error(giftErrorMessage(error?.message ?? "", "El servidor no confirmó el envío. Intenta de nuevo."));
      return;
    }
    account.refresh();
    toast.success(`Regalo ${gift.emoji} enviado a ${hostName} ❤️`);
  };

  const toggleMicrophone = () => {
    const next = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMicMuted(next);
  };

  const exitLive = () => {
    void showInterstitialAd();
    onClose();
  };

  const endLive = async () => {
    const { error } = await supabase.rpc("cupido_end_live_room", { _id: roomId });
    if (error) toast.error("No se pudo finalizar el Live.");
    else {
      void showInterstitialAd();
      onEnded();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && exitLive()}>
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
            muted={role === "host" || liveMuted}
            className="h-full w-full object-cover"
          />
          {role === "host" && <audio ref={remoteAudioRef} autoPlay playsInline muted={liveMuted} className="hidden" />}
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label={liveMuted ? "Activar sonido del Live" : "Silenciar Live"}
            title={liveMuted ? "Activar sonido" : "Silenciar"}
            onClick={() => setLiveMuted((value) => !value)}
            className="absolute right-3 top-3 rounded-full border-white/30 bg-black/70 text-white hover:bg-black/90"
          >
            {liveMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          <span className="absolute left-3 top-3 rounded-full bg-pink-600 px-2.5 py-1 text-xs font-bold text-white">
            ● EN VIVO
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant={micMuted ? "destructive" : "outline"} size="icon" onClick={toggleMicrophone} aria-label={micMuted ? "Activar micrófono" : "Silenciar micrófono"}>
            {micMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </Button>
          {role === "viewer" ? (
            <Button variant="destructive" onClick={exitLive} className="gap-2">
              <X className="size-4" /> Salir
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => void endLive()} className="gap-2">
              <PhoneOff className="size-4" /> Finalizar Live
            </Button>
          )}
        </div>
        <section className="rounded-2xl border border-white/10 bg-black/25 p-3" aria-label="Chat en vivo">
          <h3 className="mb-2 flex items-center gap-2 font-display text-base text-white">
            <MessageCircle className="size-4 text-pink-300" /> Chat del directo
          </h3>
          <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl bg-black/20 p-2" aria-live="polite">
            {joinMessages.map((message, index) => (
              <p key={`${message}-${index}`} className="rounded-full bg-pink-500/10 px-3 py-1 text-center text-[11px] text-pink-200">
                {message}
              </p>
            ))}
            {comments.map((comment) => (
              <p key={comment.id} className="break-words text-xs text-slate-200">
                <span className="font-semibold text-pink-200">{comment.display_name}</span> {comment.body}
              </p>
            ))}
            {!comments.length && !joinMessages.length && (
              <p className="py-4 text-center text-xs text-muted-foreground">Saluda para iniciar la conversación.</p>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={commentText}
              maxLength={500}
              onChange={(event) => setCommentText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendLiveComment();
                }
              }}
              placeholder="Escribe en el directo…"
              aria-label="Comentario para el directo"
            />
            <Button type="button" size="icon" onClick={() => void sendLiveComment()} disabled={sendingComment || !commentText.trim()} aria-label="Enviar comentario">
              {sendingComment ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </section>
        {role === "viewer" && (
          <div className="mt-3 rounded-2xl border border-pink-400/20 bg-pink-500/[0.06] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-display text-base text-white">
                <Gift className="size-4 text-pink-300" /> Regalos virtuales para {hostName}
              </p>
              <p className="flex items-center gap-1 text-xs text-amber-200">
                <CoinIcon className="size-3.5" />
                {account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}
              </p>
            </div>
            <GiftGrid compact onSelect={(gift) => void sendGift(gift)} disabled={sendingGift} />
            {account.balance < 10 && !account.isAdmin && (
              <Button asChild variant="outline" size="sm" className="mt-2 gap-1.5">
                <Link to="/tienda"><CreditCard className="size-3.5" /> Recargar monedas con PayPal</Link>
              </Button>
            )}
            {!account.hasPurchased && !account.isAdmin && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Puedes usar tus 500 créditos de bienvenida para regalos. Recarga para enviar regalos más caros.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
