import { useMemo } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { MediaCard, type CupidoMedia } from "@/components/cupido/media-card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/historia")({
  head: () => ({ meta: [{ title: "Historia — Cupido Leudy ❤️" }] }),
  component: HistoriaPage,
});

function HistoriaPage() {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const queryClient = useQueryClient();

  const feed = useQuery({
    queryKey: ["cupido-historia", viewerId],
    queryFn: async () => {
      const db = supabase as unknown as { from: (table: string) => any };
      let { data: posts, error } = await db
        .from("cupido_posts")
        .select("id,user_id,media_url,media_type,media_path,kind,caption,likes_count")
        .eq("moderation_status", "approved")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) {
        ({ data: posts, error } = await db
          .from("cupido_posts")
          .select("id,user_id,media_path,kind,caption,likes_count")
          .eq("moderation_status", "approved")
          .order("created_at", { ascending: false })
          .limit(30));
      }
      if (error) throw error;
      const ids = [...new Set((posts ?? []).map((post) => post.user_id))];
      const profiles = ids.length
        ? (await supabase.from("creator_profiles").select("id,display_name,avatar_url,is_verified_blue").in("id", ids)).data ?? []
        : [];
      const emails = ids.length
        ? (await supabase.from("profiles").select("id,email").in("id", ids)).data ?? []
        : [];
      const profileMap = new Map(profiles.map((row) => [row.id, row]));
      const emailMap = new Map(emails.map((row) => [row.id, row.email]));
      const media: CupidoMedia[] = (posts ?? [])
        .filter((post) => post.kind === "video")
        .map((post) => {
          const profile = profileMap.get(post.user_id);
          return {
            id: post.id,
            user_id: post.user_id,
            media_url: post.media_url ?? post.media_path,
            kind: "video",
            caption: post.caption,
            likes_count: post.likes_count,
            display_name: profile?.display_name ?? "Miembro de Cupido",
            avatar_url: profile?.avatar_url ?? "",
            is_verified_blue: profile?.is_verified_blue ?? false,
            email: emailMap.get(post.user_id) ?? null,
          };
        });
      const liked = viewerId
        ? (await supabase.from("cupido_post_likes").select("post_id").eq("user_id", viewerId)).data ?? []
        : [];
      const interested = viewerId
        ? (await supabase.from("cupido_likes").select("target_id").eq("actor_id", viewerId).eq("kind", "interested")).data ?? []
        : [];
      return { media, liked: new Set(liked.map((row) => row.post_id)), interested: new Set(interested.map((row) => row.target_id)) };
    },
  });

  const likeMedia = useMutation({
    mutationFn: async ({ postId, remove }: { postId: string; remove: boolean }) => {
      if (!viewerId) return;
      if (remove && !feed.data?.liked.has(postId)) return;
      const { error } = await supabase.rpc("cupido_toggle_post_like", { _post: postId });
      if (error) throw error;
      toast.success(remove ? "Te gusta eliminado" : "❤️ Te gusta");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cupido-historia", viewerId] }),
    onError: () => toast.error("No se pudo actualizar el me gusta."),
  });

  const setLike = useMutation({
    mutationFn: async ({ targetId, kind }: { targetId: string; kind: "interested" | "pass" }) => {
      if (!viewerId) return;
      const { error } = await supabase.rpc("cupido_set_like", { _target: targetId, _kind: kind, _remove: false });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cupido-historia", viewerId] }),
    onError: () => toast.error("No se pudo guardar tu preferencia."),
  });

  const tabKey = useMemo(() => feed.data?.media.map((item) => item.id).join(",") ?? "", [feed.data]);

  return (
    <main className="mx-auto w-full max-w-2xl px-3 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-pink-400/30 bg-pink-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-pink-200">
            <Play className="size-3.5" /> Historia
          </p>
          <h1 className="mt-3 font-display text-2xl text-white sm:text-3xl">Videos cortos de Cupido</h1>
          <p className="mt-1 text-sm text-muted-foreground">Desliza, conoce y reacciona. Un vídeo a la vez ❤️</p>
        </div>
        {!session && <Button asChild><Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link></Button>}
      </header>

      {feed.isLoading ? (
        <p className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">Cargando historias…</p>
      ) : feed.data?.media.length ? (
        <div key={tabKey} className="flex snap-y snap-mandatory flex-col gap-5 overflow-y-auto rounded-3xl pb-24 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maxHeight: "calc(100dvh - 190px)" }}>
          {feed.data.media.map((item) => (
            <div key={item.id} className="snap-start">
              <MediaCard
                media={item}
                myId={viewerId}
                interested={feed.data!.interested.has(item.user_id)}
                liked={feed.data!.liked.has(item.id)}
                onInterested={() => setLike.mutate({ targetId: item.user_id, kind: "interested" })}
                onPass={() => setLike.mutate({ targetId: item.user_id, kind: "pass" })}
                onLike={() => likeMedia.mutate({ postId: item.id, remove: false })}
                onUnlike={() => likeMedia.mutate({ postId: item.id, remove: true })}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          Todavía no hay videos aprobados. ¡Sé la primera persona en subir el tuyo!
        </div>
      )}
    </main>
  );
}
