import { createServerFn } from "@tanstack/react-start";
import { Buffer } from "node:buffer";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_EMAIL, CREDIT_COSTS, creditErrorMessage, isPaidPlan } from "@/lib/credits";
import { sanitizePrompt, titleFromPrompt } from "@/lib/music";
import {
  falErrorMessage,
  falKey,
  falSubmit,
  falWait,
  failCreation,
  getAdminClient,
  hfTokens,
  signOwnedPath,
  type Db,
  type FalSubmit,
} from "@/lib/server-helpers";
import { findBlockedTerm } from "./copyright";

export const FIREFLY_IMAGE_SIZES = ["16:9", "9:16", "1:1"] as const;

export const FIREFLY_IMAGE_PIXELS = {
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "1:1": { width: 1024, height: 1024 },
} as const;

export const FIREFLY_IMAGE_PROVIDERS = [
  { value: "pollinations", label: "Pollinations (gratis)" },
  { value: "huggingface", label: "Hugging Face FLUX" },
  { value: "fal", label: "Fal FLUX" },
] as const;

export const FIREFLY_ASSET_SLOTS = [
  { value: "face", label: "Cara/Rostro" },
  { value: "front", label: "Frente" },
  { value: "back", label: "Espalda" },
  { value: "lips", label: "Labios/Expresión" },
  { value: "body", label: "Pies/Cuerpo completo" },
] as const;

export const FIREFLY_VIDEO_MODELS = [
  { value: "ltx", label: "LTX 2.5 · texto e imagen" },
  { value: "wan", label: "Wan 2.2 · imagen a video" },
  { value: "cinematic", label: "Cinemático Multi-Escena" },
] as const;

export const FIREFLY_CAMERA_MOVEMENTS = [
  { value: "static", label: "Estático" },
  { value: "pan", label: "Paneo" },
  { value: "zoom-in", label: "Zoom in" },
  { value: "zoom-out", label: "Zoom out" },
  { value: "tracking", label: "Seguimiento" },
  { value: "orbit", label: "Órbita" },
  { value: "crane", label: "Grúa" },
] as const;

export const FIREFLY_VOICE_STYLES = [
  { value: "natural", label: "Natural" },
  { value: "warm", label: "Cálida y cercana" },
  { value: "professional", label: "Profesional" },
  { value: "narration", label: "Narración de documental" },
  { value: "commercial", label: "Comercial" },
  { value: "cheerful", label: "Animada" },
  { value: "calm", label: "Serena" },
  { value: "energetic", label: "Enérgica" },
] as const;

export const FIREFLY_ACCENTS = [
  { value: "neutral", label: "Neutro" },
  { value: "castilian", label: "Castellano" },
  { value: "latam", label: "Latinoamericano" },
  { value: "rioplatense", label: "Rioplatense" },
  { value: "caribbean", label: "Caribeño" },
  { value: "andean", label: "Andino" },
  { value: "brazilian", label: "Brasileño" },
  { value: "british", label: "Británico" },
  { value: "american", label: "Estadounidense" },
] as const;

export const FIREFLY_LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh", label: "中文" },
  { value: "ru", label: "Русский" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
  { value: "nl", label: "Nederlands" },
  { value: "sv", label: "Svenska" },
  { value: "no", label: "Norsk" },
  { value: "da", label: "Dansk" },
  { value: "fi", label: "Suomi" },
  { value: "pl", label: "Polski" },
  { value: "tr", label: "Türkçe" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "th", label: "ไทย" },
  { value: "he", label: "עברית" },
  { value: "el", label: "Ελληνικά" },
  { value: "cs", label: "Čeština" },
  { value: "ro", label: "Română" },
  { value: "hu", label: "Magyar" },
  { value: "uk", label: "Українська" },
] as const;

export const FIREFLY_COUNTRIES = [
  { value: "ES", label: "España" },
  { value: "MX", label: "México" },
  { value: "AR", label: "Argentina" },
  { value: "CO", label: "Colombia" },
  { value: "CL", label: "Chile" },
  { value: "PE", label: "Perú" },
  { value: "US", label: "Estados Unidos" },
  { value: "CA", label: "Canadá" },
  { value: "GB", label: "Reino Unido" },
  { value: "BR", label: "Brasil" },
  { value: "PT", label: "Portugal" },
  { value: "FR", label: "Francia" },
  { value: "DE", label: "Alemania" },
  { value: "IT", label: "Italia" },
  { value: "NL", label: "Países Bajos" },
  { value: "SE", label: "Suecia" },
  { value: "NO", label: "Noruega" },
  { value: "DK", label: "Dinamarca" },
  { value: "FI", label: "Finlandia" },
  { value: "PL", label: "Polonia" },
  { value: "TR", label: "Turquía" },
  { value: "RU", label: "Rusia" },
  { value: "UA", label: "Ucrania" },
  { value: "GR", label: "Grecia" },
  { value: "CZ", label: "Chequia" },
  { value: "RO", label: "Rumanía" },
  { value: "HU", label: "Hungría" },
  { value: "JP", label: "Japón" },
  { value: "KR", label: "Corea del Sur" },
  { value: "CN", label: "China" },
  { value: "IN", label: "India" },
  { value: "ID", label: "Indonesia" },
  { value: "VN", label: "Vietnam" },
  { value: "TH", label: "Tailandia" },
  { value: "IL", label: "Israel" },
  { value: "AE", label: "Emiratos Árabes Unidos" },
  { value: "SA", label: "Arabia Saudita" },
  { value: "EG", label: "Egipto" },
  { value: "NG", label: "Nigeria" },
  { value: "ZA", label: "Sudáfrica" },
  { value: "AU", label: "Australia" },
] as const;

