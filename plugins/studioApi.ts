/**
 * ==========================================================
 * LÉLU — SESSION 3C: STUDIO RUNTIME
 *
 * The server half of the software studio. It does real work on real
 * directories and reports only what the filesystem and the processes
 * returned:
 *
 *   POST /api/studio/health              runtime + engine capabilities
 *   POST /api/studio/projects            projects that exist on disk
 *   POST /api/studio/scaffold            copy a real template into .lelu-studio/
 *   POST /api/studio/demo                the three first demonstrations
 *   POST /api/studio/tree|read|write     the project explorer + editor
 *   POST /api/studio/build               run the project's build, return its exit code
 *   POST /api/studio/test                run its node:test suite, parse pass/fail
 *   GET  /api/studio/serve/<slug>/<path> the built output, same-origin, for a
 *                                        live preview inside a Cosmos window
 *   POST /api/studio/assets              Session 3B's forge ledger, unresolved
 *                                        jobs included honestly
 *   POST /api/studio/approvals/*         a person's decision; tools can only ask
 *   POST /api/studio/deploy              prepare (and publish only if configured
 *                                        AND, for production, human-approved)
 *
 * SAFETY
 *   - POST routes: same-origin only, plus LELU_ENGINEER_TOKEN when set.
 *   - Every path is resolved inside .lelu-studio/<slug>/; ".." is refused.
 *   - Build and test run fixed scripts (`node scripts/build.mjs`,
 *     `node --test tests/`), never a caller-supplied command.
 *   - A write that would put a credential in frontend code is refused.
 *   - Approval decisions require an explicit user-confirmed header that
 *     only the Studio panel's click handler sends; LÉLU's tools never do.
 * ==========================================================
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { assetRefsFromLedger } from "../src/core/studio/StudioAssets.ts";
import { refuseReasonForWrite } from "../src/core/studio/StudioSecurity.ts";

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on: (event: string, handler: (chunk?: unknown) => void) => void;
}
interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Buffer) => void;
}
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

const PROJECT_ROOT = process.cwd();
const STUDIO_ROOT = path.join(PROJECT_ROOT, ".lelu-studio");
const TEMPLATE_ROOT = path.join(PROJECT_ROOT, "studio", "templates");
const APPROVALS_FILE = path.join(STUDIO_ROOT, ".approvals.json");
const APPROVAL_TTL_MS = 15 * 60 * 1000;
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_OUTPUT = 12_000;
const BUILD_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 180_000;

const TEMPLATE_KINDS = { website: "website", application: "application", game: "game" } as const;
type TemplateKind = keyof typeof TEMPLATE_KINDS;

const PROTECTED_ACTIONS = new Set([
  "production-deploy",
  "paid-service",
  "production-database",
  "auth-security",
  "secret-management",
  "lelu-core",
]);

/* ------------------------------- plumbing ------------------------------- */

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: ConnectLikeReq, limit = MAX_WRITE_BYTES + 4096): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    req.on("data", (chunk) => {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
      size += text.length;
      if (size > limit) reject(new Error("Request body too large."));
      else chunks.push(text);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? (JSON.parse(chunks.join("")) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Body is not valid JSON."));
      }
    });
    req.on("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}

function header(req: ConnectLikeReq, name: string): string {
  const value = req.headers?.[name];
  return typeof value === "string" ? value : "";
}

function isCrossOrigin(req: ConnectLikeReq): boolean {
  const origin = header(req, "origin");
  const host = header(req, "host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function tokenOk(req: ConnectLikeReq): boolean {
  const required = process.env.LELU_ENGINEER_TOKEN;
  if (!required) return true;
  return header(req, "x-lelu-engineer-token") === required;
}

function safeSlug(raw: unknown): string {
  const slug = String(raw ?? "");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    throw new Error("A project slug is lowercase letters, digits and dashes (max 64).");
  }
  return slug;
}

function slugFromName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}

function projectRoot(slug: string): string {
  const root = path.join(STUDIO_ROOT, slug);
  if (!existsSync(root)) throw new Error(`No studio project "${slug}". Create one first.`);
  return root;
}

