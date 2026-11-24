import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, ShieldCheck, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { InviteButton } from "@/components/cupido/invite-button";
import { CommunityDemoFeed } from "@/components/cupido/community-demo-feed";
import { PeopleSuggestions } from "@/components/cupido/people-suggestions";
import { ProfileCard, type CupidoProfile } from "@/components/cupido/profile-card";
import { StoryFeed } from "@/components/cupido/story-feed";
import { WallFeed } from "@/components/cupido/wall-feed";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { BRAND, SLOGAN } from "@/lib/cupido";
import { fetchFeed, SUPREME_ADMIN_EMAIL, togglePostLike } from "@/lib/posts";
import { fetchBlockedUserIds } from "@/lib/safety";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${BRAND} — ${SLOGAN}` },
      {
        name: "description",
        content: `${SLOGAN}. Marca Me interesa, sigue perfiles, agrega amigos y comparte fotos y videos en ${BRAND}.`,
      },
      { property: "og:title", content: `${BRAND} — ${SLOGAN}` },
      {
        property: "og:description",
        content: `${SLOGAN}. Chat, fotos, videos y verificación azul en una sola app.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CupidoHome,
});

function CupidoHome() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const [passed, setPassed] = useState<string[]>([]);

  const profilesQuery = useQuery({
    queryKey: ["cupido-profiles", userId],
    queryFn: async () => {
      const officialProfile = await supabase.from("cupido_public_profiles").select("id").eq("is_super_admin", true).limit(1).maybeSingle();
      if (officialProfile.error) console.error("[inicio] No se pudo localizar la cuenta oficial.", officialProfile.error);
      const loadPage = async (from: number) => {
        const { data, error } = await supabase
          .from("cupido_public_profiles")
          .select("id,display_name,avatar_url,bio,country_code,looking_for,drinks,has_kids,is_verified_blue,is_gran_liga,is_super_admin,is_official,is_cupido_active,survey_completed,friend_count,follower_count,created_at")
          .eq("is_cupido_active", true)
          .order("is_verified_blue", { ascending: false })
          .order("follower_count", { ascending: false })
          .range(from, from + 999);
        if (error) {
          console.error("[inicio] Falló la consulta de perfiles públicos.", error);
          throw error;
        }
        return data ?? [];
      };
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const page = await loadPage(from);
        rows.push(...page);
        if (page.length < 1000) break;
      }
      const officialId = officialProfile.data?.id ?? null;
      if (officialId && !rows.some((row) => row.id === officialId)) {
        const { data, error } = await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url,bio,country_code,looking_for,drinks,has_kids,is_verified_blue,is_gran_liga,is_super_admin,is_official,is_cupido_active,survey_completed,friend_count,follower_count,created_at").eq("id", officialId).maybeSingle();
        if (error) {
          console.error("[inicio] Falló la consulta del perfil oficial.", error);
          throw error;
        }
        if (data) rows.push(data);
      }
      const ids = [...new Set(rows.map((row) => row.id))];
      const followerMap = new Map<string, number>();
      if (ids.length) {
        const followerCounts = await supabase.rpc("cupido_count_followers_batch", { _following: ids });
        if (followerCounts.error) {
          console.error("[inicio] No se pudo leer el conteo real de seguidores; se usan los datos sincronizados.", followerCounts.error);
        } else {
          for (const row of followerCounts.data ?? []) followerMap.set(row.following_id, Number(row.follower_count) || 0);
        }
      }
      const people = rows.map((row) => ({
        ...row,
        email: row.is_super_admin ? SUPREME_ADMIN_EMAIL : null,
        display_name: row.display_name?.trim() || (row.id === officialId || row.is_official || row.is_super_admin ? "Cupido Leudy Cuenta Oficial" : "Miembro"),
        is_cupido_active: Boolean(row.is_cupido_active) || row.id === officialId || Boolean(row.is_official || row.is_super_admin),
        follower_count: (followerMap.get(row.id) ?? Number(row.follower_count)) || 0,
        survey_completed: Boolean(row.survey_completed),
        is_official_profile: row.id === officialId || Boolean(row.is_official || row.is_super_admin),
      }));
      const blockedIds = new Set(await fetchBlockedUserIds(userId));
      const visiblePeople = people.filter((person) => !blockedIds.has(person.id));
      const official = visiblePeople.filter((person) => person.is_official_profile);
      const verified = visiblePeople.filter((person) => !person.is_official_profile && person.is_verified_blue).sort((a, b) => b.follower_count - a.follower_count);
      const newcomers = visiblePeople
        .filter((person) => !person.is_official_profile && !person.is_verified_blue)
        .sort((a, b) => Date.parse(String(b.created_at ?? "")) - Date.parse(String(a.created_at ?? "")));
      return [...official, ...verified, ...newcomers] as CupidoProfile[];
    },
  });

  const likesQuery = useQuery({
    queryKey: ["cupido-likes", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_likes").select("target_id,kind").eq("actor_id", userId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const followsQuery = useQuery({
    queryKey: ["cupido-follows", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data } = await supabase.from("follows").select("following_id").eq("follower_id", userId!);
      return (data ?? []).map((row) => row.following_id);
    },
  });

  const friendsQuery = useQuery({
    queryKey: ["cupido-friends", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from("friend_requests")
        .select("requester_id,addressee_id,status")
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
      return data ?? [];
    },
  });

  const mediaQuery = useQuery({
    queryKey: ["cupido-media", userId],
    queryFn: () => fetchFeed({ viewerId: userId, limit: 24 }),
  });

  const interestedIds = useMemo(
    () => new Set((likesQuery.data ?? []).filter((row) => row.kind === "interested").map((row) => row.target_id)),
    [likesQuery.data],
  );
  const followingIds = useMemo(() => new Set(followsQuery.data ?? []), [followsQuery.data]);
  const friendMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of friendsQuery.data ?? []) {
      const other = row.requester_id === userId ? row.addressee_id : row.requester_id;
      map.set(other, row.status);
    }
    return map;
  }, [friendsQuery.data, userId]);
  const latestMediaByUser = useMemo(() => {
    const map = new Map<string, { id: string; user_id: string }>();
    for (const post of mediaQuery.data?.posts ?? []) {
      if (!map.has(post.user_id)) map.set(post.user_id, post);
    }
    return map;
  }, [mediaQuery.data]);

  useEffect(() => {
    const channel = supabase
      .channel((`cupido-home-live-${userId ?? "guest"}-${Date.now()}-${Math.random().toString(36).slice(2)}`) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_posts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "creator_profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-profiles", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "follows" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-profiles", userId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-follows", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-friends", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_likes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_likes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-likes", userId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

  const profiles = (profilesQuery.data ?? []).filter((profile) => {
    const official = profile.email?.toLowerCase() === SUPREME_ADMIN_EMAIL;
    const persistedPass = likesQuery.data?.some((row) => row.target_id === profile.id && row.kind === "pass") ?? false;
    const isSelf = profile.id === userId;
    return (isSelf ? official : true) && (isSelf || (!persistedPass && !passed.includes(profile.id)));
  });

  const requireSession = () => {
    if (userId) return true;
    toast.error("Inicia sesión para interactuar en Cupido Leudy ❤️");
    return false;
  };

  const handleInterested = async (targetId: string, kind: "interested" | "pass") => {
    if (!requireSession()) return;
    if (kind === "pass") setPassed((current) => current.includes(targetId) ? current : [...current, targetId]);
    const { error } = await supabase.rpc("cupido_set_like", {
      _target: targetId,
      _kind: kind,
      _remove: false,
    });
    if (error) {
      if (kind === "pass") setPassed((current) => current.filter((id) => id !== targetId));
      toast.error(error.message);
      return;
    }
    if (kind === "interested") toast.success("Me interesa guardado ❤️");
    void queryClient.invalidateQueries({ queryKey: ["cupido-likes", userId] });
  };

  const handleFollow = async (targetId: string) => {
    if (!requireSession()) return;
    if (followingIds.has(targetId)) {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", userId!)
        .eq("following_id", targetId);
      if (error) toast.error(error.message);
      else toast.success("Dejaste de seguir este perfil");
    } else {
      const { error } = await supabase.from("follows").insert({ follower_id: userId!, following_id: targetId });
      if (error) toast.error(error.message);
      else toast.success("Ahora sigues este perfil");
    }
    void queryClient.invalidateQueries({ queryKey: ["cupido-follows", userId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-profiles", userId] });
  };

  const handleFriend = async (targetId: string) => {
    if (!requireSession()) return;
    if (friendMap.has(targetId)) {
      toast.info("Ya existe una solicitud o amistad con este perfil.");
      return;
    }
    const { error } = await supabase.from("friend_requests").upsert(
      { requester_id: userId!, addressee_id: targetId, status: "pending" },
      { onConflict: "requester_id,addressee_id", ignoreDuplicates: true },
    );
    if (error) toast.error(error.message);
    else toast.success("Solicitud de amistad enviada ❤️");
    void queryClient.invalidateQueries({ queryKey: ["cupido-friends", userId] });
  };

  const handleProfileLike = async (profileId: string) => {
    if (!requireSession()) return;
    const post = latestMediaByUser.get(profileId);
    if (!post) {
      toast.info("Esta persona aún no tiene fotos o videos para calificar.");
      return;
    }
    const wasLiked = mediaQuery.data?.liked.has(post.id) ?? false;
    try {
      const next = await togglePostLike(post.id, wasLiked);
      toast.success(next ? "❤️ Te gusta" : "Te gusta eliminado");
      void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el me gusta.");
    }
  };

  return (
    <main className="relative mx-auto w-full max-w-6xl px-5 pb-10 sm:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-pink-500/25 bg-gradient-to-br from-pink-600/20 via-fuchsia-600/10 to-transparent p-8 sm:p-12">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-pink-400/40 bg-black/20 px-3 py-1 text-xs text-pink-200">
            <Sparkles className="h-3.5 w-3.5" /> Perfiles reales y comunidad demo identificada
          </span>
          <h1 className="mt-5 font-display text-4xl leading-tight text-white sm:text-5xl">
            Encuentra a tu persona en <span className="text-pink-300">{BRAND}</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm text-slate-300 sm:text-base">
            Descubre perfiles verificados, marca <strong>Me interesa</strong>, sigue a quien te guste,
            agrega amigos y comparte fotos y videos. El Escudo Cupido cuida cada conexión.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {session ? (
              <>
                <Button asChild size="lg">
                  <Link to="/chat">Ir a mis chats</Link>
                </Button>
                <InviteButton userId={session.user.id} compact />
              </>
            ) : (
              <Button asChild size="lg">
                <Link to="/auth" search={{ ref: "" }}>Crear mi cuenta gratis</Link>
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link to="/tienda" className="w-full max-w-full rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-center text-sm font-medium text-amber-200 whitespace-normal leading-tight sm:w-auto">Comprar monedas brillantes desde 5,000</Link>
            </Button>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-64 w-64 rounded-full bg-pink-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 right-24 h-48 w-48 rounded-full bg-fuchsia-500/20 blur-3xl" />
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { icon: ShieldCheck, title: "Insignia azul", text: "Verificación por selfie aprobada por el Admin Supremo." },
          { icon: Heart, title: "Me interesa", text: "Marca perfiles reales y descubre coincidencias." },
          { icon: Users, title: "Amigos y follows", text: "Sigue, agrega amigos y conversa sin límites." },
        ].map((item) => (
          <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <item.icon className="h-5 w-5 text-pink-300" />
            <p className="mt-2 font-semibold text-white">{item.title}</p>
            <p className="text-xs text-muted-foreground">{item.text}</p>
          </div>
        ))}
      </section>

      <Tabs defaultValue="people" className="mt-8">
        <TabsList>
          <TabsTrigger value="people">Descubrimiento</TabsTrigger>
          <TabsTrigger value="videos">Fotos y videos</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-5">
          <div className="mb-7 space-y-6">
            <StoryFeed compact />
            <PeopleSuggestions />
          </div>
          <div className="mb-7">
            <WallFeed />
          </div>
          <div className="mb-7">
            <CommunityDemoFeed title="Comunidad Cupido" />
          </div>
          {profilesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando perfiles reales…</p>
          ) : profiles.length ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {profiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  myId={userId}
                  interested={interestedIds.has(profile.id)}
                  following={followingIds.has(profile.id)}
                  liked={Boolean(latestMediaByUser.has(profile.id) && mediaQuery.data?.liked.has(latestMediaByUser.get(profile.id)!.id))}
                  friendStatus={friendMap.get(profile.id)}
                  onInterested={(kind) => void handleInterested(profile.id, kind)}
                  onLike={() => void handleProfileLike(profile.id)}
                  onUnlike={() => void handleProfileLike(profile.id)}
                  onFollow={() => void handleFollow(profile.id)}
                  onFriend={() => void handleFriend(profile.id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Aún no hay más perfiles. Invita a alguien o vuelve en un rato ❤️
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="videos" className="mt-5">
          <WallFeed videoOnly />
        </TabsContent>
      </Tabs>
    </main>
  );
}
