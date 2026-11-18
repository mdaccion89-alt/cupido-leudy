import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, BadgeCheck, Users } from "lucide-react";
import { FollowButton } from "@/components/studio/follow-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { isCreatorVerified, useCreator } from "@/lib/creator";

export const Route = createFileRoute("/artista/$id")({
  head: () => ({ meta: [{ title: "Artista — Leudy IA Adobe" }] }),
  component: ArtistPage,
});

function ArtistPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const creator = useCreator(id);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <main className="relative z-10 mx-auto w-full max-w-3xl px-5 pb-24 pt-8 sm:px-8">
        <Button asChild variant="ghost" size="sm" className="mb-6 text-muted-foreground">
          <Link to="/comunidad">
            <ArrowLeft /> Volver a la comunidad
          </Link>
        </Button>

        {creator.isLoading ? (
          <div className="panel grain p-8 text-center text-sm text-muted-foreground">
            Cargando artista…
          </div>
        ) : creator.isError || !creator.data ? (
          <div className="panel grain p-8 text-center">
            <h1 className="text-xl font-semibold">Artista no encontrado</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Este perfil no existe o ya no está disponible.
            </p>
            <Button asChild variant="hero" size="sm" className="mt-5">
              <Link to="/comunidad">Ver comunidad</Link>
            </Button>
          </div>
        ) : (
          <section className="panel grain overflow-hidden">
            <div className="h-28 bg-gradient-primary/20" />
            <div className="relative px-6 pb-8">
              <Avatar className="-mt-10 size-20 rounded-2xl border-4 border-background shadow-glow">
                {creator.data.avatar_url ? (
                  <AvatarImage src={creator.data.avatar_url} alt="" />
                ) : null}
                <AvatarFallback className="rounded-2xl bg-gradient-primary font-display text-2xl text-primary-foreground">
                  {creator.data.display_name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-semibold">{creator.data.display_name}</h1>
                {isCreatorVerified(creator.data) && (
                  <BadgeCheck
                    className="size-6"
                    style={{
                      color: "#1D9BF0",
                      filter: "drop-shadow(0 0 6px rgba(29,155,240,0.65))",
                    }}
                    strokeWidth={2.5}
                    aria-label="Perfil oficial verificado"
                  />
                )}
              </div>
              <p className="mt-4 max-w-xl text-sm text-foreground/80">
                {creator.data.bio || "Creador de música con IA en Leudy IA Adobe."}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <Users className="size-4 text-muted-foreground" />
                  <strong>{creator.data.follower_count.toLocaleString("es")}</strong> seguidores
                </span>
                {session ? <FollowButton creatorId={creator.data.id} /> : null}
              </div>
              {!session && (
                <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 p-4">
                  <p className="flex-1 text-sm text-muted-foreground">
                    Inicia sesión para seguir a este artista.
                  </p>
                  <Button asChild variant="hero" size="sm">
                    <Link to="/auth">Iniciar sesión</Link>
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
