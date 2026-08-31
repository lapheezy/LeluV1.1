/**
 * ==========================================================
 * LÉLU — STANDALONE RUNTIME SERVER (Node / Bun)
 *
 * The full application runtime for production-style serving:
 *
 *   • serves the built app (dist/) with SPA fallback
 *   • mounts the ENGINEERING RUNTIME  → POST /api/engineer/*
 *       (command / read / write — whitelisted, workspace-bounded)
 *   • mounts the AIS vessel bridge    → GET /api/ais/*
 *       (server-side AISStream key, never in the bundle)
 *   • mounts env + provider health    → GET /api/env-check,
 *                                       GET /api/provider-health
 *   • proxies /api/ai → GitHub Models with the server-side token
 *
 * This is the runtime in which the deployed application actually
 * operates: the same endpoints the Vite dev server provides are
 * available here, so LÉLU's engineering/self-development workflow
 * is not a dev-only capability.
 *
 * Usage:
 *   bun run build   # once
 *   bun run serve   # serves dist/ + APIs on 0.0.0.0:${PORT:-4173}
 * ==========================================================
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadEnvFilesIntoProcess } from "./plugins/loadEnvFiles.ts";
import { createNodeEngineerAdapter } from "./plugins/nodeAdapters.ts";
import { createEngineerApi } from "./plugins/engineerApi.ts";
import { createEnvApi } from "./plugins/envApi.ts";
import { createAisBridge } from "./plugins/aisBridgePlugin.ts";
import { createInstagramApi } from "./plugins/instagramApi.ts";
import { createRssApi } from "./plugins/rssApi.ts";
import { createQuad9Api } from "./plugins/quad9Plugin.ts";
import { createNekoApi } from "./plugins/nekoApi.ts";
import { createGithubApi } from "./plugins/githubApi.ts";
import { createBrowseApi } from "./plugins/browseApi.ts";
import { createAiProxyApi } from "./plugins/aiProxyApi.ts";

// Load the project's existing environment (.env.local overrides .env;
// platform-injected process env always wins) BEFORE anything reads it,
// so this runtime reports the same provider state as Vite dev.
const envSummary = loadEnvFilesIntoProcess([
  "VITE_FIRMS_API_KEY",
  "AISSTREAM_API_KEY",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_USER_ID",
  "INSTAGRAM_API_VERSION",
  "VITE_SAPIOLINGO_RSS_URL",
  "VITE_ELPHERU_RSS_URL",
  "VITE_GOOGLE_NEWS_RSS_URL",
  "VITE_GOOGLE_NEWS_RSS_URL_2",
  "VITE_GOOGLE_NEWS_TEMPLATE",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_USER_ID",
  "INSTAGRAM_USERNAME",
  "INSTAGRAM_API_VERSION",
  "QUAD9_ECS",
  "QUAD9_ECS_MASK",
  "NEKO_PASSWORD",
  "VITE_NEKO_URL",
  "NEKO_URL",
]);
if (envSummary.filesLoaded.length > 0) {
  console.log(
    `[LÉLU runtime] env files loaded: ${envSummary.filesLoaded.join(", ")} | ` +
      Object.entries(envSummary.keys)
        .map(([k, v]) => `${k}=${v ? "SET" : "absent"}`)
        .join(" | "),
  );
}

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const WORKSPACE_ROOT = process.cwd();
const DIST_DIR = path.join(WORKSPACE_ROOT, "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

/* ------------------------------------------------------------------ */
/* tiny router with connect-style `use(path, handler)` middleware       */
/* ------------------------------------------------------------------ */

type MiddlewareHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

type MiddlewareEntry = { path: string; handler: MiddlewareHandler };

const middlewareList: MiddlewareEntry[] = [];

function use(mountPath: string, handler: MiddlewareHandler): void {
  middlewareList.push({ path: mountPath, handler });
}

const middlewares = { use };

