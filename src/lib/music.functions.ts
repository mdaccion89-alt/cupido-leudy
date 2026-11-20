import { Buffer } from "node:buffer";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findBlockedTerm } from "./copyright";
import { CREDIT_COSTS, creditErrorMessage } from "./credits";
import {
  INSTRUMENTAL,
  MAX_ADVANCED_LENGTH,
  MAX_GENRE_LENGTH,
  MAX_LYRICS_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  buildMusicPrompt,
  findBlockedArtist,
  isBpm,
  isCreationMode,
  isDuration,
  isEngineId,
  isGenre,
  isStudioMode,
  isVoiceType,
  normalizeServerUrl,
  sanitizePrompt,
  titleFromPrompt,
  type AdvancedParams,
  type CreationMode,
  type DurationSeconds,
  type EngineId,
  type Genre,
  type StudioMode,
  type VoiceType,
} from "./music";
import {
  failCreation,
  generateAceStepAudio,
  geminiText,
  getAceStepServerUrl,
  getAdminClient,
  pollinationsText,
  synthesizeSongAudio,
  type GeneratedAudio,
} from "./server-helpers";

type GenerateInput = {
  prompt: string;
  lyrics?: string;
  title?: string;
  genre: Genre;
  voice: VoiceType;
  bpm: number;
  duration: DurationSeconds;
  mode?: StudioMode;
  engine?: EngineId;
  creationMode?: CreationMode;
  advanced?: AdvancedParams;
  aceStepServerUrl?: string;
};

const ACE_STEP_PUBLIC_SPACES = ["https://ace-step-ace-step.hf.space"] as const;

const MUSICAPI_CREATE_URL = "https://api.musicapi.ai/api/v1/sonic/create";
const MUSICAPI_POLL_BASE = "https://musicapi.ai";
const MUSICAPI_POLL_MS = 4_000;
const MUSICAPI_TIMEOUT_MS = 90_000;

type MusicApiInput = {
  prompt: string;
  title?: string;
  tags?: string;
  instrumental?: boolean;
};

type MusicApiResult =
  | { ok: true; audio: string; audioUrl: string; mime: string; extension: string; model: string }
  | { ok: false; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function musicApiTaskUrl(taskId: string): string {
  return `${MUSICAPI_POLL_BASE}${taskId}`;
}

async function readJsonResponse(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const hasJsonShape = /^\s*[{[]/.test(text);
  if (!/application\/(?:[\w.-]+\+)?json/i.test(contentType) && !hasJsonShape)
    throw new Error(
      `MUSICAPI_NON_JSON status=${response.status} url=${url} body=${text.slice(0, 150)}`,
    );
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `MUSICAPI_INVALID_JSON status=${response.status} url=${url} body=${text.slice(0, 150)}`,
    );
  }
}

function apiDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown; detail?: unknown };
    const value = parsed.message ?? parsed.error ?? parsed.detail;
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {}
  return body.slice(0, 300);
}

function pickString(value: unknown, ...path: string[]): string {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : "";
}

function blockedTermLabel(match: unknown): string {
  const record = match as Record<string, unknown> | null;
  const term =
    record?.["term"] ??
    record?.["match"] ??
    record?.["matchedTerm"] ??
    record?.["value"] ??
    record?.["text"];
  return typeof term === "string" && term.trim() ? term.trim() : "término no permitido";
}

function sanitizeAdvanced(value: unknown): AdvancedParams | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const advanced: AdvancedParams = {
    key: typeof input["key"] === "string" ? sanitizePrompt(input["key"], MAX_ADVANCED_LENGTH) : "",
    mood:
      typeof input["mood"] === "string" ? sanitizePrompt(input["mood"], MAX_ADVANCED_LENGTH) : "",
    instruments:
      typeof input["instruments"] === "string"
        ? sanitizePrompt(input["instruments"], MAX_ADVANCED_LENGTH)
        : "",
    extra:
      typeof input["extra"] === "string" ? sanitizePrompt(input["extra"], MAX_ADVANCED_LENGTH) : "",
  };
  return Object.values(advanced).some(Boolean) ? advanced : undefined;
}

