import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, CreditCard, Flag, Gift, Heart, Loader2, MessageCircle, Mic, MicOff, PhoneOff, Radio, RefreshCw, Send, Shield, Swords, Users, Volume2, VolumeX, X, UserPlus, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { PayPalCheckoutButtons } from "@/components/cupido/paypal-checkout-buttons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@tanstack/react-router";
import { useAccount } from "@/lib/account";
import { canSendGift, giftErrorMessage, type Gift as GiftType } from "@/lib/cupido";
import { CREDIT_PACKAGES } from "@/lib/credits";
import { loadPaypalClientId } from "@/lib/paypal-public";
import { getPaypalCheckoutConfig } from "@/lib/payments.functions";
import { supabase } from "@/integrations/supabase/client";
import { type Json } from "@/integrations/supabase/types";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { blockUser, reportUser } from "@/lib/safety";
import { mediaPermissionMessage, requestNativeMediaPermissions } from "@/lib/native-media-permissions";
import { releaseLivePresenceCount } from "@/lib/use-live-presence-counts";

type LiveRoomProps = {
  roomId: string;
  hostId: string;
  hostName: string;
  hostAvatar?: string | undefined;
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

type StoredLiveSignal = {
  sender_id: string;
  receiver_id: string | null;
  payload: unknown;
};

function decodeLiveSignal(row: StoredLiveSignal): LiveSignal | null {
  if (!row.payload || typeof row.payload !== "object") return null;
  const payload = row.payload as Record<string, unknown>;
  const sender = row.sender_id;
  const receiver = row.receiver_id ?? undefined;
  const receiverField = receiver ? { receiver } : {};
  const kind = payload["kind"];
  if (!sender) return null;

  if (kind === "join") return { kind, sender, ...receiverField };
  if (kind === "end") return { kind, sender, ...receiverField };
  if ((kind === "offer" || kind === "answer") && payload["sdp"] && typeof payload["sdp"] === "object") {
    return { kind, sender, ...receiverField, sdp: payload["sdp"] as RTCSessionDescriptionInit };
  }
  if (kind === "ice" && payload["candidate"] && typeof payload["candidate"] === "object") {
    return { kind, sender, ...receiverField, candidate: payload["candidate"] as RTCIceCandidateInit };
  }
  return null;
}

type PresenceMeta = { user_id: string; role: "host" | "viewer"; display_name?: string };
type GiftAnimation = { id: number; emoji: string; name: string; sender: string };
type LiveComment = { id: string; stream_id: string; user_id: string; body: string; created_at: string; display_name: string; is_gran_liga: boolean };
type PkRequest = { id: string; room_id: string; host_id: string; requester_id: string; status: string; expires_at: string; requester_name?: string };

export function LiveRoom({
  roomId,
  hostId,
  hostName,
  hostAvatar = "",
  hostIsGranLiga = false,
  viewerId,
  role,
  onClose,
  onEnded,
  initialStream,
  premiumEndsAt,
}: LiveRoomProps) {
  const account = useAccount();
  const queryClient = useQueryClient();
  const privateCallPriceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const privateCallPrice = useQuery({
    queryKey: ["cupido-private-call-price", hostId],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_public_profiles").select("call_minute_price").eq("id", hostId).maybeSingle();
      if (error) throw error;
      return Number(data?.call_minute_price ?? 50);
    },
  });
  const liveEarnings = useQuery({
    queryKey: ["cupido-live-earnings", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cupido_get_live_earnings", { _room: roomId });
      if (error) throw error;
      const summary = data?.[0];
      return {
        coins: Number(summary?.received_coins ?? 0),
        usd: Number(summary?.usd_value ?? 0),
      };
    },
  });
  const updatePrivateCallPrice = useMutation({
    mutationFn: async (price: number) => {
      const { data, error } = await supabase.rpc("cupido_set_live_call_minute_price", { _room: roomId, _price: price });
      if (error) throw error;
      return data;
    },
    onSuccess: (price) => {
      queryClient.setQueryData(["cupido-private-call-price", hostId], price);
      void privateCallPriceChannelRef.current?.send({ type: "broadcast", event: "price-updated", payload: { price } });
      toast.success(`Tarifa privada actualizada: ${price} monedas por minuto.`);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-private-call-price", hostId] });
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el precio por minuto.");
    },
  });
  useEffect(() => {
    const channel = supabase.channel(`cupido-private-call-price-${hostId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "price-updated" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-private-call-price", hostId] });
      });
    privateCallPriceChannelRef.current = channel;
    void channel.subscribe();
    return () => {
      privateCallPriceChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [hostId, queryClient]);
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
  const [giftCheckoutOpen, setGiftCheckoutOpen] = useState(false);
  const [liveCheckoutPackageId, setLiveCheckoutPackageId] = useState<string | null>(null);
  const [giftPanelOpen, setGiftPanelOpen] = useState(false);
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
  const [liveHeartId, setLiveHeartId] = useState(0);
  const liveHeartTimerRef = useRef<number | null>(null);
  const [pkScores, setPkScores] = useState({ host: 0, challenger: 0 });
  const [liveMuted, setLiveMuted] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [viewers, setViewers] = useState(0);
  const [hostOnline, setHostOnline] = useState(false);
  const followed = useQuery({
    queryKey: ["cupido-live-follow", viewerId, hostId],
    enabled: role === "viewer" && viewerId !== hostId,
    queryFn: async () => {
      const { data, error } = await supabase.from("follows").select("following_id").eq("follower_id", viewerId).eq("following_id", hostId).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  });
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
  const moderationRequestPending = useRef(false);
  const paypalConfig = useQuery({
    queryKey: ["paypal-checkout-config"],
    enabled: Boolean(pendingGiftPurchase),
    queryFn: async () => {
      const config = await getPaypalCheckoutConfig();
      return { ...config, clientId: await loadPaypalClientId(config.clientId) };
    },
    staleTime: 30_000,
  });
  const liveCheckoutPackage = CREDIT_PACKAGES.find((pack) => pack.id === liveCheckoutPackageId);

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
    if (role !== "host") return;
    const sendHeartbeat = () => {
      void supabase.rpc("cupido_live_heartbeat", { _room: roomId });
    };
    sendHeartbeat();
    const heartbeat = window.setInterval(sendHeartbeat, 15_000);
    return () => window.clearInterval(heartbeat);
  }, [role, roomId]);

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
        if (error) return;
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
    let presenceChannel: ReturnType<typeof supabase.channel> | null = null;

    const start = async () => {
      try {
        if (role === "host") {
          if (!initialStream) await requestNativeMediaPermissions();
          const stream = initialStream ?? (await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: true }));
          if (disposed) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          localStreamRef.current = stream;
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
          for (const peerId of pendingJoinsRef.current) await createHostPeer(peerId);
          pendingJoinsRef.current = [];
        } else {
          let viewerStream: MediaStream | null = null;
          try {
            if (!navigator.mediaDevices?.getUserMedia) throw new Error("MEDIA_NOT_AVAILABLE");
            await requestNativeMediaPermissions({ camera: false, microphone: true });
            viewerStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          } catch {
            // Viewing remains available if a viewer declines the optional talk-back mic.
            toast.info("Entraste al Live sin micrófono. Puedes activarlo en los permisos de Android.");
          }
          if (viewerStream) localStreamRef.current = viewerStream;
          const { error: viewerError } = await supabase.from("cupido_live_viewers").insert({ room_id: roomId, user_id: viewerId });
          if (viewerError && viewerError.code !== "23505") throw viewerError;
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
        const message = mediaPermissionMessage(error) ?? (
          error instanceof Error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
            ? "Permite cámara y micrófono para iniciar el Live."
            : "No se pudo iniciar el video en vivo. Revisa permisos de cámara y micrófono.");
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
      .channel(`cupido-live-gifts-${roomId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "earnings-updated" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-earnings", roomId] });
      })
      .on("broadcast", { event: "gift" }, ({ payload }) => {
        const gift = payload as { emoji?: unknown; name?: unknown; sender?: unknown; points?: unknown; side?: unknown };
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-earnings", roomId] });
        const next: GiftAnimation = {
          id: Date.now(),
          emoji: typeof gift.emoji === "string" ? gift.emoji : "🎁",
          name: typeof gift.name === "string" ? gift.name : "Regalo",
          sender: typeof gift.sender === "string" ? gift.sender : "Un espectador",
        };
        setGiftAnimation(next);
        const points = typeof gift.points === "number" ? Math.max(1, Math.min(100, gift.points)) : 1;
        const side = gift.side === "host" ? "host" : "challenger";
        setPkScores((current) => ({ ...current, [side]: current[side] + points }));
        if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
        giftAnimationTimerRef.current = window.setTimeout(() => setGiftAnimation(null), 2800);
      })
      .on("broadcast", { event: "heart" }, ({ payload }) => {
        const heart = payload as { side?: unknown };
        const side = heart.side === "host" ? "host" : "challenger";
        setPkScores((current) => ({ ...current, [side]: current[side] + 1 }));
        setLiveHeartId(Date.now());
        if (liveHeartTimerRef.current !== null) window.clearTimeout(liveHeartTimerRef.current);
        liveHeartTimerRef.current = window.setTimeout(() => setLiveHeartId(0), 1800);
      })
      .subscribe();

    void (async () => {
      // The discovery/list Presence observer uses this topic too. Supabase reuses
      // topic instances, so wait for that observer to leave before adding room handlers.
      await releaseLivePresenceCount(roomId);
      if (disposed) return;

      const channel = supabase.channel(`cupido-live-presence-${roomId}`, { config: { presence: { key: viewerId } } });
      presenceChannel = channel;
      channel
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
          const state = channel.presenceState<PresenceMeta>();
          const ids = new Set<string>();
          let hostIsPresent = false;
          Object.values(state)
            .flat()
            .forEach((meta) => {
              if (meta.role === "host" && meta.user_id === hostId) hostIsPresent = true;
              if (meta.role !== "host" && meta.user_id) ids.add(meta.user_id);
            });
          setViewers(ids.size);
          setHostOnline(hostIsPresent);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            const { data: profile } = await supabase
              .from("cupido_public_profiles")
              .select("display_name")
              .eq("id", viewerId)
              .maybeSingle();
            await channel.track({
              user_id: viewerId,
              role,
              display_name: role === "host" ? hostName : profile?.display_name ?? "@Usuario",
              online_at: new Date().toISOString(),
            });
          }
        });
    })();

    const signalsChannel = supabase
      .channel((`cupido-live-signals-${roomId}-${viewerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`) + "-" + crypto.randomUUID())
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cupido_live_signals", filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const signal = decodeLiveSignal(payload.new as unknown as StoredLiveSignal);
          if (!signal || signal.sender === viewerId) return;
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
      if (presenceChannel) void supabase.removeChannel(presenceChannel);
      void supabase.removeChannel(signalsChannel);
      if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
      if (liveHeartTimerRef.current !== null) window.clearTimeout(liveHeartTimerRef.current);
    };
  }, [roomId, hostId, viewerId, role, onClose, onEnded, initialStream, createHostPeer, queryClient, sendSignal]);

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
      setPkScores({ host: 0, challenger: 0 });
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
    let disposed = false;
    const showAcceptedPk = async (row: PkRequest, resetScores = false) => {
      if (row.room_id !== roomId || row.host_id !== hostId || row.status !== "accepted") return;
      const { data } = await supabase.from("cupido_public_profiles").select("display_name").eq("id", row.requester_id).maybeSingle();
      if (disposed) return;
      setActivePkName(data?.display_name?.trim() || "Rival PK");
      setPkRequestId(row.id);
      setPkRequestStatus("accepted");
      if (resetScores) setPkScores({ host: 0, challenger: 0 });
    };
    const channel = supabase.channel(`cupido-pk-room-${roomId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cupido_pk_requests", filter: `room_id=eq.${roomId}` }, (payload) => {
        void showAcceptedPk(payload.new as PkRequest, true);
      })
      .subscribe();
    void supabase.from("cupido_pk_requests").select("id,room_id,host_id,requester_id,status,expires_at")
      .eq("room_id", roomId).eq("host_id", hostId).eq("status", "accepted")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (data) void showAcceptedPk(data as PkRequest); });
    return () => { disposed = true; void supabase.removeChannel(channel); };
  }, [hostId, roomId]);

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
        account.hasPurchased || account.isInfiniteCreditsAdmin
          ? "No tienes monedas brillantes suficientes."
          : "Confirma una recarga real para desbloquear tus monedas y enviar regalos.",
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
      toast.error(giftErrorMessage(error?.message ?? "", "No se pudo registrar el regalo. Comprueba tu saldo e inténtalo otra vez."));
      return;
    }
    await account.refresh();
    void queryClient.invalidateQueries({ queryKey: ["cupido-live-earnings", roomId] });
    setPendingGiftPurchase(null);
    setGiftPanelOpen(false);
    setGiftCheckoutOpen(false);
    setGiftAnimation({ id: Date.now(), emoji: gift.emoji, name: gift.name, sender: "Un espectador" });
    if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
    giftAnimationTimerRef.current = window.setTimeout(() => setGiftAnimation(null), 2800);
    const giftChannel = supabase.getChannels().find((channel) => channel.topic.includes(`cupido-live-gifts-${roomId}`));
    const side = "host";
    const points = Math.max(1, Math.min(100, Math.round(gift.credits / 50)));
    setPkScores((current) => ({ ...current, [side]: current[side] + points }));
    if (giftChannel) {
      void giftChannel.send({ type: "broadcast", event: "gift", payload: { emoji: gift.emoji, name: gift.name, sender: "Un espectador", side, points } });
    }
    toast.success(`Regalo ${gift.emoji} enviado a ${hostName} ❤️`);
  };

  const toggleFollow = async () => {
    if (!viewerId || viewerId === hostId) return;
    const result = followed.data
      ? await supabase.from("follows").delete().eq("follower_id", viewerId).eq("following_id", hostId)
      : await supabase.from("follows").insert({ follower_id: viewerId, following_id: hostId });
    if (result.error) { toast.error("No se pudo actualizar el seguimiento."); return; }
    await followed.refetch();
    toast.success(followed.data ? "Dejaste de seguir a este anfitrión." : "Ahora sigues a este anfitrión.");
  };

  const selectGift = (gift: GiftType) => {
    if (account.loading || account.balanceUnavailable) return;
    if (!canSendGift(gift, account)) {
      setPendingGiftPurchase(gift);
      const shortage = Math.max(gift.credits - account.balance, account.hasPurchased ? 0 : 1);
      const pack = CREDIT_PACKAGES.find((item) => item.credits >= shortage) ?? CREDIT_PACKAGES[CREDIT_PACKAGES.length - 1];
      setLiveCheckoutPackageId(pack?.id ?? null);
      setGiftPanelOpen(true);
      setGiftCheckoutOpen(true);
      return;
    }
    setPendingGiftPurchase(null);
    void sendGift(gift);
  };

  const sendLiveHeart = () => {
    const side = role === "host" ? "host" : "challenger";
    setPkScores((current) => ({ ...current, [side]: current[side] + 1 }));
    setLiveHeartId(Date.now());
    if (liveHeartTimerRef.current !== null) window.clearTimeout(liveHeartTimerRef.current);
    liveHeartTimerRef.current = window.setTimeout(() => setLiveHeartId(0), 1800);
    const channel = supabase.getChannels().find((item) => item.topic.includes(`cupido-live-gifts-${roomId}`));
    if (channel) void channel.send({ type: "broadcast", event: "heart", payload: { side, user_id: viewerId } });
  };

  const toggleMicrophone = () => {
    const next = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMicMuted(next);
  };

  const flipLiveCamera = async () => {
    const currentStream = localStreamRef.current;
    if (!currentStream) return;
    const nextFacingMode = facingMode === "user" ? "environment" : "user";
    let replacement: MediaStream | null = null;
    try {
      await requestNativeMediaPermissions({ camera: true, microphone: false });
      replacement = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacingMode } },
        audio: false,
      });
      const nextTrack = replacement.getVideoTracks()[0];
      if (!nextTrack) throw new Error("No se encontró la cámara solicitada.");
      const actualFacingMode = nextTrack.getSettings().facingMode;
      if (actualFacingMode && actualFacingMode !== nextFacingMode) {
        throw new Error("Este dispositivo no encontró esa cámara.");
      }

      const oldTrack = currentStream.getVideoTracks()[0];
      const senders = [...peersRef.current.values()].flatMap((peer) => peer.getSenders());
      await Promise.all(senders.filter((sender) => sender.track?.kind === "video").map((sender) => sender.replaceTrack(nextTrack)));
      if (oldTrack) {
        currentStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      currentStream.addTrack(nextTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = currentStream;
      setFacingMode(nextFacingMode);
      replacement = null;
    } catch (error) {
      toast.error(mediaPermissionMessage(error) ?? (error instanceof Error ? error.message : "No se pudo cambiar la cámara."));
    } finally {
      replacement?.getTracks().forEach((track) => track.stop());
    }
  };

  const exitLive = () => {
    onClose();
  };

  const endLive = async () => {
    const { error } = await supabase.rpc("cupido_end_live_room", { _id: roomId });
    if (error) toast.error("No se pudo finalizar el Live.");
    else {
      onEnded();
    }
  };

  useEffect(() => {
    const handleBack = (event: Event) => {
      event.preventDefault();
      if (role === "host") void endLive();
      else exitLive();
    };
    window.addEventListener("cupido:android-back", handleBack);
    return () => window.removeEventListener("cupido:android-back", handleBack);
  }, [role]);

  const reportHost = async () => {
    try {
      await reportUser(hostId, "Live reportado desde la sala en vivo");
      toast.success("Reporte enviado al equipo de moderación.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el reporte.");
    }
  };

  const blockHost = async () => {
    try {
      await blockUser(hostId);
      toast.success("Anfitrión bloqueado. El Live se cerrará para ti.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo bloquear al anfitrión.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && exitLive()}>
      <DialogContent className="!fixed !inset-y-0 !left-1/2 !top-0 !z-[80] !m-0 !mx-auto !h-[100dvh] !min-h-[100dvh] !max-h-[100dvh] !w-full !max-w-md !-translate-x-1/2 !translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 pt-10 text-white sm:!max-w-md">
        <DialogHeader className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-20 max-w-[72vw] rounded-2xl border border-white/15 bg-black/50 p-2.5 backdrop-blur-md">
          <DialogTitle className="flex items-center gap-2">
            <Avatar className="size-8 shrink-0 border border-pink-300/60"><AvatarImage src={hostAvatar} alt={hostName} /><AvatarFallback>{hostName.slice(0, 1) || "C"}</AvatarFallback></Avatar>
            <Radio className="size-5 animate-pulse text-pink-400" />
            {role === "host" ? "Tu Live está en vivo" : <>Live de <Link to="/perfil" search={{ userId: hostId }} className="hover:underline">{hostName}</Link></>}
            <span className="shrink-0 rounded-full bg-pink-600 px-2 py-0.5 text-[10px] font-bold text-white">EN VIVO</span>
            <VerifiedBadge granLiga={hostIsGranLiga} className="size-5" />
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1"><Users className="size-3.5" /> {viewers} viendo</span>
            {role === "viewer" && <span className={`flex items-center gap-1 ${hostOnline ? "text-emerald-300" : "text-white/65"}`}><span className={`size-1.5 rounded-full ${hostOnline ? "bg-emerald-400" : "bg-zinc-500"}`} />{hostOnline ? "En línea" : "Desconectado"}</span>}
            <span className="flex items-center gap-1"><CoinIcon className="size-3.5" /> Monedas brillantes activas</span>
            <span className="inline-flex flex-col rounded-xl border border-amber-300/25 bg-amber-400/10 px-2.5 py-1 text-amber-100" aria-live="polite">
              <span className="text-xs font-semibold">{liveEarnings.isError ? "—" : (liveEarnings.data?.coins ?? 0).toLocaleString("es")} monedas recibidas</span>
              <span className="text-[10px]">≈ US${liveEarnings.isError ? "—" : (liveEarnings.data?.usd ?? 0).toFixed(2)} USD</span>
            </span>
            {role === "viewer" && <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-amber-100">Privada: {privateCallPrice.data ?? 50} monedas/min</span>}
            {role === "viewer" && <Button type="button" size="sm" variant="outline" onClick={() => void toggleFollow()} className="h-7 gap-1 rounded-full border-white/30 bg-black/40 px-2 text-white">{followed.data ? <UserCheck className="size-3.5" /> : <UserPlus className="size-3.5" />}{followed.data ? "Siguiendo" : "Seguir"}</Button>}
            {!ready && <Loader2 className="size-3.5 animate-spin" />}
          </DialogDescription>
        </DialogHeader>
        {role === "host" && !activePkName && (
          <label className="absolute left-3 top-[calc(env(safe-area-inset-top)+8.5rem)] z-20 flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-black/75 px-3 py-2 text-[11px] font-semibold text-amber-100 backdrop-blur-md">
            Precio privado/min
            <select
              aria-label="Precio por minuto de llamada privada"
              value={privateCallPrice.data ?? 50}
              disabled={privateCallPrice.isLoading || updatePrivateCallPrice.isPending}
              onChange={(event) => updatePrivateCallPrice.mutate(Number(event.target.value))}
              className="h-8 rounded-lg border border-white/15 bg-zinc-900 px-2 text-xs text-white outline-none focus:ring-2 focus:ring-amber-300"
            >
              {[25, 50, 75, 100, 150, 200].map((price) => <option key={price} value={price}>{price} monedas</option>)}
            </select>
          </label>
        )}
        {activePkName && (
          <section className="absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+8.5rem)] z-20 rounded-2xl border border-white/15 bg-black/65 p-3 backdrop-blur-md" aria-live="polite">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-white">
              <span className="truncate text-rose-200">{role === "host" ? hostName : "Anfitrión"} · {pkScores.host.toLocaleString("es")}</span>
              <Swords className="size-4 shrink-0 text-amber-300" />
              <span className="truncate text-sky-200">{activePkName} · {pkScores.challenger.toLocaleString("es")}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-sky-500">
              <div className="bg-rose-500 transition-all duration-300" style={{ width: `${pkScores.host + pkScores.challenger ? (pkScores.host / (pkScores.host + pkScores.challenger)) * 100 : 50}%` }} />
            </div>
          </section>
        )}
        <div className="absolute inset-0 z-0 overflow-hidden bg-black">
          <video
            ref={role === "host" ? localVideoRef : remoteVideoRef}
            autoPlay
            playsInline
            webkit-playsinline="true"
            muted={role === "host" || liveMuted}
            className="h-full w-full object-cover"
            style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
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
          {liveHeartId > 0 && (
            <div key={liveHeartId} className="pointer-events-none absolute bottom-[30%] right-[18%] z-10 animate-in slide-in-from-bottom-8 fade-in duration-700 text-6xl drop-shadow-[0_0_18px_rgba(244,63,94,0.9)]" aria-hidden="true">❤️</div>
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
          {role === "host" && (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={facingMode === "user" ? "Cambiar a cámara trasera" : "Cambiar a cámara frontal"}
              title={facingMode === "user" ? "Cámara frontal" : "Cámara trasera"}
              onClick={() => void flipLiveCamera()}
              className="absolute right-14 top-[calc(env(safe-area-inset-top)+0.75rem)] rounded-full border-white/30 bg-black/70 text-white hover:bg-black/90"
            >
              <RefreshCw className="size-4" />
            </Button>
          )}
        </div>
        <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-20 flex flex-col gap-2">
          {role === "viewer" && <Button type="button" variant="outline" size="icon" onClick={sendLiveHeart} aria-label="Enviar corazón en vivo" className="rounded-full border-pink-300/50 bg-pink-600/80 text-white"><Heart className="size-4 fill-current" /></Button>}
          <Button variant={micMuted ? "destructive" : "outline"} size="icon" onClick={toggleMicrophone} aria-label={micMuted ? "Activar micrófono" : "Silenciar micrófono"} className="rounded-full border-white/30 bg-black/55 text-white">
            {micMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </Button>
          {role === "viewer" ? (
            <>
              <Button variant="outline" size="icon" onClick={() => void reportHost()} aria-label="Reportar anfitrión" className="rounded-full border-white/30 bg-black/55 text-white"><Flag className="size-4" /></Button>
              <Button variant="destructive" size="icon" onClick={() => void blockHost()} aria-label="Bloquear anfitrión" className="rounded-full"><Ban className="size-4" /></Button>
              <Button variant="destructive" size="icon" onClick={exitLive} aria-label="Salir" className="rounded-full"><X className="size-4" /></Button>
            </>
          ) : (
            <Button variant="destructive" size="icon" onClick={() => void endLive()} aria-label="Finalizar Live" className="rounded-full">
              <PhoneOff className="size-4" />
            </Button>
          )}
          <Button type="button" variant="outline" size="icon" aria-label="Manual de políticas de Cupido Leudy" title="Manual de políticas" onClick={() => toast.message("Manual de Políticas de Cupido Leudy ❤️", { description: "En llamadas y transmisiones públicas está prohibido fumar, beber alcohol, publicar números de teléfono, mostrar violencia o desnudez." })} className="rounded-full border-white/30 bg-black/55 text-white">
            <Shield className="size-4 text-sky-300" />
          </Button>
        </div>
        {role === "host" && pendingPk && (
          <section className="absolute inset-x-3 bottom-[calc(18rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/40 bg-black/75 p-3" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Swords className="size-4" /> {pendingPk.requester_name} solicita una Batalla PK · {pkSeconds}s</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void answerPk(true)}><Check className="mr-1 size-4" />Aceptar</Button>
              <Button size="sm" variant="outline" onClick={() => void answerPk(false)}><X className="mr-1 size-4" />Rechazar</Button>
            </div>
          </section>
        )}
        {role === "viewer" && (
          <section className="absolute bottom-[calc(18rem+env(safe-area-inset-bottom))] left-3 right-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-300/25 bg-black/65 p-2">
            <p className="flex items-center gap-2 text-sm text-violet-100"><Swords className="size-4" />{activePkName ? `Batalla PK 1 vs 1 contra ${activePkName}` : pkRequestStatus === "pending" ? `Solicitud PK enviada · ${pkSeconds}s` : pkRequestStatus === "accepted" ? "Batalla PK aceptada · 1 vs 1" : "Desafía al anfitrión a una batalla PK 1 vs 1"}</p>
            {!activePkName && pkRequestStatus !== "pending" && pkRequestStatus !== "accepted" && (
              <Button size="sm" variant="outline" disabled={(!pkProfile.data?.is_verified_blue && !pkProfile.data?.is_gran_liga) || pkProfile.isLoading} onClick={() => void requestPk()}>
                <Swords className="mr-1 size-4" /> Solicitar PK
              </Button>
            )}
            {!activePkName && pkRequestStatus === "pending" && <span className="text-xs text-violet-200">Esperando respuesta del anfitrión</span>}
          </section>
        )}
        <section className="absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] left-3 z-20 w-[min(70vw,26rem)] rounded-2xl border border-white/15 bg-black/45 p-2.5 backdrop-blur-md" aria-label="Chat en vivo">
          <h3 className="mb-1 flex items-center gap-2 font-display text-xs text-white">
            <MessageCircle className="size-4 text-pink-300" /> Chat del directo
          </h3>
          <div translate="no" className="max-h-[22dvh] space-y-1 overflow-y-auto rounded-xl bg-black/20 p-2" aria-live="polite">
            {joinMessages.map((message, index) => (
              <p key={`${message}-${index}`} className="rounded-full bg-pink-500/10 px-3 py-1 text-center text-[11px] text-pink-200">
                {message}
              </p>
            ))}
            {comments.map((comment) => (
              <p key={comment.id} className="break-words text-[11px] leading-snug text-slate-200">
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
        {role === "viewer" && <Button type="button" size="icon" onClick={() => {
          if (giftPanelOpen) {
            setGiftPanelOpen(false);
            setGiftCheckoutOpen(false);
          } else {
            setGiftPanelOpen(true);
          }
        }} aria-label="Abrir regalos" className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] right-3 z-30 size-12 rounded-full bg-pink-600 text-white shadow-lg shadow-pink-900/40"><Gift className="size-5" /></Button>}
        {role === "viewer" && (
          <Sheet open={giftPanelOpen} onOpenChange={(open) => {
            setGiftPanelOpen(open);
            if (!open) setGiftCheckoutOpen(false);
          }}>
            <SheetContent side="bottom" className="z-[90] max-h-[75dvh] w-full flex flex-col overflow-hidden rounded-t-3xl border-pink-400/30 bg-[#160b12] p-0 text-white shadow-2xl">
              <SheetHeader className="shrink-0 border-b border-white/10 px-4 py-3 pr-12 text-left">
                <div className="flex items-start gap-2">
                  {giftCheckoutOpen && <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-white" onClick={() => setGiftCheckoutOpen(false)} aria-label="Volver a los regalos"><ArrowLeft className="size-4" /></Button>}
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="flex items-center gap-2 text-white"><Gift className="size-4 shrink-0 text-pink-300" />{giftCheckoutOpen ? "Pago seguro" : `Regalos para ${hostName}`}</SheetTitle>
                    <SheetDescription className="mt-1 flex items-center gap-1 text-xs">
                      {giftCheckoutOpen ? "PayPal o tarjeta · recarga confirmada antes de enviar" : <><CoinIcon className="size-3.5" /> Saldo: {account.loading ? "…" : account.balanceUnavailable ? "—" : account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}</>}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-10">
                {!giftCheckoutOpen ? (
                  <>
                    <GiftGrid compact onSelect={selectGift} disabled={sendingGift || account.loading || account.balanceUnavailable} />
                    {pendingGiftPurchase && (() => {
                      const shortage = Math.max(pendingGiftPurchase.credits - account.balance, account.hasPurchased ? 0 : 1);
                      const recommendedPackage = CREDIT_PACKAGES.find((item) => item.credits >= shortage) ?? CREDIT_PACKAGES[CREDIT_PACKAGES.length - 1];
                      const readyToSend = canSendGift(pendingGiftPurchase, account);
                      return (
                        <section className="mt-3 space-y-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
                          <div>
                            <p className="font-semibold text-white">{readyToSend ? `${pendingGiftPurchase.name} está listo para enviar` : `Desbloquea ${pendingGiftPurchase.name}`}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{readyToSend ? "Envíalo ahora si quieres. Las monedas restantes se quedan en tu saldo." : `Paquete sugerido: ${recommendedPackage?.credits.toLocaleString("es")} monedas por US$${recommendedPackage?.price}.`}</p>
                          </div>
                          {readyToSend ? (
                            <Button type="button" className="w-full whitespace-normal px-3 py-2.5 text-center leading-tight" disabled={sendingGift} onClick={() => void sendGift(pendingGiftPurchase)}>
                              {sendingGift ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />} Enviar {pendingGiftPurchase.name}
                            </Button>
                          ) : (
                            <>
                              <Button type="button" className="w-full whitespace-normal px-3 py-2.5 text-center leading-tight" disabled={paypalConfig.isLoading || !paypalConfig.data?.configured} onClick={() => {
                                setLiveCheckoutPackageId(recommendedPackage?.id ?? null);
                                setGiftCheckoutOpen(true);
                              }}>
                                {paypalConfig.isLoading ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                                Recargar y continuar al pago
                              </Button>
                              {!account.isGranLiga && recommendedPackage?.id !== "gran-liga-100" && <Button type="button" variant="outline" className="w-full whitespace-normal px-3 py-2.5 text-center leading-tight" disabled={paypalConfig.isLoading || !paypalConfig.data?.configured} onClick={() => {
                                setLiveCheckoutPackageId("gran-liga-100");
                                setGiftCheckoutOpen(true);
                              }}>Elegir Diamante Gran Liga</Button>}
                              {!paypalConfig.isLoading && !paypalConfig.data?.configured && <p className="text-center text-xs text-amber-100/80">PayPal Business Live no está configurado.</p>}
                            </>
                          )}
                        </section>
                      );
                    })()}
                    {!account.loading && !account.balanceUnavailable && account.balance < 10 && !account.isInfiniteCreditsAdmin && <Button asChild variant="outline" size="sm" className="mt-3 w-full gap-1.5 whitespace-normal text-center"><Link to="/tienda"><CreditCard className="size-3.5" /> Recargar monedas con PayPal</Link></Button>}
                    {!account.hasPurchased && !account.isInfiniteCreditsAdmin && <p className="mt-2 text-center text-[11px] text-muted-foreground">Las 500 monedas de bienvenida se desbloquean después de una recarga real confirmada.</p>}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <p className="text-sm font-semibold text-white">{liveCheckoutPackage?.label ?? "Paquete"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{liveCheckoutPackage?.credits.toLocaleString("es")} monedas · US${liveCheckoutPackage?.price}</p>
                      {pendingGiftPurchase && <p className="mt-1 text-xs text-amber-100/80">Después del pago podrás enviar {pendingGiftPurchase.name}.</p>}
                    </div>
                    {paypalConfig.isLoading ? (
                      <p className="flex min-h-16 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Preparando PayPal…</p>
                    ) : paypalConfig.data?.configured && paypalConfig.data.clientId && liveCheckoutPackageId ? (
                      <PayPalCheckoutButtons
                        key={liveCheckoutPackageId}
                        clientId={paypalConfig.data.clientId}
                        packageId={liveCheckoutPackageId}
                        onSuccess={(credits) => {
                          account.addPurchasedCredits(credits);
                          void account.refresh().then(() => {
                            setGiftCheckoutOpen(false);
                            toast.success(liveCheckoutPackageId === "gran-liga-100"
                              ? "Gran Liga activada: 1.000.000 monedas, insignia VIP y privilegios desbloqueados."
                              : `${credits.toLocaleString("es")} monedas acreditadas. ${pendingGiftPurchase?.name ?? "El regalo"} está listo cuando quieras enviarlo.`);
                          }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Se acreditó el pago, pero no se pudo actualizar el saldo."));
                        }}
                        onError={(message) => toast.error(message)}
                      />
                    ) : (
                      <p className="text-center text-sm text-amber-100/80">PayPal Business Live no está configurado para completar el pago seguro.</p>
                    )}
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </DialogContent>
    </Dialog>
  );
}
