/**
 * ==========================================================
 * LÉLU — RESOURCE INTELLIGENCE API (server half)
 *
 *   GET  /api/resources/status     what isolation this host can provide
 *   POST /api/resources/discover   {query, sources?, limit?}  npm · GitHub · GitLab
 *   POST /api/resources/evaluate   {name, source?}             evidence + verdict
 *   POST /api/resources/gap        {request, tools[]}          gaps + installed reuse
 *   POST /api/resources/sandbox    {package?|reuse?, version?, code}  isolated PoC
 *   POST /api/resources/audit      {}                          LÉLU's own dependencies
 *   POST /api/resources/promote    {package, version}          approval-gated
 *
 * Every source is a PUBLIC, NO-KEY endpoint. Nothing here sends a
 * credential, and nothing here costs money (the GitHub search API is
 * unauthenticated and therefore rate limited — reported, never bypassed).
 * Judgement is deterministic (src/core/acquisition/ResourceIntelligence.ts):
 * discovery and evaluation make no model call.
 *
 * Sandbox: downloaded code never runs in this process or in LÉLU's runtime.
 *   install  npm install --ignore-scripts into a throwaway folder under
 *            .lelu-state/sandbox, environment scrubbed (only proxy/CA
 *            plumbing so the registry is reachable; no API keys)
 *   run      a separate node process with the permission model on —
 *            file reads only inside the sandbox (and an installed module
 *            being reused), no child processes, no workers, no addons —
 *            inside a fresh network namespace (no network at all) when
 *            the host allows it; otherwise network calls are disabled by
 *            a preload guard and the response says so. Empty environment,
 *            20 s timeout, output capped.
 * Promotion into production is never automatic: it needs a passing
 * sandbox run, a non-blocked evaluation and the user's own approval, and
 * it only records an integration plan for the existing engineering
 * workspace (which has its own approval and rollback).
 * ==========================================================
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import {
  analyzeDependencies, detectCapabilityGaps, describeEvaluation, evaluateResource, rankEvaluations,
  type DependencyFact, type ResourceEvaluation, type ResourceEvidence,
} from "../src/core/acquisition/ResourceIntelligence.ts";
import { createCapabilityLedger, isActive, parseCapabilityDecision, TransitionError, type CapabilityRecord, type LifecycleState } from "./capabilityLedger.ts";
import { spendPolicy } from "./spendPolicy.ts";

type Req = { url?: string; method?: string; headers?: Record<string, string | string[] | undefined>; on?: (event: string, cb: (chunk?: unknown) => void) => void };
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string) => void };

const ROOT = process.cwd();
const STATE = path.join(ROOT, ".lelu-state", "resources");
const SANDBOX_ROOT = path.join(ROOT, ".lelu-state", "sandbox");
const UA = "LELU-resource-intelligence/1.0";
const CACHE_MS = 10 * 60_000;
const MAX_SANDBOX_BYTES = 40 * 1_048_576;
const RUN_TIMEOUT_MS = 20_000;
const INSTALL_TIMEOUT_MS = 180_000;
const MAX_OUTPUT = 64 * 1024;
const CONSENT_HEADER = "x-lelu-user-consent";

/** Only what reaching the public registry needs. Never a key or token. */
const NETWORK_PLUMBING = [
  "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy",
  "npm_config_https_proxy", "npm_config_noproxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE",
];

