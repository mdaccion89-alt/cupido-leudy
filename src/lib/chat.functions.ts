import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { geminiGenerate } from "@/lib/server-helpers";

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type AssistantChatInput = {
  message: string;
  history?: ChatHistoryMessage[];
};

export type AssistantChatSource = "gemini" | "openai" | "offline";

export type AssistantChatResult =
  | {
      ok: true;
      reply: string;
      needsSupportTicket: boolean;
      source: AssistantChatSource;
      ticketId?: string;
    }
  | {
      ok: false;
      message: string;
      needsSupportTicket: boolean;
      source?: AssistantChatSource;
      ticketId?: string;
    };

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_CONTENT_LENGTH = 4000;
const MAX_TICKET_BODY_LENGTH = 2000;
const TICKET_RATE_LIMIT = 5;
const TICKET_RATE_WINDOW_MS = 60 * 60 * 1000;
const ASSISTANT_SYSTEM =
  'Tu identidad es exactamente "Thank You For Everything". Eres un asistente de IA cálido y profesional. Responde siempre en el MISMO idioma en que el usuario te escribe. Tienes experiencia global en música, marketing, inteligencia artificial, guiones, letras, prompts y soporte técnico. Puedes escribir letras, mejorar prompts y diagnosticar errores. No menciones secretos ni claves. No inventes APIs.';

const SUPPORT_TICKET_REGEX =
  /\berror\b|\bfallo\b|\bno funciona\b|\bbug\b|\bexception\b|\bfailed\b|\bproblema\b|\bsoporte\b|\bticket\b|error 403|error 404|error 500|error 429|\b403\b|\b404\b|\b500\b|\b429\b/i;

function sanitizeHistory(history: ChatHistoryMessage[] | undefined): ChatHistoryMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => {
      const role: "user" | "assistant" = item?.role === "assistant" ? "assistant" : "user";
      const content =
        typeof item?.content === "string" ? item.content.slice(0, MAX_HISTORY_CONTENT_LENGTH) : "";
      return { role, content };
    })
    .filter((item) => item.content.trim().length > 0);
}

function formatSupportTicketBody(message: string, assistantReply: string): string {
  return [
    "Soporte solicitado desde Thank You For Everything",
    "",
    "Mensaje del usuario:",
    message,
    "",
    "Respuesta del asistente:",
    assistantReply,
  ]
    .join("\n")
    .slice(0, MAX_TICKET_BODY_LENGTH);
}

function getUserLanguage(message: string, history: ChatHistoryMessage[]): "es" | "en" {
  const text = `${history
    .slice(-4)
    .map((item) => item.content)
    .join(" ")} ${message}`.toLowerCase();
  const spanishHits = (
    text.match(
      /\b(hola|gracias|error|ayuda|cancion|canción|letra|credito|crédito|como|cómo|quiero|necesito|por favor|soporte)\b|[áéíóúñ¿¡]/g,
    ) || []
  ).length;
  const englishHits = (
    text.match(
      /\b(hi|hello|thanks|error|help|song|lyrics|credit|how|please|support|ticket|prompt)\b/g,
    ) || []
  ).length;
  if (englishHits > spanishHits) return "en";
  return "es";
}

