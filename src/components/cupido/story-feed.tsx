import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Eye, Heart, Loader2, MoreHorizontal, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaComposer } from "@/components/cupido/media-composer";
import { CupidoVideoPlayer } from "@/components/cupido/video-player";
import { EmojiOverlayPicker, GlowingEmojiOverlay, parseEmojiOverlay, serializeEmojiOverlay } from "@/components/cupido/glowing-emoji-picker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { playCupidoSound } from "@/lib/cupido-sounds";
import { notifyUser } from "@/lib/posts";
import { compressImageFile, safeExtension } from "@/lib/storage";
import type { MediaFilterId } from "@/lib/media-filters";
import { mediaFilterCss } from "@/lib/media-filters";

type Story = {
  id: string;
  user_id: string;
  media_url: string;
  media_type: "image" | "video";
  caption: string;
  filter_name: string;
  emoji_overlay: string;
  created_at: string;
  expires_at: string;
  display_name: string;
  avatar_url: string;
  viewer_count: number;
  heart_count: number;
  liked: boolean;
};
type AnyDb = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const storyDb = supabase as unknown as AnyDb;

export function StoryFeed({ compact = false }: { compact?: boolean }) {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const client = useQueryClient();
  const [caption, setCaption] = useState("");
  const [emojiOverlay, setEmojiOverlay] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ file: File; filter: MediaFilterId } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelUploadRef = useRef(false);
  const [viewersStory, setViewersStory] = useState<string | null>(null);
  const viewedStories = useRef(new Set<string>());

  const stories = useQuery({
    queryKey: ["cupido-stories", viewerId],
    queryFn: async () => {
      const { data, error } = await storyDb.from("cupido_stories")
        .select("id,user_id,media_url,media_type,caption,filter_name,emoji_overlay,created_at,expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as Omit<Story, "display_name" | "avatar_url">[];
      const hiddenResult = viewerId
        ? await storyDb.from("cupido_story_hides").select("story_owner").eq("user_id", viewerId)
        : { data: [], error: null };
      if (hiddenResult.error) throw hiddenResult.error;
      const hiddenOwners = new Set<string>((hiddenResult.data ?? []).map((row: { story_owner: string }) => row.story_owner));
      const visibleRows = rows.filter((row) => !hiddenOwners.has(row.user_id));
      const storyIds = visibleRows.map((row) => row.id);
      const [heartResult, viewCounts] = await Promise.all([
        storyIds.length ? storyDb.from("cupido_story_hearts").select("story_id,user_id").in("story_id", storyIds) : { data: [], error: null },
        Promise.all(visibleRows.filter((row) => row.user_id === viewerId).map(async (row) => {
          const result = await storyDb.from("cupido_story_views").select("viewer_id", { count: "exact", head: true }).eq("story_id", row.id);
          if (result.error) throw result.error;
          return [row.id, result.count ?? 0] as const;
        })),
      ]);
      if (heartResult.error) throw heartResult.error;
      const hearts = (heartResult.data ?? []) as Array<{ story_id: string; user_id: string }>;
      const viewCountByStory = new Map(viewCounts);
      const ids = [...new Set(visibleRows.map((row) => row.user_id))];
      const profiles = ids.length
        ? await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url,is_cupido_active").in("id", ids)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const byId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
      return visibleRows.flatMap((row) => {
        const profile = byId.get(row.user_id);
        if (!profile?.is_cupido_active) return [];
        const storyHearts = hearts.filter((heart) => heart.story_id === row.id);
        return [{ ...row, display_name: profile.display_name ?? "Miembro de Cupido", avatar_url: profile.avatar_url ?? "", heart_count: storyHearts.length, liked: storyHearts.some((heart) => heart.user_id === viewerId), viewer_count: viewCountByStory.get(row.id) ?? 0 }];
      }) as Story[];
    },
  });

  useEffect(() => {
    const channel = supabase.channel(("cupido-stories-live") + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_stories" }, () => {
        void client.invalidateQueries({ queryKey: ["cupido-stories"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [client, viewerId]);

  useEffect(() => {
    if (!draft) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(draft.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  useEffect(() => {
    if (compact || !viewerId) return;
    for (const story of stories.data ?? []) {
      if (story.user_id === viewerId || viewedStories.current.has(story.id)) continue;
      viewedStories.current.add(story.id);
      void storyDb.rpc("cupido_story_view", { _story: story.id });
    }
  }, [compact, stories.data, viewerId]);

  const viewers = useQuery({
    queryKey: ["cupido-story-viewers", viewersStory],
    enabled: Boolean(viewersStory),
    queryFn: async () => {
      const { data, error } = await storyDb.from("cupido_story_views").select("viewer_id,viewed_at").eq("story_id", viewersStory!);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ viewer_id: string; viewed_at: string }>;
      const profiles = rows.length ? await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url").in("id", rows.map((row) => row.viewer_id)) : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const byId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
      return rows.map((row) => ({ ...row, profile: byId.get(row.viewer_id) }));
    },
  });

  const publish = async (file: File, filter: MediaFilterId) => {
    if (!viewerId) {
      toast.error("Inicia sesión para publicar una historia.");
      return;
    }
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && !file.type.startsWith("image/")) {
      toast.error("Elige una foto o un video.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("El archivo debe pesar menos de 25 MB.");
      return;
    }
    setUploading(true);
    cancelUploadRef.current = false;
    setCancelRequested(false);
    let uploadedPath: string | null = null;
    try {
      const uploadFile = isVideo ? file : await compressImageFile(file, 300 * 1024);
      if (cancelUploadRef.current) { toast.info("Subida cancelada."); return; }
      const extension = safeExtension(uploadFile.name, isVideo ? "webm" : "jpg");
      if (isVideo && !["mp4", "webm", "mov", "m4v"].includes(extension)) throw new Error("Formato de video no admitido.");
      const path = `${viewerId}/stories/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("media").upload(path, uploadFile, {
        contentType: uploadFile.type || (isVideo ? "video/webm" : "image/jpeg"),
        upsert: false,
      });
      if (uploadError) throw uploadError;
      uploadedPath = path;
      if (cancelUploadRef.current) {
        await supabase.storage.from("media").remove([path]);
        uploadedPath = null;
        toast.info("Subida cancelada.");
        return;
      }
      const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);
      const { error } = await storyDb.from("cupido_stories").insert({
        user_id: viewerId,
        media_url: publicData.publicUrl,
        media_type: isVideo ? "video" : "image",
        caption: caption.trim().slice(0, 300),
        filter_name: filter,
        emoji_overlay: serializeEmojiOverlay(emojiOverlay),
      });
      if (error) throw error;
      setCaption("");
      setEmojiOverlay([]);
      setDraft(null);
      toast.success("Historia publicada durante 24 horas.");
      await client.invalidateQueries({ queryKey: ["cupido-stories"] });
    } catch (error) {
      if (uploadedPath) void supabase.storage.from("media").remove([uploadedPath]);
      toast.error(error instanceof Error ? error.message : "No se pudo publicar la historia.");
    } finally {
      setCancelRequested(false);
      setUploading(false);
    }
  };

  const reply = useMutation({
    mutationFn: async (story: Story) => {
      const body = replyText[story.id]?.trim();
      if (!viewerId || !body) throw new Error("Escribe una respuesta.");
      const { data: conversationId, error: openError } = await supabase.rpc("cupido_open_conversation", { _other: story.user_id });
      if (openError) throw openError;
      const message = `Respuesta a tu historia: ${body.slice(0, 500)}`;
      const { error } = await supabase.from("cupido_messages").insert({ conversation_id: conversationId, sender_id: viewerId, body: message });
      if (error) throw error;
      void playCupidoSound("message-sent", viewerId);
      void notifyUser({ userId: story.user_id, title: "Respuesta a tu historia", body: body.slice(0, 120), kind: "story_reply", actorId: viewerId, targetId: story.id });
      return story.id;
    },
    onSuccess: (storyId) => {
      setReplyText((current) => ({ ...current, [storyId]: "" }));
      toast.success("Tu respuesta llegó a Mensajes.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo enviar la respuesta."),
  });

  const interact = async (name: string, args: Record<string, unknown>, success: string) => {
    const { error } = await storyDb.rpc(name, args);
    if (error) { toast.error(error.message || "No se pudo actualizar la historia."); return; }
    toast.success(success);
    await client.invalidateQueries({ queryKey: ["cupido-stories"] });
  };

  const deleteStory = async (story: Story) => {
    const { error } = await storyDb.from("cupido_stories").delete().eq("id", story.id).eq("user_id", viewerId);
    if (error) { toast.error("No se pudo eliminar la historia."); return; }
    toast.success("Historia eliminada.");
    await client.invalidateQueries({ queryKey: ["cupido-stories"] });
  };

  const visibleStories = useMemo(() => stories.data ?? [], [stories.data]);

  if (compact) {
    return (
      <section className="rounded-xl border border-pink-300/25 bg-slate-950/85 p-2.5 shadow-lg backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white"><Clock3 className="size-3.5 text-pink-300" /> Historias 24 h</div>
          <Button asChild type="button" size="sm" className="h-7 gap-1 px-2 text-[11px]">
            <Link to="/historia"><Plus className="size-3.5" /> Agregar historia</Link>
          </Button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {stories.isLoading && <span className="px-1 py-2 text-[11px] text-white/60">Cargando historias…</span>}
          {!stories.isLoading && visibleStories.length === 0 && <Link to="/historia" className="px-1 py-2 text-[11px] text-white/60">Sé la primera persona en compartir una historia.</Link>}
          {visibleStories.map((story) => (
            <Link key={story.id} to="/historia" aria-label={`Ver historia de ${story.display_name}`} className="relative h-[72px] w-[58px] shrink-0 overflow-hidden rounded-lg border border-pink-300/40 bg-black">
              {story.media_type === "image" ? <img src={story.media_url} alt="" className="absolute inset-0 size-full object-cover" style={{ filter: mediaFilterCss(story.filter_name as MediaFilterId) }} /> : <video src={story.media_url} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" style={{ filter: mediaFilterCss(story.filter_name as MediaFilterId) }} />}
              <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/15" />
              <Avatar className="absolute left-1 top-1 size-6 border border-pink-300">
                <AvatarImage src={story.avatar_url} alt="" />
                <AvatarFallback>{story.display_name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <span className="absolute inset-x-1 bottom-1 line-clamp-2 text-[9px] font-semibold leading-tight text-white">{story.display_name}</span>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-pink-400/25 bg-pink-500/[0.06] p-4">
        <div className="mb-3 flex items-center gap-2 font-display text-sm text-white"><Clock3 className="size-4 text-pink-300" /> Comparte una historia · desaparece en 24 h</div>
        <Input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={300} placeholder="Escribe algo para acompañar la foto o el video..." className="mb-3" />
        {!viewerId && <p className="mb-3 text-xs text-muted-foreground">Inicia sesión para publicar historias.</p>}
        <div className="mb-3"><EmojiOverlayPicker value={emojiOverlay} onChange={setEmojiOverlay} disabled={uploading} /></div>
        <MediaComposer disabled={uploading || !viewerId} onFile={(file, filter) => setDraft({ file, filter })} galleryLabel="Agregar foto o video" />
        {draft && previewUrl && (
          <div className="mt-3 space-y-3 rounded-xl border border-pink-300/20 bg-black/20 p-3">
            <p className="text-xs font-semibold text-white">Vista previa</p>
            <div className="relative overflow-hidden rounded-lg bg-black">
              {draft.file.type.startsWith("video/")
                ? <video src={previewUrl} controls playsInline className="max-h-80 w-full object-contain" style={{ filter: mediaFilterCss(draft.filter) }} />
                : <img src={previewUrl} alt="Vista previa de la historia" className="max-h-80 w-full object-contain" style={{ filter: mediaFilterCss(draft.filter) }} />}
              <GlowingEmojiOverlay emojis={emojiOverlay} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={uploading} onClick={() => setDraft(null)}>Quitar</Button>
              <Button type="button" disabled={uploading} onClick={() => void publish(draft.file, draft.filter)}>{uploading ? <Loader2 className="size-4 animate-spin" /> : null} Publicar 24 h</Button>
            </div>
          </div>
        )}
        {uploading && <div className="mt-3 flex items-center justify-center gap-3 text-xs text-pink-200"><span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> {cancelRequested ? "Cancelando subida..." : "Publicando..."}</span><Button type="button" size="sm" variant="outline" disabled={cancelRequested} onClick={() => { cancelUploadRef.current = true; setCancelRequested(true); }}>Cancelar subida</Button></div>}
      </div>

      {stories.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Cargando historias...</p> : null}
      {!stories.isLoading && !visibleStories.length ? <p className="rounded-2xl border border-white/10 p-8 text-center text-sm text-muted-foreground">Todavía no hay historias activas. Publica la primera.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleStories.map((story) => (
          <article key={story.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            <div className="flex items-center gap-3 p-3">
              <Avatar className="size-10 border border-pink-400/50"><AvatarImage src={story.avatar_url} alt={story.display_name} /><AvatarFallback>{story.display_name.slice(0, 1)}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1"><Link to="/perfil" search={{ userId: story.user_id }} className="truncate text-sm font-semibold text-white hover:underline">{story.display_name}</Link><p className="text-[11px] text-muted-foreground">Vence {new Date(story.expires_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</p></div>
              {story.user_id === viewerId ? <><Button type="button" variant="ghost" size="icon" aria-label="Ver quién vio la historia" onClick={() => setViewersStory(story.id)}><Eye className="size-4" /><span className="sr-only">{story.viewer_count}</span></Button><Button type="button" variant="ghost" size="icon" aria-label="Eliminar historia" onClick={() => void deleteStory(story)}><Trash2 className="size-4" /></Button></> : <details className="relative"><summary className="list-none cursor-pointer rounded p-2 text-muted-foreground hover:text-white" aria-label="Más opciones de historia"><MoreHorizontal className="size-4" /></summary><div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-white/10 bg-slate-950 p-1 shadow-xl"><button className="w-full rounded px-3 py-2 text-left text-xs hover:bg-white/10" onClick={() => void interact("cupido_hide_story_user", { _owner: story.user_id }, "Historias de este usuario ocultas.")}>Ocultar usuario</button><button className="w-full rounded px-3 py-2 text-left text-xs text-red-200 hover:bg-white/10" onClick={() => void interact("cupido_report_story", { _story: story.id, _reason: "Contenido reportado desde Historias" }, "Reporte enviado al Administrador.")}>Reportar al Admin</button></div></details>}
            </div>
            <div className="relative">
              {story.media_type === "video" ? <CupidoVideoPlayer src={story.media_url} filter={story.filter_name as MediaFilterId} className="aspect-[4/5] w-full bg-black object-cover" /> : <img src={story.media_url} alt={story.caption || `Historia de ${story.display_name}`} className="aspect-[4/5] w-full bg-black object-cover" style={{ filter: mediaFilterCss(story.filter_name as MediaFilterId) }} />}
              <GlowingEmojiOverlay emojis={parseEmojiOverlay(story.emoji_overlay)} />
            </div>
            {story.caption && <p className="px-3 pt-3 text-sm text-foreground/90">{story.caption}</p>}
            <div className="flex items-center justify-between px-3 pt-3 text-xs text-muted-foreground"><button type="button" className="inline-flex items-center gap-1.5 hover:text-pink-200" disabled={!viewerId || story.user_id === viewerId} onClick={() => void interact("cupido_toggle_story_heart", { _story: story.id }, story.liked ? "Quitaste tu corazón." : "Enviaste un corazón.")}><Heart className={`size-4 ${story.liked ? "fill-pink-400 text-pink-400" : ""}`} /> {story.heart_count}</button>{story.user_id === viewerId && <button type="button" className="inline-flex items-center gap-1.5" onClick={() => setViewersStory(story.id)}><Eye className="size-4" /> {story.viewer_count} vistas</button>}</div>
            {viewerId && viewerId !== story.user_id && (
              <div className="flex gap-2 p-3">
                <Input value={replyText[story.id] ?? ""} onChange={(event) => setReplyText((current) => ({ ...current, [story.id]: event.target.value }))} maxLength={500} placeholder="Responder historia..." />
                <Button size="icon" aria-label="Enviar respuesta" disabled={reply.isPending || !replyText[story.id]?.trim()} onClick={() => reply.mutate(story)}><Send className="size-4" /></Button>
              </div>
            )}
          </article>
        ))}
      </div>
      <Dialog open={Boolean(viewersStory)} onOpenChange={(open) => !open && setViewersStory(null)}>
        <DialogContent><DialogHeader><DialogTitle>Vieron tu historia</DialogTitle><DialogDescription>{viewers.data?.length ?? 0} personas</DialogDescription></DialogHeader><div className="max-h-72 space-y-2 overflow-y-auto">{viewers.data?.map((row) => <Link key={row.viewer_id} to="/perfil" search={{ userId: row.viewer_id }} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/5"><Avatar className="size-9"><AvatarImage src={row.profile?.avatar_url ?? ""} /><AvatarFallback>{row.profile?.display_name?.slice(0, 1) ?? "?"}</AvatarFallback></Avatar><span className="text-sm text-white">{row.profile?.display_name ?? "Miembro de Cupido"}</span><span className="ml-auto text-[10px] text-muted-foreground">{new Date(row.viewed_at).toLocaleString("es", { hour: "2-digit", minute: "2-digit" })}</span></Link>)}</div></DialogContent>
      </Dialog>
    </section>
  );
}