/* ------------------------------------------------------------------ utils */

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<{ status: number; body: unknown; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) } });
    const text = await response.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    return { status: response.status, body, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

function log(entry: Record<string, unknown>): void {
  try {
    mkdirSync(STATE, { recursive: true });
    appendFileSync(path.join(STATE, "log.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch { /* the log must never break a request */ }
}

let ledgerInstance: ReturnType<typeof createCapabilityLedger> | null = null;
export function capabilityLedger() {
  ledgerInstance ??= createCapabilityLedger(STATE);
  return ledgerInstance;
}
export function setCapabilityLedgerForTests(ledger: ReturnType<typeof createCapabilityLedger> | null): void {
  ledgerInstance = ledger;
}

/** Lifecycle bookkeeping attached to discover/evaluate/sandbox: best effort, never blocks the work. */
function lifecycle(capability: unknown, state: LifecycleState, actor: string, evidence: Record<string, unknown>, init?: Parameters<ReturnType<typeof createCapabilityLedger>["transition"]>[4]): void {
  if (typeof capability !== "string" || !capability) return;
  try {
    const current = capabilityLedger().get(capability);
    if (current && isActive(current)) return; // an active capability is not re-discovered
    capabilityLedger().transition(capability, state, actor, evidence, init);
  } catch { /* an out-of-order report is recorded nowhere rather than corrupting the ledger */ }
}

/** Why a ledger record can no longer be trusted as-is. */
function staleness(record: CapabilityRecord): string[] {
  const reasons: string[] = [];
  if (record.sandboxId && !existsSync(path.join(STATE, `verified-${record.sandboxId.replace(/[^\w-]/g, "")}.json`))) reasons.push("its sandbox evidence is missing");
  const pkg = record.source?.match(/^((?:@[\w.-]+\/)?[\w.-]+)@([\w.+-]+)$/);
  if (pkg) {
    const here = installedInfo(pkg[1]);
    if (record.source?.startsWith("installed:") || here) {
      if (here?.version && here.version !== pkg[2]) reasons.push(`installed version is ${here.version}, verified ${pkg[2]}`);
    }
  }
  return reasons;
}

const safeName = (name: string) => /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name) && name.length <= 214;
const safeVersion = (v: string) => /^[\w.+-]{1,64}$/.test(v);

/* -------------------------------------------------------------- discovery */

export interface DiscoveredResource { source: "npm" | "github" | "gitlab"; name: string; description?: string; url?: string; version?: string; updated?: string; stars?: number; license?: string }

async function discoverNpm(query: string, limit: number): Promise<DiscoveredResource[]> {
  const { status, body } = await getJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`);
  if (status !== 200) throw new Error(`npm search ${status}`);
  const objects = (body as { objects?: Array<{ package: { name: string; version: string; description?: string; date?: string; links?: { npm?: string } } }> }).objects ?? [];
  return objects.map(({ package: p }) => ({ source: "npm" as const, name: p.name, version: p.version, description: p.description, updated: p.date, url: p.links?.npm }));
}

async function discoverGitHub(query: string, limit: number): Promise<{ items: DiscoveredResource[]; remaining?: string }> {
  const { status, body, headers } = await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${limit}`);
  const remaining = headers.get("x-ratelimit-remaining") ?? undefined;
  if (status !== 200) throw new Error(`GitHub search ${status}${status === 403 || status === 429 ? " (free unauthenticated rate limit reached — not bypassed)" : ""}`);
  const items = (body as { items?: Array<{ full_name: string; description?: string; html_url: string; pushed_at?: string; stargazers_count?: number; license?: { spdx_id?: string } | null; archived?: boolean }> }).items ?? [];
  return {
    remaining,
    items: items.map((r) => ({ source: "github" as const, name: r.full_name, description: r.description ?? undefined, url: r.html_url, updated: r.pushed_at, stars: r.stargazers_count, license: r.license?.spdx_id ?? undefined })),
  };
}

async function discoverGitLab(query: string, limit: number): Promise<DiscoveredResource[]> {
  const { status, body } = await getJson(`https://gitlab.com/api/v4/projects?search=${encodeURIComponent(query)}&order_by=star_count&sort=desc&per_page=${limit}&visibility=public`);
  if (status !== 200) throw new Error(`GitLab search ${status}`);
  return ((body as Array<{ path_with_namespace: string; description?: string; web_url: string; last_activity_at?: string; star_count?: number }>) ?? []).map((p) => ({
    source: "gitlab" as const, name: p.path_with_namespace, description: p.description ?? undefined, url: p.web_url, updated: p.last_activity_at, stars: p.star_count,
  }));
}

/* --------------------------------------------------------------- evidence */

function installedInfo(name: string): { version?: string; license?: string; declared?: string } | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")) as { version?: string; license?: string };
    const own = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { version: pkg.version, license: typeof pkg.license === "string" ? pkg.license : undefined, declared: own.dependencies?.[name] ?? own.devDependencies?.[name] };
  } catch {
    return null;
  }
}

