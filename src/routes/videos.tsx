import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";

const TikTokFeed = lazy(async () => {
  const module = await import("@/components/cupido/tiktok-feed");
  return { default: module.TikTokFeed };
});

export const Route = createFileRoute("/videos")({
  validateSearch: (search: { post?: string }) => ({ post: typeof search.post === "string" ? search.post : undefined }),
  head: () => ({ meta: [{ title: "Videos — Cupido Leudy ❤️" }] }),
  component: VideosPage,
});

function VideosPage() {
  const { post } = Route.useSearch();
  return (
    <SafeViewBoundary label="los videos">
      <Suspense fallback={<div className="grid h-[100dvh] place-items-center bg-black text-sm text-white/70">Cargando videos…</div>}>
        <TikTokFeed initialPostId={post} />
      </Suspense>
    </SafeViewBoundary>
  );
}
