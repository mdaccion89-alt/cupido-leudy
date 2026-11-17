import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_PROMPT_LENGTH,
  buildMusicPrompt,
  isDuration,
  isGenre,
  modelForDuration,
  titleFromPrompt,
  type DurationSeconds,
  type Genre,
} from "./music";

type GenerateInput = { prompt: string; genre: Genre; duration: DurationSeconds };

export type GenerateResult =
  | { ok: true; songId: string }
  | { ok: false; status: number; message: string };

function friendlyError(status: number, raw: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: { message?: string } | string };
    message =
      parsed.message ??
      (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ??
      "";
  } catch {
    message = "";
  }
  if (status === 429) return "Hay muchas solicitudes ahora mismo. Espera un momento e inténtalo de nuevo.";
  if (status === 402) return message || "No quedan créditos de IA disponibles para generar música.";
  if (status === 403) return message || "La generación de música no está permitida en este momento.";
  if (status === 400) return message || "No se pudo procesar la descripción. Prueba a reformularla.";
  return message || "No se pudo generar la canción. Inténtalo de nuevo en unos minutos.";
}

export const generateSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenerateInput) => {
    const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
    if (prompt.length < 3) throw new Error("Describe tu canción con al menos unas palabras.");
    if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("La descripción es demasiado larga.");
    if (!isGenre(input.genre)) throw new Error("Género no válido.");
    if (!isDuration(input.duration)) throw new Error("Duración no válida.");
    return { prompt, genre: input.genre, duration: input.duration };
  })
  .handler(async ({ data, context }): Promise<GenerateResult> => {
    const { supabase, userId } = context;

    const { data: song, error: insertError } = await supabase
      .from("songs")
      .insert({
        user_id: userId,
        title: titleFromPrompt(data.prompt),
        prompt: data.prompt,
        genre: data.genre,
        duration_seconds: data.duration,
        status: "generating",
      })
      .select("id")
      .single();
    if (insertError || !song) {
      console.error("songs insert failed", insertError);
      return { ok: false, status: 500, message: "No se pudo empezar la canción." };
    }

    const fail = async (status: number, message: string): Promise<GenerateResult> => {
      await supabase.from("songs").update({ status: "failed", error: message }).eq("id", song.id);
      return { ok: false, status, message };
    };

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return fail(500, "La generación de música no está configurada.");

    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/music", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelForDuration(data.duration),
          input: [
            {
              type: "user_input",
              content: [{ type: "text", text: buildMusicPrompt(data.prompt, data.genre, data.duration) }],
            },
          ],
        }),
      });
    } catch (err) {
      console.error("music request failed", err);
      return fail(502, "No se pudo conectar con el generador de música.");
    }

    if (!response.ok) {
      const raw = await response.text();
      console.error("music generation error", response.status, raw.slice(0, 500));
      return fail(response.status, friendlyError(response.status, raw));
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) return fail(502, "El generador no devolvió audio. Inténtalo de nuevo.");

    const path = `${userId}/${song.id}.mp3`;
    const { error: uploadError } = await supabase.storage
      .from("songs")
      .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
    if (uploadError) {
      console.error("upload failed", uploadError);
      return fail(500, "La canción se generó pero no se pudo guardar.");
    }

    await supabase.from("songs").update({ status: "ready", storage_path: path, error: null }).eq("id", song.id);
    return { ok: true, songId: song.id };
  });