async function osvCount(ecosystem: "npm" | "PyPI", name: string, version: string | undefined): Promise<number | undefined> {
  if (!version) return undefined;
  try {
    const { status, body } = await getJson("https://api.osv.dev/v1/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version, package: { name, ecosystem } }) });
    if (status !== 200) return undefined;
    return ((body as { vulns?: unknown[] }).vulns ?? []).length;
  } catch {
    return undefined;
  }
}

export async function npmEvidence(name: string): Promise<ResourceEvidence> {
  if (!safeName(name)) throw new Error(`"${name}" is not a valid npm package name.`);
  return cached(`npm:${name}`, async () => {
    const latest = await getJson(`https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`);
    if (latest.status !== 200) throw new Error(`npm has no package "${name}" (${latest.status}).`);
    const m = latest.body as {
      version: string; description?: string; keywords?: string[]; license?: string | { type?: string }; deprecated?: string;
      dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; scripts?: Record<string, string>;
      engines?: Record<string, string>; dist?: { unpackedSize?: number; integrity?: string };
    };
    const abbreviated = await getJson(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, { headers: { Accept: "application/vnd.npm.install-v1+json" } }, 20_000);
    const a = abbreviated.body as { modified?: string; versions?: Record<string, unknown> };
    // The real release date of the latest version (registry "modified" also
    // moves on metadata edits). Read from the full document when its history
    // is small enough to fetch cheaply; otherwise "modified" is the bound.
    let lastRelease = a.modified;
    let firstRelease: string | undefined;
    const versionCount = a.versions ? Object.keys(a.versions).length : 0;
    if (versionCount > 0 && versionCount <= 250) {
      try {
        const full = await getJson(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {}, 20_000);
        const time = (full.body as { time?: Record<string, string> }).time;
        if (time?.[m.version]) lastRelease = time[m.version];
        firstRelease = time?.created;
      } catch { /* keep "modified" */ }
    }
    const here = installedInfo(name);
    return {
      source: "npm",
      firstRelease,
      name,
      url: `https://www.npmjs.com/package/${name}`,
      description: m.description,
      keywords: m.keywords,
      license: typeof m.license === "string" ? m.license : m.license?.type,
      latestVersion: m.version,
      lastRelease,
      releaseCount: a.versions ? Object.keys(a.versions).length : undefined,
      deprecated: m.deprecated,
      dependencies: Object.keys(m.dependencies ?? {}),
      peerDependencies: Object.keys(m.peerDependencies ?? {}),
      scripts: m.scripts,
      engines: m.engines,
      unpackedSize: m.dist?.unpackedSize,
      integrity: m.dist?.integrity,
      vulnerabilities: await osvCount("npm", name, m.version),
      installed: Boolean(here),
      installedVersion: here?.version,
      installedDeclared: here ? Boolean(here.declared) : undefined,
    };
  });
}

async function pypiEvidence(name: string): Promise<ResourceEvidence> {
  if (!/^[\w.-]{1,100}$/.test(name)) throw new Error(`"${name}" is not a valid PyPI name.`);
  return cached(`pypi:${name}`, async () => {
    const { status, body } = await getJson(`https://pypi.org/pypi/${name}/json`);
    if (status !== 200) throw new Error(`PyPI has no project "${name}" (${status}).`);
    const d = body as { info: { version: string; summary?: string; license?: string; license_expression?: string; keywords?: string; requires_dist?: string[] | null; classifiers?: string[] }; releases?: Record<string, Array<{ upload_time_iso_8601?: string; size?: number }>> };
    const files = d.releases?.[d.info.version] ?? [];
    const classifierLicense = d.info.classifiers?.find((c) => c.startsWith("License :: OSI Approved ::"))?.split("::").pop()?.trim();
    const license = d.info.license_expression || (d.info.license && d.info.license.length < 40 ? d.info.license : undefined) || (classifierLicense === "MIT License" ? "MIT" : classifierLicense === "BSD License" ? "BSD-3-Clause" : classifierLicense?.startsWith("Apache") ? "Apache-2.0" : classifierLicense);
    return {
      source: "pypi",
      name,
      url: `https://pypi.org/project/${name}/`,
      description: d.info.summary,
      keywords: d.info.keywords?.split(/[,\s]+/).filter(Boolean),
      license,
      latestVersion: d.info.version,
      lastRelease: files[0]?.upload_time_iso_8601,
      releaseCount: d.releases ? Object.keys(d.releases).length : undefined,
      dependencies: (d.info.requires_dist ?? []).filter((r) => !/extra ==/.test(r)).map((r) => r.split(/[\s;<>=!~([]/)[0]),
      unpackedSize: files[0]?.size,
      vulnerabilities: await osvCount("PyPI", name, d.info.version),
    };
  });
}

async function githubEvidence(fullName: string): Promise<ResourceEvidence> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new Error(`"${fullName}" is not owner/repo.`);
  return cached(`gh:${fullName}`, async () => {
    const { status, body } = await getJson(`https://api.github.com/repos/${fullName}`);
    if (status !== 200) throw new Error(`GitHub repo ${fullName}: ${status}${status === 403 ? " (free unauthenticated rate limit — not bypassed)" : ""}`);
    const r = body as { description?: string; topics?: string[]; license?: { spdx_id?: string } | null; pushed_at?: string; created_at?: string; archived?: boolean; stargazers_count?: number; size?: number; html_url: string };
    return {
      source: "github", name: fullName, url: r.html_url, description: r.description ?? undefined, keywords: r.topics,
      license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : undefined,
      lastRelease: r.pushed_at, firstRelease: r.created_at, archived: r.archived, stars: r.stargazers_count,
      unpackedSize: typeof r.size === "number" ? r.size * 1024 : undefined,
    };
  });
}

export async function evidenceFor(source: string, name: string): Promise<ResourceEvidence> {
  if (source === "pypi") return pypiEvidence(name);
  if (source === "github") return githubEvidence(name);
  return npmEvidence(name);
}

/* ---------------------------------------------------------------- sandbox */

let netnsAvailable: boolean | null = null;
export function networkIsolationAvailable(): boolean {
  if (netnsAvailable === null) {
    try {
      const probe = spawnSync("unshare", ["-rn", "true"], { timeout: 5000 });
      netnsAvailable = probe.status === 0;
    } catch {
      netnsAvailable = false;
    }
  }
  return netnsAvailable;
}

/**
 * Disables network APIs in-process when no network namespace is available.
 *
 * Order matters: Node builds stdio streams and some modules (tls extends
 * net.Socket) lazily from `net`, so every stream and module is created
 * BEFORE any export is replaced. Replacing while importing crashed the
 * child at load ("Class extends value … is not a constructor") on every
 * host without `unshare -rn`, such as the GitHub Actions runners.
 */
const NETWORK_GUARD = `
const deny = () => { throw new Error("network disabled in the LÉLU sandbox"); };
void process.stdout; void process.stderr; void process.stdin;
const modules = [];
for (const m of ["node:net", "node:tls", "node:http", "node:https", "node:http2", "node:dgram", "node:dns", "node:dns/promises"]) modules.push(await import(m));
globalThis.fetch = deny; globalThis.WebSocket = undefined;
// dns.promises is an object, not a function: its resolvers are denied too.
const targets = modules.map((mod) => mod.default ?? {});
if (targets[6]?.promises) targets.push(targets[6].promises);
for (const target of targets) {
  for (const k of Object.keys(target)) { if (typeof target[k] === "function") { try { target[k] = deny; } catch {} } }
}
`;

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function run(executable: string, args: string[], options: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; ms: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (s: string, c: Buffer) => (s.length > MAX_OUTPUT ? s : s + c.toString("utf8"));
    child.stdout.on("data", (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr.on("data", (c: Buffer) => { stderr = cap(stderr, c); });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, options.timeoutMs);
    child.on("error", (error) => { stderr += String(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), timedOut, ms: Date.now() - started });
    });
  });
}

