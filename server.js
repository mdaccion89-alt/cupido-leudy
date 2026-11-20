import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import { fromJSON, toJSON } from "seroval";
import {
  defaultSerovalDeserializerPlugins,
  defaultSerovalPlugins,
} from "@tanstack/router-core/ssr/client";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const distDir = resolve(rootDir, "dist");
const indexFile = resolve(distDir, "index.html");
const serverBundle = resolve(rootDir, ".tanstack/server/server.js");
const port = Number(process.env.PORT) || 8080;

function loadEnvFile() {
  const envFile = resolve(rootDir, ".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

const apiFunctions = {
  "generate-song": "7a6372a056aedba79aadf5c18f3ca11e5eff29570a9ab0fd1d2fab952f71fff5",
  "write-lyrics": "f913e700425a884fcdb55524ac70b37d085109b60ddf74ffcd6f018217d492cd",
  "improve-prompt": "79817a23888130a2a72320be4d9466024be5b9fad293cbdf4c2d65e5afc82749",
  "generate-firefly-image": "9d4b77bb2d5f6149ad7538aa423cac089f90e86fed6d4800ce05735c415f5228",
  "begin-firefly-video": "72cc4e1fe5470859338cd4c00f1a5773b7725eefbec0c60ad9b8f8cddca23f82",
  "generate-firefly-video": "03e676c3d96aa436d6a4ca990bce585fe2bcb3a6825ec370d8dac1500bc78d7f",
  "generate-firefly-video-scene": "47657fdb3c4d446356d61add91430dc61ed62ac60e1d468c3c315a280bf83d19",
  "finish-firefly-video": "044b185b45f68ab1b38737a5a3a38306f8ead572e8d6ea63178d3aa879beab07",
  "generate-firefly-voice": "33d2893bd5cc0a169e96bd4f154d68ce5650101bba94e06291433a2c36f08350",
  "capture-video-frame": "a326a87f0f00bc4a705126b673e5628bdcdc5e524d74dcc912dfbcdb7afc4bd4",
  "cleanup-expired-media": "100a9f7be66a767b07ab2651b7d54fce6d8d29b81355a2dc0637f229b0b8d2b4",
  "assistant-chat": "a5ac6843a620b44f32afc488dbcbfcac450c102009ed11039f38fb0f8bf48e1f",
  "create-support-ticket": "4617b4d320081fa45c87b4e347b998f3514e5b283e430655d23e68c283f0b24e",
  "report-assistant-issue": "0e5035d796f467e2a3c60a433c7a4d9c7bbef38932868dc75969e37de78d20bd",
  "start-cover": "fe69d7be3f80b679ecd180cfa17dfc950875ab79e7c61ac36392272186b95ceb",
  "start-video": "b5b037de05cc9c45b2f7791e7e589ab5e378d0f98433197021d0f156fe3e926c",
  "start-stem-separation": "8efaec6cca10464595e1f8273399d5da421d9247339788a47f1181c626a5e2be",
  "start-vocal-for-instrumental": "5d847a75a6847d5b2ddacfe5be52e791ae616835e401e68e3e4f4a39dc249592",
  "start-instrumental-for-vocal": "c20c7d81b969bdd55e183ce7f8a5e36d16bf6d171823951b3977bfd5db57e3c9",
  "check-job": "40982634c82d0886c1c8af7ebacff0d175abb3aafb5fff6ec23910ae35ee0b51",
  "get-stem-manifest": "df56dfbc85d4904e35a6beedf0e0ab41775f485bf909da8947ece6c8976a27bc",
  "list-gallery": "05b58622dca9b9a4caf48728c381357b77735a5070c4985f46afee9ab2e85480",
  "delete-song": "be3801d54419a367c766c01464f57fbe26b77504ac12b3187d6a8cf76f487958",
  "upload-avatar": "85904d672b16595ccf14486b875e9575189327ab531479314e5afcb24b6cd687",
  "get-site-settings": "1f29eb428b32039331f41208dd84c9e27b88dfec657e33852c2dd51d2bb4b9c8",
  "get-integration-status": "206e4b1561ad9c5ce874271c92668ba95a3121eca349835532170f4a56814858",
  "create-distribution-order": "0fc4c003f3369e797fe132bc61ab5dfbfe440af04aa298d8814260d0c5f003f8",
  "capture-distribution-order": "fa6601a5653802c6608d2b22f835da13ffd8fc6ffbf0e79bd893eae26c81a1ee",
  "get-admin-snapshot": "c392237e4ac42dc6d36cf6cc02949bfa608f3afced247b74683956cb8c692747",
  "save-admin-settings": "6819ef62a115a9fed5da9cfb07cf9da76d39c84579b91eccca9a635402a4e228",
  "save-integration-secrets": "6b38fdccd91a904a405bdf355dd0b2e79e396ddda57debb8839fb47622fc3bea",
  "save-paypal-email": "3d1c847a9fc8a1bf0b054b2072902e6b57bde2731e29e3fd651d415883b276e6",
  "upload-site-asset": "c6b905caabad67641c0e1bbc32bc91fe2d7a3fafd1a7bc46e8b6458215a34c9a",
  "admin-adjust-credits": "356779f65d2d4419739371493eceaec5e014acb7360b1ef3f8296b9410376ebf",
  "admin-set-plan": "3ad4bf98c4bde6b442650774e6e74514177572e62586eec1b62e7171681de237",
  "review-song": "ac5bc1654df0f4abcf581b2c1c6fc51b6c11167e9b8dacb440a34b8ab7c26bbe",
  "review-distribution": "f3e01f619400ba04d2523f50351a30d67240aff0a92f9f5dc32e81174f250dd7",
};

const apiAliases = {
  "generate-video-scene": apiFunctions["generate-firefly-video-scene"],
  "generate-image": apiFunctions["generate-firefly-image"],
  "generate-voice": apiFunctions["generate-firefly-voice"],
  chat: apiFunctions["assistant-chat"],
};

const hfVideoProviderId =
  process.env.HF_VIDEO_PROVIDER_ID ?? "fal-ai/wan/v2.2-5b/text-to-video";
const hfMaxWaitMs = 60 * 60_000;

let serverHandlerPromise;

async function getServerHandler() {
  if (!serverHandlerPromise) {
    serverHandlerPromise = import(pathToFileURL(serverBundle).href).then(
      (module) => module.default ?? module,
    );
  }
  return serverHandlerPromise;
}

function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = resolve(distDir, `.${decoded}`);
  if (target !== distDir && !target.startsWith(distDir + sep)) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  return target;
}

function sendFile(req, res, filePath, status = 200) {
  const extension = extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": contentTypes[extension] ?? "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  };
  res.writeHead(status, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

async function handleServerFn(req, res) {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || name.toLowerCase() === "transfer-encoding") continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else {
        headers.set(name, value);
      }
    }
    const origin = `http://${headers.get("host") ?? "localhost"}`;
    const url = new URL(req.url ?? "/", origin);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, {
      method: req.method,
      headers,
      ...(body ? { body, duplex: "half" } : {}),
    });
    const handler = await getServerHandler();
    const context = {
      waitUntil(promise) {
        Promise.resolve(promise).catch((error) => console.error(error));
      },
    };
    const response = await handler.fetch(request, process.env, context);
    res.statusCode = response.status;
    for (const [name, value] of response.headers) {
      if (name.toLowerCase() === "set-cookie") {
        res.setHeader(name, response.headers.getSetCookie?.() ?? value);
      } else {
        res.setHeader(name, value);
      }
    }
    if (req.method === "HEAD" || !response.body) {
      res.end();
      return;
    }
    for await (const chunk of response.body) {
      if (!res.write(Buffer.from(chunk))) {
        await new Promise((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "Server function failed" }));
    } else {
      res.end();
    }
  }
}

