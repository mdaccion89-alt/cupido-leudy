import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Upload } from "lucide-react";
import { toast } from "sonner";
import { MediaCard } from "@/components/cupido/media-card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  createPost,
  fetchFeed,
  notifyUser,
  sharePost,
  togglePostDislike,
  togglePostLike,
  togglePostSave,
} from "@/lib/posts";
import { compressImageFile, readVideoDuration, safeExtension } from "@/lib/storage";

const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v"];
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
  onlyUserId?: string | null;
  savedOnly?: boolean;
  hideUpload?: boolean;
  emptyText?: string;
};

export function WallFeed({
  videoOnly = false,
  onlyUserId = null,
  savedOnly = false,
  hideUpload = false,
  emptyText,
}: WallFeedProps) {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);

  const feed = useQuery({
    queryKey: ["cupido-media", viewerId, videoOnly, onlyUserId, savedOnly],
    queryFn: () =>
      fetchFeed({ viewerId, limit: videoOnly ? 30 : 24, videoOnly, onlyUserId, savedOnly }),
  });

  useEffect(() => {
    const channel = supabase
      .channel("cupido-wall-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_posts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-historia"] });
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
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_comments" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const requireSession = () => {
    if (viewerId) return true;
    toast.error("Inicia sesión para interactuar en Cupido Leudy ❤️");
    return false;
  };

  const invalidateFeed = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cupido-media"] }),
      queryClient.invalidateQueries({ queryKey: ["cupido-historia"] }),
    ]);
  };

  const handleLike = async (postId: string, ownerId: string, liked: boolean) => {
    if (!requireSession()) return;
    try {
      const next = await togglePostLike(postId, liked);
      if (next && ownerId !== viewerId) {
        void notifyUser({
          userId: ownerId,
          title: "❤️ Te gusta en tu publicación",
          body: "A alguien le gustó tu foto o video.",
          kind: "like",
          actorId: viewerId,
          targetId: postId,
        });
      }
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

  const handleUpload = async (file: File | null) => {
    if (!file || !viewerId) return;
    if (!requireSession()) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (videoOnly && !isVideo) {
      toast.error("En Historia solo se publican videos cortos.");
      return;
    }
    if (!isVideo && !isImage) {
      toast.error("Elige una foto o un video corto.");
      return;
    }
    const extension = safeExtension(file.name, isVideo ? "mp4" : "jpg");
    if (isVideo && !VIDEO_EXTENSIONS.includes(extension)) {
      toast.error("Formato de video no admitido. Usa MP4, WEBM o MOV.");
      return;
    }
    if (!isVideo && !IMAGE_EXTENSIONS.includes(extension)) {
      toast.error("Formato de imagen no admitido.");
      return;
    }
    if (isVideo && file.size > 25 * 1024 * 1024) {
      toast.error("El video debe pesar menos de 25 MB.");
      return;
    }
    if (!isVideo && file.size > 25 * 1024 * 1024) {
      toast.error("La foto debe pesar menos de 25 MB.");
      return;
    }

    setUploading(true);
    let uploadedPath: string | null = null;
    try {
      let uploadFile = file;
      if (isVideo) {
        const duration = await readVideoDuration(file);
        if (duration > 30) throw new Error("Los videos deben durar máximo 30 segundos.");
      } else {
        uploadFile = await compressImageFile(file, 200 * 1024);
      }
      const finalExtension = safeExtension(uploadFile.name, extension);
      const path = `${viewerId}/${Date.now()}.${finalExtension}`;
      const { error: storageError } = await supabase.storage.from("media").upload(path, uploadFile, {
        contentType: uploadFile.type || (isVideo ? "video/mp4" : "image/jpeg"),
        upsert: true,
      });
      if (storageError) throw storageError;
      uploadedPath = path;
      const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);
      const url = publicData?.publicUrl ?? "";
      if (!url) throw new Error("No se pudo obtener la URL pública del archivo.");
      await createPost({ userId: viewerId, caption, url, isVideo });
      setCaption("");
      toast.success(isVideo ? "Video publicado en tu muro ❤️" : "Foto publicada en tu muro ❤️");
      await invalidateFeed();
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile-posts"] });
    } catch (error) {
      if (uploadedPath) {
        void supabase.storage.from("media").remove([uploadedPath]);
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

  return (
    <div className="space-y-5">
      {!hideUpload && (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Play className="h-4 w-4 text-pink-300" /> {videoOnly ? "Publica un video en Historia" : "Publica en tu muro"}
            </p>
            <p className="text-xs text-muted-foreground">
              {videoOnly
                ? "Videos MP4/WEBM/MOV de hasta 25 MB y 30 segundos. Se publican al instante."
                : "Fotos comprimidas y videos MP4/WEBM/MOV de hasta 25 MB. Se publican al instante."}
            </p>
          </div>
          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder={videoOnly ? "Describe tu video…" : "Describe tu foto o video…"}
            className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
          />
          <input
            ref={fileRef}
            type="file"
            accept={videoOnly ? "video/mp4,video/webm,video/quicktime" : "image/*,video/mp4,video/webm,video/quicktime"}
            className="hidden"
            onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
            <Upload className="h-4 w-4" />
            {uploading ? "Subiendo…" : videoOnly ? "Subir video" : "Subir foto o video"}
          </Button>
        </div>
      )}

      {feed.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando publicaciones reales…</p>
      ) : posts.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <MediaCard
              key={post.id}
              media={post}
              liked={likedIds.has(post.id) ?? false}
              disliked={dislikedIds.has(post.id) ?? false}
              saved={savedIds.has(post.id)}
              onLike={() => void handleLike(post.id, post.user_id, likedIds.has(post.id) ?? false)}
              onDislike={() => void handleDislike(post.id, dislikedIds.has(post.id) ?? false)}
              onSave={() => void handleSave(post.id, savedIds.has(post.id))}
              onShare={() => void handleShare(post.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {emptyText ?? "Sé la primera persona en publicar una foto o video ❤️"}
          </p>
        </div>
      )}
    </div>
  );
}
