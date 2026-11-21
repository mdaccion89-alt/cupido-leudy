import { useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Coffee,
  Flame,
  Gift,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Send,
  Square,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { notifyUser, SUPREME_ADMIN_EMAIL } from "@/lib/posts";
import { playCupidoSound, startCupidoRingtone } from "@/lib/cupido-sounds";
import {
  CALL_COSTS,
  callErrorMessage,
  canSendGift,
  canStartCall,
  FREE_GIFT_MAX_CREDITS,
  giftErrorMessage,
  type Gift as GiftItem,
} from "@/lib/cupido";

export const Route = createFileRoute("/chat")({
  validateSearch: (search: { userId?: string }) => search,
  head: () => ({ meta: [{ title: "Chat — Cupido Leudy ❤️" }] }),
  component: ChatPage,
});

type ChatProfile = {
  id: string;
  display_name: string;
  avatar_url: string;
  is_verified_blue: boolean;
  email?: string | null;
};

type ConversationRow = {
  id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
  other: ChatProfile | null;
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
  | { kind: "ice"; candidate: RTCIceCandidateInit };

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

function ChatPage() {
  const { session, loading: authLoading } = useAuth();
  const account = useAccount();
  const viewerId = session?.user.id ?? null;
  const { userId: searchUserId } = Route.useSearch();
  const queryClient = useQueryClient();
  const [giftOpen, setGiftOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [openingConversation, setOpeningConversation] = useState(false);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<{ call: CupidoCall; profile: ChatProfile | null } | null>(null);
  const openedRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
            .select("id,display_name,avatar_url,is_verified_blue,is_official,is_super_admin")
            .in("id", otherIds)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const map = new Map(
        (profiles.data ?? []).map((profile) => [
          profile.id,
          { ...profile, email: profile.is_official || profile.is_super_admin ? SUPREME_ADMIN_EMAIL : null } as ChatProfile,
        ]),
      );
      return (data ?? []).map<ConversationRow>((row) => {
        const otherId = row.participant_a === viewerId ? row.participant_b : row.participant_a;
        return { ...row, other: map.get(otherId) ?? null };
      });
    },
  });

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
            .select("id,display_name,avatar_url,is_verified_blue,is_official,is_super_admin")
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
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!activeId) return;
    const channel = supabase
      .channel(`cupido-messages-${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cupido_messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const inserted = payload.new as { sender_id?: string };
          if (inserted.sender_id && inserted.sender_id !== viewerId) {
            void playCupidoSound("message-received", viewerId);
          }
          void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeId, queryClient, viewerId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data]);

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase
      .channel(`cupido-incoming-${viewerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cupido_calls", filter: `callee_id=eq.${viewerId}` },
        (payload) => {
          const row = payload.new as CupidoCall;
          if (row.status !== "ringing" || call) return;
          void (async () => {
            const { data } = await supabase
              .from("cupido_public_profiles")
              .select("id,display_name,avatar_url,is_verified_blue")
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
      .channel(`cupido-call-status-${call.id}`)
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
      const { error } = await supabase
        .from("cupido_messages")
        .insert({ conversation_id: activeId, sender_id: viewerId, body });
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
      void playCupidoSound("message-sent", viewerId);
      void queryClient.invalidateQueries({ queryKey: ["cupido-messages", activeId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo enviar el mensaje."),
  });

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

  const startRecording = async () => {
    if (!activeId) {
      toast.error("Abre una conversación primero.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 0) void uploadVoice(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error("No se pudo acceder al micrófono.");
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
      if (!canStartCall(mode, account))
        throw new Error(
          account.hasPurchased || account.isSupremeAdmin
            ? "No tienes monedas brillantes suficientes."
            : "Las llamadas requieren compra o recarga de monedas brillantes.",
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

  const sendGift = useMutation({
    mutationFn: async (gift: GiftItem) => {
      if (!activeConversation?.other) throw new Error("Elige una conversación.");
      if (!canSendGift(gift, account))
        throw new Error(
          account.hasPurchased || account.isAdmin
            ? "No tienes monedas brillantes suficientes."
            : `Los regalos de más de ${FREE_GIFT_MAX_CREDITS} monedas requieren compra o recarga.`,
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
      setGiftOpen(false);
      toast.success("Regalo enviado ❤️ Su valor ya es saldo retirable.");
      void notifyUser({
        userId: receiverId,
        title: "🎁 Recibiste un regalo",
        body: "Alguien te envió un regalo en Cupido Leudy ❤️",
        kind: "gift",
        actorId: viewerId,
        targetId: activeConversation?.id ?? null,
      });
      void queryClient.invalidateQueries({ queryKey: ["cupido-notifications", receiverId] });
    },
    onError: (error) =>
      toast.error(giftErrorMessage(error instanceof Error ? error.message : "", "No se pudo enviar el regalo.")),
  });

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
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-white">Chat</h1>
          <p className="text-sm text-muted-foreground">Conversaciones privadas, notas de voz y llamadas Café o Hot.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/comunidad">Descubrir personas</Link>
        </Button>
      </div>

      <div className="grid overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] lg:grid-cols-[320px_1fr]">
        <aside className="max-h-[70vh] overflow-y-auto border-b border-white/10 lg:border-b-0 lg:border-r">
          <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Conversaciones
          </div>
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
          {conversations.data?.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setActiveId(row.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.06] ${
                row.id === activeId ? "bg-pink-500/10" : ""
              }`}
            >
              <Avatar className="h-11 w-11 border border-white/10">
                <AvatarImage src={row.other?.avatar_url ?? ""} alt={row.other?.display_name ?? "Chat"} />
                <AvatarFallback className="bg-pink-500/20 text-sm text-pink-100">
                  {(row.other?.display_name ?? "C").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-sm font-medium text-white">
                  {row.other?.display_name ?? "Miembro"}
                  <VerifiedBadge email={row.other?.email} verified={row.other?.is_verified_blue} className="h-4 w-4" />
                </span>
                <span className="block truncate text-xs text-muted-foreground">Toca para abrir la conversación</span>
              </span>
            </button>
          ))}
        </aside>

        <section className="flex min-h-[60vh] flex-col">
          {activeConversation ? (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={activeConversation.other?.avatar_url ?? ""} alt={activeConversation.other?.display_name ?? ""} />
                  <AvatarFallback className="bg-pink-500/20 text-sm text-pink-100">
                    {(activeConversation.other?.display_name ?? "C").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold text-white">
                    {activeConversation.other?.display_name ?? "Miembro"}
                    <VerifiedBadge email={activeConversation.other?.email} verified={activeConversation.other?.is_verified_blue} className="h-4 w-4" />
                  </p>
                  <p className="text-xs text-muted-foreground">Chat privado de Cupido Leudy</p>
                </div>
                <span className="flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-100" title="Tus monedas brillantes">
                  <CoinIcon className="size-4" />
                  {account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}
                </span>
                <Button size="sm" variant="outline" onClick={() => setGiftOpen(true)} className="gap-1">
                  <Gift className="h-4 w-4" /> Regalar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startCall.mutate({ mode: "cafe" })}
                  disabled={startCall.isPending}
                  title={`${CALL_COSTS.cafe} monedas brillantes`}
                >
                  <Coffee /> Café
                </Button>
                <Button
                  size="sm"
                  onClick={() => startCall.mutate({ mode: "hot" })}
                  disabled={startCall.isPending}
                  title={`${CALL_COSTS.hot} monedas brillantes`}
                >
                  <Flame /> Hot
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startCall.mutate({ mode: "cafe", video: true })}
                  disabled={startCall.isPending}
                  title={`${CALL_COSTS.cafe} monedas brillantes`}
                >
                  <Video /> Video
                </Button>
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.isLoading && <p className="text-sm text-muted-foreground">Cargando mensajes…</p>}
                {!messages.isLoading && !messages.data?.length && (
                  <p className="text-sm text-muted-foreground">Envía el primer mensaje y rompe el hielo ❤️</p>
                )}
                {messages.data?.map((message) => {
                  const mine = message.sender_id === viewerId;
                  return (
                    <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                          mine ? "bg-pink-600 text-white" : "bg-white/10 text-slate-100"
                        }`}
                      >
                        {message.audio_path ? (
                          <VoiceBubble path={message.audio_path} />
                        ) : message.media_path ? (
                          <ChatPhoto path={message.media_path} />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        )}
                        <p className={`mt-1 text-[10px] ${mine ? "text-pink-100/80" : "text-muted-foreground"}`}>
                          {new Date(message.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-white/10 p-3">
                <p className="mb-2 text-center text-[11px] text-muted-foreground">Mensajes de texto, notas de voz y fotos son gratis. Las llamadas privadas cuestan monedas.</p>
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
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (text.trim()) sendMessage.mutate(text.trim());
                      }
                    }}
                    placeholder="Escribe un mensaje…"
                    maxLength={1000}
                  />
                  <Button
                    type="button"
                    onClick={() => text.trim() && sendMessage.mutate(text.trim())}
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

      <Dialog open={giftOpen} onOpenChange={setGiftOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-pink-300" /> Enviar regalo a {activeConversation?.other?.display_name ?? "tu pareja"}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <CoinIcon className="size-4" /> Tienes {account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")} monedas brillantes. Cada regalo suma saldo retirable a quien lo recibe.
            </DialogDescription>
          </DialogHeader>
          <GiftGrid
            onSelect={(gift) => sendGift.mutate(gift)}
            disabled={sendGift.isPending || !activeConversation?.other}
            compact
          />
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
}: {
  callId: string;
  mode: "hot" | "cafe";
  video: boolean;
  otherName: string;
  role: "caller" | "callee";
  viewerId: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState("Conectando…");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const closedRef = useRef(false);
  const stopRingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
      if (event.candidate) void sendSignal({ kind: "ice", candidate: event.candidate.toJSON() });
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
        } else if (payload.kind === "ice") {
          if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate).catch(() => undefined);
          else pendingCandidatesRef.current.push(payload.candidate);
        }
      })();
    });

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoCall });
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
      } catch {
        setStatus(videoCall ? "Cámara o micrófono no disponible" : "Micrófono no disponible");
        toast.error(videoCall ? "No se pudo acceder a la cámara y el micrófono para la videollamada." : "No se pudo acceder al micrófono para la llamada.");
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
            <video ref={remoteVideoRef} autoPlay playsInline muted={false} className="aspect-video w-full object-cover" />
            <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-3 right-3 aspect-video w-28 rounded-xl border border-white/30 object-cover sm:w-40" />
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
        <div className="flex justify-center gap-3">
          <Button variant={muted ? "destructive" : "outline"} size="icon" onClick={toggleMute} aria-label="Silenciar">
            {muted ? <MicOff /> : <Mic />}
          </Button>
          <Button variant="destructive" onClick={() => void endCall()}>
            <PhoneOff /> Colgar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