function resolveInside(root: string, relative: string): string {
  const clean = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  const full = path.resolve(root, clean);
  const prefix = path.resolve(root) + path.sep;
  if (full !== path.resolve(root) && !full.startsWith(prefix)) {
    throw new Error("That path is outside the project.");
  }
  return full;
}

function walkFiles(root: string, dir = root, depth = 0, out: string[] = []): string[] {
  if (depth > 8 || out.length > 4000) return out;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkFiles(root, full, depth + 1, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out;
}

function dirSize(root: string): number {
  let bytes = 0;
  for (const file of walkFiles(root)) {
    try {
      bytes += statSync(path.join(root, file)).size;
    } catch {
      /* raced with a build; ignore */
    }
  }
  return bytes;
}

function trimOutput(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…[truncated]` : text;
}

/* -------------------------------- engine -------------------------------- */

function engineCapabilities() {
  const hasBinary = (binary: string) => {
    try {
      return spawnSync(binary, ["--version"], { timeout: 3000, stdio: "ignore" }).status !== null;
    } catch {
      return false;
    }
  };
  return {
    node: true,
    godot: hasBinary("godot"),
    unity: hasBinary("unity"),
    unreal: hasBinary("UnrealEditor"),
    headlessBrowser:
      existsSync("/opt/pw-browsers/chromium") ||
      existsSync(path.join(PROJECT_ROOT, "node_modules", "playwright")),
  };
}

/* -------------------------------- process -------------------------------- */

interface RunResult {
  exitCode: number;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

function runNode(root: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, args, {
        cwd: root,
        detached: process.platform !== "win32",
        env: { ...process.env, CI: "1", NODE_OPTIONS: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        exitCode: 1,
        output: `Could not start the process: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: 0,
        timedOut: false,
      });
      return;
    }
    const keep = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        output: trimOutput(output.trim()),
        durationMs: Date.now() - started,
        timedOut,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        output: `${output}\n${error.message}`.trim(),
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}

/* ------------------------------ scaffold/demo ---------------------------- */

function templateDir(kind: TemplateKind): string {
  const dir = path.join(TEMPLATE_ROOT, kind);
  if (!existsSync(dir)) throw new Error(`The ${kind} template is missing from the studio runtime.`);
  return dir;
}

function copyGameAssets(root: string): { copied: string[]; notes: string[] } {
  const copied: string[] = [];
  const notes: string[] = [];
  const threeSource = path.join(PROJECT_ROOT, "node_modules", "three", "build", "three.module.js");
  if (existsSync(threeSource)) {
    mkdirSync(path.join(root, "vendor"), { recursive: true });
    copyFileSync(threeSource, path.join(root, "vendor", "three.module.js"));
    copied.push("vendor/three.module.js");
  } else {
    notes.push(
      "three.js was not found in node_modules, so the game cannot render until dependencies are installed.",
    );
  }
  const character = path.join(
    PROJECT_ROOT,
    "leluverse/assets/characters/lelu_character/references/body-front-apose-hood.png",
  );
  if (existsSync(character)) {
    mkdirSync(path.join(root, "assets"), { recursive: true });
    copyFileSync(character, path.join(root, "assets", "character-card.png"));
    copied.push("assets/character-card.png");
    notes.push(
      "The character card uses Session 3B's real reference image; the rigged GLB is still awaiting Meshy approval.",
    );
  } else {
    notes.push("Session 3B's character reference image was not found; the game runs without its card texture.");
  }
  return { copied, notes };
}

function scaffold(kind: TemplateKind, name: string, slugOverride?: string) {
  const slug = slugOverride ? safeSlug(slugOverride) : slugFromName(name);
  const root = path.join(STUDIO_ROOT, slug);
  if (existsSync(root)) throw new Error(`A studio project "${slug}" already exists.`);
  mkdirSync(root, { recursive: true });
  cpSync(templateDir(kind), root, { recursive: true });
  const extra: string[] = [];
  const notes: string[] = [];
  if (kind === "game") {
    const assets = copyGameAssets(root);
    extra.push(...assets.copied);
    notes.push(...assets.notes);
  }
  const files = walkFiles(root);
  return { slug, root: path.relative(PROJECT_ROOT, root).split(path.sep).join("/"), files: files.length, extra, notes };
}

