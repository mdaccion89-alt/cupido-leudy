import { getSupabaseAuthHeaders } from "@/integrations/supabase/client";

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const authHeaders = await getSupabaseAuthHeaders();
  for (const [name, value] of Object.entries(authHeaders)) headers.set(name, value);
  return fetch(path, { ...init, headers, cache: "no-store" });
}

export async function apiJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await apiFetch(path, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}
