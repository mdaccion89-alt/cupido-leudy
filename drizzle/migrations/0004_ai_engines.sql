CREATE TABLE IF NOT EXISTS public.ai_engine_settings (
  provider_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'ok', 'error')),
  status_detail TEXT NOT NULL DEFAULT '',
  last_checked_at TIMESTAMPTZ,
  last_latency_ms INTEGER,
  quota_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  paid_authorized_at TIMESTAMPTZ,
  paid_authorized_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_engine_routes (
  function_key TEXT NOT NULL CHECK (function_key IN ('text', 'image', 'transcription')),
  provider_key TEXT NOT NULL REFERENCES public.ai_engine_settings (provider_key) ON DELETE CASCADE,
  model TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 100),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (function_key, provider_key)
);

CREATE TABLE IF NOT EXISTS public.ai_engine_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  function_key TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_engine_logs_created_idx ON public.ai_engine_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_engine_routes_priority_idx ON public.ai_engine_routes (function_key, enabled, priority);

ALTER TABLE public.ai_engine_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_engine_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_engine_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated reads AI engine settings" ON public.ai_engine_settings;
CREATE POLICY "Authenticated reads AI engine settings" ON public.ai_engine_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage AI engine settings" ON public.ai_engine_settings;
CREATE POLICY "Admins manage AI engine settings" ON public.ai_engine_settings
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated reads AI engine routes" ON public.ai_engine_routes;
CREATE POLICY "Authenticated reads AI engine routes" ON public.ai_engine_routes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage AI engine routes" ON public.ai_engine_routes;
CREATE POLICY "Admins manage AI engine routes" ON public.ai_engine_routes
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users read own AI engine logs" ON public.ai_engine_logs;
CREATE POLICY "Users read own AI engine logs" ON public.ai_engine_logs
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all AI engine logs" ON public.ai_engine_logs;
CREATE POLICY "Admins read all AI engine logs" ON public.ai_engine_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins insert AI engine logs" ON public.ai_engine_logs;
CREATE POLICY "Admins insert AI engine logs" ON public.ai_engine_logs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.ai_engine_settings TO authenticated;
GRANT SELECT ON public.ai_engine_routes TO authenticated;
GRANT SELECT ON public.ai_engine_logs TO authenticated;
GRANT ALL ON public.ai_engine_settings TO service_role;
GRANT ALL ON public.ai_engine_routes TO service_role;
GRANT ALL ON public.ai_engine_logs TO service_role;

INSERT INTO public.ai_engine_settings (provider_key, model) VALUES
  ('gemini', 'gemini-2.5-flash-lite'),
  ('cloudflare', '@cf/meta/llama-3.1-8b-instruct'),
  ('ollama', 'llama3.2'),
  ('groq', 'openai/gpt-oss-20b'),
  ('flux', '@cf/black-forest-labs/flux-1-schnell'),
  ('stable-diffusion', '@cf/stabilityai/stable-diffusion-xl-base-1.0')
ON CONFLICT (provider_key) DO NOTHING;

INSERT INTO public.ai_engine_routes (function_key, provider_key, model, priority, enabled) VALUES
  ('text', 'gemini', 'gemini-2.5-flash-lite', 1, true),
  ('text', 'cloudflare', '@cf/meta/llama-3.1-8b-instruct', 2, true),
  ('text', 'groq', 'openai/gpt-oss-20b', 3, true),
  ('text', 'ollama', 'llama3.2', 4, true),
  ('image', 'flux', '@cf/black-forest-labs/flux-1-schnell', 1, true),
  ('image', 'stable-diffusion', '@cf/stabilityai/stable-diffusion-xl-base-1.0', 2, true),
  ('transcription', 'groq', 'whisper-large-v3-turbo', 1, true)
ON CONFLICT (function_key, provider_key) DO NOTHING;
