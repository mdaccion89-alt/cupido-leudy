import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EngineKey =
  | "gemini"
  | "cloudflare"
  | "ollama"
  | "groq"
  | "flux"
  | "stable-diffusion";

type FunctionKey = "text" | "image" | "transcription";

type EngineDefinition = {
  key: EngineKey;
  label: string;
  vendor: string;
  description: string;
  capabilities: FunctionKey[];
  models: string[];
  defaultModel: Partial<Record<FunctionKey, string>>;
  secrets: string[];
  quota: string;
  docsUrl: string;
  notes?: string;
  billing: string;
  paidAuthorizationRequired: boolean;
  customModel?: boolean;
};

const ENGINES: EngineDefinition[] = [
  {
    key: "gemini",
    label: "Google Gemini",
    vendor: "Google",
    description: "Modelos de lenguaje para texto; sin generación de imágenes.",
    capabilities: ["text"],
    models: ["gemini-2.5-flash-lite"],
    defaultModel: { text: "gemini-2.5-flash-lite" },
    secrets: ["GEMINI_API_KEY"],
    quota: "Free tier: entrada y salida de texto sin costo dentro de los límites del plan.",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite",
    billing: "free-tier",
    paidAuthorizationRequired: false,
  },
  {
    key: "cloudflare",
    label: "Cloudflare Workers AI",
    vendor: "Cloudflare",
    description: "Inferencia administrada en la red de Cloudflare con Neurons diarios gratuitos.",
    capabilities: ["text"],
    models: ["@cf/meta/llama-3.1-8b-instruct"],
    defaultModel: { text: "@cf/meta/llama-3.1-8b-instruct" },
    secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    quota: "10,000 Neurons/día gratis; excedente $0.011 por 1,000 Neurons.",
    docsUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    notes: "El token debe tener permisos de Workers AI Read/Edit.",
    billing: "free-tier-with-overage",
    paidAuthorizationRequired: true,
  },
  {
    key: "ollama",
    label: "Ollama",
    vendor: "Self-hosted",
    description: "Modelos locales expuestos por tu propio servidor Ollama.",
    capabilities: ["text"],
    models: ["llama3.2", "qwen2.5"],
    defaultModel: { text: "llama3.2" },
    secrets: ["OLLAMA_BASE_URL"],
    quota: "Sin costo de proveedor; depende de tu propio hardware y ancho de banda.",
    docsUrl: "https://docs.ollama.com/api/chat",
    notes: "OLLAMA_BASE_URL debe ser público o alcanzable desde Supabase Edge Functions.",
    billing: "self-hosted",
    paidAuthorizationRequired: false,
    customModel: true,
  },
  {
    key: "groq",
    label: "Groq",
    vendor: "Groq",
    description: "Inferencia de texto y transcripción de audio en su API compatible con OpenAI.",
    capabilities: ["text", "transcription"],
    models: ["openai/gpt-oss-20b", "whisper-large-v3-turbo"],
    defaultModel: { text: "openai/gpt-oss-20b", transcription: "whisper-large-v3-turbo" },
    secrets: ["GROQ_API_KEY"],
    quota: "Free tier con límites por organización; los tokens cacheados no consumen cuota.",
    docsUrl: "https://console.groq.com/docs/rate-limits",
    notes: "Verifica los límites exactos de tu cuenta en la consola de Groq.",
    billing: "free-tier",
    paidAuthorizationRequired: false,
  },
  {
    key: "flux",
    label: "FLUX",
    vendor: "Cloudflare Workers AI",
    description: "Generación de imágenes con FLUX.1 Schnell usando credenciales de Cloudflare.",
    capabilities: ["image"],
    models: ["@cf/black-forest-labs/flux-1-schnell"],
    defaultModel: { image: "@cf/black-forest-labs/flux-1-schnell" },
    secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    quota: "Comparte la cuota de Neurons de Cloudflare; 10,000 Neurons/día gratis.",
    docsUrl: "https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/",
    billing: "free-tier-with-overage",
    paidAuthorizationRequired: true,
  },
  {
    key: "stable-diffusion",
    label: "Stable Diffusion XL",
    vendor: "Cloudflare Workers AI",
    description: "Generación de imágenes SDXL usando credenciales de Cloudflare.",
    capabilities: ["image"],
    models: ["@cf/stabilityai/stable-diffusion-xl-base-1.0"],
    defaultModel: { image: "@cf/stabilityai/stable-diffusion-xl-base-1.0" },
    secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    quota: "Listado a $0.00 por step; sujeto a la cuota y posibles cargos de Cloudflare.",
    docsUrl: "https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-base-1.0/",
    notes: "Deprecación planificada: 20 de noviembre de 2026.",
    billing: "free-tier-with-overage",
    paidAuthorizationRequired: true,
  },
];

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function redact(text: string): string {
  let value = text;
  for (const name of [
    "GEMINI_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "OLLAMA_BASE_URL",
    "GROQ_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    const secret = env(name);
    if (secret) value = value.split(secret).join("[redactado]");
  }
  return value
    .replace(/key=[^&\s"']+/gi, "key=[redactado]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redactado]")
    .slice(0, 600);
}

function failure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Error desconocido");
  return redact(raw);
}

function getEngine(key: unknown): EngineDefinition | null {
  return typeof key === "string" ? (ENGINES.find((item) => item.key === key) ?? null) : null;
}

function getFunction(key: unknown): FunctionKey | null {
  return key === "text" || key === "image" || key === "transcription" ? key : null;
}

function normalizeModel(engine: EngineDefinition, functionKey: FunctionKey, value: unknown): string {
  const fallback = engine.defaultModel[functionKey] ?? engine.models[0] ?? "";
  if (typeof value !== "string" || !value.trim()) return fallback;
  const model = value.trim();
  if (engine.customModel && /^[a-zA-Z0-9_.:/-]{1,120}$/.test(model)) return model;
  return engine.models.includes(model) ? model : fallback;
}

function configuredMap(engine: EngineDefinition): Record<string, boolean> {
  return Object.fromEntries(engine.secrets.map((name) => [name, Boolean(env(name))]));
}

function isConfigured(engine: EngineDefinition): boolean {
  return Object.values(configuredMap(engine)).every(Boolean);
}

function publicEngine(
  engine: EngineDefinition,
  settings: Record<string, unknown> | undefined,
) {
  return {
    ...engine,
    configured: configuredMap(engine),
    allConfigured: isConfigured(engine),
    enabled: Boolean(settings?.enabled ?? false),
    model:
      typeof settings?.model === "string" && settings.model
        ? settings.model
        : engine.defaultModel.text ?? engine.models[0] ?? "",
    status: typeof settings?.status === "string" ? settings.status : "not_configured",
    statusDetail: typeof settings?.status_detail === "string" ? settings.status_detail : "",
    lastCheckedAt: typeof settings?.last_checked_at === "string" ? settings.last_checked_at : null,
    lastLatencyMs: typeof settings?.last_latency_ms === "number" ? settings.last_latency_ms : null,
    quotaSnapshot:
      settings?.quota_snapshot && typeof settings.quota_snapshot === "object"
        ? settings.quota_snapshot
        : {},
    paidAuthorizedAt:
      typeof settings?.paid_authorized_at === "string" ? settings.paid_authorized_at : null,
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const cleaned = value.includes(",") ? (value.split(",").pop() ?? "") : value;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function quotaHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (/ratelimit|quota|remaining|neuron/i.test(key)) result[key] = value.slice(0, 200);
  });
  return result;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data };
}

