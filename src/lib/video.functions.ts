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

function cloudflareDetail(body: string): string {
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
        message: `CLOUDFLARE_${response.status}: ${cloudflareDetail(await response.text())}`,
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
      return { ok: false, message: `CLOUDFLARE_NO_IMAGE: ${cloudflareDetail(body)}` };
    return { ok: true, image: `data:image/png;base64,${base64}` };
  });
