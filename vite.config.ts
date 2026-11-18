import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv, type RunnableDevEnvironment } from "vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import { NodeRequest, sendNodeResponse } from "srvx/node";

export default defineConfig((env) => {
  const isCapacitorBuild = process.env["CAPACITOR_BUILD"] === "1";
  const isVercelBuild =
    process.env["VERCEL"] === "1" ||
    process.env["VERCEL_ENV"] !== undefined ||
    process.env["NITRO_PRESET"] === "vercel";
  const nitroPreset = isVercelBuild ? "vercel" : "cloudflare-module";
  const publicEnv = loadEnv(env.mode, process.cwd(), ["VITE_", "NEXT_PUBLIC_"]);
  const serverEnv = loadEnv(env.mode, process.cwd(), [
    "VITE_",
    "NEXT_PUBLIC_",
    "SUPABASE_",
    "HF_",
    "FAL_",
    "GEMINI_",
    "OPENAI_",
    "PAYPAL_",
  ]);
  for (const [key, value] of Object.entries(serverEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const define = Object.fromEntries(
    Object.entries(publicEnv).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value),
    ]),
  );

  return {
    define,
    ...(isCapacitorBuild ? { build: { outDir: "dist" } } : {}),
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": path.resolve(process.cwd(), "src") },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    server: { host: "::", port: 8080 },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        ...(isCapacitorBuild
          ? {
              spa: {
                enabled: true,
                prerender: {
                  outputPath: "index.html",
                  crawlLinks: false,
                  retryCount: 0,
                },
              },
            }
          : {}),
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
        server: { entry: "server" },
      }),
      ...(env.command === "build" && !isCapacitorBuild
        ? [nitro({ defaultPreset: nitroPreset, preset: nitroPreset })]
        : []),
      viteReact(),
      {
        name: "tanstack-start-dev-ssr-fallback",
        configureServer(viteDevServer) {
          return () => {
            const serverEnv = viteDevServer.environments.ssr as RunnableDevEnvironment;
            viteDevServer.middlewares.use(async (req, res) => {
              const originalUrl = (req as { originalUrl?: string }).originalUrl;
              if (originalUrl) req.url = originalUrl;
              const webReq = new NodeRequest({ req, res });
              try {
                const entry = await serverEnv.runner.import("virtual:tanstack-start-server-entry");
                const serverEntry = entry.default as {
                  fetch: (request: Request) => Promise<Response> | Response;
                };
                return sendNodeResponse(res, await serverEntry.fetch(webReq));
              } catch (error) {
                console.error(error);
                return sendNodeResponse(
                  res,
                  new Response("<!doctype html><title>Error</title><pre>SSR error</pre>", {
                    status: 500,
                    headers: { "content-type": "text/html; charset=utf-8" },
                  }),
                );
              }
            });
          };
        },
      },
    ],
  };
});
