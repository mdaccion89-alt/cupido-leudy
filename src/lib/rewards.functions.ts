import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AD_REWARD, DAILY_REWARDS } from "@/lib/rewards";

function readRewardResult(value: unknown): { awarded: number; day: number; streak: number; balance: number } {
  if (!value || typeof value !== "object") throw new Error("Supabase no confirmó la recompensa.");
  const result = value as Record<string, unknown>;
  const awarded = Number(result["awarded"]);
  const day = Number(result["day"]);
  const streak = Number(result["streak"]);
  const balance = Number(result["balance"]);
  if (![awarded, day, streak, balance].every(Number.isFinite)) {
    throw new Error("Supabase no confirmó la recompensa.");
  }
  return { awarded, day, streak, balance };
}

export const claimDailyReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("cupido_claim_daily_reward");
    if (error) {
      if (error.message.includes("DAILY_REWARD_ALREADY_CLAIMED")) {
        throw new Error("Ya reclamaste tu premio. Vuelve en 24 horas ❤️");
      }
      throw new Error(error.message || "No se pudo reclamar el premio diario.");
    }
    return readRewardResult(data);
  });

export const cupidoRewards = { DAILY_REWARDS, AD_REWARD };
