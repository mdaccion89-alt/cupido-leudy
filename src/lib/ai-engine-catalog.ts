export const AI_ENGINE_KEYS = [
  "gemini",
  "cloudflare",
  "ollama",
  "groq",
  "flux",
  "stable-diffusion",
] as const;

export const AI_FUNCTION_KEYS = ["text", "image", "transcription"] as const;

export type AiEngineKey = (typeof AI_ENGINE_KEYS)[number];
export type AiFunctionKey = (typeof AI_FUNCTION_KEYS)[number];
export type AiEngineBilling = "free-tier" | "self-hosted" | "free-tier-with-overage";

export type AiEngineDefinition = {
  key: AiEngineKey;
  label: string;
  vendor: string;
  description: string;
  capabilities: readonly AiFunctionKey[];
  models: readonly string[];
  defaultModel: Partial<Record<AiFunctionKey, string>>;
  secrets: readonly string[];
  quota: string;
  docsUrl: string;
  notes?: string;
  billing: AiEngineBilling;
  paidAuthorizationRequired: boolean;
  customModel?: boolean;
};

export const AI_ENGINES: readonly AiEngineDefinition[] = [
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
    defaultModel: {
      text: "openai/gpt-oss-20b",
      transcription: "whisper-large-v3-turbo",
    },
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

export type AiEngineRouteDefinition = {
  functionKey: AiFunctionKey;
  providerKey: AiEngineKey;
  model: string;
  priority: number;
  enabled: boolean;
};

export const DEFAULT_AI_ROUTES: readonly AiEngineRouteDefinition[] = [
  {
    functionKey: "text",
    providerKey: "gemini",
    model: "gemini-2.5-flash-lite",
    priority: 1,
    enabled: true,
  },
  {
    functionKey: "text",
    providerKey: "cloudflare",
    model: "@cf/meta/llama-3.1-8b-instruct",
    priority: 2,
    enabled: true,
  },
  {
    functionKey: "text",
    providerKey: "groq",
    model: "openai/gpt-oss-20b",
    priority: 3,
    enabled: true,
  },
  {
    functionKey: "text",
    providerKey: "ollama",
    model: "llama3.2",
    priority: 4,
    enabled: true,
  },
  {
    functionKey: "image",
    providerKey: "flux",
    model: "@cf/black-forest-labs/flux-1-schnell",
    priority: 1,
    enabled: true,
  },
  {
    functionKey: "image",
    providerKey: "stable-diffusion",
    model: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    priority: 2,
    enabled: true,
  },
  {
    functionKey: "transcription",
    providerKey: "groq",
    model: "whisper-large-v3-turbo",
    priority: 1,
    enabled: true,
  },
];

export function isAiEngineKey(value: unknown): value is AiEngineKey {
  return typeof value === "string" && (AI_ENGINE_KEYS as readonly string[]).includes(value);
}

export function isAiFunctionKey(value: unknown): value is AiFunctionKey {
  return typeof value === "string" && (AI_FUNCTION_KEYS as readonly string[]).includes(value);
}

export function getAiEngine(key: AiEngineKey): AiEngineDefinition {
  const engine = AI_ENGINES.find((item) => item.key === key);
  if (!engine) throw new Error(`Motor IA desconocido: ${key}`);
  return engine;
}

export function supportsFunction(key: AiEngineKey, functionKey: AiFunctionKey): boolean {
  return getAiEngine(key).capabilities.includes(functionKey);
}

export function defaultModelFor(key: AiEngineKey, functionKey: AiFunctionKey): string {
  return getAiEngine(key).defaultModel[functionKey] ?? getAiEngine(key).models[0] ?? "";
}

export function normalizeEngineModel(
  key: AiEngineKey,
  functionKey: AiFunctionKey,
  value: unknown,
): string {
  const engine = getAiEngine(key);
  const fallback = defaultModelFor(key, functionKey);
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  if (!model) return fallback;
  if (
    engine.customModel &&
    /^[a-zA-Z0-9_.:/-]{1,120}$/.test(model) &&
    !model.split("/").some((part) => part === "." || part === "..")
  )
    return model;
  return engine.models.includes(model) ? model : fallback;
}

export function enginesForFunction(functionKey: AiFunctionKey): readonly AiEngineDefinition[] {
  return AI_ENGINES.filter((engine) => engine.capabilities.includes(functionKey));
}

export function routesForFunction(functionKey: AiFunctionKey): readonly AiEngineRouteDefinition[] {
  return DEFAULT_AI_ROUTES.filter((route) => route.functionKey === functionKey).sort(
    (left, right) => left.priority - right.priority,
  );
}
