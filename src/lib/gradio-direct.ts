import { Client } from "@gradio/client";

export const HF_SPACES = {
  flux: "black-forest-labs/FLUX.1-schnell",
  wan21: "Wan-AI/Wan2.1-T2V-1.3B",
  ltxVideo: "Lightricks/LTX-Video",
} as const;

export const VIDEO_SPACES = [HF_SPACES.wan21, HF_SPACES.ltxVideo] as const;

const MUSIC_MODELS = [
  "facebook/musicgen-small",
  "facebook/musicgen-stereo-small",
  "facebook/musicgen-medium",
] as const;

const MUSIC_LOADING_WAIT_MS = 15_000;

const MUSIC_INFERENCE_URLS = [
  (model: string) => `https://huggingface.co/api/models/${model}/inference`,
  (model: string) => `https://api-inference.huggingface.co/models/${model}`,
] as const;

export type DirectMediaKind = "image" | "video" | "audio";

export type DirectFile = {
  blob: Blob;
  contentType: string;
  extension: string;
  filename: string;
  url: string;
};

export type DirectContext = {
  prompt: string;
  negativePrompt?: string;
  lyrics?: string;
  width: number;
  height: number;
  seed: number;
  randomizeSeed?: boolean;
  seconds: number;
  bpm: number;
  instrumental: boolean;
  steps: number;
};

type GradioParameter = {
  label?: string;
  parameter_name?: string;
  parameter_default?: unknown;
  component?: string;
};

type ApiEndpoint = {
  parameters: GradioParameter[];
  returns?: Array<{ label?: string; component?: string }>;
};

type ApiInfo = {
  named_endpoints: Record<string, ApiEndpoint>;
  unnamed_endpoints: Record<string, ApiEndpoint>;
};

const NEGATIVE_PROMPT =
  "worst quality, low quality, blurry, distorted, deformed, watermark, text, artifacts, jittery motion";

const MEDIA_LABEL: Record<DirectMediaKind, string> = {
  image: "imagen",
  video: "video",
  audio: "canción",
};

const FAKE_LABEL: Record<DirectMediaKind, string> = {
  image: "imagen falsa",
  video: "video falso",
  audio: "sonido falso",
};