function proxyServerFn(functionId) {
  return async (req, res) => {
    try {
      const origin = req.headers.origin ?? `http://${req.headers.host ?? "localhost"}`;
      const headers = new Headers({
        origin,
        accept: "application/json",
        "x-tsr-serverFn": "true",
      });
      for (const name of [
        "authorization",
        "cookie",
        "user-agent",
        "x-forwarded-for",
        "x-forwarded-proto",
      ]) {
        const value = req.headers[name];
        if (value !== undefined) {
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
      }
      const target = new URL(`http://127.0.0.1:${port}/_serverFn/${functionId}`);
      let body;
      if (req.method === "GET") {
        if (Object.keys(req.query ?? {}).length) {
          const payload = JSON.stringify(
            await toJSON({ data: req.query }, { plugins: defaultSerovalPlugins }),
          );
          target.searchParams.set("payload", payload);
        }
      } else {
        const contentType = req.headers["content-type"] ?? "";
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (contentType.includes("application/json")) {
          let data;
          if (raw.length) {
            try {
              data = JSON.parse(raw.toString("utf8"));
            } catch {
              return res.status(400).json({ ok: false, error: "JSON inválido" });
            }
          }
          headers.set("content-type", "application/json");
          body = JSON.stringify(await toJSON({ data }, { plugins: defaultSerovalPlugins }));
        } else if (raw.length) {
          headers.set("content-type", contentType);
          body = raw;
        }
      }
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        ...(body === undefined ? {} : { body, duplex: "half" }),
      });
      const text = await upstream.text();
      let payload = text;
      try {
        payload = fromJSON(JSON.parse(text), {
          plugins: defaultSerovalDeserializerPlugins,
        });
      } catch {
        payload = text;
      }
      if (
        payload &&
        typeof payload === "object" &&
        ("result" in payload || "error" in payload)
      ) {
        const error = payload.error;
        if (error) {
          const status = Number(error.status) || 500;
          return res.status(status).json({
            ok: false,
            error: error.message ?? String(error),
          });
        }
        return res.status(200).json(payload.result);
      }
      return res.status(upstream.status).type("application/json").send(text);
    } catch (error) {
      console.error("API proxy error", error);
      return res.status(500).json({ ok: false, error: "Error interno del servidor" });
    }
  };
}

