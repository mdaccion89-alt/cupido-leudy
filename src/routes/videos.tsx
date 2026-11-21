import { createFileRoute } from "@tanstack/react-router";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";
import { TikTokFeed } from "@/components/cupido/tiktok-feed";

export const Route = createFileRoute("/videos")({
  validateSearch: (search: { post?: string }) => ({ post: typeof search.post === "string" ? search.post : undefined }),
  head: () => ({ meta: [{ title: "Videos — Cupido Leudy ❤️" }] }),
  component: VideosPage,
});

function VideosPage() {
  const { post } = Route.useSearch();
  return (
    <SafeViewBoundary label="los videos">
      <TikTokFeed initialPostId={post} />
    </SafeViewBoundary>
  );
}
