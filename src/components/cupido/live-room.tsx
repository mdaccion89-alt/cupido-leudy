import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CreditCard, Gift, Loader2, MessageCircle, Mic, MicOff, PhoneOff, Radio, Send, Shield, Swords, Users, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { PayPalCheckoutButtons } from "@/components/cupido/paypal-checkout-buttons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Link } from "@tanstack/react-router";
import { useAccount } from "@/lib/account";
import { showInterstitialAd } from "@/lib/admob";
import { canSendGift, FREE_GIFT_MAX_CREDITS, giftErrorMessage, type Gift as GiftType } from "@/lib/cupido";
import { CREDIT_PACKAGES } from "@/lib/credits";
import { getPaypalCheckoutConfig } from "@/lib/payments.functions";
import { supabase } from "@/integrations/supabase/client";
import { type Json } from "@/integrations/supabase/types";
import { VerifiedBadge } from "@/components/cupido/verified-badge";

type LiveRoomProps = {
  roomId: string;
  hostId: string;
  hostName: string;
  hostIsGranLiga?: boolean;
  viewerId: string;
  role: "host" | "viewer";
  onClose: () => void;
  onEnded: () => void;
  initialStream?: MediaStream | null;
  premiumEndsAt?: string | null;
};

type LiveSignal =
  | { kind: "join"; sender: string; receiver?: string }
  | { kind: "offer" | "answer"; sender: string; receiver?: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; sender: string; receiver?: string; candidate: RTCIceCandidateInit }
  | { kind: "end"; sender: string; receiver?: string };

type PresenceMeta = { user_id: string; role: "host" | "viewer"; display_name?: string };
type GiftAnimation = { id: number; emoji: string; name: string; sender: string };
type LiveComment = { id: string; stream_id: string; user_id: string; body: string; created_at: string; display_name: string; is_gran_liga: boolean };
type PkRequest = { id: string; room_id: string; host_id: string; requester_id: string; status: string; expires_at: string; requester_name?: string };

