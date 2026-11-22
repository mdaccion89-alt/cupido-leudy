import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const PAYPAL_BACKEND_ORIGIN = "https://leudyia.onrender.com";
const CAPACITOR_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const TRUSTED_SERVER_ORIGINS = new Set([PAYPAL_BACKEND_ORIGIN, ...CAPACITOR_ORIGINS]);

const serverFunctionFetch: typeof fetch = (input, init) => {
  const request = new Request(input, init);
  const requestUrl = new URL(request.url);
  if (!CAPACITOR_ORIGINS.has(requestUrl.origin)) return fetch(request);
  if (requestUrl.pathname !== "/_serverFn" && !requestUrl.pathname.startsWith("/_serverFn/")) {
    return fetch(request);
  }

  const backendUrl = new URL(requestUrl.pathname + requestUrl.search, PAYPAL_BACKEND_ORIGIN);
  return fetch(new Request(backendUrl, request));
};

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: (origin) => TRUSTED_SERVER_ORIGINS.has(origin),
  secFetchSite: (site, ctx) => site === "same-origin"
    || (site === "cross-site" && CAPACITOR_ORIGINS.has(ctx.request.headers.get("origin") ?? "")),
});

// requestMiddleware runs on every request; functionMiddleware only on server functions, where
// client sendContext is unvalidated input. Append to these arrays, never replace them.
// functionMiddleware includes [attachSupabaseAuth], the bearer token that requireSupabaseAuth
// server functions need. Add it by hand only if Supabase is connected, no middleware here sets
// Authorization, and the project did not intentionally replace it.
export const startInstance = createStart(() => ({
  serverFns: { fetch: serverFunctionFetch },
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
