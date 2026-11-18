import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type AssistantChatInput = {
  message: string;
  history?: ChatHistoryMessage[];
};

export type AssistantChatResult =
  | { ok: true; reply: string; needsSupportTicket: boolean }
  | { ok: false; message: string; needsSupportTicket: boolean };

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_CONTENT_LENGTH = 4000;

const SUPPORT_TICKET_REGEX =
  /\berror\b|\bfallo\b|\bno funciona\b|\bbug\b|\bexception\b|failed\b|error 403|error 404|error 500|error 429|\b403\b|\b404\b|\b500\b|\b429\b/i;

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
  const body = [
    "Soporte solicitado desde Thank You For Everything",
    "",
    "Mensaje del usuario:",
    message,
    "",
    "Respuesta del asistente:",
    assistantReply,
  ].join("\n");
  return body.slice(0, 2000);
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
  .handler(async ({ data }): Promise<AssistantChatResult> => {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      return {
        ok: false,
        message:
          "El asistente IA no está configurado. El administrador debe añadir la Gemini API Key.",
        needsSupportTicket: false,
      };
    }

    const systemInstruction =
      'Tu identidad es exactamente "Thank You For Everything". Eres un asistente de IA cálido y profesional. Responde siempre en el MISMO idioma en que el usuario te escribe. Tienes experiencia global en música, marketing, inteligencia artificial, guiones, letras, prompts y soporte técnico. Puedes escribir letras, mejorar prompts y diagnosticar errores. No menciones secretos ni claves. No inventes APIs.';

    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
    for (const item of data.history) {
      contents.push({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      });
    }
    contents.push({
      role: "user",
      parts: [{ text: data.message }],
    });

    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents,
          }),
        },
      );
    } catch {
      return {
        ok: false,
        message: "No se pudo conectar con el servicio de IA. Inténtalo de nuevo.",
        needsSupportTicket: SUPPORT_TICKET_REGEX.test(data.message),
      };
    }

    if (!res.ok) {
      let apiMessage = "No se pudo obtener una respuesta del asistente IA.";
      try {
        const errJson = (await res.json()) as { error?: { message?: string; status?: string } };
        if (
          typeof errJson?.error?.message === "string" &&
          errJson.error.message.trim().length > 0
        ) {
          apiMessage = errJson.error.message.trim();
        }
      } catch {
        apiMessage = `HTTP ${res.status}`;
      }
      return {
        ok: false,
        message: apiMessage,
        needsSupportTicket:
          SUPPORT_TICKET_REGEX.test(data.message) || SUPPORT_TICKET_REGEX.test(apiMessage),
      };
    }

    let json: {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return {
        ok: false,
        message: "No se pudo leer la respuesta del asistente IA.",
        needsSupportTicket: false,
      };
    }

    const parts = json?.candidates?.[0]?.content?.parts;
    const replyText = Array.isArray(parts)
      ? parts
          .map((p) => (typeof p?.text === "string" ? p.text : ""))
          .join("")
          .trim()
      : "";

    if (!replyText) {
      return {
        ok: false,
        message: "El asistente IA no devolvió una respuesta. Inténtalo de nuevo.",
        needsSupportTicket: false,
      };
    }

    const needsSupportTicket =
      SUPPORT_TICKET_REGEX.test(data.message) || SUPPORT_TICKET_REGEX.test(replyText);

    return {
      ok: true,
      reply: replyText,
      needsSupportTicket,
    };
  });

export type CreateSupportTicketInput = {
  message: string;
  assistantReply: string;
};

export type CreateSupportTicketResult = { ok: true } | { ok: false; message: string };

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
    const { supabase, userId } = context;
    const body = formatSupportTicketBody(data.message, data.assistantReply);
    const { error } = await supabase.from("support_messages").insert({
      user_id: userId,
      from_admin: false,
      body,
    });
    if (error) {
      console.error("support_messages insert failed", error);
      return { ok: false, message: "No se pudo crear el ticket de soporte." };
    }
    return { ok: true };
  });
