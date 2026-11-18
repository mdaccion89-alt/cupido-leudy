import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CREDIT_COSTS, creditErrorMessage } from "./credits";
import {
  MAX_ADVANCED_LENGTH,
  MAX_GENRE_LENGTH,
  MAX_LYRICS_LENGTH,
  MAX_PROMPT_LENGTH,
  buildMusicPrompt,
  engineModel,
  findBlockedArtist,
  isBpm,
  isCreationMode,
  isDuration,
  isEngineId,
  isGenre,
  isHfEngine,
  isStudioMode,
  isVoiceType,
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
  audioFromBytes,
  falErrorMessage,
  falKey,
  falSubmit,
  falWait,
  failCreation,
  geminiErrorMessage,
  geminiText,
  getAdminClient,
  hfErrorMessage,
  hfTokens,
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
  engine?: EngineId;
  creationMode?: CreationMode;
  advanced?: AdvancedParams;
};

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

function resolveModel(engine: EngineId | undefined): string {
  const defaultModel = engineModel(engine);
  const suffix = engine?.toUpperCase().replace(/-/g, "_") ?? "V7_PRO";
  return process.env[`FAL_MODEL_${suffix}`]?.trim() || defaultModel;
}

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
    const advanced = sanitizeAdvanced(input.advanced);
    const genre =
      typeof input.genre === "string" ? sanitizePrompt(input.genre, MAX_GENRE_LENGTH) : "";
    const blocked = findBlockedArtist(
      `${prompt}\n${lyrics}\n${genre}\n${advanced ? Object.values(advanced).join("\n") : ""}`,
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
      genre,
      voice: input.voice,
      bpm: input.bpm,
      duration: input.duration,
      mode: input.mode,
      engine: input.engine ?? "v7-pro",
      creationMode: input.creationMode ?? "simple",
      advanced,
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

    const hfAvailable = hfTokens().length > 0;
    if (!falKey() && !hfAvailable)
      return {
        ok: false,
        status: 500,
        message:
          "El administrador debe configurar Fal.ai, HF_TOKENS o la token gratuita de Hugging Face.",
      };
    const hfEngine = isHfEngine(data.engine);
    if (hfEngine && !hfAvailable)
      return {
        ok: false,
        status: 500,
        message: "Este motor usa Hugging Face. El administrador debe configurar HF_TOKENS.",
      };

    const { data: balance, error: creditError } = await supabase.rpc("consume_credits", {
      _amount: CREDIT_COSTS.song,
      _reason: "Canción",
    });
    if (creditError) return { ok: false, status: 402, message: creditErrorMessage(creditError) };
    const spent = balance === -1 ? 0 : CREDIT_COSTS.song;

    const falModel = resolveModel(data.engine);
    const hfModel = process.env["HF_MUSIC_MODEL"]?.trim() || engineModel(data.engine);
    const selectedModel = hfEngine ? hfModel : falModel;
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
        external_model: selectedModel,
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
      engine: data.engine,
      creationMode: data.creationMode,
      ...(data.advanced ? { advanced: data.advanced } : {}),
    });

    let generated: GeneratedAudio;
    if (hfEngine) {
      try {
        generated = await huggingFaceAudio(musicPrompt, { model: hfModel });
      } catch (err) {
        const code = err instanceof Error ? err.message : "HF_UNKNOWN";
        console.error("hugging face request failed", err);
        return fail(500, hfErrorMessage(code));
      }
    } else if (falKey()) {
      try {
        const submitted = await falSubmit(falModel, {
          prompt: musicPrompt,
          duration: data.duration,
          engine: data.engine,
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
        if (!hfAvailable || !isFalBalanceError(err)) return fail(500, falErrorMessage(code));
        try {
          generated = await huggingFaceAudio(musicPrompt, { model: "facebook/musicgen-small" });
        } catch (fallbackError) {
          const fallbackCode =
            fallbackError instanceof Error ? fallbackError.message : "HF_UNKNOWN";
          console.error("hugging face fallback failed", fallbackError);
          return fail(500, hfErrorMessage(fallbackCode));
        }
      }
    } else {
      try {
        generated = await huggingFaceAudio(musicPrompt, { model: "facebook/musicgen-small" });
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
        const code = err instanceof Error ? err.message : "GEMINI_UNKNOWN";
        if (code !== "GEMINI_NOT_CONFIGURED") console.error("gemini lyrics failed", err);
      }
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
        if (!clean) return { ok: false, message: "La IA no devolvió una mejora." };
        return { ok: true, prompt: clean };
      } catch (err) {
        const code = err instanceof Error ? err.message : "GEMINI_UNKNOWN";
        console.error("gemini prompt improvement failed", err);
        return { ok: false, message: geminiErrorMessage(code) };
      }
    },
  );
