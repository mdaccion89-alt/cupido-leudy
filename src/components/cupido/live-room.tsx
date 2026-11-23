import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, CreditCard, Crown, Flag, Gift, Heart, Loader2, MessageCircle, Mic, MicOff, PhoneOff, Radio, RefreshCw, Send, Shield, Swords, Users, Volume2, VolumeX, X, UserPlus, UserCheck, Trophy, Dices } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { PayPalCheckoutButtons } from "@/components/cupido/paypal-checkout-buttons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@tanstack/react-router";
import { useAccount } from "@/lib/account";
import { canSendGift, giftErrorMessage, GIFTS, type Gift as GiftType } from "@/lib/cupido";
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
import { useWeeklyRankingData } from "@/components/cupido/weekly-ranking";

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

type PresenceMeta = { user_id: string; role: "host" | "viewer"; display_name?: string; is_club_vip?: boolean };
type GiftAnimation = { id: number; emoji: string; name: string; sender: string; coins: number };
type LiveComment = { id: string; stream_id: string; user_id: string; body: string; created_at: string; display_name: string; is_gran_liga: boolean; is_club_vip?: boolean; vip_creator_name?: string; is_moderator?: boolean };
type PkRequest = { id: string; room_id: string; host_id: string; requester_id: string; status: string; expires_at: string; requester_name?: string };
type GuestSeat = { id: string; room_id: string; guest_id: string; invited_by: string | null; status: "requested" | "invited" | "accepted" | "rejected" | "ended"; created_at: string };
type OnlineViewer = { user_id: string; display_name: string; is_club_vip: boolean };
type RouletteSpin = { id: string; prize: string; prize_index: number; spun_by: string; created_at: string };

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
  const coinGoal = useQuery({
    queryKey: ["cupido-live-coin-goal", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_live_rooms").select("coin_goal").eq("id", roomId).maybeSingle();
      if (error) throw error;
      return Number(data?.coin_goal ?? 0);
    },
  });
  const liveGiftTotal = useQuery({
    queryKey: ["cupido-live-gift-total", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cupido_get_live_gift_total", { _room: roomId });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
  const topFans = useQuery({
    queryKey: ["cupido-live-top-fans", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cupido_get_live_top_fans", { _room: roomId });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });
  const topFanRows = topFans.data ?? [];
  const pkState = useQuery({
    queryKey: ["cupido-live-pk-state", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cupido_get_live_pk_state", { _room: roomId });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    refetchInterval: 5_000,
  });
  const activePkChallengerIdRef = useRef<string | null>(null);
  useEffect(() => {
    activePkChallengerIdRef.current = pkState.data && !pkState.data.finished_at && pkState.data.seconds_left > 0 ? pkState.data.challenger_id : null;
  }, [pkState.data]);
  const treasure = useQuery({
    queryKey: ["cupido-live-treasure", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_live_treasures").select("id,expires_at").eq("room_id", roomId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const weeklyRanking = useWeeklyRankingData();
  const senderProfile = useQuery({
    queryKey: ["cupido-live-sender-profile", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_public_profiles").select("display_name").eq("id", viewerId).maybeSingle();
      if (error) throw error;
      return data;
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
      const { data, error } = await supabase.from("creator_profiles").select("is_verified_blue,is_gran_liga,is_premium").eq("id", viewerId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const clubSubscribers = useQuery({
    queryKey: ["cupido-live-club-subscribers", hostId],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_creator_club_subscriptions")
        .select("fan_id,expires_at").eq("creator_id", hostId).gt("expires_at", new Date().toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });
  const creatorClub = useQuery({
    queryKey: ["cupido-creator-club", hostId],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_creator_clubs").select("monthly_price").eq("creator_id", hostId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const guestSeat = useQuery({
    queryKey: ["cupido-live-guest-seat", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_live_guest_sessions")
        .select("id,room_id,guest_id,invited_by,status,created_at")
        .eq("room_id", roomId).in("status", ["invited", "accepted"]).maybeSingle();
      if (error) throw error;
      return data as GuestSeat | null;
    },
  });
  const myGuestRequest = useQuery({
    queryKey: ["cupido-live-my-guest-request", roomId, viewerId],
    enabled: role === "viewer",
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_live_guest_sessions")
        .select("id,room_id,guest_id,invited_by,status,created_at")
        .eq("room_id", roomId).eq("guest_id", viewerId).eq("status", "requested")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as GuestSeat | null;
    },
  });
  const guestRequests = useQuery({
    queryKey: ["cupido-live-guest-requests", roomId],
    enabled: role === "host",
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_live_guest_sessions")
        .select("id,room_id,guest_id,invited_by,status,created_at")
        .eq("room_id", roomId).eq("status", "requested").order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as GuestSeat[];
    },
  });
  const rouletteConfig = useQuery({
    queryKey: ["cupido-live-roulette-config", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_live_roulette_configs")
        .select("trigger_gift_id,prizes,enabled").eq("room_id", roomId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const roomModerators = useQuery({
    queryKey: ["cupido-live-moderators", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_live_room_moderators")
        .select("moderator_id").eq("room_id", roomId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const moderatorIds = new Set((roomModerators.data ?? []).map((row) => row.moderator_id));
  const isRoomModerator = role === "host" || moderatorIds.has(viewerId);
  const isClubVip = (clubSubscribers.data ?? []).some((row) => row.fan_id === viewerId);
  const activeGuestId = guestSeat.data?.status === "accepted" ? guestSeat.data.guest_id : null;
  const [pendingGiftPurchase, setPendingGiftPurchase] = useState<GiftType | null>(null);
  const [giftCheckoutOpen, setGiftCheckoutOpen] = useState(false);
  const [liveCheckoutPackageId, setLiveCheckoutPackageId] = useState<string | null>(null);
  const [giftPanelOpen, setGiftPanelOpen] = useState(false);
  const [guestToolsOpen, setGuestToolsOpen] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [clubOpen, setClubOpen] = useState(false);
  const [rouletteDraft, setRouletteDraft] = useState("");
  const [rouletteGiftId, setRouletteGiftId] = useState("");
  const [rouletteSpin, setRouletteSpin] = useState<RouletteSpin | null>(null);
  const [rouletteRotation, setRouletteRotation] = useState(0);
  const [seatBusy, setSeatBusy] = useState(false);
  const [moderationBusyId, setModerationBusyId] = useState<string | null>(null);
  const [onlineViewers, setOnlineViewers] = useState<OnlineViewer[]>([]);
  const guestLocalVideoRef = useRef<HTMLVideoElement>(null);
  const guestRemoteVideoRef = useRef<HTMLVideoElement>(null);
  const guestStreamIdRef = useRef<string | null>(null);
  const activeGuestIdRef = useRef<string | null>(null);
  const guestCameraStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pkRemoteVideoRef = useRef<HTMLVideoElement>(null);
  const pkLocalVideoRef = useRef<HTMLVideoElement>(null);
  const pkCameraStreamRef = useRef<MediaStream | null>(null);
  const pkStreamIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const pendingJoinsRef = useRef<string[]>([]);
  const [ready, setReady] = useState(false);
  const [sendingGift, setSendingGift] = useState(false);
  const [giftAnimation, setGiftAnimation] = useState<GiftAnimation | null>(null);
  const [highValueGift, setHighValueGift] = useState<{ sender: string; name: string; coins: number } | null>(null);
  const giftAnimationTimerRef = useRef<number | null>(null);
  const highValueGiftTimerRef = useRef<number | null>(null);
  const entryNoticeTimerRef = useRef<number | null>(null);
  const [floatingHearts, setFloatingHearts] = useState<Array<{ id: number; right: number }>>([]);
  const lastHeartAt = useRef(0);
  const [entryNotice, setEntryNotice] = useState("");
  const [pkRemaining, setPkRemaining] = useState(0);
  const [goalInput, setGoalInput] = useState("");
  const [rankingOpen, setRankingOpen] = useState(false);
  const [treasureSeconds, setTreasureSeconds] = useState(0);
  const [pkSide, setPkSide] = useState<"host" | "challenger">("host");
  const [treasureBusy, setTreasureBusy] = useState(false);
  const [goalCelebration, setGoalCelebration] = useState(false);
  const goalCelebratedRef = useRef(false);
  const pkFinishStartedRef = useRef(false);
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
  const joinMessages: string[] = [];
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
    activeGuestIdRef.current = activeGuestId;
    if (!activeGuestId) guestStreamIdRef.current = null;
  }, [activeGuestId]);

  useEffect(() => {
    if (role === "viewer" && guestSeat.data?.guest_id === viewerId && guestSeat.data.status === "invited") {
      setGuestToolsOpen(true);
    }
  }, [guestSeat.data, role, viewerId]);

  useEffect(() => {
    if (!rouletteConfig.data) return;
    setRouletteGiftId(rouletteConfig.data.trigger_gift_id);
    setRouletteDraft((rouletteConfig.data.prizes ?? []).join("\n"));
  }, [rouletteConfig.data]);

  const guestRequestProfiles = useQuery({
    queryKey: ["cupido-live-guest-request-profiles", roomId, guestRequests.data?.map((request) => request.guest_id).join(",")],
    enabled: role === "host" && Boolean(guestRequests.data?.length),
    queryFn: async () => {
      const ids = [...new Set((guestRequests.data ?? []).map((request) => request.guest_id))];
      if (!ids.length) return [];
      const { data, error } = await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url").in("id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const refreshRoomState = () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-live-guest-seat", roomId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-live-my-guest-request", roomId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-live-guest-requests", roomId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-live-roulette-config", roomId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-live-moderators", roomId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-live-club-subscribers", hostId] });
    };
    const channel = supabase.channel(`cupido-live-tools-${roomId}-${viewerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_live_guest_sessions", filter: `room_id=eq.${roomId}` }, refreshRoomState)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_live_roulette_configs", filter: `room_id=eq.${roomId}` }, refreshRoomState)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cupido_live_roulette_spins", filter: `room_id=eq.${roomId}` }, (payload) => {
        const spin = payload.new as RouletteSpin;
        setRouletteSpin(spin);
        setRouletteRotation((value) => value + 360 * 5 + (360 - spin.prize_index * 60));
        window.setTimeout(() => setRouletteSpin((current) => current?.id === spin.id ? null : current), 5000);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_live_room_moderators", filter: `room_id=eq.${roomId}` }, refreshRoomState)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_creator_club_subscriptions", filter: `creator_id=eq.${hostId}` }, refreshRoomState)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [hostId, queryClient, roomId, viewerId]);

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
        if (role !== "host") return;
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        if (event.track.kind === "audio") {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = stream;
            void remoteAudioRef.current.play().catch(() => undefined);
          }
          return;
        }
        const isGuestVideo = event.track.kind === "video" && peerId === activeGuestIdRef.current;
        const isPkVideo = event.track.kind === "video" && peerId === activePkChallengerIdRef.current;
        if (!isGuestVideo && !isPkVideo) return;
        if (isGuestVideo) {
          guestStreamIdRef.current = stream.id;
          if (guestRemoteVideoRef.current) {
            guestRemoteVideoRef.current.srcObject = stream;
            void guestRemoteVideoRef.current.play().catch(() => undefined);
          }
        } else if (pkRemoteVideoRef.current) {
          pkRemoteVideoRef.current.srcObject = stream;
          void pkRemoteVideoRef.current.play().catch(() => undefined);
        }
        const gifts = supabase.getChannels().find((channel) => channel.topic.includes(`cupido-live-gifts-${roomId}`));
        if (gifts) void gifts.send({ type: "broadcast", event: isGuestVideo ? "guest-stream-id" : "pk-stream-id", payload: { stream_id: stream.id } });
        for (const [viewerPeerId, viewerPeer] of peersRef.current) {
          if (viewerPeerId === peerId || viewerPeer.signalingState !== "stable") continue;
          try {
            const tracks = isGuestVideo ? stream.getTracks() : [event.track];
            let changed = false;
            for (const track of tracks) {
              if (viewerPeer.getSenders().some((sender) => sender.track === track)) continue;
              viewerPeer.addTrack(track, stream);
              changed = true;
            }
            if (changed) void viewerPeer.createOffer().then(async (offer) => {
              await viewerPeer.setLocalDescription(offer);
              await sendSignal({ kind: "offer", sender: viewerId, receiver: viewerPeerId, sdp: offer });
            });
          } catch { /* a viewer connection may be closing */ }
        }
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
    [role, roomId, sendSignal, viewerId],
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
            const stream = event.streams[0] ?? new MediaStream([event.track]);
            const target = stream.id === guestStreamIdRef.current
              ? guestRemoteVideoRef.current
              : stream.id === pkStreamIdRef.current ? pkRemoteVideoRef.current : remoteVideoRef.current;
            if (!target) return;
            target.srcObject = stream;
            void target.play().catch(() => undefined);
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
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-gift-total", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-top-fans", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-pk-state", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-coin-goal", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-weekly-ranking"] });
      })
      .on("broadcast", { event: "gift" }, ({ payload }) => {
        const gift = payload as { emoji?: unknown; name?: unknown; sender?: unknown; points?: unknown; coins?: unknown; side?: unknown };
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-earnings", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-gift-total", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-top-fans", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-pk-state", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-coin-goal", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-weekly-ranking"] });
        const coins = typeof gift.coins === "number" ? gift.coins : typeof gift.points === "number" ? gift.points : 0;
        const next: GiftAnimation = {
          id: Date.now(),
          emoji: typeof gift.emoji === "string" ? gift.emoji : "🎁",
          name: typeof gift.name === "string" ? gift.name : "Regalo",
          sender: typeof gift.sender === "string" ? gift.sender : "Un espectador",
          coins,
        };
        setGiftAnimation(next);
        if (coins >= 300) {
          setHighValueGift({ sender: next.sender, name: next.name, coins });
          if (highValueGiftTimerRef.current !== null) window.clearTimeout(highValueGiftTimerRef.current);
          highValueGiftTimerRef.current = window.setTimeout(() => setHighValueGift(null), 7000);
        }
        if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
        giftAnimationTimerRef.current = window.setTimeout(() => setGiftAnimation(null), 3500);
      })
      .on("broadcast", { event: "heart" }, ({ payload }) => {
        const heart = payload as { id?: unknown; right?: unknown };
        const id = typeof heart.id === "number" ? heart.id : Date.now() + Math.random();
        const right = typeof heart.right === "number" ? heart.right : 8 + Math.random() * 14;
        setFloatingHearts((current) => [...current.slice(-12), { id, right }]);
        window.setTimeout(() => setFloatingHearts((current) => current.filter((item) => item.id !== id)), 2200);
      })
      .on("broadcast", { event: "pk-stream-id" }, ({ payload }) => {
        const value = payload as { stream_id?: unknown };
        if (typeof value.stream_id === "string") {
          pkStreamIdRef.current = value.stream_id;
        }
      })
      .on("broadcast", { event: "guest-stream-id" }, ({ payload }) => {
        const value = payload as { stream_id?: unknown };
        if (typeof value.stream_id === "string") guestStreamIdRef.current = value.stream_id;
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
            void supabase.from("cupido_public_profiles").select("is_verified_blue,is_gran_liga,is_premium").eq("id", person.user_id).maybeSingle().then(({ data }) => {
              if (!data || (!data.is_verified_blue && !data.is_gran_liga && !data.is_premium)) return;
              setEntryNotice(`✨ ${name} entró a la sala`);
              if (entryNoticeTimerRef.current !== null) window.clearTimeout(entryNoticeTimerRef.current);
              entryNoticeTimerRef.current = window.setTimeout(() => setEntryNotice(""), 3000);
            });
          }
        })
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<PresenceMeta>();
          const ids = new Set<string>();
          const viewersNow: OnlineViewer[] = [];
          let hostIsPresent = false;
          Object.values(state)
            .flat()
            .forEach((meta) => {
              if (meta.role === "host" && meta.user_id === hostId) hostIsPresent = true;
              if (meta.role !== "host" && meta.user_id) {
                ids.add(meta.user_id);
                viewersNow.push({ user_id: meta.user_id, display_name: meta.display_name?.trim() || "@Usuario", is_club_vip: Boolean(meta.is_club_vip) });
              }
            });
          setViewers(ids.size);
          setOnlineViewers(viewersNow.filter((person) => person.user_id !== viewerId));
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
            if (signal.kind === "offer" && role === "host") {
              const peer = peersRef.current.get(signal.sender);
              if (!peer) return;
              if (peer.signalingState !== "stable") await peer.setLocalDescription({ type: "rollback" });
              await peer.setRemoteDescription(signal.sdp);
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              await sendSignal({ kind: "answer", sender: viewerId, receiver: signal.sender, sdp: answer });
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
            if (signal.kind === "answer") {
              const peer = peersRef.current.get(role === "host" ? signal.sender : hostId);
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
      pkCameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      pkCameraStreamRef.current = null;
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      void supabase.removeChannel(roomChannel);
      void supabase.removeChannel(giftChannel);
      if (presenceChannel) void supabase.removeChannel(presenceChannel);
      void supabase.removeChannel(signalsChannel);
      if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
      if (highValueGiftTimerRef.current !== null) window.clearTimeout(highValueGiftTimerRef.current);
      if (entryNoticeTimerRef.current !== null) window.clearTimeout(entryNoticeTimerRef.current);
    };
  }, [roomId, hostId, viewerId, role, onClose, onEnded, initialStream, createHostPeer, queryClient, sendSignal]);

  useEffect(() => {
    if (role !== "viewer" || activeGuestId !== viewerId || guestSeat.data?.status !== "accepted" || !ready) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let videoSender: RTCRtpSender | undefined;
    let audioSender: RTCRtpSender | undefined;
    let previousAudioTrack: MediaStreamTrack | null = null;
    let audioSenderCreated = false;
    void (async () => {
      try {
        await requestNativeMediaPermissions({ camera: true, microphone: true });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: true });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        guestCameraStreamRef.current = stream;
        if (guestLocalVideoRef.current) guestLocalVideoRef.current.srcObject = stream;
        let peer: RTCPeerConnection | undefined;
        for (let attempt = 0; attempt < 40 && !cancelled; attempt += 1) {
          peer = peersRef.current.get(hostId);
          if (peer?.signalingState === "stable") break;
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
        if (!peer || cancelled) throw new Error("LIVE_HOST_CONNECTION_NOT_READY");
        videoSender = peer.getSenders().find((item) => item.track?.kind === "video");
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) throw new Error("GUEST_CAMERA_TRACK_MISSING");
        if (videoSender) await videoSender.replaceTrack(videoTrack);
        else videoSender = peer.addTrack(videoTrack, stream);
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioSender = peer.getSenders().find((item) => item.track?.kind === "audio");
          if (audioSender) {
            previousAudioTrack = audioSender.track;
            await audioSender.replaceTrack(audioTrack);
          } else {
            audioSender = peer.addTrack(audioTrack, stream);
            audioSenderCreated = true;
          }
        }
        if (peer.signalingState !== "stable") throw new Error("LIVE_CONNECTION_NEGOTIATING");
        const offer = await peer.createOffer();
        if (cancelled) return;
        await peer.setLocalDescription(offer);
        await sendSignal({ kind: "offer", sender: viewerId, receiver: hostId, sdp: offer });
      } catch (error) {
        if (!cancelled) {
          toast.error(mediaPermissionMessage(error) ?? "No se pudo activar la silla de invitado.");
          void supabase.rpc("cupido_end_live_guest", { _room: roomId });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (guestLocalVideoRef.current) guestLocalVideoRef.current.srcObject = null;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      guestCameraStreamRef.current = null;
      const peer = peersRef.current.get(hostId);
      if (peer && videoSender) {
        try {
          void videoSender.replaceTrack(null);
          peer.removeTrack(videoSender);
          if (audioSender) {
            if (audioSenderCreated) peer.removeTrack(audioSender);
            else void audioSender.replaceTrack(previousAudioTrack);
          }
          if (peer.signalingState === "stable") {
            void peer.createOffer().then(async (offer) => {
              await peer.setLocalDescription(offer);
              await sendSignal({ kind: "offer", sender: viewerId, receiver: hostId, sdp: offer });
            });
          }
        } catch { /* the Live connection may already be closing */ }
      }
      if (activeGuestId === viewerId) void supabase.rpc("cupido_end_live_guest", { _room: roomId });
    };
  }, [activeGuestId, guestSeat.data?.status, hostId, ready, role, roomId, sendSignal, viewerId]);

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
      const [clubs, moderators] = await Promise.all([
        supabase.from("cupido_creator_club_subscriptions").select("fan_id").eq("creator_id", hostId).gt("expires_at", new Date().toISOString()),
        supabase.from("cupido_live_room_moderators").select("moderator_id").eq("room_id", roomId),
      ]);
      if (clubs.error) throw clubs.error;
      if (moderators.error) throw moderators.error;
      const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
      const clubIds = new Set((clubs.data ?? []).map((row) => row.fan_id));
      const moderatorIds = new Set((moderators.data ?? []).map((row) => row.moderator_id));
      if (!cancelled) {
        setComments((current) => {
          const currentById = new Map(current.map((comment) => [comment.id, comment]));
          for (const row of data ?? []) {
            currentById.set(row.id, {
              ...row,
              display_name: names.get(row.user_id)?.display_name?.trim() || "@Usuario",
              is_gran_liga: Boolean(names.get(row.user_id)?.is_gran_liga),
              is_club_vip: clubIds.has(row.user_id),
              vip_creator_name: hostName,
              is_moderator: moderatorIds.has(row.user_id),
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
        void Promise.all([
          supabase.from("cupido_public_profiles").select("display_name,is_gran_liga").eq("id", row.user_id).maybeSingle(),
          supabase.from("cupido_creator_club_subscriptions").select("fan_id").eq("creator_id", hostId).eq("fan_id", row.user_id).gt("expires_at", new Date().toISOString()).maybeSingle(),
          supabase.from("cupido_live_room_moderators").select("moderator_id").eq("room_id", roomId).eq("moderator_id", row.user_id).maybeSingle(),
        ]).then(([{ data: profile }, { data: club }, { data: moderator }]) => {
            if (cancelled) return;
            setComments((current) => current.some((comment) => comment.id === row.id)
              ? current
              : [...current, { ...row, display_name: profile?.display_name?.trim() || "@Usuario", is_gran_liga: Boolean(profile?.is_gran_liga), is_club_vip: Boolean(club), vip_creator_name: hostName, is_moderator: Boolean(moderator) }].slice(-100));
          });
      })
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [hostId, hostName, roomId, viewerId]);

  const sendLiveComment = async () => {
    const body = commentText.trim().slice(0, 500);
    if (!body || sendingComment) return;
    setSendingComment(true);
    try {
      const { data: commentId, error } = await supabase.rpc("cupido_send_live_comment", { _room: roomId, _body: body });
      if (error) throw error;
      const [{ data }, { data: profile }] = await Promise.all([
        supabase.from("live_comments").select("id,stream_id,user_id,body,created_at").eq("id", commentId).maybeSingle(),
        supabase.from("cupido_public_profiles").select("display_name,is_gran_liga").eq("id", viewerId).maybeSingle(),
      ]);
      if (data) {
        setComments((current) => current.some((comment) => comment.id === data.id)
          ? current
          : [...current, { ...data, display_name: role === "host" ? hostName : profile?.display_name?.trim() || "@Usuario", is_gran_liga: Boolean(profile?.is_gran_liga), is_club_vip: isClubVip, vip_creator_name: hostName, is_moderator: moderatorIds.has(viewerId) }].slice(-100));
      }
      setCommentText("");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String(error.message) : error instanceof Error ? error.message : "";
      toast.error(message.includes("LIVE_LINK_BLOCKED")
        ? "Los enlaces y dominios externos están bloqueados en el chat del Live."
        : message.includes("LIVE_OFFENSIVE_WORD_BLOCKED")
          ? "El chat bloqueó una palabra ofensiva."
          : message.includes("LIVE_CHAT_MUTED")
            ? "Un moderador silenció el chat de tu cuenta en esta sala."
            : message || "No se pudo enviar el comentario.");
    } finally {
      setSendingComment(false);
    }
  };

  const answerPk = async (accept: boolean, requestId = pendingPk?.id) => {
    if (!requestId) return;
    if (accept && activeGuestId) { toast.error("Finaliza la silla de invitado antes de iniciar una Batalla PK."); return; }
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
    if (activeGuestId) { toast.error("La Batalla PK no está disponible mientras hay una silla de invitado activa."); return; }
    if (!pkProfile.data?.is_verified_blue && !pkProfile.data?.is_gran_liga) {
      toast.error("Para solicitar una Batalla PK necesitas Insignia Azul o Gran Liga.");
      return;
    }
    try {
      await requestNativeMediaPermissions({ camera: true, microphone: false });
      pkCameraStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
    } catch (error) {
      toast.error(mediaPermissionMessage(error) ?? "Permite la cámara para participar en la Batalla PK.");
      return;
    }
    const { data, error } = await supabase.rpc("cupido_request_pk", { _room: roomId });
    if (error) { pkCameraStreamRef.current?.getTracks().forEach((track) => track.stop()); pkCameraStreamRef.current = null; toast.error(error.message); return; }
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
    const showAcceptedPk = async (row: PkRequest) => {
      if (row.room_id !== roomId || row.host_id !== hostId || row.status !== "accepted") return;
      const { data } = await supabase.from("cupido_public_profiles").select("display_name").eq("id", row.requester_id).maybeSingle();
      if (disposed) return;
      setActivePkName(data?.display_name?.trim() || "Rival PK");
      setPkRequestId(row.id);
      setPkRequestStatus("accepted");
    };
    const channel = supabase.channel(`cupido-pk-room-${roomId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cupido_pk_requests", filter: `room_id=eq.${roomId}` }, (payload) => {
        void showAcceptedPk(payload.new as PkRequest);
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

  useEffect(() => {
    if (role === "viewer" && (pkRequestStatus === "rejected" || pkRequestStatus === "expired")) {
      pkCameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      pkCameraStreamRef.current = null;
    }
  }, [pkRequestStatus, role]);

  useEffect(() => {
    const battle = pkState.data;
    const stream = pkCameraStreamRef.current;
    const peer = peersRef.current.get(hostId);
    if (role !== "viewer" || !battle || battle.finished_at || battle.seconds_left <= 0 || battle.challenger_id !== viewerId || !stream || !peer) return;
    if (pkLocalVideoRef.current) pkLocalVideoRef.current.srcObject = stream;
    let cancelled = false;
    void (async () => {
      const existing = peer.getSenders().filter((sender) => sender.track?.kind === "video");
      stream.getVideoTracks().forEach((track, index) => { if (!existing[index]) peer.addTrack(track, stream); });
      if (peer.signalingState !== "stable") return;
      const offer = await peer.createOffer();
      if (cancelled) return;
      await peer.setLocalDescription(offer);
      await sendSignal({ kind: "offer", sender: viewerId, receiver: hostId, sdp: offer });
    })().catch(() => toast.error("No se pudo conectar la cámara a la Batalla PK."));
    return () => { cancelled = true; };
  }, [hostId, pkState.data?.battle_id, pkState.data?.challenger_id, pkState.data?.finished_at, role, sendSignal, viewerId]);

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
    const activeBattle = pkState.data && !pkState.data.finished_at && pkState.data.seconds_left > 0 ? pkState.data : null;
    const side = activeBattle ? pkSide : "host";
    const receiverId = side === "challenger" ? activeBattle?.challenger_id ?? hostId : hostId;
    const { error } = await supabase.rpc("cupido_send_live_gift", {
      _room: roomId,
      _receiver: receiverId,
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
    void queryClient.invalidateQueries({ queryKey: ["cupido-live-gift-total", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-live-top-fans", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-live-pk-state", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-weekly-ranking"] });
    setPendingGiftPurchase(null);
    setGiftPanelOpen(false);
    setGiftCheckoutOpen(false);
    const sender = senderProfile.data?.display_name?.trim() || "Un espectador";
    setGiftAnimation({ id: Date.now(), emoji: gift.emoji, name: gift.name, sender, coins: gift.credits });
    if (giftAnimationTimerRef.current !== null) window.clearTimeout(giftAnimationTimerRef.current);
    giftAnimationTimerRef.current = window.setTimeout(() => setGiftAnimation(null), 3500);
    const giftChannel = supabase.getChannels().find((channel) => channel.topic.includes(`cupido-live-gifts-${roomId}`));
    if (gift.credits >= 300) {
      setHighValueGift({ sender, name: gift.name, coins: gift.credits });
      if (highValueGiftTimerRef.current !== null) window.clearTimeout(highValueGiftTimerRef.current);
      highValueGiftTimerRef.current = window.setTimeout(() => setHighValueGift(null), 7000);
    }
    if (giftChannel) {
      void giftChannel.send({ type: "broadcast", event: "gift", payload: { emoji: gift.emoji, name: gift.name, sender, coins: gift.credits, side } });
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
    if (Date.now() - lastHeartAt.current < 150) return;
    lastHeartAt.current = Date.now();
    const id = Date.now() + Math.random();
    const right = 8 + Math.random() * 14;
    setFloatingHearts((current) => [...current.slice(-12), { id, right }]);
    window.setTimeout(() => setFloatingHearts((current) => current.filter((item) => item.id !== id)), 2200);
    const channel = supabase.getChannels().find((item) => item.topic.includes(`cupido-live-gifts-${roomId}`));
    if (channel) void channel.send({ type: "broadcast", event: "heart", payload: { id, right, user_id: viewerId } });
  };

  const updateSeat = async (operation: () => Promise<{ error: { message: string } | null }>, success: string) => {
    if (seatBusy) return;
    setSeatBusy(true);
    try {
      const { error } = await operation();
      if (error) throw error;
      await Promise.all([
        guestSeat.refetch(), myGuestRequest.refetch(), guestRequests.refetch(),
      ]);
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la silla de invitado.");
    } finally {
      setSeatBusy(false);
    }
  };

  const requestGuestSeat = () => updateSeat(
    async () => {
      const { error } = await supabase.rpc("cupido_request_live_guest", { _room: roomId });
      return { error };
    },
    isClubVip ? "Solicitud VIP enviada con prioridad al anfitrión." : "Solicitud enviada al anfitrión.",
  );

  const inviteGuest = (guestId: string) => updateSeat(
    async () => {
      const { error } = await supabase.rpc("cupido_invite_live_guest", { _room: roomId, _guest: guestId });
      return { error };
    },
    "Invitación enviada. Esperando que acepte.",
  );

  const respondGuest = (requestId: string, accept: boolean) => updateSeat(
    async () => {
      const { error } = await supabase.rpc("cupido_respond_live_guest", { _request: requestId, _accept: accept });
      return { error };
    },
    accept ? "Silla de invitado aceptada." : "Solicitud de silla rechazada.",
  );

  const endGuest = () => updateSeat(
    async () => {
      const { error } = await supabase.rpc("cupido_end_live_guest", { _room: roomId });
      return { error };
    },
    "Invitación de invitado finalizada.",
  );

  const saveRoulette = async () => {
    const prizes = rouletteDraft.split("\n").map((prize) => prize.trim()).filter(Boolean).slice(0, 6);
    if (prizes.length < 2 || !rouletteGiftId) {
      toast.error("Configura de 2 a 6 premios y elige el regalo que activa la ruleta.");
      return;
    }
    const { error } = await supabase.rpc("cupido_set_live_roulette", { _room: roomId, _trigger_gift_id: rouletteGiftId, _prizes: prizes });
    if (error) { toast.error(error.message); return; }
    await rouletteConfig.refetch();
    setRouletteOpen(false);
    toast.success("Ruleta sincronizada para toda la sala.");
  };

  const moderateUser = async (userId: string, minutes: number) => {
    setModerationBusyId(userId);
    const { error } = await supabase.rpc("cupido_moderate_live_user", { _room: roomId, _user: userId, _minutes: minutes });
    setModerationBusyId(null);
    if (error) toast.error(error.message);
    else toast.success(minutes === 0 ? "Silencio retirado." : "Usuario silenciado en esta sala.");
  };

  const setModerator = async (userId: string, enabled: boolean) => {
    setModerationBusyId(userId);
    const { error } = await supabase.rpc("cupido_set_live_moderator", { _room: roomId, _user: userId, _enabled: enabled });
    setModerationBusyId(null);
    if (error) toast.error(error.message);
    else {
      await roomModerators.refetch();
      toast.success(enabled ? "Moderador agregado a la sala." : "Moderador retirado.");
    }
  };

  const subscribeToLiveClub = async () => {
    const { error } = await supabase.rpc("cupido_subscribe_creator_club", { _creator: hostId });
    if (error) { toast.error(error.message); return; }
    await Promise.all([account.refresh(), clubSubscribers.refetch()]);
    setClubOpen(false);
    toast.success(`Ya eres VIP de ${hostName}. La insignia aparecerá en el chat.`);
  };

  const setLiveGoal = async (goalValue = Number(goalInput)) => {
    const goal = goalValue;
    if (!Number.isInteger(goal) || goal < 0) { toast.error("Escribe una meta válida de monedas."); return; }
    const { error } = await supabase.rpc("cupido_set_live_coin_goal", { _room: roomId, _goal: goal });
    if (error) { toast.error(error.message); return; }
    await coinGoal.refetch();
    setGoalInput("");
    goalCelebratedRef.current = false;
    toast.success(goal ? "Meta de monedas guardada." : "Meta de monedas desactivada.");
  };

  const dropTreasure = async () => {
    const { error } = await supabase.rpc("cupido_start_live_treasure", { _room: roomId });
    if (error) { toast.error(error.message); return; }
    await treasure.refetch();
  };

  const claimTreasure = async () => {
    if (!treasure.data || treasureBusy) return;
    setTreasureBusy(true);
    const { data, error } = await supabase.rpc("cupido_claim_live_treasure", { _treasure: treasure.data.id });
    setTreasureBusy(false);
    if (error) { toast.error(error.message); return; }
    const result = data as { claimed?: boolean; coins?: number; reason?: string };
    if (result.claimed) {
      await account.refresh();
      toast.success(`¡Cofre reclamado! +${result.coins ?? 5} monedas.`);
    } else toast.info(result.reason === "INFINITE_BALANCE" ? "Tu saldo es infinito." : "El cofre ya no está disponible.");
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
    if (role === "viewer" && guestSeat.data && guestSeat.data.guest_id === viewerId && ["invited", "accepted"].includes(guestSeat.data.status)) {
      void supabase.rpc("cupido_end_live_guest", { _room: roomId });
    }
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

  useEffect(() => {
    const channel = supabase.channel(`cupido-vip-live-db-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_live_pk_battles", filter: `room_id=eq.${roomId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-pk-state", roomId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_live_treasures", filter: `room_id=eq.${roomId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-treasure", roomId] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cupido_live_rooms", filter: `id=eq.${roomId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-live-coin-goal", roomId] });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, roomId]);

  useEffect(() => {
    if (!pkState.data || pkState.data.finished_at) { setPkRemaining(0); return; }
    const tick = () => setPkRemaining(Math.max(0, Math.ceil((new Date(pkState.data!.ends_at).getTime() - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pkState.data]);

  useEffect(() => { pkFinishStartedRef.current = false; }, [pkState.data?.battle_id]);

  useEffect(() => {
    if (!pkState.data || pkState.data.finished_at || pkRemaining > 0 || role !== "host" || pkFinishStartedRef.current) return;
    pkFinishStartedRef.current = true;
    void supabase.rpc("cupido_finish_live_pk_battle", { _battle: pkState.data.battle_id }).then(({ data, error }) => {
      if (error) return;
      const result = data as { winner_id?: string | null; host_coins?: number; challenger_coins?: number };
      toast.success(result.winner_id ? `Batalla terminada. Ganador: ${result.winner_id === hostId ? hostName : pkState.data?.challenger_name}. 🏆` : "Batalla terminada en empate.");
      setActivePkName(null);
      void queryClient.invalidateQueries({ queryKey: ["cupido-live-pk-state", roomId] });
    });
  }, [hostId, hostName, pkRemaining, pkState.data, queryClient, role, roomId]);

  useEffect(() => {
    if (!treasure.data) { setTreasureSeconds(0); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(treasure.data!.expires_at).getTime() - Date.now()) / 1000));
      setTreasureSeconds(remaining);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [treasure.data, treasure.refetch]);

  useEffect(() => {
    const goal = Number(coinGoal.data ?? 0);
    if (goal <= 0 || liveGiftTotal.isLoading || goalCelebratedRef.current || (liveGiftTotal.data ?? 0) < goal) return;
    goalCelebratedRef.current = true;
    setGoalCelebration(true);
    window.setTimeout(() => setGoalCelebration(false), 3000);
    toast.success("¡Meta de monedas completada! 🎉✨");
  }, [coinGoal.data, liveGiftTotal.data, liveGiftTotal.isLoading]);

  const pkIsActive = Boolean(activePkName && pkState.data && !pkState.data.finished_at && pkRemaining > 0);
  const guestIsActive = Boolean(activeGuestId && !pkIsActive);
  const activeGuestName = onlineViewers.find((person) => person.user_id === activeGuestId)?.display_name
    ?? guestRequestProfiles.data?.find((person) => person.id === activeGuestId)?.display_name
    ?? "Invitado";

  return (
    <Dialog open onOpenChange={(open) => !open && exitLive()}>
      <DialogContent className="!fixed !inset-y-0 !left-1/2 !top-0 !z-[80] !m-0 !mx-auto !h-[100dvh] !min-h-[100dvh] !max-h-[100dvh] !w-full !max-w-md !-translate-x-1/2 !translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 pt-11 pb-24 text-white sm:!max-w-md">
        <DialogHeader className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-20 max-h-28 w-[min(72vw,19rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-black/50 p-2.5 backdrop-blur-md">
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Avatar className="size-8 shrink-0 border border-pink-300/60"><AvatarImage src={hostAvatar} alt={hostName} /><AvatarFallback>{hostName.slice(0, 1) || "C"}</AvatarFallback></Avatar>
            <Radio className="size-5 animate-pulse text-pink-400" />
            {role === "host" ? "Tu Live está en vivo" : <>Live de <Link to="/perfil" search={{ userId: hostId }} className="hover:underline">{hostName}</Link></>}
            <span className="shrink-0 rounded-full bg-pink-600 px-2 py-0.5 text-[10px] font-bold text-white">EN VIVO</span>
            <VerifiedBadge granLiga={hostIsGranLiga} className="size-5" />
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1"><Users className="size-3.5" /> {viewers} viendo</span>
            {role === "viewer" && <span className={`flex items-center gap-1 ${hostOnline ? "text-emerald-300" : "text-white/65"}`}><span className={`size-1.5 rounded-full ${hostOnline ? "bg-emerald-400" : "bg-zinc-500"}`} />{hostOnline ? "En línea" : "Desconectado"}</span>}
            <span className="inline-flex flex-col rounded-xl border border-amber-300/25 bg-amber-400/10 px-2.5 py-1 text-amber-100" aria-live="polite">
              <span className="text-xs font-semibold">{liveEarnings.isError ? "—" : (liveEarnings.data?.coins ?? 0).toLocaleString("es")} monedas recibidas</span>
              <span className="text-[10px]">≈ US${liveEarnings.isError ? "—" : (liveEarnings.data?.usd ?? 0).toFixed(2)} USD</span>
            </span>
            {role === "viewer" && <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-amber-100">Privada: {privateCallPrice.data ?? 50} monedas/min</span>}
            {role === "viewer" && <Button type="button" size="sm" variant="outline" onClick={() => void toggleFollow()} className="h-7 gap-1 rounded-full border-white/30 bg-black/40 px-2 text-white">{followed.data ? <UserCheck className="size-3.5" /> : <UserPlus className="size-3.5" />}{followed.data ? "Siguiendo" : "Seguir"}</Button>}
            {!ready && <Loader2 className="size-3.5 animate-spin" />}
          </DialogDescription>
          {topFanRows.length > 0 && <div className="flex max-w-full items-center gap-1.5 overflow-x-auto" aria-label="Top fans del Live">
            {topFanRows.slice(0, 3).map((fan, index) => <div key={fan.user_id} className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold text-white ${index === 0 ? "border-amber-300/60 bg-amber-500/20" : index === 1 ? "border-slate-300/50 bg-slate-400/20" : "border-orange-500/50 bg-orange-600/20"}`}><span aria-hidden="true">{index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}</span><Avatar userId={fan.user_id} className="size-5"><AvatarImage src={fan.avatar_url} /><AvatarFallback>{fan.display_name.slice(0, 1)}</AvatarFallback></Avatar><span className="max-w-16 truncate">{fan.display_name}</span><span>{Number(fan.coins).toLocaleString("es")}</span></div>)}
          </div>}
        </DialogHeader>
        {role === "host" && !pkIsActive && (
          <label className="absolute left-3 top-[calc(env(safe-area-inset-top)+9rem)] z-20 flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-black/75 px-3 py-2 text-[11px] font-semibold text-amber-100 backdrop-blur-md">
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
          <section className="absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+9rem)] z-20 rounded-2xl border border-white/15 bg-black/65 p-3 backdrop-blur-md" aria-live="polite">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-white">
              <span className="truncate text-rose-200">{role === "host" ? hostName : "Anfitrión"} · {Number(pkState.data?.host_coins ?? 0).toLocaleString("es")}</span>
              <Swords className="size-4 shrink-0 text-amber-300" />
              <span className="truncate text-sky-200">{activePkName} · {Number(pkState.data?.challenger_coins ?? 0).toLocaleString("es")}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-sky-500">
              <div className="bg-rose-500 transition-all duration-300" style={{ width: `${Number(pkState.data?.host_coins ?? 0) + Number(pkState.data?.challenger_coins ?? 0) ? (Number(pkState.data?.host_coins ?? 0) / (Number(pkState.data?.host_coins ?? 0) + Number(pkState.data?.challenger_coins ?? 0))) * 100 : 50}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] font-semibold text-white/75"><span>Rojo vs. dorado</span><span>{Math.floor(pkRemaining / 60)}:{String(pkRemaining % 60).padStart(2, "0")}</span></div>
            {role === "viewer" && <div className="mt-2 flex justify-end gap-1"><Button size="sm" variant={pkSide === "host" ? "default" : "outline"} className="h-7 px-2 text-[10px]" onClick={() => setPkSide("host")}>Apoyar anfitrión</Button><Button size="sm" variant={pkSide === "challenger" ? "default" : "outline"} className="h-7 px-2 text-[10px]" onClick={() => setPkSide("challenger")}>Apoyar rival</Button></div>}
          </section>
        )}
        {role === "host" && !pkIsActive && (
          <div className="absolute left-3 right-16 top-[calc(env(safe-area-inset-top)+12rem)] z-20 flex max-w-[min(80vw,22rem)] items-center gap-1.5 rounded-xl border border-amber-300/30 bg-black/70 px-2 py-1.5 text-[10px] text-amber-100 backdrop-blur">
            <span className="shrink-0">Meta</span><Input aria-label="Meta de monedas del Live" inputMode="numeric" value={goalInput} onChange={(event) => setGoalInput(event.target.value)} placeholder={coinGoal.data ? `${coinGoal.data}` : "500"} className="h-7 min-w-0 bg-black/60 px-2 text-xs" />
            <Button size="sm" className="h-7 px-2 text-[10px]" onClick={() => void setLiveGoal()}>Guardar</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => void setLiveGoal(0)}>Quitar</Button>
          </div>
        )}
        {Number(coinGoal.data ?? 0) > 0 && !pkIsActive && (
          <div className="absolute left-3 right-16 top-[calc(env(safe-area-inset-top)+14.8rem)] z-20 rounded-xl border border-amber-300/30 bg-black/70 px-2.5 py-2 text-[10px] text-amber-100 backdrop-blur">
            <div className="mb-1 flex justify-between gap-2"><span>Meta del anfitrión</span><span>{Math.min(100, Math.round(((liveGiftTotal.data ?? 0) / Number(coinGoal.data)) * 100))}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-gradient-to-r from-amber-400 to-yellow-200 transition-all" style={{ width: `${Math.min(100, ((liveGiftTotal.data ?? 0) / Number(coinGoal.data)) * 100)}%` }} /></div>
            <div className="mt-1 text-right">{(liveGiftTotal.data ?? 0).toLocaleString("es")} / {Number(coinGoal.data).toLocaleString("es")} monedas</div>
          </div>
        )}
        {treasure.data && treasureSeconds > 0 && !giftAnimation && !entryNotice && !highValueGift && (
          <button type="button" onClick={() => void claimTreasure()} disabled={treasureBusy} className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+20.5rem)] z-30 -translate-x-1/2 rounded-2xl border border-amber-300/60 bg-amber-500/20 px-4 py-2 text-center text-sm font-bold text-amber-100 shadow-lg shadow-amber-500/20 backdrop-blur">
            <span className="mr-2 text-xl">🎁</span>{treasureBusy ? "Abriendo…" : `¡Cofre! ${treasureSeconds}s · 5 monedas`}
          </button>
        )}
        {goalCelebration && <div className="pointer-events-none absolute inset-x-0 top-1/2 z-40 flex justify-center gap-3 text-4xl" aria-hidden="true"><span className="animate-bounce">&#127881;</span><span className="animate-pulse">&#10024;</span><span className="animate-bounce">&#127874;</span><span className="animate-pulse">&#10024;</span><span className="animate-bounce">&#127881;</span></div>}
        {giftAnimation ? <div key={giftAnimation.id} className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+18.5rem)] z-40 flex justify-center" aria-live="polite"><div className="animate-in slide-in-from-top-4 fade-in duration-300 rounded-2xl border border-pink-300/50 bg-black/85 px-4 py-2 text-center text-white shadow-xl shadow-pink-500/20"><span className="mr-2 text-3xl">{giftAnimation.emoji}</span><span className="text-sm font-bold">{giftAnimation.sender} envio {giftAnimation.name}</span><span className="mt-0.5 block text-xs text-amber-200">{giftAnimation.coins.toLocaleString("es")} monedas</span></div></div> : entryNotice ? <div className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+18.5rem)] z-40 flex justify-center"><div className="rounded-full border border-violet-300/40 bg-zinc-950/85 px-4 py-2 text-center text-xs font-semibold text-violet-100 shadow-lg backdrop-blur">{entryNotice}</div></div> : highValueGift ? <button type="button" onClick={() => setGiftPanelOpen(true)} className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+18.5rem)] z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-300/60 bg-gradient-to-r from-amber-600/90 via-amber-300/90 to-yellow-600/90 px-4 py-1.5 text-center text-xs font-bold text-zinc-950 shadow-lg shadow-amber-400/20">&#10024; {highValueGift.sender} · {highValueGift.name} · {highValueGift.coins} monedas <span className="ml-2 underline">Ir</span></button> : null}
        <div className="absolute inset-0 z-0 overflow-hidden bg-black">
          <video
            ref={role === "host" ? localVideoRef : remoteVideoRef}
            autoPlay
            playsInline
            webkit-playsinline="true"
            muted={role === "host" || liveMuted}
            onClick={sendLiveHeart}
            className={`${pkIsActive || guestIsActive ? "absolute inset-x-0 top-0 h-1/2" : "h-full w-full"} cursor-pointer object-cover`}
            style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
          />
          {pkIsActive && <video ref={role === "host" ? pkRemoteVideoRef : pkState.data?.challenger_id === viewerId ? pkLocalVideoRef : pkRemoteVideoRef} autoPlay playsInline webkit-playsinline="true" muted={role !== "host" || liveMuted} className="absolute inset-x-0 bottom-0 h-1/2 w-full object-cover" />}
          {guestIsActive && <video ref={role === "host" ? guestRemoteVideoRef : activeGuestId === viewerId ? guestLocalVideoRef : guestRemoteVideoRef} autoPlay playsInline webkit-playsinline="true" muted={role === "host" || activeGuestId === viewerId || liveMuted} className="absolute inset-x-0 bottom-0 h-1/2 w-full object-cover" />}
          {pkIsActive && <><span className="pointer-events-none absolute left-3 top-[42%] z-10 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold text-rose-100">🔴 {hostName}</span><span className="pointer-events-none absolute bottom-[48%] left-3 z-10 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold text-amber-100">✨ {activePkName}</span></>}
          {guestIsActive && <><span className="pointer-events-none absolute left-3 top-[42%] z-10 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold text-rose-100">{hostName}</span><span className="pointer-events-none absolute bottom-[48%] left-3 z-10 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold text-sky-100">Invitado · {activeGuestName}</span></>}
          {role === "host" && <audio ref={remoteAudioRef} autoPlay playsInline muted={liveMuted} className="hidden" />}
          {floatingHearts.map((heart) => <div key={heart.id} className="pointer-events-none absolute bottom-1/4 z-10 animate-in slide-in-from-bottom-8 fade-in duration-700 text-4xl drop-shadow-[0_0_18px_rgba(244,63,94,0.9)]" style={{ right: `${heart.right}%`, animationDuration: "1.8s" }} aria-hidden="true">💖</div>)}
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label={liveMuted ? "Activar sonido del Live" : "Silenciar Live"}
            title={liveMuted ? "Activar sonido" : "Silenciar"}
            onClick={() => setLiveMuted((value) => !value)}
            className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] rounded-full border-white/30 bg-black/70 text-white hover:bg-black/90"
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
          <Button type="button" variant="outline" size="icon" onClick={sendLiveHeart} aria-label="Enviar corazón en vivo" className="rounded-full border-pink-300/50 bg-pink-600/80 text-white"><Heart className="size-4 fill-current" /></Button>
          <Button variant={micMuted ? "destructive" : "outline"} size="icon" onClick={toggleMicrophone} aria-label={micMuted ? "Activar micrófono" : "Silenciar micrófono"} className="rounded-full border-white/30 bg-black/55 text-white">
            {micMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => setGuestToolsOpen(true)} aria-label="Herramientas del Live" title="Silla, ruleta y opciones" className="rounded-full border-sky-300/40 bg-black/70 text-sky-100"><Users className="size-4" /></Button>
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
              <div key={comment.id} className="flex items-start gap-1 break-words text-[11px] leading-snug text-slate-200">
                <p className="min-w-0 flex-1"><Link to="/perfil" search={{ userId: comment.user_id }} className="font-semibold text-pink-200 hover:underline">{comment.display_name}</Link> <VerifiedBadge granLiga={comment.is_gran_liga} className="inline size-3 align-text-bottom" /> {comment.is_club_vip && <span className="rounded bg-amber-400/15 px-1 text-[9px] font-bold text-amber-200"><Crown className="mr-0.5 inline size-2.5" /> VIP · {comment.vip_creator_name}</span>} {comment.is_moderator && <Shield className="ml-0.5 inline size-3 text-sky-300" />} {comment.body}</p>
                {isRoomModerator && comment.user_id !== hostId && comment.user_id !== viewerId && <button type="button" aria-label={`Silenciar a ${comment.display_name}`} title="Silenciar 10 minutos" disabled={moderationBusyId === comment.user_id} onClick={() => void moderateUser(comment.user_id, 10)} className="grid size-6 shrink-0 place-items-center rounded-full text-sky-200 hover:bg-white/10 disabled:opacity-50"><Shield className="size-3.5" /></button>}
              </div>
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
        <Sheet open={guestToolsOpen} onOpenChange={setGuestToolsOpen}>
          <SheetContent side="bottom" className="z-[96] max-h-[72dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-sky-300/25 bg-zinc-950 pb-8 text-white">
            <SheetHeader className="text-left"><SheetTitle className="flex items-center gap-2 text-sky-100"><Users className="size-5" /> Herramientas en vivo</SheetTitle><SheetDescription>Acciones de la sala y una silla de invitado en pantalla dividida. Las solicitudes VIP aparecen primero.</SheetDescription></SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => { setGuestToolsOpen(false); window.setTimeout(() => setRouletteOpen(true), 80); }}><Dices className="mr-1 size-4" /> Ruleta</Button>
                <Button size="sm" variant="outline" onClick={() => { setGuestToolsOpen(false); window.setTimeout(() => setRankingOpen(true), 80); }}><Trophy className="mr-1 size-4" /> Ranking semanal</Button>
                {role === "viewer" && <Button size="sm" variant="outline" onClick={() => { setGuestToolsOpen(false); window.setTimeout(() => setClubOpen(true), 80); }}><Crown className="mr-1 size-4" /> Club VIP</Button>}
                {role === "host" && <Button size="sm" variant="outline" onClick={() => { setGuestToolsOpen(false); window.setTimeout(() => setModerationOpen(true), 80); }}><Shield className="mr-1 size-4" /> Moderadores</Button>}
                {(role === "host" || pkProfile.data?.is_verified_blue || pkProfile.data?.is_gran_liga || pkProfile.data?.is_premium) && !treasure.data && <Button size="sm" variant="outline" onClick={() => { setGuestToolsOpen(false); void dropTreasure(); }}>🎁 Cofre</Button>}
              </div>
              <h3 className="text-sm font-bold text-sky-100">Silla de invitado</h3>
              {guestSeat.data?.status === "accepted" && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-300/30 bg-sky-400/10 p-3"><p className="text-sm">En pantalla: <strong>{activeGuestName}</strong></p><Button size="sm" variant="destructive" disabled={seatBusy} onClick={() => void endGuest()}>Terminar silla</Button></div>}
              {role === "host" && guestSeat.data?.status === "invited" && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-300/30 bg-sky-400/10 p-3"><p className="text-sm">Esperando respuesta de <strong>{onlineViewers.find((person) => person.user_id === guestSeat.data?.guest_id)?.display_name ?? "espectador"}</strong>.</p><Button size="sm" variant="outline" disabled={seatBusy} onClick={() => void endGuest()}>Cancelar invitación</Button></div>}
              {role === "viewer" && guestSeat.data?.guest_id === viewerId && guestSeat.data.status === "invited" && <div className="rounded-xl border border-sky-300/25 bg-sky-400/10 p-3"><p className="text-sm font-semibold">El anfitrión te invitó a subir en pantalla.</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={seatBusy || pkIsActive} onClick={() => void respondGuest(guestSeat.data!.id, true)}><Check className="mr-1 size-4" />Aceptar</Button><Button size="sm" variant="outline" disabled={seatBusy} onClick={() => void respondGuest(guestSeat.data!.id, false)}>Ahora no</Button></div></div>}
              {role === "viewer" && activeGuestId === viewerId && <div className="flex items-center justify-between rounded-xl border border-sky-300/25 p-3"><p className="text-sm">Tu cámara está en la silla.</p><Button size="sm" variant="outline" disabled={seatBusy} onClick={() => void endGuest()}>Bajar</Button></div>}
              {role === "viewer" && myGuestRequest.data && <div className="flex items-center justify-between rounded-xl border border-white/10 p-3"><p className="text-sm">Solicitud enviada; esperando al anfitrión.</p><Button size="sm" variant="outline" disabled={seatBusy} onClick={() => void endGuest()}>Cancelar</Button></div>}
              {role === "viewer" && !activeGuestId && !myGuestRequest.data && guestSeat.data?.guest_id !== viewerId && <Button className="w-full" disabled={seatBusy || Boolean(guestSeat.data) || pkIsActive} onClick={() => void requestGuestSeat()}><UserPlus className="mr-2 size-4" />{isClubVip ? "Pedir silla VIP prioritaria" : "Solicitar silla"}</Button>}
              {role === "host" && <>
                <section className="space-y-2"><h3 className="text-sm font-bold">Solicitudes de espectadores</h3>
                  {[...(guestRequests.data ?? [])].sort((a, b) => Number((clubSubscribers.data ?? []).some((club) => club.fan_id === b.guest_id)) - Number((clubSubscribers.data ?? []).some((club) => club.fan_id === a.guest_id))).map((request) => {
                    const person = guestRequestProfiles.data?.find((row) => row.id === request.guest_id);
                    const vip = (clubSubscribers.data ?? []).some((club) => club.fan_id === request.guest_id);
                    return <div key={request.id} className="flex items-center gap-2 rounded-xl border border-white/10 p-2"><Avatar className="size-9"><AvatarImage src={person?.avatar_url ?? ""} /><AvatarFallback>{person?.display_name?.slice(0, 1) ?? "U"}</AvatarFallback></Avatar><span className="min-w-0 flex-1 truncate text-sm">{person?.display_name ?? "Espectador"}{vip && <span className="ml-1 text-[10px] font-bold text-amber-200">VIP</span>}</span><Button size="sm" disabled={seatBusy || Boolean(guestSeat.data) || pkIsActive} onClick={() => void respondGuest(request.id, true)}>Aceptar</Button><Button size="icon" variant="ghost" aria-label="Rechazar solicitud" disabled={seatBusy} onClick={() => void respondGuest(request.id, false)}><X className="size-4" /></Button></div>;
                  })}
                  {!guestRequests.data?.length && <p className="text-xs text-muted-foreground">Todavía no hay solicitudes.</p>}
                </section>
                <section className="space-y-2"><h3 className="text-sm font-bold">Espectadores conectados</h3>
                  {[...onlineViewers].sort((a, b) => Number(b.is_club_vip || (clubSubscribers.data ?? []).some((club) => club.fan_id === b.user_id)) - Number(a.is_club_vip || (clubSubscribers.data ?? []).some((club) => club.fan_id === a.user_id))).map((person) => {
                    const vip = person.is_club_vip || (clubSubscribers.data ?? []).some((club) => club.fan_id === person.user_id);
                    return <div key={person.user_id} className="flex items-center gap-2 rounded-xl border border-white/10 p-2"><span className="size-2 rounded-full bg-emerald-400" /><span className="min-w-0 flex-1 truncate text-sm">{person.display_name}{vip && <span className="ml-1 text-[10px] font-bold text-amber-200">VIP</span>}</span><Button size="sm" variant="outline" disabled={seatBusy || Boolean(guestSeat.data) || pkIsActive} onClick={() => void inviteGuest(person.user_id)}>Invitar</Button></div>;
                  })}
                  {!onlineViewers.length && <p className="text-xs text-muted-foreground">Los espectadores en línea aparecerán aquí.</p>}
                </section>
              </>}
            </div>
          </SheetContent>
        </Sheet>
        <Sheet open={rouletteOpen} onOpenChange={setRouletteOpen}>
          <SheetContent side="bottom" className="z-[96] max-h-[72dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-violet-300/25 bg-zinc-950 pb-8 text-white">
            <SheetHeader className="text-left"><SheetTitle className="flex items-center gap-2 text-violet-100"><Dices className="size-5" /> Ruleta de la sala</SheetTitle><SheetDescription>Al enviar el regalo disparador, Supabase elige y publica el premio para todos.</SheetDescription></SheetHeader>
            {rouletteConfig.data?.enabled ? <div className="mt-4 rounded-2xl border border-violet-300/25 bg-violet-400/5 p-3"><p className="text-xs text-muted-foreground">Regalo disparador: <span className="font-semibold text-white">{GIFTS.find((gift) => gift.id === rouletteConfig.data?.trigger_gift_id)?.name ?? "Regalo"}</span></p><ol className="mt-2 grid grid-cols-2 gap-2">{rouletteConfig.data.prizes.map((prize, index) => <li key={`${index}-${prize}`} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs">{index + 1}. {prize}</li>)}</ol></div> : <p className="mt-4 rounded-xl border border-white/10 p-3 text-sm text-muted-foreground">El anfitrión todavía no configuró la ruleta.</p>}
            {role === "host" && <div className="mt-4 space-y-3 border-t border-white/10 pt-4"><label className="block space-y-1 text-xs font-semibold">Regalo que activa la ruleta<select value={rouletteGiftId || GIFTS[0]?.id || ""} onChange={(event) => setRouletteGiftId(event.target.value)} className="h-10 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 text-sm text-white">{GIFTS.map((gift) => <option key={gift.id} value={gift.id}>{gift.emoji} {gift.name} · {gift.credits} monedas</option>)}</select></label><label className="block space-y-1 text-xs font-semibold">Premios o retos (uno por línea, hasta 6)<Textarea value={rouletteDraft} maxLength={500} onChange={(event) => setRouletteDraft(event.target.value)} placeholder={'Canta el coro de una canción\nSaludo especial\nBaile de 10 segundos\n'} className="min-h-28 resize-y bg-zinc-900 text-sm" /></label><Button className="w-full" onClick={() => void saveRoulette()}>Guardar ruleta en tiempo real</Button></div>}
          </SheetContent>
        </Sheet>
        {role === "host" && <Sheet open={moderationOpen} onOpenChange={setModerationOpen}>
          <SheetContent side="bottom" className="z-[96] max-h-[72dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-emerald-300/25 bg-zinc-950 pb-8 text-white">
            <SheetHeader className="text-left"><SheetTitle className="flex items-center gap-2 text-emerald-100"><Shield className="size-5" /> Moderadores de sala</SheetTitle><SheetDescription>Los moderadores pueden silenciar a usuarios. El filtro del servidor bloquea enlaces y lenguaje ofensivo.</SheetDescription></SheetHeader>
            <div className="mt-4 space-y-2">{onlineViewers.map((person) => {
              const moderator = moderatorIds.has(person.user_id);
              return <div key={person.user_id} className="flex items-center gap-2 rounded-xl border border-white/10 p-2"><Avatar className="size-9"><AvatarFallback>{person.display_name.slice(0, 1)}</AvatarFallback></Avatar><span className="min-w-0 flex-1 truncate text-sm">{person.display_name}</span><Button size="sm" variant={moderator ? "destructive" : "outline"} disabled={moderationBusyId === person.user_id} onClick={() => void setModerator(person.user_id, !moderator)}>{moderator ? "Quitar" : "Nombrar"}</Button></div>;
            })}{!onlineViewers.length && <p className="py-5 text-center text-sm text-muted-foreground">No hay espectadores para moderar.</p>}</div>
          </SheetContent>
        </Sheet>}
        {rouletteSpin && <div className="pointer-events-none absolute inset-x-4 top-[38%] z-[75] flex justify-center" aria-live="polite"><div className="rounded-3xl border border-amber-300/50 bg-zinc-950/95 p-4 text-center shadow-2xl shadow-violet-500/30"><div className="mx-auto grid size-28 place-items-center rounded-full border-4 border-amber-300 bg-gradient-to-br from-violet-600 to-fuchsia-700 text-3xl transition-transform duration-[4500ms] ease-out" style={{ transform: `rotate(${rouletteRotation}deg)` }}><Dices className="size-12 text-white" /></div><p className="mt-2 text-xs text-violet-100">La ruleta cayó en</p><p className="max-w-[min(75vw,20rem)] break-words text-lg font-bold text-amber-100">{rouletteSpin.prize}</p></div></div>}
        {role === "viewer" && <Sheet open={clubOpen} onOpenChange={setClubOpen}>
          <SheetContent side="bottom" className="z-[96] max-h-[72dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-amber-300/25 bg-zinc-950 pb-8 text-white">
            <SheetHeader className="text-left"><SheetTitle className="flex items-center gap-2 text-amber-100"><Crown className="size-5" /> Club VIP de {hostName}</SheetTitle><SheetDescription>Tu insignia VIP aparece junto a tus mensajes y tus solicitudes de silla tienen prioridad.</SheetDescription></SheetHeader>
            {isClubVip ? <p className="mt-4 rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm text-amber-100">Tu suscripción está activa. Gracias por apoyar a {hostName}.</p> : creatorClub.data ? <div className="mt-4 space-y-3"><p className="text-sm">Precio mensual: <strong className="text-amber-100">{creatorClub.data.monthly_price.toLocaleString("es")} monedas</strong></p><p className="text-xs text-muted-foreground">La suscripción dura un mes; después puedes renovarla desde el perfil o el Live. El cobro se valida en Supabase.</p><Button className="w-full" disabled={account.loading || account.balanceUnavailable} onClick={() => void subscribeToLiveClub()}>Unirme al Club VIP</Button></div> : <p className="mt-4 text-sm text-muted-foreground">El anfitrión aún no configuró un Club VIP.</p>}
          </SheetContent>
        </Sheet>}
        <Sheet open={rankingOpen} onOpenChange={setRankingOpen}>
          <SheetContent side="bottom" className="z-[95] max-h-[72dvh] overflow-y-auto rounded-t-3xl border-amber-300/30 bg-zinc-950 pb-8 text-white">
            <SheetHeader className="text-left"><SheetTitle className="flex items-center gap-2 text-amber-100"><Trophy className="size-5" /> Ranking semanal</SheetTitle><SheetDescription>Creadores y fans con más actividad esta semana. Se actualiza con nuevos regalos y llamadas.</SheetDescription></SheetHeader>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {([["Top 10 Creadores", weeklyRanking.data.creators], ["Top 10 Fans", weeklyRanking.data.fans]] as const).map(([title, rows]) => (
                <section key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <h3 className="mb-2 text-sm font-bold text-amber-100">{title}</h3>
                  <div className="space-y-2">{rows.slice(0, 10).map((person, index) => (
                    <Link key={person.user_id} to="/perfil" search={{ userId: person.user_id }} onClick={() => setRankingOpen(false)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
                      <span className="w-5 text-xs font-bold text-amber-200">{index + 1}</span><Avatar userId={person.user_id} className="size-8"><AvatarImage src={person.avatar_url} /><AvatarFallback>{person.display_name.slice(0, 1)}</AvatarFallback></Avatar><span className="min-w-0 flex-1 truncate text-sm">{person.display_name}</span><span className="text-xs text-amber-100">{Number(person.coins).toLocaleString("es")}</span>
                    </Link>
                  ))}{!rows.length && <p className="py-3 text-center text-xs text-muted-foreground">Aún no hay actividad esta semana.</p>}</div>
                </section>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </DialogContent>
    </Dialog>
  );
}
