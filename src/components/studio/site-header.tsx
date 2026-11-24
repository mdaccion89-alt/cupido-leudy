import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Heart, Infinity as InfinityIcon, LogOut, Settings2, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { NotificationBell } from "@/components/cupido/notification-bell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { useAppLogo, useBrandEffect } from "@/lib/app-logo";

export function SiteHeader() {
  const { session, loading } = useAuth();
  const account = useAccount();
  const appLogo = useAppLogo();
  const brandEffect = useBrandEffect();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const signOut = async () => {
    await supabase.removeAllChannels();
    const { error } = await supabase.auth.signOut();
    if (error) { toast.error(error.message || "No se pudo cerrar la sesión."); return; }
    queryClient.clear();
    setSettingsOpen(false);
    await navigate({ to: "/auth", search: { ref: "" } });
  };

  return (
    <header translate="no" className="z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 select-none items-center border-b border-amber-200/10 bg-background/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-8">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between gap-3">
        <Link to="/" className="flex min-w-0 items-center gap-2" aria-label="Cupido Leudy, inicio">
          <span className="brand-heart grid size-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-primary shadow-glow sm:size-10 sm:rounded-2xl">
            {appLogo ? <img src={appLogo} alt="" className="brand-logo-breathe size-full object-contain" /> : <Heart className="brand-logo-breathe size-5 fill-primary-foreground text-primary-foreground" />}
          </span>
          <span data-brand-effect={brandEffect} data-label="Cupido Leudy ❤️" className={`app-name-effect app-name-effect--${brandEffect} truncate font-display text-sm font-semibold tracking-tight sm:text-base`}>
            Cupido Leudy <span aria-hidden="true">❤️</span>
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1.5">
          {!loading && session ? (
            <>
              <Button asChild variant="glass" className="h-10 gap-1.5 rounded-full border-amber-300/40 bg-amber-400/10 px-3 text-xs font-semibold text-amber-100 shadow-[0_0_24px_rgba(251,191,36,0.12)] hover:bg-amber-400/15" title="Saldo de monedas brillantes">
                <Link to="/tienda">
                  <CoinIcon className="size-4" />
                  <span>{account.loading ? "..." : account.balanceUnavailable ? "—" : account.isInfiniteCreditsAdmin ? "∞" : account.balance.toLocaleString("es")}</span>
                  {account.isInfiniteCreditsAdmin && <InfinityIcon className="size-3.5" />}
                </Link>
              </Button>
              <NotificationBell />
              <Button type="button" variant="glass" size="icon" aria-label="Opciones y configuración" onClick={() => setSettingsOpen(true)} className="size-10 shrink-0 rounded-full border-white/10">
                <Settings2 className="size-4" />
              </Button>
            </>
          ) : !loading ? (
            <Button asChild variant="glass" size="sm" className="select-none rounded-full">
              <Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="bottom" className="max-h-[78dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-white/10 bg-zinc-950 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-white">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 font-display text-white"><Settings2 className="size-5 text-pink-300" /> Opciones de Cupido</SheetTitle>
            <SheetDescription>Cuenta, privacidad y seguridad en un solo lugar.</SheetDescription>
          </SheetHeader>
          <nav className="mt-4 grid gap-2">
            <Link to="/ajustes" onClick={() => setSettingsOpen(false)} className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 px-4 text-sm hover:bg-white/5"><UserRound className="size-4 text-pink-200" /> Cuenta y preferencias</Link>
            <Link to="/perfil" onClick={() => setSettingsOpen(false)} className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 px-4 text-sm hover:bg-white/5"><ShieldCheck className="size-4 text-sky-200" /> Verificación de perfil</Link>
            <Link to="/ajustes" onClick={() => setSettingsOpen(false)} className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 px-4 text-sm hover:bg-white/5">Privacidad y notificaciones</Link>
            <Link to="/legal" onClick={() => setSettingsOpen(false)} className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 px-4 text-sm hover:bg-white/5">Políticas y condiciones</Link>
            <Button type="button" variant="ghost" onClick={() => void signOut()} className="mt-2 min-h-12 justify-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 text-rose-200 hover:bg-rose-500/20 hover:text-rose-100"><LogOut className="size-4" /> Cerrar sesión</Button>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
