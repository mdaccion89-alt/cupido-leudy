import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CREDIT_COSTS, creditErrorMessage } from "./credits";
import { SLOGAN } from "./cupido";
import {
  MAX_LYRICS_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  findBlockedArtist,
  sanitizePrompt,
} from "./music";
import {
  failCreation,
  falErrorMessage,
  falGet,
  falKey,
  falSubmit,
  falWait,
  getAdminClient,
  signOwnedPath,
  type Db,
} from "./server-helpers";
import type { ActionResult } from "./music.functions";

export const COVER_MODEL = "fal-ai/chatterbox/speech-to-speech";
export const VIDEO_MODEL = "fal-ai/bytedance/omnihuman/v1.5";
const JOB_TIMEOUT_MS = 40 * 60_000;

async function spend(
  supabase: Db,
  amount: number,
  reason: string,
): Promise<{ spent: number } | { error: string }> {
  const { data, error } = await supabase.rpc("consume_credits", {
    _amount: amount,
    _reason: reason,
  });
  if (error) return { error: creditErrorMessage(error) };
  return { spent: data === -1 ? 0 : amount };
}

function cleanTitle(value: unknown, fallback: string) {
  const t = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return t || fallback;
}

type CoverInput = {
  title?: string;
  sourcePath?: string;
  sourceUrl?: string;
  sourceSongId?: string;
  voicePath?: string;
  voiceSongId?: string;
};

export const startCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CoverInput) => {
    const sourceUrl = typeof input?.sourceUrl === "string" ? input.sourceUrl.trim() : "";
    if (sourceUrl && !/^https:\/\/\S+$/i.test(sourceUrl))
      throw new Error("El enlace debe empezar por https://");
    const sources = [input?.sourcePath, sourceUrl, input?.sourceSongId].filter(Boolean).length;
    if (sources !== 1)
      throw new Error(
        "Elige una sola canción base: sube un archivo, pega un enlace o elige una creación.",
      );
    if (input.voicePath && input.voiceSongId) throw new Error("Elige una sola muestra de voz.");
    return { ...input, sourceUrl };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const { supabase, userId } = context;
    if (!falKey())
      return { ok: false, status: 503, message: falErrorMessage("FAL_NOT_CONFIGURED") };

    const admin = await getAdminClient();
    let sourceUrl = data.sourceUrl;
    let voiceUrl: string | undefined;
    try {
      if (data.sourcePath)
        sourceUrl = await signOwnedPath(admin, "uploads", data.sourcePath, userId);
      if (data.sourceSongId) {
        const { data: src } = await supabase
          .from("songs")
          .select("storage_path")
          .eq("id", data.sourceSongId)
          .maybeSingle();
        if (!src?.storage_path)
          return { ok: false, status: 404, message: "No se encontró la canción base." };
        sourceUrl = await signOwnedPath(admin, "songs", src.storage_path, userId);
      }
      if (data.voicePath) voiceUrl = await signOwnedPath(admin, "uploads", data.voicePath, userId);
      if (data.voiceSongId) {
        const { data: v } = await supabase
          .from("songs")
          .select("storage_path")
          .eq("id", data.voiceSongId)
          .maybeSingle();
        if (!v?.storage_path)
          return { ok: false, status: 404, message: "No se encontró la muestra de voz." };
        voiceUrl = await signOwnedPath(admin, "songs", v.storage_path, userId);
      }
    } catch {
      return { ok: false, status: 400, message: "No se pudieron leer los archivos elegidos." };
    }

    const cost = await spend(supabase, CREDIT_COSTS.cover, "Cover IA");
    if ("error" in cost) return { ok: false, status: 402, message: cost.error };

    const { data: row, error } = await admin
      .from("songs")
      .insert({
        user_id: userId,
        kind: "cover",
        title: cleanTitle(data.title, "Cover IA"),
        prompt: "",
        genre: "Cover IA",
        duration_seconds: 0,
        status: "generating",
        media_type: "audio/wav",
        source_song_id: data.sourceSongId ?? null,
        external_model: COVER_MODEL,
        credits_spent: cost.spent,
      })
      .select("id")
      .single();
    if (error || !row) {
      if (cost.spent)
        await admin.rpc("grant_credits", {
          _user_id: userId,
          _amount: cost.spent,
          _reason: "Reembolso por creación fallida",
        });
      return { ok: false, status: 500, message: "No se pudo crear el cover." };
    }

    try {
      const job = await falSubmit(COVER_MODEL, {
        source_audio_url: sourceUrl,
        ...(voiceUrl ? { target_voice_audio_url: voiceUrl } : {}),
      });
      await admin
        .from("songs")
        .update({
          external_job_id: job.request_id,
          external_status_url: job.status_url,
          external_response_url: job.response_url,
        })
        .eq("id", row.id);
      return { ok: true, songId: row.id };
    } catch (err) {
      const message = falErrorMessage(err instanceof Error ? err.message : "");
      await failCreation(admin, row.id, userId, message);
      return { ok: false, status: 502, message };
    }
  });

