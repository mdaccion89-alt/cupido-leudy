import { Link, createFileRoute } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { WallFeed } from "@/components/cupido/wall-feed";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/historia")({
  head: () => ({ meta: [{ title: "Historia — Cupido Leudy ❤️" }] }),
  component: HistoriaPage,
});

function HistoriaPage() {
  const { session } = useAuth();

  return (
    <main className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-pink-400/30 bg-pink-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-pink-200">
            <Play className="size-3.5" /> Historia
          </p>
          <h1 className="mt-3 font-display text-2xl text-white sm:text-3xl">Videos cortos de Cupido</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Videos reales de todos los perfiles. Reacciona, comenta, guarda y comparte ❤️
          </p>
        </div>
        {!session && <Button asChild><Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link></Button>}
      </header>
      <WallFeed videoOnly />
    </main>
  );
}
