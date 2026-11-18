import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CREDIT_COSTS, creditErrorMessage } from "@/lib/credits";
import { findBlockedArtist, sanitizePrompt, titleFromPrompt } from "@/lib/music";
import {
  falErrorMessage,
  falSubmit,
  falWait,
  failCreation,
  getAdminClient,
  signOwnedPath,
  type Db,
  type FalSubmit,
} from "@/lib/server-helpers";

export const FIREFLY_IMAGE_SIZES = ["16:9", "9:16", "1:1"] as const;

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

export type FireflyAsset = { name: string; description: string };
export type FireflyScene = { text: string; seconds: number };
export type FireflyImageSize = (typeof FIREFLY_IMAGE_SIZES)[number];
export type FireflyResult =
  | { ok: true; songId: string; url: string; mediaType: string }
  | { ok: false; status: number; message: string };

export type FireflyImageInput = {
  prompt: string;
  imageSize: string;
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
export type FireflyVoiceInput = { text: string; voice: string; language: string; country: string };

type FireflyKind = "image" | "video" | "voice";
type MediaSource = { url: string } | { base64: string; mime?: string };
type DownloadedMedia = { bytes: Uint8Array; contentType: string };

const MAX_ASSETS = 20;
const MAX_SCENES = 12;
const MAX_PROMPT = 1200;
const MAX_VOICE_TEXT = 4000;

function validatePrompt(value: unknown, message: string, max = MAX_PROMPT): string {
  const text = typeof value === "string" ? sanitizePrompt(value, max) : "";
  if (text.length < 3) throw new Error(message);
  const blocked = findBlockedArtist(text);
  if (blocked)
    throw new Error(
      `No podemos imitar ni nombrar a artistas reales como ${blocked}. Usa una descripción original.`,
    );
  return text;
}

function validateSeed(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error("La semilla debe ser un número entero entre 0 y 2147483647.");
  return seed;
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
    return { name, description };
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
    const blocked = findBlockedArtist(text);
    if (blocked)
      throw new Error(
        `No podemos imitar ni nombrar a artistas reales como ${blocked}. Usa una descripción original.`,
      );
    return { text, seconds: Math.round(seconds) };
  });
  if (scenes.reduce((sum, scene) => sum + scene.seconds, 0) > 60)
    throw new Error("El total de las escenas no puede superar los 60 segundos.");
  return scenes;
}

function applyAssets(prompt: string, assets: FireflyAsset[]): string {
  let resolved = prompt;
  const missing: string[] = [];
  for (const asset of assets) {
    const token = `@${asset.name}`;
    const description = `${asset.name}: ${asset.description}`;
    if (resolved.includes(token)) resolved = resolved.split(token).join(description);
    else missing.push(description);
  }
  if (missing.length) return `${resolved}\n\nPersonajes y elementos:\n${missing.join("\n")}`.trim();
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

function providerFailure(error: unknown): { status: number; message: string } {
  const code = error instanceof Error ? error.message : String(error ?? "");
  const numeric = code.match(/^FAL_(\d{3})$/);
  if (numeric) return { status: Number(numeric[1]), message: falErrorMessage(code) };
  if (code === "FAL_NOT_CONFIGURED") return { status: 503, message: falErrorMessage(code) };
  if (code === "FAL_TIMEOUT") return { status: 504, message: falErrorMessage(code) };
  return { status: 502, message: code || falErrorMessage(code) };
}

async function videosEnabled(supabase: Db): Promise<boolean> {
  const { data } = await supabase
    .from("site_settings")
    .select("videos_enabled")
    .eq("id", 1)
    .maybeSingle();
  return data ? Boolean(data.videos_enabled) : true;
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
  payload: Record<string, unknown>;
  voiceType?: string;
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
    const job: FalSubmit = await falSubmit(config.model, config.payload);
    await admin
      .from("songs")
      .update({
        external_job_id: job.request_id,
        external_status_url: job.status_url,
        external_response_url: job.response_url,
      })
      .eq("id", row.id);

    const output = await falWait(job.response_url);
    const source = findMediaSource(output);
    if (!source)
      throw new Error("La respuesta de Fal.ai no contenía una imagen, video o audio válido.");
    const media = await downloadMedia(source);
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

export const generateFireflyImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FireflyImageInput) => {
    const prompt = validatePrompt(input?.prompt, "Describe la imagen que quieres crear.");
    const size = input?.imageSize as FireflyImageSize;
    const imageSize = FIREFLY_IMAGE_SIZES.includes(size) ? size : "16:9";
    const seed = validateSeed(input?.seed);
    const assets = validateAssets(input?.assets);
    return { prompt, imageSize, seed, assets, resolved: applyAssets(prompt, assets) };
  })
  .handler(async ({ data, context }): Promise<FireflyResult> => {
    const model = process.env["FAL_IMAGE_MODEL"]?.trim() || "fal-ai/flux/dev";
    return runFirefly(context.supabase, context.userId, {
      kind: "image",
      model,
      cost: CREDIT_COSTS.song,
      reason: "Imagen IA",
      title: titleFromPrompt(data.prompt),
      prompt: data.prompt,
      duration: 0,
      defaultMediaType: "image/png",
      payload: {
        prompt: data.resolved,
        image_size: data.imageSize,
        ...(data.seed !== undefined ? { seed: data.seed } : {}),
      },
    });
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
    const resolved = applyAssets(prompt, assets);
    const sceneLines = scenes
      .map((scene, index) => `Escena ${index + 1} (${scene.seconds}s): ${scene.text}`)
      .join("\n");
    return {
      prompt,
      scenes,
      seed,
      cameraMovement,
      resolved,
      fullPrompt: `${resolved}\n\n${sceneLines}`.trim(),
      duration: scenes.reduce((sum, scene) => sum + scene.seconds, 0),
    };
  })
  .handler(async ({ data, context }): Promise<FireflyResult> => {
    const model =
      process.env["FAL_VIDEO_MODEL"]?.trim() || "fal-ai/kling-video/v1.6/standard/text-to-video";
    return runFirefly(context.supabase, context.userId, {
      kind: "video",
      model,
      cost: CREDIT_COSTS.video,
      reason: "Video IA",
      title: titleFromPrompt(data.prompt),
      prompt: data.prompt,
      duration: data.duration,
      defaultMediaType: "video/mp4",
      payload: {
        prompt: data.fullPrompt,
        duration: data.duration,
        camera_movement: data.cameraMovement,
        scenes: data.scenes.map((scene) => ({ text: scene.text, seconds: scene.seconds })),
        ...(data.seed !== undefined ? { seed: data.seed } : {}),
      },
    });
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
    return { text, voice, language, country };
  })
  .handler(async ({ data, context }): Promise<FireflyResult> => {
    const model = process.env["FAL_VOICE_MODEL"]?.trim() || "fal-ai/elevenlabs/tts/turbo-v2.5";
    return runFirefly(context.supabase, context.userId, {
      kind: "voice",
      model,
      cost: CREDIT_COSTS.song,
      reason: "Voz IA",
      title: titleFromPrompt(data.text),
      prompt: data.text,
      duration: 0,
      defaultMediaType: "audio/mpeg",
      voiceType: data.voice,
      payload: {
        text: data.text,
        voice: data.voice,
        language: data.language,
        country: data.country,
      },
    });
  });
