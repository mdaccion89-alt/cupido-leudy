import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { getAdminClient } from "@/lib/server-helpers";
import {
  AD_LIMIT,
  AD_REWARD,
  DAILY_REWARDS,
  DAY_MS,
  HOUR_MS,
  ROULETTE_PRIZES,
  nextDailyDay,
} from "@/lib/rewards";

type Db = SupabaseClient<Database>;

function dayKey(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function recordClaim(admin: Db, userId: string, rewardType: string, key: string): Promise<void> {
  const { error } = await admin.from("cupido_reward_claims").insert({ user_id: userId, reward_type: rewardType, claim_key: key });
  if (error) throw error;
}

async function readRewardProfile(admin: Db, userId: string) {
  const { data } = await admin
    .from("profiles")
    .select("daily_streak,last_daily_claim,last_wheel_spin")
    .eq("id", userId)
    .maybeSingle();
  return {
    streak: Math.max(0, data?.daily_streak ?? 0),
    lastDaily: data?.last_daily_claim ? Date.parse(data.last_daily_claim) : 0,
    lastWheel: data?.last_wheel_spin ? Date.parse(data.last_wheel_spin) : 0,
  };
}

async function creditCoins(admin: Db, userId: string, amount: number, reason: string): Promise<void> {
  if (amount <= 0) return;
  const { data: existing } = await admin
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  const current = existing?.balance ?? 0;
  const balance = current === -1 ? -1 : current + amount;
  const now = new Date().toISOString();

  if (existing) {
    const { error } = await admin
      .from("user_credits")
      .update({ balance, updated_at: now })
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await admin
      .from("user_credits")
      .insert({ user_id: userId, balance: amount, daily_reset_at: now, updated_at: now });
    if (error) throw error;
  }

  const { error: transactionError } = await admin
    .from("credit_transactions")
    .insert({ user_id: userId, delta: amount, reason });
  if (transactionError) throw transactionError;
}

export const claimDailyReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { day: number }) => ({ day: Math.min(5, Math.max(1, Math.trunc(input?.day ?? 0))) }))
  .handler(async ({ data, context }) => {
    const admin = await getAdminClient();
    const profile = await readRewardProfile(admin, context.userId);
    const now = Date.now();

    if (profile.lastDaily && now - profile.lastDaily < DAY_MS) {
      throw new Error("Ya reclamaste hoy. Vuelve en 24 horas ❤️");
    }

    const day = nextDailyDay(profile.streak, profile.lastDaily, now);
    if (day !== data.day) throw new Error(`Tu premio disponible es el día ${day}.`);

    const amount = DAILY_REWARDS[day - 1] ?? 0;
    const { error: profileError } = await admin
      .from("profiles")
      .update({ daily_streak: day, last_daily_claim: new Date(now).toISOString() })
      .eq("id", context.userId);
    if (profileError) throw profileError;

    await recordClaim(admin, context.userId, `daily-${day}`, dayKey());
    await creditCoins(admin, context.userId, amount, `Premio diario Cupido Leudy · día ${day}`);
    return { awarded: amount, day, streak: day };
  });

export const claimAdReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdminClient();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count, error: countError } = await admin
      .from("cupido_reward_claims")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("reward_type", "ad")
      .gte("created_at", startOfDay.toISOString());
    if (countError) throw countError;

    const watched = count ?? 0;
    if (watched >= AD_LIMIT) throw new Error("Ya viste los 5 anuncios de hoy. Vuelve mañana ❤️");

    await recordClaim(admin, context.userId, "ad", `${dayKey()}-${Date.now()}`);
    await creditCoins(admin, context.userId, AD_REWARD, "Recompensa por anuncio · Cupido Leudy");
    return { awarded: AD_REWARD, remaining: AD_LIMIT - watched - 1 };
  });

export const spinCafeRoulette = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdminClient();
    const profile = await readRewardProfile(admin, context.userId);
    const now = Date.now();

    if (profile.lastWheel && now - profile.lastWheel < HOUR_MS) {
      const minutes = Math.ceil((HOUR_MS - (now - profile.lastWheel)) / 60_000);
      throw new Error(`La ruleta se reinicia en ${minutes} min ☕`);
    }

    const index = Math.floor(Math.random() * ROULETTE_PRIZES.length);
    const amount = ROULETTE_PRIZES[index] ?? 0;
    const { error: profileError } = await admin
      .from("profiles")
      .update({ last_wheel_spin: new Date(now).toISOString() })
      .eq("id", context.userId);
    if (profileError) throw profileError;

    await recordClaim(admin, context.userId, "roulette", `${dayKey()}-${now}`);
    await creditCoins(admin, context.userId, amount, `Ruleta Café Cupido Leudy · premio ${amount}`);
    return { awarded: amount, index };
  });

export const cupidoRewards = { DAILY_REWARDS, AD_REWARD, ROULETTE_PRIZES };
