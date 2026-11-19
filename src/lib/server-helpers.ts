// Helpers used only inside server function handlers. Secrets are read per call, never at module scope.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { parseTokenList } from "./music";

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

export function hfTokens(): string[] {
  return parseTokenList([process.env["HF_TOKENS"], process.env["HF_TOKEN"]].join("\n"));
}

export function hfToken(): string | undefined {
  return hfTokens()[0];
}

function hfEndpoint(model: string): string {
  const custom = process.env["HF_ENDPOINT"]?.trim();
  if (!custom) return `https://router.huggingface.co/hf-inference/models/${model}`;
  return custom.replace("{model}", model);
}

function hfDetail(status: number, raw: string): string {
  let message = raw.trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const nested =
      record["error"] && typeof record["error"] === "object"
        ? (record["error"] as Record<string, unknown>)
        : {};
    const candidate =
      nested["message"] ?? nested["error"] ?? record["message"] ?? record["details"];
    if (typeof candidate === "string" && candidate.trim()) message = candidate.trim();
    else if (candidate && typeof candidate === "object") message = JSON.stringify(candidate);
  } catch {
    if (raw.trim().startsWith("<")) message = "El proveedor devolvió una página HTML inesperada.";
  }
  return `HTTP ${status}: ${message.replace(/\s+/g, " ").slice(0, 500) || "sin motivo"}`;
}

export function isFalBalanceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message === "FAL_402" || /insufficient|balance|saldo|cr[eé]dito/i.test(message);
}

export async function huggingFaceAudio(
  prompt: string,
  options: { model?: string } = {},
): Promise<GeneratedAudio> {
  const tokens = hfTokens();
  if (!tokens.length) throw new Error("HF_NOT_CONFIGURED");
  const model =
    options.model?.trim() || process.env["HF_MUSIC_MODEL"]?.trim() || "facebook/musicgen-small";
  const endpoint = hfEndpoint(model);
  let lastDetail = "sin motivo";
  for (const token of tokens) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: prompt, parameters: { wait_for_model: true } }),
        });
      } catch (error) {
        lastDetail = `red: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
      if (response.ok) return decodeAudioResponse(response);
      const detail = hfDetail(response.status, await response.text());
      lastDetail = detail;
      const lower = detail.toLowerCase();
      const loading = response.status === 503 || /loading|warm.?up|starting/.test(lower);
      const tokenLimit =
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429 ||
        /rate limit|quota|limit|exceeded|billing|payment|gated|unauthorized|invalid token/i.test(
          lower,
        );
      if (loading && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
        continue;
      }
      if (tokenLimit || loading || response.status >= 500) break;
      throw new Error(`HF_DETAIL:${detail}`);
    }
  }
  throw new Error(`HF_EXHAUSTED:${lastDetail}`);
}

export function hfErrorMessage(code: string): string {
  if (code.startsWith("HF_DETAIL:"))
    return `Hugging Face respondió: ${code.slice("HF_DETAIL:".length)}`;
  if (code.startsWith("HF_EXHAUSTED:"))
    return `Todas las tokens de Hugging Face llegaron a su límite. Último motivo: ${code.slice("HF_EXHAUSTED:".length)}`;
  if (code === "HF_NOT_CONFIGURED")
    return "El proveedor gratuito no está configurado. El administrador debe añadir una token de Hugging Face.";
  if (code === "HF_NO_AUDIO" || code === "HF_DOWNLOAD_FAILED")
    return "Hugging Face no devolvió audio descargable. Revisa el modelo configurado.";
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

export async function falWait(responseUrl: string, timeoutMs = 30 * 60_000): Promise<unknown> {
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

export function geminiErrorMessage(code: string): string {
  if (code === "GEMINI_NOT_CONFIGURED")
    return "La IA no está configurada. El administrador debe añadir la Gemini API Key.";
  if (code.startsWith("GEMINI_DETAIL:"))
    return `Gemini respondió: ${code.slice("GEMINI_DETAIL:".length)}`;
  if (code === "GEMINI_NO_TEXT") return "La IA no devolvió texto. Inténtalo de nuevo.";
  return "No se pudo completar la solicitud con Gemini.";
}

export type GeminiHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type GeminiGenerateResult =
  { ok: true; text: string } | { ok: false; code: string; detail?: string };

export async function geminiGenerate(
  system: string,
  user: string,
  history: GeminiHistoryMessage[] = [],
): Promise<GeminiGenerateResult> {
  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) return { ok: false, code: "GEMINI_NOT_CONFIGURED" };
  const model = process.env["GEMINI_MODEL"]?.trim() || "gemini-2.0-flash";
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = history.map(
    (item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    }),
  );
  contents.push({ role: "user", parts: [{ text: user }] });
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
        }),
      },
    );
  } catch {
    return { ok: false, code: "GEMINI_NETWORK" };
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = (await response.json()) as { error?: { message?: string } };
      if (parsed?.error?.message?.trim()) detail += `: ${parsed.error.message.trim()}`;
    } catch {
      const raw = await response.text().catch(() => "");
      if (raw.trim()) detail += `: ${raw.trim().slice(0, 300)}`;
    }
    return { ok: false, code: "GEMINI_DETAIL", detail };
  }
  let json: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    return { ok: false, code: "GEMINI_PARSE" };
  }
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) return { ok: false, code: "GEMINI_NO_TEXT" };
  return { ok: true, text };
}

export async function geminiText(system: string, prompt: string): Promise<string> {
  const result = await geminiGenerate(system, prompt);
  if (result.ok) return result.text;
  if (result.code === "GEMINI_NOT_CONFIGURED") throw new Error("GEMINI_NOT_CONFIGURED");
  if (result.code === "GEMINI_DETAIL")
    throw new Error(`GEMINI_DETAIL:${result.detail ?? "sin motivo"}`);
  if (result.code === "GEMINI_NO_TEXT") throw new Error("GEMINI_NO_TEXT");
  throw new Error(`GEMINI_DETAIL:${result.code}`);
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