type SongText = {
  letra: string;
  acordes: string;
  estructura: string;
};

function parseSongText(value: string, instrumental = false): SongText {
  const cleaned = value.replace(/```json/gi, "").replace(/```/g, "").trim();
  const defaultAcordes = "C - G - Am - F (repetir)";
  const defaultEstructura = instrumental
    ? "Intro instrumental - Arpegio de requinto - Crescendo - Solos de guitarra - Outro"
    : "Intro - Verso - Coro - Verso - Coro - Outro";
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const letra = typeof parsed["letra"] === "string" ? parsed["letra"].trim() : "";
    const acordes = typeof parsed["acordes"] === "string" ? parsed["acordes"].trim() : "";
    const estructura = typeof parsed["estructura"] === "string" ? parsed["estructura"].trim() : "";
    if (letra || instrumental)
      return {
        letra: instrumental ? "" : letra.slice(0, MAX_LYRICS_LENGTH),
        acordes: acordes || defaultAcordes,
        estructura: estructura || defaultEstructura,
      };
  } catch {}
  return {
    letra: instrumental ? "" : cleaned.slice(0, MAX_LYRICS_LENGTH),
    acordes: defaultAcordes,
    estructura: instrumental ? cleaned.slice(0, MAX_LYRICS_LENGTH) || defaultEstructura : defaultEstructura,
  };
}

function localSongText(prompt: string, instrumental: boolean): SongText {
  const idea = prompt.trim().slice(0, 300) || "Una canción original";
  return {
    letra: instrumental
      ? ""
      : `[Verso 1]\n${idea}\n[Coro]\n${idea}\n[Outro]`.slice(0, MAX_LYRICS_LENGTH),
    acordes: "C - G - Am - F (repetir)",
    estructura: instrumental
      ? `Intro instrumental - Desarrollo - Clímax - Outro. ${idea}`.slice(0, MAX_LYRICS_LENGTH)
      : "Intro - Verso - Coro - Verso - Coro - Outro",
  };
}

async function songText(prompt: string, instrumental: boolean): Promise<SongText> {
  const system = instrumental
    ? 'Eres arreglista instrumental de música latina. Devuelve SOLO un objeto JSON válido con las claves "acordes" y "estructura". "acordes": progresión armónica en notación C/G/Am/F que sirva de base a guitarra acústica, requinto y percusión. "estructura": secuencia de secciones instrumentales con arreglos de guitarra, requinto, arpegios y percusión. NO escribas letra, versos, coros ni ninguna voz cantada. Sin markdown y sin explicaciones.'
    : 'Eres compositor profesional de música latina. Devuelve SOLO un objeto JSON válido con las claves "letra", "acordes" y "estructura". "letra": letra completa y original en español con secciones [Intro], [Verso 1], [Pre-Coro], [Coro], [Verso 2], [Puente] y [Outro]. "acordes": progresión por sección en notación C/G/Am/F. "estructura": orden de secciones con duración aproximada. Sin markdown, sin explicaciones y sin artistas reales.';
  try {
    return parseSongText(await geminiText(system, prompt), instrumental);
  } catch (error) {
    console.warn("gemini song text failed, trying pollinations", error);
  }
  try {
    return parseSongText(await pollinationsText(`${system}\n\n${prompt}`), instrumental);
  } catch (error) {
    console.warn("pollinations song text failed, using local text", error);
  }
  return localSongText(prompt, instrumental);
}

type DirectSongInput = {
  prompt: string;
  lyrics?: string;
  title?: string;
  genre: Genre;
  voice: VoiceType;
  bpm: number;
  duration: DurationSeconds;
  mode?: StudioMode;
  creationMode?: CreationMode;
  advanced?: AdvancedParams;
};