function textFromGemini(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function deepFindImage(value: any, depth = 0): string | null {
  if (depth > 5 || value == null) return null;
  if (typeof value === "string" && value.length > 128) return value;
  if (typeof value !== "object") return null;
  for (const key of ["image", "image_b64", "base64", "output", "result", "data", "images"]) {
    const found = deepFindImage(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function imageFromResponse(response: Response): Promise<{ base64: string; mimeType: string }> {
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0] ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (contentType.startsWith("image/") && bytes.byteLength > 0) {
    return { base64: encodeBase64(bytes), mimeType: contentType };
  }
  const text = new TextDecoder().decode(bytes);
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("El proveedor no devolvió una imagen válida.");
  }
  const image = deepFindImage(parsed);
  if (!image) throw new Error("El proveedor no devolvió una imagen válida.");
  return {
    base64: image.includes(",") ? (image.split(",").pop() ?? "") : image,
    mimeType: typeof parsed?.mimeType === "string" ? parsed.mimeType : "image/png",
  };
}

type GatewayMessage = { role: "system" | "user" | "assistant"; content: string };

function buildMessages(prompt: string, input: unknown): GatewayMessage[] {
  const fallback: GatewayMessage[] = [{ role: "user", content: prompt }];
  if (!Array.isArray(input)) return fallback;
  const messages = input
    .slice(-20)
    .map((item: any) => {
      const role = item?.role === "assistant" ? "assistant" : item?.role === "system" ? "system" : "user";
      const content = typeof item?.content === "string" ? item.content.trim().slice(0, 8000) : "";
      return { role, content } as GatewayMessage;
    })
    .filter((item: GatewayMessage) => item.content.length > 0);
  return messages.length ? messages : fallback;
}

async function callText(
  engine: EngineDefinition,
  model: string,
  messages: GatewayMessage[],
): Promise<{ text: string; quota: Record<string, string> }> {
  if (engine.key === "gemini") {
    const key = env("GEMINI_API_KEY");
    const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
    const contents = messages
      .filter((item) => item.role !== "system")
      .map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      }));
    const { response, data } = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      { "x-goog-api-key": key },
      {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      },
    );
    if (!response.ok) throw new Error(failure(JSON.stringify(data) || `Gemini ${response.status}`));
    const text = textFromGemini(data);
    if (!text) throw new Error("Gemini no devolvió texto.");
    return { text, quota: quotaHeaders(response.headers) };
  }

  if (engine.key === "cloudflare") {
    const token = env("CLOUDFLARE_API_TOKEN");
    const account = env("CLOUDFLARE_ACCOUNT_ID");
    const { response, data } = await postJson(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
      { Authorization: `Bearer ${token}` },
      { messages },
    );
    if (!response.ok) throw new Error(failure(JSON.stringify(data) || `Cloudflare ${response.status}`));
    const text = typeof data?.result?.response === "string" ? data.result.response.trim() : "";
    if (!text) throw new Error("Cloudflare no devolvió texto.");
    return { text, quota: quotaHeaders(response.headers) };
  }

  if (engine.key === "ollama") {
    const base = env("OLLAMA_BASE_URL").replace(/\/+$/, "");
    const { response, data } = await postJson(`${base}/api/chat`, {}, { model, messages, stream: false });
    if (!response.ok) throw new Error(failure(JSON.stringify(data) || `Ollama ${response.status}`));
    const text = typeof data?.message?.content === "string" ? data.message.content.trim() : "";
    if (!text) throw new Error("Ollama no devolvió texto.");
    return { text, quota: quotaHeaders(response.headers) };
  }

  if (engine.key === "groq") {
    const key = env("GROQ_API_KEY");
    const { response, data } = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: `Bearer ${key}` },
      { model, messages, temperature: 0.7, max_tokens: 2048 },
    );
    if (!response.ok) throw new Error(failure(JSON.stringify(data) || `Groq ${response.status}`));
    const text =
      typeof data?.choices?.[0]?.message?.content === "string"
        ? data.choices[0].message.content.trim()
        : "";
    if (!text) throw new Error("Groq no devolvió texto.");
    return { text, quota: quotaHeaders(response.headers) };
  }

  throw new Error("Motor no compatible con texto.");
}

