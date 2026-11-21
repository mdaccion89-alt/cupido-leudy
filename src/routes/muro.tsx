import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/routes/comunidad";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";

export const Route = createFileRoute("/muro")({
  head: () => ({ meta: [{ title: "Muro — Cupido Leudy ❤️" }] }),
  component: () => (
    <SafeViewBoundary label="el muro">
      <CommunityPage />
    </SafeViewBoundary>
  ),
});
