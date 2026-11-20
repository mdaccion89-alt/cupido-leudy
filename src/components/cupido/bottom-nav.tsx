import { Link, useRouterState } from "@tanstack/react-router";
import { Compass, MessageCircle, Phone, UserRound, Users } from "lucide-react";

const TABS = [
  { to: "/llamadas", label: "Llamar", icon: Phone, match: (path: string) => path.startsWith("/llamadas") },
  { to: "/comunidad", label: "Descubrir", icon: Compass, match: (path: string) => path.startsWith("/comunidad") },
  { to: "/siguiendo", label: "Siguiendo", icon: Users, match: (path: string) => path.startsWith("/siguiendo") },
  { to: "/chat", label: "Mensajes", icon: MessageCircle, match: (path: string) => path.startsWith("/chat") },
  { to: "/perfil", label: "Perfil", icon: UserRound, match: (path: string) => path.startsWith("/perfil") },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav
      aria-label="Navegación móvil principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#120b17]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={tab.label}
              data-active={active}
              className={`relative flex flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium transition ${
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
