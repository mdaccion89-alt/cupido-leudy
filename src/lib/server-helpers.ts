// Helpers used only inside server function handlers. Secrets are read per call, never at module scope.
import { Buffer } from "node:buffer";
import { Client } from "@gradio/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeServerUrl, parseTokenList } from "./music";

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

export async function getAceStepServerUrl(admin: Db): Promise<string | undefined> {
  const { data } = await admin
    .from("site_settings")
    .select("custom_sections")
    .eq("id", 1)
    .maybeSingle();
  const sections = data?.custom_sections;
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) return undefined;
  return normalizeServerUrl((sections as Record<string, unknown>)["aceStepServerUrl"]);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function aceStepParameterValue(
  parameter: { label?: string; parameter_name?: string; parameter_default?: unknown },
  context: { caption: string; lyrics: string; instrumental: boolean; bpm: number; duration: number },
): unknown {
  const key = `${parameter.label ?? ""} ${parameter.parameter_name ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (/caption|description|prompt|musiccaption|songdescription/.test(key)) return context.caption;
  if (/lyrics|letra/.test(key)) return context.lyrics;
  if (/bpm|tempo/.test(key)) return context.bpm;
  if (/duration|seconds|length/.test(key)) return context.duration;
  if (/instrumental/.test(key)) return context.instrumental;
  if (/vocallanguage|language|idioma/.test(key)) return context.instrumental ? "unknown" : "es";
  if (/audioformat|format/.test(key)) return "wav";
  if (/batchsize/.test(key)) return 1;
  if (/steps/.test(key)) return 8;
  if (/seed/.test(key)) return -1;
  if (/timesignature/.test(key)) return "4";
  if (/keyscale|key/.test(key)) return "";
  return parameter.parameter_default ?? null;
}

function scoreAceStepEndpoint(
  name: string,
  info: { returns?: Array<{ label?: string; component?: string }> } | undefined,
): number {
  const lower = name.toLowerCase();
  let score = 0;
  if (/generationwrapper|generatemusic|text2music|generate/.test(lower)) score += 100;
  if (/music|audio|song/.test(lower)) score += 30;
  if (/predict/.test(lower)) score += 10;
  if (/model|config|upload|token|credential/.test(lower)) score -= 80;
  if (
    info?.returns?.some((item) =>
      /audio|wav|mp3|flac|file/i.test(`${item.label ?? ""} ${item.component ?? ""}`),
    )
  )
    score += 40;
  return score;
}

function findGradioAudioLocation(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      /^(https?:\/\/|data:audio\/|\/tmp\/|tmp\/)|(\.(wav|mp3|flac|ogg|m4a)(\?|#|$))/i.test(trimmed)
    )
      return trimmed;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findGradioAudioLocation(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["url", "path", "name"]) {
      const found = findGradioAudioLocation(record[key]);
      if (found) return found;
    }
    for (const nested of Object.values(record)) {
      const found = findGradioAudioLocation(nested);
      if (found) return found;
    }
  }
  return undefined;
}

function resolveGradioAudioUrl(location: string, serverUrl: string): string {
  if (/^(https?:|data:audio\/)/i.test(location)) return location;
  if (location.startsWith("/file=") || location.startsWith("/gradio_api/file="))
    return `${serverUrl}${location}`;
  if (location.startsWith("/tmp/") || location.startsWith("tmp/")) {
    const normalized = location.startsWith("/") ? location : `/${location}`;
    return `${serverUrl}/file=${normalized}`;
  }
  try {
    return new URL(location, serverUrl).toString();
  } catch {
    return `${serverUrl}/file=${encodeURIComponent(location)}`;
  }
}

export async function generateAceStepAudio(input: {
  serverUrl: string;
  caption: string;
  lyrics: string;
  instrumental: boolean;
  bpm: number;
  duration: number;
}): Promise<GeneratedAudio> {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  if (!serverUrl) throw new Error("ACE_STEP_INVALID_URL");
  const context = {
    caption: input.caption.slice(0, 512),
    lyrics: (input.instrumental ? "[Instrumental]" : input.lyrics).slice(0, 4096),
    instrumental: input.instrumental,
    bpm: input.bpm,
    duration: input.duration,
  };
  const { client, api } = await withTimeout(
    (async () => {
      const connected = await Client.connect(serverUrl);
      return { client: connected, api: await connected.view_api() };
    })(),
    60_000,
    "ACE_STEP_CONNECT_TIMEOUT",
  );
  try {
    const endpoints = [
      ...Object.entries(api.named_endpoints),
      ...Object.entries(api.unnamed_endpoints),
    ];
    const selected = endpoints.sort((a, b) =>
      scoreAceStepEndpoint(b[0], b[1]) - scoreAceStepEndpoint(a[0], a[1]),
    )[0];
    const endpoint = selected?.[0] ?? "/predict";
    const parameters = selected?.[1]?.parameters ?? [];
    const data = parameters.length
      ? parameters.map((parameter) => aceStepParameterValue(parameter, context))
      : [
          context.caption,
          context.lyrics,
          context.bpm,
          "",
          "4",
          context.instrumental ? "unknown" : "es",
          8,
          1,
          true,
          "0",
          null,
          context.duration,
          1,
          null,
          "",
          0,
          -1,
          "",
          0.5,
          0.5,
          "text2music",
          true,
          0,
          1,
          3,
          "ode",
          "euler",
          1,
          0,
          "",
          "wav",
          "320k",
          44100,
          0.9,
          true,
          3,
          50,
          0.95,
          "",
          true,
          true,
          true,
          false,
          false,
          false,
          false,
          0.5,
          4,
          "vocals",
          [],
          true,
          -1,
          0,
          0,
          0,
          1,
          "balanced",
          0.5,
          false,
        ];
    const prediction = await withTimeout(
      client.predict(endpoint, data),
      600_000,
      "ACE_STEP_TIMEOUT",
    );
    const location = findGradioAudioLocation(prediction.data);
    if (!location) throw new Error("ACE_STEP_NO_AUDIO");
    const response = await withTimeout(
      fetch(resolveGradioAudioUrl(location, serverUrl)),
      120_000,
      "ACE_STEP_DOWNLOAD_TIMEOUT",
    );
    if (!response.ok) throw new Error(`ACE_STEP_DOWNLOAD_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("ACE_STEP_EMPTY_AUDIO");
    return audioFromBytes(bytes, response.headers.get("content-type") || "audio/mpeg");
  } finally {
    try {
      client.close();
    } catch {}
  }
}