const DEMOS: Array<{ kind: TemplateKind; name: string; slug: string }> = [
  { kind: "website", name: "Aurora Site", slug: "aurora-site" },
  { kind: "application", name: "Pulse Board", slug: "pulse-board" },
  { kind: "game", name: "Rift Runner 3D", slug: "rift-runner-3d" },
];

/* ------------------------------- approvals ------------------------------- */

interface StoredApproval {
  id: string;
  slug: string;
  action: string;
  reason: string;
  scope: string[];
  requestedAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "denied" | "expired";
  decidedAt: number | null;
  decidedBy: string | null;
}

function readApprovals(): StoredApproval[] {
  try {
    const raw = JSON.parse(readFileSync(APPROVALS_FILE, "utf8")) as StoredApproval[];
    const now = Date.now();
    return (Array.isArray(raw) ? raw : []).map((approval) =>
      approval.status === "pending" && now > approval.expiresAt
        ? { ...approval, status: "expired" as const }
        : approval,
    );
  } catch {
    return [];
  }
}

function writeApprovals(approvals: StoredApproval[]): void {
  mkdirSync(STUDIO_ROOT, { recursive: true });
  writeFileSync(APPROVALS_FILE, `${JSON.stringify(approvals.slice(-50), null, 2)}\n`, "utf8");
}

function liveApproval(slug: string, action: string): StoredApproval | null {
  const now = Date.now();
  return (
    readApprovals().find(
      (approval) =>
        approval.slug === slug &&
        approval.action === action &&
        approval.status === "approved" &&
        now < approval.expiresAt,
    ) ?? null
  );
}

/** The exact approval a caller names, if it is live and for this act. */
function approvalById(slug: string, action: string, id: string): StoredApproval | null {
  const approval = readApprovals().find((item) => item.id === id);
  if (!approval) return null;
  if (approval.slug !== slug || approval.action !== action) return null;
  if (approval.status !== "approved" || Date.now() >= approval.expiresAt) return null;
  return approval;
}

/* ------------------------------- deployment ------------------------------ */