async function callImage(
  engine: EngineDefinition,
  model: string,
  prompt: string,
  options: { width: number; height: number; seed?: number },
): Promise<{ imageBase64: string; mimeType: string; quota: Record<string, string> }> {
  const token = env("CLOUDFLARE_API_TOKEN");
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const body =
    engine.key === "flux"
      ? { prompt, ...(options.seed !== undefined ? { seed: options.seed } : {}) }
      : {
          prompt,
          num_steps: 20,
          width: options.width,
          height: options.height,
          ...(options.seed !== undefined ? { seed: options.seed } : {}),
        };
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(failure(detail || `Cloudflare ${response.status}`));
  }
  const image = await imageFromResponse(response);
  return { ...image, quota: quotaHeaders(response.headers) };
}

async function callTranscription(
  engine: EngineDefinition,
  model: string,
  audioBase64: string,
  mimeType: string,
): Promise<{ text: string; quota: Record<string, string> }> {
  if (engine.key !== "groq") throw new Error("Motor no compatible con transcripción.");
  const key = env("GROQ_API_KEY");
  const bytes = decodeBase64(audioBase64);
  const form = new FormData();
  const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") ? "mp3" : "webm";
  form.append("file", new Blob([bytes], { type: mimeType }), `audio.${extension}`);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(failure(detail || `Groq ${response.status}`));
  }
  const data = await response.json().catch(() => ({}));
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) throw new Error("Groq no devolvió transcripción.");
  return { text, quota: quotaHeaders(response.headers) };
}

