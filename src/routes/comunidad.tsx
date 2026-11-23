import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/components/cupido/community-page";

export const Route = createFileRoute("/comunidad")({
  head: () => ({ meta: [{ title: "Comunidad — Cupido Leudy ❤️" }] }),
  component: CommunityPage,
});
