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

import { createSelfViewApi } from "./plugins/selfViewApi.ts";
import { createVoiceApi } from "./plugins/voiceApi.ts";
import { createStudioApi, stopAllStudioBackends } from "./plugins/studioApi.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { loadEnvFilesIntoProcess } from "./plugins/loadEnvFiles.ts";
import {
  applyBridgeToGlobals,
  bridgeScriptBody,
} from "./plugins/runtimeKeyBridge.ts";
import { createNodeEngineerAdapter } from "./plugins/nodeAdapters.ts";
import { createEngineerApi } from "./plugins/engineerApi.ts";
import { createEnvApi } from "./plugins/envApi.ts";
import { createAisBridge } from "./plugins/aisBridgePlugin.ts";
import { createInstagramApi } from "./plugins/instagramApi.ts";
import { createRssApi } from "./plugins/rssApi.ts";
import { createQuad9Api } from "./plugins/quad9Plugin.ts";
import { createNekoApi } from "./plugins/nekoApi.ts";
import { createGithubApi } from "./plugins/githubApi.ts";
import { createModelApi } from "./plugins/modelApi.ts";
import { createMeshyForgeApi } from "./plugins/meshyForgeApi.ts";
import { createAccessGate } from "./plugins/accessGate.ts";
import { createIntegrationApi } from "./plugins/integrationApi.ts";
import { createBrowseApi } from "./plugins/browseApi.ts";
import { createSourceCatalogApi } from "./plugins/sourceCatalogApi.ts";
import { createGuard, sendRefusal } from "./plugins/requestGuard.ts";
import { createAiProxyApi } from "./plugins/aiProxyApi.ts";

// Load the project's existing environment (.env.local overrides .env;
// platform-injected process env always wins) BEFORE anything reads it,
// so this runtime reports the same provider state as Vite dev.
const envSummary = loadEnvFilesIntoProcess([
  "VITE_ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY",
  "LELU_ANTHROPIC_API_KEY",
  "VITE_FIRMS_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
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

// Publish any provider key supplied under an unprefixed platform name
// onto the __LELU_*__ channel the providers already read, so a provider
// initialised inside THIS runtime resolves the same credential the
// browser bundle does. VITE_-named keys are never overridden.
const bridgedHere = applyBridgeToGlobals((key) => process.env[key]);
if (bridgedHere.length > 0) {
  console.log(
    "[LÉLU runtime] runtime key bridge: " +
      bridgedHere.map((b) => `${b.sourceName} → ${b.globalName}`).join(", "),
  );
}

// Behind a reverse proxy set HOST=127.0.0.1 so only the proxy can reach the app.
const HOST = process.env.HOST || "0.0.0.0";
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
      sendFile(req, res, resolved);
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
    sendFile(req, res, INDEX_HTML);
    return;
  }
  res.statusCode = 503;
  res.setHeader("Content-Type", "text/plain");
  res.end("LÉLU runtime: dist/ is missing — run `bun run build` first.");
}

/* ------------------------------------------------------------------ */
/* caching policy                                                      */
/* ------------------------------------------------------------------ */

/**
 * A build asset carries its own content hash in its file name
 * (`index-CuWeK89r.js`), so the bytes behind that URL can never change
 * and it may be served `immutable` for a year. Everything else — the
 * avatar art, the rigs, the icons, the manifest, the models — is
 * addressed by a stable path that a deploy CAN change, so it must
 * revalidate: one 304, instead of a stale copy that lasts a year.
 */
const HASHED_FILE = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;

function cachePolicyFor(urlPath: string, ext: string): string {
  if (ext === ".html") return "no-cache";
  // The service worker script decides which app version an installed
  // phone runs. Served `immutable`, a new worker is never even looked
  // at, so the PWA can never update itself on that device again.
  if (urlPath === "/sw.js") return "no-cache";
  if (urlPath.startsWith("/assets/") && HASHED_FILE.test(urlPath)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=0, must-revalidate";
}

/** FNV-1a over the served bytes — the app shell's validator. */
function hashOf(buffer: Buffer): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i += 1) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

type ByteRange = { start: number; end: number };
type RangeResult = ByteRange | "unsatisfiable" | null;

