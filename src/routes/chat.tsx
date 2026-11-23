import { useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Coffee,
  Copy,
  CreditCard,
  Flame,
  Forward,
  Gift,
  Flag,
  FlipHorizontal,
  Search,
  History,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  MessageCircle,
  Phone,
  PhoneOff,
  Pencil,
  Play,
  Reply,
  Send,
  SkipForward,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { AdRewardDialog } from "@/components/cupido/ad-reward-dialog";
import { PayPalCheckoutButtons } from "@/components/cupido/paypal-checkout-buttons";
import { GranLigaStar, VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NotificationBell } from "@/components/cupido/notification-bell";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { CREDIT_PACKAGES } from "@/lib/credits";
import { hideFeedBanner, isNativeAds, showFeedBanner } from "@/lib/admob";
import { loadPaypalClientId } from "@/lib/paypal-public";
import { getPaypalCheckoutConfig } from "@/lib/payments.functions";
import { notifyUser, SUPREME_ADMIN_EMAIL } from "@/lib/posts";
import { blockUser, reportUser } from "@/lib/safety";
import { playCupidoSound, startCupidoRingtone } from "@/lib/cupido-sounds";
import { mediaPermissionMessage, requestNativeMediaPermissions } from "@/lib/native-media-permissions";
import {
  CALL_COSTS,
  callErrorMessage,
  canSendGift,
  canStartCall,
  giftErrorMessage,
  type Gift as GiftItem,
} from "@/lib/cupido";

export const Route = createFileRoute("/chat")({
  validateSearch: (search: { userId?: string; startVideo?: boolean; roulette?: boolean; openGift?: boolean }) => search,
  head: () => ({ meta: [{ title: "Chat — Cupido Leudy ❤️" }] }),
  component: ChatPage,
});

type ChatProfile = {
  id: string;
  display_name: string;
  avatar_url: string;
  is_verified_blue: boolean;
  is_gran_liga: boolean;
  email?: string | null;
};

type ConversationRow = {
  id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
  other: ChatProfile | null;
};

type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  audio_path: string;
  media_path: string;
  created_at: string;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_for_all_at: string | null;
  read_at: string | null;
};

type ConversationPreview = Pick<ChatMessage, "sender_id" | "body" | "audio_path" | "media_path" | "created_at" | "deleted_for_all_at"> & {
  conversation_id: string;
};

type CupidoCall = {
  id: string;
  caller_id: string;
  callee_id: string;
  mode: "hot" | "cafe";
  video?: boolean;
  status: "ringing" | "active" | "ended" | "rejected";
  credits_spent: number;
};

type ActiveCall = {
  id: string;
  mode: "hot" | "cafe";
  otherId: string;
  otherName: string;
  role: "caller" | "callee";
  video: boolean;
};

type SignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit };

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

function packageForGift(gift: GiftItem, balance: number, hasPurchased: boolean) {
  const shortage = Math.max(gift.credits - balance, hasPurchased ? 0 : 1);
  return CREDIT_PACKAGES.find((pack) => pack.credits >= shortage) ?? CREDIT_PACKAGES[CREDIT_PACKAGES.length - 1];
}

function formatConversationTime(timestamp: string): string {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("es", { day: "2-digit", month: "short" });
}

function conversationPreviewText(message: ConversationPreview | undefined, viewerId: string): string {
  if (!message) return "Empieza una conversación";
  if (message.deleted_for_all_at) return "Mensaje eliminado";
  const content = message.body?.trim() || (message.audio_path ? "Nota de voz" : message.media_path ? "Foto" : "Nuevo mensaje");
  return message.sender_id === viewerId ? `Tú: ${content}` : content;
}

