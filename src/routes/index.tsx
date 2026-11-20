import { useMemo, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Play, ShieldCheck, Sparkles, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { ProfileCard, type CupidoProfile } from "@/components/cupido/profile-card";
import { VideoCard, type CupidoVideo } from "@/components/cupido/video-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/cupido";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${BRAND} — Citas reales, chat social y videos cortos` },
      {
        name: "description",
        content:
          "Descubre personas reales, marca Me interesa, sigue perfiles, agrega amigos y comparte videos cortos en Cupido Leudy.",
      },
      { property: "og:title", content: `${BRAND} — Encuentra conexiones reales` },
      {
        property: "og:description",
        content: "Citas, chat, videos cortos y verificación azul en una sola app.",
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [passed, setPassed] = useState<string[]>([]);

  const profilesQuery = useQuery({
    queryKey: ["cupido-profiles", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_profiles")
        .select(
          "id,display_name,avatar_url,bio,country_code,looking_for,drinks,has_kids,is_verified_blue,friend_count,follower_count",
        )
        .order("created_at", { ascending: false })
        .limit(48);
      if (error) throw error;
      return (data ?? []) as CupidoProfile[];
    },
  });

  const likesQuery = useQuery({
    queryKey: ["cupido-likes", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data } = await supabase
        .from("cupido_likes")
        .select("target_id,kind")
        .eq("actor_id", userId!);
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
        .from("cupido_friends")
        .select("requester_id,addressee_id,status")
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
      return data ?? [];
    },
  });

  const videosQuery = useQuery({
    queryKey: ["cupido-videos", userId],
    queryFn: async () => {
      const { data: posts, error } = await supabase
        .from("cupido_posts")
        .select("id,user_id,media_path,caption,likes_count")
        .eq("kind", "video")
        .eq("moderation_status", "approved")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      const ids = [...new Set((posts ?? []).map((post) => post.user_id))];
      const profileRows = ids.length
        ? (
            await supabase
              .from("creator_profiles")
              .select("id,display_name,avatar_url,is_verified_blue")
              .in("id", ids)
          ).data ?? []
        : [];
      return (posts ?? []).map((post): CupidoVideo => {
        const profile = profileRows.find((row) => row.id === post.user_id);
        return {
          id: post.id,
          user_id: post.user_id,
          media_url: post.media_path,
          caption: post.caption,
          likes_count: post.likes_count,
          display_name: profile?.display_name ?? "Miembro de Cupido",
          avatar_url: profile?.avatar_url ?? "",
          is_verified_blue: profile?.is_verified_blue ?? false,
        };
      });
    },
  });

  const videoLikesQuery = useQuery({
    queryKey: ["cupido-video-likes", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data } = await supabase.from("cupido_post_likes").select("post_id").eq("user_id", userId!);
      return (data ?? []).map((row) => row.post_id);
    },
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
  const likedVideoIds = useMemo(() => new Set(videoLikesQuery.data ?? []), [videoLikesQuery.data]);

  const profiles = (profilesQuery.data ?? []).filter(
    (profile) => profile.id !== userId && !passed.includes(profile.id),
  );

  const requireSession = () => {
    if (userId) return true;
    toast.error("Inicia sesión para interactuar en Cupido Leudy ❤️");
    return false;
  };

  const handleInterested = async (targetId: string, kind: "interested" | "pass") => {
    if (!requireSession()) return;
    const { error } = await supabase
      .from("cupido_likes")
      .upsert({ actor_id: userId!, target_id: targetId, kind }, { onConflict: "actor_id,target_id" });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (kind === "pass") setPassed((current) => [...current, targetId]);
    else toast.success("Me interesa guardado ❤️");
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
      const { error } = await supabase
        .from("follows")
        .insert({ follower_id: userId!, following_id: targetId });
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
    const { error } = await supabase.from("cupido_friends").insert({
      requester_id: userId!,
      addressee_id: targetId,
      status: "pending",
    });
    if (error) toast.error(error.message);
    else toast.success("Solicitud de amistad enviada ❤️");
    void queryClient.invalidateQueries({ queryKey: ["cupido-friends", userId] });
  };

  const handleVideoLike = async (postId: string) => {
    if (!requireSession()) return;
    if (likedVideoIds.has(postId)) {
      const { error } = await supabase
        .from("cupido_post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", userId!);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("cupido_post_likes")
        .insert({ post_id: postId, user_id: userId! });
      if (error) toast.error(error.message);
    }
    void queryClient.invalidateQueries({ queryKey: ["cupido-video-likes", userId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-videos", userId] });
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    if (!requireSession()) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Elige un archivo de video.");
      return;
    }
    if (file.size > 60 * 1024 * 1024) {
      toast.error("El video debe pesar menos de 60 MB.");
      return;
    }
    setUploading(true);
    const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const path = `${userId}/videos/${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from("cupido-media").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      toast.error(error.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("cupido-media").getPublicUrl(path);
    const { error: insertError } = await supabase.from("cupido_posts").insert({
      user_id: userId!,
      kind: "video",
      caption: caption.trim(),
      media_path: data.publicUrl,
      moderation_status: "approved",
    });
    if (insertError) toast.error(insertError.message);
    else {
      toast.success("Video publicado en Cupido Leudy ❤️");
      setCaption("");
      void queryClient.invalidateQueries({ queryKey: ["cupido-videos", userId] });
    }
    if (fileRef.current) fileRef.current.value = "";
    setUploading(false);
  };

  return (
    <main className="relative mx-auto w-full max-w-6xl px-5 pb-10 sm:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-pink-500/25 bg-gradient-to-br from-pink-600/20 via-fuchsia-600/10 to-transparent p-8 sm:p-12">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-pink-400/40 bg-black/20 px-3 py-1 text-xs text-pink-200">
            <Sparkles className="h-3.5 w-3.5" /> Citas reales, cero perfiles falsos
          </span>
          <h1 className="mt-5 font-display text-4xl leading-tight text-white sm:text-5xl">
            Encuentra a tu persona en <span className="text-pink-300">{BRAND}</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm text-slate-300 sm:text-base">
            Descubre perfiles verificados, marca <strong>Me interesa</strong>, sigue a quien te guste,
            agrega amigos y comparte videos cortos. El Escudo Cupido cuida cada conexión.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {session ? (
              <Button asChild size="lg">
                <Link to="/chat">Ir a mis chats</Link>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link to="/auth">Crear mi cuenta gratis</Link>
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link to="/tienda">Comprar créditos desde 5,000</Link>
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
          <TabsTrigger value="videos">Videos cortos</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-5">
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
                  friendStatus={friendMap.get(profile.id)}
                  onInterested={(kind) => void handleInterested(profile.id, kind)}
                  onFollow={() => void handleFollow(profile.id)}
                  onFriend={() => void handleFriend(profile.id)}
                  onGift={() => {
                    if (requireSession()) window.location.assign(`/tienda?userId=${profile.id}`);
                  }}
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
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                <Play className="h-4 w-4 text-pink-300" /> Sube tu video corto
              </p>
              <p className="text-xs text-muted-foreground">Hasta 60 MB. Se publica al instante.</p>
            </div>
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Describe tu video…"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
            />
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
              <Upload className="h-4 w-4" />
              {uploading ? "Subiendo…" : "Subir video"}
            </Button>
          </div>
          {videosQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando videos…</p>
          ) : (videosQuery.data ?? []).length ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {(videosQuery.data ?? []).map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  liked={likedVideoIds.has(video.id)}
                  onLike={() => void handleVideoLike(video.id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Sé el primero en publicar un video corto en Cupido Leudy ❤️
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
