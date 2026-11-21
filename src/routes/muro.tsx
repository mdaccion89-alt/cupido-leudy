import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/routes/comunidad";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";

export const Route = createFileRoute("/muro")({
  validateSearch: (search: { post?: string }) => ({ post: typeof search.post === "string" ? search.post : undefined }),
  head: () => ({ meta: [{ title: "Muro — Cupido Leudy ❤️" }] }),
  component: MuroPage,
});

function MuroPage() {
  const { post } = Route.useSearch();
  return (
    <SafeViewBoundary label="el muro">
      <CommunityPage highlightPostId={post} />
    </SafeViewBoundary>
  );
}