export function LiveRoom({
  roomId,
  hostId,
  hostName,
  hostIsGranLiga = false,
  viewerId,
  role,
  onClose,
  onEnded,
  initialStream,
  premiumEndsAt,
}: LiveRoomProps) {
  const account = useAccount();
  const pkProfile = useQuery({
    queryKey: ["cupido-pk-profile", viewerId],
    enabled: role === "viewer",
    queryFn: async () => {
      const { data, error } = await supabase.from("creator_profiles").select("is_verified_blue,is_gran_liga").eq("id", viewerId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [pendingGiftPurchase, setPendingGiftPurchase] = useState<GiftType | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const pendingJoinsRef = useRef<string[]>([]);
  const [ready, setReady] = useState(false);
  const [sendingGift, setSendingGift] = useState(false);
  const [giftAnimation, setGiftAnimation] = useState<GiftAnimation | null>(null);
  const giftAnimationTimerRef = useRef<number | null>(null);
  const [liveMuted, setLiveMuted] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [joinMessages, setJoinMessages] = useState<string[]>([]);
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [pendingPk, setPendingPk] = useState<PkRequest | null>(null);
  const [activePkName, setActivePkName] = useState<string | null>(null);
  const [pkRequestId, setPkRequestId] = useState<string | null>(null);
  const [pkRequestStatus, setPkRequestStatus] = useState<string | null>(null);
  const [pkSeconds, setPkSeconds] = useState(10);
  const expiredPkRef = useRef<string | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const moderationWarningShown = useRef(false);
  const moderationRequestPending = useRef(false);
  const paypalConfig = useQuery({
    queryKey: ["paypal-checkout-config"],
    enabled: Boolean(pendingGiftPurchase),
    queryFn: () => getPaypalCheckoutConfig(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (role !== "host" || !premiumEndsAt) return;
    const remaining = Math.max(0, new Date(premiumEndsAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      void supabase.rpc("cupido_end_live_room", { _id: roomId }).then(({ error }) => {
        if (error) toast.error("No se pudo cerrar el Live al terminar la tarifa.");
        else { toast.info("El tiempo del Live Premium terminó."); onEnded(); }
      });
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [onEnded, premiumEndsAt, role, roomId]);

  useEffect(() => {
    if (role !== "host" || premiumEndsAt) return;
    const checkFrame = async () => {
      if (moderationRequestPending.current) return;
      const video = localVideoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.round(video.videoHeight * (canvas.width / video.videoWidth));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      moderationRequestPending.current = true;
      try {
        const { data, error } = await supabase.functions.invoke("cupido-live-moderation", {
          body: { room_id: roomId, image: canvas.toDataURL("image/jpeg", 0.55) },
        });
        if (error) {
          if (!moderationWarningShown.current) {
            moderationWarningShown.current = true;
            toast.error("La revisión automática del Live no está disponible. Configura GEMINI_API_KEY en Supabase.");
          }
          return;
        }
        if (data?.closed) {
          toast.error("El Live se cerró automáticamente por seguridad. El Administrador recibió el reporte.");
          onEnded();
        }
      } finally {
        moderationRequestPending.current = false;
      }
    };
    const timer = window.setInterval(() => void checkFrame(), 15_000);
    return () => window.clearInterval(timer);
  }, [onEnded, premiumEndsAt, role, roomId]);

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
      .channel((`cupido-live-room-${roomId}`) + "-" + crypto.randomUUID())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cupido_live_rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const updatedRoom = payload.new as { is_live?: boolean };
          if (payload.eventType === "DELETE" || (payload.eventType === "UPDATE" && updatedRoom.is_live === false)) onEnded();
        },
      )
      .subscribe();

    const giftChannel = supabase
      .channel(`cupido-live-gifts-${roomId}-${crypto.randomUUID()}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "gift" }, ({ payload }) => {
        const gift = payload as { emoji?: unknown; name?: unknown; sender?: unknown };
        const next: GiftAnimation = {
          id: Date.now(),
          emoji: typeof gift.emoji === "string" ? gift.emoji : "🎁",
          name: typeof gift.name === "string" ? gift.name : "Regalo",
          sender: typeof gift.sender === "string" ? gift.sender : "Un espectador",
        };
        setGiftAnimation(next);
        if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
        giftAnimationTimerRef.current = window.setTimeout(() => setGiftAnimation(null), 2800);
      })
      .subscribe();

    const presenceChannel = supabase
      .channel((`cupido-live-presence-${roomId}-${viewerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`) + "-" + crypto.randomUUID())
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
      .channel((`cupido-live-signals-${roomId}-${viewerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`) + "-" + crypto.randomUUID())
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
      void supabase.removeChannel(giftChannel);
      void supabase.removeChannel(presenceChannel);
      void supabase.removeChannel(signalsChannel);
      if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
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
        ? await supabase.from("cupido_public_profiles").select("id,display_name,is_gran_liga").in("id", ids)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
      if (!cancelled) {
        setComments((current) => {
          const currentById = new Map(current.map((comment) => [comment.id, comment]));
          for (const row of data ?? []) {
            currentById.set(row.id, {
              ...row,
              display_name: names.get(row.user_id)?.display_name?.trim() || "@Usuario",
              is_gran_liga: Boolean(names.get(row.user_id)?.is_gran_liga),
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
      .channel((`cupido-live-comments-${roomId}-${viewerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_comments", filter: `stream_id=eq.${roomId}` }, (payload) => {
        const row = payload.new as { id: string; stream_id: string; user_id: string; body: string; created_at: string };
        void supabase
          .from("cupido_public_profiles")
          .select("display_name,is_gran_liga")
          .eq("id", row.user_id)
          .maybeSingle()
          .then(({ data: profile }) => {
            if (cancelled) return;
            setComments((current) => current.some((comment) => comment.id === row.id)
              ? current
              : [...current, { ...row, display_name: profile?.display_name?.trim() || "@Usuario", is_gran_liga: Boolean(profile?.is_gran_liga) }].slice(-100));
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
        supabase.from("cupido_public_profiles").select("display_name,is_gran_liga").eq("id", viewerId).maybeSingle(),
      ]);
      if (error) throw error;
      if (data) {
        setComments((current) => current.some((comment) => comment.id === data.id)
          ? current
          : [...current, { ...data, display_name: role === "host" ? hostName : profile?.display_name?.trim() || "@Usuario", is_gran_liga: Boolean(profile?.is_gran_liga) }].slice(-100));
      }
      setCommentText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el comentario.");
    } finally {
      setSendingComment(false);
    }
  };

  const answerPk = async (accept: boolean, requestId = pendingPk?.id) => {
    if (!requestId) return;
    const { data, error } = await supabase.rpc("cupido_respond_pk", { _request: requestId, _accept: accept });
    if (error) { toast.error(error.message); return; }
    if (data === "expired") toast.info("La solicitud PK venció y fue rechazada.");
    else if (data === "accepted") {
      toast.success("Solicitud PK aceptada. La batalla 1 vs 1 está lista.");
      setActivePkName(pendingPk?.requester_name ?? "Rival PK");
    }
    else if (data === "rejected") toast.info("Solicitud PK rechazada.");
    setPendingPk(null);
  };

  const requestPk = async () => {
    if (!pkProfile.data?.is_verified_blue && !pkProfile.data?.is_gran_liga) {
      toast.error("Para solicitar una Batalla PK necesitas Insignia Azul o Gran Liga.");
      return;
    }
    const { data, error } = await supabase.rpc("cupido_request_pk", { _room: roomId });
    if (error) { toast.error(error.message); return; }
    setPkRequestId(data);
    setPkRequestStatus("pending");
    setPkSeconds(10);
    toast.success("Solicitud PK enviada. El anfitrión tiene 10 segundos para responder.");
  };

  useEffect(() => {
    if (role !== "host") return;
    let disposed = false;
    const receive = (row: PkRequest) => {
      if (row.host_id !== viewerId || row.status !== "pending") return;
      void supabase.from("cupido_public_profiles").select("display_name").eq("id", row.requester_id).maybeSingle()
        .then(({ data }) => { if (!disposed) setPendingPk({ ...row, requester_name: data?.display_name?.trim() || "@Usuario" }); });
    };
    const channel = supabase.channel(`cupido-pk-host-${roomId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cupido_pk_requests", filter: `room_id=eq.${roomId}` }, (payload) => receive(payload.new as PkRequest))
      .subscribe();
    void supabase.from("cupido_pk_requests").select("id,room_id,host_id,requester_id,status,expires_at")
      .eq("room_id", roomId).eq("host_id", viewerId).eq("status", "pending").gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true }).limit(1).maybeSingle()
      .then(async ({ data }) => { if (data) receive(data as PkRequest); });
    return () => { disposed = true; void supabase.removeChannel(channel); };
  }, [roomId, role, viewerId]);

  useEffect(() => {
    if (!pendingPk) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((new Date(pendingPk.expires_at).getTime() - Date.now()) / 1000));
      setPkSeconds(seconds);
      if (seconds === 0 && expiredPkRef.current !== pendingPk.id) {
        expiredPkRef.current = pendingPk.id;
        void answerPk(false, pendingPk.id);
      }
    };
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [pendingPk]);

  useEffect(() => {
    if (!pkRequestId || role !== "viewer") return;
    const channel = supabase.channel(`cupido-pk-requester-${pkRequestId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cupido_pk_requests", filter: `id=eq.${pkRequestId}` }, (payload) => {
        const status = String((payload.new as PkRequest).status);
        setPkRequestStatus(status);
        if (status !== "pending") toast.message(status === "accepted" ? "Solicitud PK aceptada" : status === "expired" ? "La solicitud PK venció" : "Solicitud PK rechazada");
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [pkRequestId, role]);

  useEffect(() => {
    if (!pkRequestId || pkRequestStatus !== "pending" || role !== "viewer") return;
    const interval = window.setInterval(() => setPkSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [pkRequestId, pkRequestStatus, role]);

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
    const { error } = await supabase.rpc("cupido_send_live_gift", {
      _room: roomId,
      _receiver: hostId,
      _gift_id: gift.id,
      _credits: gift.credits,
      _cash_value: gift.cash,
    });
    setSendingGift(false);
    if (error) {
      toast.error(giftErrorMessage(error?.message ?? "", "El servidor no confirmó el envío. Intenta de nuevo."));
      return;
    }
    account.refresh();
    setPendingGiftPurchase(null);
    setGiftAnimation({ id: Date.now(), emoji: gift.emoji, name: gift.name, sender: "Un espectador" });
    if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
    giftAnimationTimerRef.current = window.setTimeout(() => setGiftAnimation(null), 2800);
    const giftChannel = supabase.getChannels().find((channel) => channel.topic.includes(`cupido-live-gifts-${roomId}`));
    if (giftChannel) {
      void giftChannel.send({ type: "broadcast", event: "gift", payload: { emoji: gift.emoji, name: gift.name, sender: "Un espectador" } });
    }
    toast.success(`Regalo ${gift.emoji} enviado a ${hostName} ❤️`);
  };

  const selectGift = (gift: GiftType) => {
    if (account.loading || account.balanceUnavailable) return;
    if (!canSendGift(gift, account)) {
      setPendingGiftPurchase(gift);
      return;
    }
    setPendingGiftPurchase(null);
    void sendGift(gift);
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
            {role === "host" ? "Tu Live está en vivo" : <>Live de <Link to="/perfil" search={{ userId: hostId }} className="hover:underline">{hostName}</Link></>}
            <VerifiedBadge granLiga={hostIsGranLiga} className="size-5" />
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
          {giftAnimation && (
            <div key={giftAnimation.id} className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center" aria-live="polite">
              <div className="animate-in slide-in-from-bottom-4 fade-in duration-300 rounded-full border border-pink-300/50 bg-black/75 px-5 py-3 text-center text-white shadow-xl shadow-pink-500/20">
                <span className="block animate-bounce text-5xl leading-none">{giftAnimation.emoji}</span>
                <span className="mt-2 block text-sm font-bold">{giftAnimation.sender} envió {giftAnimation.name} ❤️</span>
              </div>
            </div>
          )}
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
          <Button type="button" variant="outline" size="icon" aria-label="Manual de políticas de Cupido Leudy" title="Manual de políticas" onClick={() => toast.message("Manual de Políticas de Cupido Leudy ❤️", { description: "En llamadas y transmisiones públicas está prohibido fumar, beber alcohol, publicar números de teléfono, mostrar violencia o desnudez." })}>
            <Shield className="size-4 text-sky-300" />
          </Button>
        </div>
        {role === "host" && pendingPk && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/10 p-3" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Swords className="size-4" /> {pendingPk.requester_name} solicita una Batalla PK · {pkSeconds}s</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void answerPk(true)}><Check className="mr-1 size-4" />Aceptar</Button>
              <Button size="sm" variant="outline" onClick={() => void answerPk(false)}><X className="mr-1 size-4" />Rechazar</Button>
            </div>
          </section>
        )}
        {role === "viewer" && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-300/25 bg-violet-500/[0.06] p-3">
            <p className="flex items-center gap-2 text-sm text-violet-100"><Swords className="size-4" />{activePkName ? `Batalla PK 1 vs 1 contra ${activePkName}` : pkRequestStatus === "pending" ? `Solicitud PK enviada · ${pkSeconds}s` : pkRequestStatus === "accepted" ? "Batalla PK aceptada · 1 vs 1" : "Desafía al anfitrión a una batalla PK 1 vs 1"}</p>
            {!activePkName && pkRequestStatus !== "pending" && pkRequestStatus !== "accepted" && (
              <Button size="sm" variant="outline" disabled={(!pkProfile.data?.is_verified_blue && !pkProfile.data?.is_gran_liga) || pkProfile.isLoading} onClick={() => void requestPk()}>
                <Swords className="mr-1 size-4" /> Solicitar PK
              </Button>
            )}
            {!activePkName && pkRequestStatus === "pending" && <span className="text-xs text-violet-200">Esperando respuesta del anfitrión</span>}
          </section>
        )}
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
                <Link to="/perfil" search={{ userId: comment.user_id }} className="font-semibold text-pink-200 hover:underline">{comment.display_name}</Link> <VerifiedBadge granLiga={comment.is_gran_liga} className="inline size-3 align-text-bottom" /> {comment.body}
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
                {account.loading ? "..." : account.balanceUnavailable ? "—" : account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}
              </p>
            </div>
            <GiftGrid compact onSelect={selectGift} disabled={sendingGift || account.loading || account.balanceUnavailable} />
            {pendingGiftPurchase && (() => {
              const shortage = Math.max(pendingGiftPurchase.credits - account.balance, !account.hasPurchased && pendingGiftPurchase.credits > FREE_GIFT_MAX_CREDITS ? 1 : 0);
              const pack = CREDIT_PACKAGES.find((item) => item.credits >= shortage) ?? CREDIT_PACKAGES[CREDIT_PACKAGES.length - 1];
              const readyToSend = canSendGift(pendingGiftPurchase, account);
              return (
                <section className="mt-3 space-y-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
                  <div>
                    <p className="font-semibold text-white">{readyToSend ? `${pendingGiftPurchase.name} está listo para enviar` : `Desbloquea ${pendingGiftPurchase.name}`}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{readyToSend ? "Envíalo ahora si quieres. Las monedas restantes se quedan en tu saldo." : `Compra ${pack?.credits.toLocaleString("es")} monedas por US$${pack?.price}. Tú decides si envías el regalo; el saldo no gastado permanece disponible.`}</p>
                  </div>
                  {readyToSend ? (
                    <Button type="button" className="w-full" disabled={sendingGift} onClick={() => void sendGift(pendingGiftPurchase)}>
                      {sendingGift ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />} Enviar {pendingGiftPurchase.name}
                    </Button>
                  ) : paypalConfig.isLoading ? (
                    <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Preparando compra segura...</p>
                  ) : paypalConfig.data?.configured && paypalConfig.data.clientId && pack ? (
                    <PayPalCheckoutButtons
                      clientId={paypalConfig.data.clientId}
                      packageId={pack.id}
                      onSuccess={(credits) => {
                        account.addPurchasedCredits(credits);
                        void account.refresh();
                        toast.success(`${credits.toLocaleString("es")} monedas acreditadas. ${pendingGiftPurchase.name} está listo cuando quieras enviarlo.`);
                      }}
                      onError={(message) => toast.error(message)}
                    />
                  ) : (
                    <p className="text-center text-sm text-muted-foreground">PayPal no está configurado para completar la compra desde aquí.</p>
                  )}
                  {!account.isGranLiga && pack?.id !== "gran-liga-100" && (
                    <div className="space-y-2 rounded-xl border border-amber-300/30 bg-amber-400/[0.06] p-3">
                      <p className="text-sm font-semibold text-amber-100">Diamante Gran Liga ? 1.000.000 monedas ? US$100</p>
                      {paypalConfig.data?.configured && paypalConfig.data.clientId ? <PayPalCheckoutButtons clientId={paypalConfig.data.clientId} packageId="gran-liga-100" onSuccess={(credits) => { account.addPurchasedCredits(credits); void account.refresh(); toast.success("Gran Liga activada: 1.000.000 monedas, insignia VIP y privilegios desbloqueados."); }} onError={(message) => toast.error(message)} /> : <p className="text-xs text-amber-100/80">Activa PayPal Business en /admin para confirmar el pago y acreditar Gran Liga autom?ticamente.</p>}
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><CreditCard className="size-3.5" /> PayPal o tarjeta de débito/crédito</div>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setPendingGiftPurchase(null)}>Volver a los regalos</Button>
                </section>
              );
            })()}
            {!account.loading && !account.balanceUnavailable && account.balance < 10 && !account.isAdmin && (
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