type VideoInput = {
  songId: string;
  portraitPath: string;
  audioClipPath: string;
  clipSeconds: number;
  style?: string;
};

export const startVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: VideoInput) => {
    if (typeof input?.songId !== "string" || !input.songId) throw new Error("Elige una canción.");
    if (typeof input.portraitPath !== "string" || !input.portraitPath)
      throw new Error("Sube una foto de retrato.");
    if (typeof input.audioClipPath !== "string" || !input.audioClipPath)
      throw new Error("Falta el fragmento de audio.");
    const clipSeconds = Number(input.clipSeconds);
    if (!Number.isFinite(clipSeconds) || clipSeconds <= 0 || clipSeconds > 30)
      throw new Error("El fragmento debe durar hasta 30 segundos.");
    const style = typeof input.style === "string" ? input.style.trim().slice(0, 300) : "";
    return { ...input, clipSeconds: Math.round(clipSeconds), style };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const { supabase, userId } = context;
    if (!falKey())
      return { ok: false, status: 503, message: falErrorMessage("FAL_NOT_CONFIGURED") };

    const { data: song } = await supabase
      .from("songs")
      .select("id, title, genre, status, kind")
      .eq("id", data.songId)
      .maybeSingle();
    if (!song || song.status !== "ready" || song.kind === "video")
      return { ok: false, status: 404, message: "Elige una canción terminada." };

    const admin = await getAdminClient();
    let imageUrl: string;
    let audioUrl: string;
    try {
      imageUrl = await signOwnedPath(admin, "uploads", data.portraitPath, userId);
      audioUrl = await signOwnedPath(admin, "uploads", data.audioClipPath, userId);
    } catch {
      return { ok: false, status: 400, message: "No se pudieron leer los archivos elegidos." };
    }

    const cost = await spend(supabase, CREDIT_COSTS.video, "Videoclip");
    if ("error" in cost) return { ok: false, status: 402, message: cost.error };

    const { data: row, error } = await admin
      .from("songs")
      .insert({
        user_id: userId,
        kind: "video",
        title: `Videoclip · ${song.title}`.slice(0, 90),
        prompt: data.style,
        genre: song.genre,
        duration_seconds: data.clipSeconds,
        status: "generating",
        media_type: "video/mp4",
        source_song_id: song.id,
        external_model: VIDEO_MODEL,
        credits_spent: cost.spent,
      })
      .select("id")
      .single();
    if (error || !row) {
      if (cost.spent)
        await admin.rpc("grant_credits", {
          _user_id: userId,
          _amount: cost.spent,
          _reason: "Reembolso por creación fallida",
        });
      return { ok: false, status: 500, message: "No se pudo crear el videoclip." };
    }

    try {
      const job = await falSubmit(VIDEO_MODEL, {
        image_url: imageUrl,
        audio_url: audioUrl,
        resolution: "720p",
        prompt:
          `The person sings this song passionately with perfectly lip-synced mouth movements, natural expressive body movement, subtle head motion and smooth cinematic camera movement. ${data.style}`.trim(),
      });
      await admin
        .from("songs")
        .update({
          external_job_id: job.request_id,
          external_status_url: job.status_url,
          external_response_url: job.response_url,
        })
        .eq("id", row.id);
      return { ok: true, songId: row.id };
    } catch (err) {
      const message = falErrorMessage(err instanceof Error ? err.message : "");
      await failCreation(admin, row.id, userId, message);
      return { ok: false, status: 502, message };
    }
  });

