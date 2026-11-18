import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CREDIT_COSTS, creditErrorMessage } from "./credits";
import {
  MAX_LYRICS_LENGTH,
  MAX_PROMPT_LENGTH,
  buildMusicPrompt,
  findBlockedArtist,
  isBpm,
  isDuration,
  isGenre,
  isStudioMode,
  isVoiceType,
  titleFromPrompt,
  type AdvancedParams,
  type DurationSeconds,
  type Genre,
  type StudioMode,
  type VoiceType,
} from "./music";
import {
  audioFromBytes,
  falErrorMessage,
  falKey,
  falSubmit,
  falWait,
  failCreation,
  getAdminClient,
  hfErrorMessage,
  hfToken,
  huggingFaceAudio,
  isFalBalanceError,
  type GeneratedAudio,
} from "./server-helpers";

type GenerateInput = {
  prompt: string;
  lyrics?: string;
  genre: Genre;
  voice: VoiceType;
  bpm: number;
  duration: DurationSeconds;
  mode?: StudioMode;
  advanced?: AdvancedParams;
};

export type ActionResult =
  { ok: true; songId: string } | { ok: false; status: number; message: string };

function falAudioUrl(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const candidate = body as {
    audio?: { url?: string };
    audio_url?: string;
    output?: { audio?: { url?: string }; audio_url?: string };
  };
  return (
    candidate.audio?.url ??
    candidate.audio_url ??
    candidate.output?.audio?.url ??
    candidate.output?.audio_url
  );
}

export const generateSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenerateInput) => {
    const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
    const lyrics = typeof input?.lyrics === "string" ? input.lyrics.trim() : "";
    if (prompt.length < 3 && lyrics.length < 3)
      throw new Error("Describe tu canción o escribe una letra.");
    if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("La descripción es demasiado larga.");
    if (lyrics.length > MAX_LYRICS_LENGTH) throw new Error("La letra es demasiado larga.");
    const blocked = findBlockedArtist(`${prompt}\n${lyrics}`);
    if (blocked)
      throw new Error(
        `No podemos imitar ni nombrar a artistas reales como ${blocked}. Usa una descripción original.`,
      );
    if (!isGenre(input.genre)) throw new Error("Género no válido.");
    if (!isVoiceType(input.voice)) throw new Error("Tipo de voz no válido.");
    if (!isBpm(input.bpm)) throw new Error("BPM no válido.");
    if (!isDuration(input.duration)) throw new Error("Duración no válida.");
    if (input.mode !== undefined && !isStudioMode(input.mode))
      throw new Error("Modo de estudio no válido.");
    return {
      prompt,
      lyrics,
      genre: input.genre,
      voice: input.voice,
      bpm: input.bpm,
      duration: input.duration,
      mode: input.mode,
      advanced: input.advanced,
    };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const { supabase, userId } = context;

    const { data: settings } = await supabase
      .from("site_settings")
      .select("songs_enabled")
      .eq("id", 1)
      .maybeSingle();
    if (settings && !settings.songs_enabled)
      return {
        ok: false,
        status: 403,
        message: "La creación de canciones está desactivada por ahora.",
      };

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

    if (!falKey() && !hfToken())
      return {
        ok: false,
        status: 500,
        message: "El administrador debe configurar Fal.ai o la token gratuita de Hugging Face.",
      };

    const { data: balance, error: creditError } = await supabase.rpc("consume_credits", {
      _amount: CREDIT_COSTS.song,
      _reason: "Canción",
    });
    if (creditError) return { ok: false, status: 402, message: creditErrorMessage(creditError) };
    const spent = balance === -1 ? 0 : CREDIT_COSTS.song;

    const admin = await getAdminClient();
    const { data: song, error: insertError } = await admin
      .from("songs")
      .insert({
        user_id: userId,
        kind: "song",
        title: titleFromPrompt(data.prompt || data.lyrics),
        prompt: data.prompt,
        lyrics: data.lyrics || null,
        genre: data.genre,
        voice_type: data.voice,
        bpm: data.bpm,
        duration_seconds: data.duration,
        status: "generating",
        media_type: "audio/mpeg",
        credits_spent: spent,
      })
      .select("id")
      .single();
    if (insertError || !song) {
      console.error("songs insert failed", insertError);
      if (spent)
        await admin.rpc("grant_credits", {
          _user_id: userId,
          _amount: spent,
          _reason: "Reembolso por creación fallida",
        });
      return { ok: false, status: 500, message: "No se pudo empezar la canción." };
    }

    const fail = async (status: number, message: string): Promise<ActionResult> => {
      await failCreation(admin, song.id, userId, message);
      return { ok: false, status, message };
    };

    const musicPrompt = buildMusicPrompt({
      description: data.prompt,
      lyrics: data.lyrics,
      genre: data.genre,
      voice: data.voice,
      bpm: data.bpm,
      seconds: data.duration,
      ...(data.mode ? { mode: data.mode } : {}),
      ...(data.advanced ? { advanced: data.advanced } : {}),
    });

    let generated: GeneratedAudio;
    if (falKey()) {
      try {
        const submitted = await falSubmit("fal-ai/lyria-2", {
          prompt: musicPrompt,
          duration: data.duration,
        });
        const output = await falWait(submitted.response_url);
        const audioUrl = falAudioUrl(output);
        if (!audioUrl) throw new Error("FAL_NO_AUDIO");
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) throw new Error("FAL_DOWNLOAD_FAILED");
        generated = audioFromBytes(
          new Uint8Array(await audioResponse.arrayBuffer()),
          audioResponse.headers.get("content-type") ?? "",
        );
      } catch (err) {
        const code = err instanceof Error ? err.message : "FAL_UNKNOWN";
        console.error("music request failed", err);
        if (!hfToken() || !isFalBalanceError(err)) return fail(500, falErrorMessage(code));
        try {
          generated = await huggingFaceAudio(musicPrompt);
        } catch (fallbackError) {
          const fallbackCode =
            fallbackError instanceof Error ? fallbackError.message : "HF_UNKNOWN";
          console.error("hugging face fallback failed", fallbackError);
          return fail(500, hfErrorMessage(fallbackCode));
        }
      }
    } else {
      try {
        generated = await huggingFaceAudio(musicPrompt);
      } catch (err) {
        const code = err instanceof Error ? err.message : "HF_UNKNOWN";
        console.error("hugging face request failed", err);
        return fail(500, hfErrorMessage(code));
      }
    }
    if (generated.bytes.byteLength === 0)
      return fail(502, "El generador no devolvió audio. Inténtalo de nuevo.");

    const path = `${userId}/${song.id}.${generated.extension}`;
    const { error: uploadError } = await admin.storage
      .from("songs")
      .upload(path, generated.bytes, { contentType: generated.contentType, upsert: true });
    if (uploadError) {
      console.error("upload failed", uploadError);
      return fail(500, "La canción se generó pero no se pudo guardar.");
    }

    await admin
      .from("songs")
      .update({
        status: "ready",
        storage_path: path,
        media_type: generated.contentType,
        error: null,
      })
      .eq("id", song.id);
    return { ok: true, songId: song.id };
  });