/**
 * One range only. A 49 MB model on a phone loses its connection; without
 * this the retry restarts at byte zero, which is the difference between
 * a resumed download and a download that never finishes.
 */
function parseRange(req: IncomingMessage, total: number, etag: string): RangeResult {
  const header = req.headers.range;
  if (typeof header !== "string") return null;
  // If-Range: honour the range only while the client's copy is current,
  // otherwise the two halves would not belong to the same model.
  const ifRange = req.headers["if-range"];
  if (typeof ifRange === "string" && ifRange.trim() !== etag) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // multi-range or malformed → full body
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix === 0) return "unsatisfiable";
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? total - 1 : Math.min(Number(rawEnd), total - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unsatisfiable";
  if (start > end || start >= total) return "unsatisfiable";
  return { start, end };
}

function isNotModified(req: IncomingMessage, etag: string, lastModified: Date): boolean {
  const inm = req.headers["if-none-match"];
  if (typeof inm === "string") {
    if (inm.trim() === "*") return true;
    const mine = etag.replace(/^W\//, "");
    return inm
      .split(",")
      .map((value) => value.trim().replace(/^W\//, ""))
      .includes(mine);
  }
  const ims = req.headers["if-modified-since"];
  if (typeof ims === "string") {
    const since = Date.parse(ims);
    if (Number.isFinite(since)) return lastModified.getTime() <= since;
  }
  return false;
}

function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(filePath);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  // The app shell is rewritten on the way out so a provider key present
  // in THIS process reaches the browser without a rebuild. `dist/` was
  // produced by an earlier `vite build`, which could only bake in the
  // keys that existed at BUILD time; a key provisioned afterwards would
  // otherwise be invisible until the app was rebuilt. Appending at the
  // end of <head> means the serve-time value wins over any build-time
  // one, which is the precedence you want.
  //
  // That rewrite is why the shell's ETag hashes the SERVED bytes: the
  // file on disk does not change when the environment does, so a
  // stat-derived validator would answer 304 and leave a returning
  // browser on the previous key set.
  const htmlBody =
    ext === ".html" ? Buffer.from(injectRuntimeKeyBridge(readFileSync(filePath, "utf8"))) : null;
  const lastModified = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
  const etag = htmlBody
    ? `"h${hashOf(htmlBody)}"`
    : `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const total = htmlBody ? htmlBody.length : stat.size;

  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", cachePolicyFor(urlPath, ext));
  res.setHeader("ETag", etag);
  res.setHeader("Last-Modified", lastModified.toUTCString());
  res.setHeader("Accept-Ranges", "bytes");

  if (isNotModified(req, etag, lastModified)) {
    res.statusCode = 304;
    res.end();
    return;
  }

  const range = parseRange(req, total, etag);
  if (range === "unsatisfiable") {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${total}`);
    res.setHeader("Content-Length", "0");
    res.end();
    return;
  }

  if (range) {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(total));
  }

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  if (htmlBody) {
    res.end(range ? htmlBody.subarray(range.start, range.end + 1) : htmlBody);
    return;
  }

  // Streamed, not read whole: a 49 MB model must not cost 49 MB of
  // resident memory for every concurrent download.
  const stream = createReadStream(filePath, range ? { start: range.start, end: range.end } : {});
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function injectRuntimeKeyBridge(html: string): string {
  const body = bridgeScriptBody((key) => process.env[key]);
  if (!body) return html;
  const script = `<script>\n${body}\n</script>\n`;
  return html.includes("</head>")
    ? html.replace("</head>", `${script}</head>`)
    : script + html;
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
createSelfViewApi().attach(middlewares);
// Intelligence integrations: real service probes, real OPA decisions and
// real security scans. Mounted HERE as well as in Vite dev, so the deployed
// runtime is not a lesser version of the development one.
middlewares.use(
  "/api/integration",
  createIntegrationApi({
    workspaceRoot: process.cwd(),
    runtime: "node-server",
    token: process.env.LELU_ENGINEER_TOKEN,
    allowedOrigins: (process.env.LELU_ENGINEER_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  }),
);
// Studio: the software-studio routes, same mount point as every other API.
createStudioApi().attach(middlewares);
createEnvApi((key) => process.env[key], "node-server", {
  aisStatus: () => aisBridge.getStatus(),
}).attach(middlewares);
aisBridge.attach(middlewares);
instagramApi.attach(middlewares);
rssApi.attach(middlewares);
quad9Api.attach(middlewares);
nekoApi.attach(middlewares);
createGithubApi().attach(middlewares);
// Page reader and knowledge relay — the same implementations Vite dev mounts.
// Both require a Supabase-verified signed-in user (plugins/requestGuard.ts);
// the reader fetches through plugins/safeFetch.ts (SSRF containment).
createBrowseApi().attach(middlewares);
// Source catalog + gated discovery (fixed catalog URL only, via safeFetch).
createSourceCatalogApi().attach(middlewares);
// Her voice and ears (ElevenLabs TTS + STT). Was mounted only in Vite dev, so
// the deployed runtime had no ElevenLabs voice at all; the key stays here.
createVoiceApi((key) => process.env[key]).attach(middlewares);
createAiProxyApi((key) => process.env[key]).attach(middlewares);
// Same-origin model broker: the browser posts here, the server holds
// the credential and talks to the provider.
createModelApi((key) => process.env[key]).attach(middlewares);
// LÉLU 3D Forge — the only holder of the Meshy credential (see meshyForgeApi.ts).
createMeshyForgeApi((key) => process.env[key]).attach(middlewares);
// The GitHub Models relay forwards with the SERVER's token, so it is for a
// signed-in user only (it was reachable anonymously).
const aiRelayGuard = createGuard();
middlewares.use("/api/ai", (req, res) => {
  void (async () => {
    const decision = await aiRelayGuard.check(req, "user", "github-models", { max: 60, windowMs: 60_000 });
    if (!decision.ok) {
      sendRefusal(res, decision);
      return;
    }
    await handleAiProxy(req, res);
  })();
});

const accessGate = createAccessGate((key) => process.env[key]);
const STARTED_AT = Date.now();
const VERSION = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: WORKSPACE_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.LELU_VERSION || "unknown";
  }
})();