function ChatPage() {
  const { session, loading: authLoading, onlineUserIds } = useAuth();
  const account = useAccount();
  const viewerId = session?.user.id ?? null;
  const { userId: searchUserId, startVideo: startVideoOnOpen, roulette, openGift } = Route.useSearch();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [giftOpen, setGiftOpen] = useState(false);
  const [adOpen, setAdOpen] = useState(false);
  const [pendingGiftPurchase, setPendingGiftPurchase] = useState<GiftItem | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const mobileBannerSuppressed = useRef(false);
  const [text, setText] = useState("");
  const [replyTarget, setReplyTarget] = useState<{ id: string; body: string; sender_id: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; body: string } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [openingConversation, setOpeningConversation] = useState(false);
  const [chatFilter, setChatFilter] = useState<"all" | "online" | "unread" | "following">("all");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<{ call: CupidoCall; profile: ChatProfile | null } | null>(null);
  const openedRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const startVideoAttemptRef = useRef<string | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isNativeAds()) return;
    if (mobileShowChat) {
      mobileBannerSuppressed.current = true;
      void hideFeedBanner();
    } else if (mobileBannerSuppressed.current) {
      mobileBannerSuppressed.current = false;
      void showFeedBanner("messages");
    }
  }, [mobileShowChat]);

  const paypalConfig = useQuery({
    queryKey: ["paypal-checkout-config"],
    enabled: Boolean(giftOpen && pendingGiftPurchase),
    queryFn: async () => {
      const config = await getPaypalCheckoutConfig();
      return { ...config, clientId: await loadPaypalClientId(config.clientId) };
    },
    staleTime: 30_000,
  });

  const conversations = useQuery({
    queryKey: ["cupido-conversations", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_conversations")
        .select("id,participant_a,participant_b,created_at")
        .or(`participant_a.eq.${viewerId},participant_b.eq.${viewerId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const otherIds = (data ?? []).map((row) =>
        row.participant_a === viewerId ? row.participant_b : row.participant_a,
      );
      const profiles = otherIds.length
        ? await supabase
            .from("cupido_public_profiles")
            .select("id,display_name,avatar_url,is_verified_blue,is_gran_liga,is_official,is_super_admin")
            .in("id", otherIds)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const map = new Map(
        (profiles.data ?? []).map((profile) => [
          profile.id,
          { ...profile, avatar_url: profile.is_official || profile.is_super_admin ? "/cupi-support-avatar.svg" : profile.avatar_url, email: profile.is_official || profile.is_super_admin ? SUPREME_ADMIN_EMAIL : null } as ChatProfile,
        ]),
      );
      return (data ?? []).map<ConversationRow>((row) => {
        const otherId = row.participant_a === viewerId ? row.participant_b : row.participant_a;
        return { ...row, other: map.get(otherId) ?? null };
      });
    },
  });

  const conversationIdsKey = (conversations.data ?? []).map((conversation) => conversation.id).join(",");
  const unreadByConversation = useQuery({
    queryKey: ["cupido-chat-unread", viewerId, conversationIdsKey],
    enabled: Boolean(viewerId && conversationIdsKey),
    queryFn: async () => {
      const ids = conversationIdsKey.split(",").filter(Boolean);
      const { data, error } = await supabase.from("cupido_messages")
        .select("conversation_id")
        .in("conversation_id", ids)
        .neq("sender_id", viewerId!)
        .is("read_at", null);
      if (error) throw error;
      return (data ?? []).reduce<Record<string, number>>((counts, message) => {
        counts[message.conversation_id] = (counts[message.conversation_id] ?? 0) + 1;
        return counts;
      }, {});
    },
  });

  const latestMessages = useQuery({
    queryKey: ["cupido-chat-latest", viewerId, conversationIdsKey],
    enabled: Boolean(viewerId && conversationIdsKey),
    queryFn: async () => {
      const ids = conversationIdsKey.split(",").filter(Boolean);
      const { data, error } = await supabase.from("cupido_messages")
        .select("conversation_id,sender_id,body,audio_path,media_path,created_at,deleted_for_all_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as ConversationPreview[];
    },
  });
  const latestMessageByConversation = useMemo(() => {
    const latest = new Map<string, ConversationPreview>();
    for (const message of latestMessages.data ?? []) {
      if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message);
    }
    return latest;
  }, [latestMessages.data]);

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase.channel(`cupido-chat-unread-live-${viewerId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_messages" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-chat-unread", viewerId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-chat-latest", viewerId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, viewerId]);

  const followedContacts = useQuery({
    queryKey: ["cupido-chat-followed", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase.from("follows").select("following_id").eq("follower_id", viewerId!);
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.following_id));
    },
  });

  const onlineContactIds = onlineUserIds.filter((id) => id !== viewerId);
  const onlineContacts = useQuery({
    queryKey: ["cupido-chat-online-contacts", onlineContactIds.join(",")],
    enabled: onlineContactIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_public_profiles")
        .select("id,display_name,avatar_url,is_verified_blue,is_gran_liga,is_official,is_super_admin")
        .in("id", onlineContactIds);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10_000,
  });

  const filteredConversations = useMemo(() => (conversations.data ?? []).filter((conversation) => {
    if (chatFilter === "online") return Boolean(conversation.other && onlineUserIds.includes(conversation.other.id));
    if (chatFilter === "unread") return (unreadByConversation.data?.[conversation.id] ?? 0) > 0;
    if (chatFilter === "following") return Boolean(conversation.other && followedContacts.data?.has(conversation.other.id));
    return true;
  }), [chatFilter, conversations.data, followedContacts.data, onlineUserIds, unreadByConversation.data]);

  const unreadConversationCount = Object.values(unreadByConversation.data ?? {}).filter((count) => count > 0).length;
  const followedConversationCount = (conversations.data ?? []).filter((conversation) =>
    Boolean(conversation.other && followedContacts.data?.has(conversation.other.id)),
  ).length;
  const searchedConversations = useMemo(() => {
    const term = chatSearch.trim().toLocaleLowerCase();
    const matches = !term ? filteredConversations : filteredConversations.filter((conversation) => {
      const name = conversation.other?.display_name.toLocaleLowerCase() ?? "";
      const preview = conversationPreviewText(latestMessageByConversation.get(conversation.id), viewerId ?? "").toLocaleLowerCase();
      return name.includes(term) || preview.includes(term);
    });
    return matches.sort((left, right) => {
      const leftTime = latestMessageByConversation.get(left.id)?.created_at ?? left.created_at;
      const rightTime = latestMessageByConversation.get(right.id)?.created_at ?? right.created_at;
      return Date.parse(rightTime) - Date.parse(leftTime);
    });
  }, [chatSearch, filteredConversations, latestMessageByConversation, viewerId]);

  useEffect(() => {
    if (!viewerId || !searchUserId || openedRef.current === searchUserId) return;
    let cancelled = false;
    setOpeningConversation(true);
    void (async () => {
      try {
        if (viewerId === searchUserId) throw new Error("No puedes abrir un chat contigo mismo.");
        const { data, error } = await supabase.rpc("cupido_open_conversation", { _other: searchUserId });
        if (error) throw error;
        const conversationId = typeof data === "string" ? data : "";
        if (!conversationId) throw new Error("Supabase no devolvió el id de la conversación.");

        const [conversationResult, profileResult] = await Promise.all([
          supabase
            .from("cupido_conversations")
            .select("id,participant_a,participant_b,created_at")
            .eq("id", conversationId)
            .maybeSingle(),
          supabase
            .from("cupido_public_profiles")
            .select("id,display_name,avatar_url,is_verified_blue,is_gran_liga,is_official,is_super_admin")
            .eq("id", searchUserId)
            .maybeSingle(),
        ]);
        if (conversationResult.error) throw conversationResult.error;
        if (profileResult.error) throw profileResult.error;
        if (!conversationResult.data) throw new Error("La conversación se creó, pero no se pudo cargar.");

        const person = profileResult.data;
        const row: ConversationRow = {
          ...conversationResult.data,
          other: person
            ? ({
                ...person,
                avatar_url: person.is_official || person.is_super_admin ? "/cupi-support-avatar.svg" : person.avatar_url,
                email: person.is_official || person.is_super_admin ? SUPREME_ADMIN_EMAIL : null,
              } as ChatProfile)
            : null,
        };
        if (cancelled) return;
        queryClient.setQueryData<ConversationRow[]>(["cupido-conversations", viewerId], (current) => [
          row,
          ...(current ?? []).filter((item) => item.id !== row.id),
        ]);
        openedRef.current = searchUserId;
        setActiveId(conversationId);
        setMobileShowChat(true);
        void queryClient.invalidateQueries({ queryKey: ["cupido-conversations", viewerId] });
      } catch (error) {
        if (!cancelled) {
          openedRef.current = null;
          toast.error(actionErrorMessage(error, "No se pudo abrir la conversación."));
        }
      } finally {
        if (!cancelled) setOpeningConversation(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchUserId, viewerId, queryClient]);

  useEffect(() => {
    if (activeId) return;
    const first = conversations.data?.[0];
    if (first) setActiveId(first.id);
  }, [activeId, conversations.data]);

  const activeConversation = useMemo(
    () => conversations.data?.find((row) => row.id === activeId) ?? null,
    [conversations.data, activeId],
  );

  const privateCallPrice = useQuery({
    queryKey: ["cupido-private-call-price", activeConversation?.other?.id],
    enabled: Boolean(activeConversation?.other?.id),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_public_profiles").select("call_minute_price").eq("id", activeConversation!.other!.id).maybeSingle();
      if (error) throw error;
      return Number(data?.call_minute_price ?? CALL_COSTS.cafe);
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const calleeId = activeConversation?.other?.id;
    if (!calleeId) return;
    const channel = supabase.channel(`cupido-private-call-price-${calleeId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "price-updated" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-private-call-price", calleeId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [activeConversation?.other?.id, queryClient]);

  const messages = useQuery({
    queryKey: ["cupido-messages", activeId],
    enabled: Boolean(activeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_messages")
        .select("*")
        .eq("conversation_id", activeId!)
        .order("created_at", { ascending: true })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as ChatMessage[];
    },
  });

  const hiddenMessages = useQuery({
    queryKey: ["cupido-hidden-messages", viewerId, activeId],
    enabled: Boolean(viewerId && activeId),
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { from: (table: string) => any })
        .from("cupido_message_hides").select("message_id").eq("user_id", viewerId!);
      if (error) throw error;
      return new Set<string>((data ?? []).map((row: { message_id: string }) => row.message_id));
    },
  });

  const visibleMessages = useMemo(
    () => (messages.data ?? []).filter((message) => !message.deleted_for_all_at && !hiddenMessages.data?.has(message.id)),
    [hiddenMessages.data, messages.data],
  );

  useEffect(() => {
    if (!activeId || !viewerId || !messages.data?.length) return;
    const hasUnread = messages.data.some((message) => message.sender_id !== viewerId && !message.read_at);
    if (!hasUnread) return;
    void (supabase as unknown as { from: (table: string) => any }).from("cupido_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", activeId).neq("sender_id", viewerId).is("read_at", null)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) return;
        void queryClient.invalidateQueries({ queryKey: ["cupido-unread-messages", viewerId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
      });
  }, [activeId, messages.data, queryClient, viewerId]);

  useEffect(() => {
    if (!activeId) return;
    const channel = supabase
      .channel((`cupido-messages-${activeId}`) + "-" + crypto.randomUUID())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cupido_messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const inserted = payload.new as { sender_id?: string };
          if (payload.eventType === "INSERT" && inserted.sender_id && inserted.sender_id !== viewerId) {
            void playCupidoSound("message-received", viewerId);
          }
          void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
          void queryClient.invalidateQueries({ queryKey: ["cupido-unread-messages", viewerId] });
          void queryClient.invalidateQueries({ queryKey: ["cupido-chat-unread", viewerId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeId, queryClient, viewerId]);

  useEffect(() => {
    if (!activeId || !viewerId) return;
    const channel = supabase.channel(`cupido-chat-typing-${activeId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const state = payload as { user_id?: string; typing?: boolean };
        if (state.user_id === viewerId) return;
        setOtherTyping(Boolean(state.typing));
        if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
        if (state.typing) typingTimeoutRef.current = window.setTimeout(() => setOtherTyping(false), 1800);
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      typingChannelRef.current = null;
      if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
      setOtherTyping(false);
      void supabase.removeChannel(channel);
    };
  }, [activeId, viewerId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data]);

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase
      .channel((`cupido-incoming-${viewerId}`) + "-" + crypto.randomUUID())
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cupido_calls", filter: `callee_id=eq.${viewerId}` },
        (payload) => {
          const row = payload.new as CupidoCall;
          if (row.status !== "ringing" || call) return;
          void (async () => {
            const { data } = await supabase
              .from("cupido_public_profiles")
              .select("id,display_name,avatar_url,is_verified_blue,is_gran_liga")
              .eq("id", row.caller_id)
              .maybeSingle();
            setIncoming({ call: row, profile: (data as ChatProfile | null) ?? null });
          })();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "cupido_calls", filter: `callee_id=eq.${viewerId}` },
        (payload) => {
          const row = payload.new as CupidoCall;
          if (row.status !== "ringing") setIncoming((current) => (current?.call.id === row.id ? null : current));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [viewerId, call]);

  useEffect(() => {
    if (!incoming) return;
    return startCupidoRingtone("incoming-call", viewerId);
  }, [incoming?.call.id, viewerId]);

  useEffect(() => {
    if (!call) return;
    const channel = supabase
      .channel((`cupido-call-status-${call.id}`) + "-" + crypto.randomUUID())
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "cupido_calls", filter: `id=eq.${call.id}` },
        (payload) => {
          const row = payload.new as CupidoCall;
          if (row.status === "rejected" || row.status === "ended") {
            setCall(null);
            setIncoming(null);
            toast.info(row.status === "rejected" ? "La llamada fue rechazada." : "La llamada terminó.");
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [call]);

  const sendMessage = useMutation({
    mutationFn: async (body: string) => {
      if (!activeId || !viewerId) throw new Error("Abre una conversación.");
      const { error } = await (supabase as unknown as { from: (table: string) => any })
        .from("cupido_messages")
        .insert({ conversation_id: activeId, sender_id: viewerId, body, reply_to_id: replyTarget?.id ?? null });
      if (error) throw error;
      if (activeConversation?.other?.id) {
        void notifyUser({
          userId: activeConversation.other.id,
          title: "💌 Nuevo mensaje",
          body: body.slice(0, 120),
          kind: "message",
          actorId: viewerId,
          targetId: activeId,
        });
      }
    },
    onSuccess: () => {
      setText("");
      setReplyTarget(null);
      void playCupidoSound("message-sent", viewerId);
      void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo enviar el mensaje."),
  });

  const broadcastTyping = (value: string) => {
    if (!activeId || !viewerId || !typingChannelRef.current) return;
    void typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: viewerId, typing: Boolean(value.trim()) },
    });
  };

  const uploadVoice = async (blob: Blob) => {
    if (!activeId || !viewerId) return;
    const path = `${activeId}/${viewerId}/${Date.now()}.webm`;
    const { error } = await supabase.storage.from("cupido-voice").upload(path, blob, {
      contentType: blob.type || "audio/webm",
    });
    if (error) {
      toast.error("No se pudo subir la nota de voz.");
      return;
    }
    const { error: messageError } = await supabase.from("cupido_messages").insert({
      conversation_id: activeId,
      sender_id: viewerId,
      audio_path: path,
    });
    if (messageError) {
      toast.error("No se pudo enviar la nota de voz.");
      return;
    }
    void playCupidoSound("message-sent", viewerId);
    void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
  };

  const editMessage = async () => {
    if (!editingMessage || !text.trim()) return;
    const { error } = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> })
      .rpc("cupido_edit_message", { _message: editingMessage.id, _body: text.trim() });
    if (error) { toast.error(error.message); return; }
    setEditingMessage(null);
    setReplyTarget(null);
    setText("");
    void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
  };

  const deleteMessage = async (messageId: string, forAll: boolean) => {
    const { error } = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> })
      .rpc("cupido_delete_message", { _message: messageId, _for_all: forAll });
    if (error) { toast.error(error.message); return; }
    void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-hidden-messages", viewerId, activeId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-unread-messages", viewerId] });
  };

  const forwardMessage = async (conversationId: string) => {
    if (!forwardTarget || !viewerId) return;
    const bucket = forwardTarget.audio_path ? "cupido-voice" : forwardTarget.media_path ? "cupido-chat-media" : null;
    const sourcePath = forwardTarget.audio_path || forwardTarget.media_path;
    let copiedPath: string | null = null;
    if (bucket && sourcePath) {
      const { data: file, error: downloadError } = await supabase.storage.from(bucket).download(sourcePath);
      if (downloadError || !file) { toast.error("No se pudo acceder al contenido para reenviarlo."); return; }
      const extension = sourcePath.split(".").pop() || (bucket === "cupido-voice" ? "webm" : "jpg");
      copiedPath = `${conversationId}/${viewerId}/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(copiedPath, file, {
        contentType: file.type || (bucket === "cupido-voice" ? "audio/webm" : "image/jpeg"),
      });
      if (uploadError) { toast.error("No se pudo copiar el contenido al otro chat."); return; }
    }
    const { error } = await (supabase as unknown as { from: (table: string) => any }).from("cupido_messages").insert({
      conversation_id: conversationId,
      sender_id: viewerId,
      body: forwardTarget.body ? `↪ Reenviado\n${forwardTarget.body}` : "",
      audio_path: bucket === "cupido-voice" ? copiedPath : "",
      media_path: bucket === "cupido-chat-media" ? copiedPath : "",
    });
    if (error) {
      if (copiedPath && bucket) void supabase.storage.from(bucket).remove([copiedPath]);
      toast.error("No se pudo reenviar el mensaje.");
      return;
    }
    setForwardTarget(null);
    toast.success("Mensaje reenviado.");
  };

  const openSupportChat = async () => {
    if (!viewerId) { toast.info("Inicia sesi�n para hablar con Cupi Support."); return; }
    setOpeningConversation(true);
    try {
      const { data: admins, error: profileError } = await supabase.from("cupido_public_profiles")
        .select("id,display_name,avatar_url,is_verified_blue,is_gran_liga,is_official,is_super_admin")
        .or("is_super_admin.eq.true,is_official.eq.true")
        .limit(10);
      if (profileError) throw profileError;
      const admin = (admins ?? []).find((person) => person.is_super_admin) ?? (admins ?? []).find((person) => person.is_official);
      if (!admin) throw new Error("No se encontr� la cuenta oficial de soporte.");
      const { data: conversationId, error } = await supabase.rpc("cupido_open_conversation", { _other: admin.id });
      if (error) throw error;
      const { data: row, error: rowError } = await supabase.from("cupido_conversations")
        .select("id,participant_a,participant_b,created_at").eq("id", conversationId).single();
      if (rowError) throw rowError;
      const conversation: ConversationRow = {
        ...row,
        other: { ...admin, avatar_url: "/cupi-support-avatar.svg", email: SUPREME_ADMIN_EMAIL } as ChatProfile,
      };
      queryClient.setQueryData<ConversationRow[]>(["cupido-conversations", viewerId], (current) => [conversation, ...(current ?? []).filter((item) => item.id !== conversation.id)]);
      setActiveId(conversation.id);
      await queryClient.invalidateQueries({ queryKey: ["cupido-conversations", viewerId] });
    } catch (error) {
      toast.error(actionErrorMessage(error, "No se pudo abrir Cupi Support."));
    } finally {
      setOpeningConversation(false);
    }
  };

  const startRecording = async () => {
    if (!activeId) {
      toast.error("Abre una conversación primero.");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Este dispositivo o navegador no admite grabar notas de voz.");
      }
      await requestNativeMediaPermissions({ camera: false, microphone: true });
      const recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream = recordingStream;
      const recorder = new MediaRecorder(recordingStream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        recordingStream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 0) void uploadVoice(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      const name = error instanceof DOMException ? error.name : "";
      const message = mediaPermissionMessage(error) ?? (error instanceof Error && error.message.includes("no admite")
        ? error.message
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? "No encontramos un micrófono conectado a este dispositivo."
          : name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Permite el acceso al micrófono en los ajustes del navegador y vuelve a intentar."
            : "No se pudo iniciar la grabación. Revisa los permisos del micrófono.");
      toast.error(message);
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const uploadChatPhoto = async (file: File | null) => {
    if (!file || !activeId || !viewerId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Elige una foto válida.");
      return;
    }
    if (file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(file.type)) {
      toast.error("La foto debe pesar menos de 10 MB.");
      return;
    }
    const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    const path = `${activeId}/${viewerId}/${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("cupido-chat-media").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      toast.error("No se pudo subir la foto.");
      return;
    }
    const { error } = await supabase.from("cupido_messages").insert({
      conversation_id: activeId,
      sender_id: viewerId,
      media_path: path,
    });
    if (error) {
      toast.error("No se pudo enviar la foto.");
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
    photoInputRef.current && (photoInputRef.current.value = "");
  };

  const startCall = useMutation({
    mutationFn: async ({ mode, video = false }: { mode: "hot" | "cafe"; video?: boolean }) => {
      if (!activeConversation?.other) throw new Error("Elige una conversación.");
      if (!canStartCall(mode, account, privateCallPrice.data ?? CALL_COSTS[mode]))
        throw new Error(
          account.hasPurchased || account.isInfiniteCreditsAdmin
            ? "No tienes monedas brillantes suficientes."
            : "Las llamadas requieren una recarga real confirmada.",
        );
      const { data, error } = await supabase.rpc("cupido_start_call", {
        _callee: activeConversation.other.id,
        _mode: mode,
        _video: video,
      });
      if (error) throw error;
      return {
        id: data as string,
        mode,
        otherId: activeConversation.other.id,
        otherName: activeConversation.other.display_name,
        role: "caller" as const,
        video,
      };
    },
    onSuccess: (data) => setCall(data),
    onError: (error) =>
      toast.error(callErrorMessage(error instanceof Error ? error.message : "", "No se pudo iniciar la llamada.")),
  });

  useEffect(() => {
    if (!startVideoOnOpen || !searchUserId || account.loading || call || !activeConversation || activeConversation.other?.id !== searchUserId) return;
    const key = `${viewerId}:${searchUserId}`;
    if (startVideoAttemptRef.current === key) return;
    startVideoAttemptRef.current = key;
    startCall.mutate({ mode: "cafe", video: true });
  }, [account.loading, activeConversation, call, searchUserId, startCall, startVideoOnOpen, viewerId]);

  useEffect(() => {
    if (openGift && activeConversation?.other?.id === searchUserId) setGiftOpen(true);
  }, [activeConversation?.other?.id, openGift, searchUserId]);

  const skipToNextOnlineCall = async () => {
    if (!call) return;
    const candidates = (onlineContacts.data ?? []).filter((person) => person.id !== call.otherId);
    await supabase.rpc("cupido_end_call", { _id: call.id, _status: "ended" });
    setCall(null);
    if (!candidates.length) {
      toast.info(roulette ? "No hay más personas conectadas. Vuelve a intentarlo en unos instantes." : "No hay otra persona conectada para la siguiente llamada.");
      return;
    }
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    if (!next) return;
    void navigate({ to: "/chat", search: { userId: next.id, startVideo: true, roulette: true } });
  };

  const reportActiveCall = async () => {
    if (!call) return;
    try {
      await reportUser(call.otherId, "Reporte enviado durante una videollamada");
      toast.success("Reporte enviado al equipo de seguridad.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el reporte.");
    }
  };

  const blockActiveCall = async () => {
    if (!call) return;
    try {
      await blockUser(call.otherId);
      await supabase.rpc("cupido_end_call", { _id: call.id, _status: "ended" });
      setCall(null);
      toast.success("Usuario bloqueado y llamada finalizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo bloquear al usuario.");
    }
  };

  const sendGift = useMutation({
    mutationFn: async (gift: GiftItem) => {
      if (!activeConversation?.other) throw new Error("Elige una conversación.");
      if (!canSendGift(gift, account))
        throw new Error(
          account.hasPurchased || account.isInfiniteCreditsAdmin
            ? "No tienes monedas brillantes suficientes."
            : "Confirma una recarga real para desbloquear tus monedas y enviar regalos.",
        );
      const { error } = await supabase.rpc("cupido_send_gift", {
        _receiver: activeConversation.other.id,
        _gift_id: gift.id,
        _credits: gift.credits,
        _cash_value: gift.cash,
      });
      if (error) throw error;
      return activeConversation.other.id;
    },
    onSuccess: (receiverId) => {
      account.refresh();
      setPendingGiftPurchase(null);
      setGiftOpen(false);
      toast.success("Regalo enviado ❤️ Su valor ya es saldo retirable.");

      void queryClient.invalidateQueries({ queryKey: ["cupido-notifications", receiverId] });
    },
    onError: (error) =>
      toast.error(giftErrorMessage(error instanceof Error ? error.message : "", "No se pudo registrar el regalo. Comprueba tu saldo e inténtalo otra vez.")),
  });

  const selectGift = (gift: GiftItem) => {
    if (account.loading || account.balanceUnavailable) return;
    if (!canSendGift(gift, account)) {
      setPendingGiftPurchase(gift);
      return;
    }
    setPendingGiftPurchase(null);
    sendGift.mutate(gift);
  };

  const answerCall = async (accept: boolean) => {
    if (!incoming) return;
    const { error } = await supabase.rpc("cupido_answer_call", { _id: incoming.call.id, _accept: accept });
    if (error) {
      toast.error("No se pudo responder la llamada.");
      return;
    }
    if (accept) {
      setCall({
        id: incoming.call.id,
        mode: incoming.call.mode,
        otherId: incoming.call.caller_id,
        otherName: incoming.profile?.display_name ?? "Alguien",
        role: "callee",
        video: Boolean(incoming.call.video),
      });
    }
    setIncoming(null);
  };

  if (authLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">Cargando chat…</div>;
  }

  if (!viewerId) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <h1 className="font-display text-2xl text-white">Inicia sesión para chatear</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Conecta con personas reales, envía notas de voz y recibe regalos.
          </p>
          <Button asChild className="mt-5">
            <Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-full min-h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-background px-3 pb-2 pt-10 sm:px-5">
      <div className={mobileShowChat && activeConversation ? "hidden md:block" : ""}>
          <header className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Mensajes</h1>
            <div className="flex shrink-0 items-center gap-2">
              {chatSearchOpen && (
                <Input
                  autoFocus
                  value={chatSearch}
                  onChange={(event) => setChatSearch(event.target.value)}
                  placeholder="Buscar"
                  aria-label="Buscar conversaciones"
                  className="h-10 w-[min(42vw,180px)] rounded-full bg-card px-3"
                />
              )}
              <NotificationBell />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10 rounded-full"
                aria-label={chatSearchOpen ? "Cerrar búsqueda de chats" : "Buscar chat"}
                aria-pressed={chatSearchOpen}
                onClick={() => {
                  setChatSearchOpen(!chatSearchOpen);
                  if (chatSearchOpen) setChatSearch("");
                }}
              >
                <Search className="size-4" />
              </Button>
            </div>
          </header>
          <nav aria-label="Filtros de chat" className="mb-3 flex shrink-0 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {([
              ["all", "Todos", conversations.data?.length ?? 0],
              ["online", "En línea", (conversations.data ?? []).filter((row) => row.other && onlineUserIds.includes(row.other.id)).length],
              ["unread", "Sin leer", unreadConversationCount],
              ["following", "Seguidos", followedConversationCount],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setChatFilter(value)}
                aria-pressed={chatFilter === value}
                data-active={chatFilter === value}
                className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-xs font-semibold text-muted-foreground transition data-[active=true]:border-primary/30 data-[active=true]:bg-primary/10 data-[active=true]:text-foreground"
              >
                {label}
                {(value === "unread" || value === "following") && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">{count}</span>
                )}
              </button>
            ))}
          </nav>
          {isNativeAds() && <div aria-label="Anuncio de AdMob" className="h-[52px] w-full shrink-0" />}
          <Button
            type="button"
            onClick={() => {
              if (!viewerId) {
                toast.info("Inicia sesión para ganar monedas viendo anuncios.");
                void navigate({ to: "/auth", search: { ref: "" } });
                return;
              }
              setAdOpen(true);
            }}
            className="mb-3 h-11 w-full shrink-0 justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 to-yellow-400 text-xs font-extrabold tracking-wide text-amber-950 shadow-md shadow-amber-500/15 hover:from-amber-200 hover:to-yellow-300"
          >
            <CoinIcon className="size-5" /> GANA MONEDAS GRATIS
          </Button>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-3xl border border-border bg-card lg:grid-cols-[320px_1fr]">
        <aside className={`${mobileShowChat ? "hidden" : "flex"} h-full min-h-0 min-w-0 flex-col overflow-y-auto border-b border-border md:flex lg:border-b-0 lg:border-r`}>

          {conversations.isLoading && <p className="p-4 text-sm text-muted-foreground">Cargando…</p>}
          {conversations.isError && (
            <div className="space-y-2 p-4 text-sm text-red-200">
              <p>{actionErrorMessage(conversations.error, "No se pudieron cargar las conversaciones.")}</p>
              <Button variant="outline" size="sm" onClick={() => void conversations.refetch()}>Reintentar</Button>
            </div>
          )}
          {!conversations.isLoading && !conversations.isError && !conversations.data?.length && !openingConversation && (
            <p className="p-4 text-sm text-muted-foreground">Aún no tienes conversaciones. Busca personas en Comunidad.</p>
          )}
          {openingConversation && <p className="p-4 text-sm text-muted-foreground">Abriendo conversación…</p>}
          {!conversations.isLoading && !conversations.isError && conversations.data?.length && !searchedConversations.length && <p className="p-4 text-sm text-muted-foreground">No hay chats que coincidan con esta búsqueda o filtro.</p>}
          {searchedConversations.map((row) => {
            const latest = latestMessageByConversation.get(row.id);
            const unreadCount = unreadByConversation.data?.[row.id] ?? 0;
            const isOnline = Boolean(row.other && onlineUserIds.includes(row.other.id));
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => { setActiveId(row.id); setMobileShowChat(true); }}
                className="flex w-full min-w-0 items-center gap-3 border-b border-border/70 px-4 py-3 text-left transition hover:bg-secondary/60"
              >
                <div className="relative shrink-0">
                  <GranLigaStar active={row.other?.is_gran_liga} />
                  <Avatar className="size-14 border border-border">
                    <AvatarImage src={row.other?.avatar_url ?? ""} alt={row.other?.display_name ?? "Chat"} />
                    <AvatarFallback className="bg-primary/10 text-sm text-primary">
                      {(row.other?.display_name ?? "C").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-card ${isOnline ? "bg-emerald-500" : "bg-zinc-500"}`} />
                </div>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">{row.other?.display_name ?? "Miembro"}</span>
                      <VerifiedBadge email={row.other?.email} verified={row.other?.is_verified_blue} granLiga={row.other?.is_gran_liga} className="size-4 shrink-0" />
                    </span>
                    <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={latest?.created_at ?? row.created_at}>
                      {formatConversationTime(latest?.created_at ?? row.created_at)}
                    </time>
                  </span>
                  <span className="mt-1 flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-xs text-muted-foreground">
                      {conversationPreviewText(latest, viewerId ?? "")}
                    </span>
                    {unreadCount > 0 && <span className="size-2.5 shrink-0 rounded-full bg-rose-500 ring-4 ring-rose-500/10" aria-label="Mensajes sin leer" />}
                  </span>
                  <span className={`mt-1 flex items-center gap-1 text-[10px] ${isOnline ? "text-emerald-300" : "text-muted-foreground"}`}>
                    <span className={`size-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-zinc-500"}`} />
                    {isOnline ? "En línea" : "Desconectado"}
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className={`${mobileShowChat ? "flex" : "hidden md:flex"} h-full min-h-0 min-w-0 flex-col`}>
          {activeConversation ? (
            <>
              <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-3 sm:gap-3 sm:px-4">
                <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 md:hidden" aria-label="Volver a conversaciones" onClick={() => setMobileShowChat(false)}><ArrowLeft className="size-4" /></Button>
                <div className="relative shrink-0"><GranLigaStar active={activeConversation.other?.is_gran_liga} /><Avatar className="h-10 w-10">
                  <AvatarImage src={activeConversation.other?.avatar_url ?? ""} alt={activeConversation.other?.display_name ?? ""} />
                  <AvatarFallback className="bg-pink-500/20 text-sm text-pink-100">
                    {(activeConversation.other?.display_name ?? "C").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar></div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold text-white">
                    {activeConversation.other ? (
                      <Link to="/perfil" search={{ userId: activeConversation.other.id }} className="truncate hover:underline">
                        {activeConversation.other.display_name}
                      </Link>
                    ) : "Miembro"}
                    <VerifiedBadge email={activeConversation.other?.email} verified={activeConversation.other?.is_verified_blue} granLiga={activeConversation.other?.is_gran_liga} className="h-4 w-4" />
                  </p>
                  <p className={`flex items-center gap-1 text-xs ${onlineUserIds.includes(activeConversation.other?.id ?? "") ? "text-emerald-300" : "text-muted-foreground"}`}>
                    {otherTyping ? "Escribiendo…" : <><span className={`size-1.5 rounded-full ${onlineUserIds.includes(activeConversation.other?.id ?? "") ? "bg-emerald-400" : "bg-zinc-500"}`} />{onlineUserIds.includes(activeConversation.other?.id ?? "") ? "En línea" : "Desconectado"}</>}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-100" title="Tus monedas brillantes">
                  <CoinIcon className="size-4" />
                  {account.loading ? "..." : account.balanceUnavailable ? "—" : account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}
                </span>
                <Button size="sm" variant="outline" onClick={() => setGiftOpen(true)} className="gap-1">
                  <Gift className="h-4 w-4" /> Regalar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startCall.mutate({ mode: "cafe" })}
                  disabled={startCall.isPending}
                  title={`${privateCallPrice.data ?? CALL_COSTS.cafe} monedas brillantes por minuto`}
                >
                  <Coffee /> Café · {privateCallPrice.data ?? CALL_COSTS.cafe}/min
                </Button>
                <Button
                  size="sm"
                  onClick={() => startCall.mutate({ mode: "hot" })}
                  disabled={startCall.isPending}
                  title={`${privateCallPrice.data ?? CALL_COSTS.hot} monedas brillantes por minuto`}
                >
                  <Flame /> Hot · {privateCallPrice.data ?? CALL_COSTS.hot}/min
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startCall.mutate({ mode: "cafe", video: true })}
                  disabled={startCall.isPending}
                  title={`${privateCallPrice.data ?? CALL_COSTS.cafe} monedas brillantes por minuto`}
                >
                  <Video /> Video · {privateCallPrice.data ?? CALL_COSTS.cafe}/min
                </Button>
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.isLoading && <p className="text-sm text-muted-foreground">Cargando mensajes…</p>}
                {!messages.isLoading && !visibleMessages.length && (
                  <p className="text-sm text-muted-foreground">Envía el primer mensaje y rompe el hielo ❤️</p>
                )}
                {visibleMessages.map((message) => {
                  const mine = message.sender_id === viewerId;
                  const quoted = message.reply_to_id ? messages.data?.find((item) => item.id === message.reply_to_id) : null;
                  return (
                    <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                          mine ? "bg-pink-600 text-white" : "bg-white/10 text-slate-100"
                        }`}
                      >
                        {quoted && <div className="mb-2 rounded-md border-l-2 border-pink-200/70 bg-black/15 px-2 py-1 text-xs text-white/70"><span className="font-semibold">{quoted.sender_id === viewerId ? "Tú" : activeConversation.other?.display_name}</span><p className="truncate">{quoted.body || (quoted.audio_path ? "Nota de voz" : "Foto")}</p></div>}
                        {message.audio_path ? (
                          <VoiceBubble path={message.audio_path} />
                        ) : message.media_path ? (
                          <ChatPhoto path={message.media_path} />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        )}
                        <p className={`mt-1 text-[10px] ${mine ? "text-pink-100/80" : "text-muted-foreground"}`}>
                          {message.edited_at ? "Editado · " : ""}{new Date(message.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                          {mine && <span className="ml-1 font-semibold text-sky-200">{message.read_at ? "✓✓ Leído" : "✓"}</span>}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-white/10 pt-1">
                          <button type="button" className="rounded px-1 text-[10px] text-white/70 hover:text-white" onClick={() => setReplyTarget({ id: message.id, body: message.body || (message.audio_path ? "Nota de voz" : "Foto"), sender_id: message.sender_id })} aria-label="Responder citando este mensaje"><Reply className="inline size-3" /> Responder</button>
                          {message.body && <button type="button" className="rounded px-1 text-[10px] text-white/70 hover:text-white" onClick={() => void navigator.clipboard.writeText(message.body).then(() => toast.success("Mensaje copiado."), () => toast.error("No se pudo copiar."))}><Copy className="inline size-3" /> Copiar</button>}
                          {mine && message.body && <button type="button" className="rounded px-1 text-[10px] text-white/70 hover:text-white" onClick={() => { setEditingMessage({ id: message.id, body: message.body }); setText(message.body); setReplyTarget(null); }}><Pencil className="inline size-3" /> Editar</button>}
                          {(message.body || message.audio_path || message.media_path) && <button type="button" className="rounded px-1 text-[10px] text-white/70 hover:text-white" onClick={() => setForwardTarget(message)}><Forward className="inline size-3" /> Reenviar</button>}
                          <button type="button" className="rounded px-1 text-[10px] text-white/70 hover:text-white" onClick={() => void deleteMessage(message.id, false)}><Trash2 className="inline size-3" /> Eliminar para mí</button>
                          {mine && <button type="button" className="rounded px-1 text-[10px] text-white/70 hover:text-white" onClick={() => void deleteMessage(message.id, true)}><X className="inline size-3" /> Eliminar para todos</button>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-white/10 p-3">
                <p className="mb-2 text-center text-[11px] text-muted-foreground">Mensajes de texto, notas de voz y fotos son gratis. Las llamadas privadas cuestan monedas.</p>
                {(replyTarget || editingMessage) && <div className="mb-2 flex items-center gap-2 rounded-lg border border-pink-300/20 bg-pink-500/10 px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{editingMessage ? "Editando mensaje" : `Respondiendo a ${replyTarget?.sender_id === viewerId ? "ti" : activeConversation.other?.display_name}: ${replyTarget?.body}`}</span><button type="button" onClick={() => { setReplyTarget(null); setEditingMessage(null); setText(""); }} aria-label="Cancelar respuesta o edición"><X className="size-4" /></button></div>}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant={recording ? "destructive" : "outline"}
                    onClick={recording ? stopRecording : () => void startRecording()}
                    aria-label={recording ? "Detener nota de voz" : "Grabar nota de voz"}
                  >
                    {recording ? <Square /> : <Mic />}
                  </Button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void uploadChatPhoto(event.target.files?.[0] ?? null)}
                  />
                  <Button type="button" size="icon" variant="outline" onClick={() => photoInputRef.current?.click()} aria-label="Enviar foto gratis">
                    <ImagePlus />
                  </Button>
                  <Input
                    data-message-composer="true"
                    value={text}
                    onChange={(event) => { setText(event.target.value); broadcastTyping(event.target.value); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (text.trim()) editingMessage ? void editMessage() : sendMessage.mutate(text.trim());
                      }
                    }}
                    placeholder="Escribe un mensaje…"
                    maxLength={1000}
                  />
                  <Button
                    type="button"
                    onClick={() => text.trim() && (editingMessage ? void editMessage() : sendMessage.mutate(text.trim()))}
                    disabled={sendMessage.isPending || !text.trim()}
                  >
                    {sendMessage.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <Badge variant="secondary">Chat</Badge>
              <p className="text-lg text-white">Elige una conversación</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Abre una charla existente o visita el perfil de alguien para iniciar una nueva.
              </p>
            </div>
          )}
        </section>
      </div>

      <Dialog open={Boolean(incoming)} onOpenChange={(open) => !open && void answerCall(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {incoming?.call.video ? "Videollamada" : `Llamada ${incoming?.call.mode === "hot" ? "Hot" : "Café"}`} entrante
            </DialogTitle>
            <DialogDescription>
              {incoming?.profile?.display_name ?? "Alguien"} quiere hablar contigo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14">
              <AvatarImage src={incoming?.profile?.avatar_url ?? ""} alt="" />
              <AvatarFallback className="bg-pink-500/20 text-pink-100">
                {(incoming?.profile?.display_name ?? "C").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 text-sm text-muted-foreground">
              {incoming?.call.video
                ? "Videollamada entrante con audio y cámara."
                : incoming?.call.mode === "hot"
                  ? "Llamada Hot con audio privado."
                  : "Llamada Café para conocer mejor a la persona."}
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" onClick={() => void answerCall(true)}>
              <Phone /> Aceptar
            </Button>
            <Button className="flex-1" variant="destructive" onClick={() => void answerCall(false)}>
              <PhoneOff /> Rechazar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={giftOpen} onOpenChange={(open) => { setGiftOpen(open); if (!open) setPendingGiftPurchase(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-pink-300" /> Enviar regalo a {activeConversation?.other?.display_name ?? "tu pareja"}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <CoinIcon className="size-4" /> Tienes {account.loading ? "..." : account.balanceUnavailable ? "—" : account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")} monedas brillantes. Cada regalo suma saldo retirable a quien lo recibe.
            </DialogDescription>
          </DialogHeader>
          <GiftGrid
            onSelect={selectGift}
            disabled={sendGift.isPending || account.loading || account.balanceUnavailable || !activeConversation?.other}
            compact
          />
          {pendingGiftPurchase && (() => {
            const pack = packageForGift(pendingGiftPurchase, account.balance, account.hasPurchased);
            const readyToSend = canSendGift(pendingGiftPurchase, account);
            return (
              <section className="space-y-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
                <div>
                  <p className="font-semibold text-white">{readyToSend ? `${pendingGiftPurchase.name} está listo para enviar` : `Desbloquea ${pendingGiftPurchase.name}`}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{readyToSend ? "Elige si quieres enviarlo ahora. El saldo restante se queda en tu cuenta." : `Compra ${pack?.credits.toLocaleString("es")} monedas por US$${pack?.price}. El regalo no se enviará hasta que pulses el botón; las monedas restantes seguirán disponibles.`}</p>
                </div>
                {readyToSend ? (
                  <Button type="button" className="w-full" disabled={sendGift.isPending} onClick={() => sendGift.mutate(pendingGiftPurchase)}>
                    {sendGift.isPending ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />} Enviar {pendingGiftPurchase.name}
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
        </DialogContent>
      </Dialog>

      <AdRewardDialog open={adOpen} onOpenChange={setAdOpen} />

      <Dialog open={Boolean(forwardTarget)} onOpenChange={(open) => !open && setForwardTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reenviar mensaje</DialogTitle>
            <DialogDescription>Elige el chat al que quieres reenviar este mensaje.</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {(conversations.data ?? []).filter((row) => row.id !== activeId).map((row) => (
              <Button key={row.id} type="button" variant="outline" className="w-full justify-start" onClick={() => void forwardMessage(row.id)}>
                <Avatar className="size-7"><AvatarImage src={row.other?.avatar_url ?? ""} /><AvatarFallback>{row.other?.display_name.slice(0, 1) ?? "C"}</AvatarFallback></Avatar>
                {row.other?.display_name ?? "Miembro"}
              </Button>
            ))}
            {(conversations.data ?? []).length < 2 && <p className="text-sm text-muted-foreground">Necesitas otro chat para reenviar este mensaje.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {call && (
        <CallRoom
          callId={call.id}
          mode={call.mode}
          video={call.video}
          otherName={call.otherName}
          role={call.role}
          viewerId={viewerId}
          onClose={() => setCall(null)}
          onSkip={() => void skipToNextOnlineCall()}
          onOpenGift={() => { setPendingGiftPurchase(null); setGiftOpen(true); }}
          onReport={() => void reportActiveCall()}
          onBlock={() => void blockActiveCall()}
        />
      )}
    </main>
  );
}

function ChatPhoto({ path }: { path: string }) {
  const photo = useQuery({
    queryKey: ["cupido-chat-photo", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("cupido-chat-media").createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  if (!photo.data) return <p className="text-xs text-muted-foreground">{photo.isError ? "No se pudo cargar la foto." : "Cargando foto…"}</p>;
  return <img src={photo.data} alt="Foto privada" className="max-h-72 max-w-full rounded-xl object-contain" />;
}

function VoiceBubble({ path }: { path: string }) {
  const { data, isError } = useQuery({
    queryKey: ["cupido-voice", path],
    queryFn: async () => {
      const { data: signed, error } = await supabase.storage.from("cupido-voice").createSignedUrl(path, 3600);
      if (error) throw error;
      return signed.signedUrl;
    },
  });
  if (isError) return <span className="text-xs">Nota de voz no disponible</span>;
  if (!data) return <span className="text-xs">Cargando nota de voz…</span>;
  return <audio controls src={data} className="h-9 max-w-[220px]" />;
}

function CallRoom({
  callId,
  mode,
  video: videoCall,
  otherName,
  role,
  viewerId,
  onClose,
  onSkip,
  onOpenGift,
  onReport,
  onBlock,
}: {
  callId: string;
  mode: "hot" | "cafe";
  video: boolean;
  otherName: string;
  role: "caller" | "callee";
  viewerId: string;
  onClose: () => void;
  onSkip: () => void;
  onOpenGift: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  const [status, setStatus] = useState("Conectando…");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const closedRef = useRef(false);
  const stopRingRef = useRef<(() => void) | null>(null);
  const billedMinuteRef = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (role !== "caller" || status !== "En llamada") return;
    const elapsedMinute = Math.floor(seconds / 60);
    if (elapsedMinute <= billedMinuteRef.current) return;
    billedMinuteRef.current = elapsedMinute;
    void (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string } | null }> })
      .rpc("cupido_bill_call_minute", { _call: callId })
      .then(({ data, error }) => {
        if (error) {
          toast.error("No se pudo confirmar el saldo de la llamada.");
          onClose();
          return;
        }
        if (!data) {
          toast.info("La llamada termin� porque se agotaron tus monedas.");
          onClose();
        }
      });
  }, [callId, onClose, role, seconds, status]);

  useEffect(() => {
    if (role !== "caller") return;
    stopRingRef.current = startCupidoRingtone("outgoing-call", viewerId);
    return () => {
      stopRingRef.current?.();
      stopRingRef.current = null;
    };
  }, [callId, role, viewerId]);

  useEffect(() => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;
    const channel = supabase.channel(`cupido-call-${callId}`);
    channelRef.current = channel;

    const sendSignal = async (payload: SignalPayload) => {
      await channel.send({ type: "broadcast", event: "signal", payload });
    };

    const flushCandidates = async () => {
      for (const candidate of pendingCandidatesRef.current) {
        await pc.addIceCandidate(candidate).catch(() => undefined);
      }
      pendingCandidatesRef.current = [];
    };

    const makeOffer = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal({ kind: "offer", sdp: offer });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal({ kind: "ice-candidate", candidate: event.candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      stopRingRef.current?.();
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (videoCall && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.volume = 1;
        void remoteVideoRef.current.play().catch(() => undefined);
      } else if (event.track.kind === "audio" && remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.volume = 1;
        void remoteAudioRef.current.play().catch(() => undefined);
      }
      if (event.track.kind === "audio") setStatus("En llamada");
    };

    channel.on("broadcast", { event: "ready" }, (message) => {
      const payload = message["payload"] as { role?: string };
      if (role === "caller" && payload.role === "callee") void makeOffer();
      if (role === "callee" && payload.role === "caller") {
        void channel.send({ type: "broadcast", event: "ready", payload: { role: "callee" } });
      }
    });

    channel.on("broadcast", { event: "signal" }, (message) => {
      const payload = message["payload"] as SignalPayload;
      void (async () => {
        if (payload.kind === "offer") {
          await pc.setRemoteDescription(payload.sdp);
          await flushCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal({ kind: "answer", sdp: answer });
        } else if (payload.kind === "answer") {
          stopRingRef.current?.();
          await pc.setRemoteDescription(payload.sdp);
          await flushCandidates();
        } else if (payload.kind === "ice-candidate") {
          if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate).catch(() => undefined);
          else pendingCandidatesRef.current.push(payload.candidate);
        }
      })();
    });

    void (async () => {
      try {
        await requestNativeMediaPermissions({ camera: videoCall, microphone: true });
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoCall ? { facingMode: { ideal: "user" } } : false });
        if (closedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        if (videoCall && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          void localVideoRef.current.play().catch(() => undefined);
        }
        stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
        stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream));
        channel.subscribe((state) => {
          if (state === "SUBSCRIBED") {
            void channel.send({ type: "broadcast", event: "ready", payload: { role } });
          }
        });
      } catch (error) {
        setStatus(videoCall ? "Cámara o micrófono no disponible" : "Micrófono no disponible");
        toast.error(mediaPermissionMessage(error) ?? (videoCall ? "No se pudo acceder a la cámara y el micrófono para la videollamada." : "No se pudo acceder al micrófono para la llamada."));
      }
    })();

    return () => {
      closedRef.current = true;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      pc.close();
      void supabase.removeChannel(channel);
    };
  }, [callId, role, videoCall]);

  const endCall = async () => {
    await supabase.rpc("cupido_end_call", { _id: callId, _status: "ended" });
    onClose();
  };

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const flipCamera = async () => {
    if (!videoCall || !navigator.mediaDevices?.getUserMedia || !pcRef.current || !localStreamRef.current) return;
    const nextFacing: "user" | "environment" = facingMode === "user" ? "environment" : "user";
    try {
      await requestNativeMediaPermissions({ camera: true, microphone: false });
      const replacementStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: nextFacing } }, audio: false });
      const nextTrack = replacementStream.getVideoTracks()[0];
      if (!nextTrack) throw new Error("No se encontró la cámara seleccionada.");
      const sender = pcRef.current.getSenders().find((item) => item.track?.kind === "video");
      if (!sender) throw new Error("La videollamada no tiene una pista de video activa.");
      await sender.replaceTrack(nextTrack);
      const previousTrack = localStreamRef.current.getVideoTracks()[0];
      if (previousTrack) {
        localStreamRef.current.removeTrack(previousTrack);
        previousTrack.stop();
      }
      localStreamRef.current.addTrack(nextTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setFacingMode(nextFacing);
    } catch (error) {
      toast.error(mediaPermissionMessage(error) ?? (error instanceof Error ? error.message : "No se pudo cambiar la cámara."));
    }
  };

  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");

  return (
    <Dialog open onOpenChange={(open) => !open && void endCall()}>
      <DialogContent className={`${videoCall ? "max-w-2xl" : "max-w-sm"} text-center`}>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-center gap-2">
            {videoCall ? <Video className="text-pink-300" /> : mode === "hot" ? <Flame className="text-pink-400" /> : <Coffee className="text-amber-300" />}
            {videoCall ? "Videollamada" : `Llamada ${mode === "hot" ? "Hot" : "Café"}`}
          </DialogTitle>
          <DialogDescription>Con {otherName}</DialogDescription>
        </DialogHeader>
        {videoCall ? (
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video ref={remoteVideoRef} autoPlay playsInline webkit-playsinline="true" muted={false} className="aspect-video w-full object-cover" />
            <video ref={localVideoRef} autoPlay playsInline webkit-playsinline="true" muted className="absolute bottom-3 right-3 aspect-video w-28 rounded-xl border border-white/30 object-cover sm:w-40" />
          </div>
        ) : (
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-pink-500/20 text-3xl">
            {otherName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <p className="text-sm text-muted-foreground">{status}</p>
        <p className="font-mono text-lg text-white">
          {minutes}:{remainder}
        </p>
        {!videoCall && <audio ref={remoteAudioRef} autoPlay playsInline muted={false} className="hidden" />}
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant={muted ? "destructive" : "outline"} size="icon" onClick={toggleMute} aria-label="Silenciar">
            {muted ? <MicOff /> : <Mic />}
          </Button>
          {videoCall && <Button variant="outline" onClick={() => void flipCamera()}><FlipHorizontal className="size-4" /> Voltear</Button>}
          <Button variant="outline" onClick={onOpenGift}><Gift className="size-4" /> Regalo</Button>
          <Button variant="outline" onClick={onSkip}><SkipForward className="size-4" /> Siguiente</Button>
          <Button variant="outline" size="icon" onClick={onReport} aria-label="Reportar y seguir"><Flag /></Button>
          <Button variant="destructive" size="icon" onClick={onBlock} aria-label="Bloquear y colgar"><Ban /></Button>
          <Button variant="destructive" onClick={() => void endCall()}>
            <PhoneOff /> Colgar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