function prepareDeployment(slug: string, environment: "preview" | "production", approvalId?: string) {
  const root = projectRoot(slug);
  const dist = path.join(root, "dist");
  if (!existsSync(dist)) throw new Error("There is no build output to deploy. Run the build first.");
  const action = "production-deploy";
  const approval = environment === "production"
    ? approvalId
      ? approvalById(slug, action, approvalId)
      : liveApproval(slug, action)
    : null;
  if (environment === "production" && !approval) {
    return {
      ok: false,
      status: "blocked" as const,
      environment,
      target: "",
      error:
        "Production deployment needs a live human approval for this project. " +
        (approvalId
          ? "The named approval is not approved, has expired, or belongs to another project or action."
          : "No approval has been granted."),
    };
  }
  const targetRoot = path.join(root, "deploy", environment);
  mkdirSync(targetRoot, { recursive: true });
  cpSync(dist, targetRoot, { recursive: true });
  const files = walkFiles(targetRoot);
  const manifest = {
    project: slug,
    environment,
    preparedAt: new Date().toISOString(),
    files,
    bytes: dirSize(targetRoot),
    approvedBy: environment === "production" ? approval?.decidedBy ?? null : null,
  };
  writeFileSync(path.join(targetRoot, "studio-deploy.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const publishRoot = process.env.STUDIO_PUBLISH_TARGET;
  if (!publishRoot) {
    return {
      ok: true,
      status: "prepared" as const,
      environment,
      target: path.relative(PROJECT_ROOT, targetRoot).split(path.sep).join("/"),
      note:
        "Prepared only. No STUDIO_PUBLISH_TARGET is configured, so nothing was published to a live host.",
    };
  }
  const publishTarget = path.join(publishRoot, slug, environment);
  mkdirSync(publishTarget, { recursive: true });
  cpSync(targetRoot, publishTarget, { recursive: true });
  return {
    ok: true,
    status: "published" as const,
    environment,
    target: publishTarget,
    note: `Copied to the configured publish target (${publishTarget}).`,
  };
}

/* --------------------------------- assets -------------------------------- */

function readAssets() {
  const ledgerPath = path.join(PROJECT_ROOT, "leluverse/forge/ledger.json");
  let ledger: Parameters<typeof assetRefsFromLedger>[0] = {};
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Parameters<typeof assetRefsFromLedger>[0];
  } catch {
    return {
      ok: false,
      assets: [],
      error: "Session 3B's forge ledger was not found, so no asset references can be resolved.",
    };
  }
  const assetRoot = path.join(PROJECT_ROOT, "leluverse", "assets");
  const files = existsSync(assetRoot) ? walkFiles(assetRoot) : [];
  return { ok: true, assets: assetRefsFromLedger(ledger, files) };
}

/* --------------------------------- routes -------------------------------- */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/* --------------------------- application backend -------------------------
 * An application project declares its backend in studio.json. Its preview
 * must be the REAL app connected to the REAL API, not a static shell, so
 * the studio starts that backend and proxies the whole preview through
 * this origin. Relative /api requests inside the iframe then reach the
 * project's own server without rewriting a single frontend file.
 */

interface BackendConfig {
  command: string;
  health?: string;
}

interface RunningBackend {
  port: number;
  child: ChildProcess;
}

const backends = new Map<string, RunningBackend>();

function backendConfig(root: string): BackendConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, "studio.json"), "utf8")) as {
      backend?: { command?: string; health?: string };
    };
    if (!parsed.backend?.command) return null;
    return { command: parsed.backend.command, health: parsed.backend.health ?? "/api/health" };
  } catch {
    return null;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function ensureBackend(slug: string, root: string, config: BackendConfig): Promise<RunningBackend> {
  const existing = backends.get(slug);
  if (existing) return existing;
  const port = await freePort();
  const child = spawn(process.execPath, [config.command], {
    cwd: root,
    detached: process.platform !== "win32",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_OPTIONS: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const keep = (chunk: Buffer) => {
    log = `${log}${chunk.toString("utf8")}`.slice(-4000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const running: RunningBackend = { port, child };
  backends.set(slug, running);
  child.on("exit", () => {
    if (backends.get(slug)?.child === child) backends.delete(slug);
  });
  const up = await waitForHealth(`http://127.0.0.1:${port}${config.health}`, 30_000);
  if (!up) {
    backends.delete(slug);
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    throw new Error(
      `The application backend did not become healthy within 30 s. ${log.trim().slice(-1200)}`.trim(),
    );
  }
  return running;
}

async function proxyToBackend(
  req: ConnectLikeReq,
  res: ConnectLikeRes,
  slug: string,
  root: string,
  config: BackendConfig,
  remainder: string,
): Promise<void> {
  const running = await ensureBackend(slug, root, config);
  const rawUrl = req.url ?? "/";
  const query = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";
  const method = (req.method ?? "GET").toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await new Promise<string>((resolve, reject) => {
      let size = 0;
      const chunks: string[] = [];
      const decoder = new TextDecoder();
      req.on("data", (chunk) => {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
        size += text.length;
        if (size > MAX_WRITE_BYTES) reject(new Error("Request body too large."));
        else chunks.push(text);
      });
      req.on("end", () => resolve(chunks.join("")));
      req.on("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
    });
  }
  const target = `http://127.0.0.1:${running.port}/${remainder}${query}`;
  const upstream = await fetch(target, {
    method,
    headers: { "content-type": header(req, "content-type") || "application/json" },
    body,
  });
  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = upstream.status;
  res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.end(buffer);
}

/** Stop every application backend this runtime started. */
export function stopAllStudioBackends(): void {
  for (const [slug, running] of backends) {
    try {
      if (running.child.pid) process.kill(-running.child.pid, "SIGTERM");
      else running.child.kill("SIGTERM");
    } catch {
      running.child.kill("SIGTERM");
    }
    backends.delete(slug);
  }
}

function servePreview(req: ConnectLikeReq, res: ConnectLikeRes): void {
  const relative = (req.url ?? "").split("?")[0].replace(/^\/+/, "");
  const [rawSlug, ...rest] = relative.split("/");
  let slug: string;
  try {
    slug = safeSlug(decodeURIComponent(rawSlug ?? ""));
  } catch (error) {
    sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    return;
  }
  const projectDirectory = path.join(STUDIO_ROOT, slug);
  const backend = backendConfig(projectDirectory);
  if (backend) {
    const remainder = rest.map((part) => decodeURIComponent(part)).join("/");
    void proxyToBackend(req, res, slug, projectDirectory, backend, remainder).catch((error) => {
      sendJson(
        res,
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        502,
      );
    });
    return;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, { ok: false, error: "A static preview is read with GET." }, 405);
    return;
  }

  const root = path.join(projectDirectory, "dist");
  if (!existsSync(root)) {
    sendJson(
      res,
      { ok: false, error: `"${slug}" has no build output. Run its build before previewing it.` },
      404,
    );
    return;
  }
  const requested = rest.length === 0 ? "index.html" : rest.map((part) => decodeURIComponent(part)).join("/");
  let file: string;
  try {
    file = resolveInside(root, requested);
  } catch {
    sendJson(res, { ok: false, error: "That preview path is outside the project." }, 403);
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) {
    sendJson(res, { ok: false, error: `Not built: ${requested}` }, 404);
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(readFileSync(file));
}

export function createStudioApi(): { attach: (middlewares: { use: (route: string, handler: Handler) => void }) => void } {
  const postRoute = (_route: string, handler: (body: Record<string, unknown>, req: ConnectLikeReq) => Promise<unknown>) => {
    return (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => {
      if ((req.method ?? "GET").toUpperCase() !== "POST") {
        next();
        return;
      }
      if (isCrossOrigin(req)) {
        sendJson(res, { ok: false, error: "Cross-origin requests are not permitted." }, 403);
        return;
      }
      if (!tokenOk(req)) {
        sendJson(res, { ok: false, error: "The studio runtime requires LELU_ENGINEER_TOKEN." }, 401);
        return;
      }
      void (async () => {
        try {
          const body = await readJsonBody(req);
          const result = await handler(body, req);
          sendJson(res, result);
        } catch (error) {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
        }
      })();
    };
  };

  return {
    attach(middlewares) {
      middlewares.use(
        "/api/studio/health",
        postRoute("/api/studio/health", async () => {
          const templates = existsSync(TEMPLATE_ROOT) ? readdirSync(TEMPLATE_ROOT) : [];
          return {
            ok: true,
            runtime: "studio",
            root: path.relative(PROJECT_ROOT, STUDIO_ROOT).split(path.sep).join("/"),
            templates,
            capabilities: engineCapabilities(),
          };
        }),
      );

      middlewares.use(
        "/api/studio/projects",
        postRoute("/api/studio/projects", async () => {
          if (!existsSync(STUDIO_ROOT)) return { ok: true, projects: [] };
          const projects = readdirSync(STUDIO_ROOT)
            .filter((name) => /^[a-z0-9][a-z0-9-]*$/.test(name) && statSync(path.join(STUDIO_ROOT, name)).isDirectory())
            .map((slug) => {
              const root = path.join(STUDIO_ROOT, slug);
              const files = walkFiles(root).filter((file) => !file.startsWith("dist/") && !file.startsWith("deploy/"));
              return {
                slug,
                files: files.length,
                bytes: dirSize(root),
                updatedAt: statSync(root).mtimeMs,
                built: existsSync(path.join(root, "dist", "index.html")),
              };
            });
          return { ok: true, projects };
        }),
      );

      middlewares.use(
        "/api/studio/scaffold",
        postRoute("/api/studio/scaffold", async (body) => {
          const kind = String(body.kind ?? "") as TemplateKind;
          if (!(kind in TEMPLATE_KINDS)) {
            throw new Error("kind must be website, application or game.");
          }
          const name = String(body.name ?? "").trim();
          if (!name) throw new Error("A project needs a name.");
          return { ok: true, ...scaffold(kind, name) };
        }),
      );

      middlewares.use(
        "/api/studio/demo",
        postRoute("/api/studio/demo", async () => {
          const results = DEMOS.map((demo) => {
            try {
              const created = scaffold(demo.kind, demo.name, demo.slug);
              return { ok: true, kind: demo.kind, ...created };
            } catch (error) {
              return {
                ok: false,
                kind: demo.kind,
                slug: demo.slug,
                files: 0,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          });
          return { ok: results.every((result) => result.ok), projects: results };
        }),
      );

      middlewares.use(
        "/api/studio/tree",
        postRoute("/api/studio/tree", async (body) => {
          const root = projectRoot(safeSlug(body.slug));
          const target = resolveInside(root, String(body.path ?? "."));
          if (!existsSync(target)) throw new Error("That directory does not exist.");
          if (!statSync(target).isDirectory()) throw new Error("That path is a file, not a directory.");
          const entries = readdirSync(target)
            .filter((name) => name !== "node_modules" && name !== ".git")
            .map((name) => {
              const full = path.join(target, name);
              const stat = statSync(full);
              return {
                name,
                path: path.relative(root, full).split(path.sep).join("/"),
                type: stat.isDirectory() ? ("dir" as const) : ("file" as const),
                size: stat.isDirectory() ? undefined : stat.size,
              };
            })
            .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
          return { ok: true, entries };
        }),
      );

      middlewares.use(
        "/api/studio/read",
        postRoute("/api/studio/read", async (body) => {
          const root = projectRoot(safeSlug(body.slug));
          const file = resolveInside(root, String(body.path ?? ""));
          if (!existsSync(file) || statSync(file).isDirectory()) throw new Error("No such file.");
          if (statSync(file).size > MAX_WRITE_BYTES) throw new Error("That file is too large to open.");
          return { ok: true, content: readFileSync(file, "utf8") };
        }),
      );

      middlewares.use(
        "/api/studio/write",
        postRoute("/api/studio/write", async (body) => {
          const root = projectRoot(safeSlug(body.slug));
          const relative = String(body.path ?? "");
          if (!relative) throw new Error("A write needs a path.");
          const content = String(body.content ?? "");
          if (content.length > MAX_WRITE_BYTES) throw new Error("That file is too large to save.");
          const refusal = refuseReasonForWrite(content);
          if (refusal) throw new Error(refusal);
          const file = resolveInside(root, relative);
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, content, "utf8");
          return { ok: true, path: path.relative(root, file).split(path.sep).join("/"), bytes: content.length };
        }),
      );

      middlewares.use(
        "/api/studio/backends/stop",
        postRoute("/api/studio/backends/stop", async () => {
          const running = backends.size;
          stopAllStudioBackends();
          return { ok: true, stopped: running };
        }),
      );

      middlewares.use(
        "/api/studio/build",
        postRoute("/api/studio/build", async (body) => {
          const slug = safeSlug(body.slug);
          const root = projectRoot(slug);
          if (!existsSync(path.join(root, "scripts", "build.mjs"))) {
            throw new Error("This project has no scripts/build.mjs, so it cannot be built here.");
          }
          const result = await runNode(root, ["scripts/build.mjs"], BUILD_TIMEOUT_MS);
          const dist = path.join(root, "dist");
          const built = existsSync(dist);
          const sourceFiles = walkFiles(root).filter(
            (file) => !file.startsWith("dist/") && !file.startsWith("deploy/") && !file.startsWith(".studio/"),
          );
          let hash = 0x811c9dc5;
          let sourceBytes = 0;
          for (const file of sourceFiles) {
            const content = readFileSync(path.join(root, file));
            sourceBytes += content.byteLength;
            const text = `${file}\u0000${content.toString("base64")}`;
            for (let index = 0; index < text.length; index += 1) {
              hash ^= text.charCodeAt(index);
              hash = Math.imul(hash, 0x01000193) >>> 0;
            }
          }
          return {
            ok: result.exitCode === 0 && built,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            output: result.output || "(the build produced no output)",
            artifact: built ? "dist" : null,
            bytes: built ? dirSize(dist) : 0,
            timedOut: result.timedOut,
            version: {
              files: sourceFiles.length,
              bytes: sourceBytes,
              hash: hash.toString(16).padStart(8, "0"),
            },
          };
        }),
      );

      middlewares.use(
        "/api/studio/test",
        postRoute("/api/studio/test", async (body) => {
          const slug = safeSlug(body.slug);
          const root = projectRoot(slug);
          if (!existsSync(path.join(root, "tests"))) throw new Error("This project has no tests directory.");
          // TAP is asked for explicitly: the default reporter's output
          // ("ℹ pass 9") depends on whether a terminal is attached, and a
          // test count must not change with the runner's TTY.
          const result = await runNode(root, ["--test", "--test-reporter=tap", "tests/"], TEST_TIMEOUT_MS);
          const pass = /# pass (\d+)/.exec(result.output);
          const fail = /# fail (\d+)/.exec(result.output);
          return {
            ok: result.exitCode === 0,
            exitCode: result.exitCode,
            passed: pass ? Number(pass[1]) : 0,
            failed: fail ? Number(fail[1]) : result.exitCode === 0 ? 0 : 1,
            durationMs: result.durationMs,
            output: result.output || "(the test run produced no output)",
            timedOut: result.timedOut,
          };
        }),
      );

      // Static previews are GET; an application's preview proxies its own
      // backend, so POST/PATCH/DELETE must reach it too. Measured in the
      // first end-to-end run: the app's create-task POST fell through to a
      // 404 because this handler only accepted GET.
      middlewares.use("/api/studio/serve", (req, res) => {
        servePreview(req, res);
      });

      middlewares.use(
        "/api/studio/assets",
        postRoute("/api/studio/assets", async () => readAssets()),
      );

      middlewares.use(
        "/api/studio/approvals/request",
        postRoute("/api/studio/approvals/request", async (body) => {
          const slug = safeSlug(body.slug);
          projectRoot(slug);
          const action = String(body.action ?? "");
          if (!PROTECTED_ACTIONS.has(action)) {
            throw new Error(`"${action}" is not a protected action, so it needs no approval.`);
          }
          const reason = String(body.reason ?? "").trim();
          if (reason.length < 12) throw new Error("An approval request must explain what would happen.");
          const now = Date.now();
          const approval: StoredApproval = {
            id: `approval-${crypto.randomUUID().slice(0, 8)}`,
            slug,
            action,
            reason,
            scope: Array.isArray(body.scope) ? body.scope.map(String) : [],
            requestedAt: now,
            expiresAt: now + APPROVAL_TTL_MS,
            status: "pending",
            decidedAt: null,
            decidedBy: null,
          };
          writeApprovals([...readApprovals(), approval]);
          return { ok: true, approvalId: approval.id, approval };
        }),
      );

      middlewares.use(
        "/api/studio/approvals/list",
        postRoute("/api/studio/approvals/list", async (body) => {
          const slug = safeSlug(body.slug);
          return { ok: true, approvals: readApprovals().filter((approval) => approval.slug === slug) };
        }),
      );

      middlewares.use(
        "/api/studio/approvals/decide",
        postRoute("/api/studio/approvals/decide", async (body, req) => {
          if (header(req, "x-lelu-user-confirmed") !== "1") {
            throw new Error(
              "An approval can only be decided by the person, through the Studio panel. " +
                "LÉLU's tools cannot grant one.",
            );
          }
          const approvalId = String(body.approvalId ?? "");
          const decision = body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : null;
          if (!decision) throw new Error("decision must be approved or denied.");
          const decidedBy = String(body.decidedBy ?? "").trim();
          if (!decidedBy) throw new Error("An approval decision needs the person's identity.");
          const approvals = readApprovals();
          const approval = approvals.find((item) => item.id === approvalId);
          if (!approval) throw new Error(`No approval "${approvalId}".`);
          if (approval.status !== "pending") throw new Error(`That approval is already ${approval.status}.`);
          const next: StoredApproval = {
            ...approval,
            status: decision,
            decidedAt: Date.now(),
            decidedBy,
          };
          writeApprovals(approvals.map((item) => (item.id === approvalId ? next : item)));
          return { ok: true, approval: next };
        }),
      );

      middlewares.use(
        "/api/studio/deploy",
        postRoute("/api/studio/deploy", async (body) => {
          const slug = safeSlug(body.slug);
          const environment = body.environment === "production" ? "production" : "preview";
          const result = prepareDeployment(
            slug,
            environment,
            typeof body.approvalId === "string" ? body.approvalId : undefined,
          );
          return result;
        }),
      );
    },
  };
}
