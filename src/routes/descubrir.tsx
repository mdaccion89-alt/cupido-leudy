import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/routes/comunidad";

export const Route = createFileRoute("/descubrir")({
  head: () => ({ meta: [{ title: "Descubrir — Cupido Leudy ❤️" }] }),
  component: CommunityPage,
});
