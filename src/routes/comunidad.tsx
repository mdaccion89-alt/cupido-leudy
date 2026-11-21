import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, SlidersHorizontal, Users } from "lucide-react";
import { toast } from "sonner";
import { ProfileCard, type CupidoProfile } from "@/components/cupido/profile-card";
import { WallFeed } from "@/components/cupido/wall-feed";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { COUNTRIES, LOOKING_FOR, countryFlag } from "@/lib/cupido";
import { SUPREME_ADMIN_EMAIL } from "@/lib/posts";

export const Route = createFileRoute("/comunidad")({
  head: () => ({ meta: [{ title: "Comunidad — Cupido Leudy ❤️" }] }),
  component: CommunityPage,
});

type FriendMap = Map<string, string>;

export function CommunityPage({ highlightPostId }: { highlightPostId?: string | undefined } = {}) {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("all");
  const [looking, setLooking] = useState("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const people = useQuery({
    queryKey: ["cupido-people", search, country, looking, verifiedOnly],
    queryFn: async () => {
      const officialProfile = await supabase.from("cupido_public_profiles").select("id").or("is_super_admin.eq.true,is_official.eq.true").limit(1).maybeSingle();
      if (officialProfile.error) console.error("[comunidad] No se pudo localizar la cuenta oficial.", officialProfile.error);

      const loadPage = async (from: number) => {
        let query = supabase
          .from("cupido_public_profiles")
          .select("id,display_name,avatar_url,bio,country_code,looking_for,zodiac,smokes,hobbies,survey_completed,drinks,has_kids,is_verified_blue,is_super_admin,is_official,is_cupido_active,friend_count,follower_count,created_at")
          .eq("is_cupido_active", true)
          .order("is_verified_blue", { ascending: false })
          .order("follower_count", { ascending: false });
        if (country !== "all") query = query.eq("country_code", country);
        if (looking !== "all") query = query.eq("looking_for", looking);
        if (verifiedOnly) query = query.eq("is_verified_blue", true);
        if (search.trim()) query = query.ilike("display_name", `%${search.trim()}%`);
        const { data, error } = await query.range(from, from + 999);
        if (error) {
          console.error("[comunidad] Falló la consulta pública de perfiles.", error);
          throw error;
        }
        return data ?? [];
      };
      let rows = [];
      for (let from = 0; ; from += 1000) {
        const page = await loadPage(from);
        rows.push(...page);
        if (page.length < 1000) break;
      }

      const officialId = officialProfile.data?.id ?? null;
      if (officialId && !rows.some((row) => row.id === officialId)) {
        const official = await supabase
          .from("cupido_public_profiles")
          .select("id,display_name,avatar_url,bio,country_code,looking_for,zodiac,smokes,hobbies,survey_completed,drinks,has_kids,is_verified_blue,is_super_admin,is_official,is_cupido_active,friend_count,follower_count,created_at")
          .eq("id", officialId)
          .maybeSingle();
        if (official.error) {
          console.error("[comunidad] Falló la consulta del perfil oficial.", official.error);
          throw official.error;
        }
        if (official.data) rows = [...rows, official.data];
      }
      const ids = [...new Set(rows.map((row) => row.id))];
      const followerMap = new Map<string, number>();
      if (ids.length) {
        const followers = await supabase.rpc("cupido_count_followers_batch", { _following: ids });
        if (followers.error) {
          console.error("[comunidad] No se pudo consultar el conteo de seguidores; se usan los conteos sincronizados.", followers.error);
        } else {
          for (const row of followers.data ?? []) followerMap.set(row.following_id, Number(row.follower_count) || 0);
        }
      }
      const candidates = rows.map((row) => {
        const official = row.id === officialId || Boolean(row.is_super_admin || row.is_official);
        const realFollowers = (followerMap.get(row.id) ?? Number(row.follower_count)) || 0;
        return {
          ...row,
          email: official ? SUPREME_ADMIN_EMAIL : null,
          is_cupido_active: Boolean(row.is_cupido_active) || official,
          follower_count: realFollowers,
          is_official_profile: official,
        };
      });
      const official = candidates.filter((row) => row.is_official_profile);
      const verified = candidates.filter((row) => !row.is_official_profile && row.is_verified_blue).sort((a, b) => b.follower_count - a.follower_count);
      const newcomers = candidates
        .filter((row) => !row.is_official_profile && !row.is_verified_blue)
        .sort((a, b) => Date.parse(String(b.created_at ?? "")) - Date.parse(String(a.created_at ?? "")));
      return [...official, ...verified, ...newcomers];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`cupido-discovery-live-${viewerId ?? "guest"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "creator_profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-people"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "follows" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-people"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_follower_count_events" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-people"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_likes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_likes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, viewerId]);

  const relations = useQuery({
    queryKey: ["cupido-relations", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const [likes, follows, friends, posts, postLikes] = await Promise.all([
        supabase.from("cupido_likes").select("target_id,kind").eq("actor_id", viewerId!),
        supabase.from("follows").select("following_id").eq("follower_id", viewerId!),
        supabase
          .from("friend_requests")
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
      if (likes.error) throw likes.error;
      if (follows.error) throw follows.error;
      if (friends.error) throw friends.error;
      if (posts.error) throw posts.error;
      if (postLikes.error) throw postLikes.error;
      const liked = new Set((likes.data ?? []).filter((row) => row.kind === "interested").map((row) => row.target_id));
      const following = new Set((follows.data ?? []).map((row) => row.following_id));
      const friendMap: FriendMap = new Map(
        (friends.data ?? []).map((row) => [
          row.requester_id === viewerId ? row.addressee_id : row.requester_id,
          row.status,
        ]),
      );
      const latestPostByUser = new Map<string, string>();
      for (const post of posts.data ?? []) {
        if (!latestPostByUser.has(post.user_id)) latestPostByUser.set(post.user_id, post.id);
      }
      const likedPosts = new Set((postLikes.data ?? []).map((row) => row.post_id));
      return { liked, following, friendMap, latestPostByUser, likedPosts };
    },
  });

  const cards = useMemo<CupidoProfile[]>(
    () =>
      (people.data ?? []).map((person) => ({
        id: person.id,
        display_name: person.display_name?.trim() || (person.is_official_profile ? "Cupido Leudy Cuenta Oficial" : "Miembro"),
        avatar_url: person.avatar_url ?? "",
        bio: person.bio ?? "",
        country_code: person.country_code ?? "",
        email: person.email ?? null,
        official: Boolean(person.is_super_admin || person.is_official),
        looking_for: person.looking_for ?? "amistad",
        drinks: Boolean(person.drinks),
        has_kids: Boolean(person.has_kids),
        is_verified_blue: Boolean(person.is_verified_blue),
        friend_count: person.friend_count ?? 0,
        follower_count: person.follower_count ?? 0,
        survey_completed: Boolean(person.survey_completed),
      })),
    [people.data],
  );

  const requireLogin = () => {
    toast.info("Inicia sesión para conectar.");
    void navigate({ to: "/auth", search: { ref: "" } });
  };

  const like = useMutation({
    mutationFn: async ({ targetId, kind }: { targetId: string; kind: "interested" | "pass" }) => {
      if (!viewerId) return requireLogin();
      const { error } = await supabase.rpc("cupido_set_like", {
        _target: targetId,
        _kind: kind,
        _remove: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferencia guardada ❤️");
      void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
    },
    onError: () => toast.error("No se pudo guardar tu interés."),
  });

  const mediaLike = useMutation({
    mutationFn: async ({ postId, remove }: { postId: string; remove: boolean }) => {
      if (!viewerId) return requireLogin();
      if (remove && !relations.data?.likedPosts.has(postId)) {
        toast.info("Aún no marcaste que te gusta esta publicación.");
        return;
      }
      const { error } = await supabase.rpc("cupido_toggle_post_like", { _post: postId });
      if (error) throw error;
      toast.success(remove ? "Te gusta eliminado" : "❤️ Te gusta");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-media", viewerId] });
    },
    onError: () => toast.error("No se pudo actualizar el me gusta."),
  });

  const isPersonLiked = (profileId: string) => {
    const postId = relations.data?.latestPostByUser.get(profileId);
    return Boolean(postId && relations.data?.likedPosts.has(postId));
  };

  const likeLatestMedia = (profileId: string, remove: boolean) => {
    const postId = relations.data?.latestPostByUser.get(profileId);
    if (!postId) {
      toast.info("Esta persona aún no tiene fotos o videos para calificar.");
      return;
    }
    mediaLike.mutate({ postId, remove });
  };

  const follow = useMutation({
    mutationFn: async (targetId: string) => {
      if (!viewerId) return requireLogin();
      if (relations.data?.following.has(targetId)) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", viewerId)
          .eq("following_id", targetId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("follows").insert({ follower_id: viewerId, following_id: targetId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-people"] });
    },
    onError: () => toast.error("No se pudo actualizar el seguidor."),
  });

  const friend = useMutation({
    mutationFn: async (targetId: string) => {
      if (!viewerId) return requireLogin();
      const { error } = await supabase.from("friend_requests").upsert(
        { requester_id: viewerId, addressee_id: targetId, status: "pending" },
        { onConflict: "requester_id,addressee_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      toast.success("Solicitud de amistad enviada ❤️");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo enviar la solicitud."),
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="mb-6">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-pink-300" /> Comunidad
        </p>
        <h1 className="font-display text-3xl text-white sm:text-4xl">Personas reales, conexiones reales</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Filtra por país, intereses e insignia azul. Envía un me gusta, sigue o agrega como amigo.
        </p>
      </section>

      {!session && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-pink-400/30 bg-pink-500/10 p-4">
          <p className="text-sm text-pink-100/80">Inicia sesión para dar me gusta, seguir y agregar amigos.</p>
          <Link to="/auth" search={{ ref: "" }} className="text-sm font-medium text-white underline-offset-4 hover:underline">
            Iniciar sesión
          </Link>
        </div>
      )}

      <section className="mb-8 space-y-4" aria-label="Publicaciones recientes">
        <div>
          <h2 className="font-display text-2xl text-white">Muro público</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sube una foto o video y descubre las publicaciones nuevas de la comunidad.</p>
        </div>
        <WallFeed highlightPostId={highlightPostId} searchTerm={search} emptyText="Todavía no hay publicaciones. Sé la primera persona en compartir una foto o video ❤️" />
      </section>

      <section className="mb-6 grid gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label>Buscar por nombre</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre"
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>País</Label>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">Todos los países</SelectItem>
              {COUNTRIES.map(([code, name]) => (
                <SelectItem key={code} value={code}>{countryFlag(code)} {name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Busca</Label>
          <Select value={looking} onValueChange={setLooking}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Cualquier interés</SelectItem>
              {LOOKING_FOR.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.emoji} {item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2 pb-1">
          <Checkbox
            id="verified-only"
            checked={verifiedOnly}
            onCheckedChange={(value) => setVerifiedOnly(Boolean(value))}
          />
          <Label htmlFor="verified-only" className="flex items-center gap-1 text-sm">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Solo verificados
          </Label>
        </div>
      </section>

      {people.isLoading ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          Cargando personas…
        </div>
      ) : people.isError ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          No se pudo cargar la comunidad. Intenta de nuevo más tarde.
        </div>
      ) : cards.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {cards.map((person) => (
            <ProfileCard
              key={person.id}
              profile={person}
              myId={viewerId}
              interested={relations.data?.liked.has(person.id)}
              following={relations.data?.following.has(person.id)}
              liked={isPersonLiked(person.id)}
              friendStatus={relations.data?.friendMap.get(person.id)}
              onInterested={(kind) => like.mutate({ targetId: person.id, kind })}
              onLike={() => likeLatestMedia(person.id, false)}
              onUnlike={() => likeLatestMedia(person.id, true)}
              onFollow={() => follow.mutate(person.id)}
              onFriend={() => friend.mutate(person.id)}
            />
          ))}
        </section>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          No encontramos personas con esos filtros.
        </div>
      )}
    </main>
  );
}