type JobState = { status: string; error?: string | null };

/** Polls a Fal job for one of the caller's creations and saves the result when it is done. */
export const checkJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { songId: string }) => {
    if (typeof input?.songId !== "string" || !input.songId) throw new Error("Falta la creación.");
    return input;
  })
  .handler(async ({ data, context }): Promise<JobState> => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("songs")
      .select(
        "id, status, kind, media_type, external_status_url, external_response_url, created_at, error",
      )
      .eq("id", data.songId)
      .maybeSingle();
    if (!row) return { status: "missing" };
    if (row.status !== "generating" || !row.external_status_url || !row.external_response_url)
      return { status: row.status, error: row.error };

    const admin = await getAdminClient();
    if (Date.now() - new Date(row.created_at).getTime() > JOB_TIMEOUT_MS) {
      await failCreation(
        admin,
        row.id,
        userId,
        "La generación tardó demasiado. Te devolvimos los créditos.",
      );
      return { status: "failed", error: "La generación tardó demasiado." };
    }

    let status: { status: number; body: unknown };
    try {
      status = await falGet(row.external_status_url);
    } catch {
      return { status: "generating" };
    }
    if (status.status === 429 || status.status >= 500) return { status: "generating" };
    const state = (status.body as { status?: string })?.status;
    if (status.status >= 400 || !state) {
      const msg = "La generación falló. Te devolvimos los créditos.";
      await failCreation(admin, row.id, userId, msg);
      return { status: "failed", error: msg };
    }
    if (state !== "COMPLETED") return { status: "generating" };

    // Claim the save so concurrent polls don't both download.
    const { data: claimed } = await admin
      .from("songs")
      .update({ status: "saving" })
      .eq("id", row.id)
      .eq("status", "generating")
      .select("id")
      .maybeSingle();
    if (!claimed) return { status: "generating" };

    try {
      const result = await falGet(row.external_response_url);
      if (result.status >= 400) {
        console.error("fal result error", result.status, JSON.stringify(result.body).slice(0, 500));
        throw new Error("RESULT_FAILED");
      }
      const body = result.body as {
        audio?: { url?: string };
        video?: { url?: string };
        duration?: number;
      };
      const fileUrl = row.kind === "video" ? body.video?.url : body.audio?.url;
      if (!fileUrl) throw new Error("NO_FILE");
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) throw new Error("DOWNLOAD_FAILED");
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      const contentType = fileRes.headers.get("content-type")?.split(";")[0] || row.media_type;
      const ext = row.kind === "video" ? "mp4" : contentType.includes("mpeg") ? "mp3" : "wav";
      const path = `${userId}/${row.id}.${ext}`;
      const { error: upErr } = await admin.storage
        .from("songs")
        .upload(path, bytes, { contentType, upsert: true });
      if (upErr) throw upErr;
      await admin
        .from("songs")
        .update({
          status: "ready",
          storage_path: path,
          media_type: row.kind === "video" ? "video/mp4" : contentType,
          error: null,
          ...(typeof body.duration === "number"
            ? { duration_seconds: Math.round(body.duration) }
            : {}),
        })
        .eq("id", row.id);
      return { status: "ready" };
    } catch (err) {
      console.error("save fal result failed", err);
      const msg = "No se pudo guardar el resultado. Te devolvimos los créditos.";
      await failCreation(admin, row.id, userId, msg);
      return { status: "failed", error: msg };
    }
  });

export type GalleryItem = {
  id: string;
  title: string;
  kind: string;
  genre: string;
  media_type: string;
  author: string;
  url: string;
  published_at: string | null;
};

