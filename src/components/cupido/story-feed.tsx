import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaComposer } from "@/components/cupido/media-composer";
import { CupidoVideoPlayer } from "@/components/cupido/video-player";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { playCupidoSound } from "@/lib/cupido-sounds";
import { notifyUser } from "@/lib/posts";
import { compressImageFile, safeExtension } from "@/lib/storage";
import type { MediaFilterId } from "@/lib/media-filters";

type Story = {
  id: string;
  user_id: string;
  media_url: string;
  media_type: "image" | "video";
  caption: string;
  filter_name: string;
  created_at: string;
  expires_at: string;
  display_name: string;
  avatar_url: string;
};
type AnyDb = { from: (table: string) => any };
const storyDb = supabase as unknown as AnyDb;

export function StoryFeed() {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const client = useQueryClient();
  const [caption, setCaption] = useState("");
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);

  const stories = useQuery({
    queryKey: ["cupido-stories", viewerId],
    queryFn: async () => {
      const { data, error } = await storyDb.from("cupido_stories")
        .select("id,user_id,media_url,media_type,caption,filter_name,created_at,expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as Omit<Story, "display_name" | "avatar_url">[];
      const ids = [...new Set(rows.map((row) => row.user_id))];
      const profiles = ids.length
        ? await supabase.from("creator_profiles").select("id,display_name,avatar_url,is_cupido_active").in("id", ids)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const byId = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
      return rows.flatMap((row) => {
        const profile = byId.get(row.user_id);
        if (!profile?.is_cupido_active) return [];
        return [{ ...row, display_name: profile.display_name ?? "Miembro de Cupido", avatar_url: profile.avatar_url ?? "" }];
      }) as Story[];
    },
  });

  useEffect(() => {
    const channel = supabase.channel("cupido-stories-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_stories" }, () => {
        void client.invalidateQueries({ queryKey: ["cupido-stories"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [client]);

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
    let uploadedPath: string | null = null;
    try {
      const uploadFile = isVideo ? file : await compressImageFile(file, 300 * 1024);
      const extension = safeExtension(uploadFile.name, isVideo ? "webm" : "jpg");
      if (isVideo && !["mp4", "webm", "mov", "m4v"].includes(extension)) throw new Error("Formato de video no admitido.");
      const path = `${viewerId}/stories/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("media").upload(path, uploadFile, {
        contentType: uploadFile.type || (isVideo ? "video/webm" : "image/jpeg"),
        upsert: false,
      });
      if (uploadError) throw uploadError;
      uploadedPath = path;
      const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);
      const { error } = await storyDb.from("cupido_stories").insert({
        user_id: viewerId,
        media_url: publicData.publicUrl,
        media_type: isVideo ? "video" : "image",
        caption: caption.trim().slice(0, 300),
        filter_name: filter,
      });
      if (error) throw error;
      setCaption("");
      toast.success("Historia publicada durante 24 horas.");
      await client.invalidateQueries({ queryKey: ["cupido-stories"] });
    } catch (error) {
      if (uploadedPath) void supabase.storage.from("media").remove([uploadedPath]);
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

  const visibleStories = useMemo(() => stories.data ?? [], [stories.data]);

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-pink-400/25 bg-pink-500/[0.06] p-4">
        <div className="mb-3 flex items-center gap-2 font-display text-sm text-white"><Clock3 className="size-4 text-pink-300" /> Comparte una historia · desaparece en 24 h</div>
        <Input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={300} placeholder="Escribe algo para acompañar la foto o el video..." className="mb-3" />
        {!viewerId && <p className="mb-3 text-xs text-muted-foreground">Inicia sesión para publicar historias.</p>}
        <MediaComposer disabled={uploading || !viewerId} onFile={(file, filter) => publish(file, filter)} galleryLabel="Agregar foto o video" />
        {uploading && <p className="mt-3 flex items-center gap-2 text-xs text-pink-200"><Loader2 className="size-3.5 animate-spin" /> Publicando...</p>}
      </div>

      {stories.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Cargando historias...</p> : null}
      {!stories.isLoading && !visibleStories.length ? <p className="rounded-2xl border border-white/10 p-8 text-center text-sm text-muted-foreground">Todavía no hay historias activas. Publica la primera.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleStories.map((story) => (
          <article key={story.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            <div className="flex items-center gap-3 p-3">
              <Avatar className="size-10 border border-pink-400/50"><AvatarImage src={story.avatar_url} alt={story.display_name} /><AvatarFallback>{story.display_name.slice(0, 1)}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{story.display_name}</p><p className="text-[11px] text-muted-foreground">Vence {new Date(story.expires_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</p></div>
            </div>
            {story.media_type === "video" ? <CupidoVideoPlayer src={story.media_url} className="aspect-[4/5] w-full bg-black object-cover" /> : <img src={story.media_url} alt={story.caption || `Historia de ${story.display_name}`} className="aspect-[4/5] w-full bg-black object-cover" />}
            {story.caption && <p className="px-3 pt-3 text-sm text-foreground/90">{story.caption}</p>}
            {viewerId && viewerId !== story.user_id && (
              <div className="flex gap-2 p-3">
                <Input value={replyText[story.id] ?? ""} onChange={(event) => setReplyText((current) => ({ ...current, [story.id]: event.target.value }))} maxLength={500} placeholder="Responder historia..." />
                <Button size="icon" aria-label="Enviar respuesta" disabled={reply.isPending || !replyText[story.id]?.trim()} onClick={() => reply.mutate(story)}><Send className="size-4" /></Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