export type FireflyAssetSlot = (typeof FIREFLY_ASSET_SLOTS)[number]["value"];
export type FireflyAsset = {
  name: string;
  description: string;
  references?: Partial<Record<FireflyAssetSlot, string>>;
};
export type FireflyScene = { text: string; seconds: number };
export type FireflyImageSize = (typeof FIREFLY_IMAGE_SIZES)[number];
export type FireflyImageProvider = (typeof FIREFLY_IMAGE_PROVIDERS)[number]["value"];
export type FireflyVideoModel = (typeof FIREFLY_VIDEO_MODELS)[number]["value"];
export type FireflySceneClip = {
  songId: string;
  url: string;
  storagePath: string;
  sceneNumber: number;
  seconds: number;
  mediaType: string;
  model: string;
};
export type FireflySequenceClip = FireflySceneClip;
export type FireflyFailure = { ok: false; status: number; message: string };

export type FireflyResult =
  | {
      ok: true;
      songId: string;
      url: string;
      mediaType: string;
      label?: string;
      stitched?: boolean;
      clips?: FireflySceneClip[];
    }
  | FireflyFailure;

export type FireflyVideoStartResult =
  { ok: true; generationId: string; expiresAt: string | null } | FireflyFailure;

export type FireflyVideoSceneResult = { ok: true; clip: FireflySceneClip } | FireflyFailure;

export type FireflyVideoSequenceResult =
  | {
      ok: true;
      generationId: string;
      label: string;
      stitched: false;
      clips: FireflySceneClip[];
    }
  | FireflyFailure;

export type FireflyFrameCaptureResult =
  | { ok: true; videoUrl: string; seconds: number; duration: number; mediaType: string }
  | FireflyFailure;

export type FireflyCleanupResult = { ok: true; deleted: number } | FireflyFailure;

export type FireflyImageInput = {
  prompt: string;
  imageSize: string;
  provider?: string;
  seed?: number | undefined;
  assets?: FireflyAsset[];
};
export type FireflyVideoInput = {
  prompt: string;
  scenes: FireflyScene[];
  cameraMovement: string;
  seed?: number | undefined;
  assets?: FireflyAsset[];
};
export type FireflyVideoStartInput = FireflyVideoInput & {
  model?: string;
  referencePath?: string | null;
};
export type FireflyVideoSceneInput = {
  generationId: string;
  sceneIndex: number;
  scene: FireflyScene;
  cameraMovement: string;
  referencePath?: string | null;
  seed?: number | undefined;
};
export type FireflyVideoFinishInput = { generationId: string };
export type FireflyVoiceInput = {
  text: string;
  voice: string;
  language: string;
  country: string;
  accent?: string;
  dubbingAudioPath?: string | null;
};
export type FireflyFrameCaptureInput = { videoSongId: string; seconds: number };

type FireflyKind = "image" | "video" | "voice";
type MediaSource = { url: string } | { base64: string; mime?: string };
type DownloadedMedia = { bytes: Uint8Array; contentType: string };
type ResolvedAsset = { name: string; description: string; referenceUrls: string[] };
type VideoModelConfig = { id: FireflyVideoModel; textModel: string; imageModel: string };

const MAX_ASSETS = 60;
const MAX_SCENES = 12;
const MAX_PROMPT = 1200;
const MAX_VOICE_TEXT = 4000;

function blockedMessage(): string {
  return "El texto incluye un término bloqueado. Usa una descripción original.";
}

function blockedTerm(text: string): boolean {
  return Boolean(findBlockedTerm(text));
}

function validatePrompt(value: unknown, message: string, max = MAX_PROMPT): string {
  const text = typeof value === "string" ? sanitizePrompt(value, max) : "";
  if (text.length < 3) throw new Error(message);
  if (blockedTerm(text)) throw new Error(blockedMessage());
  return text;
}

function validateSeed(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error("La semilla debe ser un número entero entre 0 y 2147483647.");
  return seed;
}

function validateSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60)
    throw new Error("El tiempo debe estar entre 0 y 60 segundos.");
  return Math.round(seconds * 10) / 10;
}

function validateAssets(value: unknown): FireflyAsset[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ASSETS)
    throw new Error("La lista de personajes y elementos no es válida.");
  return value.map((item) => {
    const record = item as Record<string, unknown> | null;
    const name =
      typeof record?.["name"] === "string"
        ? record["name"].trim().replace(/^@+/, "").slice(0, 40)
        : "";
    const description =
      typeof record?.["description"] === "string" ? sanitizePrompt(record["description"], 300) : "";
    if (!name || !description)
      throw new Error("Cada elemento necesita un nombre y una descripción.");
    if (!/^[\p{L}\p{N}_-]+$/u.test(name))
      throw new Error("Los nombres solo pueden usar letras, números, guiones y guiones bajos.");
    if (blockedTerm(description)) throw new Error(blockedMessage());
    const references: Partial<Record<FireflyAssetSlot, string>> = {};
    const rawReferences = record?.["references"];
    if (rawReferences && typeof rawReferences === "object" && !Array.isArray(rawReferences)) {
      for (const slot of FIREFLY_ASSET_SLOTS) {
        const candidate = (rawReferences as Record<string, unknown>)[slot.value];
        if (typeof candidate === "string" && candidate.trim() && !candidate.includes(".."))
          references[slot.value] = candidate.trim().slice(0, 500);
      }
    }
    return { name, description, references };
  });
}

function validateScenes(value: unknown): FireflyScene[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCENES)
    throw new Error("Añade entre 1 y 12 escenas.");
  const scenes = value.map((item, index) => {
    const record = item as Record<string, unknown> | null;
    const text = typeof record?.["text"] === "string" ? sanitizePrompt(record["text"], 600) : "";
    const seconds = Number(record?.["seconds"]);
    if (text.length < 3) throw new Error(`La escena ${index + 1} necesita una descripción.`);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60)
      throw new Error(`La escena ${index + 1} debe durar entre 1 y 60 segundos.`);
    if (blockedTerm(text)) throw new Error(blockedMessage());
    return { text, seconds: Math.round(seconds) };
  });
  if (scenes.reduce((sum, scene) => sum + scene.seconds, 0) > 60)
    throw new Error("El total de las escenas no puede superar los 60 segundos.");
  return scenes;
}