export const listGallery = createServerFn({ method: "GET" }).handler(
  async (): Promise<GalleryItem[]> => {
    const admin = await getAdminClient();
    const { data: settings } = await admin
      .from("site_settings")
      .select("gallery_enabled")
      .eq("id", 1)
      .maybeSingle();
    if (settings && !settings.gallery_enabled) return [];
    const { data: rows } = await admin
      .from("songs")
      .select("id, title, kind, genre, media_type, storage_path, user_id, published_at")
      .eq("is_public", true)
      .eq("status", "ready")
      .not("storage_path", "is", null)
      .order("published_at", { ascending: false })
      .limit(24);
    if (!rows?.length) return [];
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name || "Artista"]));
    const { data: signed } = await admin.storage.from("songs").createSignedUrls(
      rows.map((r) => r.storage_path!),
      3600,
    );
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    return rows
      .map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        genre: r.genre,
        media_type: r.media_type,
        author: names.get(r.user_id) ?? "Artista",
        url: urls.get(r.storage_path!) ?? "",
        published_at: r.published_at,
      }))
      .filter((r) => r.url);
  },
);

export type PublicSettings = {
  site_title: string;
  site_tagline: string;
  banner_text: string;
  banner_image: string;
  logo_url: string;
  primary_color: string;
  accent_color: string;
  songs_enabled: boolean;
  covers_enabled: boolean;
  videos_enabled: boolean;
  purchases_enabled: boolean;
  gallery_enabled: boolean;
};

export const getSiteSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSettings> => {
    const admin = await getAdminClient();
    const { data } = await admin.from("site_settings").select("*").eq("id", 1).maybeSingle();
    let banner = data?.banner_image_url ?? "";
    let logo = data?.logo_url ?? "";
    if (banner && !banner.startsWith("http")) {
      const { data: s } = await admin.storage.from("site").createSignedUrl(banner, 60 * 60 * 24);
      banner = s?.signedUrl ?? "";
    }
    if (logo && !logo.startsWith("http")) {
      const { data: s } = await admin.storage.from("site").createSignedUrl(logo, 60 * 60 * 24);
      logo = s?.signedUrl ?? "";
    }
    return {
      site_title: data?.site_title ?? "Cupido Leudy ❤️",
      site_tagline: data?.site_tagline ?? SLOGAN,
      banner_text: data?.banner_text ?? "Encuentra conexiones reales. Verificación azul, seguridad y diversión.",
      banner_image: banner,
      logo_url: logo,
      primary_color: data?.primary_color ?? "",
      accent_color: data?.accent_color ?? "",
      songs_enabled: data?.songs_enabled ?? false,
      covers_enabled: data?.covers_enabled ?? false,
      videos_enabled: data?.videos_enabled ?? false,
      purchases_enabled: data?.purchases_enabled ?? true,
      gallery_enabled: data?.gallery_enabled ?? true,
    };
  },
);

export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    return {
      falConfigured: Boolean(process.env["FAL_KEY"]),
      paypalConfigured: Boolean(process.env["PAYPAL_CLIENT_ID"] && process.env["PAYPAL_SECRET"]),
    };
  });

export const DEFAULT_INSTRUMENTAL_MODEL = "fal-ai/icefall";
export const DEFAULT_VOCAL_MODEL = "fal-ai/kling-audio";
export const DEMUCS_MODEL = "fal-ai/demucs";
const STEM_NAMES = ["vocals", "drums", "bass", "other", "guitar", "piano"] as const;

export type DeleteResult = { ok: true } | { ok: false; status: number; message: string };
export type StemManifestResult =
  | { ok: true; stems: { name: string; url: string }[] }
  | { ok: false; status: number; message: string };

async function isAdminUser(supabase: Db, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return Boolean(data);
}

function audioUrlFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const audio = record["audio"];
  if (typeof audio === "string" && /^https?:\/\//.test(audio)) return audio;
  if (audio && typeof audio === "object") {
    const url = (audio as Record<string, unknown>)["url"];
    if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
  }
  const output = record["output"];
  if (!output || typeof output !== "object") return undefined;
  return audioUrlFrom(output);
}

async function downloadAudio(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("DOWNLOAD_FAILED");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("EMPTY_AUDIO");
  const contentType = response.headers.get("content-type")?.split(";")[0] || "audio/mpeg";
  const extension = contentType.includes("wav") ? "wav" : "mp3";
  return { bytes, contentType, extension };
}

type PreparedJob =
  { ok: true; admin: Db; songId: string; sourceUrl: string } | { ok: false; result: ActionResult };

