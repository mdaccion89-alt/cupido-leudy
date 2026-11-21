import { Link, useRouterState } from "@tanstack/react-router";
import { Compass, Heart, MessageCircle, Phone, UserRound } from "lucide-react";

const TABS = [
  { to: "/llamadas", label: "Llamar", icon: Phone, match: (path: string) => path.startsWith("/llamadas") },
  { to: "/comunidad", label: "Descubrir", icon: Compass, match: (path: string) => path.startsWith("/comunidad") },
  { to: "/muro", label: "Muro / Sugerencias", icon: Heart, match: (path: string) => path.startsWith("/muro") || path.startsWith("/siguiendo") },
  { to: "/chat", label: "Mensajes", icon: MessageCircle, match: (path: string) => path.startsWith("/chat") },
  { to: "/perfil", label: "Perfil", icon: UserRound, match: (path: string) => path.startsWith("/perfil") },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav
      aria-label="Navegación móvil principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-200/10 bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_36px_rgba(0,0,0,0.25)] backdrop-blur-xl"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-5">
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
              <Icon className={`size-5 ${active ? "fill-pink-400/20" : ""}`} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