export function synthesizeSongAudio(options: {
  bpm: number;
  seconds: number;
  seedText: string;
  genre?: string;
  chords?: string;
  instrumental?: boolean;
}): GeneratedAudio {
  const sampleRate = 16_000;
  const seconds = Math.max(1, Math.round(options.seconds));
  const sampleCount = sampleRate * seconds;
  const bpm = Math.min(240, Math.max(40, options.bpm || 110));
  const beat = 60 / bpm;
  const stepSeconds = beat / 4;
  const source = `${options.genre ?? ""} ${options.seedText ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let seed = 2166136261;
  for (let i = 0; i < source.length; i += 1)
    seed = Math.imul(seed ^ source.charCodeAt(i), 16777619) >>> 0;
  let rngState = seed || 1;
  const random = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 0xffffffff;
  };

  const profile = /bachata/.test(source)
    ? {
        kick: [0, 8],
        snare: [4, 12],
        hat: [2, 6, 10, 14],
        bass: [0, 8],
        arp: [0, 2, 4, 6, 8, 10, 12, 14],
        bongo: [12],
        damping: 0.996,
        pluckGain: 0.24,
        bassGain: 0.18,
        octave: 2,
      }
    : /reggaeton|regueton|dembow/.test(source)
      ? {
          kick: [0, 6, 8, 14],
          snare: [4, 12],
          hat: [0, 2, 4, 6, 8, 10, 12, 14],
          bass: [0, 6, 8, 14],
          arp: [0, 4, 8, 12],
          bongo: [],
          damping: 0.994,
          pluckGain: 0.2,
          bassGain: 0.26,
          octave: 1,
        }
      : /trap/.test(source)
        ? {
            kick: [0, 8, 11],
            snare: [8],
            hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            bass: [0, 3, 8, 11],
            arp: [0, 6, 12],
            bongo: [],
            damping: 0.997,
            pluckGain: 0.14,
            bassGain: 0.3,
            octave: 1,
          }
        : /salsa/.test(source)
          ? {
              kick: [0, 4, 8, 12],
              snare: [4, 12],
              hat: [2, 6, 10, 14],
              bass: [0, 3, 6, 8, 11, 14],
              arp: [0, 2, 4, 6, 8, 10, 12, 14],
              bongo: [4, 12],
              damping: 0.993,
              pluckGain: 0.22,
              bassGain: 0.2,
              octave: 1,
            }
          : /merengue/.test(source)
            ? {
                kick: [0, 2, 4, 6, 8, 10, 12, 14],
                snare: [4, 12],
                hat: [0, 2, 4, 6, 8, 10, 12, 14],
                bass: [0, 4, 8, 12],
                arp: [0, 4, 8, 12],
                bongo: [],
                damping: 0.995,
                pluckGain: 0.2,
                bassGain: 0.22,
                octave: 1,
              }
            : /balada|bolero|romantica/.test(source)
              ? {
                  kick: [0, 8],
                  snare: [4, 12],
                  hat: [2, 6, 10, 14],
                  bass: [0, 8],
                  arp: [0, 2, 4, 6, 8, 10, 12, 14],
                  bongo: [],
                  damping: 0.997,
                  pluckGain: 0.19,
                  bassGain: 0.15,
                  octave: 1,
                }
              : {
                  kick: [0, 8],
                  snare: [4, 12],
                  hat: [2, 6, 10, 14],
                  bass: [0, 8],
                  arp: [0, 2, 4, 6, 8, 10, 12, 14],
                  bongo: [],
                  damping: 0.995,
                  pluckGain: 0.2,
                  bassGain: 0.18,
                  octave: 1,
                };

  const semitones: Record<string, number> = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    Fb: 4,
    "E#": 5,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
    Cb: 11,
    "B#": 0,
  };
  const progression: number[][] = [];
  const chordMatches = [...(options.chords ?? "").matchAll(/([A-G])([#b]?)(m(?:aj|in)?|dim|aug|sus[24]|7)?/gi)];
  for (const match of chordMatches) {
    const rawRoot = `${match[1] ?? ""}${match[2] ?? ""}`;
    const root =
      rawRoot.length === 2 && rawRoot[1] === "b"
        ? `${rawRoot[0]?.toUpperCase()}b`
        : rawRoot.toUpperCase();
    const base = semitones[root];
    if (base === undefined) continue;
    const suffix = (match[3] ?? "").toLowerCase();
    const intervals = suffix.startsWith("dim")
      ? [0, 3, 6]
      : suffix.startsWith("aug")
        ? [0, 4, 8]
        : suffix.startsWith("m") && !suffix.startsWith("maj")
          ? [0, 3, 7]
          : [0, 4, 7];
    progression.push(
      intervals.map((interval) => {
        const midi = 60 + ((base + interval) % 12);
        return 440 * 2 ** ((midi - 69) / 12);
      }),
    );
  }
  if (!progression.length) {
    progression.push(
      [261.63, 329.63, 392.0],
      [196.0, 246.94, 392.0],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 349.23],
    );
  }
  if (progression.length > 8) progression.splice(8);

  const mix = new Float64Array(sampleCount);
  const pluckGain = profile.pluckGain * (options.instrumental ? 1.15 : 1);

  const writePluck = (
    frequency: number,
    startSample: number,
    lengthSamples: number,
    amplitude: number,
  ) => {
    if (startSample < 0 || startSample >= sampleCount || lengthSamples <= 0) return;
    const delay = Math.max(2, Math.min(2048, Math.round(sampleRate / frequency)));
    const line = new Float32Array(delay);
    for (let i = 0; i < delay; i += 1) line[i] = random() * 2 - 1;
    let index = 0;
    const end = Math.min(sampleCount, startSample + lengthSamples);
    for (let i = startSample; i < end; i += 1) {
      const current = line[index] ?? 0;
      const next = line[(index + 1) % delay] ?? 0;
      line[index] = profile.damping * 0.5 * (current + next);
      index = (index + 1) % delay;
      const age = i - startSample;
      const envelope = Math.min(1, age / 40) * Math.max(0, 1 - age / lengthSamples);
      mix[i] = (mix[i] ?? 0) + current * amplitude * envelope;
    }
  };

  const writeKick = (startSample: number, amplitude: number) => {
    const length = Math.floor(sampleRate * 0.2);
    let phase = 0;
    for (let i = 0; i < length; i += 1) {
      const position = startSample + i;
      if (position >= sampleCount) break;
      const p = i / length;
      phase += (2 * Math.PI * (110 - 70 * p)) / sampleRate;
      mix[position] = (mix[position] ?? 0) + Math.sin(phase) * (1 - p) * amplitude;
    }
  };

  const writeHit = (
    startSample: number,
    lengthSeconds: number,
    amplitude: number,
    decay: number,
    tone: number,
  ) => {
    const length = Math.max(1, Math.floor(sampleRate * lengthSeconds));
    for (let i = 0; i < length; i += 1) {
      const position = startSample + i;
      if (position >= sampleCount) break;
      const p = i / length;
      const noise = random() * 2 - 1;
      const body = tone ? Math.sin((2 * Math.PI * tone * i) / sampleRate) * 0.45 : 0;
      mix[position] =
        (mix[position] ?? 0) + (noise * 0.7 + body) * Math.exp(-p * decay) * amplitude;
    }
  };

  const totalSteps = Math.ceil(seconds / stepSeconds);
  for (let step = 0; step < totalSteps; step += 1) {
    const inBar = step % 16;
    const chord = progression[Math.floor(step / 16) % progression.length] ?? progression[0] ?? [];
    const start = Math.floor(step * stepSeconds * sampleRate);
    if (profile.arp.includes(inBar)) {
      const note = chord[Math.floor(step / 2) % chord.length] ?? chord[0] ?? 261.63;
      writePluck(
        note * profile.octave,
        start,
        Math.floor(sampleRate * stepSeconds * 3),
        pluckGain,
      );
    }
    if (profile.bass.includes(inBar)) {
      writePluck(
        (chord[0] ?? 130.81) / 2,
        start,
        Math.floor(sampleRate * beat * 1.5),
        profile.bassGain,
      );
    }
    if (profile.kick.includes(inBar)) writeKick(start, 0.5);
    if (profile.snare.includes(inBar)) writeHit(start, 0.14, 0.28, 9, 190);
    if (profile.hat.includes(inBar)) writeHit(start, 0.04, 0.1, 18, 0);
    if (profile.bongo.includes(inBar)) writeHit(start, 0.09, 0.22, 14, 240);
  }

  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + sampleCount * 2, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const value = Math.max(-1, Math.min(1, mix[i] ?? 0));
    wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return audioFromBytes(new Uint8Array(wav), "audio/wav");
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
