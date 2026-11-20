import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coffee, Flame, Phone, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { BRAND, CALL_COSTS } from "@/lib/cupido";

export const Route = createFileRoute("/llamadas")({
  head: () => ({ meta: [{ title: `Llamadas en vivo — ${BRAND}` }] }),
  component: CallsPage,
});

type CallRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  mode: "hot" | "cafe";
  status: string;
  credits_spent: number;
  created_at: string;
};

function CallsPage() {
  const { session } = useAuth();
  const { balance } = useAccount();
  const viewerId = session?.user.id ?? null;

  const calls = useQuery({
    queryKey: ["cupido-call-history", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_calls")
        .select("id,caller_id,callee_id,mode,status,credits_spent,created_at")
        .or(`caller_id.eq.${viewerId},callee_id.eq.${viewerId}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as CallRow[];
    },
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <header className="rounded-3xl border border-pink-400/25 bg-gradient-to-br from-pink-500/15 via-fuchsia-500/10 to-transparent p-7">
        <p className="inline-flex items-center gap-2 rounded-full border border-pink-300/30 bg-pink-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-pink-200">
          <Phone className="size-3.5" /> Llamadas en vivo
        </p>
        <h1 className="mt-4 font-display text-3xl text-white sm:text-4xl">
          Conexiones reales, voz real ❤️
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Inicia una llamada desde el chat con la persona que te interesa. Las notas de voz son gratis;
          las llamadas usan créditos y se conectan por WebRTC con señalización Supabase Realtime.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/chat">
              <Phone className="size-4" /> Abrir chat
            </Link>
          </Button>
          <Button asChild variant="glass">
            <Link to="/tienda">
              <ShoppingBag className="size-4" /> Comprar créditos
            </Link>
          </Button>
        </div>
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-orange-400/25 bg-orange-500/10 p-5">
          <Flame className="size-6 text-orange-300" />
          <h2 className="mt-3 font-display text-xl text-white">Sala Hot</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {CALL_COSTS.hot} créditos por llamada. Conversación apasionada y directa con consentimiento.
          </p>
        </div>
        <div className="rounded-2xl border border-sky-400/25 bg-sky-500/10 p-5">
          <Coffee className="size-6 text-sky-300" />
          <h2 className="mt-3 font-display text-xl text-white">Sala Café</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {CALL_COSTS.cafe} créditos por llamada. Para conocerse tranquilo y tomar un café virtual.
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl text-white">Tus créditos</h2>
          <p className="font-display text-2xl text-pink-200">
            {balance === Infinity ? "∞" : balance.toLocaleString("es")}
          </p>
        </div>
        <h3 className="mt-6 font-display text-lg text-white">Historial reciente</h3>
        <div className="mt-3 space-y-2">
          {(calls.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {viewerId ? "Aún no tienes llamadas." : "Inicia sesión para ver tu historial."}
            </p>
          ) : (
            calls.data!.map((call) => (
              <div
                key={call.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-4 py-3 text-sm"
              >
                <span className="text-white">
                  {call.mode === "hot" ? "🔥 Hot" : "☕ Café"} · {call.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(call.created_at).toLocaleString("es")}
                </span>
                <span className="text-pink-200">{call.credits_spent} créditos</span>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