export function countActiveElements(
  prompt: string,
  assets: readonly Pick<FireflyAsset, "name">[],
): number {
  const names = new Set<string>();
  for (const asset of assets) {
    const name = asset?.name?.trim().replace(/^@+/, "").toLowerCase();
    if (name) names.add(name);
  }
  let used = 0;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`@${escaped}(?![\\w-])`, "i").test(prompt)) used += 1;
  }
  return used;
}

function assertElementLimit(prompt: string, assets: readonly Pick<FireflyAsset, "name">[]): void {
  if (countActiveElements(prompt, assets) > 3)
    throw new Error("Máximo 3 elementos activos por prompt (@nombre).");
}

function ownedPath(value: unknown, userId: string, folders: readonly string[]): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("La referencia no es válida.");
  const path = value.trim();
  if (path.includes("..") || !folders.some((folder) => path.startsWith(`${userId}/${folder}/`)))
    throw new Error("Ese archivo no pertenece a tu cuenta.");
  return path;
}

async function resolveAssets(assets: FireflyAsset[], userId: string, admin: Db) {
  const resolved: ResolvedAsset[] = [];
  for (const asset of assets) {
    const referenceUrls: string[] = [];
    for (const slot of FIREFLY_ASSET_SLOTS) {
      const path = ownedPath(asset.references?.[slot.value], userId, ["elements"]);
      if (path) referenceUrls.push(await signOwnedPath(admin, "uploads", path, userId, 3600));
    }
    const description = `${asset.name}: ${asset.description}${
      referenceUrls.length ? ` [Referencias: ${referenceUrls.join(", ")}]` : ""
    }`;
    if (blockedTerm(description)) throw new Error(blockedMessage());
    resolved.push({ name: asset.name, description, referenceUrls });
  }
  return resolved;
}

function applyAssets(prompt: string, assets: ResolvedAsset[]): string {
  let resolved = prompt;
  for (const asset of assets) {
    const token = `@${asset.name}`;
    if (new RegExp(`${token}(?![\\w-])`, "i").test(resolved))
      resolved = resolved.split(token).join(asset.description);
  }
  if (blockedTerm(resolved)) throw new Error(blockedMessage());
  return resolved;
}

function findMediaSource(value: unknown): MediaSource | null {
  if (typeof value === "string") {
    const text = value.trim();
    const uri = text.match(/^data:([^;,]+);base64,(.*)$/s);
    if (uri) {
      const payload = uri[2];
      if (payload) {
        const mime = uri[1];
        return mime ? { base64: payload, mime } : { base64: payload };
      }
    }
    if (/^https?:\/\//i.test(text)) return { url: text };
    if (text.length > 128 && /^[A-Za-z0-9+/=\s]+$/.test(text))
      return { base64: text.replace(/\s/g, "") };
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMediaSource(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["url", "audio_url", "image_url", "video_url", "file_url", "signed_url"]) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      const found = findMediaSource(candidate);
      if (found) return found;
    }
  }
  for (const key of ["base64", "b64_json", "bytes", "encoded"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 128) {
      const found = findMediaSource(candidate);
      if (found) return found;
    }
  }
  for (const key of [
    "image",
    "images",
    "video",
    "audio",
    "audio_file",
    "output",
    "result",
    "data",
    "files",
  ]) {
    if (!(key in record)) continue;
    const found = findMediaSource(record[key]);
    if (found) return found;
  }
  return null;
}

async function downloadMedia(source: MediaSource): Promise<DownloadedMedia> {
  if ("base64" in source) {
    const clean = source.base64.includes(",")
      ? (source.base64.split(",").pop() ?? "")
      : source.base64;
    return {
      bytes: new Uint8Array(Buffer.from(clean, "base64")),
      contentType: source.mime ?? "",
    };
  }
  const response = await fetch(source.url);
  if (!response.ok)
    throw new Error(`No se pudo descargar el archivo generado (${response.status}).`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0] ?? "";
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
}

async function decodeImageResponse(response: Response): Promise<DownloadedMedia> {
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0] ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!contentType.includes("json")) {
    if (!bytes.byteLength) throw new Error("HF_EMPTY");
    return { bytes, contentType: contentType || "image/png" };
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const source = findMediaSource(parsed);
  if (!source) throw new Error("HF_NO_IMAGE");
  return downloadMedia(source);
}

async function pollinationsImage(
  prompt: string,
  imageSize: FireflyImageSize,
  seed: number | undefined,
): Promise<DownloadedMedia> {
  const { width, height } = FIREFLY_IMAGE_PIXELS[imageSize];
  const query = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: "true",
  });
  if (seed !== undefined) query.set("seed", String(seed));
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${query}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`POLLINATIONS_${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0] ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("POLLINATIONS_EMPTY");
  return { bytes, contentType: contentType || "image/jpeg" };
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
  } catch {
    if (raw.trim().startsWith("<")) message = "Respuesta HTML inesperada.";
  }
  return `HTTP ${status}: ${message.replace(/\s+/g, " ").slice(0, 500) || "sin motivo"}`;
}

async function huggingFaceImage(
  prompt: string,
  imageSize: FireflyImageSize,
  seed: number | undefined,
): Promise<DownloadedMedia> {
  const tokens = hfTokens();
  if (!tokens.length) throw new Error("HF_NOT_CONFIGURED");
  const model = process.env["HF_IMAGE_MODEL"]?.trim() || "black-forest-labs/FLUX.1-schnell";
  const { width, height } = FIREFLY_IMAGE_PIXELS[imageSize];
  let lastDetail = "sin motivo";
  for (const token of tokens) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              width,
              height,
              num_inference_steps: 4,
              guidance_scale: 0,
              ...(seed !== undefined ? { seed } : {}),
            },
          }),
        });
      } catch (error) {
        lastDetail = `red: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
      if (response.ok) return decodeImageResponse(response);
      const detail = hfDetail(response.status, await response.text());
      lastDetail = detail;
      const lower = detail.toLowerCase();
      const loading = response.status === 503 || /loading|warm.?up|starting/.test(lower);
      const tokenLimit =
        response.status === 401 ||
        response.status === 403 ||
        /rate limit|quota|limit|exceeded|billing|payment|gated|unauthorized|invalid token/i.test(
          lower,
        );
      if (loading && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)));
        continue;
      }
      if (tokenLimit || loading || response.status >= 500) break;
      throw new Error(`HF_DETAIL:${detail}`);
    }
  }
  throw new Error(`HF_EXHAUSTED:${lastDetail}`);
}