/**
 * The ONE install command the sandbox uses (exported so the security tests
 * run exactly it against a hostile package). Lifecycle scripts never run;
 * the user's ~/.npmrc (registry overrides, tokens) is replaced by an empty
 * one inside the sandbox; only proxy/CA plumbing is passed through.
 */
export async function sandboxInstall(spec: string, dir: string) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, npm_config_cache: path.join(dir, ".npm-cache"), npm_config_userconfig: path.join(dir, ".npmrc"), npm_config_registry: "https://registry.npmjs.org/", CI: "1" };
  for (const key of NETWORK_PLUMBING) if (process.env[key]) env[key] = process.env[key]!;
  return run("npm", ["install", spec, "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--no-package-lock", "--prefix", dir], { cwd: dir, env, timeoutMs: INSTALL_TIMEOUT_MS });
}

export interface SandboxResult {
  ok: boolean;
  id: string;
  package?: { name: string; version: string; integrity?: string; installedBytes?: number; installMs?: number };
  reuse?: string;
  isolation: { network: string; filesystem: string; memory: string; processes: string; environment: string; timeoutMs: number };
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  refused?: string;
}

/** Built-in escape probe: proves what the PoC process can NOT do. */
export const ESCAPE_PROBE = `
import fs from "node:fs";
const out = {};
try { fs.readFileSync("${ROOT.replace(/\\/g, "\\\\")}/package.json"); out.readProject = "ALLOWED"; } catch (e) { out.readProject = "denied:" + e.code; }
try { fs.readFileSync("/etc/passwd"); out.readSystem = "ALLOWED"; } catch (e) { out.readSystem = "denied:" + e.code; }
try { (await import("node:child_process")).execSync("id"); out.spawn = "ALLOWED"; } catch (e) { out.spawn = "denied:" + (e.code || e.message); }
out.secrets = Object.keys(process.env).filter((k) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k)).length;
try { await fetch("https://registry.npmjs.org/", { signal: AbortSignal.timeout(4000) }); out.network = "ALLOWED"; } catch (e) { out.network = "denied:" + (e.cause?.code || e.message); }
console.log(JSON.stringify(out));
`;

