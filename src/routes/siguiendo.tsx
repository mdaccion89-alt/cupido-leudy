import { Link, createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { WallFeed } from "@/components/cupido/wall-feed";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/siguiendo")({
  head: () => ({ meta: [{ title: "Siguiendo — Cupido Leudy ❤️" }] }),
  component: FollowingPage,
});

function FollowingPage() {
  const { session } = useAuth();

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8 sm:px-6">
      <section>
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Users className="size-3.5 text-pink-300" /> Tu círculo
        </p>
        <h1 className="font-display text-3xl text-white sm:text-4xl">Publicaciones de quienes sigues</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Fotos y videos nuevos de las personas que sigues, actualizados en tiempo real.</p>
      </section>
      {!session && (
        <p className="rounded-2xl border border-pink-400/30 bg-pink-500/10 p-4 text-sm text-pink-100/80">
          <Link to="/auth" search={{ ref: "" }} className="font-medium text-white underline">Inicia sesión</Link> para ver las publicaciones de tu círculo.
        </p>
      )}
      <WallFeed initialFollowingOnly hideUpload showScopeTabs={false} emptyText="Las personas que sigues todavía no han publicado." />
    </main>
  );
}