function mediaKindFor(
  kind: FireflyKind,
  contentType: string,
): { extension: string; mediaType: string } {
  const ct = contentType.toLowerCase();
  if (kind === "image") {
    if (ct.includes("jpeg") || ct.includes("jpg"))
      return { extension: "jpg", mediaType: "image/jpeg" };
    if (ct.includes("webp")) return { extension: "webp", mediaType: "image/webp" };
    return { extension: "png", mediaType: "image/png" };
  }
  if (kind === "video") {
    if (ct.includes("webm")) return { extension: "webm", mediaType: "video/webm" };
    if (ct.includes("quicktime")) return { extension: "mov", mediaType: "video/quicktime" };
    return { extension: "mp4", mediaType: "video/mp4" };
  }
  if (ct.includes("wav")) return { extension: "wav", mediaType: "audio/wav" };
  if (ct.includes("ogg")) return { extension: "ogg", mediaType: "audio/ogg" };
  if (ct.includes("mp4") || ct.includes("m4a")) return { extension: "m4a", mediaType: "audio/mp4" };
  return { extension: "mp3", mediaType: "audio/mpeg" };
}

function providerFailure(error: unknown): FireflyFailure {
  const code = error instanceof Error ? error.message : String(error ?? "");
  const numeric = code.match(/^FAL_(\d{3})$/);
  if (numeric) return { ok: false, status: Number(numeric[1]), message: falErrorMessage(code) };
  if (code === "FAL_NOT_CONFIGURED" || code === "FAL_TIMEOUT")
    return {
      ok: false,
      status: code === "FAL_NOT_CONFIGURED" ? 503 : 504,
      message: falErrorMessage(code),
    };
  if (code === "HF_NOT_CONFIGURED")
    return {
      ok: false,
      status: 503,
      message: "El proveedor FLUX necesita una token de Hugging Face configurada.",
    };
  if (code.startsWith("HF_DETAIL:"))
    return { ok: false, status: 502, message: `Hugging Face respondió: ${code.slice(10)}` };
  if (code.startsWith("HF_EXHAUSTED:"))
    return {
      ok: false,
      status: 503,
      message: `Hugging Face no aceptó la solicitud: ${code.slice(13)}`,
    };
  if (code === "HF_EMPTY" || code === "HF_NO_IMAGE")
    return { ok: false, status: 502, message: "Hugging Face no devolvió una imagen válida." };
  if (code.startsWith("POLLINATIONS_"))
    return {
      ok: false,
      status: code === "POLLINATIONS_429" ? 429 : 502,
      message: `Pollinations no pudo generar la imagen (${code.slice(13)}).`,
    };
  return { ok: false, status: 502, message: code || "No se pudo completar la generación." };
}

async function videosEnabled(supabase: Db): Promise<boolean> {
  const { data } = await supabase
    .from("site_settings")
    .select("videos_enabled")
    .eq("id", 1)
    .maybeSingle();
  return data ? Boolean(data.videos_enabled) : true;
}

async function expiresAtFor(supabase: Db, userId: string, claims: unknown): Promise<string | null> {
  const { data: hasAdminRole } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  const rawEmail =
    claims && typeof claims === "object" ? (claims as Record<string, unknown>)["email"] : null;
  const email = typeof rawEmail === "string" ? rawEmail.toLowerCase() : "";
  if (hasAdminRole || email === ADMIN_EMAIL.toLowerCase()) return null;
  const { data: plan } = await supabase.rpc("effective_plan", { _user_id: userId });
  if (isPaidPlan(plan)) return null;
  return new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
}

function claimsFrom(context: unknown): unknown {
  return (context as { claims?: unknown }).claims;
}

async function falMedia(model: string, payload: Record<string, unknown>) {
  return async (admin: Db, songId: string): Promise<DownloadedMedia> => {
    const job: FalSubmit = await falSubmit(model, payload);
    await admin
      .from("songs")
      .update({
        external_job_id: job.request_id,
        external_status_url: job.status_url,
        external_response_url: job.response_url,
      })
      .eq("id", songId);
    const output = await falWait(job.response_url);
    const source = findMediaSource(output);
    if (!source) throw new Error("PROVIDER_NO_MEDIA");
    return downloadMedia(source);
  };
}

type RunConfig = {
  kind: FireflyKind;
  model: string;
  cost: number;
  reason: string;
  title: string;
  prompt: string;
  duration: number;
  defaultMediaType: string;
  expiresAt: string | null;
  voiceType?: string;
  produce: (admin: Db, songId: string) => Promise<DownloadedMedia>;
};

