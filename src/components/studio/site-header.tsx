import { Link } from "@tanstack/react-router";
import { Heart, Infinity as InfinityIcon } from "lucide-react";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { NotificationBell } from "@/components/cupido/notification-bell";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { useAppLogo } from "@/lib/app-logo";

export function SiteHeader() {
  const { session, loading } = useAuth();
  const account = useAccount();
  const appLogo = useAppLogo();

  return (
    <header translate="no" className="z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 select-none items-center border-b border-amber-200/10 bg-background/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-8">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between gap-3">
        <Link to="/" className="flex min-w-0 items-center gap-2" aria-label="Cupido Leudy, inicio">
          <span className="brand-heart grid size-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-primary shadow-glow sm:size-10 sm:rounded-2xl">
            {appLogo ? <img src={appLogo} alt="" className="size-full object-contain" /> : <Heart className="size-5 fill-primary-foreground text-primary-foreground" />}
          </span>
          <span className="truncate font-display text-sm font-semibold tracking-tight text-gradient sm:text-base">
            Cupido Leudy <span aria-hidden="true">❤️</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {!loading && session ? (
            <>
              <Button
                asChild
                variant="glass"
                className="h-10 gap-1.5 rounded-full border-amber-300/40 bg-amber-400/10 px-3 text-xs font-semibold text-amber-100 shadow-[0_0_24px_rgba(251,191,36,0.12)] hover:bg-amber-400/15"
                title="Saldo de monedas brillantes"
              >
                <Link to="/tienda">
                  <CoinIcon className="size-4" />
                  <span>{account.loading ? "..." : account.balanceUnavailable ? "—" : account.isInfiniteCreditsAdmin ? "∞" : account.balance.toLocaleString("es")}</span>
                  {account.isInfiniteCreditsAdmin && <InfinityIcon className="size-3.5" />}
                </Link>
              </Button>
              <NotificationBell />
            </>
          ) : !loading ? (
            <Button asChild variant="glass" size="sm" className="select-none rounded-full">
              <Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
