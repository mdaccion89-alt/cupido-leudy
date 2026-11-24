import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Hash, Play, Plus, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { MediaCard } from "@/components/cupido/media-card";
import { MediaComposer } from "@/components/cupido/media-composer";
import { EmojiOverlayPicker, GlowingEmojiOverlay, serializeEmojiOverlay } from "@/components/cupido/glowing-emoji-picker";
import { MentionInput } from "@/components/cupido/mention-input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  createPost,
  fetchFeed,
  sharePost,
  deletePost,
  togglePostPinned,
  updatePost,
  togglePostDislike,
  togglePostLike,
  togglePostSave,
} from "@/lib/posts";
import { compressImageFile, isVideoFile, readVideoDuration, safeExtension, videoContentType, videoFileExtension } from "@/lib/storage";
import { mediaFilterCss, type MediaFilterId } from "@/lib/media-filters";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "heic", "avif"];

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message || fallback;
  if (value && typeof value === "object" && "message" in value) {
    const message = String((value as { message?: unknown }).message ?? "");
    if (message) return message;
  }
  return fallback;
}

type WallFeedProps = {
  videoOnly?: boolean;
  galleryOnly?: boolean;
  onlyUserId?: string | null;
  savedOnly?: boolean;
  likedOnly?: boolean;
  hideUpload?: boolean;
  composerOnly?: boolean;
  emptyText?: string;
  initialFollowingOnly?: boolean;
  showScopeTabs?: boolean;
  searchTerm?: string | undefined;
  highlightPostId?: string | undefined;
  onOpenVideo?: ((postId: string) => void) | undefined;
};