async function runFirefly(supabase: Db, userId: string, config: RunConfig): Promise<FireflyResult> {
  if (!(await videosEnabled(supabase)))
    return {
      ok: false,
      status: 403,
      message: "La creación de videos e imágenes está desactivada por ahora.",
    };

  const { data: balance, error: creditError } = await supabase.rpc("consume_credits", {
    _amount: config.cost,
    _reason: config.reason,
  });
  if (creditError) return { ok: false, status: 402, message: creditErrorMessage(creditError) };
  const spent = balance === -1 ? 0 : config.cost;

  const admin = await getAdminClient();
  const { data: row, error: insertError } = await admin
    .from("songs")
    .insert({
      user_id: userId,
      kind: config.kind,
      title: config.title,
      prompt: config.prompt,
      genre: "firefly",
      duration_seconds: config.duration,
      status: "generating",
      media_type: config.defaultMediaType,
      credits_spent: spent,
      external_model: config.model,
      expires_at: config.expiresAt,
      ...(config.voiceType ? { voice_type: config.voiceType } : {}),
    })
    .select("id")
    .single();
  if (insertError || !row) {
    if (spent)
      await admin.rpc("grant_credits", {
        _user_id: userId,
        _amount: spent,
        _reason: "Reembolso por creación fallida",
      });
    return { ok: false, status: 500, message: "No se pudo iniciar la generación." };
  }

  const fail = async (status: number, message: string): Promise<FireflyResult> => {
    await failCreation(admin, row.id, userId, message);
    return { ok: false, status, message };
  };

  try {
    const media = await config.produce(admin, row.id);
    if (media.bytes.byteLength === 0)
      throw new Error("El generador devolvió un archivo vacío. Inténtalo de nuevo.");
    const { extension, mediaType } = mediaKindFor(config.kind, media.contentType);
    const path = `${userId}/${row.id}.${extension}`;
    const { error: uploadError } = await admin.storage
      .from("songs")
      .upload(path, media.bytes, { contentType: mediaType, upsert: true });
    if (uploadError) return fail(500, "El archivo se generó pero no se pudo guardar.");
    await admin
      .from("songs")
      .update({ status: "ready", storage_path: path, media_type: mediaType, error: null })
      .eq("id", row.id);
    const url = await signOwnedPath(admin, "songs", path, userId, 3600);
    return { ok: true, songId: row.id, url, mediaType };
  } catch (error) {
    const failure = providerFailure(error);
    console.error("firefly generation failed", failure.status, failure.message);
    return fail(failure.status, failure.message);
  }
}

function videoModelConfig(id: FireflyVideoModel): VideoModelConfig {
  if (id === "wan")
    return {
      id,
      textModel:
        process.env["FIREFLY_VIDEO_MODEL_LTX_TEXT"]?.trim() ||
        "lightricks/ltx-2.5/text-to-video/fast",
      imageModel:
        process.env["FIREFLY_VIDEO_MODEL_WAN_IMAGE"]?.trim() ||
        "fal-ai/wan/v2.2-a14b/image-to-video",
    };
  if (id === "cinematic")
    return {
      id,
      textModel:
        process.env["FAL_VIDEO_MODEL"]?.trim() || "fal-ai/kling-video/v1.6/standard/text-to-video",
      imageModel:
        process.env["FAL_VIDEO_IMAGE_MODEL"]?.trim() ||
        "fal-ai/kling-video/v1.6/standard/image-to-video",
    };
  return {
    id: "ltx",
    textModel:
      process.env["FIREFLY_VIDEO_MODEL_LTX_TEXT"]?.trim() ||
      "lightricks/ltx-2.5/text-to-video/fast",
    imageModel:
      process.env["FIREFLY_VIDEO_MODEL_LTX_IMAGE"]?.trim() ||
      "lightricks/ltx-2.5/image-to-video/fast",
  };
}

function selectSceneModel(config: VideoModelConfig, hasReference: boolean) {
  if (hasReference) return { model: config.imageModel, usesImage: true };
  return { model: config.textModel, usesImage: false };
}

export const generateFireflyImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FireflyImageInput) => {
    const prompt = validatePrompt(input?.prompt, "Describe la imagen que quieres crear.");
    const size = input?.imageSize as FireflyImageSize;
    const imageSize = FIREFLY_IMAGE_SIZES.includes(size) ? size : "16:9";
    const seed = validateSeed(input?.seed);
    const assets = validateAssets(input?.assets);
    const providerValues = FIREFLY_IMAGE_PROVIDERS.map((provider) => provider.value);
    const requestedProvider = input?.provider as FireflyImageProvider;
    const provider = providerValues.includes(requestedProvider)
      ? requestedProvider
      : "pollinations";
    const fullPrompt = `${prompt}\n${assets.map((asset) => `@${asset.name}`).join(" ")}`.trim();
    assertElementLimit(fullPrompt, assets);
    return { prompt, imageSize, seed, assets, provider };
  })
  .handler(async ({ data, context }): Promise<FireflyResult> => {
    if (data.provider === "huggingface" && !hfTokens().length)
      return {
        ok: false,
        status: 503,
        message: "Hugging Face FLUX necesita una token configurada. Prueba con Pollinations.",
      };
    if (data.provider === "fal" && !falKey())
      return {
        ok: false,
        status: 503,
        message: "Fal FLUX necesita la clave del proveedor. Prueba con Pollinations.",
      };
    const admin = await getAdminClient();
    let resolved = "";
    try {
      resolved = applyAssets(data.prompt, await resolveAssets(data.assets, context.userId, admin));
    } catch (error) {
      return {
        ok: false,
        status: 400,
        message: error instanceof Error ? error.message : "El prompt no es válido.",
      };
    }
    const expiresAt = await expiresAtFor(context.supabase, context.userId, claimsFrom(context));
    const model =
      data.provider === "fal"
        ? process.env["FAL_IMAGE_MODEL"]?.trim() || "fal-ai/flux/dev"
        : data.provider === "huggingface"
          ? process.env["HF_IMAGE_MODEL"]?.trim() || "black-forest-labs/FLUX.1-schnell"
          : "pollinations/image";
    const produce =
      data.provider === "fal"
        ? await falMedia(model, {
            prompt: resolved,
            image_size: data.imageSize,
            ...(data.seed !== undefined ? { seed: data.seed } : {}),
          })
        : data.provider === "huggingface"
          ? async () => huggingFaceImage(resolved, data.imageSize, data.seed)
          : async () => pollinationsImage(resolved, data.imageSize, data.seed);
    return runFirefly(context.supabase, context.userId, {
      kind: "image",
      model,
      cost: CREDIT_COSTS.song,
      reason: "Imagen IA",
      title: titleFromPrompt(data.prompt),
      prompt: data.prompt,
      duration: 0,
      defaultMediaType: "image/png",
      expiresAt,
      produce,
    });
  });