function cleanOfflineInput(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

function offlineReply(
  message: string,
  history: ChatHistoryMessage[],
  wantsSupport: boolean,
): string {
  const lang = getUserLanguage(message, history);
  const lower = message.toLowerCase();
  const snippet = cleanOfflineInput(message);
  if (/(letra|lyrics|verso|coro|estrofa|escribe.*(cancion|canción|tema))/.test(lower)) {
    if (lang === "en") {
      return `I can draft lyrics based on your idea "${snippet}".\n\n[Verse 1]\nI hear your story in the midnight glow,\nEvery step you take helps your spirit grow.\n\n[Chorus]\nKeep moving forward, don't let go,\nYour voice can shine, let the feeling show.\n\n[Verse 2]\nTurn your memories into melody,\nSay what you feel with honesty.\n\n[Chorus]\nKeep moving forward, don't let go,\nYour voice can shine, let the feeling show.\n\nIf you share genre, mood, and artist references to avoid, I can tailor it further.`;
    }
    return `Puedo ayudarte con una letra basada en tu idea "${snippet}".\n\n[Verso 1]\nSiento tu historia en la luz de la ciudad,\ncada paso tuyo me enseña a avanzar.\n\n[Coro]\nSigue adelante, no sueltes tu voz,\ntu sueño es música, late en tu interior.\n\n[Verso 2]\nConvierte recuerdos en melodía,\ncuenta tu verdad con valentía.\n\n[Coro]\nSigue adelante, no sueltes tu voz,\ntu sueño es música, late en tu interior.\n\nSi me indicas género, estado de ánimo y referencias a evitar, la adapto más.`;
  }
  if (/(prompt|mejorar|improve|idea musical|generaci[oó]n musical)/.test(lower)) {
    if (lang === "en") {
      return `Improved prompt suggestion:\n- Goal: ${snippet || "describe the song you want"}\n- Genre/style: specify 1-2 genres and tempo/BPM.\n- Mood and theme: describe emotions, story, and imagery.\n- Vocals/instruments: male/female/duet/instrumental, key instruments.\n- Structure: intro, verse, chorus, bridge, outro, target duration.\n- Safety: avoid protected artists, brands, characters, or copyrighted works.\n\nExample: "Uplifting Latin pop at 110 BPM with warm male vocals, acoustic guitar and piano, hopeful lyrics about new beginnings, 2:30, clear chorus and soft outro."`;
    }
    return `Sugerencia de prompt mejorado:\n- Objetivo: ${snippet || "describe la canción que quieres"}\n- Género/estilo: indica 1-2 géneros y tempo/BPM.\n- Emoción y tema: explica la historia, imágenes y sentimiento.\n- Voz e instrumentos: masculina/femenina/dueto/instrumental e instrumentos clave.\n- Estructura: intro, verso, coro, puente, final y duración deseada.\n- Seguridad: evita artistas, marcas, personajes u obras protegidas por derechos de autor.\n\nEjemplo: "Pop latino optimista a 110 BPM con voz masculina cálida, guitarra acústica y piano, letra esperanzadora sobre nuevos comienzos, 2:30, coro claro y cierre suave."`;
  }
  if (/(credito|cr[eé]dito|cobro|carg|plan|suscrip|precio|billing|charge)/.test(lower)) {
    if (lang === "en") {
      return "I can help with credits and billing questions. If a request is blocked for copyright safety, no credits are charged and no provider is called. For generation, credits are used according to the selected action and plan. Tell me what you tried, what you expected, and I can guide the next step or prepare a support ticket if needed.";
    }
    return "Puedo ayudarte con créditos y cobros. Si una solicitud se bloquea por seguridad de derechos de autor, no se realiza ningún cargo de créditos y no se llama a ningún proveedor. Para las generaciones, los créditos se usan según la acción y el plan seleccionado. Cuéntame qué intentaste, qué esperabas y te guío con el siguiente paso o preparo un ticket de soporte si hace falta.";
  }
  if (
    wantsSupport ||
    /(error|fallo|no funciona|bug|exception|failed|403|404|429|500)/.test(lower)
  ) {
    if (lang === "en") {
      return "I couldn't reach the AI providers right now, but I can still help with support. Please share: what you were trying to do, the exact steps, the time it happened, and any visible error code (403/404/429/500). I'll summarize it clearly and a support ticket can be created for follow-up.";
    }
    return "No pude conectarme con los proveedores de IA en este momento, pero puedo ayudarte con soporte. Compárteme: qué estabas intentando hacer, los pasos exactos, la hora aproximada y cualquier código de error visible (403/404/429/500). Lo resumiré con claridad y se puede crear un ticket de soporte para darle seguimiento.";
  }
  if (lang === "en") {
    return `I'm here to help with music, marketing, AI, scripts, lyrics, prompts, and technical support. Tell me what you need and I'll guide you step by step.${snippet ? `\n\nI understood: "${snippet}"` : ""}`;
  }
  return `Estoy aquí para ayudarte con música, marketing, IA, guiones, letras, prompts y soporte técnico. Cuéntame qué necesitas y te guiaré paso a paso.${snippet ? `\n\nEntendí: "${snippet}"` : ""}`;
}

async function generateWithOpenAI(
  message: string,
  history: ChatHistoryMessage[],
): Promise<string | null> {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: ASSISTANT_SYSTEM },
          ...history.map((item) => ({ role: item.role, content: item.content })),
          { role: "user", content: message },
        ],
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}

async function logSupportTicket(
  supabase: SupabaseClient<Database>,
  userId: string,
  body: string,
): Promise<string | undefined> {
  const since = new Date(Date.now() - TICKET_RATE_WINDOW_MS).toISOString();
  const recent = await supabase
    .from("support_messages")
    .select("id,body,created_at")
    .eq("user_id", userId)
    .eq("from_admin", false)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(TICKET_RATE_LIMIT);
  if (!recent.error) {
    const recentRows = (recent.data ?? []) as Array<{ id: string; body: string }>;
    const duplicate = recentRows.find((row) => row.body === body);
    if (duplicate) return duplicate.id;
    if (recentRows.length >= TICKET_RATE_LIMIT) return recentRows[0]?.id;
  }
  const inserted = await supabase
    .from("support_messages")
    .insert({
      user_id: userId,
      from_admin: false,
      body,
    })
    .select("id")
    .single();
  if (inserted.error) {
    console.error("support_messages insert failed", inserted.error);
    return undefined;
  }
  return (inserted.data as { id: string } | null)?.id;
}

