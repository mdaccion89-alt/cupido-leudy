import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CREDIT_COSTS, creditErrorMessage } from "./credits";
import {
  failCreation,
  falErrorMessage,
  falGet,
  falKey,
  falSubmit,
  getAdminClient,
  signOwnedPath,
  type Db,
} from "./server-helpers";
import type { ActionResult } from "./music.functions";

export const COVER_MODEL = "fal-ai/chatterbox/speech-to-speech";
export const VIDEO_MODEL = "fal-ai/bytedance/omnihuman/v1.5";
const JOB_TIMEOUT_MS = 40 * 60_000;

type FeatureFlag = "covers_enabled" | "videos_enabled";

async function featureEnabled(supabase: Db, flag: FeatureFlag) {
  const { data } = await supabase.from("site_settings").select("covers_enabled, videos_enabled").eq("id", 1).maybeSingle();
  return data ? Boolean(data[flag]) : true;
}

async function spend(supabase: Db, amount: number, reason: string): Promise<{ spent: number } | { error: string }> {
  const { data, error } = await supabase.rpc("consume_credits", { _amount: amount, _reason: reason });
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
    if (sourceUrl && !/^https:\/\/\S+$/i.test(sourceUrl)) throw new Error("El enlace debe empezar por https://");
    const sources = [input?.sourcePath, sourceUrl, input?.sourceSongId].filter(Boolean).length;
    if (sources !== 1) throw new Error("Elige una sola canción base: sube un archivo, pega un enlace o elige una creación.");
    if (input.voicePath && input.voiceSongId) throw new Error("Elige una sola muestra de voz.");
    return { ...input, sourceUrl };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const { supabase, userId } = context;
    if (!(await featureEnabled(supabase, "covers_enabled")))
      return { ok: false, status: 403, message: "Los covers están desactivados por ahora." };
    if (!falKey()) return { ok: false, status: 503, message: falErrorMessage("FAL_NOT_CONFIGURED") };

    const admin = await getAdminClient();
    let sourceUrl = data.sourceUrl;
    let voiceUrl: string | undefined;
    try {
      if (data.sourcePath) sourceUrl = await signOwnedPath(admin, "uploads", data.sourcePath, userId);
      if (data.sourceSongId) {
        const { data: src } = await supabase.from("songs").select("storage_path").eq("id", data.sourceSongId).maybeSingle();
        if (!src?.storage_path) return { ok: false, status: 404, message: "No se encontró la canción base." };
        sourceUrl = await signOwnedPath(admin, "songs", src.storage_path, userId);
      }
      if (data.voicePath) voiceUrl = await signOwnedPath(admin, "uploads", data.voicePath, userId);
      if (data.voiceSongId) {
        const { data: v } = await supabase.from("songs").select("storage_path").eq("id", data.voiceSongId).maybeSingle();
        if (!v?.storage_path) return { ok: false, status: 404, message: "No se encontró la muestra de voz." };
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
      if (cost.spent) await admin.rpc("grant_credits", { _user_id: userId, _amount: cost.spent, _reason: "Reembolso por creación fallida" });
      return { ok: false, status: 500, message: "No se pudo crear el cover." };
    }

    try {
      const job = await falSubmit(COVER_MODEL, {
        source_audio_url: sourceUrl,
        ...(voiceUrl ? { target_voice_audio_url: voiceUrl } : {}),
      });
      await admin
        .from("songs")
        .update({ external_job_id: job.request_id, external_status_url: job.status_url, external_response_url: job.response_url })
        .eq("id", row.id);
      return { ok: true, songId: row.id };
    } catch (err) {
      const message = falErrorMessage(err instanceof Error ? err.message : "");
      await failCreation(admin, row.id, userId, message);
      return { ok: false, status: 502, message };
    }
  });

type VideoInput = { songId: string; portraitPath: string; audioClipPath: string; clipSeconds: number; style?: string };

