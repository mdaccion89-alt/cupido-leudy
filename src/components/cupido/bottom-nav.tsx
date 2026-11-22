import { useEffect, useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Compass, Heart, MessageCircle, Phone, Radio, UserRound } from "lucide-react";
import { showInterstitialAd } from "@/lib/admob";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

const TABS = [
  { to: "/llamadas", label: "Llamar", icon: Phone, match: (path: string) => path.startsWith("/llamadas") },
  { to: "/directo", label: "Directo", icon: Radio, match: (path: string) => path.startsWith("/directo") },
  { to: "/comunidad", label: "Descubrir", icon: Compass, match: (path: string) => path.startsWith("/comunidad") },
  { to: "/muro", label: "Muro / Sugerencias", icon: Heart, match: (path: string) => path.startsWith("/muro") || path.startsWith("/siguiendo") },
  { to: "/videos", label: "Videos", icon: Clapperboard, match: (path: string) => path.startsWith("/videos") },
  { to: "/chat", label: "Mensajes", icon: MessageCircle, match: (path: string) => path.startsWith("/chat") },
  { to: "/perfil", label: "Perfil", icon: UserRound, match: (path: string) => path.startsWith("/perfil") },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const queryClient = useQueryClient();
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
  const previousPath = useRef(pathname);
  const tabChanges = useRef(0);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (!TABS.some((tab) => tab.match(pathname))) return;
    tabChanges.current += 1;
    if (tabChanges.current < 4) return;
    tabChanges.current = 0;
    void showInterstitialAd();
  }, [pathname]);

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase.channel(`cupido-unread-badge-${viewerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_messages" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-unread-messages", viewerId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, viewerId]);

  return (
    <nav
      aria-label="Navegación móvil principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-200/10 bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_36px_rgba(0,0,0,0.25)] backdrop-blur-xl"
    >
      <div className="mx-auto grid max-w-3xl grid-cols-7">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={tab.label}
              data-active={active}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[9px] font-semibold transition sm:text-[10px] ${
                active ? "text-pink-300" : "text-slate-400 hover:text-white"
              }`}
            >
              {active ? <span className="absolute -top-px h-0.5 w-10 rounded-full bg-pink-400" /> : null}
              <span className="relative">
                <Icon className={`size-5 ${active ? "fill-pink-400/20" : ""}`} />
                {tab.to === "/chat" && (unread.data ?? 0) > 0 && <span aria-label={`${unread.data} mensajes sin leer`} className="absolute -right-3 -top-2 flex min-h-4 min-w-4 items-center justify-center rounded-full border border-background bg-red-500 px-1 text-[9px] font-bold leading-none text-white">{unread.data}</span>}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
