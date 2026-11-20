import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { claimDailyReward, cupidoRewards } from "@/lib/rewards.functions";
import { supabase } from "@/integrations/supabase/client";

export function DailyReward() {
  const account = useAccount();
  const claim = useServerFn(claimDailyReward);
  const queryClient = useQueryClient();
  const claims = useQuery({
    queryKey: ["cupido-daily-rewards", account.userId],
    enabled: Boolean(account.userId),
    queryFn: async () => {
      const { data } = await supabase
        .from("cupido_reward_claims")
        .select("reward_type")
        .eq("user_id", account.userId!)
        .like("reward_type", "daily-%");
      return new Set((data ?? []).map((row) => row.reward_type));
    },
  });

  const mutation = useMutation({
    mutationFn: (day: number) => claim({ data: { day } }),
    onSuccess: (result) => {
      toast.success(`Día ${result.day}: +${result.awarded} monedas brillantes ✨`);
      void queryClient.invalidateQueries({ queryKey: ["cupido-daily-rewards"] });
      account.refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo reclamar."),
  });

  const claimed = claims.data ?? new Set<string>();
  const nextDay = cupidoRewards.DAILY_REWARDS.findIndex((_, index) => !claimed.has(`daily-${index + 1}`)) + 1;

  return (
    <section className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
      <div className="flex items-center gap-2">
        <Gift className="size-4 text-amber-200" />
        <p className="text-sm font-medium text-white">Premio diario · 5 días</p>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {cupidoRewards.DAILY_REWARDS.map((amount, index) => {
          const day = index + 1;
          const done = claimed.has(`daily-${day}`);
          return (
            <div
              key={day}
              className={`rounded-xl border px-1 py-2 text-center text-[11px] ${
                done
                  ? "border-amber-300/40 bg-amber-400/15 text-amber-100"
                  : "border-white/10 text-muted-foreground"
              }`}
            >
              <p className="font-display text-sm text-amber-200">+{amount}</p>
              <p>Día {day}</p>
            </div>
          );
        })}
      </div>
      <Button
        className="mt-3 w-full gap-2"
        disabled={!nextDay || mutation.isPending}
        onClick={() => nextDay && mutation.mutate(nextDay)}
      >
        {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Coins className="size-4" />}
        {nextDay ? `Reclamar día ${nextDay}` : "Vuelve mañana ❤️"}
      </Button>
    </section>
  );
}
