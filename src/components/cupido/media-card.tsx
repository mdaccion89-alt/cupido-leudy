import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Heart, Image as ImageIcon, MessageCircle, Play, Send, Share2, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  addComment,
  displayedMetrics,
  fetchComments,
  formatCount,
  registerPostView,
  type FeedPost,
} from "@/lib/posts";

export type CupidoMedia = FeedPost;

function safeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

type MediaCardProps = {
  media: FeedPost;
  liked: boolean;
  disliked: boolean;
  saved: boolean;
  onLike: () => void;
  onDislike: () => void;
  onSave: () => void;
  onShare: () => void;
};

export function MediaCard({ media, liked, disliked, saved, onLike, onDislike, onSave, onShare }: MediaCardProps) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const metrics = displayedMetrics(media, now);
  const postId = safeText(media?.id);
  const mediaUrl = safeText(media?.media_url);
  const caption = safeText(media?.caption);
  const authorName = safeText(media?.display_name, "Miembro de Cupido");
  const authorEmail = safeText(media?.email) || undefined;

  useEffect(() => {
    if (postId) void registerPostView(postId).catch(() => undefined);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [postId]);

  const comments = useQuery({
    queryKey: ["cupido-post-comments", postId],
    enabled: commentsOpen && Boolean(postId),
    queryFn: () => fetchComments(postId),
  });

  useEffect(() => {
    if (!commentsOpen) return;
    const channel = supabase
      .channel(`cupido-comments-${postId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cupido_post_comments", filter: `post_id=eq.${postId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["cupido-post-comments", postId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [commentsOpen, postId, queryClient]);

  const submitComment = async () => {
    if (!commentText.trim()) return;
    setSending(true);
    try {
      if (!postId) return;
      await addComment(postId, commentText);
      setCommentText("");
      await queryClient.invalidateQueries({ queryKey: ["cupido-post-comments", postId] });
      await queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      await queryClient.invalidateQueries({ queryKey: ["cupido-historia"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo publicar el comentario.");
    } finally {
      setSending(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
      <div className="relative aspect-[9/14] max-h-[520px] w-full bg-black">
        {media?.kind === "video" ? (
          <video src={mediaUrl} controls playsInline loop muted className="h-full w-full object-cover" />
        ) : (
          <img src={mediaUrl} alt={caption || "Foto de Cupido Leudy"} className="h-full w-full object-cover" />
        )}
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          {media?.kind === "video" ? <Play className="mr-1 inline h-3 w-3 fill-white" /> : <ImageIcon className="mr-1 inline h-3 w-3" />}
          {media?.kind === "video" ? "Short" : "Foto"}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 border border-pink-400/40">
            <AvatarImage src={safeText(media?.avatar_url)} alt={authorName} />
            <AvatarFallback className="bg-pink-500/20 text-xs text-pink-200">
              {authorName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {authorName}
              <VerifiedBadge email={authorEmail} verified={Boolean(media?.is_verified_blue)} className="ml-1 inline size-4" />
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{caption || "Momento en Cupido Leudy ❤️"}</p>
          </div>
          <div className="shrink-0 text-right text-xs text-pink-200">
            <p className="font-semibold">{metrics.likes} ❤️</p>
            <p className="text-muted-foreground">{metrics.views} 👁️</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button
            variant={liked ? "default" : "outline"}
            size="sm"
            onClick={onLike}
            className="gap-1"
            aria-label="Me gusta"
          >
            <Heart className={`size-3.5 ${liked ? "fill-white" : ""}`} /> ❤️ {liked ? "Te gusta" : "Me gusta"}
          </Button>
          <Button
            variant={disliked ? "destructive" : "outline"}
            size="sm"
            onClick={onDislike}
            className="gap-1"
            aria-label="No me gusta"
          >
            <ThumbsDown className="size-3.5" /> 👎 {Math.max(0, Number(media.dislikes_count) || 0)}
          </Button>
          <Button
            variant={saved ? "default" : "outline"}
            size="sm"
            onClick={onSave}
            className="gap-1"
            aria-label="Guardar en favoritos"
          >
            <Bookmark className={`size-3.5 ${saved ? "fill-white" : ""}`} /> 🔖 {saved ? "Guardado" : "Guardar"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCommentsOpen((value) => !value)}
            className="gap-1"
            aria-label="Comentarios"
          >
            <MessageCircle className="size-3.5" /> 💬 {Math.max(0, Number(media.comments_count) || 0)}
          </Button>
          <Button variant="outline" size="sm" onClick={onShare} className="col-span-2 gap-1" aria-label="Compartir">
            <Share2 className="size-3.5" /> ↗️ Compartir {formatCount(Number(media.shares_count) || 0)}
          </Button>
        </div>

        {commentsOpen && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs font-medium text-white">Comentarios</p>
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {comments.isLoading && <p className="text-xs text-muted-foreground">Cargando comentarios…</p>}
              {!comments.isLoading && !comments.data?.length && (
                <p className="text-xs text-muted-foreground">Sé la primera persona en comentar.</p>
              )}
              {Array.isArray(comments.data) && comments.data.map((comment) => (
                <div key={comment.id} className="flex gap-2 text-xs">
                  <Avatar className="size-6">
                    <AvatarImage src={safeText(comment?.avatar_url)} alt={safeText(comment?.display_name, "Miembro")} />
                    <AvatarFallback className="bg-pink-500/20 text-[9px] text-pink-100">
                      {safeText(comment?.display_name, "Miembro").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <p className="min-w-0 flex-1 text-white">
                    <span className="mr-1 font-medium">{safeText(comment?.display_name, "Miembro")}</span>
                    <span className="text-muted-foreground">{safeText(comment?.body)}</span>
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitComment();
                }}
                placeholder="Escribe un comentario…"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
              />
              <Button size="sm" onClick={() => void submitComment()} disabled={sending || !commentText.trim()}>
                <Send className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
