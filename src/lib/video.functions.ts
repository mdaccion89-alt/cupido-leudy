import { Buffer } from "node:buffer";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_PROMPT_LENGTH, sanitizePrompt } from "./music";

type CloudflareImageInput = {
  prompt: string;
};

export type CloudflareImageResult =
  | { ok: true; image: string }
  | { ok: false; message: string };

const CLOUDFLARE_AI_BASE = "https://api.cloudflare.com/client/v4/accounts";
const CLOUDFLARE_FLUX_MODEL = "@cf/black-forest-labs/flux-1-schnell";

function cloudflareImageEndpoint(accountId: string): string {
  return `${CLOUDFLARE_AI_BASE}/${accountId}/ai/run/${CLOUDFLARE_FLUX_MODEL}`;
}

function apiErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: unknown;
      error?: unknown;
      detail?: unknown;
      errors?: unknown;
    };
    const value = parsed.message ?? parsed.error ?? parsed.detail ?? parsed.errors;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value[0] as { message?: unknown } | undefined;
      if (typeof first?.message === "string" && first.message.trim()) return first.message.trim();
    }
  } catch {}
  return body.slice(0, 300);
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function imageBase64FromJson(json: unknown): string {
  const record = json as Record<string, unknown> | null;
  const result = record?.["result"] as Record<string, unknown> | undefined;
  const candidate = result?.["image"] ?? record?.["image"];
  if (typeof candidate === "string" && candidate.trim())
    return candidate.trim().replace(/^data:image\/[^;]+;base64,/, "");
  if (Array.isArray(candidate)) return bytesToBase64(new Uint8Array(candidate as number[]));
  return "";
}

export const generateCloudflareImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CloudflareImageInput) => {
    const prompt =
      typeof input?.prompt === "string"
        ? sanitizePrompt(input.prompt, MAX_PROMPT_LENGTH).trim()
        : "";
    if (prompt.length < 3) throw new Error("Describe la imagen que quieres generar.");
    return { prompt };
  })
  .handler(async ({ data }): Promise<CloudflareImageResult> => {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !token)
      return {
        ok: false,
        message: "Cloudflare Workers AI no está configurado en el servidor.",
      };
    const response = await fetch(cloudflareImageEndpoint(accountId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: data.prompt, steps: 4 }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok)
      return {
        ok: false,
        message: `CLOUDFLARE_${response.status}: ${apiErrorDetail(await response.text())}`,
      };
    if (/^image\//i.test(contentType)) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) return { ok: false, message: "CLOUDFLARE_EMPTY_IMAGE" };
      return { ok: true, image: `data:image/png;base64,${bytesToBase64(bytes)}` };
    }
    const body = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { ok: false, message: `CLOUDFLARE_JSON: ${body.slice(0, 200)}` };
    }
    const base64 = imageBase64FromJson(json);
    if (!base64)
      return { ok: false, message: `CLOUDFLARE_NO_IMAGE: ${apiErrorDetail(body)}` };
    return { ok: true, image: `data:image/png;base64,${base64}` };
  });

type PollinationsVideoInput = {
  prompt: string;
  width?: number;
  height?: number;
};

export type PollinationsVideoResult =
  | { ok: true; video: string; url: string; mime: string; extension: string; model: string }
  | { ok: false; message: string };

const POLLINATIONS_BASE = "https://gen.pollinations.ai";
const POLLINATIONS_CATALOG_URL = "https://pollinations.ai";

function pollinationsVideoUrl(prompt: string, model: string, width: number, height: number): string {
  const query = new URLSearchParams({
    model,
    width: String(width),
    height: String(height),
  }).toString();
  return `${POLLINATIONS_BASE}/video/${encodeURIComponent(prompt)}?${query}`;
}

function videoDimension(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 256 || parsed > 1536) return fallback;
  return Math.round(parsed);
}

function videoPickString(value: unknown, ...path: string[]): string {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : "";
}

async function readCatalog(url: string, key: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok) return [];
  try {
    return await response.json();
  } catch {
    return [];
  }
}

function videoModelEntries(json: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      record["paid_only"] === false &&
      (typeof record["name"] === "string" ||
        typeof record["id"] === "string" ||
        typeof record["model"] === "string")
    )
      found.push(record);
    for (const item of Object.values(record)) visit(item);
  };
  visit(json);
  return found;
}

function isQuestVideoModel(entry: Record<string, unknown>): boolean {
  if (entry["paid_only"] !== false) return false;
  const endpoints = entry["supported_endpoints"];
  if (Array.isArray(endpoints) && !endpoints.some((item) => item === "/video/{prompt}")) return false;
  const outputs = entry["output_modalities"];
  if (Array.isArray(outputs) && !outputs.includes("video")) return false;
  return true;
}

function videoModelId(entry: Record<string, unknown>): string {
  return (
    videoPickString(entry, "name") ||
    videoPickString(entry, "id") ||
    videoPickString(entry, "model") ||
    videoPickString(entry, "slug")
  );
}

async function resolveQuestVideoModels(key: string): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  const sources = [POLLINATIONS_CATALOG_URL, `${POLLINATIONS_BASE}/video/models`];
  for (const url of sources) {
    const catalog = await readCatalog(url, key);
    for (const entry of videoModelEntries(catalog)) {
      if (!isQuestVideoModel(entry)) continue;
      const id = videoModelId(entry);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length) break;
  }
  return ids;
}

export const generatePollinationsVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PollinationsVideoInput) => {
    const prompt =
      typeof input?.prompt === "string"
        ? sanitizePrompt(input.prompt, MAX_PROMPT_LENGTH).trim()
        : "";
    if (prompt.length < 3) throw new Error("Describe el video que quieres generar.");
    return {
      prompt,
      width: videoDimension(input?.width, 768),
      height: videoDimension(input?.height, 512),
    };
  })
  .handler(async ({ data }): Promise<PollinationsVideoResult> => {
    const key = process.env.POLLINATIONS_API_KEY;
    if (!key)
      return { ok: false, message: "POLLINATIONS_API_KEY no está configurado en el servidor." };
    const models = await resolveQuestVideoModels(key);
    if (!models.length)
      return { ok: false, message: "POLLINATIONS_NO_QUEST_VIDEO_MODELS" };
    const failures: string[] = [];
    for (const model of models) {
      const url = pollinationsVideoUrl(data.prompt, model, data.width, data.height);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!response.ok) {
        const detail = apiErrorDetail(await response.text().catch(() => ""));
        failures.push(`${model}:${response.status} ${detail}`.trim());
        continue;
      }
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (/text\/html|application\/json/i.test(contentType)) {
        const detail = apiErrorDetail(await response.text().catch(() => ""));
        failures.push(`${model}:NO_BINARY ${detail}`.trim());
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) {
        failures.push(`${model}:EMPTY`);
        continue;
      }
      return {
        ok: true,
        video: `data:video/mp4;base64,${bytesToBase64(bytes)}`,
        url,
        mime: "video/mp4",
        extension: "mp4",
        model,
      };
    }
    return {
      ok: false,
      message: `POLLINATIONS_VIDEO_ALL_FAILED: ${failures.join(" | ").slice(0, 500)}`,
    };
  });