/** Liveness/readiness for systemd, the reverse proxy and uptime monitors. No secrets. */
function healthz(res: ServerResponse): void {
  const mem = process.memoryUsage();
  res.statusCode = existsSync(INDEX_HTML) ? 200 : 503;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify({
      ok: res.statusCode === 200,
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      rssMb: Math.round(mem.rss / 1048576),
      heapMb: Math.round(mem.heapUsed / 1048576),
      dist: existsSync(INDEX_HTML),
      accessGate: accessGate.enabled,
    }),
  );
}

const server = createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  accessGate.handle(req, res, () => {
    if ((req.url ?? "").split("?")[0] === "/healthz") {
      healthz(res);
      return;
    }
    runMiddleware(req, res, 0);
  });
});
// Long model streams and slow phones: generous, but bounded.
server.requestTimeout = 300_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

// systemd sends SIGTERM on stop/restart: finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[LÉLU runtime] ${signal}: closing (in-flight requests finish, max 10 s).`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

// A preview backend outlives its parent unless it is stopped deliberately.
server.on("close", stopAllStudioBackends);

server.listen(PORT, HOST, () => {
  const aisState = aisKey ? "configured" : "not configured (AISSTREAM_API_KEY missing)";
  // Say OUT LOUD which way the engineering API is facing. It reads source,
  // runs commands and spawns servers, so on a public host the correct state
  // is DISABLED (no LELU_ENGINEER_TOKEN) — and an operator needs to see that
  // in the log rather than discover it from a probe.
  const engineerState = process.env.LELU_ENGINEER_TOKEN
    ? "token required (LELU_ENGINEER_TOKEN set)"
    : "DISABLED — LELU_ENGINEER_TOKEN is not set, every /api/engineer/* route answers 503";
  console.log(
    `[LÉLU runtime] serving ${DIST_DIR} on http://${HOST}:${PORT} — ` +
      `engineering API ${engineerState}, AIS bridge ${aisState}, /api/ai proxy ready, ` +
      `access gate ${accessGate.enabled ? "ON" : "OFF"}, version ${VERSION}.`,
  );
  if (!process.env.LELU_ENGINEER_TOKEN && HOST === "0.0.0.0") {
    console.log(
      "[LÉLU runtime] listening on all interfaces with the engineering API disabled (fail-closed). " +
        "That is the correct posture for a public host.",
    );
  }
});