async function prepareAudioJob(
  supabase: Db,
  userId: string,
  values: {
    title: string;
    kind: string;
    prompt: string;
    genre: string;
    sourcePath: string;
    model: string;
    reason: string;
  },
): Promise<PreparedJob> {
  const admin = await getAdminClient();
  let sourceUrl: string;
  try {
    sourceUrl = await signOwnedPath(admin, "uploads", values.sourcePath, userId);
  } catch {
    return {
      ok: false,
      result: { ok: false, status: 400, message: "No se pudo leer el archivo subido." },
    };
  }
  const cost = await spend(supabase, CREDIT_COSTS.song, values.reason);
  if ("error" in cost)
    return { ok: false, result: { ok: false, status: 402, message: cost.error } };
  const { data: row, error } = await admin
    .from("songs")
    .insert({
      user_id: userId,
      kind: values.kind,
      title: values.title,
      prompt: values.prompt,
      genre: values.genre,
      duration_seconds: 0,
      status: "generating",
      media_type: "audio/mpeg",
      external_model: values.model,
      credits_spent: cost.spent,
    })
    .select("id")
    .single();
  if (error || !row) {
    if (cost.spent)
      await admin.rpc("grant_credits", {
        _user_id: userId,
        _amount: cost.spent,
        _reason: "Reembolso por creación fallida",
      });
    return {
      ok: false,
      result: { ok: false, status: 500, message: "No se pudo crear la creación." },
    };
  }
  return { ok: true, admin, songId: row.id, sourceUrl };
}

function jobErrorMessage(code: string, envName: string): string {
  if (code === "NO_AUDIO" || code === "DOWNLOAD_FAILED" || code === "EMPTY_AUDIO")
    return "El proveedor no devolvió audio descargable. Te devolvimos los créditos.";
  if (code === "FAL_404")
    return `El modelo configurado no existe. Revisa ${envName} con un endpoint real de Fal.ai.`;
  return falErrorMessage(code);
}

async function runAudioJob(
  supabase: Db,
  userId: string,
  values: {
    title: string;
    kind: string;
    prompt: string;
    genre: string;
    sourcePath: string;
    model: string;
    reason: string;
    envName: string;
    input: (sourceUrl: string) => Record<string, unknown>;
  },
): Promise<ActionResult> {
  if (!falKey()) return { ok: false, status: 503, message: falErrorMessage("FAL_NOT_CONFIGURED") };
  const prepared = await prepareAudioJob(supabase, userId, values);
  if (!prepared.ok) return prepared.result;
  const { admin, songId, sourceUrl } = prepared;
  try {
    const job = await falSubmit(values.model, values.input(sourceUrl));
    await admin
      .from("songs")
      .update({ external_job_id: job.request_id, external_status_url: job.status_url })
      .eq("id", songId);
    const output = await falWait(job.response_url);
    const url = audioUrlFrom(output);
    if (!url) throw new Error("NO_AUDIO");
    const audio = await downloadAudio(url);
    const path = `${userId}/${songId}.${audio.extension}`;
    const { error: uploadError } = await admin.storage
      .from("songs")
      .upload(path, audio.bytes, { contentType: audio.contentType, upsert: true });
    if (uploadError) throw uploadError;
    await admin
      .from("songs")
      .update({ status: "ready", storage_path: path, media_type: audio.contentType, error: null })
      .eq("id", songId);
    return { ok: true, songId };
  } catch (err) {
    const code = err instanceof Error ? err.message : "FAL_UNKNOWN";
    console.error("audio job failed", err);
    const message = jobErrorMessage(code, values.envName);
    await failCreation(admin, songId, userId, message);
    return { ok: false, status: 502, message };
  }
}

type InstrumentalInput = { sourcePath?: string; title?: string; prompt?: string };

