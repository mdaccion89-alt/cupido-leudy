import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Coins, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { DAILY_REWARDS, DAY_MS, formatCountdown, nextDailyDay } from "@/lib/rewards";

export function DailyReward() {
  const account = useAccount();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const claim = async () => {
    if (!session?.user.id) {
      toast.error("Inicia sesión para reclamar tu premio diario.");
      return;
    }
    const claimedAt = new Date().toISOString();
    const nextDay = nextDailyDay(account.dailyStreak, account.lastDailyClaim ? Date.parse(account.lastDailyClaim) : 0, Date.now());
    const reward = DAILY_REWARDS[nextDay - 1] ?? 0;
    const currentBalance = account.balance === Infinity ? 0 : account.balance;
    setClaiming(true);
    const profileUpdate = {
      daily_streak: nextDay,
      last_daily_claim: claimedAt,
    };
    const db = supabase as unknown as { from: (table: string) => any };
    let { error } = await db
      .from("profiles")
      .update({ ...profileUpdate, credits_balance: currentBalance + reward })
      .eq("id", session.user.id);
    if (error) {
      ({ error } = await db
        .from("profiles")
        .update({ ...profileUpdate, credits: currentBalance + reward })
        .eq("id", session.user.id));
    }
    if (error) {
      toast.error(error.message);
      setClaiming(false);
      return;
    }
    toast.success(`Día ${nextDay}: +${reward} monedas brillantes ✨`);
    void queryClient.invalidateQueries({ queryKey: ["account"] });
    account.refresh();
    setNow(Date.now());
    setClaiming(false);
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