async function runAssistantReply(message: string, history: ChatHistoryMessage[]) {
  const wantsSupport = SUPPORT_TICKET_REGEX.test(message);
  const gemini = await geminiGenerate(ASSISTANT_SYSTEM, message, history);
  if (gemini.ok) {
    const reply = gemini.text;
    return {
      source: "gemini" as const,
      reply,
      needsSupportTicket: wantsSupport || SUPPORT_TICKET_REGEX.test(reply),
    };
  }
  const openai = await generateWithOpenAI(message, history);
  if (openai) {
    return {
      source: "openai" as const,
      reply: openai,
      needsSupportTicket: wantsSupport || SUPPORT_TICKET_REGEX.test(openai),
    };
  }
  const reply = offlineReply(message, history, wantsSupport);
  return {
    source: "offline" as const,
    reply,
    needsSupportTicket: wantsSupport || SUPPORT_TICKET_REGEX.test(reply),
  };
}

export const assistantChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AssistantChatInput) => {
    const message = typeof input?.message === "string" ? input.message.trim() : "";
    if (message.length < 1 || message.length > MAX_MESSAGE_LENGTH) {
      throw new Error("El mensaje debe tener entre 1 y 4000 caracteres.");
    }
    return {
      message,
      history: sanitizeHistory(input?.history),
    };
  })
  .handler(async ({ data, context }): Promise<AssistantChatResult> => {
    const generated = await runAssistantReply(data.message, data.history);
    let ticketId: string | undefined;
    if (generated.needsSupportTicket) {
      ticketId = await logSupportTicket(
        context.supabase as SupabaseClient<Database>,
        context.userId,
        formatSupportTicketBody(data.message, generated.reply),
      );
    }
    return {
      ok: true,
      reply: generated.reply,
      needsSupportTicket: generated.needsSupportTicket,
      source: generated.source,
      ...(ticketId ? { ticketId } : {}),
    };
  });

export type CreateSupportTicketInput = {
  message: string;
  assistantReply: string;
};

export type CreateSupportTicketResult =
  { ok: true; ticketId?: string } | { ok: false; message: string };

export const createSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateSupportTicketInput) => {
    const message = typeof input?.message === "string" ? input.message : "";
    const assistantReply = typeof input?.assistantReply === "string" ? input.assistantReply : "";
    if (!message.trim()) {
      throw new Error("Falta el mensaje del usuario para el ticket.");
    }
    if (!assistantReply.trim()) {
      throw new Error("Falta la respuesta del asistente para el ticket.");
    }
    return {
      message: message.slice(0, MAX_MESSAGE_LENGTH),
      assistantReply: assistantReply.slice(0, MAX_MESSAGE_LENGTH),
    };
  })
  .handler(async ({ data, context }): Promise<CreateSupportTicketResult> => {
    const ticketId = await logSupportTicket(
      context.supabase as SupabaseClient<Database>,
      context.userId,
      formatSupportTicketBody(data.message, data.assistantReply),
    );
    if (!ticketId) {
      return { ok: false, message: "No se pudo crear el ticket de soporte." };
    }
    return { ok: true, ticketId };
  });

export type ReportAssistantIssueInput = {
  message: string;
  assistantReply?: string;
};

export type ReportAssistantIssueResult =
  | { ok: true; ticketId?: string; reply: string; source: AssistantChatSource }
  | { ok: false; message: string };

export const reportAssistantIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ReportAssistantIssueInput) => {
    const message = typeof input?.message === "string" ? input.message.trim() : "";
    if (message.length < 1 || message.length > MAX_MESSAGE_LENGTH) {
      throw new Error("El mensaje debe tener entre 1 y 4000 caracteres.");
    }
    const assistantReply =
      typeof input?.assistantReply === "string"
        ? input.assistantReply.slice(0, MAX_MESSAGE_LENGTH)
        : "";
    return { message, assistantReply };
  })
  .handler(async ({ data, context }): Promise<ReportAssistantIssueResult> => {
    const lang = getUserLanguage(data.message, []);
    const fallbackReply =
      data.assistantReply ||
      (lang === "en"
        ? "Support issue reported. A ticket has been logged for follow-up."
        : "Incidencia reportada. Se registró un ticket de soporte para darle seguimiento.");
    const ticketId = await logSupportTicket(
      context.supabase as SupabaseClient<Database>,
      context.userId,
      formatSupportTicketBody(data.message, fallbackReply),
    );
    if (!ticketId) {
      return {
        ok: false,
        message:
          lang === "en"
            ? "Could not create the support ticket."
            : "No se pudo crear el ticket de soporte.",
      };
    }
    return { ok: true, ticketId, reply: fallbackReply, source: "offline" };
  });
