import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { VideoStudio } from "@/components/studio/video-studio";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { cleanupExpiredMedia } from "@/lib/firefly.functions";

export const Route = createFileRoute("/video-studio")({
  head: () => ({
    meta: [
      { title: "Estudio Firefly — Video e imagen IA | Leudy IA Adobe" },
      {
        name: "description",
        content:
          "Genera imágenes, secuencias de video por escenas, voces y doblajes con IA desde un estudio profesional.",
      },
      { property: "og:title", content: "Estudio Firefly — Video e imagen IA" },
      {
        property: "og:description",
        content: "Imágenes, videos por escenas, voces y doblajes con inteligencia artificial.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VideoStudioRoute,
});

function VideoStudioRoute() {
  const { session } = useAuth();
  const { isAdmin } = useAccount();
  const navigate = useNavigate();
  const cleanupFn = useServerFn(cleanupExpiredMedia);
  const cleanedFor = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || cleanedFor.current === userId) return;
    cleanedFor.current = userId;
    void cleanupFn({}).catch(() => undefined);
  }, [session?.user.id, cleanupFn]);

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 pt-10 sm:px-8">
      <div className="mb-10 space-y-3">
        <p className="font-display text-xs uppercase tracking-[0.24em] text-primary">
          Estudio Firefly
        </p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">
          Video, imagen y voz con inteligencia artificial
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Crea imágenes con proveedores gratuitos o FLUX, encadena escenas de video con referencias
          reales y genera narración o doblaje con la voz, idioma y acento que elijas.
        </p>
      </div>

      <section className="panel grain p-6 sm:p-8">
        <VideoStudio
          signedIn={Boolean(session)}
          userId={session?.user.id ?? null}
          isAdmin={isAdmin}
          requireSignIn={() => navigate({ to: "/auth" })}
        />
      </section>
    </main>
  );
}