type LyricsInput = { idea: string; genre: Genre; voice: VoiceType };

export const writeLyrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: LyricsInput) => {
    const idea =
      typeof input?.idea === "string" ? input.idea.trim().slice(0, MAX_PROMPT_LENGTH) : "";
    if (idea.length < 3) throw new Error("Escribe primero una idea para la canción.");
    const blocked = findBlockedArtist(idea);
    if (blocked) throw new Error(`No podemos imitar ni nombrar a artistas reales como ${blocked}.`);
    if (!isGenre(input.genre)) throw new Error("Género no válido.");
    if (!isVoiceType(input.voice)) throw new Error("Tipo de voz no válido.");
    return { idea, genre: input.genre, voice: input.voice };
  })
  .handler(
    async ({ data }): Promise<{ ok: true; lyrics: string } | { ok: false; message: string }> => {
      const apiKey = process.env["OPENAI_API_KEY"];
      if (!apiKey) return { ok: false, message: "La IA de letras no está configurada." };
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_output_tokens: 1200,
          input: [
            {
              role: "system",
              content:
                "Eres un compositor profesional de música latina. Escribes letras originales en español, con rima y métrica cantables. Devuelve SOLO la letra, con secciones marcadas exactamente como [Intro], [Verso 1], [Pre-Coro], [Coro], [Verso 2], [Puente] y [Outro] según convenga. Sin comentarios ni títulos.",
            },
            {
              role: "user",
              content: `Género: ${data.genre}. Voz: ${data.voice}. Idea: ${data.idea}. Escribe una letra de unos 2-3 minutos con un coro pegajoso que se repita.`,
            },
          ],
        }),
      });
      if (!res.ok) {
        const raw = await res.text();
        console.error("lyrics error", res.status, raw.slice(0, 400));
        if (res.status === 429)
          return { ok: false, message: "Hay muchas solicitudes ahora. Inténtalo en un momento." };
        if (res.status === 402)
          return { ok: false, message: "No quedan créditos de IA para escribir letras." };
        return { ok: false, message: "No se pudo escribir la letra. Inténtalo de nuevo." };
      }
      const json = (await res.json()) as {
        output_text?: string;
        output?: { type: string; content?: { type: string; text?: string }[] }[];
      };
      const text =
        json.output_text ??
        (json.output ?? [])
          .flatMap((o) => o.content ?? [])
          .filter((c) => c.type === "output_text" && c.text)
          .map((c) => c.text)
          .join("\n");
      if (!text?.trim())
        return { ok: false, message: "La IA no devolvió una letra. Prueba con otra idea." };
      return { ok: true, lyrics: text.trim().slice(0, MAX_LYRICS_LENGTH) };
    },
  );
