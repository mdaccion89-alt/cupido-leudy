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
const POLLINATIONS_VIDEO_MODEL = "seedance";

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

function videoModelEntries(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter(Boolean) as Record<string, unknown>[];
  const record = json as Record<string, unknown> | null;
  const list = record?.["data"] ?? record?.["models"] ?? record?.["results"];
  return Array.isArray(list) ? (list.filter(Boolean) as Record<string, unknown>[]) : [];
}

function isUsableVideoModel(entry: Record<string, unknown>): boolean {
  if (entry["paid_only"] === true) return false;
  const endpoints = entry["supported_endpoints"];
  if (Array.isArray(endpoints) && !endpoints.some((item) => item === "/video/{prompt}")) return false;
  const outputs = entry["output_modalities"];
  if (Array.isArray(outputs) && !outputs.includes("video")) return false;
  const name = videoPickString(entry, "name");
  const title = videoPickString(entry, "title");
  const description = videoPickString(entry, "description");
  const aliases = entry["aliases"];
  const haystack = [name, title, description, Array.isArray(aliases) ? aliases.join(" ") : ""]
    .join(" ")
    .toLowerCase();
  return /video|seedance|ltx|wan|kling|runway|hailuo|veo/.test(haystack);
}

async function resolveVideoModel(key: string): Promise<string | undefined> {
  const url = `${POLLINATIONS_BASE}/video/models`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok) return undefined;
  let catalog: unknown;
  try {
    catalog = await response.json();
  } catch {
    return undefined;
  }
  for (const entry of videoModelEntries(catalog)) {
    if (!isUsableVideoModel(entry)) continue;
    const id = videoPickString(entry, "name") || videoPickString(entry, "id");
    if (id && id !== POLLINATIONS_VIDEO_MODEL) return id;
  }
  return undefined;
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
    let model = POLLINATIONS_VIDEO_MODEL;
    let url = pollinationsVideoUrl(data.prompt, model, data.width, data.height);
    let response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (response.status === 402 || response.status === 403) {
      const fallback = await resolveVideoModel(key);
      if (fallback) {
        model = fallback;
        url = pollinationsVideoUrl(data.prompt, model, data.width, data.height);
        response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      }
    }
    if (!response.ok) {
      const detail = apiErrorDetail(await response.text().catch(() => ""));
      return {
        ok: false,
        message: `POLLINATIONS_VIDEO_${response.status}_${model}: ${detail || response.statusText}`,
      };
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (/text\/html|application\/json/i.test(contentType)) {
      const detail = apiErrorDetail(await response.text().catch(() => ""));
      return { ok: false, message: `POLLINATIONS_VIDEO_NO_BINARY_${model}: ${detail.slice(0, 200)}` };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) return { ok: false, message: "POLLINATIONS_EMPTY_VIDEO" };
    return {
      ok: true,
      video: `data:video/mp4;base64,${bytesToBase64(bytes)}`,
      url,
      mime: "video/mp4",
      extension: "mp4",
      model,
    };
  });
