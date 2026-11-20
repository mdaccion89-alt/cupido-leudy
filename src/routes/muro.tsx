import { Link, createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { WallFeed } from "@/components/cupido/wall-feed";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/muro")({
  head: () => ({ meta: [{ title: "Muro — Cupido Leudy ❤️" }] }),
  component: MuroPage,
});

function MuroPage() {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-pink-400/30 bg-pink-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-pink-200">
            <Sparkles className="size-3.5" /> Muro real
          </p>
          <h1 className="mt-3 font-display text-2xl text-white sm:text-3xl">Fotos y videos de Cupido</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Publicaciones reales de todas las personas. Me gusta, comentarios, favoritos y compartir al instante.
          </p>
        </div>
        {!viewerId && <Button asChild><Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link></Button>}
      </header>
      <WallFeed emptyText="Todavía no hay publicaciones. Sé la primera persona en compartir una foto o video ❤️" />
    </main>
  );
}
