import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import { escudoCupido, type EscudoResult } from "@/lib/cupido.functions";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  source?: "gemini" | "offline" | undefined;
};

const QUICK_ACTIONS = [
  {
    label: "Detectar estafa",
    prefix: "Me están pidiendo dinero, ¿es una estafa? ",
  },
  {
    label: "Perfil falso",
    prefix: "Creo que este perfil es falso, ¿qué hago? ",
  },
  {
    label: "Seguridad en citas",
    prefix: "Voy a tener una primera cita, ¿cómo me cuido? ",
  },
] as const;

export function EscudoCupidoWidget() {
  const { session } = useAuth();
  const runEscudo = useServerFn(escudoCupido);

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
    meta?: { source?: "gemini" | "offline" | undefined },
  ) => {
    setMessages((prev) => [...prev, { role: "assistant", content, ...meta }]);
  };

  const handleSend = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || sending) return;

    setInput("");
    appendUserMessage(text);
    setSending(true);

    try {
      const result: EscudoResult = await runEscudo({
        data: {
          message: text,
          history,
        },
      });

      if (!result.ok) {
        appendAssistantMessage(result.message || "No pude responder en este momento. Inténtalo de nuevo.");
        return;
      }

      appendAssistantMessage(result.reply, { source: result.source });
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
          aria-label="El Escudo de Cupido Leudy ❤️"
          title="El Escudo de Cupido Leudy ❤️"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 inline-flex max-w-[90vw] items-center gap-2 rounded-full border border-border bg-surface-raised/90 px-4 py-3 text-sm font-medium text-foreground shadow-lg backdrop-blur transition hover:bg-accent"
        >
          <span className="relative inline-flex items-center justify-center">
            <ShieldCheck className="size-5 text-primary" />
            <Sparkles className="absolute -right-1 -top-1 size-3 text-primary" />
          </span>
          <span className="hidden sm:inline">El Escudo de Cupido Leudy ❤️</span>
          <span className="sm:hidden">Escudo Cupido</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative inline-flex items-center">
                  <ShieldCheck className="size-5 text-primary" />
                  <Sparkles className="absolute -right-1 -top-1 size-3 text-primary" />
                </div>
                <p className="font-display text-base font-semibold text-foreground">
                  El Escudo de Cupido Leudy ❤️
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Asistente de seguridad para citas y perfiles
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
                Hola, soy El Escudo de Cupido Leudy ❤️. Te ayudo a detectar perfiles falsos, estafas y a mantener tus citas seguras.
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
                {m.role === "assistant" && m.source && (
                  <div className="mb-1">
                    <span
                      className="inline-flex rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      title={m.source === "gemini" ? "Respuesta generada con IA" : "Respuesta local de seguridad"}
                    >
                      IA: {m.source === "gemini" ? "gemini" : "offline"}
                    </span>
                  </div>
                )}
                <div>{m.content}</div>
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
                Puedes usar el Escudo sin iniciar sesión. Inicia sesión para una mejor experiencia.
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
                placeholder="Escribe tu pregunta de seguridad..."
                className="min-h-[72px] flex-1 resize-none"
                rows={3}
              />
              <Button
                type="submit"
                variant="hero"
                size="icon"
                disabled={sending || input.trim().length === 0}
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

export const ThankYouChatWidget = EscudoCupidoWidget;