export const beginFireflyVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FireflyVideoStartInput) => {
    const prompt = validatePrompt(input?.prompt, "Describe el video que quieres crear.");
    const scenes = validateScenes(input?.scenes);
    const seed = validateSeed(input?.seed);
    const assets = validateAssets(input?.assets);
    const cameraValues = FIREFLY_CAMERA_MOVEMENTS.map((movement) => movement.value);
    const requestedCamera = input?.cameraMovement as (typeof cameraValues)[number];
    const cameraMovement = cameraValues.includes(requestedCamera) ? input.cameraMovement : "static";
    const modelValues = FIREFLY_VIDEO_MODELS.map((item) => item.value);
    const requestedModel = input?.model as FireflyVideoModel;
    const model = modelValues.includes(requestedModel) ? requestedModel : "ltx";
    const sceneLines = scenes
      .map((scene, index) => `Escena ${index + 1} (${scene.seconds}s): ${scene.text}`)
      .join("\n");
    const rawPrompt =
      `${prompt}\n${assets.map((asset) => `@${asset.name}`).join(" ")}\n${sceneLines}`.trim();
    assertElementLimit(rawPrompt, assets);
    return {
      prompt,
      scenes,
      seed,
      assets,
      cameraMovement,
      model,
      referencePath: typeof input?.referencePath === "string" ? input.referencePath : null,
      duration: scenes.reduce((sum, scene) => sum + scene.seconds, 0),
    };
  })
  .handler(async ({ data, context }): Promise<FireflyVideoStartResult> => {
    if (!(await videosEnabled(context.supabase)))
      return {
        ok: false,
        status: 403,
        message: "La creación de videos está desactivada por ahora.",
      };
    if (!falKey())
      return {
        ok: false,
        status: 503,
        message: "El proveedor de video no está configurado (FAL_KEY).",
      };
    const admin = await getAdminClient();
    let resolvedPrompt = "";
    try {
      const resolvedAssets = await resolveAssets(data.assets, context.userId, admin);
      ownedPath(data.referencePath, context.userId, ["references", "frames"]);
      resolvedPrompt = applyAssets(data.prompt, resolvedAssets);
    } catch (error) {
      return {
        ok: false,
        status: 400,
        message: error instanceof Error ? error.message : "La solicitud no es válida.",
      };
    }
    const sceneLines = data.scenes
      .map((scene, index) => `Escena ${index + 1} (${scene.seconds}s): ${scene.text}`)
      .join("\n");
    const fullPrompt = `${resolvedPrompt}\n\n${sceneLines}`.trim();
    if (blockedTerm(fullPrompt)) return { ok: false, status: 400, message: blockedMessage() };
    const { data: balance, error: creditError } = await context.supabase.rpc("consume_credits", {
      _amount: CREDIT_COSTS.video,
      _reason: "Video IA por escenas",
    });
    if (creditError) return { ok: false, status: 402, message: creditErrorMessage(creditError) };
    const spent = balance === -1 ? 0 : CREDIT_COSTS.video;
    const expiresAt = await expiresAtFor(context.supabase, context.userId, claimsFrom(context));
    const { data: row, error: insertError } = await admin
      .from("songs")
      .insert({
        user_id: context.userId,
        kind: "video",
        title: titleFromPrompt(data.prompt),
        prompt: fullPrompt,
        genre: "firefly-video",
        duration_seconds: data.duration,
        status: "generating",
        media_type: "video/mp4",
        credits_spent: spent,
        external_model: data.model,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (insertError || !row) {
      if (spent)
        await admin.rpc("grant_credits", {
          _user_id: context.userId,
          _amount: spent,
          _reason: "Reembolso por creación fallida",
        });
      return { ok: false, status: 500, message: "No se pudo iniciar la secuencia." };
    }
    return { ok: true, generationId: row.id, expiresAt };
  });

export const generateFireflyVideoScene = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FireflyVideoSceneInput) => {
    const generationId = typeof input?.generationId === "string" ? input.generationId.trim() : "";
    if (!generationId) throw new Error("Falta la generación.");
    const sceneIndex = Number(input?.sceneIndex);
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= MAX_SCENES)
      throw new Error("Índice de escena no válido.");
    const scene = validateScenes([input?.scene])[0]!;
    const cameraValues = FIREFLY_CAMERA_MOVEMENTS.map((movement) => movement.value);
    const requestedCamera = input?.cameraMovement as (typeof cameraValues)[number];
    const cameraMovement = cameraValues.includes(requestedCamera) ? input.cameraMovement : "static";
    return {
      generationId,
      sceneIndex,
      scene,
      cameraMovement,
      seed: validateSeed(input?.seed),
      referencePath: typeof input?.referencePath === "string" ? input.referencePath : null,
    };
  })
  .handler(async ({ data, context }): Promise<FireflyVideoSceneResult> => {
    const admin = await getAdminClient();
    const { data: parent } = await admin
      .from("songs")
      .select("id,user_id,title,prompt,duration_seconds,status,external_model,expires_at")
      .eq("id", data.generationId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!parent || parent.status !== "generating")
      return { ok: false, status: 409, message: "La secuencia ya no está activa." };
    const modelValues = FIREFLY_VIDEO_MODELS.map((item) => item.value);
    const config = videoModelConfig(
      modelValues.includes(parent.external_model as FireflyVideoModel)
        ? (parent.external_model as FireflyVideoModel)
        : "ltx",
    );
    let signedReference: string | null = null;
    try {
      const path = ownedPath(data.referencePath, context.userId, ["references", "frames"]);
      if (path) signedReference = await signOwnedPath(admin, "uploads", path, context.userId, 3600);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Referencia no válida.";
      await failCreation(admin, parent.id, context.userId, message);
      return { ok: false, status: 400, message };
    }
    const { model, usesImage } = selectSceneModel(config, Boolean(signedReference));
    const scenePrompt = `${parent.prompt}\nEscena ${data.sceneIndex + 1}: ${data.scene.text}`;
    if (blockedTerm(scenePrompt)) {
      const message = blockedMessage();
      await failCreation(admin, parent.id, context.userId, message);
      return { ok: false, status: 400, message };
    }
    try {
      const payload: Record<string, unknown> = {
        prompt: scenePrompt,
        duration: data.scene.seconds,
        camera_movement: data.cameraMovement,
        ...(usesImage && signedReference ? { image_url: signedReference } : {}),
        ...(data.seed !== undefined ? { seed: data.seed + data.sceneIndex } : {}),
      };
      const media = await (await falMedia(model, payload))(admin, parent.id);
      if (media.bytes.byteLength === 0) throw new Error("PROVIDER_EMPTY");
      const { extension, mediaType } = mediaKindFor("video", media.contentType);
      const path = `${context.userId}/${parent.id}-scene-${data.sceneIndex + 1}.${extension}`;
      const { error: uploadError } = await admin.storage
        .from("songs")
        .upload(path, media.bytes, { contentType: mediaType, upsert: true });
      if (uploadError) throw new Error("STORE_FAILED");
      const { data: sceneRow, error: sceneError } = await admin
        .from("songs")
        .insert({
          user_id: context.userId,
          kind: "video-scene",
          title: `${parent.title} · Escena ${data.sceneIndex + 1}`,
          prompt: `${data.scene.text}\n${parent.prompt}`,
          genre: "firefly-video",
          duration_seconds: data.scene.seconds,
          status: "ready",
          media_type: mediaType,
          storage_path: path,
          credits_spent: 0,
          external_model: model,
          source_song_id: parent.id,
          expires_at: parent.expires_at,
        })
        .select("id")
        .single();
      if (sceneError || !sceneRow) throw new Error("SCENE_ROW_FAILED");
      const url = await signOwnedPath(admin, "songs", path, context.userId, 3600);
      return {
        ok: true,
        clip: {
          songId: sceneRow.id,
          url,
          storagePath: path,
          sceneNumber: data.sceneIndex + 1,
          seconds: data.scene.seconds,
          mediaType,
          model,
        },
      };
    } catch (error) {
      const failure = providerFailure(error);
      const message =
        failure.message === "STORE_FAILED"
          ? "El clip se generó pero no se pudo guardar."
          : failure.message === "PROVIDER_EMPTY"
            ? "El proveedor devolvió un clip vacío."
            : failure.message;
      await failCreation(admin, parent.id, context.userId, message);
      return { ok: false, status: failure.status, message };
    }
  });

