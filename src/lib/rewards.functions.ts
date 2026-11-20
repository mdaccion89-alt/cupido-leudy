import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { getAdminClient } from "@/lib/server-helpers";

type Db = SupabaseClient<Database>;

const DAILY_REWARDS = [10, 20, 30, 40, 100] as const;
const AD_REWARD = 25;
export const ROULETTE_PRIZES = [10, 25, 0, 50, 15, 0, 30, 100] as const;

function dayKey(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function alreadyClaimed(admin: Db, userId: string, rewardType: string, key: string): Promise<boolean> {
  const { data } = await admin
    .from("cupido_reward_claims")
    .select("id")
    .eq("user_id", userId)
    .eq("reward_type", rewardType)
    .eq("claim_key", key)
    .maybeSingle();
  return Boolean(data);
}

async function recordClaim(admin: Db, userId: string, rewardType: string, key: string): Promise<void> {
  const { error } = await admin.from("cupido_reward_claims").insert({ user_id: userId, reward_type: rewardType, claim_key: key });
  if (error) throw error;
}

export const claimDailyReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { day: number }) => ({ day: Math.min(5, Math.max(1, Math.trunc(input?.day ?? 0))) }))
  .handler(async ({ data, context }) => {
    const admin = await getAdminClient();
    const rewardType = `daily-${data.day}`;
    const key = dayKey();
    if (await alreadyClaimed(admin, context.userId, rewardType, key)) throw new Error("Ya reclamaste el premio de hoy.");
    if (data.day > 1 && !(await alreadyClaimed(admin, context.userId, `daily-${data.day - 1}`, dayKey(-1))))
      throw new Error("Reclama primero el premio del día anterior.");
    await recordClaim(admin, context.userId, rewardType, key);
    const amount = DAILY_REWARDS[data.day - 1] ?? 0;
    await admin.rpc("grant_credits", {
      _user_id: context.userId,
      _amount: amount,
      _reason: `Premio diario Cupido Leudy · día ${data.day}`,
    });
    return { awarded: amount, day: data.day };
  });

export const claimAdReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdminClient();
    const key = String(Math.floor(Date.now() / 300_000));
    if (await alreadyClaimed(admin, context.userId, "ad", key)) throw new Error("Ya viste un anuncio hace poco. Vuelve en unos minutos.");
    await recordClaim(admin, context.userId, "ad", key);
    await admin.rpc("grant_credits", {
      _user_id: context.userId,
      _amount: AD_REWARD,
      _reason: "Recompensa por anuncio · Cupido Leudy",
    });
    return { awarded: AD_REWARD };
  });

export const spinCafeRoulette = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdminClient();
    const key = String(Math.floor(Date.now() / 3_600_000));
    if (await alreadyClaimed(admin, context.userId, "roulette", key)) throw new Error("La ruleta se reinicia cada hora.");
    const index = Math.floor(Math.random() * ROULETTE_PRIZES.length);
    const amount = ROULETTE_PRIZES[index] ?? 0;
    await recordClaim(admin, context.userId, "roulette", key);
    if (amount > 0)
      await admin.rpc("grant_credits", {
        _user_id: context.userId,
        _amount: amount,
        _reason: `Ruleta Café Cupido Leudy · premio ${amount}`,
      });
    return { awarded: amount, index };
  });

export const cupidoRewards = { DAILY_REWARDS, AD_REWARD, ROULETTE_PRIZES };
