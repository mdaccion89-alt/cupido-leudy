import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { COUNTRIES, LOOKING_FOR, countryFlag } from "@/lib/cupido";
import { databaseErrorMessage, SUPREME_ADMIN_EMAIL } from "@/lib/posts";
import { useLivePresenceCounts } from "@/lib/use-live-presence-counts";

type FriendMap = Map<string, string>;

export function CommunityPage({ highlightPostId, searchTerm }: { highlightPostId?: string | undefined; searchTerm?: string | undefined } = {}) {
  const { session, onlineUserIds } = useAuth();
  const viewerId = session?.user.id ?? null;
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("all");
  const [sortMode, setSortMode] = useState("featured");
  const [discoveryView, setDiscoveryView] = useState<"online" | "live" | "following">("online");
  const [looking, setLooking] = useState("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [optimisticPasses, setOptimisticPasses] = useState<string[]>([]);
  const countryTouched = useRef(false);

  const viewerCountry = useQuery({
    queryKey: ["cupido-discovery-country", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_public_profiles").select("country_code").eq("id", viewerId!).maybeSingle();
      if (error) throw error;
      return data?.country_code ?? "";
    },
  });

  useEffect(() => {
    const code = viewerCountry.data?.toUpperCase();
    if (!countryTouched.current && code && COUNTRIES.some(([countryCode]) => countryCode === code)) setCountry(code);
  }, [viewerCountry.data]);

  const people = useQuery({
    queryKey: ["cupido-people", viewerId, search, country, looking, verifiedOnly, sortMode],
    queryFn: async () => {
      const officialProfile = await supabase.from("cupido_public_profiles").select("id").eq("is_super_admin", true).limit(1).maybeSingle();
      if (officialProfile.error) console.error("[comunidad] No se pudo localizar la cuenta oficial.", officialProfile.error);

      const loadPage = async (from: number) => {
        let query = supabase
          .from("cupido_public_profiles")
          .select("id,display_name,avatar_url,bio,country_code,looking_for,zodiac,smokes,hobbies,survey_completed,drinks,has_kids,is_verified_blue,is_gran_liga,is_super_admin,is_official,is_cupido_active,friend_count,follower_count,created_at")
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
          .select("id,display_name,avatar_url,bio,country_code,looking_for,zodiac,smokes,hobbies,survey_completed,drinks,has_kids,is_verified_blue,is_gran_liga,is_super_admin,is_official,is_cupido_active,friend_count,follower_count,created_at")
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
          email: row.is_super_admin ? SUPREME_ADMIN_EMAIL : null,
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
      if (sortMode === "new") {
        return [...official, ...candidates.filter((row) => !row.is_official_profile)
          .sort((a, b) => Date.parse(String(b.created_at ?? "")) - Date.parse(String(a.created_at ?? "")))];
      }
      return [...official, ...verified, ...newcomers];
    },
  });

  const activeLives = useQuery({
    queryKey: ["cupido-discovery-live-streams"],
    queryFn: async () => {
      let query = supabase.from("cupido_live_rooms").select("id,host_id,viewer_count").eq("is_live", true).order("created_at", { ascending: false }).limit(40);
      if (viewerId) query = query.neq("host_id", viewerId);
      const { data, error } = await query;
      if (error) {
        console.warn("[comunidad] No se pudo cargar la lista de Lives activos.", error);
        return [];
      }
      return (data ?? []).map((room) => ({ id: room.id, host_id: room.host_id, viewers_count: room.viewer_count }));
    },
    staleTime: 0,
    refetchInterval: 20_000,
  });
  const livePresenceCounts = useLivePresenceCounts(activeLives.data?.map((live) => live.id) ?? []);

  useEffect(() => {
    const channel = supabase
      .channel((`cupido-discovery-live-${viewerId ?? "guest"}`) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "creator_profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-people"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_live_rooms" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-discovery-live-streams"] });
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
      const [likes, follows, friends] = await Promise.all([
        supabase.from("cupido_likes").select("target_id,kind").eq("actor_id", viewerId!),
        supabase.from("follows").select("following_id").eq("follower_id", viewerId!),
        supabase
          .from("friend_requests")
          .select("requester_id,addressee_id,status")
          .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`),
      ]);
      if (likes.error) throw likes.error;
      if (follows.error) throw follows.error;
      if (friends.error) throw friends.error;
      const liked = new Set((likes.data ?? []).filter((row) => row.kind === "interested").map((row) => row.target_id));
      const passed = new Set((likes.data ?? []).filter((row) => row.kind === "pass").map((row) => row.target_id));
      const profileLikes = new Set((likes.data ?? []).filter((row) => row.kind === "like").map((row) => row.target_id));
      const following = new Set((follows.data ?? []).map((row) => row.following_id));
      const latestPostByUser = new Map<string, string>();
      const likedPosts = new Set<string>();
      const friendMap: FriendMap = new Map(
        (friends.data ?? []).map((row) => [
          row.requester_id === viewerId ? row.addressee_id : row.requester_id,
          row.status,
        ]),
      );
      return { liked, passed, profileLikes, following, friendMap, latestPostByUser, likedPosts };
    },
  });

  const cards = useMemo<CupidoProfile[]>(
    () =>
      (people.data ?? []).filter((person) =>
        person.id === viewerId || (!relations.data?.passed.has(person.id) && !optimisticPasses.includes(person.id)),
      ).map((person) => {
        const live = activeLives.data?.find((stream) => stream.host_id === person.id);
        return ({
        id: person.id,
        display_name: person.display_name?.trim() || (person.is_official_profile ? "Cupido Leudy Cuenta Oficial" : "Miembro"),
        avatar_url: person.avatar_url ?? "",
        bio: person.bio ?? "",
        country_code: person.country_code ?? "",
        email: person.email ?? null,
        official: Boolean(person.is_super_admin || person.is_official),
        isAdmin: Boolean(person.is_super_admin),
        looking_for: person.looking_for ?? "amistad",
        drinks: Boolean(person.drinks),
        has_kids: Boolean(person.has_kids),
        is_verified_blue: Boolean(person.is_verified_blue),
        is_gran_liga: Boolean(person.is_gran_liga),
        friend_count: person.friend_count ?? 0,
        follower_count: person.follower_count ?? 0,
        survey_completed: Boolean(person.survey_completed),
        isOnline: onlineUserIds.includes(person.id),
        ...(live ? { live_id: live.id, live_viewers: livePresenceCounts[live.id] ?? live.viewers_count } : {}),
      }); }),
    [people.data, relations.data?.passed, optimisticPasses, viewerId, activeLives.data, livePresenceCounts, onlineUserIds],
  );

  const visibleCards = useMemo(() => cards.filter((person) => {
    if (discoveryView === "online") return Boolean(person.isOnline);
    if (discoveryView === "live") return Boolean(person.live_id);
    return Boolean(relations.data?.following.has(person.id));
  }), [cards, discoveryView, relations.data?.following]);

  const requireLogin = () => {
    toast.info("Inicia sesión para conectar.");
    void navigate({ to: "/auth", search: { ref: "" } });
  };

  const like = useMutation({
    mutationFn: async ({ targetId, kind, remove = false }: { targetId: string; kind: "interested" | "pass" | "like"; remove?: boolean }) => {
      if (!viewerId) return requireLogin();
      const { error } = await supabase.rpc("cupido_set_like", {
        _target: targetId,
        _kind: kind,
        _remove: remove,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferencia guardada ❤️");
      void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-people", viewerId] });
    },
    onMutate: async ({ targetId, kind }) => {
      if (kind === "pass") setOptimisticPasses((ids) => ids.includes(targetId) ? ids : [...ids, targetId]);
    },
    onError: (error, variables) => {
      if (variables.kind === "pass") setOptimisticPasses((ids) => ids.filter((id) => id !== variables.targetId));
      console.error("[comunidad] cupido_set_like devolvió un error de Supabase.", error);
      toast.error(databaseErrorMessage(error, "No se pudo guardar tu interés."));
    },
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

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Vistas de Descubrir" className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1">
          {([["online", "En Línea"], ["live", "En directo"], ["following", "Siguiendo"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={discoveryView === value} onClick={() => setDiscoveryView(value)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold ${discoveryView === value ? "bg-pink-500/20 text-pink-100" : "text-muted-foreground hover:text-white"}`}>{label}</button>
          ))}
        </nav>
        <div className="flex min-w-44 items-center gap-2">
          <Label htmlFor="discovery-sort" className="shrink-0">Ordenar</Label>
          <Select value={sortMode} onValueChange={setSortMode}>
            <SelectTrigger id="discovery-sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="featured">Destacado</SelectItem>
              <SelectItem value="new">Nuevo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

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
        <WallFeed
          highlightPostId={highlightPostId}
          searchTerm={searchTerm || search}
          emptyText="Todavía no hay publicaciones. Sé la primera persona en compartir una foto o video ❤️"
          onOpenVideo={isMobile ? (postId) => void navigate({ to: "/videos", search: { post: postId } }) : undefined}
        />
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
          <Select value={country} onValueChange={(value) => { countryTouched.current = true; setCountry(value); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">Todos los países</SelectItem>
              {COUNTRIES.map(([code, name]) => (
                <SelectItem key={code} value={code}>{countryFlag(code)} {name}{code === viewerCountry.data?.toUpperCase() ? " · Tu país" : ""}</SelectItem>
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
      ) : visibleCards.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {visibleCards.map((person) => (
            <ProfileCard
              key={person.id}
              profile={person}
              myId={viewerId}
              interested={relations.data?.liked.has(person.id)}
              following={relations.data?.following.has(person.id)}
              liked={relations.data?.profileLikes.has(person.id)}
              friendStatus={relations.data?.friendMap.get(person.id)}
              onInterested={(kind) => like.mutate({ targetId: person.id, kind })}
              onLike={() => like.mutate({ targetId: person.id, kind: "like" })}
              onUnlike={() => like.mutate({ targetId: person.id, kind: "like", remove: true })}
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