export const finishFireflyVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FireflyVideoFinishInput) => {
    const generationId = typeof input?.generationId === "string" ? input.generationId.trim() : "";
    if (!generationId) throw new Error("Falta la generación.");
    return { generationId };
  })
  .handler(async ({ data, context }): Promise<FireflyVideoSequenceResult> => {
    const admin = await getAdminClient();
    const { data: parent } = await admin
      .from("songs")
      .select("id,status")
      .eq("id", data.generationId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!parent || parent.status !== "generating")
      return { ok: false, status: 409, message: "La secuencia no está activa." };
    const { data: rows } = await admin
      .from("songs")
      .select("id,storage_path,duration_seconds,media_type,external_model,created_at")
      .eq("user_id", context.userId)
      .eq("source_song_id", parent.id)
      .eq("kind", "video-scene")
      .eq("status", "ready")
      .order("created_at", { ascending: true });
    if (!rows?.length)
      return { ok: false, status: 404, message: "No hay escenas guardadas en esta secuencia." };
    const clips: FireflySceneClip[] = [];
    for (const [index, row] of rows.entries()) {
      if (!row.storage_path) continue;
      const url = await signOwnedPath(admin, "songs", row.storage_path, context.userId, 3600);
      clips.push({
        songId: row.id,
        url,
        storagePath: row.storage_path,
        sceneNumber: index + 1,
        seconds: row.duration_seconds,
        mediaType: row.media_type,
        model: row.external_model ?? "",
      });
    }
    await admin
      .from("songs")
      .update({ status: "ready", error: null, storage_path: null })
      .eq("id", parent.id);
    return {
      ok: true,
      generationId: parent.id,
      label: "Secuencia de escenas (sin unir)",
      stitched: false,
      clips,
    };
  });

export const generateFireflyVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FireflyVideoInput) => {
    const prompt = validatePrompt(input?.prompt, "Describe el video que quieres crear.");
    const scenes = validateScenes(input?.scenes);
    const seed = validateSeed(input?.seed);
    const assets = validateAssets(input?.assets);
    const cameraValues = FIREFLY_CAMERA_MOVEMENTS.map((movement) => movement.value);
    const requested = input?.cameraMovement as (typeof cameraValues)[number];
    const cameraMovement = cameraValues.includes(requested) ? input.cameraMovement : "static";
    const sceneLines = scenes
      .map((scene, index) => `Escena ${index + 1} (${scene.seconds}s): ${scene.text}`)
      .join("\n");
    const rawPrompt = `${prompt}\n${assets.map((asset) => `@${asset.name}`).join(" ")}`.trim();
    assertElementLimit(rawPrompt, assets);
    return {
      prompt,
      scenes,
      seed,
      assets,
      cameraMovement,
      duration: scenes.reduce((sum, scene) => sum + scene.seconds, 0),
    };
  })
  .handler(async ({ data, context }): Promise<FireflyResult> => {
    const admin = await getAdminClient();
    let resolved = "";
    try {
      resolved = applyAssets(data.prompt, await resolveAssets(data.assets, context.userId, admin));
    } catch (error) {
      return {
        ok: false,
        status: 400,
        message: error instanceof Error ? error.message : "El prompt no es válido.",
      };
    }
    const sceneLines = data.scenes
      .map((scene, index) => `Escena ${index + 1} (${scene.seconds}s): ${scene.text}`)
      .join("\n");
    const fullPrompt = `${resolved}\n\n${sceneLines}`.trim();
    if (blockedTerm(fullPrompt)) return { ok: false, status: 400, message: blockedMessage() };
    const model =
      process.env["FAL_VIDEO_MODEL"]?.trim() || "fal-ai/kling-video/v1.6/standard/text-to-video";
    const payload = {
      prompt: fullPrompt,
      duration: data.duration,
      camera_movement: data.cameraMovement,
      scenes: data.scenes.map((scene) => ({ text: scene.text, seconds: scene.seconds })),
      ...(data.seed !== undefined ? { seed: data.seed } : {}),
    };
    const result = await runFirefly(context.supabase, context.userId, {
      kind: "video",
      model,
      cost: CREDIT_COSTS.video,
      reason: "Video IA",
      title: titleFromPrompt(data.prompt),
      prompt: data.prompt,
      duration: data.duration,
      defaultMediaType: "video/mp4",
      expiresAt: await expiresAtFor(context.supabase, context.userId, claimsFrom(context)),
      produce: await falMedia(model, payload),
    });
    if (result.ok)
      return {
        ...result,
        label: "Cinemático Multi-Escena (un solo render)",
        stitched: true,
      };
    return result;
  });

