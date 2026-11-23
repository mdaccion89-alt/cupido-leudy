import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { PeopleSuggestions } from "@/components/cupido/people-suggestions";
import { WallFeed } from "@/components/cupido/wall-feed";
import { Input } from "@/components/ui/input";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";

export const Route = createFileRoute("/descubrir")({
  head: () => ({ meta: [{ title: "Descubrir — Cupido Leudy ❤️" }] }),
  component: DiscoverPage,
});

function DiscoverPage() {
  const [search, setSearch] = useState("");
  return (
    <SafeViewBoundary label="Descubrir">
      <main className="mx-auto w-full max-w-6xl space-y-7 px-4 py-6 sm:px-6">
        <header>
          <h1 className="mb-3 font-display text-2xl font-semibold text-white">Descubrir</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar personas o videos" aria-label="Buscar personas o videos" className="h-11 rounded-2xl border-white/10 bg-white/[0.04] pl-10 text-white" />
          </div>
        </header>
        <PeopleSuggestions search={search} />
        <section aria-label="Videos cortos">
          <h2 className="mb-3 font-display text-xl font-semibold text-white">Videos cortos</h2>
          <WallFeed videoOnly hideUpload showScopeTabs={false} searchTerm={search} emptyText="Todavía no hay videos que coincidan con la búsqueda." />
        </section>
      </main>
    </SafeViewBoundary>
  );
}
