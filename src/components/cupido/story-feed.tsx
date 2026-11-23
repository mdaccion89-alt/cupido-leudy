import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Eye, Gift, Heart, Loader2, MessageCircle, MoreHorizontal, Plus, Send, Trash2, Video, X } from "lucide-react";
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
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { ImageCropDialog } from "@/components/cupido/image-crop-dialog";

type Story = {
  id: string;
  user_id: string;
  media_url: string | null;
  media_type: "image" | "video" | "text";
  background_gradient: string;
  caption: string;
  filter_name: string;
  emoji_overlay: string;
  created_at: string;
  expires_at: string;
  display_name: string;
  avatar_url: string;
  age: number | null;
  is_verified_blue: boolean;
  viewer_count: number;
  heart_count: number;
  liked: boolean;
};
type AnyDb = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const storyDb = supabase as unknown as AnyDb;
const STORY_BACKGROUNDS = [
  { id: "pink", label: "Rosa", className: "from-pink-600 via-fuchsia-700 to-slate-950" },
  { id: "sunset", label: "Atardecer", className: "from-orange-500 via-rose-600 to-purple-950" },
  { id: "ocean", label: "Océano", className: "from-cyan-500 via-blue-700 to-indigo-950" },
  { id: "gold", label: "Dorado", className: "from-amber-400 via-orange-600 to-rose-950" },
] as const;
function storyBackground(id: string) {
  return STORY_BACKGROUNDS.find((item) => item.id === id)?.className ?? STORY_BACKGROUNDS[0].className;
}

