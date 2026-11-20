import { useMemo } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { ProfileCard, type CupidoProfile } from "@/components/cupido/profile-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/siguiendo")({
  head: () => ({ meta: [{ title: "Siguiendo — Cupido Leudy ❤️" }] }),
  component: FollowingPage,
});

function FollowingPage() {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const data = useQuery({
    queryKey: ["cupido-following", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const [follows, likes, friends, posts, postLikes] = await Promise.all([
        supabase.from("follows").select("following_id").eq("follower_id", viewerId!),
        supabase.from("cupido_likes").select("target_id,kind").eq("actor_id", viewerId!),
        supabase
          .from("cupido_friends")
          .select("requester_id,addressee_id,status")
          .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`),
        supabase
          .from("cupido_posts")
          .select("id,user_id")
          .eq("moderation_status", "approved")
          .order("created_at", { ascending: false })
          .limit(48),
        supabase.from("cupido_post_likes").select("post_id").eq("user_id", viewerId!),
      ]);
      if (follows.error) throw follows.error;
      if (likes.error) throw likes.error;
      if (friends.error) throw friends.error;
      if (posts.error) throw posts.error;
      if (postLikes.error) throw postLikes.error;
      const ids = (follows.data ?? []).map((row) => row.following_id);
      const profiles = ids.length
        ? await supabase.from("creator_profiles").select("*").in("id", ids)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const emails = ids.length
        ? await supabase.from("profiles").select("id,email").in("id", ids)
        : { data: [], error: null };
      if (emails.error) throw emails.error;
      return {
        profiles: profiles.data ?? [],
        emailMap: new Map((emails.data ?? []).map((row) => [row.id, row.email])),
        liked: new Set((likes.data ?? []).filter((row) => row.kind === "interested").map((row) => row.target_id)),
        following: new Set(ids),
        friendMap: new Map(
          (friends.data ?? []).map((row) => [
            row.requester_id === viewerId ? row.addressee_id : row.requester_id,
            row.status,
          ]),
        ),
        latestPostByUser: (posts.data ?? []).reduce<Map<string, string>>((map, post) => {
          if (!map.has(post.user_id)) map.set(post.user_id, post.id);
          return map;
        }, new Map()),
        likedPosts: new Set((postLikes.data ?? []).map((row) => row.post_id)),
      };
    },
  });

  const cards = useMemo<CupidoProfile[]>(
    () =>
      (data.data?.profiles ?? []).map((person) => ({
        id: person.id,
        display_name: person.display_name ?? "Miembro",
        avatar_url: person.avatar_url ?? "",
        bio: person.bio ?? "",
        country_code: person.country_code ?? "",
        email: data.data?.emailMap.get(person.id) ?? null,
        looking_for: person.looking_for ?? "amistad",
        drinks: Boolean(person.drinks),
        has_kids: Boolean(person.has_kids),
        is_verified_blue: Boolean(person.is_verified_blue),
        friend_count: person.friend_count ?? 0,
        follower_count: person.follower_count ?? 0,
      })),
    [data.data],
  );

  const follow = useMutation({
    mutationFn: async (targetId: string) => {
      if (!viewerId) return;
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", viewerId)
        .eq("following_id", targetId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dejaste de seguir a esta persona.");
      void queryClient.invalidateQueries({ queryKey: ["cupido-following", viewerId] });
    },
    onError: () => toast.error("No se pudo actualizar el seguidor."),
  });

  const like = useMutation({
    mutationFn: async ({ targetId, kind }: { targetId: string; kind: "interested" | "pass" }) => {
      if (!viewerId) return;
      const { error } = await supabase.rpc("cupido_set_like", { _target: targetId, _kind: kind, _remove: false });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cupido-following", viewerId] }),
    onError: () => toast.error("No se pudo guardar tu interés."),
  });

  const mediaLike = useMutation({
    mutationFn: async ({ postId, remove }: { postId: string; remove: boolean }) => {
      if (!viewerId) return;
      const { error } = await supabase.rpc("cupido_toggle_post_like", { _post: postId });
      if (error) throw error;
      toast.success(remove ? "Te gusta eliminado" : "❤️ Te gusta");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cupido-following", viewerId] }),
    onError: () => toast.error("No se pudo actualizar el me gusta."),
  });

  const friend = useMutation({
    mutationFn: async (targetId: string) => {
      if (!viewerId) return;
      const { error } = await supabase
        .from("cupido_friends")
        .insert({ requester_id: viewerId, addressee_id: targetId, status: "pending" });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Solicitud de amistad enviada ❤️"),
    onError: () => toast.error("No se pudo enviar la solicitud."),
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="mb-6">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-pink-300" /> Tu círculo
        </p>
        <h1 className="font-display text-3xl text-white sm:text-4xl">Siguiendo</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Las personas que seguiste. Mantén viva la conexión con un mensaje, un me gusta o un regalo.
        </p>
      </section>

      {!session && (
        <div className="mb-6 rounded-2xl border border-pink-400/30 bg-pink-500/10 p-4 text-sm text-pink-100/80">
          Inicia sesión para ver a quienes sigues. <Link to="/auth" search={{ ref: "" }} className="font-medium text-white underline">Entrar</Link>
        </div>
      )}

      {data.isLoading ? (
        <p className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : cards.length ? (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {cards.map((person) => {
            const postId = data.data?.latestPostByUser.get(person.id);
            return (
              <ProfileCard
                key={person.id}
                profile={person}
                myId={viewerId}
                following
                interested={data.data?.liked.has(person.id)}
                liked={Boolean(postId && data.data?.likedPosts.has(postId))}
                friendStatus={data.data?.friendMap.get(person.id)}
                onInterested={(kind) => like.mutate({ targetId: person.id, kind })}
                onLike={() => postId && mediaLike.mutate({ postId, remove: false })}
                onUnlike={() => postId && mediaLike.mutate({ postId, remove: true })}
                onFollow={() => follow.mutate(person.id)}
                onFriend={() => friend.mutate(person.id)}
                onGift={() => void navigate({ to: "/tienda", search: { userId: person.id } })}
              />
            );
          })}
        </section>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          Aún no sigues a nadie. Explora Descubrir y toca Seguir ❤️
        </div>
      )}
    </main>
  );
}