export type PreparedDirectSong =
  | {
      ok: true;
      title: string;
      caption: string;
      lyrics: string;
      chords: string;
      structure: string;
    }
  | { ok: false; status: number; message: string };

function parsePreparedSong(
  raw: string,
  fallback: { caption: string; lyrics: string },
): { caption: string; lyrics: string; chords: string; structure: string } {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const caption = typeof parsed["caption"] === "string" ? parsed["caption"].trim() : "";
    const lyrics = typeof parsed["lyrics"] === "string" ? parsed["lyrics"].trim() : "";
    const chords = typeof parsed["chords"] === "string" ? parsed["chords"].trim() : "";
    const structure = typeof parsed["structure"] === "string" ? parsed["structure"].trim() : "";
    if (caption || lyrics)
      return {
        caption: caption.slice(0, 700) || fallback.caption,
        lyrics: lyrics.slice(0, MAX_LYRICS_LENGTH),
        chords: chords.slice(0, 300),
        structure: structure.slice(0, 300),
      };
  } catch {}
  return {
    caption: fallback.caption,
    lyrics: cleaned.slice(0, MAX_LYRICS_LENGTH),
    chords: "",
    structure: "",
  };
}

export const prepareDirectSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: DirectSongInput) => {
    const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
    const lyrics = typeof input?.lyrics === "string" ? input.lyrics.trim() : "";
    const title =
      typeof input?.title === "string" ? sanitizePrompt(input.title, MAX_TITLE_LENGTH) : "";
    if (prompt.length < 3 && lyrics.length < 3)
      throw new Error("Describe tu canción o escribe una letra.");
    if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("La descripción es demasiado larga.");
    if (lyrics.length > MAX_LYRICS_LENGTH) throw new Error("La letra es demasiado larga.");
    const advanced = sanitizeAdvanced(input.advanced);
    const genre =
      typeof input.genre === "string" ? sanitizePrompt(input.genre, MAX_GENRE_LENGTH) : "";
    if (!isGenre(genre)) throw new Error("Género no válido.");
    if (!isVoiceType(input.voice)) throw new Error("Tipo de voz no válido.");
    if (!isBpm(input.bpm)) throw new Error("BPM no válido.");
    if (!isDuration(input.duration)) throw new Error("Duración no válida.");
    if (input.mode !== undefined && !isStudioMode(input.mode))
      throw new Error("Modo de estudio no válido.");
    if (input.creationMode !== undefined && !isCreationMode(input.creationMode))
      throw new Error("Modo de creación no válido.");
    return {
      prompt,
      lyrics,
      title,
      genre,
      voice: input.voice,
      bpm: input.bpm,
      duration: input.duration,
      mode: input.mode,
      creationMode: input.creationMode ?? "simple",
      advanced,
    };
  })
  .handler(async ({ data }): Promise<PreparedDirectSong> => {
    const advancedText = data.advanced
      ? Object.values(data.advanced).filter(Boolean).join("\n")
      : "";
    const blocked = findBlockedTerm(
      [data.title, data.prompt, data.lyrics, data.genre, advancedText].filter(Boolean).join("\n"),
    );
    if (blocked)
      return {
        ok: false,
        status: 400,
        message: `El texto contiene el término no permitido «${blockedTermLabel(blocked)}». Usa una descripción original.`,
      };

    const musicPrompt = buildMusicPrompt({
      description: data.prompt,
      lyrics: data.lyrics,
      genre: data.genre,
      voice: data.voice,
      bpm: data.bpm,
      seconds: data.duration,
      ...(data.mode ? { mode: data.mode } : {}),
      engine: "ace-step",
      creationMode: data.creationMode,
      ...(data.advanced ? { advanced: data.advanced } : {}),
    });
    const instrumental = data.voice === INSTRUMENTAL;
    const system = instrumental
      ? 'You are a music producer writing prompts for ACE-Step. Reply with ONLY one valid JSON object with keys "caption", "lyrics", "chords" and "structure". "caption": a single concise English music caption under 400 characters with genre, mood, instruments, tempo, production and structure tags; no artist names. "lyrics": empty string. "chords": short English chord progression. "structure": short English section list. No markdown, no explanations.'
      : 'You are a songwriter writing prompts for ACE-Step. Reply with ONLY one valid JSON object with keys "caption", "lyrics", "chords" and "structure". "caption": a single concise English music caption under 400 characters with genre, mood, instruments, tempo, production and structure tags; no artist names. "lyrics": complete original song lyrics in English with [Verse 1], [Chorus], [Verse 2] and [Outro] sections. "chords": short English chord progression. "structure": short English section list. No markdown, no explanations.';
    const user = `${musicPrompt}\n\nUser idea: ${data.prompt}\nUser lyrics: ${data.lyrics || "none"}\nTitle: ${data.title || "none"}`;
    let raw = "";
    try {
      raw = await geminiText(system, user);
    } catch (error) {
      console.warn("gemini direct song prep failed, trying pollinations", error);
      try {
        raw = await pollinationsText(`${system}\n\n${user}`);
      } catch (fallbackError) {
        console.warn("pollinations direct song prep failed, using local caption", fallbackError);
      }
    }
    const parsed = parsePreparedSong(raw, { caption: musicPrompt, lyrics: data.lyrics });
    const local = localSongText(musicPrompt, instrumental);
    return {
      ok: true,
      title: data.title || titleFromPrompt(data.prompt || data.lyrics),
      caption: parsed.caption || musicPrompt,
      lyrics: instrumental ? "[inst]" : parsed.lyrics || data.lyrics || local.letra,
      chords: parsed.chords || local.acordes,
      structure: parsed.structure || local.estructura,
    };
  });