export const startInstrumentalForVocal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: InstrumentalInput) => {
    if (typeof input?.sourcePath !== "string" || !input.sourcePath)
      throw new Error("Sube la voz a la que quieres añadir el instrumental.");
    const title = sanitizePrompt(input.title ?? "", MAX_TITLE_LENGTH);
    const prompt = sanitizePrompt(input.prompt ?? "", MAX_PROMPT_LENGTH);
    const blocked = findBlockedArtist(`${title}\n${prompt}`);
    if (blocked) throw new Error(`No podemos imitar ni nombrar a artistas reales como ${blocked}.`);
    return { sourcePath: input.sourcePath, title, prompt };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const model = process.env["FAL_INSTRUMENTAL_MODEL"]?.trim() || DEFAULT_INSTRUMENTAL_MODEL;
    return runAudioJob(context.supabase, context.userId, {
      title: data.title || "Instrumental para voz",
      kind: "instrumental",
      prompt: data.prompt,
      genre: "Instrumental",
      sourcePath: data.sourcePath,
      model,
      reason: "Instrumental",
      envName: "FAL_INSTRUMENTAL_MODEL",
      input: (sourceUrl) => ({
        audio_url: sourceUrl,
        prompt: data.prompt || "Add a polished instrumental arrangement that supports this vocal.",
      }),
    });
  });

type VocalInput = {
  sourcePath?: string;
  title?: string;
  lyrics?: string;
  language?: string;
  country?: string;
};

export const startVocalForInstrumental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: VocalInput) => {
    if (typeof input?.sourcePath !== "string" || !input.sourcePath)
      throw new Error("Sube el instrumental al que quieres añadir la voz.");
    const title = sanitizePrompt(input.title ?? "", MAX_TITLE_LENGTH);
    const lyrics = sanitizePrompt(input.lyrics ?? "", MAX_LYRICS_LENGTH);
    if (lyrics.length < 3) throw new Error("Escribe la letra que debe cantar la voz.");
    const language = sanitizePrompt(input.language ?? "es", 20) || "es";
    const country = sanitizePrompt(input.country ?? "ES", 20) || "ES";
    const blocked = findBlockedArtist(`${title}\n${lyrics}`);
    if (blocked) throw new Error(`No podemos imitar ni nombrar a artistas reales como ${blocked}.`);
    return { sourcePath: input.sourcePath, title, lyrics, language, country };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const model = process.env["FAL_VOCAL_MODEL"]?.trim();
    if (!model)
      return {
        ok: false,
        status: 503,
        message: `El proveedor de voz no está configurado. El administrador debe definir FAL_VOCAL_MODEL con un endpoint real de Fal.ai (por ejemplo ${DEFAULT_VOCAL_MODEL} o un modelo de canto compatible).`,
      };
    return runAudioJob(context.supabase, context.userId, {
      title: data.title || "Voz sobre instrumental",
      kind: "vocal",
      prompt: data.lyrics,
      genre: "Voz",
      sourcePath: data.sourcePath,
      model,
      reason: "Voz",
      envName: "FAL_VOCAL_MODEL",
      input: (sourceUrl) => ({
        audio_url: sourceUrl,
        lyrics: data.lyrics,
        language: data.language,
        country: data.country,
      }),
    });
  });

type StemsInput = { sourcePath?: string; title?: string };

export const startStemSeparation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StemsInput) => {
    if (typeof input?.sourcePath !== "string" || !input.sourcePath)
      throw new Error("Sube la canción que quieres separar.");
    return {
      sourcePath: input.sourcePath,
      title: sanitizePrompt(input.title ?? "", MAX_TITLE_LENGTH),
    };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    if (!falKey())
      return { ok: false, status: 503, message: falErrorMessage("FAL_NOT_CONFIGURED") };
    const prepared = await prepareAudioJob(context.supabase, context.userId, {
      title: data.title || "Stems de canción",
      kind: "stems",
      prompt: "Separación de stems",
      genre: "Stems",
      sourcePath: data.sourcePath,
      model: DEMUCS_MODEL,
      reason: "Stems",
    });
    if (!prepared.ok) return prepared.result;
    const { admin, songId, sourceUrl } = prepared;
    try {
      const job = await falSubmit(DEMUCS_MODEL, {
        audio_url: sourceUrl,
        model: "htdemucs_6s",
        stems: [...STEM_NAMES],
        output_format: "mp3",
      });
      await admin
        .from("songs")
        .update({ external_job_id: job.request_id, external_status_url: job.status_url })
        .eq("id", songId);
      const output = await falWait(job.response_url);
      const record =
        output && typeof output === "object" ? (output as Record<string, unknown>) : {};
      const manifest: Record<string, string> = {};
      for (const stem of STEM_NAMES) {
        const url = audioUrlFrom({ audio: record[stem] });
        if (!url) continue;
        const audio = await downloadAudio(url);
        const path = `${context.userId}/${songId}/stems/${stem}.mp3`;
        const { error: uploadError } = await admin.storage
          .from("songs")
          .upload(path, audio.bytes, { contentType: "audio/mpeg", upsert: true });
        if (uploadError) throw uploadError;
        manifest[stem] = path;
      }
      if (!Object.keys(manifest).length) throw new Error("NO_AUDIO");
      await admin
        .from("songs")
        .update({
          status: "ready",
          storage_path: manifest["vocals"] ?? Object.values(manifest)[0] ?? null,
          media_type: "audio/mpeg",
          external_response_url: JSON.stringify(manifest),
          error: null,
        })
        .eq("id", songId);
      return { ok: true, songId };
    } catch (err) {
      const code = err instanceof Error ? err.message : "FAL_UNKNOWN";
      console.error("stem separation failed", err);
      const message = jobErrorMessage(code, "FAL_STEMS_MODEL");
      await failCreation(admin, songId, context.userId, message);
      return { ok: false, status: 502, message };
    }
  });

