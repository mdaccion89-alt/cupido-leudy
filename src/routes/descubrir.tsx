import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/components/cupido/community-page";

export const Route = createFileRoute("/descubrir")({
  head: () => ({ meta: [{ title: "Descubrir — Cupido Leudy ❤️" }] }),
  component: CommunityPage,
});
