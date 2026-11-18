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
    await admin.rpc("grant_credits", {
      _user_id: userId,
      _amount: data.credits_spent,
      _reason: "Reembolso por creación fallida",
    });
  }
}

export async function failCreation(admin: Db, songId: string, userId: string, message: string) {
  await admin.from("songs").update({ status: "failed", error: message }).eq("id", songId);
  await refundOnce(admin, songId, userId);
}

export type GeneratedAudio = {
  bytes: Uint8Array;
  contentType: string;
  extension: "mp3" | "wav";
};

export function audioFromBytes(bytes: Uint8Array, contentType: string): GeneratedAudio {
  const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isMp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || bytes[0] === 0xff;
  return {
    bytes,
    contentType: isWav ? "audio/wav" : isMp3 ? "audio/mpeg" : contentType || "audio/mpeg",
    extension: isWav ? "wav" : "mp3",
  };
}

async function decodeAudioResponse(response: Response): Promise<GeneratedAudio> {
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!contentType.includes("json")) return audioFromBytes(bytes, contentType);

  const text = new TextDecoder().decode(bytes);
  const parsed: unknown = JSON.parse(text);
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  const record = root && typeof root === "object" ? (root as Record<string, unknown>) : {};
  const audio = record["audio"];
  if (typeof audio === "string") {
    const base64 = audio.includes(",") ? (audio.split(",").pop() ?? "") : audio;
    return audioFromBytes(new Uint8Array(Buffer.from(base64, "base64")), contentType);
  }
  if (audio && typeof audio === "object") {
    const audioRecord = audio as Record<string, unknown>;
    const encoded = audioRecord["bytes"] ?? audioRecord["base64"];
    if (typeof encoded === "string") {
      const base64 = encoded.includes(",") ? (encoded.split(",").pop() ?? "") : encoded;
      return audioFromBytes(new Uint8Array(Buffer.from(base64, "base64")), contentType);
    }
    const url = audioRecord["url"] ?? record["audio_url"];
    if (typeof url === "string") {
      const download = await fetch(url);
      if (!download.ok) throw new Error("HF_DOWNLOAD_FAILED");
      return decodeAudioResponse(download);
    }
  }
  throw new Error("HF_NO_AUDIO");
}

export function hfToken(): string | undefined {
  return process.env["HF_TOKEN"];
}

export function isFalBalanceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message === "FAL_402" || /insufficient|balance|saldo|cr[eé]dito/i.test(message);
}

export async function huggingFaceAudio(prompt: string): Promise<GeneratedAudio> {
  const token = hfToken();
  if (!token) throw new Error("HF_NOT_CONFIGURED");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(
      "https://api-inference.huggingface.co/models/facebook/musicgen-small",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: prompt }),
      },
    );
    if (response.ok) return decodeAudioResponse(response);
    const status = response.status;
    if (status === 503 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    throw new Error(`HF_${status}`);
  }
  throw new Error("HF_UNAVAILABLE");
}

export function hfErrorMessage(code: string): string {
  if (code === "HF_NOT_CONFIGURED")
    return "El proveedor gratuito no está configurado. El administrador debe añadir la token de Hugging Face.";
  if (code === "HF_401" || code === "HF_403")
    return "La token de Hugging Face no es válida o no tiene permisos.";
  if (code === "HF_429") return "Hugging Face está ocupado. Inténtalo en unos minutos.";
  if (code.startsWith("HF_5"))
    return "El proveedor gratuito no está disponible ahora. Inténtalo de nuevo.";
  return "No se pudo generar el audio con el proveedor gratuito.";
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
  if (code === "FAL_NOT_CONFIGURED")
    return "Esta función aún no está configurada. El administrador debe añadir la clave de Fal.ai.";
  if (code === "FAL_TIMEOUT") return "La generación tardó demasiado. Inténtalo de nuevo.";
  if (code === "FAL_401" || code === "FAL_403")
    return "La clave de Fal.ai no es válida o no tiene permisos.";
  if (code === "FAL_402") return "La cuenta de Fal.ai no tiene saldo suficiente.";
  if (code === "FAL_422") return "Los archivos enviados no son válidos para este modelo.";
  if (code === "FAL_429") return "Fal.ai está ocupado. Inténtalo en unos minutos.";
  return "No se pudo iniciar la generación. Inténtalo de nuevo.";
}

/** Signed URL for a file the caller owns in a private bucket. */
export async function signOwnedPath(
  admin: Db,
  bucket: string,
  path: string,
  userId: string,
  seconds = 3600,
) {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) throw new Error("FORBIDDEN_PATH");
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data) throw new Error("SIGN_FAILED");
  return data.signedUrl;
}