export const generateMusicApiSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: MusicApiInput) => {
    const prompt =
      typeof input?.prompt === "string"
        ? sanitizePrompt(input.prompt, MAX_LYRICS_LENGTH).trim()
        : "";
    if (!prompt) throw new Error("Escribe una letra o una descripción.");
    return {
      prompt,
      title:
        typeof input?.title === "string"
          ? sanitizePrompt(input.title, MAX_TITLE_LENGTH).trim() || "Canción"
          : "Canción",
      tags: typeof input?.tags === "string" ? sanitizePrompt(input.tags, MAX_GENRE_LENGTH).trim() : "",
      instrumental: Boolean(input?.instrumental),
    };
  })
  .handler(async ({ data }): Promise<MusicApiResult> => {
    const key = process.env.MUSICAPI_KEY;
    if (!key) return { ok: false, message: "MUSICAPI_KEY no está configurado en el servidor." };
    const customMode = !data.instrumental;
    const payload = customMode
      ? {
          task_type: "create_music",
          custom_mode: true,
          prompt: data.prompt,
          tags: data.tags,
          title: data.title,
          make_instrumental: false,
          mv: "sonic-v5",
        }
      : {
          task_type: "create_music",
          custom_mode: false,
          gpt_description_prompt: data.prompt,
          make_instrumental: true,
          mv: "sonic-v5",
        };
    const response = await fetch(MUSICAPI_CREATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    let created: unknown;
    try {
      created = await readJsonResponse(response, MUSICAPI_CREATE_URL);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (!response.ok)
      return {
        ok: false,
        message: `MUSICAPI_${response.status}: ${apiDetail(JSON.stringify(created))}`,
      };
    const taskId =
      pickString(created, "task_id") ||
      pickString(created, "id") ||
      pickString(created, "taskId") ||
      pickString(created, "data", "task_id") ||
      pickString(created, "data", "id") ||
      pickString(created, "data", "taskId");
    if (!taskId)
      return { ok: false, message: `MUSICAPI_TASK_ID: ${apiDetail(JSON.stringify(created))}` };
    const deadline = Date.now() + MUSICAPI_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      await sleep(MUSICAPI_POLL_MS);
      const pollUrl = musicApiTaskUrl(taskId);
      const pollResponse = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${key}` },
      });
      let pollJson: unknown;
      try {
        pollJson = await readJsonResponse(pollResponse, pollUrl);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      if (!pollResponse.ok)
        return {
          ok: false,
          message: `MUSICAPI_POLL_${pollResponse.status}: ${apiDetail(JSON.stringify(pollJson))}`,
        };
      const audioUrl =
        pickString(pollJson, "audio_url") ||
        pickString(pollJson, "audioUrl") ||
        pickString(pollJson, "data", "audio_url") ||
        pickString(pollJson, "data", "audioUrl") ||
        pickString(pollJson, "data", "0", "audio_url") ||
        pickString(pollJson, "data", "0", "audioUrl") ||
        pickString(pollJson, "result", "audio_url") ||
        pickString(pollJson, "result", "audioUrl") ||
        pickString(pollJson, "output", "audio_url");
      if (!audioUrl) {
        const status =
          pickString(pollJson, "status") ||
          pickString(pollJson, "data", "status") ||
          pickString(pollJson, "result", "status");
        if (/fail|error|cancel|reject/i.test(status))
          return { ok: false, message: `MUSICAPI_${status}: ${apiDetail(JSON.stringify(pollJson))}` };
        continue;
      }
      let audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok)
        audioResponse = await fetch(audioUrl, { headers: { Authorization: `Bearer ${key}` } });
      if (!audioResponse.ok)
        return { ok: false, message: `MUSICAPI_AUDIO_${audioResponse.status}` };
      const bytes = new Uint8Array(await audioResponse.arrayBuffer());
      if (!bytes.length) return { ok: false, message: "MUSICAPI_EMPTY_AUDIO" };
      return {
        ok: true,
        audio: `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`,
        audioUrl,
        mime: "audio/mpeg",
        extension: "mp3",
        model: "sonic-v5",
      };
    }
    return { ok: false, message: `MUSICAPI_TIMEOUT: tarea ${taskId} tardó más de 90 s.` };
  });

export type ActionResult =
  | { ok: true; songId: string }
  | { ok: false; status: number; message: string };

export type GenerateSongResult =
  | {
      ok: true;
      songId: string;
      title: string;
      genre: Genre;
      bpm: number;
      duration: DurationSeconds;
      lyrics: string;
      chords: string;
      structure: string;
      audioBase64: string;
      mediaType: string;
      saved: boolean;
      warning?: string;
    }
  | { ok: false; status: number; message: string };

function localWavSongResult(input: {
  data: { genre: Genre; bpm: number; duration: DurationSeconds; voice: VoiceType };
  text: SongText;
  title: string;
  musicPrompt: string;
}): Extract<GenerateSongResult, { ok: true }> {
  const generated = synthesizeSongAudio({
    bpm: input.data.bpm,
    seconds: input.data.duration,
    seedText: input.musicPrompt,
    genre: input.data.genre,
    chords: input.text.acordes,
    instrumental: input.data.voice === INSTRUMENTAL,
  });
  return {
    ok: true,
    songId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    genre: input.data.genre,
    bpm: input.data.bpm,
    duration: input.data.duration,
    lyrics: input.text.letra,
    chords: input.text.acordes,
    structure: input.text.estructura,
    audioBase64: Buffer.from(generated.bytes).toString("base64"),
    mediaType: generated.contentType,
    saved: false,
    warning: "No se pudo guardar en la nube; la canción se guardó solo en este dispositivo.",
  };
}

export const generateSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenerateInput) => {
    const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
    const lyrics = typeof input?.lyrics === "string" ? input.lyrics.trim() : "";
    const title =
      typeof input?.title === "string" ? sanitizePrompt(input.title, MAX_TITLE_LENGTH) : "";
    if (prompt.length < 3 && lyrics.length < 3)
      throw new Error("Describe tu canción o escribe una letra.");
    if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("La descripción es demasiado larga.");
    if (lyrics.length > MAX_LYRICS_LENGTH) throw new Error("La letra es demasiado larga.");
    const advanced = sanitizeAdvanced(input.advanced);
    const genre =
      typeof input.genre === "string" ? sanitizePrompt(input.genre, MAX_GENRE_LENGTH) : "";
    const blocked = findBlockedArtist(
      `${title}\n${prompt}\n${lyrics}\n${genre}\n${advanced ? Object.values(advanced).join("\n") : ""}`,
    );
    if (blocked)
      throw new Error(
        `No podemos imitar ni nombrar a artistas reales como ${blocked}. Usa una descripción original.`,
      );
    if (!isGenre(genre)) throw new Error("Género no válido.");
    if (!isVoiceType(input.voice)) throw new Error("Tipo de voz no válido.");
    if (!isBpm(input.bpm)) throw new Error("BPM no válido.");
    if (!isDuration(input.duration)) throw new Error("Duración no válida.");
    if (input.mode !== undefined && !isStudioMode(input.mode))
      throw new Error("Modo de estudio no válido.");
    if (input.engine !== undefined && !isEngineId(input.engine))
      throw new Error("Motor de generación no válido.");
    if (input.creationMode !== undefined && !isCreationMode(input.creationMode))
      throw new Error("Modo de creación no válido.");
    if (input.creationMode === "custom" && !advanced)
      throw new Error("Añade al menos un ajuste avanzado en modo Personalizado.");
    return {
      prompt,
      lyrics,
      title,
      genre,
      voice: input.voice,
      bpm: input.bpm,
      duration: input.duration,
      mode: input.mode,
      engine: input.engine ?? "musicgen-free",
      creationMode: input.creationMode ?? "simple",
      advanced,
      aceStepServerUrl: normalizeServerUrl(input.aceStepServerUrl),
    };
  })
  .handler(async ({ data, context }): Promise<GenerateSongResult> => {
    const { supabase, userId } = context;

    const advancedText = data.advanced
      ? Object.values(data.advanced).filter(Boolean).join("\n")
      : "";
    const blocked = findBlockedTerm(
      [data.title, data.prompt, data.lyrics, data.genre, advancedText].filter(Boolean).join("\n"),
    );
    if (blocked)
      throw new Error(
        `El texto contiene el término no permitido «${blockedTermLabel(blocked)}». No se han cobrado créditos.`,
      );

    if (data.mode === "admin_pro") {
      const { data: isAdmin } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (!isAdmin)
        return {
          ok: false,
          status: 403,
          message: "El modo Pro Admin está reservado al administrador.",
        };
    }

    const musicPrompt = buildMusicPrompt({
      description: data.prompt,
      lyrics: data.lyrics,
      genre: data.genre,
      voice: data.voice,
      bpm: data.bpm,
      seconds: data.duration,
      ...(data.mode ? { mode: data.mode } : {}),
      engine: data.engine,
      creationMode: data.creationMode,
      ...(data.advanced ? { advanced: data.advanced } : {}),
    });

    const instrumental = data.voice === INSTRUMENTAL;
    const text = await songText(musicPrompt, instrumental);

    const { data: balance, error: creditError } = await supabase.rpc("consume_credits", {
      _amount: CREDIT_COSTS.song,
      _reason: "Canción",
    });
    if (creditError) return { ok: false, status: 402, message: creditErrorMessage(creditError) };
    const spent = balance === -1 ? 0 : CREDIT_COSTS.song;

    const admin = await getAdminClient();
    const title = data.title || titleFromPrompt(data.prompt || data.lyrics);
    const adminServerUrl = await getAceStepServerUrl(admin);
    const serverUrls = [data.aceStepServerUrl, adminServerUrl, ...ACE_STEP_PUBLIC_SPACES]
      .filter((url): url is string => Boolean(url))
      .filter((url, index, all) => all.indexOf(url) === index);
    let audioProvider = "ACE-Step (Gradio)";
    let fallbackWarning: string | undefined;
    const { data: song, error: insertError } = await admin
      .from("songs")
      .insert({
        user_id: userId,
        kind: "song",
        title,
        prompt: data.prompt,
        lyrics: data.lyrics || text.letra,
        genre: data.genre,
        voice_type: data.voice,
        bpm: data.bpm,
        duration_seconds: data.duration,
        status: "generating",
        media_type: "audio/wav",
        credits_spent: spent,
        external_model: audioProvider,
      })
      .select("id")
      .single();
    if (insertError || !song) {
      console.error("songs insert failed, delivering local result", insertError);
      if (spent)
        await admin.rpc("grant_credits", {
          _user_id: userId,
          _amount: spent,
          _reason: "Reembolso por creación fallida",
        });
      return localWavSongResult({ data, text, title, musicPrompt });
    }

    let generated: GeneratedAudio | undefined;
    for (const serverUrl of serverUrls) {
      try {
        generated = await generateAceStepAudio({
          serverUrl,
          caption: musicPrompt,
          lyrics: text.letra,
          instrumental,
          bpm: data.bpm,
          duration: data.duration,
        });
        audioProvider = `ACE-Step (${new URL(serverUrl).hostname})`;
        break;
      } catch (error) {
        console.warn("ACE-Step no disponible, probando siguiente servidor", serverUrl, error);
      }
    }
    if (!generated) {
      generated = synthesizeSongAudio({
        bpm: data.bpm,
        seconds: data.duration,
        seedText: musicPrompt,
        genre: data.genre,
        chords: text.acordes,
        instrumental,
      });
      audioProvider = "Leudy IA Karplus-Strong (respaldo local)";
      fallbackWarning = "Los servidores ACE-Step están llenos; se generó una versión local.";
    }

    const path = `${userId}/${song.id}.${generated.extension}`;
    const { error: uploadError } = await admin.storage
      .from("songs")
      .upload(path, generated.bytes, { contentType: generated.contentType, upsert: true });
    if (uploadError) {
      console.error("song upload failed, delivering local result", uploadError);
      await failCreation(
        admin,
        song.id,
        userId,
        "La canción se generó pero no se pudo guardar en la nube.",
      );
      return localWavSongResult({ data, text, title, musicPrompt });
    }

    const { error: updateError } = await admin
      .from("songs")
      .update({
        status: "ready",
        storage_path: path,
        media_type: generated.contentType,
        external_model: audioProvider,
        error: null,
      })
      .eq("id", song.id);
    if (updateError) {
      console.error("song update failed, delivering local result", updateError);
      await failCreation(
        admin,
        song.id,
        userId,
        "La canción se generó pero no se pudo publicar en la nube.",
      );
      return localWavSongResult({ data, text, title, musicPrompt });
    }

    return {
      ok: true,
      songId: song.id,
      title,
      genre: data.genre,
      bpm: data.bpm,
      duration: data.duration,
      lyrics: text.letra,
      chords: text.acordes,
      structure: text.estructura,
      audioBase64: Buffer.from(generated.bytes).toString("base64"),
      mediaType: generated.contentType,
      saved: true,
      ...(fallbackWarning ? { warning: fallbackWarning } : {}),
    };
  });

type LyricsInput = { idea: string; genre: Genre; voice: VoiceType };

export const writeLyrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: LyricsInput) => {
    const idea =
      typeof input?.idea === "string" ? input.idea.trim().slice(0, MAX_PROMPT_LENGTH) : "";
    if (idea.length < 3) throw new Error("Escribe primero una idea para la canción.");
    const genre =
      typeof input.genre === "string" ? sanitizePrompt(input.genre, MAX_GENRE_LENGTH) : "";
    const blocked = findBlockedArtist(`${idea}\n${genre}`);
    if (blocked) throw new Error(`No podemos imitar ni nombrar a artistas reales como ${blocked}.`);
    if (!isGenre(genre)) throw new Error("Género no válido.");
    if (!isVoiceType(input.voice)) throw new Error("Tipo de voz no válido.");
    return { idea, genre, voice: input.voice };
  })
  .handler(
    async ({ data }): Promise<{ ok: true; lyrics: string } | { ok: false; message: string }> => {
      const system =
        "Eres un compositor profesional de música latina. Escribes letras originales en español, con rima y métrica cantables. Devuelve SOLO la letra, con secciones marcadas exactamente como [Intro], [Verso 1], [Pre-Coro], [Coro], [Verso 2], [Puente] y [Outro] según convenga. Sin comentarios ni títulos.";
      const user = `Género: ${data.genre}. Voz: ${data.voice}. Idea: ${data.idea}. Escribe una letra de unos 2-3 minutos con un coro pegajoso que se repita.`;
      try {
        const lyrics = await geminiText(system, user);
        return { ok: true, lyrics: lyrics.slice(0, MAX_LYRICS_LENGTH) };
      } catch (err) {
        console.error("gemini lyrics failed, using pollinations", err);
        try {
          const lyrics = await pollinationsText(`${system}\n\n${user}`);
          return { ok: true, lyrics: lyrics.slice(0, MAX_LYRICS_LENGTH) };
        } catch (fallbackError) {
          console.warn("pollinations lyrics failed, using local lyrics", fallbackError);
          return {
            ok: true,
            lyrics:
              `[Intro]\n${data.idea}\n[Verso 1]\n${data.idea}\n[Coro]\n${data.idea}\n[Outro]`.slice(
                0,
                MAX_LYRICS_LENGTH,
              ),
          };
        }
      }
    },
  );

type ImprovePromptInput = { prompt: string; genre?: Genre; voice?: VoiceType };

export const improvePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ImprovePromptInput) => {
    const prompt = typeof input?.prompt === "string" ? sanitizePrompt(input.prompt) : "";
    if (prompt.length < 3) throw new Error("Escribe primero una idea para mejorar.");
    const genre =
      typeof input.genre === "string" ? sanitizePrompt(input.genre, MAX_GENRE_LENGTH) : "";
    const voice = typeof input.voice === "string" ? sanitizePrompt(input.voice, 60) : "";
    const blocked = findBlockedArtist(`${prompt}\n${genre}`);
    if (blocked) throw new Error(`No podemos imitar ni nombrar a artistas reales como ${blocked}.`);
    return { prompt, genre, voice };
  })
  .handler(
    async ({ data }): Promise<{ ok: true; prompt: string } | { ok: false; message: string }> => {
      const system =
        "Eres un productor musical y copywriter experto. Devuelve SOLO un prompt mejorado en español, de 2 a 4 frases, concreto y cantable. No expliques nada, no uses comillas y nunca nombres artistas reales.";
      const context = [data.genre && `Género: ${data.genre}`, data.voice && `Voz: ${data.voice}`]
        .filter(Boolean)
        .join(". ");
      try {
        const improved = await geminiText(
          system,
          `${context ? `${context}.\n` : ""}Idea original: ${data.prompt}`,
        );
        const clean = sanitizePrompt(improved);
        return { ok: true, prompt: clean || data.prompt };
      } catch (err) {
        console.warn("gemini prompt improvement failed, using pollinations", err);
        try {
          const improved = await pollinationsText(
            `${system}\n\n${context ? `${context}.\n` : ""}Idea original: ${data.prompt}`,
          );
          const clean = sanitizePrompt(improved);
          return { ok: true, prompt: clean || data.prompt };
        } catch (fallbackError) {
          console.warn("pollinations prompt improvement failed, using original prompt", fallbackError);
          return { ok: true, prompt: data.prompt };
        }
      }
    },
  );