function runMiddleware(req: IncomingMessage, res: ServerResponse, index: number): void {
  if (index >= middlewareList.length) {
    serveStatic(req, res);
    return;
  }
  const entry = middlewareList[index];
  const urlPath = (req.url ?? "").split("?")[0];
  if (!urlPath.startsWith(entry.path)) {
    runMiddleware(req, res, index + 1);
    return;
  }
  let called = false;
  entry.handler(req, res, () => {
    if (called) return;
    called = true;
    runMiddleware(req, res, index + 1);
  });
}

/* ------------------------------------------------------------------ */
/* static serving + SPA fallback                                       */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const requested = urlPath === "/" ? "/index.html" : urlPath;

  let filePath = path.join(DIST_DIR, requested);
  if (!filePath.startsWith(DIST_DIR)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  let resolved = filePath;
  try {
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      sendFile(res, resolved);
      return;
    }
  } catch {
    /* fall through to SPA fallback */
  }

  // SPA fallback: any non-file route returns the app shell (except real 404s
  // for files under /assets, which would be build errors).
  if (urlPath.startsWith("/assets/")) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  if (existsSync(INDEX_HTML)) {
    sendFile(res, INDEX_HTML);
    return;
  }
  res.statusCode = 503;
  res.setHeader("Content-Type", "text/plain");
  res.end("LÉLU runtime: dist/ is missing — run `bun run build` first.");
}

function sendFile(res: ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader(
    "Cache-Control",
    ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  );
  res.end(readFileSync(filePath));
}

/* ------------------------------------------------------------------ */
/* /api/ai proxy (GitHub Models) — same contract as the Vite proxy     */
/* ------------------------------------------------------------------ */

async function handleAiProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token =
    process.env.VITE_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_CODESPACE_TOKEN ||
    "";
  const target = new URL(req.url ?? "/", "https://models.inference.ai.azure.com");
  try {
    const upstream = await fetch(target, {
      method: req.method ?? "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await readRequestBody(req),
    });
    res.statusCode = upstream.status;
    for (const [key, value] of upstream.headers.entries()) {
      if (key.toLowerCase() === "content-encoding" || key.toLowerCase() === "transfer-encoding") continue;
      res.setHeader(key, value);
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    res.end(body);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ */
/* mount everything                                                    */
/* ------------------------------------------------------------------ */

const aisKey = process.env.AISSTREAM_API_KEY || "";
const aisBridge = createAisBridge({ apiKey: aisKey });
const instagramApi = createInstagramApi((key) => process.env[key]);
const rssApi = createRssApi((key) => process.env[key]);
const quad9Api = createQuad9Api((key) => process.env[key]);
const nekoApi = createNekoApi((key) => process.env[key]);

createEngineerApi(createNodeEngineerAdapter("node-server")).attach(middlewares);
createEnvApi((key) => process.env[key], "node-server", {
  aisStatus: () => aisBridge.getStatus(),
}).attach(middlewares);
aisBridge.attach(middlewares);
instagramApi.attach(middlewares);
rssApi.attach(middlewares);
quad9Api.attach(middlewares);
nekoApi.attach(middlewares);
// Mounted BEFORE the legacy /api/ai passthrough below: connect matches
// by prefix, so the catch-all would otherwise swallow these two routes.
createAiProxyApi((key) => process.env[key]).attach(middlewares);
// The server-side page reader BrowserTool falls back to when CORS blocks
// a direct read. It was mounted in Vite and Deno but not here, so a
// `bun run serve` deployment could open a page and never read one.
createBrowseApi().attach(middlewares);
createGithubApi().attach(middlewares);
middlewares.use("/api/ai", (req, res) => {
  void handleAiProxy(req, res);
});

const server = createServer((req, res) => {
  runMiddleware(req, res, 0);
});

server.listen(PORT, HOST, () => {
  const aisState = aisKey ? "configured" : "not configured (AISSTREAM_API_KEY missing)";
  console.log(
    `[LÉLU runtime] serving ${DIST_DIR} on http://${HOST}:${PORT} — ` +
      `engineering API mounted, AIS bridge ${aisState}, /api/ai proxy ready.`,
  );
});