export const getStemManifest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { songId?: string }) => {
    if (typeof input?.songId !== "string" || !input.songId) throw new Error("Falta la separación.");
    return { songId: input.songId };
  })
  .handler(async ({ data, context }): Promise<StemManifestResult> => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("songs")
      .select("user_id, kind, status, external_response_url")
      .eq("id", data.songId)
      .maybeSingle();
    if (!row) return { ok: false, status: 404, message: "No se encontró la separación." };
    if (row.user_id !== userId && !(await isAdminUser(supabase, userId)))
      return { ok: false, status: 403, message: "No tienes permiso para ver esta separación." };
    if (row.kind !== "stems" || row.status !== "ready" || !row.external_response_url)
      return { ok: false, status: 404, message: "La separación aún no está lista." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.external_response_url);
    } catch {
      return { ok: false, status: 500, message: "El manifest de stems no es válido." };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { ok: false, status: 500, message: "El manifest de stems no es válido." };
    const admin = await getAdminClient();
    const stems: { name: string; url: string }[] = [];
    for (const [name, path] of Object.entries(parsed)) {
      if (!(STEM_NAMES as readonly string[]).includes(name) || typeof path !== "string") continue;
      try {
        stems.push({ name, url: await signOwnedPath(admin, "songs", path, row.user_id) });
      } catch {
        continue;
      }
    }
    return { ok: true, stems };
  });

export const deleteSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { songId?: string }) => {
    if (typeof input?.songId !== "string" || !input.songId) throw new Error("Falta la creación.");
    return { songId: input.songId };
  })
  .handler(async ({ data, context }): Promise<DeleteResult> => {
    const { supabase, userId } = context;
    const admin = await getAdminClient();
    const { data: song } = await admin
      .from("songs")
      .select("id, user_id, storage_path, external_response_url")
      .eq("id", data.songId)
      .maybeSingle();
    if (!song) return { ok: false, status: 404, message: "No se encontró la creación." };
    if (song.user_id !== userId && !(await isAdminUser(supabase, userId)))
      return { ok: false, status: 403, message: "No tienes permiso para eliminar esta creación." };
    const paths = new Set<string>();
    if (song.storage_path) paths.add(song.storage_path);
    if (song.external_response_url) {
      try {
        const manifest = JSON.parse(song.external_response_url) as unknown;
        if (manifest && typeof manifest === "object" && !Array.isArray(manifest))
          for (const value of Object.values(manifest))
            if (typeof value === "string") paths.add(value);
      } catch {
        console.error("invalid stems manifest on delete", song.id);
      }
    }
    if (paths.size) await admin.storage.from("songs").remove([...paths]);
    const { error } = await admin.from("songs").delete().eq("id", data.songId);
    if (error) {
      console.error("song delete failed", error);
      return { ok: false, status: 500, message: "No se pudo eliminar la creación." };
    }
    return { ok: true };
  });
