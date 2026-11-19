import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findBlockedTerm } from "./copyright";
import { CREDIT_COSTS, creditErrorMessage } from "./credits";
import {
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
import { geminiErrorMessage, geminiText, getAdminClient } from "./server-helpers";

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
};

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

function parseSongText(value: string): SongText {
  const cleaned = value.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const letra = typeof parsed["letra"] === "string" ? parsed["letra"].trim() : "";
    const acordes = typeof parsed["acordes"] === "string" ? parsed["acordes"].trim() : "";
    const estructura = typeof parsed["estructura"] === "string" ? parsed["estructura"].trim() : "";
    if (letra)
      return {
        letra: letra.slice(0, MAX_LYRICS_LENGTH),
        acordes: acordes || "C - G - Am - F (repetir)",
        estructura: estructura || "Intro - Verso - Coro - Verso - Coro - Outro",
      };
  } catch {}
  return {
    letra: cleaned.slice(0, MAX_LYRICS_LENGTH),
    acordes: "C - G - Am - F (repetir)",
    estructura: "Intro - Verso - Coro - Verso - Coro - Outro",
  };
}

async function songText(prompt: string): Promise<SongText> {
  const system =
    'Eres compositor profesional de música latina. Devuelve SOLO un objeto JSON válido con las claves "letra", "acordes" y "estructura". "letra": letra completa y original en español con secciones [Intro], [Verso 1], [Pre-Coro], [Coro], [Verso 2], [Puente] y [Outro]. "acordes": progresión por sección en notación C/G/Am/F. "estructura": orden de secciones con duración aproximada. Sin markdown, sin explicaciones y sin artistas reales.';
  const text = await geminiText(system, prompt);
  return parseSongText(text);
}

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
    }
  | { ok: false; status: number; message: string };

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

    let text: SongText;
    try {
      text = await songText(musicPrompt);
    } catch (error) {
      console.error("gemini song text failed", error);
      return {
        ok: false,
        status: 500,
        message: "No se pudo escribir la canción con Gemini. Inténtalo de nuevo.",
      };
    }

    const { data: balance, error: creditError } = await supabase.rpc("consume_credits", {
      _amount: CREDIT_COSTS.song,
      _reason: "Canción",
    });
    if (creditError) return { ok: false, status: 402, message: creditErrorMessage(creditError) };
    const spent = balance === -1 ? 0 : CREDIT_COSTS.song;

    const admin = await getAdminClient();
    const title = data.title || titleFromPrompt(data.prompt || data.lyrics);
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
        status: "ready",
        media_type: "audio/wav",
        credits_spent: spent,
        external_model: "gemini-2.5-flash",
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
      return { ok: false, status: 500, message: "No se pudo guardar la canción." };
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
        const code = err instanceof Error ? err.message : "GEMINI_UNKNOWN";
        if (code !== "GEMINI_NOT_CONFIGURED") console.error("gemini lyrics failed", err);
        return { ok: false, message: geminiErrorMessage(code) };
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
        if (!clean) return { ok: false, message: "La IA no devolvió una mejora." };
        return { ok: true, prompt: clean };
      } catch (err) {
        const code = err instanceof Error ? err.message : "GEMINI_UNKNOWN";
        console.error("gemini prompt improvement failed", err);
        return { ok: false, message: geminiErrorMessage(code) };
      }
    },
  );
