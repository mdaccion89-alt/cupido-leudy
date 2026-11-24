import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle, Sparkles, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";

type DemoComment = { display_name: string; body: string };
type DemoPost = {
  id: string;
  profile_id: string;
  display_name: string;
  avatar_url: string;
  age: number;
  country_code: string;
  bio: string;
  follower_count: number;
  media_url: string;
  caption: string;
  likes_count: number;
  comments_count: number;
  comments: DemoComment[] | null;
  created_at: string;
};

const demoDb = supabase as unknown as { from: (table: string) => any };

const COUNTRY_NAMES: Record<string, string> = {
  AR: "Argentina", BR: "Brasil", CL: "Chile", CO: "Colombia", DO: "República Dominicana",
  ES: "España", MX: "México", PR: "Puerto Rico", US: "Estados Unidos", VE: "Venezuela",
};

export function CommunityDemoFeed({ limit = 6, title = "Comunidad Cupido" }: { limit?: number; title?: string }) {
  const queryClient = useQueryClient();
  const feed = useQuery({
    queryKey: ["cupido-demo-community-feed", limit],
    queryFn: async (): Promise<DemoPost[]> => {
      const { data, error } = await demoDb.from("cupido_demo_public_feed")
        .select("id,profile_id,display_name,avatar_url,age,country_code,bio,follower_count,media_url,caption,likes_count,comments_count,comments,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as DemoPost[];
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    const channel = supabase.channel(`cupido-demo-community-feed-${limit}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_demo_posts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-demo-community-feed"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_demo_post_comments" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-demo-community-feed"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [limit, queryClient]);

  if (!feed.data?.length) return null;

  return (
    <section className="space-y-3" aria-label="Publicaciones de la comunidad Cupido">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Perfiles de muestra identificados como comunidad demo.</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-400/5 px-2.5 py-1 text-[10px] font-medium text-amber-100/80">
          <Sparkles className="size-3" /> Comunidad demo
        </span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {feed.data.map((post) => (
          <article key={post.id} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/80 shadow-lg shadow-black/10">
            <div className="flex items-center gap-2.5 p-3">
              <Avatar className="size-10 shrink-0 border border-pink-300/20">
                <AvatarImage src={post.avatar_url} alt={post.display_name} />
                <AvatarFallback>{post.display_name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{post.display_name}, {post.age}</p>
                <p className="truncate text-[11px] text-zinc-400">{COUNTRY_NAMES[post.country_code] ?? post.country_code} · Comunidad demo</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-zinc-400" title="Seguidores de muestra">
                <Users className="size-3" /> {Number(post.follower_count).toLocaleString("es")}
              </span>
            </div>
            <img src={post.media_url} alt={`Foto de muestra publicada por ${post.display_name}`} loading="lazy" className="aspect-[4/3] w-full bg-zinc-800 object-cover" />
            <div className="space-y-2 p-3">
              <p className="line-clamp-2 text-sm leading-relaxed text-zinc-200">{post.caption}</p>
              <p className="line-clamp-2 text-xs text-zinc-400">{post.bio}</p>
              <div className="flex items-center gap-3 border-t border-white/5 pt-2 text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1"><Heart className="size-3 text-pink-300" /> {Number(post.likes_count).toLocaleString("es")}</span>
                <span className="inline-flex items-center gap-1"><MessageCircle className="size-3 text-sky-300" /> {Number(post.comments_count).toLocaleString("es")}</span>
              </div>
              {post.comments?.slice(0, 2).map((comment, index) => (
                <p key={`${post.id}-${index}`} className="line-clamp-1 text-[11px] text-zinc-400"><span className="font-semibold text-zinc-300">{comment.display_name}</span> {comment.body}</p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
