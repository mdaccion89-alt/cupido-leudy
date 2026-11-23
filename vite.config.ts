import path from "node:path";
import { execSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, loadEnv } from "vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig((env) => {
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
  let buildHash = publicEnv["VITE_BUILD_HASH"]?.trim() || process.env["VITE_BUILD_HASH"]?.trim() || "";
  if (!buildHash) {
    try {
      buildHash = execSync("git rev-parse --short=8 HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      buildHash = "local";
    }
  }
  define["import.meta.env.VITE_APP_VERSION"] = JSON.stringify(publicEnv["VITE_APP_VERSION"]?.trim() || "2.6");
  define["import.meta.env.VITE_BUILD_HASH"] = JSON.stringify(buildHash);

  return {
    define,
    build: { outDir: "dist", emptyOutDir: true },
    environments: {
      client: { build: { outDir: "dist" } },
      ssr: { build: { outDir: ".tanstack/server" } },
    },
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
        spa: {
          enabled: true,
          prerender: {
            outputPath: "index.html",
            crawlLinks: false,
            retryCount: 0,
          },
        },
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
        server: { entry: "server" },
      }),
      viteReact(),
    ],
  };
});
