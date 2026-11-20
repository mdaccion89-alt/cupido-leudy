import { createServerFn } from "@tanstack/react-start";
import { BRAND } from "@/lib/cupido";
import { geminiGenerate } from "@/lib/server-helpers";

type EscudoInput = {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type EscudoResult =
  | { ok: true; reply: string; source: "gemini" | "offline" }
  | { ok: false; message: string };

const ESCUDO_SYSTEM = `Eres El Escudo de ${BRAND}, el guardián de seguridad de una app de citas real. Hablas español cálido y directo. Ayudas a detectar perfiles falsos, estafas románticas y riesgos en citas. Nunca pides datos privados, contraseñas ni dinero. No necesitas inventar APIs. Da consejos prácticos: revisar fotos, verificar insignia azul, no enviar dinero fuera de PayPal, no compartir códigos, reunirse en lugares públicos, bloquear y denunciar. Responde en máximo 120 palabras.`;

function offlineEscudoReply(message: string): string {
  const text = message.toLowerCase();
  if (/estafa|dinero|pago|transferencia|inversi[oó]n|cripto/.test(text))
    return "🚩 Posible estafa. Nunca envíes dinero ni datos bancarios fuera de PayPal. Si te piden una transferencia, inversión o códigos, bloquea y denuncia el perfil desde el chat.";
  if (/falso|verif|insignia|foto|suplant/.test(text))
    return "Revisa que el perfil tenga la insignia azul verificada por el Admin Supremo. Compara la selfie con las fotos, desconfía de imágenes demasiado perfectas y denuncia si algo no cuadra.";
  if (/cita|salir|conocer|reuni/.test(text))
    return "Para una primera cita elige un lugar público y concurrido, avisa a alguien de confianza y no compartas tu dirección hasta haber ganado confianza. Tu seguridad va primero ❤️.";
  if (/desnud|sexual|nude|foto intima/.test(text))
    return "No envíes ni aceptes fotos íntimas. En Cupido Leudy están prohibidas y el Escudo puede suspender esas cuentas. Pide respeto o bloquea al usuario.";
  return "Confía en tu instinto: si algo te incomoda, pausa la conversación. Usa la insignia azul como señal de confianza, nunca compartas contraseñas y denuncia cualquier comportamiento sospechoso. El Escudo está contigo ❤️.";
}

export const escudoCupido = createServerFn({ method: "POST" })
  .middleware([])
  .inputValidator((input: EscudoInput) => ({
    message: typeof input?.message === "string" ? input.message.trim().slice(0, 2000) : "",
    history: Array.isArray(input?.history)
      ? input.history.slice(-10).map((item) => ({
          role: item?.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: typeof item?.content === "string" ? item.content.slice(0, 1000) : "",
        }))
      : [],
  }))
  .handler(async ({ data }): Promise<EscudoResult> => {
    if (!data.message) return { ok: false, message: "Escribe tu pregunta." };
    const result = await geminiGenerate(
      ESCUDO_SYSTEM,
      data.message,
      data.history.filter((item) => item.content.length > 0),
    );
    if (result.ok) return { ok: true, reply: result.text, source: "gemini" };
    return { ok: true, reply: offlineEscudoReply(data.message), source: "offline" };
  });

type ModerationInput = { dataUrl: string };

export type ModerationResult =
  | { ok: true; safe: boolean; reason: string; needsReview: boolean }
  | { ok: false; message: string };

const MODERATION_SYSTEM =
  'Analizas fotos para una app de citas. Devuelves SOLO JSON con la forma {"safe":true,"reason":"breve motivo en español"}. Marca safe=false si ves desnudos, pechos, genitales, nalgas, poses sexuales, contenido pornográfico, menores de edad, drogas o armas. Marca safe=true para selfies normales, retratos y fotos de cuerpo vestido.';

export const moderateCupidoPhoto = createServerFn({ method: "POST" })
  .middleware([])
  .inputValidator((input: ModerationInput) => ({
    dataUrl: typeof input?.dataUrl === "string" ? input.dataUrl.slice(0, 8_000_000) : "",
  }))
  .handler(async ({ data }): Promise<ModerationResult> => {
    const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s.exec(data.dataUrl);
    if (!match?.[1]) return { ok: false, message: "La imagen no es válida." };
    const apiKey = process.env["GEMINI_API_KEY"]?.trim();
    if (!apiKey)
      return {
        ok: true,
        safe: false,
        reason: "Revisión automática no disponible; el Admin Supremo revisará la foto.",
        needsReview: true,
      };
    const model = process.env["GEMINI_MODEL"]?.trim() || "gemini-2.5-flash";
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: MODERATION_SYSTEM }] },
            contents: [
              {
                role: "user",
                parts: [
                  { text: "Revisa esta imagen y responde solo el JSON." },
                  { inline_data: { mime_type: "image/jpeg", data: match[1] } },
                ],
              },
            ],
          }),
        },
      );
    } catch {
      return {
        ok: true,
        safe: false,
        reason: "No se pudo analizar la imagen; queda pendiente de revisión.",
        needsReview: true,
      };
    }
    if (!response.ok)
      return {
        ok: true,
        safe: false,
        reason: "No se pudo analizar la imagen; queda pendiente de revisión.",
        needsReview: true,
      };
    let text = "";
    try {
      const json = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      text = (json.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
    } catch {
      text = "";
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start)
      return {
        ok: true,
        safe: false,
        reason: "No se pudo analizar la imagen; queda pendiente de revisión.",
        needsReview: true,
      };
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        safe?: unknown;
        reason?: unknown;
      };
      const safe = parsed.safe === true;
      return {
        ok: true,
        safe,
        reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : safe ? "Foto aprobada" : "Contenido no permitido",
        needsReview: !safe,
      };
    } catch {
      return {
        ok: true,
        safe: false,
        reason: "No se pudo analizar la imagen; queda pendiente de revisión.",
        needsReview: true,
      };
    }
  });
