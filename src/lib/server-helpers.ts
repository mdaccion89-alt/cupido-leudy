// Helpers used only inside server function handlers. Secrets are read per call, never at module scope.
import { Buffer } from "node:buffer";
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
  extension: "mp3" | "wav" | "mp4";
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

const MUSICGEN_SPACE = "https://patgpt4-musicgen.hf.space";

export async function generateMusicgenAudio(prompt: string): Promise<GeneratedAudio> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const sessionHash = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const response = await fetch(`${MUSICGEN_SPACE}/run/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fn_index: 1,
        data: ["small", prompt.slice(0, 512), null, 10, 250, 0, 1, 3],
        event_data: null,
        session_hash: sessionHash,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`SPACE_${response.status}: ${raw.slice(0, 160)}`);
    const result = JSON.parse(raw) as { data?: unknown[] };
    const first = Array.isArray(result.data?.[0]) ? result.data[0][0] : result.data?.[0];
    const name =
      first && typeof first === "object" && "name" in first
        ? String((first as { name?: unknown }).name ?? "")
        : typeof first === "string"
          ? first
          : "";
    if (!name.startsWith("/tmp/gradio/") || !name.endsWith(".mp4"))
      throw new Error("SPACE_NO_AUDIO");

    const fileResponse = await fetch(`${MUSICGEN_SPACE}/file=${name}`, {
      signal: controller.signal,
    });
    if (!fileResponse.ok) throw new Error(`DOWNLOAD_${fileResponse.status}`);
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    if (!bytes.length) throw new Error("EMPTY_AUDIO");
    return { bytes, contentType: "video/mp4", extension: "mp4" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function pollinationsText(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      `https://text.pollinations.ai/${encodeURIComponent(prompt.slice(0, 2000))}`,
      { signal: controller.signal },
    );
    if (!response.ok) throw new Error(`POLLINATIONS_TEXT_${response.status}`);
    const text = (await response.text()).trim();
    if (!text) throw new Error("POLLINATIONS_TEXT_EMPTY");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function pollinationsAudio(
  prompt: string,
  duration: number,
): Promise<GeneratedAudio | null> {
  const key = process.env["POLLINATIONS_API_KEY"]?.trim();
  if (!key) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const query = new URLSearchParams({
      model: "elevenmusic",
      duration: String(Math.min(300, Math.max(5, Math.round(duration)))),
    });
    const response = await fetch(
      `https://gen.pollinations.ai/audio/${encodeURIComponent(prompt.slice(0, 1000))}?${query.toString()}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`POLLINATIONS_AUDIO_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("POLLINATIONS_AUDIO_EMPTY");
    return audioFromBytes(bytes, response.headers.get("content-type") || "audio/mpeg");
  } finally {
    clearTimeout(timeout);
  }
}

export function synthesizeSongAudio(options: {
  bpm: number;
  seconds: number;
  seedText: string;
}): GeneratedAudio {
  const sampleRate = 16_000;
  const seconds = Math.min(30, Math.max(8, Math.round(options.seconds)));
  const sampleCount = sampleRate * seconds;
  const bpm = Math.min(180, Math.max(60, options.bpm || 110));
  const beat = 60 / bpm;
  const chords = [
    [261.63, 329.63, 392.0],
    [196.0, 246.94, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 349.23],
  ];
  let seed = 2166136261;
  for (let i = 0; i < options.seedText.length; i += 1)
    seed = Math.imul(seed ^ options.seedText.charCodeAt(i), 16777619) >>> 0;

  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const bar = beat * 4;
    const chord = chords[Math.floor(t / bar) % chords.length] ?? chords[0] ?? [];
    const barPhase = (t % bar) / bar;
    const envelope = Math.min(1, barPhase * 20) * Math.min(1, (1 - barPhase) * 12);
    let tone = 0;
    for (const note of chord) {
      tone += Math.sin(2 * Math.PI * note * t) * 0.11;
      tone += Math.sin(2 * Math.PI * note * 2 * t) * 0.025;
    }
    const beatPhase = (t % beat) / beat;
    const kick =
      Math.sin(2 * Math.PI * (55 - 30 * beatPhase) * t) *
      Math.exp(-beatPhase * 12) *
      0.4;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const hat = (seed / 0xffffffff - 0.5) * 0.04 * Math.exp(-beatPhase * 35);
    const value = (tone * envelope + kick + hat) * 0.75;
    buffer.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(value * 32767))),
      44 + i * 2,
    );
  }
  return audioFromBytes(new Uint8Array(buffer), "audio/wav");
}

export function hfTokens(): string[] {
  return parseTokenList([process.env["HF_TOKENS"], process.env["HF_TOKEN"]].join("\n"));
}

export function hfToken(): string | undefined {
  return hfTokens()[0];
}

export function isFalBalanceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message === "FAL_402" || /insufficient|balance|saldo|cr[eé]dito/i.test(message);
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
  const model = process.env["GEMINI_MODEL"]?.trim() || "gemini-2.5-flash";
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
