import { useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Play, ShieldCheck, Sparkles, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { MediaCard, type CupidoMedia } from "@/components/cupido/media-card";
import { ProfileCard, type CupidoProfile } from "@/components/cupido/profile-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { BRAND, SLOGAN } from "@/lib/cupido";
import { compressImageFile, readVideoDuration, safeExtension, uploadPublicImage } from "@/lib/storage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${BRAND} — ${SLOGAN}` },
      {
        name: "description",
        content: `${SLOGAN}. Marca Me interesa, sigue perfiles, agrega amigos y comparte fotos y videos cortos en ${BRAND}.`,
      },
      { property: "og:title", content: `${BRAND} — ${SLOGAN}` },
      {
        property: "og:description",
        content: `${SLOGAN}. Chat, fotos, videos cortos y verificación azul en una sola app.`,
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
      if (!data?.length) return [] as CupidoProfile[];
      const { data: emails } = await supabase
        .from("profiles")
        .select("id,email")
        .in("id", data.map((row) => row.id));
      const emailMap = new Map((emails ?? []).map((row) => [row.id, row.email]));
      return data.map((row) => ({ ...row, email: emailMap.get(row.id) ?? null })) as CupidoProfile[];
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

  const mediaQuery = useQuery({
    queryKey: ["cupido-media", userId],
    queryFn: async () => {
      const { data: posts, error } = await supabase
        .from("cupido_posts")
        .select("id,user_id,media_path,kind,caption,likes_count")
        .eq("moderation_status", "approved")
        .order("created_at", { ascending: false })
        .limit(24);
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
      const emailRows = ids.length
        ? (await supabase.from("profiles").select("id,email").in("id", ids)).data ?? []
        : [];
      const emailMap = new Map(emailRows.map((row) => [row.id, row.email]));
      return (posts ?? []).map((post): CupidoMedia => {
        const profile = profileRows.find((row) => row.id === post.user_id);
        return {
          id: post.id,
          user_id: post.user_id,
          media_url: post.media_path,
          kind: post.kind === "video" ? "video" : "photo",
          caption: post.caption,
          likes_count: post.likes_count,
          display_name: profile?.display_name ?? "Miembro de Cupido",
          avatar_url: profile?.avatar_url ?? "",
          is_verified_blue: profile?.is_verified_blue ?? false,
          email: emailMap.get(post.user_id) ?? null,
        };
      });
    },
  });

  const mediaLikesQuery = useQuery({
    queryKey: ["cupido-media-likes", userId],
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
  const likedMediaIds = useMemo(() => new Set(mediaLikesQuery.data ?? []), [mediaLikesQuery.data]);
  const latestMediaByUser = useMemo(() => {
    const map = new Map<string, CupidoMedia>();
    for (const media of mediaQuery.data ?? []) {
      if (!map.has(media.user_id)) map.set(media.user_id, media);
    }
    return map;
  }, [mediaQuery.data]);

  const isProfileLiked = (profileId: string) => {
    const media = latestMediaByUser.get(profileId);
    return Boolean(media && likedMediaIds.has(media.id));
  };

  useEffect(() => {
    const channel = supabase
      .channel("cupido-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_posts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media", userId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

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
    const { error } = await supabase.rpc("cupido_set_like", {
      _target: targetId,
      _kind: kind,
      _remove: false,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (kind === "pass") setPassed((current) => [...current, targetId]);
    else toast.success("Me interesa guardado ❤️");
    void queryClient.invalidateQueries({ queryKey: ["cupido-likes", userId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-notifications", targetId] });
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

  const handleMediaLike = async (postId: string, ownerId: string) => {
    if (!requireSession()) return;
    const wasLiked = likedMediaIds.has(postId);
    const { data, error } = await supabase.rpc("cupido_toggle_post_like", { _post: postId });
    if (error) {
      toast.error(error.message);
      return;
    }
    const isLiked = typeof data === "boolean" ? data : !wasLiked;
    toast.success(isLiked ? "❤️ Te gusta" : "Te gusta eliminado");
    void queryClient.invalidateQueries({ queryKey: ["cupido-media-likes", userId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-media", userId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-notifications", ownerId] });
  };

  const handleMediaUnlike = async (postId: string, ownerId: string) => {
    if (!requireSession()) return;
    if (!likedMediaIds.has(postId)) {
      toast.info("Aún no marcaste que te gusta esta publicación.");
      return;
    }
    const { error } = await supabase.rpc("cupido_toggle_post_like", { _post: postId });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Te gusta eliminado");
    void queryClient.invalidateQueries({ queryKey: ["cupido-media-likes", userId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-media", userId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-notifications", ownerId] });
  };

  const handleProfileLike = async (profileId: string) => {
    const media = latestMediaByUser.get(profileId);
    if (!media) {
      toast.info("Esta persona aún no tiene fotos o videos para calificar.");
      return;
    }
    await handleMediaLike(media.id, profileId);
  };

  const handleProfileUnlike = async (profileId: string) => {
    const media = latestMediaByUser.get(profileId);
    if (!media) {
      toast.info("Esta persona aún no tiene fotos o videos para calificar.");
      return;
    }
    await handleMediaUnlike(media.id, profileId);
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    if (!requireSession()) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      toast.error("Elige una foto o un video corto.");
      return;
    }
    if (isVideo && file.size > 20 * 1024 * 1024) {
      toast.error("El video debe pesar menos de 20 MB para ahorrar espacio.");
      return;
    }
    if (!isVideo && file.size > 25 * 1024 * 1024) {
      toast.error("La foto es demasiado grande. Elige una imagen de menos de 25 MB.");
      return;
    }
    let uploadFile = file;
    try {
      if (isVideo) {
        const duration = await readVideoDuration(file);
        if (duration > 20) {
          toast.error("Los videos deben durar máximo 20 segundos.");
          return;
        }
      } else {
        uploadFile = await compressImageFile(file);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo preparar el archivo.");
      return;
    }
    setUploading(true);
    const extension = safeExtension(uploadFile.name, isVideo ? "mp4" : "jpg");
    let url: string;
    try {
      const result = await uploadPublicImage(userId!, uploadFile, "posts", extension);
      url = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo subir el archivo.");
      setUploading(false);
      return;
    }
    const { error: insertError } = await supabase.from("cupido_posts").insert({
      user_id: userId!,
      kind: isVideo ? "video" : "photo",
      caption: caption.trim(),
      media_path: url,
      moderation_status: "approved",
    });
    if (insertError) toast.error(insertError.message);
    else {
      toast.success(isVideo ? "Video publicado en Cupido Leudy ❤️" : "Foto publicada en Cupido Leudy ❤️");
      setCaption("");
      void queryClient.invalidateQueries({ queryKey: ["cupido-media", userId] });
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
            agrega amigos y comparte fotos y videos cortos. El Escudo Cupido cuida cada conexión.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {session ? (
              <Button asChild size="lg">
                <Link to="/chat">Ir a mis chats</Link>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link to="/auth" search={{ ref: "" }}>Crear mi cuenta gratis</Link>
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link to="/tienda">Comprar monedas brillantes desde 5,000</Link>
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
                  liked={isProfileLiked(profile.id)}
                  friendStatus={friendMap.get(profile.id)}
                  onInterested={(kind) => void handleInterested(profile.id, kind)}
                  onLike={() => void handleProfileLike(profile.id)}
                  onUnlike={() => void handleProfileUnlike(profile.id)}
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
                <Play className="h-4 w-4 text-pink-300" /> Sube tus fotos o videos cortos
              </p>
              <p className="text-xs text-muted-foreground">Fotos hasta 12 MB y videos hasta 60 MB. Se publican al instante.</p>
            </div>
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Describe tu foto o video…"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
              <Upload className="h-4 w-4" />
              {uploading ? "Subiendo…" : "Subir foto o video"}
            </Button>
          </div>
          {mediaQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando publicaciones…</p>
          ) : (mediaQuery.data ?? []).length ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {(mediaQuery.data ?? []).map((media) => (
                <MediaCard
                  key={media.id}
                  media={media}
                  myId={userId}
                  interested={interestedIds.has(media.user_id)}
                  liked={likedMediaIds.has(media.id)}
                  onInterested={() => void handleInterested(media.user_id, "interested")}
                  onPass={() => void handleInterested(media.user_id, "pass")}
                  onLike={() => void handleMediaLike(media.id, media.user_id)}
                  onUnlike={() => void handleMediaUnlike(media.id, media.user_id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Sé el primero en publicar una foto o video en Cupido Leudy ❤️
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