export const startVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: VideoInput) => {
    if (typeof input?.songId !== "string" || !input.songId) throw new Error("Elige una canción.");
    if (typeof input.portraitPath !== "string" || !input.portraitPath) throw new Error("Sube una foto de retrato.");
    if (typeof input.audioClipPath !== "string" || !input.audioClipPath) throw new Error("Falta el fragmento de audio.");
    const clipSeconds = Number(input.clipSeconds);
    if (!Number.isFinite(clipSeconds) || clipSeconds <= 0 || clipSeconds > 30) throw new Error("El fragmento debe durar hasta 30 segundos.");
    const style = typeof input.style === "string" ? input.style.trim().slice(0, 300) : "";
    return { ...input, clipSeconds: Math.round(clipSeconds), style };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const { supabase, userId } = context;
    if (!(await featureEnabled(supabase, "videos_enabled")))
      return { ok: false, status: 403, message: "Los videoclips están desactivados por ahora." };
    if (!falKey()) return { ok: false, status: 503, message: falErrorMessage("FAL_NOT_CONFIGURED") };

    const { data: song } = await supabase.from("songs").select("id, title, genre, status, kind").eq("id", data.songId).maybeSingle();
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
      if (cost.spent) await admin.rpc("grant_credits", { _user_id: userId, _amount: cost.spent, _reason: "Reembolso por creación fallida" });
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
        .update({ external_job_id: job.request_id, external_status_url: job.status_url, external_response_url: job.response_url })
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
      .select("id, status, kind, media_type, external_status_url, external_response_url, created_at, error")
      .eq("id", data.songId)
      .maybeSingle();
    if (!row) return { status: "missing" };
    if (row.status !== "generating" || !row.external_status_url || !row.external_response_url)
      return { status: row.status, error: row.error };

    const admin = await getAdminClient();
    if (Date.now() - new Date(row.created_at).getTime() > JOB_TIMEOUT_MS) {
      await failCreation(admin, row.id, userId, "La generación tardó demasiado. Te devolvimos los créditos.");
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
      const body = result.body as { audio?: { url?: string }; video?: { url?: string }; duration?: number };
      const fileUrl = row.kind === "video" ? body.video?.url : body.audio?.url;
      if (!fileUrl) throw new Error("NO_FILE");
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) throw new Error("DOWNLOAD_FAILED");
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      const contentType = fileRes.headers.get("content-type")?.split(";")[0] || row.media_type;
      const ext = row.kind === "video" ? "mp4" : contentType.includes("mpeg") ? "mp3" : "wav";
      const path = `${userId}/${row.id}.${ext}`;
      const { error: upErr } = await admin.storage.from("songs").upload(path, bytes, { contentType, upsert: true });
      if (upErr) throw upErr;
      await admin
        .from("songs")
        .update({
          status: "ready",
          storage_path: path,
          media_type: row.kind === "video" ? "video/mp4" : contentType,
          error: null,
          ...(typeof body.duration === "number" ? { duration_seconds: Math.round(body.duration) } : {}),
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

export const listGallery = createServerFn({ method: "GET" }).handler(async (): Promise<GalleryItem[]> => {
  const admin = await getAdminClient();
  const { data: settings } = await admin.from("site_settings").select("gallery_enabled").eq("id", 1).maybeSingle();
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
  const { data: profiles } = await admin.from("profiles").select("id, display_name").in("id", ids);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name || "Artista"]));
  const { data: signed } = await admin.storage.from("songs").createSignedUrls(rows.map((r) => r.storage_path!), 3600);
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
});

export type PublicSettings = {
  site_title: string;
  site_tagline: string;
  banner_text: string;
  banner_image: string;
  songs_enabled: boolean;
  covers_enabled: boolean;
  videos_enabled: boolean;
  purchases_enabled: boolean;
  gallery_enabled: boolean;
};

export const getSiteSettings = createServerFn({ method: "GET" }).handler(async (): Promise<PublicSettings> => {
  const admin = await getAdminClient();
  const { data } = await admin.from("site_settings").select("*").eq("id", 1).maybeSingle();
  let banner = data?.banner_image_url ?? "";
  if (banner && !banner.startsWith("http")) {
    const { data: s } = await admin.storage.from("site").createSignedUrl(banner, 60 * 60 * 24);
    banner = s?.signedUrl ?? "";
  }
  return {
    site_title: data?.site_title ?? "Leudy IA Adobe",
    site_tagline: data?.site_tagline ?? "Convierte tus ideas en canciones",
    banner_text: data?.banner_text ?? "",
    banner_image: banner,
    songs_enabled: data?.songs_enabled ?? true,
    covers_enabled: data?.covers_enabled ?? true,
    videos_enabled: data?.videos_enabled ?? true,
    purchases_enabled: data?.purchases_enabled ?? true,
    gallery_enabled: data?.gallery_enabled ?? true,
  };
});

export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    return {
      falConfigured: Boolean(process.env["FAL_KEY"]),
      paypalConfigured: Boolean(process.env["PAYPAL_API_KEY"] && process.env["LOVABLE_API_KEY"]),
    };
  });
