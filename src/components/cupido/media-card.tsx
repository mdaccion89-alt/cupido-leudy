import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Flag, Heart, Image as ImageIcon, Megaphone, MessageCircle, Pin, Play, Send, Share2, ThumbsDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GranLigaStar, VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CupidoVideoPlayer } from "@/components/cupido/video-player";
import { MentionInput } from "@/components/cupido/mention-input";
import { RichPostText } from "@/components/cupido/rich-post-text";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { isSupremePost, notifyUser } from "@/lib/posts";
import {
  addComment,
  displayedMetrics,
  fetchComments,
  formatCount,
  registerPostView,
  reportComment,
  toggleCommentLike,
  type FeedPost,
  type PostComment,
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
  onEdit: (title: string, caption: string) => void;
  onDelete: () => void;
  onPin: () => void;
  onRepost: () => void;
  onHashtag: (tag: string) => void;
  onOpenVideo?: ((postId: string) => void) | undefined;
  currentUserId: string | null;
};

export function MediaCard({ media, liked, disliked, saved, onLike, onDislike, onSave, onShare, onEdit, onDelete, onPin, onRepost, onHashtag, onOpenVideo, currentUserId }: MediaCardProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const visibilityRef = useRef<HTMLElement>(null);
  const watchPositionRef = useRef(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(media.title);
  const [editCaption, setEditCaption] = useState(media.caption);
  const [shareMessage, setShareMessage] = useState("");
  const adminStatus = useQuery({
    queryKey: ["cupido-social-admin", currentUserId],
    enabled: Boolean(currentUserId),
    queryFn: async () => {
      const { data, error } = await supabase.from("creator_profiles").select("is_super_admin,is_gran_liga").eq("id", currentUserId!).maybeSingle();
      if (error) throw error;
      return { isSuperAdmin: Boolean(data?.is_super_admin), isGranLiga: Boolean(data?.is_gran_liga) };
    },
  });
  const metrics = displayedMetrics(media);
  const postId = safeText(media?.id);
  const mediaUrl = safeText(media?.media_url);
  const caption = safeText(media?.caption);
  const authorName = safeText(media?.display_name, "Miembro de Cupido");
  const authorEmail = safeText(media?.email) || undefined;
  const canManage = media.user_id === currentUserId || isSupremePost(session?.user.email, adminStatus.data?.isSuperAdmin);
  const canPromote = media.user_id === currentUserId && Boolean(adminStatus.data?.isGranLiga) && !media.is_promoted;

  const promotePost = async () => {
    const { error } = await supabase.rpc("cupido_promote_post", { _post: postId });
    if (error) { toast.error(error.message); return; }
    toast.success("Publicación promocionada por 500 monedas.");
    void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-tiktok-feed"] });
  };

  const sharePeople = useQuery({
    queryKey: ["cupido-share-people", currentUserId],
    enabled: shareOpen && Boolean(currentUserId),
    queryFn: async () => {
      const [follows, friends] = await Promise.all([
        supabase.from("follows").select("follower_id,following_id").or(`follower_id.eq.${currentUserId},following_id.eq.${currentUserId}`),
        supabase.from("friend_requests").select("requester_id,addressee_id").eq("status", "accepted").or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`),
      ]);
      if (follows.error) throw follows.error;
      if (friends.error) throw friends.error;
      const ids = new Set<string>();
      for (const row of follows.data ?? []) ids.add(row.follower_id === currentUserId ? row.following_id : row.follower_id);
      for (const row of friends.data ?? []) ids.add(row.requester_id === currentUserId ? row.addressee_id : row.requester_id);
      ids.delete(currentUserId ?? "");
      if (!ids.size) return [] as Array<{ id: string; display_name: string; avatar_url: string }>;
      const { data, error } = await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url").in("id", [...ids]).order("display_name").limit(80);
      if (error) throw error;
      return data ?? [];
    },
  });

  const sendInMessage = async (recipient: { id: string; display_name: string }) => {
    if (!currentUserId) { toast.error("Inicia sesión para compartir por mensaje."); return; }
    setSending(true);
    try {
      const conversation = await supabase.rpc("cupido_open_conversation", { _other: recipient.id });
      if (conversation.error || !conversation.data) throw conversation.error ?? new Error("No se pudo abrir la conversación.");
      const url = `${window.location.origin}/muro?post=${encodeURIComponent(postId)}`;
      const body = `${shareMessage.trim() ? `${shareMessage.trim()}\n\n` : ""}Publicación de ${authorName}: ${url}`;
      const { error } = await supabase.from("cupido_messages").insert({ conversation_id: conversation.data, sender_id: currentUserId, body });
      if (error) throw error;
      void notifyUser({ userId: recipient.id, title: "Te compartieron una publicación", body: `${authorName} te envió una publicación.`, kind: "message", actorId: currentUserId, targetId: conversation.data });
      setShareOpen(false);
      setShareMessage("");
      toast.success(`Enviada a ${recipient.display_name}.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo enviar la publicación."); }
    finally { setSending(false); }
  };

  const reportWatchProgress = (currentTime: number) => {
    const seconds = Math.floor(currentTime - watchPositionRef.current);
    if (seconds < 30 || !postId) return;
    const acceptedSeconds = Math.min(seconds, 30);
    watchPositionRef.current = currentTime;
    void supabase.rpc("cupido_record_video_watch", { _post: postId, _seconds: acceptedSeconds });
  };

  useEffect(() => {
    const element = visibilityRef.current;
    if (!postId || !element || typeof IntersectionObserver === "undefined") return;
    let timer: number | null = null;
    let recorded = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (recorded) return;
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (timer === null) {
            timer = window.setTimeout(() => {
              recorded = true;
              observer.disconnect();
              void registerPostView(postId).catch(() => undefined);
            }, 1000);
          }
        } else if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [postId]);

  useEffect(() => {
    if (typeof window === "undefined" || window.location.search !== `?post=${encodeURIComponent(postId)}`) return;
    const timer = window.setTimeout(() => visibilityRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
    return () => window.clearTimeout(timer);
  }, [postId]);

  const comments = useQuery({
    queryKey: ["cupido-post-comments", postId],
    enabled: commentsOpen && Boolean(postId),
    queryFn: () => fetchComments(postId),
  });

  const submitComment = async (parentCommentId: string | null = null) => {
    const value = parentCommentId ? replyText : commentText;
    if (!value.trim()) return;
    setSending(true);
    try {
      if (!postId) return;
      await addComment(postId, value, parentCommentId);
      if (parentCommentId) {
        setReplyText("");
        setReplyTarget(null);
      } else {
        setCommentText("");
      }
      await queryClient.invalidateQueries({ queryKey: ["cupido-post-comments", postId] });
      await queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      await queryClient.invalidateQueries({ queryKey: ["cupido-historia"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo publicar el comentario.");
    } finally {
      setSending(false);
    }
  };

  const renderComment = (comment: PostComment, depth = 0): ReactNode => (
    <div key={comment.id} className="space-y-2">
      <div className="flex gap-2 text-xs" style={{ marginLeft: `${Math.min(depth, 4) * 12}px` }}>
        <div className="relative shrink-0"><GranLigaStar active={comment.is_gran_liga} /><Avatar className="size-6">
          <AvatarImage src={safeText(comment.avatar_url)} alt={safeText(comment.display_name, "Miembro")} />
          <AvatarFallback className="bg-pink-500/20 text-[9px] text-pink-100">{safeText(comment.display_name, "Miembro").slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar></div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-white">
            <span className="mr-1 font-medium">{safeText(comment.display_name, "Miembro")}</span>
            <VerifiedBadge granLiga={comment.is_gran_liga} className="mr-1 inline size-3.5 align-text-bottom" />
            <span className="text-muted-foreground"><RichPostText text={safeText(comment.body)} onHashtag={onHashtag} /></span>
          </p>
          <div className="mt-1 flex items-center gap-3 text-[11px]">
            <button type="button" onClick={() => void toggleCommentLike(comment.id).then(() => queryClient.invalidateQueries({ queryKey: ["cupido-post-comments", postId] })).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudo reaccionar."))} className={comment.liked ? "text-rose-300" : "text-muted-foreground hover:text-rose-300"} aria-label="Me gusta este comentario">
              <Heart className={`mr-1 inline size-3 ${comment.liked ? "fill-current" : ""}`} /> {comment.likes_count}
            </button>
            <button type="button" onClick={() => { setReplyTarget(replyTarget === comment.id ? null : comment.id); setReplyText(""); }} className="text-muted-foreground hover:text-white">Responder</button>
            <button type="button" onClick={() => void reportComment(comment.id).then(() => toast.success("Reporte enviado al Administrador.")).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudo enviar el reporte."))} className="text-muted-foreground hover:text-rose-300" aria-label="Reportar comentario">
              <Flag className="inline size-3" /> Reportar
            </button>
          </div>
          {replyTarget === comment.id && (
            <div className="mt-2 flex gap-2">
              <MentionInput value={replyText} onChange={setReplyText} maxLength={500} rows={1} placeholder="Escribe tu respuesta… usa @ para mencionar" className="min-h-8 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1 text-xs" />
              <Button size="sm" className="h-8" disabled={sending || !replyText.trim()} onClick={() => void submitComment(comment.id)}><Send className="size-3" /></Button>
            </div>
          )}
        </div>
      </div>
      {(comments.data ?? []).filter((reply) => reply.parent_comment_id === comment.id).map((reply) => renderComment(reply, depth + 1))}
    </div>
  );

  return (
    <article id={`post-${postId}`} ref={visibilityRef} className="scroll-mt-24 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
      <div className={`relative w-full bg-black ${media?.kind === "text" ? "min-h-36 bg-gradient-to-br from-pink-950 to-slate-950 p-6" : "aspect-[9/14] max-h-[520px]"}`}>
        {media?.kind === "text" ? (
          <div>
            {media.title && <p className="mb-2 text-xl font-semibold leading-tight text-white">{media.title}</p>}
            <p className="whitespace-pre-wrap break-words text-lg leading-relaxed text-white"><RichPostText text={caption} onHashtag={onHashtag} /></p>
          </div>
        ) : media?.kind === "video" ? (
          <>
            <CupidoVideoPlayer
              src={mediaUrl}
              controls
              loop
              className="h-full w-full object-cover"
              onPlay={(currentTime) => {
                watchPositionRef.current = currentTime;
                void supabase.rpc("cupido_record_video_watch", { _post: postId, _seconds: 0 });
              }}
              onSeeking={(currentTime) => { watchPositionRef.current = currentTime; }}
              onTimeUpdate={reportWatchProgress}
              onPause={(currentTime) => {
                const seconds = Math.floor(currentTime - watchPositionRef.current);
                if (seconds >= 5 && postId) {
                  watchPositionRef.current = currentTime;
                  void supabase.rpc("cupido_record_video_watch", { _post: postId, _seconds: Math.min(seconds, 30) });
                }
              }}
            />
            {onOpenVideo && (
              <button
                type="button"
                aria-label="Abrir video en pantalla completa"
                onClick={() => onOpenVideo(postId)}
                className="absolute inset-0 z-10 flex items-center justify-center bg-black/5 md:hidden"
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
                  <Play className="ml-0.5 size-7 fill-white" />
                </span>
              </button>
            )}
          </>
        ) : (
          <img src={mediaUrl} alt={caption || "Foto de Cupido Leudy"} className="h-full w-full object-cover" />
        )}
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          {media?.kind === "video" ? <Play className="mr-1 inline h-3 w-3 fill-white" /> : media?.kind === "text" ? null : <ImageIcon className="mr-1 inline h-3 w-3" />}
          {media?.kind === "video" ? "Short" : media?.kind === "text" ? "Publicación" : "Foto"}
        </span>
        {media.is_pinned && <span className="absolute right-3 top-3 rounded-full bg-pink-600/90 px-2.5 py-1 text-[11px] font-semibold text-white">📌 Fijada</span>}
        {media.is_promoted && <span className="absolute bottom-3 left-3 rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-semibold text-black">Promocionada</span>}
      </div>
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0"><GranLigaStar active={media.is_gran_liga} /><Avatar className="h-10 w-10 border border-pink-400/40">
            <AvatarImage src={safeText(media?.avatar_url)} alt={authorName} />
            <AvatarFallback className="bg-pink-500/20 text-xs text-pink-200">
              {authorName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar></div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {authorName}
              <VerifiedBadge email={authorEmail} official={media.is_super_admin} verified={Boolean(media?.is_verified_blue)} granLiga={media.is_gran_liga} className="ml-1 inline size-4" />
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{media.kind === "text" ? "Publicación de la comunidad" : caption || "Momento en Cupido Leudy ❤️"}</p>
          </div>
          <div className="shrink-0 text-right text-xs text-pink-200">
            <p className="font-semibold">{metrics.likes} ❤️</p>
            <p className="text-muted-foreground">{metrics.views} 👁️</p>
          </div>
        </div>

        {media.shared_post && (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs text-muted-foreground">Republicación de <Link className="font-medium text-pink-200 hover:underline" to="/perfil" search={{ userId: media.shared_post.user_id }}>{media.shared_post.display_name}</Link></p>
            <Link to="/muro" search={{ post: media.shared_post.id, q: undefined }} className="block rounded-lg bg-white/[0.04] p-2 text-sm hover:bg-white/[0.08]">
              {media.shared_post.title && <span className="mb-1 block font-semibold text-white">{media.shared_post.title}</span>}
              <span className="line-clamp-3 whitespace-pre-wrap text-muted-foreground"><RichPostText text={media.shared_post.caption} onHashtag={onHashtag} /></span>
              {media.shared_post.media_url && (media.shared_post.kind === "video"
                ? <video src={media.shared_post.media_url} controls playsInline className="mt-2 max-h-48 w-full rounded-lg bg-black object-contain" />
                : <img src={media.shared_post.media_url} alt={media.shared_post.title || "Publicación compartida"} className="mt-2 max-h-48 w-full rounded-lg object-cover" />)}
            </Link>
          </div>
        )}
        {media.kind !== "text" && media.title && <h3 className="mt-3 text-base font-semibold text-white">{media.title}</h3>}
        {media.kind !== "text" && caption && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-white"><RichPostText text={caption} onHashtag={onHashtag} /></p>}

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
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)} className="col-span-2 gap-1" aria-label="Compartir">
            <Share2 className="size-3.5" /> ↗️ Compartir {formatCount(Number(media.shares_count) || 0)}
          </Button>
        </div>

        {canManage && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
            <Button variant="outline" size="sm" onClick={() => { setEditTitle(media.title); setEditCaption(media.caption); setEditOpen(true); }}>Editar</Button>
            <Button variant="outline" size="sm" onClick={onPin}><Pin className="mr-1 size-3.5" />{media.is_pinned ? "Desfijar" : "Fijar en perfil"}</Button>
            {canPromote && <Button variant="outline" size="sm" onClick={() => void promotePost()}><Megaphone className="mr-1 size-3.5" />Promocionar · 500</Button>}
            {media.is_promoted && media.user_id === currentUserId && <span className="inline-flex items-center gap-1 text-xs text-amber-200"><Megaphone className="size-3.5" /> Promocionada</span>}
            <Button variant="outline" size="sm" onClick={() => { if (window.confirm("¿Eliminar esta publicación?")) onDelete(); }} className="text-rose-300"><Trash2 className="mr-1 size-3.5" />Eliminar</Button>
          </div>
        )}

        {commentsOpen && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs font-medium text-white">Comentarios</p>
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {comments.isLoading && <p className="text-xs text-muted-foreground">Cargando comentarios…</p>}
              {comments.isError && <p role="alert" className="text-xs text-rose-300">No se pudieron cargar los comentarios. Inténtalo de nuevo.</p>}
              {!comments.isLoading && !comments.data?.length && (
                <p className="text-xs text-muted-foreground">Sé la primera persona en comentar.</p>
              )}
              {Array.isArray(comments.data) && comments.data.filter((comment) => !comment.parent_comment_id).map((comment) => renderComment(comment))}
            </div>
            <div className="mt-3 flex gap-2">
              <MentionInput value={commentText} onChange={setCommentText} rows={1} placeholder="Comenta o menciona a alguien con @…" className="min-h-9 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitComment(); } }} />
              <Button size="sm" onClick={() => void submitComment()} disabled={sending || !commentText.trim()}>
                <Send className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Editar publicación</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={120} placeholder="Título opcional" className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            <MentionInput value={editCaption} onChange={setEditCaption} placeholder="Texto de la publicación" className="min-h-32 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button><Button onClick={() => { onEdit(editTitle, editCaption); setEditOpen(false); }}>Guardar cambios</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Compartir publicación</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dentro de Cupido Leudy</p>
              <Button className="w-full" onClick={() => { onRepost(); setShareOpen(false); }}>Republicar en mi muro</Button>
              <div className="space-y-2">
                <input value={shareMessage} onChange={(event) => setShareMessage(event.target.value)} placeholder="Añade un mensaje opcional" maxLength={500} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
                <p className="text-xs text-muted-foreground">Enviar por mensaje privado</p>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {sharePeople.isLoading && <p className="py-3 text-center text-xs text-muted-foreground">Cargando amigos y seguidores…</p>}
                  {sharePeople.data?.map((person) => <button key={person.id} type="button" disabled={sending} onClick={() => void sendInMessage(person)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10">{person.display_name}</button>)}
                  {!sharePeople.isLoading && !sharePeople.data?.length && <p className="py-2 text-xs text-muted-foreground">No encontramos amigos o seguidores para enviarles el post.</p>}
                </div>
              </div>
            </section>
            <section className="space-y-2 border-t border-white/10 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fuera de Cupido Leudy</p>
              <Button variant="outline" className="w-full" onClick={() => { setShareOpen(false); onShare(); }}><Share2 className="mr-2 size-4" />Compartir o copiar enlace</Button>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
