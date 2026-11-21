import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Download, Heart, Loader2, MessageCircle, Send, Share2, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { RichPostText } from "@/components/cupido/rich-post-text";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { MentionInput } from "@/components/cupido/mention-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { deliverFile, safeFilename } from "@/lib/download";
import {
  addComment,
  fetchComments,
  fetchFeed,
  formatCount,
  notifyUser,
  registerPostView,
  sharePost,
  toggleCommentLike,
  togglePostLike,
  togglePostSave,
  type FeedPost,
  type PostComment,
} from "@/lib/posts";

type TikTokFeedProps = { initialPostId?: string | undefined };

type SharePerson = { id: string; display_name: string };

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message || fallback;
  return fallback;
}

function ActionButton({
  label,
  count,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  count?: number | string | undefined;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] transition active:scale-90 disabled:opacity-50"
    >
      <span className={`flex size-12 items-center justify-center rounded-full border border-white/20 bg-black/45 backdrop-blur ${active ? "text-pink-300" : "text-white"}`}>
        {children}
      </span>
      {count !== undefined && <span className="text-[11px] font-semibold tabular-nums">{typeof count === "number" ? formatCount(count) : count}</span>}
    </button>
  );
}

export function TikTokFeed({ initialPostId }: TikTokFeedProps) {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const watchRef = useRef<{ postId: string; last: number }>({ postId: "", last: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [muted, setMuted] = useState(true);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sharePostId, setSharePostId] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [likedLocal, setLikedLocal] = useState<Record<string, boolean>>({});
  const [savedLocal, setSavedLocal] = useState<Record<string, boolean>>({});

  const feed = useQuery({
    queryKey: ["cupido-tiktok-feed", viewerId, followingOnly],
    queryFn: () => fetchFeed({ viewerId, videoOnly: true, limit: 80, followingOnly }),
    staleTime: 0,
  });
  const posts = feed.data?.posts ?? [];
  const currentIndex = posts.length ? Math.min(activeIndex, posts.length - 1) : 0;
  const currentPost = posts[currentIndex] ?? null;
  const likedIds = feed.data?.liked ?? new Set<string>();
  const savedIds = feed.data?.saved ?? new Set<string>();

  const following = useQuery({
    queryKey: ["cupido-tiktok-follows", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase.from("follows").select("following_id").eq("follower_id", viewerId!);
      if (error) throw error;
      return new Set((data ?? []).map((row) => String(row.following_id)));
    },
  });

  const comments = useQuery({
    queryKey: ["cupido-post-comments", commentsPostId],
    enabled: Boolean(commentsPostId),
    queryFn: () => fetchComments(commentsPostId!),
  });

  const sharePeople = useQuery({
    queryKey: ["cupido-tiktok-share-people", viewerId],
    enabled: Boolean(viewerId && sharePostId),
    queryFn: async (): Promise<SharePerson[]> => {
      const [follows, friends] = await Promise.all([
        supabase.from("follows").select("follower_id,following_id").or(`follower_id.eq.${viewerId},following_id.eq.${viewerId}`),
        supabase.from("friend_requests").select("requester_id,addressee_id").eq("status", "accepted").or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`),
      ]);
      if (follows.error) throw follows.error;
      if (friends.error) throw friends.error;
      const ids = new Set<string>();
      for (const row of follows.data ?? []) ids.add(row.follower_id === viewerId ? row.following_id : row.follower_id);
      for (const row of friends.data ?? []) ids.add(row.requester_id === viewerId ? row.addressee_id : row.requester_id);
      ids.delete(viewerId ?? "");
      if (!ids.size) return [];
      const { data, error } = await supabase.from("cupido_public_profiles").select("id,display_name").in("id", [...ids]).order("display_name").limit(80);
      if (error) throw error;
      return (data ?? []).map((row) => ({ id: String(row.id), display_name: String(row.display_name ?? "Miembro") }));
    },
  });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const channelName = `cupido-tiktok-live-${viewerId ?? "guest"}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_posts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_likes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_saved_posts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "follows", filter: `follower_id=eq.${viewerId ?? "00000000-0000-0000-0000-000000000000"}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-follows", viewerId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, viewerId]);

  useEffect(() => {
    if (!commentsPostId) return;
    const channel = supabase
      .channel(`cupido-tiktok-comments-${commentsPostId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_post_comments", filter: `post_id=eq.${commentsPostId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-post-comments", commentsPostId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_comment_likes" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-post-comments", commentsPostId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [commentsPostId, queryClient]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !posts.length) return;
    const slides = Array.from(root.querySelectorAll<HTMLElement>("[data-video-slide]"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const index = Number((entry.target as HTMLElement).dataset["videoSlide"] ?? 0);
            setActiveIndex(index);
          }
        }
      },
      { root, threshold: [0.6, 0.9] },
    );
    slides.forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [posts.length]);

  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index !== currentIndex) {
        video.pause();
        return;
      }
      video.muted = muted;
      void video.play().catch(() => {
        setMuted(true);
      });
    });
    if (currentPost) void registerPostView(currentPost.id).catch(() => undefined);
  }, [currentIndex, currentPost?.id, muted]);

  useEffect(() => {
    if (!initialPostId || !feed.data) return;
    const index = feed.data.posts.findIndex((post) => post.id === initialPostId);
    if (index < 0) return;
    setActiveIndex(index);
    const root = containerRef.current;
    if (root) root.scrollTo({ top: index * root.clientHeight, behavior: "auto" });
  }, [feed.data, initialPostId]);

  const reportWatch = (postId: string, time: number) => {
    const previous = watchRef.current;
    if (previous.postId !== postId) {
      watchRef.current = { postId, last: time };
      return;
    }
    const seconds = Math.floor(time - previous.last);
    if (seconds >= 5) {
      watchRef.current = { postId, last: time };
      void supabase.rpc("cupido_record_video_watch", { _post: postId, _seconds: Math.min(seconds, 30) });
    }
  };

  const likeMutation = useMutation({
    mutationFn: async (post: FeedPost) => togglePostLike(post.id, likedIds.has(post.id)),
    onMutate: (post) => {
      setLikedLocal((current) => ({ ...current, [post.id]: !likedIds.has(post.id) }));
    },
    onSuccess: async (next, post) => {
      toast.success(next ? "❤️ Te gusta" : "Te gusta eliminado");
      await queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] });
      setLikedLocal((current) => {
        const updated = { ...current };
        delete updated[post.id];
        return updated;
      });
    },
    onError: (error, post) => {
      toast.error(errorMessage(error, "No se pudo actualizar el me gusta."));
      setLikedLocal((current) => {
        const updated = { ...current };
        delete updated[post.id];
        return updated;
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (post: FeedPost) => togglePostSave(post.id, savedIds.has(post.id)),
    onMutate: (post) => {
      setSavedLocal((current) => ({ ...current, [post.id]: !savedIds.has(post.id) }));
    },
    onSuccess: async (next, post) => {
      toast.success(next ? "Guardado en Guardados 🔖" : "Quitado de Guardados");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] }),
        queryClient.invalidateQueries({ queryKey: ["cupido-media"] }),
        queryClient.invalidateQueries({ queryKey: ["cupido-saved-posts"] }),
      ]);
      setSavedLocal((current) => {
        const updated = { ...current };
        delete updated[post.id];
        return updated;
      });
    },
    onError: (error, post) => {
      toast.error(errorMessage(error, "No se pudo guardar el video."));
      setSavedLocal((current) => {
        const updated = { ...current };
        delete updated[post.id];
        return updated;
      });
    },
  });

  const followMutation = useMutation({
    mutationFn: async ({ userId, isFollowing }: { userId: string; isFollowing: boolean }) => {
      if (!viewerId) throw new Error("Inicia sesión para seguir creadores.");
      const { error } = isFollowing
        ? await supabase.from("follows").delete().eq("follower_id", viewerId).eq("following_id", userId)
        : await supabase.from("follows").insert({ follower_id: viewerId, following_id: userId });
      if (error) throw error;
      return !isFollowing;
    },
    onSuccess: async (nowFollowing) => {
      toast.success(nowFollowing ? "Ahora sigues a este creador ❤️" : "Dejaste de seguir a este creador.");
      await queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-follows", viewerId] });
      await queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] });
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo actualizar el seguidor.")),
  });

  const submitComment = async (parentCommentId: string | null = null) => {
    const value = parentCommentId ? replyText : commentText;
    if (!value.trim() || !commentsPostId) return;
    setSending(true);
    try {
      await addComment(commentsPostId, value, parentCommentId);
      if (parentCommentId) {
        setReplyText("");
        setReplyTarget(null);
      } else {
        setCommentText("");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cupido-post-comments", commentsPostId] }),
        queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] }),
      ]);
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo publicar el comentario."));
    } finally {
      setSending(false);
    }
  };

  const renderComment = (comment: PostComment, depth = 0): ReactNode => (
    <div key={comment.id} className="space-y-2">
      <div className="flex gap-2" style={{ marginLeft: `${Math.min(depth, 4) * 14}px` }}>
        <img src={comment.avatar_url || "/favicon.ico"} alt="" className="size-7 shrink-0 rounded-full border border-white/15 object-cover" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs text-white">
            <span className="mr-1 font-semibold">{comment.display_name}</span>
            <span className="text-white/75"><RichPostText text={comment.body} /></span>
          </p>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-white/55">
            <button
              type="button"
              onClick={() => void toggleCommentLike(comment.id).then(() => queryClient.invalidateQueries({ queryKey: ["cupido-post-comments", commentsPostId] })).catch(() => undefined)}
              className={comment.liked ? "text-rose-300" : "hover:text-white"}
            >
              <Heart className={`mr-1 inline size-3 ${comment.liked ? "fill-current" : ""}`} /> {comment.likes_count}
            </button>
            <button type="button" onClick={() => { setReplyTarget(replyTarget === comment.id ? null : comment.id); setReplyText(""); }} className="hover:text-white">Responder</button>
          </div>
          {replyTarget === comment.id && (
            <div className="mt-2 flex gap-2">
              <MentionInput value={replyText} onChange={setReplyText} maxLength={500} rows={1} placeholder="Escribe tu respuesta…" className="min-h-8 w-full resize-y rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs" />
              <Button size="sm" className="h-8" disabled={sending || !replyText.trim()} onClick={() => void submitComment(comment.id)}><Send className="size-3" /></Button>
            </div>
          )}
        </div>
      </div>
      {(comments.data ?? []).filter((reply) => reply.parent_comment_id === comment.id).map((reply) => renderComment(reply, depth + 1))}
    </div>
  );

  const sendShare = async (person: SharePerson) => {
    if (!viewerId || !sharePostId) return;
    setSending(true);
    try {
      const conversation = await supabase.rpc("cupido_open_conversation", { _other: person.id });
      if (conversation.error || !conversation.data) throw conversation.error ?? new Error("No se pudo abrir la conversación.");
      const post = posts.find((item) => item.id === sharePostId);
      const url = `${window.location.origin}/muro?post=${encodeURIComponent(sharePostId)}`;
      const body = `${shareMessage.trim() ? `${shareMessage.trim()}\n\n` : ""}Video de ${post?.display_name ?? "Cupido Leudy"}: ${url}`;
      const { error } = await supabase.from("cupido_messages").insert({ conversation_id: conversation.data, sender_id: viewerId, body });
      if (error) throw error;
      void notifyUser({ userId: person.id, title: "Te compartieron un video", body: `${post?.display_name ?? "Alguien"} te envió un video.`, kind: "message", actorId: viewerId, targetId: conversation.data });
      setSharePostId(null);
      setShareMessage("");
      toast.success(`Enviado a ${person.display_name}.`);
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo compartir el video."));
    } finally {
      setSending(false);
    }
  };

  const downloadVideo = async (post: FeedPost) => {
    try {
      const response = await fetch(post.media_url);
      if (!response.ok) throw new Error("No se pudo descargar el archivo.");
      const blob = await response.blob();
      const extension = /\.(mp4|webm|mov|m4v)(?:\?|$)/i.exec(post.media_url)?.[1]?.toLowerCase() ?? "mp4";
      await deliverFile(blob, safeFilename(post.title || post.caption || "video-cupido", extension));
      toast.success("Video descargado ⬇️");
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo descargar. Se abrirá el video."));
      window.open(post.media_url, "_blank", "noopener,noreferrer");
    }
  };

  const shareTarget = posts.find((post) => post.id === sharePostId) ?? null;

  return (
    <main className="fixed inset-0 z-50 h-[100dvh] overflow-hidden bg-black text-white">
      <div ref={containerRef} className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {posts.map((post, index) => {
          const isLiked = likedLocal[post.id] ?? likedIds.has(post.id);
          const isSaved = savedLocal[post.id] ?? savedIds.has(post.id);
          const isFollowingAuthor = following.data?.has(post.user_id) ?? false;
          const likeCount = Math.max(0, Number(post.likes_count) || 0) + (isLiked === likedIds.has(post.id) ? 0 : isLiked ? 1 : -1);
          return (
            <section key={post.id} data-video-slide={index} className="relative flex h-[100dvh] w-full snap-start items-center justify-center overflow-hidden">
              <video
                ref={(element) => { videoRefs.current[index] = element; }}
                src={post.media_url}
                loop
                playsInline
                muted={muted}
                preload={index <= currentIndex + 1 ? "auto" : "metadata"}
                onClick={() => setMuted((value) => !value)}
                onTimeUpdate={(event) => reportWatch(post.id, event.currentTarget.currentTime)}
                className="absolute inset-0 h-full w-full bg-black object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/85" />

              <div className="absolute bottom-24 right-2 z-20 flex flex-col items-center gap-4 sm:right-5">
                <div className="relative mb-1">
                  <Link to="/perfil" search={{ userId: post.user_id }} aria-label={`Perfil de ${post.display_name}`} className="block size-12 overflow-hidden rounded-full border-2 border-white shadow-lg">
                    <img src={post.avatar_url || "/favicon.ico"} alt={post.display_name} className="size-full object-cover" />
                  </Link>
                  {post.user_id !== viewerId && (
                    <button
                      type="button"
                      aria-label={isFollowingAuthor ? "Dejar de seguir" : "Seguir creador"}
                      onClick={() => followMutation.mutate({ userId: post.user_id, isFollowing: isFollowingAuthor })}
                      disabled={followMutation.isPending}
                      className={`absolute -bottom-2 left-1/2 flex size-6 -translate-x-1/2 items-center justify-center rounded-full text-sm font-bold shadow-lg ${isFollowingAuthor ? "bg-white text-pink-600" : "bg-pink-500 text-white"}`}
                    >
                      {isFollowingAuthor ? "✓" : "+"}
                    </button>
                  )}
                </div>
                <ActionButton label="Me gusta" count={likeCount} active={isLiked} onClick={() => {
                  if (!viewerId) { toast.error("Inicia sesión para dar me gusta."); return; }
                  likeMutation.mutate(post);
                }}>
                  <Heart className={`size-6 ${isLiked ? "fill-pink-500 text-pink-500" : ""}`} />
                </ActionButton>
                <ActionButton label="Comentarios" count={post.comments_count} onClick={() => setCommentsPostId(post.id)}>
                  <MessageCircle className="size-6 fill-white/10" />
                </ActionButton>
                <ActionButton label="Guardar" count={isSaved ? "Guardado" : "Guardar"} active={isSaved} onClick={() => {
                  if (!viewerId) { toast.error("Inicia sesión para guardar videos."); return; }
                  saveMutation.mutate(post);
                }}>
                  <Bookmark className={`size-6 ${isSaved ? "fill-amber-300 text-amber-300" : ""}`} />
                </ActionButton>
                <ActionButton label="Compartir" count={post.shares_count} onClick={() => setSharePostId(post.id)}>
                  <Share2 className="size-6" />
                </ActionButton>
                <ActionButton label="Descargar" onClick={() => void downloadVideo(post)}>
                  <Download className="size-6" />
                </ActionButton>
              </div>

              <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pr-20 sm:pr-24">
                <div className="flex items-center gap-2">
                  <Link to="/perfil" search={{ userId: post.user_id }} className="text-sm font-bold text-white drop-shadow hover:underline">
                    {post.display_name}
                  </Link>
                  <VerifiedBadge email={post.email} official={post.is_super_admin} verified={post.is_verified_blue} className="size-5" />
                </div>
                {post.title && <p className="mt-2 text-sm font-semibold text-white drop-shadow">{post.title}</p>}
                {post.caption && (
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-snug text-white/95 drop-shadow">
                    <RichPostText text={post.caption} onHashtag={(tag) => void navigate({ to: "/muro", search: { post: undefined, q: tag } })} />
                  </p>
                )}
                <p className="mt-2 text-[11px] text-white/60">{new Date(post.created_at).toLocaleDateString("es")}</p>
              </div>
            </section>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <button type="button" onClick={() => void navigate({ to: "/muro", search: { post: undefined, q: undefined } })} aria-label="Cerrar videos" className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-black/45 backdrop-blur">
          <X className="size-5" />
        </button>
        <div className="pointer-events-auto flex gap-2 rounded-full bg-black/45 p-1 backdrop-blur">
          <button
            type="button"
            onClick={() => { setFollowingOnly(false); setActiveIndex(0); containerRef.current?.scrollTo({ top: 0 }); }}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${!followingOnly ? "bg-white text-black" : "text-white/80"}`}
          >
            Para ti
          </button>
          <button
            type="button"
            onClick={() => { setFollowingOnly(true); setActiveIndex(0); containerRef.current?.scrollTo({ top: 0 }); }}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${followingOnly ? "bg-white text-black" : "text-white/80"}`}
          >
            Siguiendo
          </button>
        </div>
        <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Activar sonido" : "Silenciar"} className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-black/45 backdrop-blur">
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
      </div>

      {feed.isLoading && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-white/80" />
        </div>
      )}
      {!feed.isLoading && !posts.length && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-sm text-white/80">Todavía no hay videos para mostrar.</p>
          <Button onClick={() => void navigate({ to: "/muro", search: { post: undefined, q: undefined } })}>Volver al muro</Button>
        </div>
      )}

      {commentsPostId && (
        <div className="absolute inset-0 z-40 flex items-end" role="dialog" aria-label="Comentarios del video">
          <button type="button" aria-label="Cerrar comentarios" className="absolute inset-0 bg-black/60" onClick={() => { setCommentsPostId(null); setReplyTarget(null); }} />
          <div className="relative flex h-[75dvh] w-full flex-col rounded-t-3xl border-t border-white/15 bg-zinc-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/25" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg text-white">Comentarios</h2>
              <button type="button" onClick={() => { setCommentsPostId(null); setReplyTarget(null); }} aria-label="Cerrar" className="flex size-8 items-center justify-center rounded-full bg-white/10"><X className="size-4" /></button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto">
              {comments.isLoading && <p className="text-xs text-white/60">Cargando comentarios…</p>}
              {!comments.isLoading && !comments.data?.length && <p className="text-xs text-white/60">Sé la primera persona en comentar.</p>}
              {comments.data?.filter((comment) => !comment.parent_comment_id).map((comment) => renderComment(comment))}
            </div>
            <div className="mt-3 flex gap-2">
              <MentionInput
                value={commentText}
                onChange={setCommentText}
                rows={1}
                placeholder="Comenta o menciona con @…"
                className="min-h-9 w-full resize-y rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm"
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitComment(); } }}
              />
              <Button size="sm" disabled={sending || !commentText.trim()} onClick={() => void submitComment()}><Send className="size-4" /></Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={Boolean(sharePostId)} onOpenChange={(open) => { if (!open) { setSharePostId(null); setShareMessage(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Compartir video</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dentro de Cupido Leudy</p>
              <input value={shareMessage} onChange={(event) => setShareMessage(event.target.value)} maxLength={500} placeholder="Añade un mensaje opcional" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {sharePeople.isLoading && <p className="py-3 text-center text-xs text-muted-foreground">Cargando amigos y seguidores…</p>}
                {sharePeople.data?.map((person) => (
                  <button key={person.id} type="button" disabled={sending} onClick={() => void sendShare(person)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10">
                    {person.display_name}
                  </button>
                ))}
                {!sharePeople.isLoading && !sharePeople.data?.length && <p className="py-2 text-xs text-muted-foreground">No encontramos amigos o seguidores para enviarles el video.</p>}
              </div>
            </section>
            <section className="border-t border-white/10 pt-3">
              <Button variant="outline" className="w-full" onClick={() => {
                if (shareTarget) void sharePost(shareTarget).then(() => setSharePostId(null)).catch((error: unknown) => {
                  if (error instanceof DOMException && error.name === "AbortError") return;
                  toast.error("No se pudo compartir el enlace.");
                });
              }}>
                <Share2 className="mr-2 size-4" /> Compartir o copiar enlace
              </Button>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