export function StoryFeed({ compact = false, initialStoryId, onlyUserId }: { compact?: boolean; initialStoryId?: string | undefined; onlyUserId?: string | undefined }) {
  const { session, onlineUserIds } = useAuth();
  const viewerId = session?.user.id ?? null;
  const client = useQueryClient();
  const [caption, setCaption] = useState("");
  const [emojiOverlay, setEmojiOverlay] = useState<string[]>([]);
  const [backgroundGradient, setBackgroundGradient] = useState<string>(STORY_BACKGROUNDS[0].id);
  const [draft, setDraft] = useState<{ file: File; filter: MediaFilterId } | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelUploadRef = useRef(false);
  const [viewersStory, setViewersStory] = useState<string | null>(null);
  const [storyViewerId, setStoryViewerId] = useState<string | null>(null);
  const viewedStories = useRef(new Set<string>());

  const stories = useQuery({
    queryKey: ["cupido-stories", viewerId, onlyUserId],
    queryFn: async () => {
      let storyQuery = storyDb.from("cupido_stories")
        .select("id,user_id,media_url,media_type,caption,filter_name,emoji_overlay,background_gradient,created_at,expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(100);
      if (onlyUserId) storyQuery = storyQuery.eq("user_id", onlyUserId);
      const { data, error } = await storyQuery;
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
        ? await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url,age,is_verified_blue,is_cupido_active").in("id", ids)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const byId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
      return visibleRows.flatMap((row) => {
        const profile = byId.get(row.user_id);
        const storyHearts = hearts.filter((heart) => heart.story_id === row.id);
        return [{ ...row, display_name: profile?.display_name ?? "Miembro de Cupido", avatar_url: profile?.avatar_url ?? "", age: profile?.age ?? null, is_verified_blue: profile?.is_verified_blue ?? false, heart_count: storyHearts.length, liked: storyHearts.some((heart) => heart.user_id === viewerId), viewer_count: viewCountByStory.get(row.id) ?? 0 }];
      }) as Story[];
    },
  });

  useEffect(() => {
    const channel = supabase.channel(("cupido-stories-live") + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_stories" }, () => {
        void client.invalidateQueries({ queryKey: ["cupido-stories"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cupido_story_views" }, () => {
        void client.invalidateQueries({ queryKey: ["cupido-stories"] });
        void client.invalidateQueries({ queryKey: ["cupido-story-viewers"] });
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

  const publishMedia = async (file: File, filter: MediaFilterId) => {
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
        background_gradient: backgroundGradient,
      });
      if (error) throw error;
      setCaption("");
      setEmojiOverlay([]);
      setBackgroundGradient(STORY_BACKGROUNDS[0].id);
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

  const publishText = async () => {
    if (!viewerId) {
      toast.error("Inicia sesión para publicar una historia.");
      return;
    }
    if (!caption.trim() && !emojiOverlay.length) return;
    setUploading(true);
    try {
      const { error } = await storyDb.from("cupido_stories").insert({
        user_id: viewerId,
        media_url: null,
        media_type: "text",
        caption: caption.trim().slice(0, 300),
        filter_name: "normal",
        emoji_overlay: serializeEmojiOverlay(emojiOverlay),
        background_gradient: backgroundGradient,
      });
      if (error) throw error;
      setCaption("");
      setEmojiOverlay([]);
      setBackgroundGradient(STORY_BACKGROUNDS[0].id);
      toast.success("Historia publicada durante 24 horas.");
      await client.invalidateQueries({ queryKey: ["cupido-stories"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo publicar la historia.");
    } finally {
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
  const latestStories = useMemo(() => {
    const latestByUser = new Map<string, Story>();
    for (const story of visibleStories) if (!latestByUser.has(story.user_id)) latestByUser.set(story.user_id, story);
    return [...latestByUser.values()];
  }, [visibleStories]);
  const ownStory = latestStories.find((story) => story.user_id === viewerId);

  useEffect(() => {
    const nextExpiry = visibleStories.reduce<number | null>((soonest, story) => {
      const expiresAt = new Date(story.expires_at).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return soonest;
      return soonest === null ? expiresAt : Math.min(soonest, expiresAt);
    }, null);
    if (nextExpiry === null) return;
    const timer = window.setTimeout(() => {
      void client.invalidateQueries({ queryKey: ["cupido-stories", viewerId] });
    }, Math.max(0, nextExpiry - Date.now() + 250));
    return () => window.clearTimeout(timer);
  }, [client, visibleStories, viewerId]);

  const activeStory = visibleStories.find((story) => story.id === storyViewerId) ?? null;
  const storySequence = useMemo(
    () => activeStory ? visibleStories.filter((story) => story.user_id === activeStory.user_id) : [],
    [activeStory, visibleStories],
  );
  const activeStoryIndex = storySequence.findIndex((story) => story.id === activeStory?.id);

  useEffect(() => {
    if (!initialStoryId || !visibleStories.some((story) => story.id === initialStoryId)) return;
    setStoryViewerId(initialStoryId);
  }, [initialStoryId, visibleStories]);

  useEffect(() => {
    if (!activeStory || !viewerId || activeStory.user_id === viewerId || viewedStories.current.has(activeStory.id)) return;
    viewedStories.current.add(activeStory.id);
    void storyDb.rpc("cupido_story_view", { _story: activeStory.id });
  }, [activeStory, viewerId]);

  useEffect(() => {
    if (!activeStory) return;
    const handleBack = (event: Event) => {
      event.preventDefault();
      setStoryViewerId(null);
    };
    window.addEventListener("cupido:android-back", handleBack);
    return () => window.removeEventListener("cupido:android-back", handleBack);
  }, [activeStory]);

  useEffect(() => {
    if (!activeStory) return;
    const timer = window.setTimeout(() => {
      setStoryViewerId(storySequence[activeStoryIndex + 1]?.id ?? null);
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [activeStory?.id, activeStoryIndex, storySequence]);

  if (compact) {
    return (
      <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Clock3 className="size-4 text-pink-300" /> Historias · 24 h</div>
        <div translate="no" className="flex gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(!onlyUserId || onlyUserId === viewerId) && <Link to="/historia" search={{ story: undefined }} aria-label="Tu historia: subir foto o video" className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center">
            <span className={`relative grid size-16 place-items-center rounded-full p-[3px] ${ownStory ? "bg-[linear-gradient(135deg,#ec4899,#f59e0b)]" : "bg-white/15"}`}>
              <Avatar userId={viewerId} className="size-full border-2 border-background bg-zinc-900">
                <AvatarImage src={ownStory?.avatar_url ?? ""} alt="" />
                <AvatarFallback className="bg-zinc-900 text-white"><Plus className="size-6" /></AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center rounded-full border-2 border-background bg-pink-500 text-white"><Plus className="size-3.5" /></span>
            </span>
            <span className="w-full truncate text-[10px] font-medium leading-tight text-white">Tu historia</span>
          </Link>}
          {stories.isLoading && <span className="py-5 text-xs text-white/60">Cargando historias…</span>}
          {latestStories.filter((story) => story.user_id !== viewerId).map((story) => {
            const isOnline = onlineUserIds.includes(story.user_id);
            return (
              <Link key={story.user_id} to="/historia" search={{ story: story.id }} aria-label={`Ver historia de ${story.display_name}`} className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center">
                <span className="relative rounded-full bg-[linear-gradient(135deg,#ec4899,#f59e0b)] p-[3px]">
                  <Avatar userId={story.user_id} className="size-16 border-2 border-background">
                    <AvatarImage src={story.avatar_url} alt={story.display_name} />
                    <AvatarFallback className="bg-pink-500/20 text-pink-100">{story.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  {isOnline && <span className="absolute bottom-0.5 right-0.5 size-3 rounded-full border-2 border-background bg-emerald-400" />}
                </span>
                <span className="w-full truncate text-[10px] font-medium leading-tight text-white">{story.display_name}</span>
              </Link>
            );
          })}
          {!stories.isLoading && latestStories.filter((story) => story.user_id !== viewerId).length === 0 && <span className="py-5 text-xs text-white/60">Todavía no hay historias activas.</span>}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div id="story-composer" className="scroll-mt-24 rounded-2xl border border-pink-400/25 bg-pink-500/[0.06] p-4">
        <div className="mb-3 flex items-center gap-2 font-display text-sm text-white"><Clock3 className="size-4 text-pink-300" /> Comparte una historia · desaparece en 24 h</div>
        <Input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={300} placeholder="Escribe algo para acompañar la foto o el video..." className="mb-3" />
        {!viewerId && <p className="mb-3 text-xs text-muted-foreground">Inicia sesión para publicar historias.</p>}
        {!draft && <div className="mb-3"><EmojiOverlayPicker value={emojiOverlay} onChange={setEmojiOverlay} disabled={uploading} /></div>}
        <div className="mb-3 space-y-2">
          <p className="text-xs font-semibold text-white">Fondo para historia de texto</p>
          <div className="flex flex-wrap gap-2">{STORY_BACKGROUNDS.map((background) => <button key={background.id} type="button" aria-label={`Fondo ${background.label}`} aria-pressed={backgroundGradient === background.id} disabled={uploading} onClick={() => setBackgroundGradient(background.id)} className={`h-9 w-14 rounded-lg border bg-gradient-to-br ${background.className} ${backgroundGradient === background.id ? "border-white ring-2 ring-pink-300" : "border-white/20"}`} />)}</div>
        </div>
        <MediaComposer disabled={uploading || !viewerId} onFile={(file, filter) => { setDraft({ file, filter }); setCropFile(file.type.startsWith("image/") ? file : null); }} galleryLabel="Agregar foto o video" />
        {draft && previewUrl && (
          <div className="mt-3 space-y-3 rounded-xl border border-pink-300/20 bg-black/20 p-3">
            <p className="text-xs font-semibold text-white">Vista previa</p>
            <div className="relative overflow-hidden rounded-lg bg-black">
              {draft.file.type.startsWith("video/")
                ? <video src={previewUrl} controls playsInline webkit-playsinline="true" className="mx-auto aspect-[9/16] max-h-[70dvh] w-full max-w-sm object-cover" style={{ filter: mediaFilterCss(draft.filter) }} />
                : <img src={previewUrl} alt="Vista previa de la historia" className="mx-auto aspect-[9/16] max-h-[70dvh] w-full max-w-sm object-cover" style={{ filter: mediaFilterCss(draft.filter) }} />}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={uploading} onClick={() => setDraft(null)}>Quitar</Button>
              <Button type="button" disabled={uploading} onClick={() => void publishMedia(draft.file, draft.filter)}>{uploading ? <Loader2 className="size-4 animate-spin" /> : null} Publicar historia</Button>
            </div>
          </div>
        )}
        {!draft && (caption.trim() || emojiOverlay.length > 0) && (
          <div className={`relative mt-3 flex min-h-56 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br p-6 text-center text-xl font-semibold text-white ${storyBackground(backgroundGradient)}`}>
            <span className="relative z-[1] whitespace-pre-wrap break-words">{caption.trim() || "Tu estado con emojis"}</span>
            <GlowingEmojiOverlay emojis={emojiOverlay} />
          </div>
        )}
        {!draft && (
          <div className="mt-3 flex justify-end">
            <Button type="button" disabled={uploading || !viewerId || (!caption.trim() && !emojiOverlay.length)} onClick={() => void publishText()}>{uploading ? <Loader2 className="size-4 animate-spin" /> : null} Publicar historia</Button>
          </div>
        )}
        {uploading && <div className="mt-3 flex items-center justify-center gap-3 text-xs text-pink-200"><span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> {cancelRequested ? "Cancelando subida..." : "Publicando..."}</span><Button type="button" size="sm" variant="outline" disabled={cancelRequested} onClick={() => { cancelUploadRef.current = true; setCancelRequested(true); }}>Cancelar subida</Button></div>}
      </div>

      {stories.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Cargando historias...</p> : null}
      {!stories.isLoading && !visibleStories.length ? <p className="rounded-2xl border border-white/10 p-8 text-center text-sm text-muted-foreground">Todavía no hay historias activas. Publica la primera.</p> : null}
      <div translate="no" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleStories.map((story) => (
          <article key={story.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            <div className="flex items-center gap-3 p-3">
              <Avatar userId={story.user_id} className="size-10 border border-pink-400/50"><AvatarImage src={story.avatar_url} alt={story.display_name} /><AvatarFallback>{story.display_name.slice(0, 1)}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1"><Link to="/perfil" search={{ userId: story.user_id }} className="truncate text-sm font-semibold text-white hover:underline">{story.display_name}</Link><p className="text-[11px] text-muted-foreground">Vence {new Date(story.expires_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</p></div>
              {story.user_id === viewerId ? <><Button type="button" variant="ghost" size="icon" aria-label="Ver quién vio la historia" onClick={() => setViewersStory(story.id)}><Eye className="size-4" /><span className="sr-only">{story.viewer_count}</span></Button><Button type="button" variant="ghost" size="icon" aria-label="Eliminar historia" onClick={() => void deleteStory(story)}><Trash2 className="size-4" /></Button></> : <details className="relative"><summary className="list-none cursor-pointer rounded p-2 text-muted-foreground hover:text-white" aria-label="Más opciones de historia"><MoreHorizontal className="size-4" /></summary><div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-white/10 bg-slate-950 p-1 shadow-xl"><button className="w-full rounded px-3 py-2 text-left text-xs hover:bg-white/10" onClick={() => void interact("cupido_hide_story_user", { _owner: story.user_id }, "Historias de este usuario ocultas.")}>Ocultar usuario</button><button className="w-full rounded px-3 py-2 text-left text-xs text-red-200 hover:bg-white/10" onClick={() => void interact("cupido_report_story", { _story: story.id, _reason: "Contenido reportado desde Historias" }, "Reporte enviado al Administrador.")}>Reportar al Admin</button></div></details>}
            </div>
            <div className="relative">
              {story.media_type === "text" ? <div className={`relative flex aspect-[9/16] items-center justify-center overflow-hidden bg-gradient-to-br p-6 text-center text-xl font-semibold text-white ${storyBackground(story.background_gradient)}`}><span className="relative z-[1] whitespace-pre-wrap break-words">{story.caption || "✨"}</span><GlowingEmojiOverlay emojis={parseEmojiOverlay(story.emoji_overlay)} /></div> : story.media_type === "video" ? <CupidoVideoPlayer src={story.media_url ?? ""} filter={story.filter_name as MediaFilterId} className="aspect-[9/16] w-full bg-black object-cover" /> : <img src={story.media_url ?? ""} alt={story.caption || `Historia de ${story.display_name}`} className="aspect-[9/16] w-full bg-black object-cover" style={{ filter: mediaFilterCss(story.filter_name as MediaFilterId) }} />}
              <button type="button" aria-label={`Ver historia de ${story.display_name}`} onClick={() => setStoryViewerId(story.id)} className="absolute inset-0 z-[2] grid place-items-center bg-black/0 text-sm font-semibold text-white opacity-0 transition hover:bg-black/15 hover:opacity-100 focus-visible:bg-black/25 focus-visible:opacity-100"><span className="rounded-full bg-black/60 px-4 py-2 backdrop-blur">Ver historia</span></button>
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
      {activeStory && (
        <div role="dialog" aria-modal="true" aria-label={`Historia de ${activeStory.display_name}`} className="fixed inset-0 z-[70] h-[100dvh] overflow-hidden bg-black text-white">
          <div className="absolute inset-0">
            {activeStory.media_type === "text" ? (
              <div className={`flex size-full items-center justify-center bg-gradient-to-br px-8 pb-28 pt-36 text-center text-3xl font-semibold ${storyBackground(activeStory.background_gradient)}`}><p className="whitespace-pre-wrap break-words">{activeStory.caption || "✨"}</p></div>
            ) : activeStory.media_type === "video" ? (
              <video src={activeStory.media_url ?? undefined} autoPlay muted loop playsInline webkit-playsinline="true" className="size-full object-cover" style={{ filter: mediaFilterCss(activeStory.filter_name as MediaFilterId) }} />
            ) : (
              <img src={activeStory.media_url ?? ""} alt={activeStory.caption || `Historia de ${activeStory.display_name}`} className="size-full object-cover" style={{ filter: mediaFilterCss(activeStory.filter_name as MediaFilterId) }} />
            )}
            {activeStory.media_type === "text" && <GlowingEmojiOverlay emojis={parseEmojiOverlay(activeStory.emoji_overlay)} />}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/75" />
          </div>
          <div className="absolute inset-x-0 top-0 z-10 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
            <div className="flex gap-1">
              {storySequence.map((story, index) => <span key={story.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30"><span key={`${story.id}-${activeStory.id}`} className={`block h-full bg-white ${index < activeStoryIndex ? "w-full" : index === activeStoryIndex ? "story-progress-fill w-full origin-left" : "w-0"}`} /></span>)}
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <Avatar userId={activeStory.user_id} className="size-10 border border-white/60"><AvatarImage src={activeStory.avatar_url} alt={activeStory.display_name} /><AvatarFallback>{activeStory.display_name.slice(0, 1)}</AvatarFallback></Avatar>
              <Link to="/perfil" search={{ userId: activeStory.user_id }} className="min-w-0 flex-1 text-sm font-semibold text-white drop-shadow">{activeStory.display_name}{activeStory.age ? ` · ${activeStory.age}` : ""}<span className="ml-1 inline-flex align-middle"><VerifiedBadge verified={activeStory.is_verified_blue} className="size-4" /></span></Link>
              <span className="text-[11px] text-white/80">{new Date(activeStory.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
              <Button type="button" variant="ghost" size="icon" aria-label="Cerrar historia" className="size-9 shrink-0 text-white hover:bg-white/15" onClick={() => setStoryViewerId(null)}><X className="size-5" /></Button>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 px-4 pb-[calc(6.25rem+env(safe-area-inset-bottom))]">
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="rounded-full bg-violet-600 text-white hover:bg-violet-500"><Link to="/chat" search={{ userId: activeStory.user_id, startVideo: true, roulette: false }}><Video className="size-4" /> Videollamada</Link></Button>
              <Button asChild size="sm" variant="outline" className="rounded-full border-white/40 bg-black/30 text-white hover:bg-white/15"><Link to="/chat" search={{ userId: activeStory.user_id }}><MessageCircle className="size-4" /> Chat</Link></Button>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" size="icon" aria-label={activeStory.liked ? "Quitar corazón" : "Enviar corazón"} variant="outline" className="size-11 rounded-full border-pink-200/40 bg-black/35 text-white hover:bg-pink-500/40" onClick={() => void interact("cupido_toggle_story_heart", { _story: activeStory.id }, activeStory.liked ? "Quitaste tu corazón." : "Enviaste un corazón.")}><Heart className={`size-5 ${activeStory.liked ? "fill-pink-400 text-pink-400" : ""}`} /></Button>
              <Button asChild size="icon" aria-label="Enviar un regalo" className="size-11 rounded-full bg-amber-400 text-amber-950 hover:bg-amber-300"><Link to="/chat" search={{ userId: activeStory.user_id, openGift: true }}><Gift className="size-5" /></Link></Button>
            </div>
          </div>
          <button type="button" aria-label="Historia anterior" className="absolute bottom-28 left-0 top-24 z-[5] w-1/4" onClick={() => setStoryViewerId(storySequence[Math.max(0, activeStoryIndex - 1)]?.id ?? activeStory.id)} />
          <button type="button" aria-label="Siguiente historia" className="absolute bottom-28 right-0 top-24 z-[5] w-1/4" onClick={() => setStoryViewerId(storySequence[activeStoryIndex + 1]?.id ?? null)} />
        </div>
      )}
      <Dialog open={Boolean(viewersStory)} onOpenChange={(open) => !open && setViewersStory(null)}>
        <DialogContent><DialogHeader><DialogTitle>Vieron tu historia</DialogTitle><DialogDescription>{viewers.data?.length ?? 0} personas</DialogDescription></DialogHeader><div className="max-h-72 space-y-2 overflow-y-auto">{viewers.data?.map((row) => <Link key={row.viewer_id} to="/perfil" search={{ userId: row.viewer_id }} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/5"><Avatar userId={row.viewer_id} className="size-9"><AvatarImage src={row.profile?.avatar_url ?? ""} /><AvatarFallback>{row.profile?.display_name?.slice(0, 1) ?? "?"}</AvatarFallback></Avatar><span className="text-sm text-white">{row.profile?.display_name ?? "Miembro de Cupido"}</span><span className="ml-auto text-[10px] text-muted-foreground">{new Date(row.viewed_at).toLocaleString("es", { hour: "2-digit", minute: "2-digit" })}</span></Link>)}</div></DialogContent>
      </Dialog>
      <ImageCropDialog
        file={cropFile}
        title="Ajusta tu historia"
        onOpenChange={(open) => { if (!open) setCropFile(null); }}
        onApply={(file) => { setDraft((current) => current ? { ...current, file } : current); setCropFile(null); }}
      />
    </section>
  );
}
