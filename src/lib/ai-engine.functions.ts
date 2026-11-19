import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { AiEngineKey, AiFunctionKey } from "@/lib/ai-engine-catalog";

type Db = SupabaseClient<Database>;

type GatewayEngine = {
  key: AiEngineKey;
  label: string;
  vendor: string;
  description: string;
  capabilities: AiFunctionKey[];
  models: string[];
  defaultModel: Partial<Record<AiFunctionKey, string>>;
  secrets: string[];
  quota: string;
  docsUrl: string;
  notes?: string;
  billing: "free-tier" | "self-hosted" | "free-tier-with-overage";
  paidAuthorizationRequired: boolean;
  customModel?: boolean;
  configured: Record<string, boolean>;
  allConfigured: boolean;
  enabled: boolean;
  model: string;
  status: "not_configured" | "ok" | "error" | string;
  statusDetail: string;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  quotaSnapshot: Record<string, string>;
  paidAuthorizedAt: string | null;
};

export type AiGatewayRoute = {
  function_key: AiFunctionKey;
  provider_key: AiEngineKey;
  model: string;
  priority: number;
  enabled: boolean;
};

export type AiGatewayLog = {
  id: string;
  user_id: string | null;
  function_key: string;
  provider_key: string;
  model: string;
  status: string;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
};

export type AiEngineSnapshot = {
  engines: GatewayEngine[];
  routes: AiGatewayRoute[];
  logs: AiGatewayLog[];
  gateway: {
    serviceRoleConfigured: boolean;
    secretsConfigured: Record<string, boolean>;
  };
};

export type AiEngineTestResult = {
  ok: boolean;
  detail?: string;
  quota?: Record<string, string>;
  latencyMs?: number;
  error?: string;
};

export type AiEngineTextResult = {
  ok: true;
  providerKey: AiEngineKey;
  providerLabel: string;
  model: string;
  text: string;
};

export type AiEngineImageResult = {
  ok: true;
  providerKey: AiEngineKey;
  providerLabel: string;
  model: string;
  imageBase64: string;
  mimeType: string;
};

export type AiEngineTranscriptionResult = {
  ok: true;
  providerKey: AiEngineKey;
  providerLabel: string;
  model: string;
  text: string;
};

export type AiEngineGenerateResult =
  | AiEngineTextResult
  | AiEngineImageResult
  | AiEngineTranscriptionResult;

type GatewayResponse<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

type GatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function invokeGateway<T>(
  supabase: Db,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<GatewayResponse<T>> {
  const { data, error } = await supabase.functions.invoke("ai-gateway", {
    body: { action, ...payload },
  });
  if (error) {
    const record = error as { message?: string; context?: { status?: number } };
    return {
      ok: false,
      status: record.context?.status ?? 502,
      message: record.message ?? "No se pudo conectar con el gateway de motores IA.",
    };
  }
  const result = data as { ok?: boolean; error?: string } | null;
  if (result && result.ok === false) {
    return { ok: false, status: 502, message: result.error ?? "El gateway rechazó la solicitud." };
  }
  return { ok: true, data: data as T };
}

export async function getAiEngineSnapshot(supabase: Db): Promise<AiEngineSnapshot | null> {
  const result = await invokeGateway<AiEngineSnapshot>(supabase, "status");
  return result.ok ? result.data : null;
}

export async function testAiEngineGateway(
  supabase: Db,
  providerKey: AiEngineKey,
  model?: string | undefined,
): Promise<AiEngineTestResult> {
  const result = await invokeGateway<AiEngineTestResult>(supabase, "test", { providerKey, model });
  return result.ok
    ? result.data
    : { ok: false, error: result.message };
}

export async function generateWithGateway(
  supabase: Db,
  payload: {
    functionKey: AiFunctionKey;
    prompt?: string | undefined;
    messages?: GatewayMessage[] | undefined;
    width?: number | undefined;
    height?: number | undefined;
    seed?: number | undefined;
    audioBase64?: string | undefined;
    mimeType?: string | undefined;
  },
): Promise<AiEngineGenerateResult | null> {
  const result = await invokeGateway<AiEngineGenerateResult>(supabase, "generate", payload);
  return result.ok && result.data?.ok ? result.data : null;
}

export const getAiEngines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiEngineSnapshot | null> =>
    getAiEngineSnapshot(context.supabase as Db),
  );