const MEDIA_EXTENSION: Record<DirectMediaKind, RegExp> = {
  image: /\.(png|jpe?g|webp|gif)(?:\?|#|$)/i,
  video: /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i,
  audio: /\.(wav|mp3|flac|ogg|m4a|aac)(?:\?|#|$)/i,
};

function hfToken(): `hf_${string}` | undefined {
  const raw = import.meta.env["VITE_HF_TOKEN"] as string | undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? (value as `hf_${string}`) : undefined;
}

export function hasHfToken(): boolean {
  return Boolean(hfToken());
}

export async function connectDirectSpace(space: string): Promise<Client> {
  const token = hfToken();
  return Client.connect(space, token ? { hf_token: token } : {});
}

function parameterKey(parameter: GradioParameter): string {
  return `${parameter.label ?? ""} ${parameter.parameter_name ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function frameCount(seconds: number): number {
  return Math.min(161, Math.max(9, Math.round((seconds * 30) / 8) * 8 + 1));
}

function parameterValue(parameter: GradioParameter, context: DirectContext): unknown {
  const key = parameterKey(parameter);
  if (/negative/.test(key)) return context.negativePrompt ?? NEGATIVE_PROMPT;
  if (/randomize/.test(key)) return context.randomizeSeed ?? false;
  if (/caption|description|musiccaption|songdescription|prompt|text/.test(key)) return context.prompt;
  if (/lyrics|letra/.test(key))
    return context.instrumental ? "[inst]" : (context.lyrics ?? "");
  if (/bpm|tempo/.test(key)) return context.bpm;
  if (/duration|seconds|length/.test(key)) return context.seconds;
  if (/numframes|frames/.test(key)) return frameCount(context.seconds);
  if (/fps|framerate/.test(key)) return 24;
  if (/width/.test(key)) return context.width;
  if (/height/.test(key)) return context.height;
  if (/seed/.test(key)) return context.seed;
  if (/guidance|cfg/.test(key)) return parameter.parameter_default ?? 3;
  if (/steps|inference/.test(key)) return context.steps;
  if (/instrumental/.test(key)) return context.instrumental;
  if (/vocallanguage|language|idioma/.test(key)) return context.instrumental ? "unknown" : "en";
  if (/audioformat|format/.test(key)) return "wav";
  if (/batchsize/.test(key)) return 1;
  if (/timesignature/.test(key)) return "4";
  if (/keyscale|key/.test(key)) return "";
  return parameter.parameter_default ?? null;
}

const PREFERRED_ENDPOINTS: Record<DirectMediaKind, string[]> = {
  image: ["/infer", "/generate", "/text_to_image", "/txt2img"],
  video: ["/text_to_video", "/generate", "/infer", "/text2video"],
  audio: ["/generate", "/generate_music", "/text_to_music", "/text2music", "/infer"],
};

function scoreEndpoint(name: string, info: ApiEndpoint, kind: DirectMediaKind): number {
  const lower = name.toLowerCase();
  let score = 0;
  if (PREFERRED_ENDPOINTS[kind].some((preferred) => lower === preferred.toLowerCase())) score += 120;
  if (/generate|infer|predict|text2|txt2|createsong/.test(lower)) score += 50;
  if (/generationwrapper|generatemusic|text2music/.test(lower)) score += 60;
  if (kind === "image" && /image|flux|draw/.test(lower)) score += 25;
  if (kind === "video" && /video|ltx|motion/.test(lower)) score += 25;
  if (kind === "video" && /text2video|txt2video|textto/.test(lower)) score += 35;
  if (kind === "video" && /image2video|img2video|image_to_video/.test(lower)) score -= 60;
  if (kind === "audio" && /music|audio|song/.test(lower)) score += 25;
  if (kind === "audio" && /audio2audio|upload|extend/.test(lower)) score -= 60;
  if (/model|config|upload|token|credential|download|list|status|init/.test(lower)) score -= 90;
  const returns = info.returns ?? [];
  const hasAudio = returns.some((item) =>
    /audio|wav|mp3|flac|ogg|m4a/i.test(`${item.label ?? ""} ${item.component ?? ""}`),
  );
  const hasVideo = returns.some((item) =>
    /video|mp4|webm/i.test(`${item.label ?? ""} ${item.component ?? ""}`),
  );
  const hasImage = returns.some((item) =>
    /image|img|gallery/i.test(`${item.label ?? ""} ${item.component ?? ""}`),
  );
  if (kind === "audio" && hasAudio) score += 45;
  if (kind === "video" && hasVideo) score += 45;
  if (kind === "image" && hasImage) score += 45;
  if (kind === "video" && hasImage && !hasVideo) score -= 45;
  if (kind === "audio" && hasImage && !hasAudio) score -= 45;
  return score;
}

function selectGenerationEndpoint(
  entries: [string, ApiEndpoint][],
  kind: DirectMediaKind,
): [string, ApiEndpoint] | undefined {
  const candidates = entries.filter(([name]) => !/load_?example/i.test(name));
  let best: [string, ApiEndpoint] | undefined;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreEndpoint(candidate[0], candidate[1], kind);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best ?? candidates[0];
}

function mimeMatches(mime: string, kind: DirectMediaKind): boolean {
  if (kind === "image") return /image\//i.test(mime);
  if (kind === "video") return /video\//i.test(mime);
  return /audio\//i.test(mime);
}

function locateMedia(value: unknown, kind: DirectMediaKind): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^(https?:\/\/|data:|blob:|\/gradio_api\/file=|\/file=|\/tmp\/|tmp\/)/i.test(trimmed))
      return trimmed;
    return MEDIA_EXTENSION[kind].test(trimmed) ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = locateMedia(item, kind);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const mime = [record["mime_type"], record["mimeType"], record["content_type"]]
      .filter((item): item is string => typeof item === "string")
      .join(" ");
    const keys = ["url", "path", "name", "value", "data", "file", "video", "image", "audio"];
    if (mimeMatches(mime, kind)) {
      for (const key of keys) {
        const found = locateMedia(record[key], kind);
        if (found) return found;
      }
    }
    for (const key of keys) {
      const found = locateMedia(record[key], kind);
      if (found) return found;
    }
    for (const nested of Object.values(record)) {
      const found = locateMedia(nested, kind);
      if (found) return found;
    }
  }
  return undefined;
}

function spaceBase(space: string): string {
  return `https://${space.toLowerCase().replace(/[/.]/g, "-")}.hf.space`;
}

function resolveUrls(location: string, client: Client, space: string): string[] {
  const urls: string[] = [];
  if (/^(https?:|data:|blob:)/i.test(location)) urls.push(location);
  const root = client.config?.root_url ?? client.config?.root;
  if (root && /^https?:/i.test(root)) {
    try {
      urls.push(new URL(location, root).toString());
    } catch {}
    if (location.startsWith("/tmp/")) urls.push(`${root.replace(/\/$/, "")}/file=${location}`);
  }
  const base = spaceBase(space);
  try {
    urls.push(new URL(location, `${base}/`).toString());
  } catch {}
  if (location.startsWith("/tmp/")) urls.push(`${base}/file=${location}`);
  return [...new Set(urls)];
}

function extensionFor(kind: DirectMediaKind, url: string, mime: string): string {
  const match = url.match(MEDIA_EXTENSION[kind]);
  if (match?.[1]) {
    const value = match[1].toLowerCase();
    return value === "jpeg" ? "jpg" : value;
  }
  if (/mp4/i.test(mime)) return "mp4";
  if (/webm/i.test(mime)) return "webm";
  if (/wav/i.test(mime)) return "wav";
  if (/mpeg|mp3/i.test(mime)) return "mp3";
  return kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3";
}

async function downloadMedia(
  location: string,
  client: Client,
  space: string,
  kind: DirectMediaKind,
): Promise<DirectFile> {
  const urls = resolveUrls(location, client, space);
  let lastError: unknown;
  for (const url of urls) {
    try {
      const headers: Record<string, string> = {};
      const token = hfToken();
      if (token && /hf\.space|huggingface\.co/i.test(url)) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const blob = await response.blob();
      if (!blob.size) {
        lastError = new Error("EMPTY_FILE");
        continue;
      }
      const mime =
        blob.type || (kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg");
      const extension = extensionFor(kind, url, mime);
      return {
        blob,
        contentType: mime,
        extension,
        filename: `leudy-ia-${kind}.${extension}`,
        url,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DOWNLOAD_FAILED");
}

export async function generateDirectFile(options: {
  space: string;
  kind: DirectMediaKind;
  context: DirectContext;
  endpoint?: string;
  fallbackParams?: unknown[];
  rawParams?: unknown[];
}): Promise<DirectFile> {
  const client = await connectDirectSpace(options.space);
  try {
    const api = (await client.view_api()) as unknown as ApiInfo;
    const named = api.named_endpoints ?? {};
    const unnamed = api.unnamed_endpoints ?? {};
    const entries: [string, ApiEndpoint][] = [...Object.entries(named), ...Object.entries(unnamed)];
    let endpoint = options.endpoint ?? "";
    let selected = endpoint ? named[endpoint] ?? unnamed[endpoint] : undefined;
    if (!selected) {
      const fallback = selectGenerationEndpoint(entries, options.kind);
      if (fallback) {
        endpoint = fallback[0];
        selected = fallback[1];
      } else if (named["/predict"] ?? unnamed["/predict"]) {
        endpoint = "/predict";
      } else {
        throw new Error("NO_GENERATION_ENDPOINT");
      }
    }
    const parameters = selected?.parameters ?? [];
    const data =
      options.rawParams ??
      (parameters.length
        ? parameters.map((parameter) => parameterValue(parameter, options.context))
        : (options.fallbackParams ?? []));
    const prediction = await client.predict(
      /^\d+$/.test(endpoint) ? Number(endpoint) : endpoint,
      data,
    );
    const location = locateMedia(prediction?.data, options.kind);
    if (!location) throw new Error("NO_OUTPUT_FILE");
    return await downloadMedia(location, client, options.space, options.kind);
  } finally {
    try {
      client.close();
    } catch {}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferenceDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {}
  return body;
}

function isModelLoading(status: number, detail: string): boolean {
  return status === 503 && /loading|waking|starting|initializ/i.test(detail);
}

async function postMusicInference(url: string, prompt: string): Promise<Response> {
  const token = hfToken();
  if (!token) throw new Error("VITE_HF_TOKEN_MISSING");
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: prompt }),
  });
}

export async function generateDirectSongAudio(context: DirectContext): Promise<DirectFile> {
  const prompt = context.instrumental ? `${context.prompt} [inst]` : context.prompt;
  let lastError: unknown;
  for (const model of MUSIC_MODELS) {
    for (const buildUrl of MUSIC_INFERENCE_URLS) {
      const url = buildUrl(model);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await postMusicInference(url, prompt);
          if (response.ok) {
            const blob = await response.blob();
            if (!blob.size) throw new Error(`EMPTY_AUDIO_BLOB_${model}`);
            const mime = blob.type || "audio/mpeg";
            const extension = extensionFor("audio", url, mime);
            return {
              blob,
              contentType: mime,
              extension,
              filename: `leudy-ia-${model.replace(/[^a-z0-9]+/gi, "-")}.${extension}`,
              url: URL.createObjectURL(blob),
            };
          }
          const detail = inferenceDetail(await response.text().catch(() => ""));
          lastError = new Error(`HF_REST_${response.status}_${model}: ${detail || "sin detalle"}`);
          if (isModelLoading(response.status, detail) && attempt === 0) {
            await sleep(MUSIC_LOADING_WAIT_MS);
            continue;
          }
          break;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          if (/Failed to fetch|NetworkError|VITE_HF_TOKEN_MISSING/i.test(message)) break;
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MUSIC_REST_FAILED");
}

async function generateWan21WithGradio(context: DirectContext): Promise<DirectFile> {
  const rawParams = [context.prompt, "1280*720", 42, true];
  let lastError: unknown;
  for (const endpoint of ["/t2v_generation", "/predict"]) {
    try {
      return await generateDirectFile({
        space: HF_SPACES.wan21,
        kind: "video",
        context,
        endpoint,
        rawParams,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      lastError = new Error(`WAN21_${endpoint}: ${detail}`);
    }
  }
  try {
    return await generateDirectFile({ space: HF_SPACES.ltxVideo, kind: "video", context });
  } catch (error) {
    lastError = error;
  }
  throw lastError instanceof Error ? lastError : new Error("VIDEO_GRADIO_FAILED");
}

export function generateVideoWithGradio(context: DirectContext): Promise<DirectFile> {
  return generateWan21WithGradio(context);
}

export const generateDirectVideo = generateVideoWithGradio;

export function directErrorMessage(error: unknown, kind: DirectMediaKind): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).trim();
  if (kind === "audio" || kind === "video")
    return raw || `Error técnico desconocido al generar ${MEDIA_LABEL[kind]} con Hugging Face.`;
  const lower = raw.toLowerCase();
  const hours = 24 - new Date().getUTCHours();
  if (/quota|exhaust|rate.?limit|429|too many|zero.?gpu|gpu.*(limit|busy|time)|daily limit/i.test(lower))
    return `La cuota gratuita de ZeroGPU de Hugging Face se agotó por hoy. Se renueva en unas ${hours} horas (00:00 UTC). No se generó ningún ${FAKE_LABEL[kind]}; inténtalo más tarde.`;
  if (/401|403|unauthorized|forbidden|invalid token|credentials/i.test(lower))
    return "El token de Hugging Face no es válido o no tiene acceso al Space. Revisa VITE_HF_TOKEN.";
  if (/connect|network|fetch|timeout|sleeping|building|loading/i.test(lower))
    return "Hugging Face está iniciando el Space o no responde. Inténtalo de nuevo en unos segundos.";
  if (/no_generation_endpoint/i.test(lower))
    return `El Space no expone ningún endpoint de generación de ${MEDIA_LABEL[kind]} compatible. Inténtalo otra vez.`;
  if (/no_output_file|empty_file/i.test(lower))
    return `El Space no devolvió un archivo de ${MEDIA_LABEL[kind]} válido. Inténtalo otra vez.`;
  return `No se pudo generar la ${MEDIA_LABEL[kind]} con Hugging Face: ${raw.slice(0, 180) || "error desconocido"}`;
}
