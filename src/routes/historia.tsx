import { createFileRoute } from "@tanstack/react-router";
import { Clock3, Plus } from "lucide-react";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";
import { StoryFeed } from "@/components/cupido/story-feed";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/historia")({
  validateSearch: (search: { story?: string }) => ({ story: typeof search.story === "string" ? search.story : undefined }),
  head: () => ({ meta: [{ title: "Historias · Cupido Leudy ❤️" }] }),
  component: () => {
    const { story } = Route.useSearch();
    return (
    <SafeViewBoundary label="las historias">
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-pink-400/30 bg-pink-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-pink-200">
            <Clock3 className="size-3.5" /> Historias · 24 horas
          </p>
          <h1 className="mt-3 font-display text-2xl text-white sm:text-3xl">Momentos de Cupido</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fotos y videos reales, con respuestas que llegan directamente a Mensajes.</p>
          </div>
          <Button type="button" className="gap-2 rounded-xl" onClick={() => window.dispatchEvent(new Event("cupido:open-story-composer"))}>
            <Plus className="size-4" /> Publicar historia
          </Button>
        </header>
        <StoryFeed initialStoryId={story} />
      </main>
    </SafeViewBoundary>
    );
  },
});
