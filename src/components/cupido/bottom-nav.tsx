import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Coins, Compass, Loader2, MessageCircle, Plus, Radio, UploadCloud, UserRound, Video } from "lucide-react";
import { toast } from "sonner";
import { AdRewardDialog } from "@/components/cupido/ad-reward-dialog";
import { MediaComposer } from "@/components/cupido/media-composer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import { mediaFilterCss, type MediaFilterId } from "@/lib/media-filters";
import { createPost } from "@/lib/posts";
import { compressImageFile, isVideoFile, readVideoDuration, safeExtension, videoContentType, videoFileExtension } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message || fallback;
  if (value && typeof value === "object" && "message" in value) {
    const message = String((value as { message?: unknown }).message ?? "");
    if (message) return message;
  }
  return fallback;
}

function matchesVideos(path: string) {
  return path.startsWith("/videos");
}

function matchesDiscover(path: string) {
  return path.startsWith("/muro") || path.startsWith("/historia") || path.startsWith("/comunidad") || path.startsWith("/descubrir") || path.startsWith("/siguiendo");
}

function matchesMessages(path: string) {
  return path.startsWith("/chat") || path.startsWith("/llamadas");
}

function matchesProfile(path: string) {
  return path === "/" || path.startsWith("/perfil") || path.startsWith("/tienda");
}

const NAV_ITEMS = [
  { to: "/videos", label: "Videos", icon: Clapperboard, isActive: matchesVideos },
  { to: "/descubrir", label: "Descubrir", icon: Compass, isActive: matchesDiscover },
  { to: "/chat", label: "Mensajes", icon: MessageCircle, isActive: matchesMessages },
  { to: "/perfil", label: "Perfil", icon: UserRound, isActive: matchesProfile },
] as const;

const SHORTCUTS = [
  { to: "/muro", label: "Muro", match: (path: string) => path.startsWith("/muro") },
  { to: "/historia", label: "Historias", match: (path: string) => path.startsWith("/historia") },
  { to: "/descubrir", label: "Conexiones", match: (path: string) => path.startsWith("/comunidad") || path.startsWith("/descubrir") || path.startsWith("/siguiendo") },
] as const;

