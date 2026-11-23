import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Compass, MessageCircle, Plus, Radio, UserRound, Video } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

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
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
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
        <DialogContent translate="no" className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] top-auto left-3 w-auto max-w-none translate-x-0 translate-y-0 rounded-3xl border-amber-200/15 bg-[#17130f] p-5 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-lg text-white">Crear en Cupido</DialogTitle>
            <DialogDescription>Comparte algo nuevo o saluda en directo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <CreateAction to="/muro" label="Subir video" description="Publica un video en tu muro" icon={Video} onSelect={() => setCreateOpen(false)} />
            <CreateAction to="/historia" label="Historia 24h" description="Foto, video o estado con emojis" icon={Clapperboard} onSelect={() => setCreateOpen(false)} />
            <CreateAction to="/directo" label="Iniciar Live" description="Transmite en vivo con tu comunidad" icon={Radio} onSelect={() => setCreateOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>
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