export async function runSandbox(input: { package?: string; version?: string; reuse?: string; code: string }): Promise<SandboxResult> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const dir = path.join(SANDBOX_ROOT, id);
  const netns = networkIsolationAvailable();
  const isolation = {
    network: netns ? "none — fresh network namespace" : "disabled by preload guard (no network namespace on this host)",
    filesystem: "read only inside the sandbox folder (plus a reused installed module); no writes anywhere",
    memory: "heap capped at 256 MB",
    processes: "child processes, workers and native addons denied (Node permission model)",
    environment: "empty: no API keys or tokens",
    timeoutMs: RUN_TIMEOUT_MS,
  };
  const base: SandboxResult = { ok: false, id, isolation, exitCode: null, timedOut: false, stdout: "", stderr: "", durationMs: 0 };
  if (typeof input.code !== "string" || !input.code.trim() || input.code.length > 20_000) return { ...base, refused: "code (1–20,000 chars) is required" };
  mkdirSync(path.join(dir, "out"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const readPaths = [dir];

  if (input.package) {
    const name = input.package;
    if (!safeName(name)) return { ...base, refused: `"${name}" is not a valid npm package name` };
    const evidence = await npmEvidence(name);
    const version = input.version && safeVersion(input.version) ? input.version : evidence.latestVersion ?? "latest";
    const evaluation = evaluateResource(evidence);
    if (evaluation.verdict === "blocked") {
      log({ action: "sandbox-refused", name, version, reasons: evaluation.reasons });
      return { ...base, refused: `not installed: ${evaluation.reasons.join("; ")}` };
    }
    if ((evidence.unpackedSize ?? 0) > MAX_SANDBOX_BYTES) return { ...base, refused: `too large for the sandbox (${evidence.unpackedSize} bytes)` };
    const install = await sandboxInstall(`${name}@${version}`, dir);
    rmSync(path.join(dir, ".npm-cache"), { recursive: true, force: true });
    if (install.code !== 0) {
      log({ action: "sandbox-install-failed", name, version });
      return { ...base, package: { name, version }, stderr: install.stderr.slice(-2000), refused: "install failed" };
    }
    const installedBytes = dirSize(path.join(dir, "node_modules"));
    if (installedBytes > MAX_SANDBOX_BYTES * 2) {
      rmSync(dir, { recursive: true, force: true });
      return { ...base, refused: `installed size ${installedBytes} bytes exceeds the sandbox limit` };
    }
    // The registry's integrity hash for exactly this version: npm verified the
    // tarball against it on install, and promotion pins it, so the package
    // integrated later is byte-for-byte the one that was tested here.
    const integrity = version === evidence.latestVersion ? evidence.integrity : undefined;
    base.package = { name, version, integrity, installedBytes, installMs: install.ms };
  }

  if (input.reuse) {
    // An already-installed module, linked read-only into the sandbox.
    const moduleName = input.reuse.startsWith("@") ? input.reuse.split("/").slice(0, 2).join("/") : input.reuse.split("/")[0];
    const source = path.join(ROOT, "node_modules", moduleName);
    if (!safeName(moduleName) || !existsSync(source)) return { ...base, refused: `"${moduleName}" is not installed` };
    mkdirSync(path.join(dir, "node_modules", path.dirname(moduleName)), { recursive: true });
    symlinkSync(source, path.join(dir, "node_modules", moduleName), "dir");
    readPaths.push(source);
    base.reuse = input.reuse;
  }

  writeFileSync(path.join(dir, "poc.mjs"), input.code);
  // No --allow-fs-write at all: a proof of concept reports on stdout, so it
  // cannot fill the disk. The heap is capped so it cannot exhaust memory.
  const nodeArgs = ["--permission", "--max-old-space-size=256", "--stack-size=4000", ...readPaths.map((p) => `--allow-fs-read=${p}`)];
  if (!netns) {
    writeFileSync(path.join(dir, "guard.mjs"), NETWORK_GUARD);
    nodeArgs.push("--import", path.join(dir, "guard.mjs"));
  }
  nodeArgs.push(path.join(dir, "poc.mjs"));
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, NODE_OPTIONS: "" };
  const result = netns
    ? await run("unshare", ["-rn", process.execPath.endsWith("bun") ? "node" : process.execPath, ...nodeArgs], { cwd: dir, env, timeoutMs: RUN_TIMEOUT_MS })
    : await run("node", nodeArgs, { cwd: dir, env, timeoutMs: RUN_TIMEOUT_MS });
  const outcome: SandboxResult = { ...base, ok: result.code === 0 && !result.timedOut, exitCode: result.code, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr.slice(-4000), durationMs: result.ms };
  log({ action: "sandbox-run", id, package: base.package, reuse: base.reuse, ok: outcome.ok, exitCode: result.code, network: isolation.network });
  if (outcome.ok) {
    mkdirSync(STATE, { recursive: true });
    writeFileSync(path.join(STATE, `verified-${id}.json`), JSON.stringify({ id, package: base.package, reuse: base.reuse, at: new Date().toISOString(), stdout: result.stdout.slice(0, 2000) }));
  }
  // The installed code is removed; only the record stays.
  rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
  return outcome;
}

/* ------------------------------------------------------------------ audit */

function lockDuplicates(): Record<string, string[]> {
  try {
    const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as { packages?: Record<string, { version?: string }> };
    const versions = new Map<string, Set<string>>();
    for (const [key, value] of Object.entries(lock.packages ?? {})) {
      const name = key.split("node_modules/").pop();
      if (!name || !value.version) continue;
      if (!versions.has(name)) versions.set(name, new Set());
      versions.get(name)!.add(value.version);
    }
    return Object.fromEntries([...versions].filter(([, v]) => v.size > 2).map(([k, v]) => [k, [...v]]));
  } catch {
    return {};
  }
}

async function auditDependencies(): Promise<{ facts: DependencyFact[]; findings: ReturnType<typeof analyzeDependencies>; checked: number; failed: string[] }> {
  const own = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const entries = Object.entries(own.dependencies ?? {});
  const facts: DependencyFact[] = [];
  const failed: string[] = [];
  for (let i = 0; i < entries.length; i += 6) {
    await Promise.all(entries.slice(i, i + 6).map(async ([name, declared]) => {
      try {
        const evidence = await npmEvidence(name);
        const here = installedInfo(name);
        facts.push({
          name, declared, installed: here?.version, latest: evidence.latestVersion, deprecated: evidence.deprecated,
          vulnerabilities: here?.version ? await osvCount("npm", name, here.version) : undefined,
          lastRelease: evidence.lastRelease, license: here?.license ?? evidence.license,
        });
      } catch {
        failed.push(name);
      }
    }));
  }
  const findings = analyzeDependencies(facts, lockDuplicates());
  log({ action: "audit", checked: facts.length, findings: findings.length });
  return { facts, findings, checked: facts.length, failed };
}

/* -------------------------------------------------------------------- api */

