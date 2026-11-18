import { useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BadgeCheck,
  Crown,
  Infinity as InfinityIcon,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccount, useSiteSettings } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { Equalizer } from "./equalizer";

const NAV_LINKS = [
  { to: "/", label: "Estudio Musical", active: (path: string) => path === "/" },
  {
    to: "/video-studio",
    label: "Cine y Video IA",
    active: (path: string) => path.startsWith("/video-studio"),
  },
  {
    to: "/comunidad",
    label: "Comunidad",
    active: (path: string) => path.startsWith("/comunidad"),
  },
] as const;

export function SiteHeader() {
  const { session, loading } = useAuth();
  const { balance, nextReset, isAdmin, isOfficial, plan } = useAccount();
  const settings = useSiteSettings();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    const root = document.documentElement;
    if (/^#[0-9a-f]{6}$/i.test(settings.primary_color))
      root.style.setProperty("--primary", settings.primary_color);
    if (/^#[0-9a-f]{6}$/i.test(settings.accent_color))
      root.style.setProperty("--accent", settings.accent_color);
  }, [settings.primary_color, settings.accent_color]);

  const resetLabel = nextReset
    ? `Se renueva el ${new Date(nextReset).toLocaleDateString("es", { day: "numeric", month: "short" })}`
    : "5 créditos gratis cada 24 h";

  return (
    <header className="relative z-20 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-5 sm:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center overflow-hidden rounded-xl bg-gradient-primary shadow-glow">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt="" className="size-full object-cover" />
            ) : (
              <Equalizer bars={4} className="h-4 [&>span]:bg-primary-foreground [&>span]:bg-none" />
            )}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-display text-lg font-semibold tracking-tight">
              {settings.site_title}
            </span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              {settings.site_tagline}
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Navegación principal">
          {NAV_LINKS.map((item) => {
            const active = item.active(pathname);
            return (
              <Button
                asChild
                key={item.to}
                variant="ghost"
                size="sm"
                data-active={active}
                className={
                  active
                    ? "rounded-full border border-primary/40 bg-primary/15 text-foreground"
                    : "rounded-full border border-transparent text-muted-foreground hover:text-foreground"
                }
              >
                <Link to={item.to}>{item.label}</Link>
              </Button>
            );
          })}
        </nav>
      </div>
      {!loading &&
        (session ? (
          <div className="flex items-center gap-2">
            <span
              className="hidden items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary sm:inline-flex"
              title={resetLabel}
            >
              {isAdmin ? <InfinityIcon className="size-3.5" /> : <Crown className="size-3.5" />}
              {isAdmin ? "ILIMITADO" : `${balance} créditos`}
            </span>
            {(isOfficial || plan === "premium") && (
              <BadgeCheck className="size-5 text-primary" aria-label="Perfil oficial verificado" />
            )}
            <Button asChild variant="glass" size="icon" className="rounded-full">
              <Link to="/perfil" title="Mi perfil">
                <UserRound className="size-4" />
              </Link>
            </Button>
            {isAdmin && (
              <Button asChild variant="glass" size="icon" className="rounded-full">
                <Link to="/admin" title="Panel Admin Supremo">
                  <ShieldCheck className="size-4" />
                </Link>
              </Button>
            )}
            <span className="hidden max-w-[160px] truncate text-sm text-muted-foreground lg:block">
              {session.user.email}
            </span>
            <Button variant="glass" size="pill" onClick={() => supabase.auth.signOut()}>
              <LogOut /> Salir
            </Button>
          </div>
        ) : (
          <Button asChild variant="glass" size="pill">
            <Link to="/auth">Iniciar sesión</Link>
          </Button>
        ))}
    </header>
  );
}
