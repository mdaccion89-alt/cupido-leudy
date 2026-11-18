import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, Users } from "lucide-react";
import { FollowButton } from "@/components/studio/follow-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { isCreatorVerified, useCreators } from "@/lib/creator";

export const Route = createFileRoute("/comunidad")({
  head: () => ({ meta: [{ title: "Comunidad — Leudy IA Adobe" }] }),
  component: CommunityPage,
});

function CommunityPage() {
  const { session } = useAuth();
  const creators = useCreators();

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 pt-8 sm:px-8">
        <section className="mb-8">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
            <Users className="size-3.5 text-primary" /> Comunidad
          </p>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">Creadores de Leudy IA</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Descubre a los artistas que crean con inteligencia artificial y sigue a tus favoritos.
          </p>
        </section>

        {!session && (
          <div className="panel grain mb-8 flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">
              Inicia sesión para seguir a tus creadores favoritos.
            </p>
            <Button asChild variant="hero" size="sm">
              <Link to="/auth">Iniciar sesión</Link>
            </Button>
          </div>
        )}

        {creators.isLoading ? (
          <div className="panel grain p-8 text-center text-sm text-muted-foreground">
            Cargando creadores…
          </div>
        ) : creators.isError ? (
          <div className="panel grain p-8 text-center text-sm text-muted-foreground">
            No se pudo cargar la comunidad. Intenta de nuevo más tarde.
          </div>
        ) : creators.data && creators.data.length > 0 ? (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creators.data.map((creator) => (
              <article key={creator.id} className="panel grain flex flex-col p-5">
                <div className="flex items-start gap-4">
                  <Avatar className="size-14 rounded-xl">
                    {creator.avatar_url ? <AvatarImage src={creator.avatar_url} alt="" /> : null}
                    <AvatarFallback className="rounded-xl bg-gradient-primary font-display text-lg text-primary-foreground">
                      {creator.display_name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        to="/artista/$id"
                        params={{ id: creator.id }}
                        className="truncate font-display font-semibold hover:text-primary"
                      >
                        {creator.display_name}
                      </Link>
                      {isCreatorVerified(creator) && (
                        <BadgeCheck
                          className="size-5 shrink-0"
                          style={{
                            color: "#1D9BF0",
                            filter: "drop-shadow(0 0 6px rgba(29,155,240,0.65))",
                          }}
                          strokeWidth={2.5}
                          aria-label="Creador verificado"
                        />
                      )}
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="size-3.5" />
                      {creator.follower_count.toLocaleString("es")} seguidores
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-foreground/80">
                  {creator.bio || "Creador de música con IA en Leudy IA Adobe."}
                </p>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <Link
                    to="/artista/$id"
                    params={{ id: creator.id }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Ver perfil
                  </Link>
                  {session ? <FollowButton creatorId={creator.id} /> : null}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <div className="panel grain p-8 text-center text-sm text-muted-foreground">
            Todavía no hay creadores en la comunidad.
          </div>
        )}
      </main>
    </div>
  );
}
