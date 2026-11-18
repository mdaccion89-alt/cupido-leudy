// Helpers used only inside server function handlers. Secrets are read per call, never at module scope.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Db = SupabaseClient<Database>;

export async function getAdminClient(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Db;
}

export async function refundOnce(admin: Db, songId: string, userId: string) {
  const { data } = await admin
    .from("songs")
    .update({ credits_refunded: true })
    .eq("id", songId)
    .eq("credits_refunded", false)
    .gt("credits_spent", 0)
    .select("credits_spent")
    .maybeSingle();
  if (data && data.credits_spent > 0) {
    await admin.rpc("grant_credits", { _user_id: userId, _amount: data.credits_spent, _reason: "Reembolso por creación fallida" });
  }
}

export async function failCreation(admin: Db, songId: string, userId: string, message: string) {
  await admin.from("songs").update({ status: "failed", error: message }).eq("id", songId);
  await refundOnce(admin, songId, userId);
}

export function falKey(): string | undefined {
  return process.env["FAL_KEY"];
}

export type FalSubmit = { request_id: string; status_url: string; response_url: string };

export async function falSubmit(model: string, input: Record<string, unknown>): Promise<FalSubmit> {
  const key = falKey();
  if (!key) throw new Error("FAL_NOT_CONFIGURED");
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("fal submit failed", res.status, text.slice(0, 500));
    throw new Error(`FAL_${res.status}`);
  }
  return JSON.parse(text) as FalSubmit;
}

export async function falGet(url: string): Promise<{ status: number; body: unknown }> {
  const key = falKey();
  if (!key) throw new Error("FAL_NOT_CONFIGURED");
  const res = await fetch(url, { headers: { Authorization: `Key ${key}` } });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body };
}

export async function falWait(responseUrl: string, timeoutMs = 180_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status, body } = await falGet(responseUrl);
    if (status === 200) return body;
    if (status >= 400) throw new Error(`FAL_${status}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("FAL_TIMEOUT");
}

export function falErrorMessage(code: string): string {
  if (code === "FAL_NOT_CONFIGURED") return "Esta función aún no está configurada. El administrador debe añadir la clave de Fal.ai.";
  if (code === "FAL_TIMEOUT") return "La generación tardó demasiado. Inténtalo de nuevo.";
  if (code === "FAL_401" || code === "FAL_403") return "La clave de Fal.ai no es válida o no tiene permisos.";
  if (code === "FAL_402") return "La cuenta de Fal.ai no tiene saldo suficiente.";
  if (code === "FAL_422") return "Los archivos enviados no son válidos para este modelo.";
  if (code === "FAL_429") return "Fal.ai está ocupado. Inténtalo en unos minutos.";
  return "No se pudo iniciar la generación. Inténtalo de nuevo.";
}

/** Signed URL for a file the caller owns in a private bucket. */
export async function signOwnedPath(admin: Db, bucket: string, path: string, userId: string, seconds = 3600) {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) throw new Error("FORBIDDEN_PATH");
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data) throw new Error("SIGN_FAILED");
  return data.signedUrl;
}
