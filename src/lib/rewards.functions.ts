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

function rewardSessionId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("La sesión del anuncio no es válida.");
  }
  return value;
}

function rewardClaimKey(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("La clave de la recompensa no es válida.");
  }
  return value;
}

function readAdClaimResult(value: unknown): { awarded: number; balance: number; remaining: number } {
  if (!value || typeof value !== "object") throw new Error("Supabase no confirmó la recompensa.");
  const result = value as Record<string, unknown>;
  const awarded = Number(result["awarded"]);
  const balance = Number(result["balance"]);
  const remaining = Number(result["remaining"]);
  if (![awarded, balance, remaining].every(Number.isFinite)) {
    throw new Error("Supabase no confirmó la recompensa del anuncio.");
  }
  return { awarded, balance, remaining };
}

function rewardError(error: { message?: string } | null, fallback: string): never {
  const message = error?.message ?? fallback;
  if (message.includes("AD_REWARD_DAILY_LIMIT")) throw new Error("Ya viste los 5 anuncios de hoy. Vuelve mañana ❤️");
  if (message.includes("AD_REWARD_SESSION_NOT_FOUND")) throw new Error("No encontramos la sesión de este anuncio.");
  if (message.includes("AD_REWARD_SESSION_EXPIRED")) throw new Error("La sesión del anuncio venció. Vuelve a intentarlo.");
  if (message.includes("AD_REWARD_INVALID")) throw new Error("No pudimos validar la recompensa del anuncio.");
  if (message.includes("NOT_ALLOWED")) throw new Error("La recompensa requiere una confirmación segura de AdMob.");
  throw new Error(message || fallback);
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

export const startAdRewardSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdminClient();
    const { data, error } = await admin.rpc("cupido_admob_start_reward_session", { _user_id: context.userId });
    if (error) rewardError(error, "No se pudo preparar el anuncio recompensado.");
    if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>)["session_id"] !== "string") {
      throw new Error("El servidor no preparó una sesión válida para el anuncio.");
    }
    return {
      sessionId: rewardSessionId((data as Record<string, unknown>)["session_id"]),
      remaining: Math.max(0, Number((data as Record<string, unknown>)["remaining"] ?? AD_LIMIT)),
    };
  });

export const cancelAdRewardSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string }) => ({ sessionId: rewardSessionId(input?.sessionId) }))
  .handler(async ({ data, context }) => {
    const admin = await getAdminClient();
    const { error } = await admin.rpc("cupido_admob_cancel_reward_session", {
      _user_id: context.userId,
      _session_id: data.sessionId,
    });
    if (error) rewardError(error, "No se pudo cerrar la sesión del anuncio.");
    return { ok: true };
  });

export const claimAdReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string; claimKey: string }) => ({
    sessionId: rewardSessionId(input?.sessionId),
    claimKey: rewardClaimKey(input?.claimKey),
  }))
  .handler(async ({ data, context }) => {
    const admin = await getAdminClient();
    const { data: result, error } = await admin.rpc("cupido_admob_claim_client_reward", {
      _user_id: context.userId,
      _session_id: data.sessionId,
      _claim_key: data.claimKey,
    });
    if (error) rewardError(error, "No se pudo acreditar la recompensa del anuncio.");
    return readAdClaimResult(result);
  });

export const getAdRewardStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string }) => ({ sessionId: rewardSessionId(input?.sessionId) }))
  .handler(async ({ data, context }) => {
    const admin = await getAdminClient();
    const { data: result, error } = await admin.rpc("cupido_admob_reward_status", {
      _user_id: context.userId,
      _session_id: data.sessionId,
    });
    if (error) rewardError(error, "No se pudo confirmar la recompensa del anuncio.");
    if (!result || typeof result !== "object") throw new Error("Supabase no confirmó la recompensa del anuncio.");
    const status = String((result as Record<string, unknown>)["status"] ?? "unknown");
    const awarded = Number((result as Record<string, unknown>)["awarded"] ?? 0);
    return { status, awarded: Number.isFinite(awarded) ? awarded : 0 };
  });

export const cupidoRewards = { DAILY_REWARDS, AD_REWARD };