export const generateFireflyVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FireflyVoiceInput) => {
    const text = validatePrompt(
      input?.text,
      "Escribe el texto que quieres convertir en voz.",
      MAX_VOICE_TEXT,
    );
    const voiceValues = FIREFLY_VOICE_STYLES.map((style) => style.value);
    const requestedVoice = input?.voice as (typeof voiceValues)[number];
    const voice = voiceValues.includes(requestedVoice) ? input.voice : "natural";
    const languageValues = FIREFLY_LANGUAGES.map((language) => language.value);
    const requestedLanguage = input?.language as (typeof languageValues)[number];
    const language = languageValues.includes(requestedLanguage) ? input.language : "es";
    const countryValues = FIREFLY_COUNTRIES.map((country) => country.value);
    const requestedCountry = input?.country as (typeof countryValues)[number];
    const country = countryValues.includes(requestedCountry) ? input.country : "ES";
    const accentValues = FIREFLY_ACCENTS.map((accent) => accent.value);
    const requestedAccent = input?.accent as (typeof accentValues)[number];
    const accent = accentValues.includes(requestedAccent) ? input.accent : "neutral";
    return {
      text,
      voice,
      language,
      country,
      accent,
      dubbingAudioPath: typeof input?.dubbingAudioPath === "string" ? input.dubbingAudioPath : null,
    };
  })
  .handler(async ({ data, context }): Promise<FireflyResult> => {
    const dubbingModel = process.env["FAL_DUBBING_MODEL"]?.trim();
    if (data.dubbingAudioPath && !dubbingModel)
      return {
        ok: false,
        status: 503,
        message:
          "El doblaje con archivo de origen no está configurado (FAL_DUBBING_MODEL). Puedes usar narración TTS sin subir audio.",
      };
    const admin = await getAdminClient();
    let audioUrl: string | null = null;
    try {
      const path = ownedPath(data.dubbingAudioPath, context.userId, ["dubbing"]);
      if (path) audioUrl = await signOwnedPath(admin, "uploads", path, context.userId, 3600);
    } catch (error) {
      return {
        ok: false,
        status: 400,
        message: error instanceof Error ? error.message : "El audio de origen no es válido.",
      };
    }
    const model = audioUrl
      ? dubbingModel!
      : process.env["FAL_VOICE_MODEL"]?.trim() || "fal-ai/elevenlabs/tts/turbo-v2.5";
    const payload = audioUrl
      ? {
          audio_url: audioUrl,
          target_language: data.language,
          target_country: data.country,
          accent: data.accent,
          script: data.text,
        }
      : {
          text: data.text,
          voice: data.voice,
          language: data.language,
          country: data.country,
          accent: data.accent,
        };
    return runFirefly(context.supabase, context.userId, {
      kind: "voice",
      model,
      cost: CREDIT_COSTS.song,
      reason: audioUrl ? "Doblaje IA" : "Voz IA",
      title: titleFromPrompt(data.text),
      prompt: data.text,
      duration: 0,
      defaultMediaType: "audio/mpeg",
      expiresAt: await expiresAtFor(context.supabase, context.userId, claimsFrom(context)),
      voiceType: audioUrl ? "dubbing" : data.voice,
      produce: await falMedia(model, payload),
    });
  });

export const captureVideoFrame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FireflyFrameCaptureInput) => {
    const videoSongId = typeof input?.videoSongId === "string" ? input.videoSongId.trim() : "";
    if (!videoSongId) throw new Error("Selecciona un video.");
    return { videoSongId, seconds: validateSeconds(input?.seconds) };
  })
  .handler(async ({ data, context }): Promise<FireflyFrameCaptureResult> => {
    const { data: video } = await context.supabase
      .from("songs")
      .select("id,storage_path,media_type,duration_seconds,status")
      .eq("id", data.videoSongId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (
      !video ||
      video.status !== "ready" ||
      !video.storage_path ||
      !video.media_type.startsWith("video/")
    )
      return { ok: false, status: 404, message: "Ese video no está disponible." };
    const seconds = Math.min(data.seconds, Math.max(0, video.duration_seconds - 0.1));
    try {
      const videoUrl = await signOwnedPath(
        context.supabase,
        "songs",
        video.storage_path,
        context.userId,
        600,
      );
      return {
        ok: true,
        videoUrl,
        seconds,
        duration: video.duration_seconds,
        mediaType: video.media_type,
      };
    } catch {
      return { ok: false, status: 403, message: "No se pudo abrir el video." };
    }
  });

export const cleanupExpiredMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FireflyCleanupResult> => {
    const admin = await getAdminClient();
    const { data: rows, error } = await admin
      .from("songs")
      .select("id,storage_path")
      .eq("user_id", context.userId)
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString());
    if (error) return { ok: false, status: 500, message: "No se pudo revisar la expiración." };
    const paths = (rows ?? [])
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path));
    if (paths.length) await admin.storage.from("songs").remove(paths);
    const ids = (rows ?? []).map((row) => row.id);
    if (ids.length) {
      const { error: deleteError } = await admin.from("songs").delete().in("id", ids);
      if (deleteError)
        return { ok: false, status: 500, message: "No se pudo eliminar el contenido caducado." };
    }
    return { ok: true, deleted: ids.length };
  });