export function RouteShortcuts() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  let links: ReadonlyArray<{ to: string; label: string; match: (path: string) => boolean }> = [];

  if (matchesDiscover(pathname)) {
    links = SHORTCUTS;
  } else if (matchesMessages(pathname)) {
    links = [
      { to: "/chat", label: "Chats", match: (path) => path.startsWith("/chat") },
      { to: "/llamadas", label: "Llamadas", match: (path) => path.startsWith("/llamadas") },
    ];
  } else if (matchesProfile(pathname)) {
    links = [
      { to: "/perfil", label: "Perfil", match: (path) => path.startsWith("/perfil") },
      { to: "/tienda", label: "Monedas", match: (path) => path.startsWith("/tienda") },
      { to: "/", label: "Cupido Studio", match: (path) => path === "/" },
    ];
  }

  if (!links.length || matchesVideos(pathname) || pathname.startsWith("/directo")) return null;

  return (
    <nav aria-label="Secciones" translate="no" className="select-none flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-white/[0.06] bg-background px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:justify-center">
      {links.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-9 shrink-0 items-center justify-center rounded-full px-4 text-xs font-semibold transition active:scale-[0.98] ${active ? "bg-amber-300/15 text-amber-100 ring-1 ring-amber-200/20" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [draft, setDraft] = useState<{ file: File; filter: MediaFilterId } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const unread = useQuery({
    queryKey: ["cupido-unread-messages", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { rpc: (name: string) => Promise<{ data: number | null; error: { message: string } | null }> })
        .rpc("cupido_unread_message_count");
      if (error) throw error;
      return data ?? 0;
    },
  });
  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase.channel((`cupido-unread-badge-${viewerId}`) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_messages" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-unread-messages", viewerId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, viewerId]);

  useEffect(() => {
    if (!draft) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(draft.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  const handlePick = (file: File, filter: MediaFilterId) => {
    setDraft({ file, filter });
  };

  const handlePublish = async () => {
    if (!viewerId) {
      setCreateOpen(false);
      toast.error("Inicia sesión para publicar.");
      void navigate({ to: "/auth", search: { ref: "" } });
      return;
    }
    if (!draft) {
      toast.error("Elige una foto o un video primero.");
      return;
    }

    const file = draft.file;
    const isVideo = isVideoFile(file);
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      toast.error("Elige una foto o un video corto.");
      return;
    }
    const extension = isVideo ? videoFileExtension(file) : safeExtension(file.name, isImage ? (file.type.split("/")[1] ?? "jpg").replace(/^jpeg$/, "jpg") : "").toLowerCase();
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "heic", "avif"];
    if (!isVideo && !imageExtensions.includes(extension)) {
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
      const contentType = isVideo ? videoContentType(uploadFile, finalExtension) : uploadFile.type || "image/jpeg";
      let uploadResult = await supabase.storage.from("cupido-media").upload(path, uploadFile, { contentType, upsert: true });
      if (uploadResult.error) {
        uploadedBucket = "media";
        uploadResult = await supabase.storage.from("media").upload(path, uploadFile, { contentType, upsert: true });
      }
      if (uploadResult.error) throw uploadResult.error;
      uploadedPath = path;
      const { data: publicData } = supabase.storage.from(uploadedBucket).getPublicUrl(path);
      const url = publicData?.publicUrl ?? "";
      if (!url) throw new Error("No se pudo obtener la URL pública del archivo.");
      await createPost({ userId: viewerId, caption, url, isVideo, kind: isVideo ? "video" : "photo", filterName: draft.filter });
      setCaption("");
      setDraft(null);
      toast.success(isVideo ? "Video publicado en tu muro ❤️" : "Foto publicada en tu muro ❤️");
      await queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      await queryClient.invalidateQueries({ queryKey: ["cupido-profile-posts"] });
      setCreateOpen(false);
    } catch (error) {
      if (uploadedPath) void supabase.storage.from(uploadedBucket).remove([uploadedPath]);
      toast.error(errorMessage(error, "No se pudo publicar. Inténtalo de nuevo."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <nav
        aria-label="Navegación principal"
        translate="no"
        className="fixed inset-x-0 bottom-0 z-40 select-none border-t border-white/10 bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_36px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:hidden"
      >
        <div className="mx-auto grid h-16 max-w-xl grid-cols-5 items-center px-2">
          {NAV_ITEMS.slice(0, 2).map((item) => {
            const Icon = item.icon;
            const active = item.isActive(pathname);
            return <NavigationItem key={item.to} to={item.to} label={item.label} active={active} Icon={Icon} />;
          })}

          <button
            type="button"
            aria-label="Crear publicación"
            aria-haspopup="dialog"
            aria-expanded={createOpen}
            onClick={() => setCreateOpen(true)}
            className="mx-auto flex size-12 -translate-y-2 items-center justify-center rounded-2xl border-4 border-background bg-gradient-to-br from-rose-500 via-pink-500 to-amber-300 text-white shadow-[0_0_24px_rgba(244,63,94,0.35)] transition active:scale-95"
          >
            <Plus className="size-6 stroke-[2.75]" />
          </button>

          {NAV_ITEMS.slice(2).map((item) => {
            const Icon = item.icon;
            const active = item.isActive(pathname);
            return (
              <NavigationItem
                key={item.to}
                to={item.to}
                label={item.label}
                active={active}
                Icon={Icon}
                unread={item.label === "Mensajes" ? unread.data ?? 0 : 0}
              />
            );
          })}
        </div>
      </nav>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent translate="no" className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] top-auto left-3 h-auto max-h-[45vh] w-auto max-w-none translate-x-0 translate-y-0 overflow-y-auto overscroll-contain rounded-[1.75rem] border-amber-200/15 bg-gradient-to-b from-[#211710] via-[#17130f] to-[#17130f] p-5 text-white sm:inset-x-auto sm:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] sm:left-1/2 sm:top-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:translate-y-0">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-lg text-white">Crear en Cupido</DialogTitle>
            <DialogDescription>Publica al instante o elige una experiencia.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Label className="text-xs text-amber-100/90">Vista previa</Label>
                <span className="text-[11px] text-muted-foreground">Foto o video hasta 30 s</span>
              </div>
              <MediaComposer disabled={uploading} onFile={handlePick} galleryLabel="Elegir foto o video" />
              {draft && previewUrl ? (
                <div className="mt-3 overflow-hidden rounded-2xl border border-pink-300/15 bg-black/40">
                  {isVideoFile(draft.file) ? (
                    <video src={previewUrl} controls playsInline className="max-h-64 w-full object-contain" style={{ filter: mediaFilterCss(draft.filter) }} />
                  ) : (
                    <img src={previewUrl} alt="Vista previa de tu publicación" className="max-h-64 w-full object-contain" style={{ filter: mediaFilterCss(draft.filter) }} />
                  )}
                  <p className="truncate px-3 py-2 text-[11px] text-white/70">{draft.file.name}</p>
                </div>
              ) : (
                <div className="mt-3 grid h-32 place-items-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center text-xs text-muted-foreground">
                  Elige un archivo para verlo aquí antes de publicar.
                </div>
              )}
              <Textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Escribe un mensaje para tu publicación…"
                className="mt-3 min-h-20 resize-none"
                disabled={uploading}
              />
              <Button type="button" variant="hero" className="mt-2 w-full" disabled={uploading || !draft} onClick={() => void handlePublish()}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                {uploading ? "Publicando…" : "Publicar ahora"}
              </Button>
            </div>
            <Button type="button" variant="glass" className="w-full justify-start" onClick={() => { setCreateOpen(false); setRewardOpen(true); }}>
              <Coins className="size-5 text-amber-200" />
              <span className="min-w-0"><span className="block text-sm font-semibold">Ganar 15 monedas</span><span className="block text-xs text-muted-foreground">Ver un anuncio patrocinado</span></span>
            </Button>
          </div>

          <div className="my-1 h-px bg-white/10" />
          <div className="grid gap-2">
            <CreateAction to="/muro" label="Subir desde el muro" description="Más opciones para publicar" icon={Video} onSelect={() => setCreateOpen(false)} />
            <CreateAction to="/historia" label="Historia 24h" description="Foto, video o estado con emojis" icon={Clapperboard} onSelect={() => setCreateOpen(false)} />
            <CreateAction to="/directo" label="Iniciar Live" description="Transmite en vivo con tu comunidad" icon={Radio} onSelect={() => setCreateOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>
      <AdRewardDialog open={rewardOpen} onOpenChange={setRewardOpen} onRewarded={() => void queryClient.invalidateQueries()} />
    </>
  );
}

function NavigationItem({
  to,
  label,
  active,
  Icon,
  unread = 0,
}: {
  to: string;
  label: string;
  active: boolean;
  Icon: typeof Compass;
  unread?: number;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-active={active}
      className={`relative flex min-h-14 select-none flex-col items-center justify-center gap-1 px-1 py-1 text-center text-[10px] font-semibold transition active:scale-95 ${active ? "text-amber-200" : "text-slate-400 hover:text-white"}`}
    >
      {active && <span className="absolute -top-px h-0.5 w-9 rounded-full bg-amber-300" />}
      <span className="relative">
        <Icon className={`size-[21px] ${active ? "drop-shadow-[0_0_8px_rgba(252,211,77,0.45)]" : ""}`} />
        {unread > 0 && <span aria-label={`${unread} mensajes sin leer`} className="absolute -right-3 -top-2 flex min-h-4 min-w-4 items-center justify-center rounded-full border border-background bg-rose-500 px-1 text-[9px] font-bold leading-none text-white">{unread}</span>}
      </span>
      {label}
    </Link>
  );
}

function CreateAction({
  to,
  label,
  description,
  icon: Icon,
  onSelect,
}: {
  to: string;
  label: string;
  description: string;
  icon: typeof Video;
  onSelect: () => void;
}) {
  return (
    <Link to={to} onClick={onSelect} className="flex select-none items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3.5 text-left transition active:scale-[0.99] active:bg-white/[0.08]">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-rose-500/20 to-amber-300/20 text-amber-100"><Icon className="size-5" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold text-white">{label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{description}</span></span>
    </Link>
  );
}
