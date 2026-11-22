import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, ShieldCheck, TicketCheck, X } from "lucide-react";
import { toast } from "sonner";
import { escudoCupido } from "@/lib/cupido.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type ChatMessage = { id: number; role: "user" | "assistant"; content: string };
type Ticket = { id: string; subject: string; message: string; status: string; admin_reply: string; created_at: string };
const ticketDb = supabase as unknown as {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const SUGGESTIONS = [
  "¿Cómo detecto un perfil falso?",
  "Me pidieron dinero fuera de PayPal",
  "¿Cuál es el estado de mi verificación?",
];

export function EscudoWidget() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ticketMode, setTicketMode] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);

  const tickets = useQuery({
    queryKey: ["cupido-my-support-tickets", session?.user.id],
    enabled: open && Boolean(session?.user.id),
    queryFn: async () => {
      const { data, error } = await ticketDb.from("cupido_support_tickets")
        .select("id,subject,message,status,admin_reply,created_at")
        .eq("user_id", session!.user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as Ticket[];
    },
  });

  useEffect(() => {
    if (!session?.user.id) return;
    const channel = supabase
      .channel((`cupido-user-tickets-${session.user.id}`) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_support_tickets", filter: `user_id=eq.${session.user.id}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-my-support-tickets", session.user.id] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, session?.user.id]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput("");
    setMessages((current) => [...current, { id: Date.now(), role: "user", content: message }]);
    try {
      const history = messages.slice(-10).map((item) => ({ role: item.role, content: item.content }));
      const result = await escudoCupido({ data: { message, history } });
      setMessages((current) => [...current, {
        id: Date.now() + 1,
        role: "assistant",
        content: result.ok ? result.reply : result.message,
      }]);
    } catch {
      setMessages((current) => [...current, {
        id: Date.now() + 1,
        role: "assistant",
        content: "No pude conectar ahora. Abre un ticket y el equipo revisará tu caso.",
      }]);
    } finally {
      setBusy(false);
    }
  };

  const submitTicket = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.user.id) {
      toast.error("Inicia sesión para escribir al Administrador.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await ticketDb.rpc("cupido_open_support_ticket", {
        _subject: ticketSubject,
        _message: ticketMessage,
      });
      if (error) throw error;
      setTicketSubject("");
      setTicketMessage("");
      setTicketSent(true);
      await queryClient.invalidateQueries({ queryKey: ["cupido-my-support-tickets", session.user.id] });
      toast.success("El ticket llegó al Administrador. La respuesta aparecerá aquí y en tus notificaciones.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el ticket.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-[0_10px_40px_rgba(236,72,153,0.45)] transition hover:scale-105"
        aria-label="Abrir Cupi Support"
      >
        {open ? <X className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
      </button>
      {open && (
        <div className="fixed bottom-44 right-4 z-40 flex max-h-[70vh] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-pink-500/30 bg-[#140b18] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-white/10 bg-gradient-to-r from-pink-600/30 to-rose-600/20 px-4 py-3">
            <ShieldCheck className="h-5 w-5 text-pink-300" />
            <div>
              <p className="text-sm font-semibold text-white">Cupi Support</p>
              <p className="text-[11px] text-pink-200/70">Soporte de cuenta y seguridad · Gemini 2.5 Flash</p>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            {!messages.length && <p className="text-xs text-slate-300">Consulta sobre tu saldo, verificación, retiros, Lives o seguridad.</p>}
            {messages.map((item) => (
              <div key={item.id} className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${item.role === "user" ? "ml-auto bg-pink-600 text-white" : "bg-white/10 text-slate-100"}`}>
                {item.content}
              </div>
            ))}
            {busy && <p className="text-xs text-muted-foreground">Enviando…</p>}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => void send(suggestion)} className="rounded-full border border-pink-400/40 px-3 py-1 text-xs text-pink-200 hover:bg-pink-500/10">
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {tickets.data?.map((ticket) => (
              <div key={ticket.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-200">
                <p className="font-semibold">{ticket.subject} · {ticket.status === "responded" ? "Respondido" : ticket.status === "closed" ? "Cerrado" : "Abierto"}</p>
                {ticket.admin_reply && <p className="mt-2 whitespace-pre-wrap text-pink-100">Administrador: {ticket.admin_reply}</p>}
              </div>
            ))}
          </div>
          {!ticketMode ? (
            <>
              <form onSubmit={onSubmit} className="flex gap-2 border-t border-white/10 p-3">
                <Input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Cuéntame qué necesitas…" className="h-9 text-sm" />
                <Button type="submit" size="icon" className="h-9 w-9" disabled={busy || !input.trim()} aria-label="Enviar mensaje">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
              <button type="button" onClick={() => setTicketMode(true)} className="flex items-center justify-center gap-2 border-t border-white/10 px-3 py-2.5 text-xs font-medium text-pink-200 hover:bg-pink-500/10">
                <TicketCheck className="size-4" /> Hablar con el Administrador / Abrir Ticket
              </button>
            </>
          ) : (
            <form onSubmit={(event) => void submitTicket(event)} className="space-y-2 border-t border-white/10 p-3">
              {!session && <p className="text-xs text-muted-foreground">Necesitas entrar para enviar y consultar un ticket. <Link to="/auth" search={{ ref: "" }} className="text-pink-200 underline">Iniciar sesión</Link></p>}
              {ticketSent && <p className="text-xs text-emerald-200">Ticket enviado. Aquí aparecerá la respuesta del Administrador.</p>}
              <Input value={ticketSubject} maxLength={120} onChange={(event) => setTicketSubject(event.target.value)} placeholder="Asunto" />
              <Textarea value={ticketMessage} maxLength={4000} onChange={(event) => setTicketMessage(event.target.value)} placeholder="Describe qué ocurrió y cómo podemos ayudarte…" className="min-h-20" />
              <div className="flex justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setTicketMode(false)}>Volver al chat</Button>
                <Button type="submit" size="sm" disabled={busy || !session || ticketSubject.trim().length < 3 || ticketMessage.trim().length < 5}>
                  <MessageCircle className="size-4" /> Enviar ticket
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
