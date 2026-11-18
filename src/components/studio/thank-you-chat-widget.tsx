import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AudioLines, BadgeCheck, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import {
  assistantChat,
  createSupportTicket,
  type AssistantChatResult,
  type AssistantChatSource,
} from "@/lib/chat.functions";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  source?: AssistantChatSource | undefined;
  ticketId?: string | undefined;
};

const QUICK_ACTIONS = [
  {
    label: "Escribir letra",
    prefix: "Escribe una letra original ",
  },
  {
    label: "Mejorar prompt",
    prefix: "Mejora este prompt para generación musical: ",
  },
  {
    label: "Soporte técnico",
    prefix: "Reporto un error: ",
  },
] as const;

export function ThankYouChatWidget() {
  const { session } = useAuth();
  const runAssistantChat = useServerFn(assistantChat);
  const runCreateSupportTicket = useServerFn(createSupportTicket);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const hasSession = Boolean(session);

  const history = useMemo(
    () =>
      messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    [messages],
  );

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  const appendUserMessage = (content: string) => {
    setMessages((prev) => [...prev, { role: "user", content }]);
  };

  const appendAssistantMessage = (
    content: string,
    meta?: { source?: AssistantChatSource | undefined; ticketId?: string | undefined },
  ) => {
    setMessages((prev) => [...prev, { role: "assistant", content, ...meta }]);
  };

  const maybeCreateTicket = async (
    message: string,
    assistantReply: string,
    existingTicketId?: string,
  ) => {
    if (existingTicketId) {
      toast.success("Ticket de soporte registrado.");
      return;
    }
    if (!hasSession) {
      toast.message("Inicia sesión para crear un ticket de soporte automáticamente.");
      return;
    }
    try {
      const ticket = await runCreateSupportTicket({ data: { message, assistantReply } });
      if (ticket.ok) toast.success("Ticket de soporte registrado.");
      else toast.error(ticket.message);
    } catch {
      toast.error("No se pudo crear el ticket de soporte.");
    }
  };

  const handleSend = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || sending) return;
    if (!hasSession) {
      toast.message("Inicia sesión para usar el asistente IA.");
      return;
    }

    setInput("");
    appendUserMessage(text);
    setSending(true);

    try {
      const result: AssistantChatResult = await runAssistantChat({
        data: {
          message: text,
          history,
        },
      });

      if (!result.ok) {
        const fallback =
          result.message || "No pude responder en este momento. Inténtalo de nuevo en un momento.";
        appendAssistantMessage(fallback, {
          source: result.source ?? "offline",
          ticketId: result.ticketId,
        });
        if (result.needsSupportTicket) {
          await maybeCreateTicket(text, fallback, result.ticketId);
        }
        return;
      }

      appendAssistantMessage(result.reply, { source: result.source, ticketId: result.ticketId });

      if (result.needsSupportTicket) {
        await maybeCreateTicket(text, result.reply, result.ticketId);
      }
    } catch {
      toast.error("No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  };

  const handleQuickAction = (prefix: string) => {
    const current = input.trim();
    if (current.length > 0) {
      setInput(`${prefix}${current}`);
    } else {
      setInput(prefix);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label="Thank You For Everything"
          title="Thank You For Everything"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised/80 px-4 py-3 text-sm font-medium text-foreground shadow-lg backdrop-blur transition hover:bg-accent"
        >
          <span className="relative inline-flex items-center justify-center">
            <AudioLines className="size-5 text-primary" />
            <Sparkles className="absolute -right-1 -top-1 size-3 text-primary" />
          </span>
          <span className="hidden sm:inline">Thank You For Everything</span>
          <BadgeCheck
            className="size-5"
            style={{ color: "#1D9BF0" }}
            strokeWidth={2.5}
            aria-hidden="true"
          />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative inline-flex items-center">
                  <AudioLines className="size-5 text-primary" />
                  <Sparkles className="absolute -right-1 -top-1 size-3 text-primary" />
                </div>
                <p className="font-display text-base font-semibold text-foreground">
                  Thank You For Everything
                </p>
                <BadgeCheck
                  className="size-5"
                  style={{ color: "#1D9BF0" }}
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Asistente IA 24/7 · cualquier idioma
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
            >
              Cerrar
            </Button>
          </div>

          <div
            ref={listRef}
            className="flex max-h-[45vh] min-h-[220px] flex-col gap-3 overflow-y-auto px-4 py-3"
          >
            {messages.length === 0 && (
              <div className="rounded-lg border border-border bg-surface-raised/60 p-3 text-sm text-muted-foreground">
                Hola, soy Thank You For Everything. Puedo ayudarte con música, marketing, IA,
                guiones, letras, prompts y soporte técnico.
              </div>
            )}
            {messages.map((m, idx) => (
              <div
                key={`${m.role}-${idx}`}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground"
                }
              >
                {m.role === "assistant" && (m.source === "offline" || m.source === "openai") && (
                  <div className="mb-1">
                    <span
                      className="inline-flex rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      title={
                        m.source === "offline"
                          ? "Respuesta generada localmente"
                          : "Respuesta usando proveedor alternativo"
                      }
                    >
                      IA: {m.source === "offline" ? "offline" : "fallback"}
                    </span>
                  </div>
                )}
                <div>{m.content}</div>
                {m.role === "assistant" && m.ticketId && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Ticket: {m.ticketId.slice(0, 8)}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="mr-auto inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-surface-raised px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Pensando...
              </div>
            )}
          </div>

          <div className="border-t border-border px-4 py-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((action) => (
                <Button
                  key={action.label}
                  type="button"
                  variant="glass"
                  size="sm"
                  onClick={() => handleQuickAction(action.prefix)}
                >
                  {action.label}
                </Button>
              ))}
            </div>

            {!hasSession && (
              <p className="mb-2 text-xs text-muted-foreground">
                Inicia sesión para usar el asistente y crear tickets automáticos.
              </p>
            )}

            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escribe tu mensaje..."
                className="min-h-[72px] flex-1 resize-none"
                rows={3}
              />
              <Button
                type="submit"
                variant="hero"
                size="icon"
                disabled={sending || !hasSession || input.trim().length === 0}
                aria-label="Enviar"
              >
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
