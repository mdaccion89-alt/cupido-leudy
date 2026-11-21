import { useState, type FormEvent } from "react";
import { MessageCircle, Send, ShieldCheck, X } from "lucide-react";
import { escudoCupido } from "@/lib/cupido.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ChatMessage = { id: number; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "¿Cómo detecto un perfil falso?",
  "Me pidieron dinero fuera de PayPal",
  "Consejos para mi primera cita",
];

export function EscudoWidget() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput("");
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "user", content: message },
    ]);
    try {
      const history = messages
        .slice(-10)
        .map((item) => ({ role: item.role, content: item.content }));
      const result = await escudoCupido({ data: { message, history } });
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: result.ok ? result.reply : "Puedo ayudarte con seguridad en Cupido. Protege tus datos y evita pagos fuera de la app.",
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: "Puedo ayudarte con seguridad en Cupido. Protege tus datos y evita pagos fuera de la app.",
        },
      ]);
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
        aria-label="Abrir Escudo Cupido"
      >
        {open ? <X className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
      </button>
      {open && (
        <div className="fixed bottom-44 right-4 z-40 flex max-h-[60vh] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-pink-500/30 bg-[#140b18] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-white/10 bg-gradient-to-r from-pink-600/30 to-rose-600/20 px-4 py-3">
            <ShieldCheck className="h-5 w-5 text-pink-300" />
            <div>
              <p className="text-sm font-semibold text-white">Escudo Cupido</p>
              <p className="text-[11px] text-pink-200/70">Seguridad 24/7 · Gemini 2.5 Flash</p>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            {!messages.length && <p className="text-xs text-slate-300">Consulta sobre monedas, verificación, Lives o seguridad.</p>}
            {messages.map((item) => (
              <div
                key={item.id}
                className={`max-w-[88%] rounded-2xl px-3 py-2 ${
                  item.role === "user"
                    ? "ml-auto bg-pink-600 text-white"
                    : "bg-white/10 text-slate-100"
                }`}
              >
                {item.content}
              </div>
            ))}
            {busy && <p className="text-xs text-muted-foreground">El Escudo está escribiendo…</p>}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-full border border-pink-400/40 px-3 py-1 text-xs text-pink-200 hover:bg-pink-500/10"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={onSubmit} className="flex gap-2 border-t border-white/10 p-3">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Pregúntame sobre seguridad…"
              className="h-9 text-sm"
            />
            <Button type="submit" size="icon" className="h-9 w-9" disabled={busy || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-40 right-4 z-40 hidden items-center gap-2 rounded-full border border-pink-400/30 bg-black/70 px-3 py-1 text-xs text-pink-200 backdrop-blur hover:bg-black/90 sm:flex"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Escudo Cupido
        </button>
      )}
    </>
  );
}