export const testAiEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { providerKey: string; model?: string | undefined }) => {
    const providerKey = input?.providerKey;
    if (typeof providerKey !== "string" || !providerKey.trim())
      throw new Error("Selecciona un motor.");
    return {
      providerKey: providerKey.trim() as AiEngineKey,
      model: typeof input?.model === "string" ? input.model.trim().slice(0, 120) : undefined,
    };
  })
  .handler(async ({ data, context }): Promise<AiEngineTestResult> =>
    testAiEngineGateway(context.supabase as Db, data.providerKey, data.model),
  );

export const saveAiEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      providerKey: string;
      model?: string | undefined;
      enabled?: boolean | undefined;
      paidAuthorizationPhrase?: string | undefined;
    }) => {
      const providerKey = input?.providerKey;
      if (typeof providerKey !== "string" || !providerKey.trim())
        throw new Error("Selecciona un motor.");
      return {
        providerKey: providerKey.trim() as AiEngineKey,
        model: typeof input?.model === "string" ? input.model.trim().slice(0, 120) : undefined,
        enabled: Boolean(input?.enabled),
        paidAuthorizationPhrase:
          typeof input?.paidAuthorizationPhrase === "string"
            ? input.paidAuthorizationPhrase
            : undefined,
      };
    },
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const result = await invokeGateway<{ ok: boolean }>(context.supabase as Db, "save-engine", data);
    return result.ok ? result.data : { ok: false, error: result.message };
  });

export const saveAiEngineRoutes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routes?: AiGatewayRoute[] }) => {
    const routes = Array.isArray(input?.routes) ? input.routes : [];
    return {
      routes: routes.map((route) => ({
        functionKey: route.function_key,
        providerKey: route.provider_key,
        model: String(route.model ?? "").slice(0, 120),
        priority: Number(route.priority),
        enabled: Boolean(route.enabled),
      })),
    };
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const result = await invokeGateway<{ ok: boolean }>(context.supabase as Db, "save-routes", data);
    return result.ok ? result.data : { ok: false, error: result.message };
  });

export const runAiEngineText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prompt: string; messages?: GatewayMessage[] }) => {
    const prompt = typeof input?.prompt === "string" ? input.prompt.trim().slice(0, 8000) : "";
    if (!prompt) throw new Error("Escribe un mensaje.");
    const messages = Array.isArray(input?.messages)
      ? input.messages.slice(-20).map((message) => ({
          role:
            message?.role === "assistant"
              ? ("assistant" as const)
              : message?.role === "system"
                ? ("system" as const)
                : ("user" as const),
          content: typeof message?.content === "string" ? message.content.slice(0, 8000) : "",
        }))
      : [];
    return { functionKey: "text" as const, prompt, messages };
  })
  .handler(async ({ data, context }): Promise<AiEngineGenerateResult | null> =>
    generateWithGateway(context.supabase as Db, data),
  );

export const runAiEngineImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prompt: string; width?: number; height?: number; seed?: number }) => {
    const prompt = typeof input?.prompt === "string" ? input.prompt.trim().slice(0, 8000) : "";
    if (!prompt) throw new Error("Describe la imagen.");
    return {
      functionKey: "image" as const,
      prompt,
      width: Number(input?.width) || undefined,
      height: Number(input?.height) || undefined,
      seed: Number.isInteger(Number(input?.seed)) ? Number(input.seed) : undefined,
    };
  })
  .handler(async ({ data, context }): Promise<AiEngineGenerateResult | null> =>
    generateWithGateway(context.supabase as Db, data),
  );

export const transcribeWithAiEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { audioBase64: string; mimeType?: string }) => {
    const audioBase64 = typeof input?.audioBase64 === "string" ? input.audioBase64 : "";
    if (!audioBase64) throw new Error("Falta el audio.");
    return {
      functionKey: "transcription" as const,
      audioBase64,
      mimeType: typeof input?.mimeType === "string" ? input.mimeType.slice(0, 100) : "audio/webm",
    };
  })
  .handler(async ({ data, context }): Promise<AiEngineGenerateResult | null> =>
    generateWithGateway(context.supabase as Db, data),
  );