async function probe(engine: EngineDefinition, model: string) {
  if (engine.key === "gemini") {
    const key = env("GEMINI_API_KEY");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${encodeURIComponent(key)}`,
      { headers: { "x-goog-api-key": key } },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(failure(JSON.stringify(data) || `Gemini ${response.status}`));
    return { detail: `Modelo ${model} disponible.`, quota: quotaHeaders(response.headers) };
  }

  if (["cloudflare", "flux", "stable-diffusion"].includes(engine.key)) {
    const token = env("CLOUDFLARE_API_TOKEN");
    const account = env("CLOUDFLARE_ACCOUNT_ID");
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/models/search?search=${encodeURIComponent(model)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(failure(JSON.stringify(data?.errors ?? data) || `Cloudflare ${response.status}`));
    }
    const count = Array.isArray(data?.result) ? data.result.length : 0;
    return {
      detail: count ? `Modelo ${model} disponible en Cloudflare.` : "Conexión válida; el buscador no listó el modelo.",
      quota: quotaHeaders(response.headers),
    };
  }

  if (engine.key === "ollama") {
    const base = env("OLLAMA_BASE_URL").replace(/\/+$/, "");
    const response = await fetch(`${base}/api/tags`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(failure(JSON.stringify(data) || `Ollama ${response.status}`));
    const models = Array.isArray(data?.models) ? data.models : [];
    const found = models.some((item: any) => String(item?.name ?? "").startsWith(model));
    return {
      detail: found
        ? `Modelo ${model} instalado.`
        : `Ollama reachable; instala el modelo con: ollama pull ${model}`,
      quota: quotaHeaders(response.headers),
    };
  }

  if (engine.key === "groq") {
    const key = env("GROQ_API_KEY");
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(failure(JSON.stringify(data) || `Groq ${response.status}`));
    const count = Array.isArray(data?.data) ? data.data.length : 0;
    return {
      detail: `Conexión válida; ${count} modelos disponibles.`,
      quota: quotaHeaders(response.headers),
    };
  }

  throw new Error("Motor no reconocido.");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Cuerpo JSON inválido." }, 400);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Se requiere autenticación." }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Sesión inválida." }, 401);
  const user = authData.user;

  const db = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : userClient;

  async function requireAdmin(): Promise<Response | null> {
    const { data } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!data) return json({ error: "Acceso de administrador requerido." }, 403);
    return null;
  }

  async function logAttempt(entry: {
    functionKey: string;
    providerKey: string;
    model: string;
    status: string;
    error?: string;
    latencyMs: number;
  }) {
    await db.from("ai_engine_logs").insert({
      user_id: user.id,
      function_key: entry.functionKey,
      provider_key: entry.providerKey,
      model: entry.model,
      status: entry.status,
      error: entry.error ? redact(entry.error).slice(0, 500) : null,
      latency_ms: entry.latencyMs,
    });
  }

  try {
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "status") {
      const denied = await requireAdmin();
      if (denied) return denied;
      const [settingsResult, routesResult, logsResult] = await Promise.all([
        db.from("ai_engine_settings").select("*"),
        db.from("ai_engine_routes").select("*").order("priority", { ascending: true }),
        db
          .from("ai_engine_logs")
          .select("id,user_id,function_key,provider_key,model,status,error,latency_ms,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (settingsResult.error) return json({ error: failure(settingsResult.error) }, 500);
      if (routesResult.error) return json({ error: failure(routesResult.error) }, 500);
      if (logsResult.error) return json({ error: failure(logsResult.error) }, 500);
      const settings = new Map(
        (settingsResult.data ?? []).map((row: any) => [String(row.provider_key), row]),
      );
      return json({
        engines: ENGINES.map((engine) => publicEngine(engine, settings.get(engine.key))),
        routes: routesResult.data ?? [],
        logs: logsResult.data ?? [],
        gateway: {
          serviceRoleConfigured: Boolean(supabaseServiceKey),
          secretsConfigured: {
            GEMINI_API_KEY: Boolean(env("GEMINI_API_KEY")),
            CLOUDFLARE_API_TOKEN: Boolean(env("CLOUDFLARE_API_TOKEN")),
            CLOUDFLARE_ACCOUNT_ID: Boolean(env("CLOUDFLARE_ACCOUNT_ID")),
            OLLAMA_BASE_URL: Boolean(env("OLLAMA_BASE_URL")),
            GROQ_API_KEY: Boolean(env("GROQ_API_KEY")),
          },
        },
      });
    }

    if (action === "test") {
      const denied = await requireAdmin();
      if (denied) return denied;
      const engine = getEngine(body?.providerKey);
      if (!engine) return json({ error: "Motor no válido." }, 400);
      const settingsResult = await db
        .from("ai_engine_settings")
        .select("*")
        .eq("provider_key", engine.key)
        .maybeSingle();
      const model = normalizeModel(engine, engine.capabilities[0] ?? "text", body?.model ?? settingsResult.data?.model);
      const started = performance.now();
      try {
        if (!isConfigured(engine)) {
          throw new Error(`Faltan secretos: ${engine.secrets.filter((name) => !env(name)).join(", ")}`);
        }
        const result = await probe(engine, model);
        const latencyMs = Math.max(1, Math.round(performance.now() - started));
        await db.from("ai_engine_settings").upsert({
          provider_key: engine.key,
          enabled: Boolean(settingsResult.data?.enabled ?? false),
          model,
          status: "ok",
          status_detail: result.detail,
          last_checked_at: new Date().toISOString(),
          last_latency_ms: latencyMs,
          quota_snapshot: result.quota,
          paid_authorized_at: settingsResult.data?.paid_authorized_at ?? null,
          paid_authorized_by: settingsResult.data?.paid_authorized_by ?? null,
          updated_at: new Date().toISOString(),
        });
        await logAttempt({
          functionKey: "test",
          providerKey: engine.key,
          model,
          status: "success",
          latencyMs,
        });
        return json({ ok: true, ...result, latencyMs });
      } catch (error) {
        const message = failure(error);
        const latencyMs = Math.max(1, Math.round(performance.now() - started));
        await db.from("ai_engine_settings").upsert({
          provider_key: engine.key,
          enabled: false,
          model,
          status: "error",
          status_detail: message,
          last_checked_at: new Date().toISOString(),
          last_latency_ms: latencyMs,
          quota_snapshot: {},
          paid_authorized_at: settingsResult.data?.paid_authorized_at ?? null,
          paid_authorized_by: settingsResult.data?.paid_authorized_by ?? null,
          updated_at: new Date().toISOString(),
        });
        await logAttempt({
          functionKey: "test",
          providerKey: engine.key,
          model,
          status: "error",
          error: message,
          latencyMs,
        });
        return json({ ok: false, error: message, latencyMs }, 502);
      }
    }

    if (action === "save-engine") {
      const denied = await requireAdmin();
      if (denied) return denied;
      const engine = getEngine(body?.providerKey);
      if (!engine) return json({ error: "Motor no válido." }, 400);
      const functionKey = engine.capabilities[0] ?? "text";
      const model = normalizeModel(engine, functionKey, body?.model);
      const enabled = Boolean(body?.enabled);
      const existingResult = await db
        .from("ai_engine_settings")
        .select("*")
        .eq("provider_key", engine.key)
        .maybeSingle();
      const existing = existingResult.data as any;
      let paidAuthorizedAt = typeof existing?.paid_authorized_at === "string" ? existing.paid_authorized_at : null;

      if (enabled) {
        if (!isConfigured(engine)) {
          return json({ error: `Configura los secretos antes de activar: ${engine.secrets.join(", ")}` }, 400);
        }
        const tested =
          existing?.status === "ok" && existing?.model === model && Boolean(existing?.last_checked_at);
        if (!tested) {
          return json({ error: "Ejecuta una prueba de conexión con el modelo seleccionado antes de activarlo." }, 400);
        }
        if (engine.paidAuthorizationRequired && !paidAuthorizedAt) {
          if (body?.paidAuthorizationPhrase !== "AUTORIZO COBROS") {
            return json({ error: "Debes escribir AUTORIZO COBROS para activar un motor con posible facturación." }, 400);
          }
          paidAuthorizedAt = new Date().toISOString();
        }
      }

      const { error: saveError } = await db.from("ai_engine_settings").upsert({
        provider_key: engine.key,
        enabled,
        model,
        status: typeof existing?.status === "string" ? existing.status : "not_configured",
        status_detail: typeof existing?.status_detail === "string" ? existing.status_detail : "",
        last_checked_at: typeof existing?.last_checked_at === "string" ? existing.last_checked_at : null,
        last_latency_ms: typeof existing?.last_latency_ms === "number" ? existing.last_latency_ms : null,
        quota_snapshot: existing?.quota_snapshot ?? {},
        paid_authorized_at: paidAuthorizedAt,
        paid_authorized_by: paidAuthorizedAt ? user.id : (existing?.paid_authorized_by ?? null),
        updated_at: new Date().toISOString(),
      });
      if (saveError) return json({ error: failure(saveError) }, 500);
      await logAttempt({
        functionKey: "settings",
        providerKey: engine.key,
        model,
        status: enabled ? "enabled" : "disabled",
        latencyMs: 0,
      });
      return json({ ok: true });
    }

    if (action === "save-routes") {
      const denied = await requireAdmin();
      if (denied) return denied;
      const rows = Array.isArray(body?.routes) ? body.routes : [];
      if (rows.length > 20) return json({ error: "Demasiadas rutas." }, 400);
      const normalized: Array<Record<string, unknown>> = [];
      for (const [index, row] of rows.entries()) {
        const functionKey = getFunction(row?.functionKey);
        const engine = getEngine(row?.providerKey);
        if (!functionKey || !engine || !engine.capabilities.includes(functionKey)) {
          return json({ error: `Ruta ${index + 1} no válida.` }, 400);
        }
        const priority = Number(row?.priority);
        if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
          return json({ error: `Prioridad de ruta ${index + 1} no válida.` }, 400);
        }
        normalized.push({
          function_key: functionKey,
          provider_key: engine.key,
          model: normalizeModel(engine, functionKey, row?.model),
          priority,
          enabled: Boolean(row?.enabled),
          updated_at: new Date().toISOString(),
        });
      }
      const cleared = await db.from("ai_engine_routes").delete().neq("function_key", "");
      if (cleared.error) return json({ error: failure(cleared.error) }, 500);
      if (normalized.length) {
        const inserted = await db.from("ai_engine_routes").insert(normalized);
        if (inserted.error) return json({ error: failure(inserted.error) }, 500);
      }
      return json({ ok: true });
    }

    if (action === "generate") {
      const functionKey = getFunction(body?.functionKey);
      if (!functionKey) return json({ error: "Función no válida." }, 400);
      const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 8000) : "";
      if (!prompt && functionKey !== "transcription") {
        return json({ error: "Escribe un prompt." }, 400);
      }
      const messages = buildMessages(prompt, body?.messages);
      const [routesResult, settingsResult] = await Promise.all([
        db
          .from("ai_engine_routes")
          .select("*")
          .eq("function_key", functionKey)
          .eq("enabled", true)
          .order("priority", { ascending: true }),
        db.from("ai_engine_settings").select("*"),
      ]);
      if (routesResult.error || settingsResult.error) {
        return json({ error: failure(routesResult.error ?? settingsResult.error) }, 500);
      }
      const settings = new Map(
        (settingsResult.data ?? []).map((row: any) => [String(row.provider_key), row]),
      );
      const errors: string[] = [];

      for (const route of routesResult.data ?? []) {
        const engine = getEngine(route.provider_key);
        const setting: any = settings.get(String(route.provider_key));
        if (!engine || !engine.capabilities.includes(functionKey)) continue;
        if (!setting?.enabled || setting?.status !== "ok" || !isConfigured(engine)) continue;
        const model = normalizeModel(engine, functionKey, route.model ?? setting.model);
        const started = performance.now();
        try {
          let result:
            | { text: string; quota: Record<string, string> }
            | { imageBase64: string; mimeType: string; quota: Record<string, string> }
            | null = null;
          if (functionKey === "text") result = await callText(engine, model, messages);
          if (functionKey === "image") {
            const width = Number(body?.width) === 768 ? 768 : 1024;
            const height = Number(body?.height) === 1344 ? 1344 : Number(body?.width) === 768 ? 1344 : 1024;
            const seed = Number.isInteger(Number(body?.seed)) ? Number(body.seed) : undefined;
            result = await callImage(engine, model, prompt, { width, height, seed });
          }
          if (functionKey === "transcription") {
            const audioBase64 = typeof body?.audioBase64 === "string" ? body.audioBase64 : "";
            if (audioBase64.length > 20_000_000) throw new Error("El audio es demasiado grande.");
            if (!audioBase64) throw new Error("Falta el audio.");
            const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "audio/webm";
            result = await callTranscription(engine, model, audioBase64, mimeType);
          }
          if (!result) throw new Error("El motor no produjo un resultado.");
          const latencyMs = Math.max(1, Math.round(performance.now() - started));
          await logAttempt({
            functionKey,
            providerKey: engine.key,
            model,
            status: "success",
            latencyMs,
          });
          await db.from("ai_engine_settings").update({
            quota_snapshot: result.quota,
            last_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("provider_key", engine.key);
          return json({
            ok: true,
            providerKey: engine.key,
            providerLabel: engine.label,
            model,
            ...("text" in result ? { text: result.text } : {}),
            ...("imageBase64" in result
              ? { imageBase64: result.imageBase64, mimeType: result.mimeType }
              : {}),
          });
        } catch (error) {
          const message = failure(error);
          errors.push(`${engine.label}: ${message}`);
          await logAttempt({
            functionKey,
            providerKey: engine.key,
            model,
            status: "error",
            error: message,
            latencyMs: Math.max(1, Math.round(performance.now() - started)),
          });
        }
      }

      return json(
        {
          ok: false,
          error: errors.length
            ? `Ningún motor activo pudo completar la solicitud. ${errors.join(" | ")}`
            : "No hay motores activos y probados para esta función.",
        },
        502,
      );
    }

    return json({ error: "Acción no reconocida." }, 400);
  } catch (error) {
    return json({ error: failure(error) }, 500);
  }
});
