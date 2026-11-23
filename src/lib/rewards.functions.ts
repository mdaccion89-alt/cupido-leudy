import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/server-helpers";
import { AD_LIMIT, AD_REWARD, DAILY_REWARDS } from "@/lib/rewards";

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

export const claimAdReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdminClient();
    const { data, error } = await admin.rpc("cupido_claim_ad_reward", { _user_id: context.userId });
    if (error) {
      if (error.message.includes("AD_REWARD_DAILY_LIMIT")) {
        throw new Error("Ya viste los 5 anuncios de hoy. Vuelve mañana ❤️");
      }
      throw new Error(error.message || "No se pudo acreditar la recompensa del anuncio.");
    }
    const result = readRewardResult(data);
    if (result.awarded !== AD_REWARD) throw new Error("El premio del anuncio no coincide con las monedas anunciadas.");
    const claimed = data && typeof data === "object" && "claimed" in data
      ? Number((data as { claimed: unknown }).claimed)
      : AD_LIMIT;
    return { awarded: AD_REWARD, remaining: Math.max(0, AD_LIMIT - claimed) };
  });

export const cupidoRewards = { DAILY_REWARDS, AD_REWARD };
