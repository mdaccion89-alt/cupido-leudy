import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Heart, Search } from "lucide-react";
import { PeopleSuggestions } from "@/components/cupido/people-suggestions";
import { CommunityDemoFeed } from "@/components/cupido/community-demo-feed";
import { WallFeed } from "@/components/cupido/wall-feed";
import { Input } from "@/components/ui/input";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type MatchProfile = { id: string; display_name: string; avatar_url: string };

export const Route = createFileRoute("/descubrir")({
  head: () => ({ meta: [{ title: "Descubrir — Cupido Leudy ❤️" }] }),
  component: DiscoverPage,
});

function DiscoverPage() {
  const [search, setSearch] = useState("");
  const [newMatch, setNewMatch] = useState<MatchProfile | null>(null);
  const { session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const viewerId = session?.user.id;
    if (!viewerId) return;
    const channel = supabase.channel(`cupido-discover-matches-${viewerId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cupido_matches" }, (payload) => {
        const match = payload.new as { user_low?: string; user_high?: string };
        if (match.user_low !== viewerId && match.user_high !== viewerId) return;
        const otherId = match.user_low === viewerId ? match.user_high : match.user_low;
        if (!otherId) return;
        void supabase.from("cupido_public_profiles").select("id,display_name,avatar_url").eq("id", otherId).maybeSingle()
          .then(({ data }) => { if (data) setNewMatch(data); });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session?.user.id]);

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
        <CommunityDemoFeed title="Perfiles y publicaciones de la comunidad" />
        <section aria-label="Videos cortos">
          <h2 className="mb-3 font-display text-xl font-semibold text-white">Videos cortos</h2>
          <WallFeed videoOnly hideUpload showScopeTabs={false} searchTerm={search} emptyText="Todavía no hay videos que coincidan con la búsqueda." />
        </section>
      </main>
      <Dialog open={Boolean(newMatch)} onOpenChange={(open) => !open && setNewMatch(null)}>
        <DialogContent className="max-w-sm rounded-3xl border-pink-300/30 bg-zinc-950 text-white">
          <DialogHeader className="items-center text-center">
            <Avatar userId={newMatch?.id} className="size-20 border-2 border-pink-300 shadow-lg shadow-pink-500/30">
              <AvatarImage src={newMatch?.avatar_url ?? ""} alt={newMatch?.display_name ?? "Nuevo match"} />
              <AvatarFallback>{newMatch?.display_name.slice(0, 1) ?? "❤️"}</AvatarFallback>
            </Avatar>
            <DialogTitle className="font-display text-2xl">¡Es un Match en Cupido Leudy! ❤️</DialogTitle>
            <DialogDescription className="text-white/70">Tú y {newMatch?.display_name} se interesaron mutuamente.</DialogDescription>
          </DialogHeader>
          <Button type="button" className="w-full rounded-xl" disabled={!newMatch} onClick={() => {
            if (!newMatch) return;
            const userId = newMatch.id;
            setNewMatch(null);
            void navigate({ to: "/chat", search: { userId } });
          }}>
            <Heart className="mr-2 size-4 fill-current" /> Chatear ahora
          </Button>
        </DialogContent>
      </Dialog>
    </SafeViewBoundary>
  );
}
