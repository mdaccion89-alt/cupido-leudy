import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Coins, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { DAILY_REWARDS, DAY_MS, formatCountdown, nextDailyDay } from "@/lib/rewards";
import { claimDailyReward } from "@/lib/rewards.functions";

export function DailyReward() {
  const account = useAccount();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [claiming, setClaiming] = useState(false);
  const claimDaily = useServerFn(claimDailyReward);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const claim = async () => {
    if (!session?.user.id) {
      toast.error("Inicia sesión para reclamar tu premio diario.");
      return;
    }
    const lastClaim = account.lastDailyClaim ? Date.parse(account.lastDailyClaim) : 0;
    const nextDay = nextDailyDay(account.dailyStreak, lastClaim, Date.now());
    setClaiming(true);
    try {
      const result = await claimDaily({ data: { day: nextDay } });
      toast.success(`Día ${result.day}: +${result.awarded} monedas brillantes ✨`);
      void queryClient.invalidateQueries({ queryKey: ["account"] });
      account.refresh();
      setNow(Date.now());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo reclamar el premio.");
    } finally {
      setClaiming(false);
    }
  };

  const lastClaim = account.lastDailyClaim ? Date.parse(account.lastDailyClaim) : 0;
  const waitingMs = Math.max(0, lastClaim + DAY_MS - now);
  const locked = waitingMs > 0 || claiming;
  const nextDay = nextDailyDay(account.dailyStreak, lastClaim, now);

  return (
    <section className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
      <div className="flex items-center gap-2">
        <Gift className="size-4 text-amber-200" />
        <p className="text-sm font-medium text-white">Premio diario · 5 días</p>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {DAILY_REWARDS.map((amount, index) => {
          const day = index + 1;
          const done = day <= account.dailyStreak && day !== nextDay;
          return (
            <div
              key={day}
              className={`rounded-xl border px-1 py-2 text-center text-[11px] ${
                done
                  ? "border-amber-300/40 bg-amber-400/15 text-amber-100"
                  : day === nextDay
                    ? "border-amber-300/60 bg-amber-400/10 text-amber-100"
                    : "border-white/10 text-muted-foreground"
              }`}
            >
              <p className="font-display text-sm text-amber-200">+{amount}</p>
              <p>Día {day}</p>
            </div>
          );
        })}
      </div>
      <Button className="mt-3 w-full gap-2" disabled={locked} onClick={() => void claim()}>
        {claiming ? <Loader2 className="size-4 animate-spin" /> : <Coins className="size-4" />}
        {claiming
          ? "Reclamando…"
          : locked
            ? `Vuelve en ${formatCountdown(waitingMs)} ❤️`
            : `Reclamar día ${nextDay}`}
      </Button>
    </section>
  );
}