export function WallFeed({
  videoOnly = false,
  galleryOnly = false,
  onlyUserId = null,
  savedOnly = false,
  likedOnly = false,
  hideUpload = false,
  composerOnly = false,
  emptyText,
  initialFollowingOnly = false,
  showScopeTabs = true,
  searchTerm,
  highlightPostId,
  onOpenVideo,
}: WallFeedProps) {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [mediaFilter, setMediaFilter] = useState<MediaFilterId>("normal");
  const [emojiOverlay, setEmojiOverlay] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ file: File; filter: MediaFilterId } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [followingOnly, setFollowingOnly] = useState(initialFollowingOnly);
  const [feedLimit, setFeedLimit] = useState(24);
  const [uploading, setUploading] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [selectedHashtag, setSelectedHashtag] = useState("");

  const feed = useQuery({
    enabled: !composerOnly,
    queryKey: ["cupido-media", viewerId, videoOnly, galleryOnly, onlyUserId, savedOnly, likedOnly, followingOnly, feedLimit, searchTerm, selectedHashtag, highlightPostId],
    queryFn: async () => {
      setLoadingPosts(true);
      try {
        return await fetchFeed({ viewerId, limit: feedLimit, videoOnly, photoOnly: galleryOnly, onlyUserId, savedOnly, likedOnly, followingOnly, searchTerm: selectedHashtag || searchTerm, onlyPostId: highlightPostId });
      } finally {
        setLoadingPosts(false);
      }
    },
  });

  const trending = useQuery({
    enabled: !composerOnly,
    queryKey: ["cupido-trending-hashtags"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_posts").select("caption").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const post of data ?? []) {
        for (const match of String(post.caption ?? "").matchAll(/#[\p{L}\p{N}_]+/gu)) {
          const key = match[0].toLowerCase();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
    },
  });

  useEffect(() => {
    if (!draft) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(draft.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  useEffect(() => {
    const channelName = `cupido-wall-live-${viewerId ?? "guest"}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel((channelName) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_posts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-historia"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-trending-hashtags"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_likes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-historia"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_dislikes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-historia"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_saves" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_saved_posts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_comments" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-post-comments"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_comment_likes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-post-comments"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "creator_profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-post-comments"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "follows", filter: `follower_id=eq.${viewerId ?? "00000000-0000-0000-0000-000000000000"}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, viewerId]);

  const requireSession = () => {
    if (viewerId) return true;
    toast.error("Inicia sesión para interactuar en Cupido Leudy ❤️");
    return false;
  };

  const invalidateFeed = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cupido-media"] }),
      queryClient.invalidateQueries({ queryKey: ["cupido-historia"] }),
      queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] }),
    ]);
  };

  const handleLike = async (postId: string, liked: boolean) => {
    if (!requireSession()) return;
    try {
      const next = await togglePostLike(postId, liked);
      toast.success(next ? "❤️ Te gusta" : "Te gusta eliminado");
      await invalidateFeed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el me gusta.");
    }
  };

  const handleDislike = async (postId: string, disliked: boolean) => {
    if (!requireSession()) return;
    try {
      const next = await togglePostDislike(postId, disliked);
      toast.success(next ? "Voto negativo registrado" : "Voto negativo eliminado");
      await invalidateFeed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar tu voto.");
    }
  };

  const handleSave = async (postId: string, saved: boolean) => {
    if (!requireSession()) return;
    try {
      const next = await togglePostSave(postId, saved);
      toast.success(next ? "Guardado en favoritos 🔖" : "Quitado de favoritos");
      await invalidateFeed();
      void queryClient.invalidateQueries({ queryKey: ["cupido-saved-posts"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar favoritos.");
    }
  };

  const handleShare = async (postId: string) => {
    const post = feed.data?.posts?.find((item) => item.id === postId);
    if (!post) return;
    try {
      const result = await sharePost(post);
      toast.success(result === "shared" ? "Publicación compartida ↗️" : "Enlace copiado al portapapeles ↗️");
      await invalidateFeed();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("No se pudo compartir la publicación.");
    }
  };

  const handleEdit = async (postId: string, nextTitle: string, nextCaption: string, filter: MediaFilterId, emojiOverlay: string) => {
    try {
      await updatePost(postId, nextTitle, nextCaption, filter, emojiOverlay);
      await invalidateFeed();
      toast.success("Publicación actualizada.");
    } catch (error) { toast.error(errorMessage(error, "No se pudo editar la publicación.")); }
  };

  const handleDelete = async (postId: string) => {
    try {
      await deletePost(postId);
      await invalidateFeed();
      toast.success("Publicación eliminada.");
    } catch (error) { toast.error(errorMessage(error, "No se pudo eliminar la publicación.")); }
  };

  const handlePin = async (postId: string, pinned: boolean) => {
    try {
      await togglePostPinned(postId, pinned);
      await invalidateFeed();
      toast.success(pinned ? "Publicación desfijada." : "Publicación fijada en tu perfil.");
    } catch (error) { toast.error(errorMessage(error, "No se pudo actualizar el fijado.")); }
  };

  const handleRepost = async (postId: string) => {
    if (!requireSession()) return;
    const post = feed.data?.posts.find((item) => item.id === postId);
    if (!post || !viewerId) return;
    try {
      await createPost({ userId: viewerId, caption: `Republicó una publicación de ${post.display_name}`, title: post.title, kind: "text", sharedPostId: post.id });
      await invalidateFeed();
      toast.success("Publicación compartida en tu muro.");
    } catch (error) { toast.error(errorMessage(error, "No se pudo republicar.")); }
  };

  const handlePick = async (file: File | null) => {
    if (!file) return;
    setDraft({ file, filter: mediaFilter });
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleTextPost = async () => {
    if (!viewerId) {
      requireSession();
      return;
    }
    if (!caption.trim() && !emojiOverlay.length) return;
    setUploading(true);
    try {
      await createPost({ userId: viewerId, caption, title, kind: "text", filterName: mediaFilter, emojiOverlay: serializeEmojiOverlay(emojiOverlay) });
      setCaption("");
      setTitle("");
      setEmojiOverlay([]);
      toast.success("Publicación compartida en el muro ❤️");
      await invalidateFeed();
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile-posts"] });
    } catch (error) {
      console.error("[muro] No se pudo publicar el texto.", error);
      toast.error(errorMessage(error, "No se pudo publicar. Inténtalo de nuevo."));
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async (file: File | null, filter = mediaFilter) => {
    if (!file || !viewerId) return;
    if (!requireSession()) return;
    const isVideo = isVideoFile(file);
    const extension = isVideo
      ? videoFileExtension(file)
      : safeExtension(file.name, file.type.startsWith("image/") ? (file.type.split("/")[1] ?? "jpg").replace(/^jpeg$/, "jpg") : "").toLowerCase();
    const isImage = file.type.startsWith("image/");
    if (galleryOnly && !isImage) {
      toast.error("En la galería del perfil solo se publican fotos.");
      return;
    }
    if (videoOnly && !isVideo) {
      toast.error("En Historia solo se publican videos cortos.");
      return;
    }
    if (!isVideo && !isImage) {
      toast.error("Elige una foto o un video corto.");
      return;
    }
    if (!isVideo && !IMAGE_EXTENSIONS.includes(extension)) {
      toast.error("Formato de imagen no admitido.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error(isVideo ? "El video debe pesar menos de 50 MB." : "La foto debe pesar menos de 50 MB.");
      return;
    }

    setUploading(true);
    let uploadedPath: string | null = null;
    let uploadedBucket: "cupido-media" | "media" = "cupido-media";
    try {
      let uploadFile = file;
      if (isVideo) {
        const duration = await readVideoDuration(uploadFile);
        if (duration !== null && duration > 30) throw new Error("Los videos deben durar máximo 30 segundos.");
      } else {
        uploadFile = await compressImageFile(uploadFile, 200 * 1024);
      }
      const finalExtension = isVideo ? extension : safeExtension(uploadFile.name, extension);
      const path = `${viewerId}/${Date.now()}.${finalExtension}`;
      const contentType = isVideo
        ? videoContentType(uploadFile, finalExtension)
        : uploadFile.type || "image/jpeg";
      let uploadResult = await supabase.storage.from("cupido-media").upload(path, uploadFile, {
        contentType,
        upsert: true,
      });
      if (uploadResult.error) {
        uploadedBucket = "media";
        uploadResult = await supabase.storage.from("media").upload(path, uploadFile, { contentType, upsert: true });
      }
      if (uploadResult.error) throw uploadResult.error;
      uploadedPath = path;
      const { data: publicData } = supabase.storage.from(uploadedBucket).getPublicUrl(path);
      const url = publicData?.publicUrl ?? "";
      if (!url) throw new Error("No se pudo obtener la URL pública del archivo.");
      await createPost({ userId: viewerId, caption, title, url, isVideo, filterName: filter, emojiOverlay: serializeEmojiOverlay(emojiOverlay) });
      setCaption("");
      setTitle("");
      setDraft(null);
      setEmojiOverlay([]);
      toast.success(isVideo ? "Video publicado en tu muro ❤️" : "Foto publicada en tu muro ❤️");
      await invalidateFeed();
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile-posts"] });
    } catch (error) {
      if (uploadedPath) {
        void supabase.storage.from(uploadedBucket).remove([uploadedPath]);
      }
      toast.error(errorMessage(error, "No se pudo publicar. Inténtalo de nuevo."));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setUploading(false);
    }
  };

  const postsRaw = feed.data?.posts;
  const posts = Array.isArray(postsRaw) ? postsRaw : [];
  const likedIds = feed.data?.liked instanceof Set ? feed.data.liked : new Set<string>();
  const dislikedIds = feed.data?.disliked instanceof Set ? feed.data.disliked : new Set<string>();
  const savedIds = feed.data?.saved instanceof Set ? feed.data.saved : new Set<string>();
  const showTabs = showScopeTabs && !videoOnly && !onlyUserId && !savedOnly;

  return (
    <div className="space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-0">
      {!hideUpload && galleryOnly && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <p className="text-sm text-zinc-300">Agrega una foto a tu galería</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handlePick(event.target.files?.[0] ?? null)} />
          <Button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || !viewerId} className="gap-2 rounded-xl"><Plus className="size-4" /> Agregar foto</Button>
        </div>
      )}
      {!hideUpload && !galleryOnly && (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Play className="h-4 w-4 text-pink-300" /> {videoOnly ? "Publica un video permanente" : "Publica en tu muro"}
            </p>
            <p className="text-xs text-muted-foreground">
              {videoOnly
                ? "Videos MP4/WEBM/MOV de hasta 50 MB y 30 segundos. La publicación permanece en tu perfil."
                : "Fotos comprimidas y videos MP4/WEBM/MOV de hasta 50 MB. Se publican al instante."}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Título opcional" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" />
            <MentionInput value={caption} onChange={setCaption} placeholder={videoOnly ? "Describe tu video…" : "Escribe una publicación o describe tu foto o video… Usa @ para mencionar y # para etiquetar."} className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
            {!draft && <EmojiOverlayPicker value={emojiOverlay} onChange={setEmojiOverlay} disabled={uploading} />}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={videoOnly ? "video/*,.mp4,.mov,.webm,.mkv,.3gp,.m4v" : "image/*,video/*,.mp4,.mov,.webm,.mkv,.3gp,.m4v"}
            className="hidden"
            onChange={(event) => void handlePick(event.target.files?.[0] ?? null)}
          />
          <MediaComposer
            cameraOnly
            disabled={uploading}
            onFilterChange={setMediaFilter}
            onFile={(file, filter) => setDraft({ file, filter })}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} variant="outline" className="gap-2">
            <Upload className="h-4 w-4" />
            {videoOnly ? "Elegir video" : "Elegir foto o video"}
          </Button>
          <Button onClick={() => void handleTextPost()} disabled={uploading || !viewerId || (!caption.trim() && !emojiOverlay.length)} variant="secondary">
            {uploading ? "Publicando…" : "Publicar"}
          </Button>
        </div>
      )}

      {!hideUpload && !draft && (caption.trim() || emojiOverlay.length > 0) && (
        <div className="relative min-h-36 overflow-hidden rounded-2xl bg-gradient-to-br from-pink-700 via-fuchsia-800 to-slate-950 p-5 text-white" style={{ filter: mediaFilterCss(mediaFilter) }}>
          <p className="relative z-[1] whitespace-pre-wrap break-words">{title.trim() && <span className="mb-2 block text-lg font-semibold">{title}</span>}{caption || "Tu publicación con emojis"}</p>
          <GlowingEmojiOverlay emojis={emojiOverlay} />
        </div>
      )}

      {draft && previewUrl && !hideUpload && (
        <div className="rounded-2xl border border-pink-400/25 bg-pink-500/[0.06] p-4">
          <p className="mb-3 text-sm font-semibold text-white">Vista previa</p>
          <div className="relative overflow-hidden rounded-xl bg-black">
          {isVideoFile(draft.file) ? (
            <video src={previewUrl} controls playsInline webkit-playsinline="true" className="mx-auto aspect-[9/16] max-h-[70dvh] w-full max-w-sm rounded-xl bg-black object-cover" style={{ filter: mediaFilterCss(draft.filter) }} />
          ) : (
            <img src={previewUrl} alt="Vista previa de la publicación" className="max-h-80 w-full rounded-xl bg-black object-contain" style={{ filter: mediaFilterCss(draft.filter) }} />
          )}
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={uploading}>
              Quitar
            </Button>
            <Button type="button" onClick={() => void handleUpload(draft.file, draft.filter)} disabled={uploading} className="gap-2">
              <Upload className="size-4" /> {uploading ? "Publicando…" : "Publicar"}
            </Button>
          </div>
        </div>
      )}

      {!composerOnly && <>
      {showTabs && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar publicaciones">
          <button
            type="button"
            role="tab"
            aria-selected={!followingOnly}
            onClick={() => { setFollowingOnly(false); setFeedLimit(24); }}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${!followingOnly ? "border-pink-400/40 bg-pink-500/15 text-pink-100" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white"}`}
          >
            <Globe2 className="size-4" /> Para ti
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={followingOnly}
            onClick={() => { setFollowingOnly(true); setFeedLimit(24); }}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${followingOnly ? "border-pink-400/40 bg-pink-500/15 text-pink-100" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white"}`}
          >
            <Users className="size-4" /> Siguiendo
          </button>
        </div>
      )}

      {!videoOnly && !onlyUserId && !savedOnly && Boolean(trending.data?.length) && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Hashtags populares">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Hash className="size-3.5" /> Tendencia</span>
          {trending.data?.map(([tag, count]) => (
            <button key={tag} type="button" onClick={() => setSelectedHashtag((current) => current === tag ? "" : tag)} className={`rounded-full border px-3 py-1 text-xs transition ${selectedHashtag === tag ? "border-pink-400/50 bg-pink-500/20 text-pink-100" : "border-white/10 bg-white/[0.04] text-muted-foreground hover:text-white"}`}>
              {tag} <span className="opacity-60">{count}</span>
            </button>
          ))}
        </div>
      )}

      {feed.isLoading || loadingPosts ? (
        <p className="text-sm text-muted-foreground">Cargando publicaciones reales…</p>
      ) : posts.length ? (
        <div translate="no" className={galleryOnly ? "grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3" : "grid gap-5 sm:grid-cols-2 lg:grid-cols-3"}>
          {posts.map((post) => (
            galleryOnly ? (
              <a key={post.id} href={post.media_url} target="_blank" rel="noreferrer" aria-label={post.caption || `Foto de ${post.display_name}`} className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black">
                <img src={post.media_url} alt={post.caption || "Foto de la galería"} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-105" />
                {post.caption && <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-5 text-[10px] text-white">{post.caption}</span>}
              </a>
            ) : <MediaCard
              key={post.id}
              media={post}
              liked={likedIds.has(post.id) ?? false}
              disliked={dislikedIds.has(post.id) ?? false}
              saved={savedIds.has(post.id)}
              onLike={() => void handleLike(post.id, likedIds.has(post.id) ?? false)}
              onDislike={() => void handleDislike(post.id, dislikedIds.has(post.id) ?? false)}
              onSave={() => void handleSave(post.id, savedIds.has(post.id))}
              onShare={() => void handleShare(post.id)}
              onEdit={(nextTitle, nextCaption, filter, emojiOverlay) => void handleEdit(post.id, nextTitle, nextCaption, filter, emojiOverlay)}
              onDelete={() => void handleDelete(post.id)}
              onPin={() => void handlePin(post.id, post.is_pinned)}
              onRepost={() => void handleRepost(post.id)}
              onHashtag={(tag) => setSelectedHashtag(tag.toLowerCase())}
              onOpenVideo={onOpenVideo}
              currentUserId={viewerId}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {followingOnly
              ? viewerId ? "Las personas que sigues todavía no han publicado." : "Inicia sesión para ver publicaciones de las personas que sigues."
              : emptyText ?? "Sé la primera persona en publicar una foto o video ❤️"}
          </p>
        </div>
      )}
      {posts.length >= feedLimit && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={() => setFeedLimit((current) => current + 24)}>
            Cargar más publicaciones
          </Button>
        </div>
      )}
      </>}
    </div>
  );
}