export function createResourceApi() {
  const json = (res: Res, payload: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  };
  const readBody = (req: Req) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let raw = "";
      if (!req.on) return resolve({});
      req.on("data", (c) => { raw += String(c); if (raw.length > 64_000) raw = raw.slice(0, 64_000); });
      req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
      req.on("error", () => resolve({}));
    });

  const handle = async (req: Req, res: Res, next: () => void) => {
    const url = (req.url ?? "").replace(/^\/api\/resources/, "").split("?")[0] || "/";
    const method = (req.method ?? "GET").toUpperCase();
    try {
      if (method === "GET" && (url === "/" || url === "/status")) {
        return json(res, {
          ok: true,
          sources: { npm: "public, no key", github: "public, no key — free-limited (unauthenticated search: 10/min)", gitlab: "public, no key", pypi: "public, no key (evaluate by name)", osv: "public vulnerability database, no key" },
          isolation: { networkNamespace: networkIsolationAvailable(), nodePermissionModel: true },
          spends: "nothing: every source is free and public",
        });
      }
      if (method === "GET" && url === "/capabilities") {
        return json(res, { ok: true, capabilities: capabilityLedger().list().map((r) => ({ ...r, active: isActive(r), stale: staleness(r) })) });
      }
      if (method !== "POST") return next();
      const body = await readBody(req);

      if (url === "/discover") {
        const query = String(body.query ?? "").trim().slice(0, 120);
        if (!query) return json(res, { ok: false, error: "query is required" }, 400);
        const limit = Math.max(1, Math.min(10, Number(body.limit ?? 5) || 5));
        const sources = Array.isArray(body.sources) && body.sources.length ? body.sources.map(String) : ["npm", "github", "gitlab"];
        const errors: Record<string, string> = {};
        let githubRemaining: string | undefined;
        const lists = await Promise.all(sources.map(async (source) => {
          try {
            return await cached(`d:${source}:${query}:${limit}`, async () => {
              if (source === "npm") return discoverNpm(query, limit);
              if (source === "gitlab") return discoverGitLab(query, limit);
              if (source === "github") { const r = await discoverGitHub(query, limit); githubRemaining = r.remaining; return r.items; }
              throw new Error("unknown source");
            });
          } catch (error) {
            errors[source] = error instanceof Error ? error.message : String(error);
            return [] as DiscoveredResource[];
          }
        }));
        // Relevance, deterministically: a result must mention the query's terms.
        const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
        const need = terms.length <= 2 ? terms.length : Math.ceil((terms.length * 2) / 3);
        const relevant = lists.flat().filter((r) => {
          const text = `${r.name} ${r.description ?? ""}`.toLowerCase();
          return terms.filter((t) => text.includes(t)).length >= need;
        });
        log({ action: "discover", query, sources, found: relevant.length, dropped: lists.flat().length - relevant.length });
        lifecycle(body.capability, "discovered", "resource-intelligence", { query, found: relevant.length, candidates: relevant.slice(0, 6).map((r) => `${r.source}:${r.name}`) });
        return json(res, { ok: true, query, results: relevant, droppedAsIrrelevant: lists.flat().length - relevant.length, errors, githubRateRemaining: githubRemaining, modelCalls: 0 });
      }

      if (url === "/evaluate") {
        const names = (Array.isArray(body.names) ? body.names : [body.name]).map(String).filter(Boolean).slice(0, 8);
        const source = String(body.source ?? "npm");
        if (!names.length) return json(res, { ok: false, error: "name is required" }, 400);
        const errors: Record<string, string> = {};
        const evaluations: ResourceEvaluation[] = [];
        await Promise.all(names.map(async (name) => {
          try { evaluations.push(evaluateResource(await evidenceFor(source, name))); } catch (error) { errors[name] = error instanceof Error ? error.message : String(error); }
        }));
        const ranked = rankEvaluations(evaluations);
        log({ action: "evaluate", source, names, verdicts: ranked.map((e) => `${e.name}:${e.verdict}`) });
        lifecycle(body.capability, "evaluated", "resource-intelligence", { verdicts: ranked.map((e) => `${e.name}@${e.version ?? "?"}:${e.verdict}:${e.license.spdx}:${e.classification.class}`) });
        return json(res, { ok: true, evaluations: ranked, summary: ranked.map(describeEvaluation), errors, modelCalls: 0 });
      }

      if (url === "/gap") {
        const request = String(body.request ?? "").slice(0, 2000);
        const tools = Array.isArray(body.tools) ? body.tools.map(String) : [];
        const report = detectCapabilityGaps(request, tools);
        const missing = report.missing.map((gap) => ({
          ...gap,
          reuseAvailable: gap.reuse.filter((spec) => existsSync(path.join(ROOT, "node_modules", spec))),
        }));
        return json(res, { ok: true, ...report, missing, modelCalls: 0 });
      }

      if (url === "/sandbox") {
        const probe = body.probe === true;
        lifecycle(body.capability, "sandbox-testing", "resource-intelligence", { package: body.package ?? null, reuse: body.reuse ?? null });
        const result = await runSandbox({
          package: body.package ? String(body.package) : undefined,
          version: body.version ? String(body.version) : undefined,
          reuse: body.reuse ? String(body.reuse) : undefined,
          code: probe ? ESCAPE_PROBE : String(body.code ?? ""),
        });
        lifecycle(body.capability, result.ok ? "sandbox-verified" : "evaluated", "resource-intelligence", {
          sandboxId: result.id, ok: result.ok, exitCode: result.exitCode, network: result.isolation.network, refused: result.refused ?? null, stdout: result.stdout.slice(0, 300),
        }, result.ok ? { sandboxId: result.id, source: result.package ? `${result.package.name}@${result.package.version}` : result.reuse ? `installed:${result.reuse}` : undefined } : undefined);
        return json(res, result, result.refused ? 422 : 200);
      }

      if (url === "/verified") {
        const id = String(body.sandboxId ?? "").replace(/[^\w-]/g, "");
        const file = path.join(STATE, `verified-${id}.json`);
        if (!id || !existsSync(file)) return json(res, { ok: false, error: "no passing sandbox run with that id" }, 404);
        return json(res, { ok: true, record: JSON.parse(readFileSync(file, "utf8")) });
      }

      if (url === "/capabilities") {
        const records = capabilityLedger().list().map((r) => ({ ...r, active: isActive(r), stale: staleness(r) }));
        return json(res, { ok: true, capabilities: records });
      }

      if (url === "/capabilities/propose") {
        const id = String(body.capability ?? "").trim().toLowerCase();
        const tools = (Array.isArray(body.tools) ? body.tools : [body.tool]).map(String).filter(Boolean);
        const sandboxId = String(body.sandboxId ?? "").replace(/[^\w-]/g, "");
        if (!tools.length) return json(res, { ok: false, code: "no_tool", error: "a capability must name the executable tool that provides it" }, 400);
        const existing = capabilityLedger().get(id);
        if (existing && (isActive(existing) || existing.state === "approved" || existing.state === "awaiting-approval")) {
          return json(res, { ok: true, duplicate: true, capability: existing, note: `"${id}" is already ${existing.state}; nothing was registered twice.` });
        }
        const owner = capabilityLedger().list().find((r) => r.id !== id && isActive(r) && r.tools.some((t) => tools.includes(t)) && r.name === String(body.name ?? r.name));
        if (owner) return json(res, { ok: true, duplicate: true, capability: owner, note: `"${owner.id}" already provides ${tools.join(", ")}.` });
        const verifiedFile = path.join(STATE, `verified-${sandboxId}.json`);
        if (!sandboxId || !existsSync(verifiedFile)) return json(res, { ok: false, code: "not_verified", error: "No passing sandbox run with that id: a capability is proposed only after its proof passed." }, 409);
        const verified = JSON.parse(readFileSync(verifiedFile, "utf8")) as { package?: { name: string; version: string }; reuse?: string; stdout?: string };
        if (verified.package) {
          const evaluation = evaluateResource(await npmEvidence(verified.package.name));
          if (evaluation.classification.class === "paid" && !spendPolicy().check(verified.package.name, {}, { peek: true }).allowed) {
            return json(res, { ok: false, code: "spend_not_authorized", error: `${verified.package.name} is paid: not proposed without your explicit spending authorization.` }, 402);
          }
          if (evaluation.verdict === "blocked") return json(res, { ok: false, code: "blocked", error: evaluation.reasons.join("; ") }, 409);
        }
        try {
          const init = {
            name: String(body.name ?? id).slice(0, 120), tools, sandboxId,
            source: verified.package ? `${verified.package.name}@${verified.package.version}` : verified.reuse ? `installed:${verified.reuse}` : String(body.source ?? "").slice(0, 160) || undefined,
            license: body.license ? String(body.license).slice(0, 40) : undefined,
          };
          // A first proposal may arrive without the earlier lifecycle reports.
          if (!existing) capabilityLedger().transition(id, "sandbox-verified", "resource-intelligence", { sandboxId, stdout: verified.stdout?.slice(0, 300) ?? "" }, init);
          const record = capabilityLedger().transition(id, "awaiting-approval", "resource-intelligence", { sandboxId, proposedBy: req.headers?.["x-lelu-tool-call"] ? "tool call" : "direct request" }, init);
          return json(res, { ok: true, capability: record, next: `Awaiting the user's approval: they say "approve capability ${id}".` });
        } catch (error) {
          const e = error as TransitionError;
          return json(res, { ok: false, code: e.code ?? "error", error: e.message }, e.status ?? 409);
        }
      }

      if (url === "/capabilities/register") {
        const id = String(body.capability ?? "").trim().toLowerCase();
        const record = capabilityLedger().get(id);
        if (!record) return json(res, { ok: false, code: "not_found", error: `No capability "${id}".` }, 404);
        if (isActive(record)) return json(res, { ok: true, duplicate: true, capability: record });
        if (record.state !== "approved") {
          log({ action: "register-refused", id, state: record.state });
          return json(res, { ok: false, code: "approval_required", error: `"${id}" is ${record.state}: registration needs the user's approval first.` }, 403);
        }
        const stale = staleness(record);
        if (stale.length) return json(res, { ok: false, code: "stale", error: `Not registered: ${stale.join("; ")}.` }, 409);
        return json(res, { ok: true, capability: capabilityLedger().transition(id, "registered", "resource-intelligence", { tools: record.tools }) });
      }

      if (url === "/capabilities/runtime-verified") {
        const id = String(body.capability ?? "").trim().toLowerCase();
        const record = capabilityLedger().get(id);
        if (!record || !isActive(record)) return json(res, { ok: false, code: "not_active", error: `"${id}" is not registered.` }, 409);
        return json(res, { ok: true, capability: capabilityLedger().transition(id, "runtime-verified", "runtime", { tool: String(body.tool ?? ""), result: String(body.result ?? "").slice(0, 300) }) });
      }

      if (url === "/capabilities/decision") {
        // HUMAN ONLY. The words must be the user's own (the composer or voice
        // capture sends them with x-lelu-user-consent); a tool call is marked
        // x-lelu-tool-call by the tool layer and is refused outright; another
        // website cannot drive this from a visitor's browser.
        const consent = String(req.headers?.["x-lelu-user-consent"] ?? "");
        const fetchSite = String(req.headers?.["sec-fetch-site"] ?? "");
        const refuse = (code: string, error: string) => {
          log({ action: "decision-refused", code, text: String(body.text ?? "").slice(0, 120) });
          return json(res, { ok: false, code, error }, 403);
        };
        if (req.headers?.["x-lelu-tool-call"]) return refuse("tool_call_cannot_decide", "A tool call cannot approve or revoke a capability.");
        if (fetchSite === "cross-site") return refuse("cross_site", "Cross-site requests cannot decide capabilities.");
        if (consent !== "typed" && consent !== "spoken") return refuse("user_words_required", "Approval and revocation come only from the user's own typed or spoken words.");
        const decision = parseCapabilityDecision(String(body.text ?? ""));
        if (!decision) return json(res, { ok: false, code: "no_decision", error: "No \"approve capability X\" or \"revoke capability X\" in the words." }, 400);
        const approver = process.env.LELU_ACCESS_PASSWORD ? "owner (access-gate session)" : "local operator (access gate off)";
        try {
          const record = decision.action === "approve"
            ? capabilityLedger().approve(decision.id, { approver, basis: process.env.LELU_ACCESS_PASSWORD ? "owner-session" : "local-runtime", consent })
            : capabilityLedger().revoke(decision.id, approver, String(body.text ?? "").slice(0, 200));
          return json(res, { ok: true, action: decision.action, capability: record });
        } catch (error) {
          const e = error as TransitionError;
          return json(res, { ok: false, code: e.code ?? "error", error: e.message }, e.status ?? 409);
        }
      }

      if (url === "/audit") return json(res, { ok: true, ...(await auditDependencies()), modelCalls: 0 });

      if (url === "/promote") {
        const name = String(body.package ?? "");
        const sandboxId = String(body.sandboxId ?? "");
        const consent = String(req.headers?.[CONSENT_HEADER] ?? "");
        const verifiedPath = path.join(STATE, `verified-${sandboxId.replace(/[^\w-]/g, "")}.json`);
        if (!existsSync(verifiedPath)) return json(res, { ok: false, code: "not_verified", error: "No passing sandbox run with that id: untrusted code does not enter production unverified." }, 409);
        const verified = JSON.parse(readFileSync(verifiedPath, "utf8")) as { package?: { name: string; version: string }; reuse?: string };
        if (verified.package && verified.package.name !== name) return json(res, { ok: false, code: "mismatch", error: "The sandbox run verified a different package." }, 409);
        if (verified.package) {
          const evaluation = evaluateResource(await npmEvidence(name));
          if (evaluation.verdict === "blocked") return json(res, { ok: false, code: "blocked", error: evaluation.reasons.join("; ") }, 409);
        }
        if (consent !== "typed" && consent !== "spoken") {
          log({ action: "promote-refused", name, sandboxId, reason: "no user approval" });
          return json(res, { ok: false, code: "approval_required", error: "Integration into production needs your explicit approval." }, 403);
        }
        const plan = verified.package
          ? { install: `npm install ${verified.package.name}@${verified.package.version} --save-exact --ignore-scripts`, integrity: (verified.package as { integrity?: string }).integrity ?? "not recorded (non-latest version)", rollback: "git revert the integration commit; package.json/package-lock.json restore the previous tree" }
          : { install: `no new dependency: reuse ${verified.reuse}`, rollback: "git revert the integration commit" };
        log({ action: "promote-approved", name, sandboxId, plan, consent });
        return json(res, { ok: true, plan, note: "Recorded for the engineering workspace, which applies it with its own approval, tests and rollback." });
      }
      return next();
    } catch (error) {
      return json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
    }
  };
  return {
    handle,
    attach: (m: { use: (p: string, h: (req: Req, res: Res, next: () => void) => void) => void }) =>
      m.use("/api/resources", (req, res, next) => { void handle(req, res, next); }),
  };
}