class HfError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function hfToken() {
  const combined = [process.env.HF_TOKEN, process.env.HF_TOKENS].filter(Boolean).join("\n");
  return combined
    .split(/[\n,]/)
    .map((token) => token.trim())
    .find(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsCall(url, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? null : JSON.stringify(options.body);
    const headers = {
      ...(payload
        ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
        : {}),
      ...(options.headers ?? {}),
    };
    const request = httpsRequest(
      url,
      {
        method: options.method ?? "GET",
        headers,
        timeout: options.timeout ?? hfMaxWaitMs,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 500,
            headers: response.headers,
            buffer: Buffer.concat(chunks),
            location: response.headers.location,
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("HF_TIMEOUT")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

function hfMessage(result) {
  const json = parseJson(result.buffer);
  if (json) {
    const error = json.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      return String(error.message ?? error.error ?? JSON.stringify(error));
    }
    if (typeof json.message === "string") return json.message;
  }
  return result.buffer.toString("utf8").slice(0, 500) || `HTTP ${result.status}`;
}

function hfHeaders() {
  const token = hfToken();
  if (!token) throw new HfError("HF_TOKEN no configurado.", 503);
  return { Authorization: `Bearer ${token}` };
}

async function startHfQueue(providerId, payload) {
  const result = await httpsCall(
    `https://router.huggingface.co/fal-ai/${providerId}?_subdomain=queue`,
    {
      method: "POST",
      body: payload,
      headers: hfHeaders(),
    },
  );
  if (result.status === 402) {
    throw new HfError(
      "Hugging Face requiere créditos de Inference Providers para este modelo.",
      402,
    );
  }
  if (!result.status.toString().startsWith("2")) {
    throw new HfError(`Hugging Face respondió: ${hfMessage(result)}`, result.status);
  }
  return { result, json: parseJson(result.buffer) };
}

async function pollHfQueue(json) {
  if (!json?.response_url || !json?.request_id) return null;
  const responseUrl = new URL(json.response_url);
  const base = `${responseUrl.protocol}//${responseUrl.host}${
    responseUrl.host === "router.huggingface.co" ? "/fal-ai" : ""
  }`;
  const statusUrl = `${base}${responseUrl.pathname}/status${responseUrl.search}`;
  const resultUrl = `${base}${responseUrl.pathname}${responseUrl.search}`;
  const started = Date.now();
  while (Date.now() - started < hfMaxWaitMs) {
    const statusResult = await httpsCall(statusUrl, { headers: hfHeaders() });
    if (!statusResult.status.toString().startsWith("2")) {
      throw new HfError(`No se pudo consultar la cola: ${hfMessage(statusResult)}`);
    }
    const statusJson = parseJson(statusResult.buffer);
    if (statusJson?.status === "COMPLETED") {
      const finalResult = await httpsCall(resultUrl, { headers: hfHeaders() });
      if (!finalResult.status.toString().startsWith("2")) {
        throw new HfError(`No se pudo descargar el resultado: ${hfMessage(finalResult)}`);
      }
      return finalResult;
    }
    if (statusJson?.status === "FAILED") {
      throw new HfError(`Hugging Face falló: ${statusJson.error ?? "generación rechazada"}`);
    }
    await sleep(1000);
  }
  throw new HfError("Hugging Face tardó demasiado en responder.", 504);
}

function mediaUrl(json, kind) {
  if (!json || typeof json !== "object") return undefined;
  if (kind === "audio") {
    return (
      json.audio_file?.url ??
      json.audio?.url ??
      json.output?.audio?.url ??
      json.output?.audio_file?.url ??
      json.audios?.[0]?.url
    );
  }
  return (
    json.video?.url ??
    json.output?.video?.url ??
    json.videos?.[0]?.url ??
    json.output?.videos?.[0]?.url
  );
}

async function downloadHfMedia(url) {
  let current = url;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const headers = current.includes("huggingface.co") ? hfHeaders() : {};
    const result = await httpsCall(current, { headers });
    if ([301, 302, 303, 307, 308].includes(result.status) && result.location) {
      current = new URL(result.location, current).toString();
      continue;
    }
    if (!result.status.toString().startsWith("2")) {
      throw new HfError(`No se pudo descargar el archivo: ${hfMessage(result)}`);
    }
    return {
      buffer: result.buffer,
      contentType: result.headers["content-type"] ?? "application/octet-stream",
    };
  }
  throw new HfError("Hugging Face redirigió demasiadas veces el archivo.");
}

function mediaExtension(contentType) {
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("mp4")) return "mp4";
  return "bin";
}

const MUSICGEN_SPACE = "https://patgpt4-musicgen.hf.space";

async function gradioMusic(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const sessionHash = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const response = await fetch(`${MUSICGEN_SPACE}/run/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fn_index: 1,
        data: ["small", prompt.slice(0, 512), null, 10, 250, 0, 1, 3],
        event_data: null,
        session_hash: sessionHash,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new HfError(`El Space de MusicGen respondió ${response.status}.`);
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new HfError("El Space de MusicGen devolvió una respuesta inválida.");
    }
    const first = Array.isArray(result?.data?.[0]) ? result.data[0][0] : result?.data?.[0];
    const name =
      first && typeof first === "object" && typeof first.name === "string"
        ? first.name
        : typeof first === "string"
          ? first
          : "";
    if (!name.startsWith("/tmp/gradio/") || !name.endsWith(".mp4"))
      throw new HfError("El Space de MusicGen no devolvió audio.");

    const fileResponse = await fetch(`${MUSICGEN_SPACE}/file=${name}`, {
      signal: controller.signal,
    });
    if (!fileResponse.ok) throw new HfError("No se pudo descargar el audio generado.");
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    if (!buffer.length) throw new HfError("El Space de MusicGen devolvió un archivo vacío.");
    return { buffer, contentType: "video/mp4" };
  } finally {
    clearTimeout(timeout);
  }
}

function requestInput(req) {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return {};
  try {
    return JSON.parse(req.body.toString("utf8"));
  } catch {
    throw new HfError("El cuerpo debe ser JSON válido.", 400);
  }
}

function musicPrompt(input) {
  const parts = [input.title, input.prompt, input.lyrics, input.genre]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
  const prompt = parts.join("\n");
  if (prompt.length < 3) throw new HfError("Describe la canción que quieres generar.", 400);
  return prompt;
}

function videoPrompt(input) {
  const scenes = Array.isArray(input.scenes)
    ? input.scenes.map((scene) => scene?.text).filter(Boolean).join("\n")
    : "";
  const prompt = [input.prompt, scenes].filter(Boolean).join("\n").trim();
  if (prompt.length < 3) throw new HfError("Describe el video que quieres generar.", 400);
  return prompt;
}

function handleHfGeneration(kind) {
  return async (req, res) => {
    try {
      const input = requestInput(req);
      const prompt = kind === "audio" ? musicPrompt(input) : videoPrompt(input);
      let media;
      let source = "gradio";
      if (kind === "audio") {
        media = await gradioMusic(prompt);
      } else {
        const payload = {
          prompt,
          duration: Number(input.duration) || 5,
          ...(Number.isFinite(Number(input.seed)) ? { seed: Number(input.seed) } : {}),
        };
        const started = await startHfQueue(hfVideoProviderId, payload);
        const finalResult = (await pollHfQueue(started.json)) ?? started.result;
        const finalJson = parseJson(finalResult.buffer);
        const url = mediaUrl(finalJson, "video");
        media = url
          ? await downloadHfMedia(url)
          : {
              buffer: finalResult.buffer,
              contentType: finalResult.headers["content-type"] ?? "application/octet-stream",
            };
      }
      const extension = mediaExtension(media.contentType);
      res.status(200).set({
        "Content-Type": media.contentType,
        "Content-Disposition": `inline; filename="leudy-${kind}-${Date.now()}.${extension}"`,
        "Cache-Control": "no-store",
        "X-Media-Type": media.contentType,
        ...(kind === "audio" ? { "X-Audio-Source": source } : {}),
      });
      return res.send(media.buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo generar el archivo.";
      const status = error instanceof HfError ? error.status : 502;
      console.error("HF generation error", message);
      return res.status(status).json({ ok: false, error: message });
    }
  };
}

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true, credentials: true }));
app.use("/api", express.raw({ type: "*/*", limit: "64mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    huggingFace: Boolean(process.env.HF_TOKEN ?? process.env.HF_TOKENS),
  });
});
app.all("/api/generate-music", handleHfGeneration("audio"));
app.all("/api/generate-video", handleHfGeneration("video"));
for (const [route, functionId] of Object.entries({ ...apiFunctions, ...apiAliases })) {
  app.all(`/api/${route}`, proxyServerFn(functionId));
}
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "Endpoint no encontrado" });
});

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    app(req, res);
    return;
  }

  if (pathname === "/_serverFn" || pathname.startsWith("/_serverFn/")) {
    await handleServerFn(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }

  const requested = resolveFile(pathname);
  if (requested) {
    sendFile(req, res, requested);
    return;
  }

  if (pathname !== "/" && extname(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  if (!existsSync(indexFile)) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Falta dist/index.html; ejecuta npm run build");
    return;
  }

  sendFile(req, res, indexFile);
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

server.listen(port, () => {
  console.log(`Cupido Leudy ❤️ sirviendo dist y API en http://localhost:${port}`);
});
