/**
 * ==========================================================
 * LÉLU — REPOSITORY ACQUISITION RUNTIME (server side)
 *
 * The real filesystem/git half of LÉLU's acquisition workforce.
 * Every route below performs an actual operation: a repository is
 * cloned by git, a ZIP is decompressed, a command exits with a real
 * status, a commit has a real SHA. Nothing here reports an outcome
 * it did not observe.
 *
 * Layout on disk (never inside the tracked project):
 *
 *   .lelu-acquisitions/<acquisition-id>/
 *     repo/               the acquired tree (its own .git)
 *     acquisition.json    metadata: source, commit, license, versions
 *     exec-log.jsonl      append-only execution log
 *
 * SECURITY MODEL
 * --------------
 *  • Paths are resolved inside one acquisition and can never escape it.
 *  • Clone URLs are https-only, host-allowlisted, and credentials come
 *    from the server environment — never from the browser.
 *  • Git hooks are disabled (core.hooksPath=/dev/null) so cloned code
 *    cannot execute on checkout, commit or status.
 *  • Executions run with a SCRUBBED environment: no provider keys, no
 *    Supabase credentials, no GitHub token. A cloned build script has
 *    nothing to read even if it is hostile.
 *  • Dependency installation runs with lifecycle scripts DISABLED
 *    (`--ignore-scripts`), the usual vector for arbitrary code on
 *    install. Enabling them is a privileged, approved action.
 *  • Destructive and privileged operations need a single-use approval
 *    grant bound to the scope, the acquisition and the approver.
 *
 * Approvals are issued to a verified Supabase identity when the runtime
 * has Supabase configured (the same verification the engineering apply
 * boundary uses). A local development runtime with no identity provider
 * issues grants to "local-operator" and says so in the receipt; set
 * LELU_ACQUISITION_REQUIRE_IDENTITY=1 to refuse all such grants.
 * ==========================================================
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { identityConfigured, verifyRequestIdentity } from "./engineerIdentity.ts";
import {
  AcquisitionSingleFlight,
  findReusableAcquisition,
  normalizeRepositoryUrl,
} from "../src/core/acquisition/AcquisitionIdentity.ts";

/** One clone in flight per repository identity and ref, for the whole server. */
const cloneFlights = new AcquisitionSingleFlight();
import type {
  AcquisitionLicense,
  AcquisitionLogEntry,
  AcquisitionRecord,
  AcquisitionSource,
} from "../src/core/acquisition/AcquisitionTypes.ts";

/* ------------------------------------------------------------------ */
/* limits                                                              */
/* ------------------------------------------------------------------ */

export const ACQUISITION_DIR_NAME = ".lelu-acquisitions";
export const MAX_ACQUISITIONS = 24;
export const MAX_REPOSITORY_BYTES = 120 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
/** Total bytes across every acquisition: the managed workspace quota. */
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_READ_BYTES = 512 * 1024;
export const MAX_TREE_ENTRIES = 5000;
export const MAX_EXEC_OUTPUT_BYTES = 400_000;
export const MAX_TIMEOUT_MS = 600_000;
export const DEFAULT_TIMEOUT_MS = 180_000;
export const MAX_ARCHIVE_ENTRIES = 20_000;

const APPROVAL_TTL_MS = 10 * 60 * 1000;

/** Hosts a repository may be cloned from. Extend deliberately. */
const ALLOWED_CLONE_HOSTS = new Set(["github.com", "gitlab.com", "codeberg.org", "codeload.github.com"]);

/** Never walked, listed, read or diffed. */
const SKIPPED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".cache", ".venv", "__pycache__"]);

/** Files whose contents are credential material; reading is refused. */
const CREDENTIAL_FILE = /(^|\/)(\.env(\..+)?|\.npmrc|\.netrc|id_rsa|id_ed25519|credentials(\.json)?)$/i;

/** Executables a caller-supplied command may name (never a shell string). */
const ALLOWED_EXECUTABLES = new Set([
  "node", "npm", "npx", "bun", "bunx", "deno", "tsc", "vitest", "jest",
  "python3", "pytest", "go", "cargo", "make", "git", "ls", "cat", "head",
  "tail", "wc", "find", "grep", "jq", "unzip",
]);

/* ------------------------------------------------------------------ */
/* records                                                             */
/* ------------------------------------------------------------------ */

export interface AcquisitionAdapter {
  runtime: string;
  workspaceRoot: string;
  acquisitionsRoot: string;
  /**
   * Server-side GitHub credential, when the hosting process has one.
   * A getter rather than a value: Vite's config process holds .env in its
   * own object, and the token must never reach the browser bundle.
   */
  githubToken?: () => string;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on?: (event: "data" | "end" | "error", fn: (chunk?: unknown) => void) => void;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

/* ------------------------------------------------------------------ */
/* transport helpers                                                   */
/* ------------------------------------------------------------------ */

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: ConnectLikeReq): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (typeof req.on !== "function") {
      resolve({});
      return;
    }
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      const text = String(chunk ?? "");
      bytes += text.length;
      if (bytes > MAX_ARCHIVE_BYTES * 2) {
        reject(new Error("Request body exceeds the acquisition limit."));
        return;
      }
      body += text;
    });
    req.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function allowedOrigins(): string[] {
  if (typeof process === "undefined") return [];
  return (process.env.LELU_ENGINEER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function applyCors(req: ConnectLikeReq, res: ConnectLikeRes): void {
  const raw = req.headers?.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (typeof origin !== "string" || !origin) return;
  const allowed = allowedOrigins();
  if (!allowed.includes("*") && !allowed.includes(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-lelu-token, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
}

function isCrossOrigin(req: ConnectLikeReq): boolean {
  const raw = req.headers?.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (typeof origin !== "string" || !origin) return false;
  const allowed = allowedOrigins();
  if (allowed.includes("*") || allowed.includes(origin)) return false;
  const hostRaw = req.headers?.host;
  const host = Array.isArray(hostRaw) ? hostRaw[0] : hostRaw;
  if (typeof host !== "string" || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function tokenRequired(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.LELU_ENGINEER_TOKEN);
}

function hasValidToken(req: ConnectLikeReq): boolean {
  if (typeof process === "undefined") return false;
  const header = req.headers?.["x-lelu-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  return typeof provided === "string" && provided === process.env.LELU_ENGINEER_TOKEN;
}

/* ------------------------------------------------------------------ */
/* small utilities                                                     */
/* ------------------------------------------------------------------ */

function safeId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`Invalid acquisition id: ${JSON.stringify(value)}`);
  }
  return value;
}

function slug(value: string, max = 40): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "repo"
  );
}

/** Resolve a repository-relative path inside an acquisition, or throw. */
function resolveInside(root: string, target: string): string {
  const clean = String(target ?? ".").replace(/\\/g, "/");
  if (clean.split("/").some((part) => part === "..")) {
    throw new Error("Path escapes the acquisition.");
  }
  const absolute = path.resolve(root, clean);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("Path escapes the acquisition.");
  }
  return absolute;
}

function walk(root: string, base = "", out: string[] = []): string[] {
  if (out.length >= MAX_TREE_ENTRIES) return out;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = readdirSync(path.join(root, base), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_TREE_ENTRIES) break;
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, relative, out);
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

function treeSize(root: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (const relative of walk(root)) {
    files += 1;
    try {
      bytes += statSync(path.join(root, relative)).size;
    } catch {
      /* vanished mid-walk */
    }
  }
  return { bytes, files };
}

interface ProcessResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Run one executable with an argv array — never a shell string, so no
 * command substitution or redirection is possible from a caller.
 */
function runProcess(
  executable: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        shell: false,
        detached: process.platform !== "win32",
        env: options.env ?? scrubbedEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        ok: false,
        status: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const capture = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      return next.length > MAX_EXEC_OUTPUT_BYTES ? next.slice(next.length - MAX_EXEC_OUTPUT_BYTES) : next;
    };
    const finish = (result: Omit<ProcessResult, "durationMs">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started });
    };
    const timer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
      finish({
        ok: false,
        status: 124,
        stdout,
        stderr: `${stderr}\n[timed out after ${Math.round(options.timeoutMs / 1000)}s]`,
      });
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = capture(stderr, chunk);
    });
    child.on("error", (error) => {
      finish({ ok: false, status: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, status: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * The environment acquired code is allowed to see.
 *
 * PATH and a private HOME are enough for a toolchain to work; nothing
 * that could reach a provider, a database or this project's credentials
 * is passed through.
 */
function scrubbedEnv(home?: string): Record<string, string> {
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: process.env.LANG ?? "C.UTF-8",
    CI: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/true",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  if (home) {
    base.HOME = home;
    base.npm_config_cache = path.join(home, ".npm-cache");
    base.BUN_INSTALL_CACHE_DIR = path.join(home, ".bun-cache");
  }
  return base;
}

/** Git environment without any inherited credential helper or config. */
function gitEnv(home: string, token = ""): Record<string, string> {
  const env = scrubbedEnv(home);
  env.GIT_AUTHOR_NAME = "LELU Acquisition";
  env.GIT_AUTHOR_EMAIL = "acquisition@lelu.local";
  env.GIT_COMMITTER_NAME = "LELU Acquisition";
  env.GIT_COMMITTER_EMAIL = "acquisition@lelu.local";
  if (token) {
    // Delivered through the environment, never argv, so it cannot appear
    // in a process listing or the execution log.
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  return env;
}

function fingerprint(record: Omit<AcquisitionRecord, "fingerprint">): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

/* ------------------------------------------------------------------ */
/* license detection                                                   */
/* ------------------------------------------------------------------ */

const SPDX_PATTERNS: Array<[RegExp, string, string]> = [
  [/apache license\s*,?\s*version 2\.0/i, "Apache-2.0", "Apache License 2.0"],
  [/gnu affero general public license[\s\S]{0,80}version 3/i, "AGPL-3.0", "GNU Affero GPL v3"],
  [/gnu lesser general public license[\s\S]{0,80}version 3/i, "LGPL-3.0", "GNU LGPL v3"],
  [/gnu general public license[\s\S]{0,80}version 3/i, "GPL-3.0", "GNU GPL v3"],
  [/gnu general public license[\s\S]{0,80}version 2/i, "GPL-2.0", "GNU GPL v2"],
  [/mozilla public license[\s\S]{0,40}2\.0/i, "MPL-2.0", "Mozilla Public License 2.0"],
  [/mit license/i, "MIT", "MIT License"],
  [/redistribution and use in source and binary forms/i, "BSD-3-Clause", "BSD 3-Clause"],
  [/isc license/i, "ISC", "ISC License"],
  [/this is free and unencumbered software released into the public domain/i, "Unlicense", "The Unlicense"],
  [/creative commons attribution 4\.0/i, "CC-BY-4.0", "Creative Commons Attribution 4.0"],
];

const LICENSE_FILENAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING", "COPYING.md", "UNLICENSE"];

function detectLicense(root: string): AcquisitionLicense {
  let declared = "";
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { license?: unknown };
    if (typeof pkg.license === "string") declared = pkg.license;
  } catch {
    declared = "";
  }

  for (const name of LICENSE_FILENAMES) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    let text = "";
    try {
      text = readFileSync(file, "utf8").slice(0, 20_000);
    } catch {
      continue;
    }
    for (const [pattern, spdx, label] of SPDX_PATTERNS) {
      if (pattern.test(text)) {
        return {
          spdx,
          name: label,
          path: name,
          excerpt: text.replace(/\s+\n/g, "\n").trim().split("\n").slice(0, 12).join("\n"),
        };
      }
    }
    return {
      spdx: declared || "UNKNOWN",
      name: declared || "Unrecognised license text",
      path: name,
      excerpt: text.trim().split("\n").slice(0, 8).join("\n"),
    };
  }

  return {
    spdx: declared || "UNKNOWN",
    name: declared || "No license file",
    path: null,
    excerpt: declared ? `Declared in package.json: ${declared}` : "",
  };
}

/* ------------------------------------------------------------------ */
/* ZIP import                                                          */
/* ------------------------------------------------------------------ */

function sanitizeZipEntry(name: string): string {
  const forward = name.replace(/\\/g, "/");
  if (forward.startsWith("/") || /^[A-Za-z]:/.test(forward)) {
    throw new Error(`Unsafe archive entry: ${name}`);
  }
  const parts = forward.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error(`Unsafe archive entry: ${name}`);
  }
  return parts.join("/");
}

/** Decompress a ZIP archive (stored + deflate entries) into `dest`. */
export function extractZip(archive: Buffer, dest: string): { files: number; bytes: number } {
  let eocd = -1;
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 66_000); index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive: no end-of-central-directory record.");

  const count = archive.readUInt16LE(eocd + 10);
  if (count > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Archive holds ${count} entries; the limit is ${MAX_ARCHIVE_ENTRIES}.`);
  }
  let offset = archive.readUInt32LE(eocd + 16);
  let files = 0;
  let bytes = 0;

  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Corrupt ZIP: bad central directory entry.");
    }
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("ZIP64 archives are not supported; re-export as a standard ZIP.");
    }
    if (name.endsWith("/")) continue;
    const safe = sanitizeZipEntry(name);
    if (!safe) continue;

    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("Corrupt ZIP: bad local file header.");
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = archive.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      data = inflateRawSync(raw);
      if (data.length !== uncompressedSize) {
        throw new Error(`Corrupt ZIP entry ${name}: inflated size does not match.`);
      }
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
    }
    if (data.length > MAX_FILE_BYTES) {
      throw new Error(`Archive entry ${name} is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit.`);
    }
    bytes += data.length;
    if (bytes > MAX_ARCHIVE_BYTES) {
      throw new Error(`Archive expands beyond the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB limit.`);
    }
    const target = resolveInside(dest, safe);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
    files += 1;
  }

  if (files === 0) throw new Error("The archive contained no files.");
  return { files, bytes };
}

/* ------------------------------------------------------------------ */
/* the API                                                             */
/* ------------------------------------------------------------------ */

export function createAcquisitionApi(adapter: AcquisitionAdapter): {
  attach: (middlewares: { use: (mountPath: string, handler: Handler) => void }) => void;
} {
  const root = adapter.acquisitionsRoot;

  /** One server-side lookup order for the GitHub credential. */
  function githubToken(): string {
    try {
      const supplied = adapter.githubToken?.();
      if (supplied && supplied.trim()) return supplied.trim();
    } catch {
      /* a broken getter must not break acquisition */
    }
    return (
      process.env.LELU_ACQUISITION_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.GITHUB_READ_TOKEN ||
      ""
    );
  }

  /** scope|targetId -> single-use approval, bound to an approver. */
  const approvals = new Map<string, { nonce: string; issuedAt: number; approver: string }>();

  function dirOf(id: string): string {
    return resolveInside(root, safeId(id));
  }

  function repoOf(id: string): string {
    return path.join(dirOf(id), "repo");
  }

  function homeOf(id: string): string {
    const home = path.join(dirOf(id), ".home");
    mkdirSync(home, { recursive: true });
    return home;
  }

  function recordPath(id: string): string {
    return path.join(dirOf(id), "acquisition.json");
  }

  function readRecord(id: string): AcquisitionRecord {
    const file = recordPath(id);
    if (!existsSync(file)) throw new Error(`No acquisition "${id}".`);
    return JSON.parse(readFileSync(file, "utf8")) as AcquisitionRecord;
  }

  function writeRecord(record: Omit<AcquisitionRecord, "fingerprint">): AcquisitionRecord {
    const dir = dirOf(record.id);
    mkdirSync(dir, { recursive: true });
    const finished: AcquisitionRecord = { ...record, fingerprint: fingerprint(record) };
    writeFileSync(recordPath(record.id), JSON.stringify(finished, null, 2));
    syncIndex();
    return finished;
  }

  /**
   * A small durable index so a restart can list acquisitions without
   * trusting the directory walk alone. It is rebuilt from the real
   * records at every startup, never hand-edited.
   */
  function syncIndex(): void {
    try {
      const acquisitions = listRecords().map((record) => ({
        id: record.id,
        identifier: record.source.identifier,
        commit: record.commit,
        status: record.status,
        capability: record.capability,
        sizeBytes: record.sizeBytes,
        updatedAt: record.updatedAt,
      }));
      writeFileSync(
        path.join(root, "index.json"),
        JSON.stringify({ updatedAt: Date.now(), acquisitions }, null, 2),
      );
    } catch {
      /* the records themselves remain authoritative */
    }
  }

  function patchRecord(id: string, patch: Partial<AcquisitionRecord>): AcquisitionRecord {
    const current = readRecord(id);
    const { fingerprint: _ignored, ...rest } = current;
    void _ignored;
    const next = { ...rest, ...patch, updatedAt: Date.now() };
    return writeRecord(next);
  }

  function log(id: string, entry: AcquisitionLogEntry): void {
    try {
      const file = path.join(dirOf(id), "exec-log.jsonl");
      writeFileSync(file, `${JSON.stringify(entry)}\n`, { flag: "a" });
    } catch {
      /* a log write must not fail the operation it records */
    }
  }

  function listRecords(): AcquisitionRecord[] {
    if (!existsSync(root)) return [];
    const out: AcquisitionRecord[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        out.push(readRecord(entry.name));
      } catch {
        /* an unreadable acquisition is not listed as a working one */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Is this clone target acceptable? https only, allowlisted host. */
  function parseCloneUrl(raw: string): { url: string; host: string; identifier: string } {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`Not an absolute URL: ${raw}`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error("Only https clone URLs are accepted.");
    }
    if (!ALLOWED_CLONE_HOSTS.has(parsed.hostname)) {
      throw new Error(
        `Host "${parsed.hostname}" is not an allowed repository host (${[...ALLOWED_CLONE_HOSTS].join(", ")}).`,
      );
    }
    const identifier = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identifier)) {
      throw new Error(`Expected a repository path like owner/name, got "${identifier}".`);
    }
    return { url: `https://${parsed.hostname}/${identifier}.git`, host: parsed.hostname, identifier };
  }

  function consumeApproval(body: Record<string, unknown>, scope: string, targetId: string): string {
    const raw = body.approval;
    const nonce =
      typeof raw === "object" && raw !== null ? String((raw as Record<string, unknown>).nonce ?? "") : String(raw ?? "");
    if (!nonce) {
      throw new Error(
        `This action needs an approval grant for "${scope}". Call action "approve" first; ` +
          "destructive, privileged and external writes are never performed on request alone.",
      );
    }
    const held = approvals.get(`${scope}|${targetId}`);
    if (!held || held.nonce !== nonce) {
      throw new Error(`Approval grant is not valid for "${scope}" on "${targetId}".`);
    }
    approvals.delete(`${scope}|${targetId}`);
    if (Date.now() - held.issuedAt > APPROVAL_TTL_MS) {
      throw new Error("Approval grant expired before use.");
    }
    return held.approver;
  }

  async function issueApproval(
    req: ConnectLikeReq,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; nonce: string; approver: string; scope: string; targetId: string; basis: string }> {
    const scope = String(body.scope ?? "").trim();
    const targetId = String(body.targetId ?? "").trim();
    if (!["destructive", "privileged-command", "external-write", "credential-access", "canonical-write"].includes(scope)) {
      throw new Error(`Unknown approval scope "${scope}".`);
    }
    if (!/^[A-Za-z0-9_./-]{1,120}$/.test(targetId)) {
      throw new Error("An approval must name the acquisition (or target) it covers.");
    }

    const requireIdentity = process.env.LELU_ACQUISITION_REQUIRE_IDENTITY === "1";
    let approver = "";
    let basis = "";

    if (identityConfigured()) {
      const check = await verifyRequestIdentity(req);
      if (!check.ok || !check.identity) {
        throw new Error(`Approval refused: ${check.reason}`);
      }
      approver = check.identity.email ?? check.identity.userId;
      basis = "verified-supabase-session";
    } else if (hasValidToken(req)) {
      approver = "runtime-token-holder";
      basis = "runtime-access-token";
    } else if (requireIdentity) {
      throw new Error(
        "Approval refused: this runtime requires a verified identity " +
          "(LELU_ACQUISITION_REQUIRE_IDENTITY=1) and none is configured.",
      );
    } else {
      approver = "local-operator";
      basis = "local-development-runtime";
    }

    const nonce = `apr_${createHash("sha256")
      .update(`${scope}|${targetId}|${approver}|${Date.now()}|${Math.random()}`)
      .digest("hex")
      .slice(0, 32)}`;
    approvals.set(`${scope}|${targetId}`, { nonce, issuedAt: Date.now(), approver });
    return { ok: true, nonce, approver, scope, targetId, basis };
  }

  /** Create the record for an acquisition directory that now holds a repo. */
  function finalizeAcquisition(input: {
    id: string;
    name: string;
    source: AcquisitionSource;
    ref: string;
    commit: string;
    createdAt: number;
  }): AcquisitionRecord {
    const repo = repoOf(input.id);
    const measured = treeSize(repo);
    if (measured.bytes > MAX_REPOSITORY_BYTES) {
      rmSync(dirOf(input.id), { recursive: true, force: true });
      throw new Error(
        `Acquired tree is ${(measured.bytes / 1024 / 1024).toFixed(1)} MB; the limit is ` +
          `${MAX_REPOSITORY_BYTES / 1024 / 1024} MB. Nothing was kept.`,
      );
    }
    const license = detectLicense(repo);
    const alreadyUsed = listRecords().reduce((sum, record) => sum + record.sizeBytes, 0);
    if (alreadyUsed + measured.bytes > MAX_TOTAL_BYTES) {
      rmSync(dirOf(input.id), { recursive: true, force: true });
      throw new Error(
        `The acquisition workspace quota is ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)} MB; ` +
          `this repository would take it to ${((alreadyUsed + measured.bytes) / 1024 / 1024).toFixed(1)} MB. Nothing was kept.`,
      );
    }
    return writeRecord({
      id: input.id,
      name: input.name,
      source: input.source,
      ref: input.ref,
      commit: input.commit,
      license,
      sizeBytes: measured.bytes,
      fileCount: measured.files,
      createdAt: input.createdAt,
      updatedAt: Date.now(),
      status: "acquired",
      versions: input.commit
        ? [{ version: "v1", commit: input.commit, createdAt: Date.now(), note: "initial acquisition" }]
        : [],
      capability: null,
      notes: [],
    });
  }

  async function gitIn(id: string, args: string[], timeoutMs = 120_000) {
    return runProcess("git", args, {
      cwd: repoOf(id),
      timeoutMs,
      env: gitEnv(homeOf(id)),
    });
  }

  interface IntegrityFinding {
    id: string;
    identifier: string;
    status: "ok" | "missing-repo" | "missing-record" | "fingerprint-mismatch" | "commit-mismatch";
    detail: string;
  }

  /**
   * Durable acquisition maintenance: integrity verification, recovery of
   * interrupted acquisitions, and cleanup that can only ever remove
   * experimental work.
   */
  async function maintenance(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!existsSync(root)) return { ok: true, findings: [], recovered: [], removed: [], kept: [] };
    const operation = String(body.operation ?? "verify");

    if (operation === "cleanup") {
      const approver = consumeApproval(body, "destructive", "acquisition-maintenance");
      const rawPolicy = (body.policy ?? {}) as Record<string, unknown>;
      const maxAgeDays = Math.max(1, Math.min(3650, Number(rawPolicy.maxAgeDays ?? 30)));
      const keepRecent = Math.max(0, Math.min(MAX_ACQUISITIONS, Number(rawPolicy.keepRecent ?? 5)));
      const keepIntegrated = rawPolicy.keepIntegrated !== false;
      const records = [...listRecords()].sort((a, b) => b.createdAt - a.createdAt);
      const protectedIds = new Set<string>();
      records.forEach((record, index) => {
        if (index < keepRecent) protectedIds.add(record.id);
        if (keepIntegrated && record.status === "integrated") protectedIds.add(record.id);
      });
      const cutoff = Date.now() - maxAgeDays * 86_400_000;
      const removed: string[] = [];
      const kept: string[] = [];
      for (const record of records) {
        if (protectedIds.has(record.id) || record.createdAt > cutoff) {
          kept.push(record.id);
          continue;
        }
        rmSync(dirOf(record.id), { recursive: true, force: true });
        removed.push(record.id);
      }
      syncIndex();
      return { ok: true, findings: [], recovered: [], removed, kept, approver };
    }

    if (operation === "recover") {
      const recovered: string[] = [];
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(entry.name)) continue;
        const id = entry.name;
        if (existsSync(recordPath(id))) continue;
        const repo = repoOf(id);
        if (!existsSync(path.join(repo, ".git"))) continue;
        const head = await gitIn(id, ["rev-parse", "HEAD"]);
        const remote = await gitIn(id, ["remote", "get-url", "origin"]);
        const url = remote.stdout.trim() || `https://github.com/${id}`;
        let identifier = id;
        let host = "github.com";
        try {
          const parsed = parseCloneUrl(url);
          identifier = parsed.identifier;
          host = parsed.host;
        } catch {
          /* keep the directory name when the remote is unusable */
        }
        finalizeAcquisition({
          id,
          name: identifier.split("/").pop() ?? identifier,
          source: { kind: "github", identifier, url, host },
          ref: "",
          commit: head.ok ? head.stdout.trim() : "",
          createdAt: Date.now(),
        });
        patchRecord(id, { notes: ["Recovered after an interrupted run."] });
        recovered.push(id);
      }
      syncIndex();
      return { ok: true, findings: [], recovered, removed: [], kept: [] };
    }

    // verify
    const findings: IntegrityFinding[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const id = entry.name;
      if (!existsSync(recordPath(id))) {
        findings.push({ id, identifier: "?", status: "missing-record", detail: "The directory has no acquisition.json." });
        continue;
      }
      let record: AcquisitionRecord;
      try {
        record = readRecord(id);
      } catch (error) {
        findings.push({ id, identifier: "?", status: "missing-record", detail: String(error) });
        continue;
      }
      const repo = repoOf(id);
      if (!existsSync(repo)) {
        findings.push({ id, identifier: record.source.identifier, status: "missing-repo", detail: "repo/ is absent." });
        continue;
      }
      const { fingerprint: stored, ...rest } = record;
      if (fingerprint(rest) !== stored) {
        findings.push({
          id,
          identifier: record.source.identifier,
          status: "fingerprint-mismatch",
          detail: "The record body no longer matches its recorded fingerprint.",
        });
        continue;
      }
      if (record.status === "acquired" && record.commit) {
        const head = await gitIn(id, ["rev-parse", "HEAD"]);
        if (head.ok && head.stdout.trim() !== record.commit) {
          findings.push({
            id,
            identifier: record.source.identifier,
            status: "commit-mismatch",
            detail: `Recorded ${record.commit.slice(0, 10)}, repository HEAD is ${head.stdout.trim().slice(0, 10)}.`,
          });
          continue;
        }
      }
      findings.push({ id, identifier: record.source.identifier, status: "ok", detail: "Record, repo and fingerprint agree." });
    }
    return { ok: true, findings, recovered: [], removed: [], kept: [] };
  }

  async function cloneAcquisition(body: Record<string, unknown>): Promise<AcquisitionRecord> {
    const rawUrl =
      typeof body.url === "string" && body.url.trim()
        ? body.url.trim()
        : `https://github.com/${String(body.identifier ?? body.repository ?? "").trim()}`;
    // Normalize before the allow-list parse: `owner/name`, `www.`, `.git` and
    // ssh spellings all name the same repository, and the canonical https URL
    // is what the host allow-list is written against.
    const identity = normalizeRepositoryUrl(rawUrl);
    const target = parseCloneUrl(identity.url);

    // Idempotent: the same repository at the same ref is one acquisition,
    // whatever spelling of the URL arrived. The identity normalizer makes
    // `owner/name`, `.git`, `www.`, ssh and http all resolve to one record;
    // the single flight makes two concurrent requests share one clone instead
    // of both missing the reuse check and cloning twice.
    const ref = typeof body.ref === "string" ? body.ref.trim() : "";
    const flightKey = `${identity.host}/${identity.identifier}#${ref}`;
    // A lock directory is atomic across processes, so the guard still holds
    // when two requests are served by different workers.
    const lockDir = path.join(path.dirname(dirOf("locks")), ".locks", flightKey.replace(/[^A-Za-z0-9._-]+/g, "_"));
    mkdirSync(path.dirname(lockDir), { recursive: true });
    return cloneFlights.run(flightKey, async () => {
      let waited = 0;
      while (true) {
        try {
          mkdirSync(lockDir);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const running = findReusableAcquisition(listRecords(), identity, ref);
          if (running) {
            log(running.id, {
              at: Date.now(),
              action: "reuse",
              ok: true,
              detail: `reused ${identity.identifier}; another acquisition of it was already in flight`,
            });
            return running;
          }
          if (waited >= 300_000) {
            throw new Error(`Another acquisition of ${identity.identifier} is still running.`);
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
          waited += 250;
        }
      }
      try {
      const existing = findReusableAcquisition(listRecords(), identity, ref);
      if (existing) {
        log(existing.id, {
          at: Date.now(),
          action: "reuse",
          ok: true,
          detail: `reused the existing acquisition for ${identity.identifier} at ${existing.ref}; nothing was cloned again`,
        });
        return existing;
      }

      if (listRecords().length >= MAX_ACQUISITIONS) {
      throw new Error(`The acquisition limit (${MAX_ACQUISITIONS}) is reached. Delete one before acquiring another.`);
    }

    const id = `acq-${slug(target.identifier.split("/")[0], 20)}-${slug(target.identifier.split("/")[1] ?? "", 24)}-${Date.now()
      .toString(36)
      .slice(-5)}`;
    const dir = dirOf(id);
    const repo = repoOf(id);
    mkdirSync(dir, { recursive: true });

    const token = target.host === "github.com" ? githubToken() : "";

    const args = [
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--no-tags",
      "-c",
      "core.hooksPath=/dev/null",
      ...(ref ? ["--branch", ref] : []),
      target.url,
      repo,
    ];
    const clone = await runProcess("git", args, {
      cwd: dir,
      timeoutMs: 300_000,
      env: gitEnv(homeOf(id), token),
    });
    if (!clone.ok) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(`git clone failed (exit ${clone.status}): ${(clone.stderr || clone.stdout).slice(0, 1200)}`);
    }

    // Belt and braces: even with core.hooksPath pointing at /dev/null,
    // hooks shipped in the repository must not remain executable.
    rmSync(path.join(repo, ".git", "hooks"), { recursive: true, force: true });

    const commit = (await gitIn(id, ["rev-parse", "HEAD"])).stdout.trim();
    const branch = (await gitIn(id, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    const record = finalizeAcquisition({
      id,
      name: target.identifier,
      source: { kind: target.host === "github.com" ? "github" : "git", identifier: target.identifier, url: target.url, host: target.host },
      ref: ref || branch,
      commit,
      createdAt: Date.now(),
    });
    log(id, {
      at: Date.now(),
      action: "clone",
      ok: true,
      detail: `cloned ${target.identifier} at ${branch} (${commit.slice(0, 10)}), ${record.fileCount} files, license ${record.license.spdx}`,
      durationMs: clone.durationMs,
        exitCode: clone.status,
      });
      return record;
      } finally {
        rmSync(lockDir, { recursive: true, force: true });
      }
    });
  }

  async function importArchive(body: Record<string, unknown>): Promise<AcquisitionRecord> {
    const encoded = String(body.archiveBase64 ?? body.base64 ?? "");
    if (!encoded) throw new Error("archiveBase64 is required.");
    const name = String(body.name ?? "imported-archive").trim();
    const archive = Buffer.from(encoded.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (archive.length === 0) throw new Error("The supplied archive is empty.");
    if (archive.length > MAX_ARCHIVE_BYTES) {
      throw new Error(`Archive is ${(archive.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB.`);
    }
    if (listRecords().length >= MAX_ACQUISITIONS) {
      throw new Error(`The acquisition limit (${MAX_ACQUISITIONS}) is reached.`);
    }

    const id = `acq-${slug(name, 30)}-${Date.now().toString(36).slice(-5)}`;
    const dir = dirOf(id);
    const repo = repoOf(id);
    mkdirSync(repo, { recursive: true });
    const extracted = extractZip(archive, repo);

    // Version control from the first moment, so rollback and snapshots
    // work identically for imported archives and cloned repositories.
    const init = await runProcess("git", ["init", "-q"], { cwd: repo, timeoutMs: 30_000, env: gitEnv(homeOf(id)) });
    if (!init.ok) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(`git init failed for the imported archive: ${init.stderr}`);
    }
    await runProcess("git", ["config", "core.hooksPath", "/dev/null"], { cwd: repo, timeoutMs: 30_000, env: gitEnv(homeOf(id)) });
    await runProcess("git", ["add", "-A"], { cwd: repo, timeoutMs: 120_000, env: gitEnv(homeOf(id)) });
    const commitRun = await runProcess("git", ["commit", "-q", "-m", "acquisition: imported archive"], {
      cwd: repo,
      timeoutMs: 120_000,
      env: gitEnv(homeOf(id)),
    });
    const commit = (await gitIn(id, ["rev-parse", "HEAD"])).stdout.trim();
    const record = finalizeAcquisition({
      id,
      name,
      source: { kind: "archive", identifier: name, url: "", host: "" },
      ref: "archive",
      commit,
      createdAt: Date.now(),
    });
    log(id, {
      at: Date.now(),
      action: "import-archive",
      ok: true,
      detail: `imported ${extracted.files} files (${(extracted.bytes / 1024).toFixed(0)} KB), commit ${commit.slice(0, 10)}`,
      exitCode: commitRun.status,
    });
    return record;
  }

  const OPERATION_COMMANDS: Record<string, (repo: string) => { executable: string; args: string[] } | null> = {
    install: (repo) => {
      if (existsSync(path.join(repo, "bun.lock")) || existsSync(path.join(repo, "bun.lockb"))) {
        // --ignore-scripts: no lifecycle execution from acquired code.
        return { executable: "bun", args: ["install", "--ignore-scripts", "--no-progress"] };
      }
      if (existsSync(path.join(repo, "package-lock.json"))) {
        return { executable: "npm", args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"] };
      }
      if (existsSync(path.join(repo, "pnpm-lock.yaml"))) {
        return { executable: "npx", args: ["--yes", "pnpm", "install", "--ignore-scripts", "--frozen-lockfile"] };
      }
      if (existsSync(path.join(repo, "yarn.lock"))) {
        return { executable: "npx", args: ["--yes", "yarn", "install", "--ignore-scripts", "--frozen-lockfile"] };
      }
      if (existsSync(path.join(repo, "requirements.txt"))) {
        return { executable: "python3", args: ["-m", "pip", "install", "-r", "requirements.txt"] };
      }
      return null;
    },
    test: (repo) => testCommand(repo, "test"),
    build: (repo) => testCommand(repo, "build"),
    typecheck: (repo) => testCommand(repo, "typecheck") ?? fallbackTypecheck(repo),
  };

  function packageScripts(repo: string): Record<string, string> {
    try {
      const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      return pkg.scripts ?? {};
    } catch {
      return {};
    }
  }

  function testCommand(repo: string, script: string): { executable: string; args: string[] } | null {
    const scripts = packageScripts(repo);
    if (!scripts[script]) return null;
    return existsSync(path.join(repo, "bun.lock")) || existsSync(path.join(repo, "bun.lockb"))
      ? { executable: "bun", args: ["run", script] }
      : { executable: "npm", args: ["run", script, "--silent"] };
  }

  function fallbackTypecheck(repo: string): { executable: string; args: string[] } | null {
    if (!existsSync(path.join(repo, "tsconfig.json"))) return null;
    return { executable: "npx", args: ["--yes", "typescript", "tsc", "--noEmit"] };
  }

  function validCommandArg(arg: string): boolean {
    // No shell is used, but reject argument shapes that only make sense
    // as shell syntax — they signal an attempt to reach a shell.
    if (/[;&|`$><\n\r]/.test(arg)) return false;
    return arg.length <= 4000;
  }

  async function execute(
    id: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; stdout: string; stderr: string; durationMs: number; operation: string }> {
    const repo = repoOf(id);
    if (!existsSync(repo)) throw new Error(`Acquisition "${id}" has no repository tree.`);
    const timeoutMs = Math.max(
      1000,
      Math.min(MAX_TIMEOUT_MS, Number(body.timeoutMs ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    );
    const operation = String(body.operation ?? "command");

    let executable = "";
    let args: string[] = [];
    let label = operation;

    if (operation in OPERATION_COMMANDS) {
      const resolved = OPERATION_COMMANDS[operation](repo);
      if (!resolved) {
        const reason =
          operation === "install"
            ? "No supported dependency manifest (bun.lock, package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt) was found."
            : `This repository declares no "${operation}" script, so there is nothing to run.`;
        return { ok: false, status: 1, stdout: "", stderr: reason, durationMs: 0, operation };
      }
      executable = resolved.executable;
      args = resolved.args;
    } else if (operation === "command") {
      const argv = Array.isArray(body.argv) ? body.argv.map((entry) => String(entry)) : [];
      if (argv.length === 0) throw new Error("operation \"command\" requires argv (an executable and its arguments).");
      executable = argv[0];
      args = argv.slice(1);
      if (!ALLOWED_EXECUTABLES.has(executable)) {
        throw new Error(
          `"${executable}" is not on the acquisition execution allowlist. Allowed: ${[...ALLOWED_EXECUTABLES].join(", ")}.`,
        );
      }
      if (!args.every(validCommandArg)) {
        throw new Error("A command argument contains shell syntax, which is never executed here.");
      }
      // Arbitrary commands are privileged: they need an approval grant.
      consumeApproval(body, "privileged-command", id);
      label = `${executable} ${args.join(" ")}`.slice(0, 200);
    } else {
      throw new Error(`Unknown execution operation "${operation}".`);
    }

    const home = homeOf(id);
    const started = Date.now();
    const result = await runProcess(executable, args, { cwd: repo, timeoutMs, env: scrubbedEnv(home) });
    log(id, {
      at: Date.now(),
      action: `exec:${label}`,
      ok: result.ok,
      detail: `${result.stdout.slice(-1500)}${result.stderr ? `\n[stderr] ${result.stderr.slice(-1500)}` : ""}`.trim(),
      durationMs: result.durationMs,
      exitCode: result.status,
    });
    void started;
    return { ...result, operation };
  }

  async function handle(body: Record<string, unknown>, req: ConnectLikeReq): Promise<Record<string, unknown>> {
    const action = String(body.action ?? "").trim();

    switch (action) {
      case "status": {
        return {
          ok: true,
          runtime: adapter.runtime,
          workspaceRoot: adapter.workspaceRoot,
          acquisitions: listRecords().length,
          limits: {
            maxAcquisitions: MAX_ACQUISITIONS,
            maxRepositoryBytes: MAX_REPOSITORY_BYTES,
            maxArchiveBytes: MAX_ARCHIVE_BYTES,
            maxTotalBytes: MAX_TOTAL_BYTES,
            maxFileBytes: MAX_FILE_BYTES,
            maxTimeoutMs: MAX_TIMEOUT_MS,
          },
          identityVerification: identityConfigured(),
          tokenRequired: tokenRequired(),
          execLog: true,
          archiveImport: true,
          cloneHosts: [...ALLOWED_CLONE_HOSTS],
          githubProxy: true,
          githubCredentialConfigured: Boolean(githubToken()),
        };
      }
      case "list":
        return { ok: true, acquisitions: listRecords() };

      case "get":
        return { ok: true, acquisition: readRecord(safeId(body.id)) };

      case "clone":
        return { ok: true, acquisition: await cloneAcquisition(body) };

      case "import-archive":
        return { ok: true, acquisition: await importArchive(body) };

      case "tree": {
        const id = safeId(body.id);
        const repo = repoOf(id);
        const base = String(body.path ?? ".");
        const target = resolveInside(repo, base);
        if (!existsSync(target)) throw new Error(`No such path in acquisition "${id}": ${base}`);
        const relativeBase = path.relative(repo, target).split(path.sep).join("/");
        const entries = walk(repo, relativeBase === "." ? "" : relativeBase, []).map((relative) => {
          let size: number | undefined;
          try {
            size = statSync(path.join(repo, relative)).size;
          } catch {
            size = undefined;
          }
          return { path: relative, size };
        });
        return { ok: true, id, root: relativeBase, entries, truncated: entries.length >= MAX_TREE_ENTRIES };
      }

      case "read": {
        const id = safeId(body.id);
        const repo = repoOf(id);
        const relative = String(body.path ?? "");
        if (!relative) throw new Error("path is required.");
        if (CREDENTIAL_FILE.test(relative)) {
          throw new Error(
            `Refusing to read "${relative}": credential files inside an acquisition are never exposed to a model or a tool result.`,
          );
        }
        const target = resolveInside(repo, relative);
        if (!existsSync(target) || !statSync(target).isFile()) throw new Error(`No such file: ${relative}`);
        const size = statSync(target).size;
        if (size > MAX_FILE_BYTES) {
          throw new Error(`File is ${(size / 1024).toFixed(0)} KB; the read limit is ${MAX_FILE_BYTES / 1024} KB.`);
        }
        const bytes = readFileSync(target);
        if (bytes.includes(0)) throw new Error(`"${relative}" is binary; it cannot be read as text.`);
        const text = bytes.toString("utf8");
        const content = text.length > MAX_READ_BYTES ? `${text.slice(0, MAX_READ_BYTES)}\n…[truncated]` : text;
        return { ok: true, id, path: relative, bytes: size, content, truncated: text.length > MAX_READ_BYTES };
      }

      case "write": {
        const id = safeId(body.id);
        const repo = repoOf(id);
        const relative = String(body.path ?? "");
        const content = String(body.content ?? "");
        if (!relative) throw new Error("path is required.");
        if (CREDENTIAL_FILE.test(relative)) {
          throw new Error(`Refusing to write credential-shaped path "${relative}" inside an acquisition.`);
        }
        if (Buffer.byteLength(content) > MAX_FILE_BYTES) {
          throw new Error(`Content exceeds the ${MAX_FILE_BYTES / 1024} KB per-file limit.`);
        }
        const target = resolveInside(repo, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
        log(id, { at: Date.now(), action: "write", ok: true, detail: relative });
        return { ok: true, id, path: relative, bytes: Buffer.byteLength(content) };
      }

      case "exec":
        return { ok: true, id: safeId(body.id), result: await execute(safeId(body.id), body) };

      case "git": {
        const id = safeId(body.id);
        const sub = String(body.subaction ?? "status");
        if (sub === "status") {
          const result = await gitIn(id, ["status", "--porcelain=v1", "-b"]);
          return { ok: result.ok, status: result.status, output: result.stdout || result.stderr };
        }
        if (sub === "diff") {
          const result = await gitIn(id, ["diff", "--stat", "--no-color", ...(body.full ? [] : ["--"])]);
          const patch = body.full ? (await gitIn(id, ["diff", "--no-color"])).stdout : "";
          return { ok: result.ok, status: result.status, stat: result.stdout, patch: patch.slice(0, 200_000) };
        }
        if (sub === "log") {
          const count = Math.max(1, Math.min(100, Number(body.count ?? 10)));
          const result = await gitIn(id, ["log", `-${count}`, "--pretty=format:%H%x09%an%x09%ad%x09%s", "--date=iso"]);
          return { ok: result.ok, status: result.status, log: result.stdout };
        }
        if (sub === "branch") {
          const name = String(body.name ?? "");
          if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]{1,80}$/.test(name) || name.includes("..")) {
            throw new Error(`Invalid branch name: ${JSON.stringify(name)}`);
          }
          const result = await gitIn(id, ["checkout", "-b", name]);
          log(id, { at: Date.now(), action: "branch", ok: result.ok, detail: name, exitCode: result.status });
          return { ok: result.ok, status: result.status, output: result.stdout || result.stderr, branch: name };
        }
        if (sub === "checkout") {
          const name = String(body.name ?? "");
          if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]{1,80}$/.test(name) || name.includes("..")) {
            throw new Error(`Invalid branch or ref name: ${JSON.stringify(name)}`);
          }
          const result = await gitIn(id, ["checkout", name]);
          log(id, { at: Date.now(), action: "checkout", ok: result.ok, detail: name, exitCode: result.status });
          return { ok: result.ok, status: result.status, output: result.stdout || result.stderr };
        }
        if (sub === "commit") {
          const message = String(body.message ?? "").slice(0, 4000);
          if (!message.trim()) throw new Error("A commit message is required.");
          const approver = consumeApproval(body, "canonical-write", id);
          const branch = (await gitIn(id, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
          if (!branch || branch === "HEAD") {
            throw new Error("Refusing to commit on a detached HEAD; create a branch first.");
          }
          await gitIn(id, ["add", "-A"]);
          const result = await gitIn(id, ["commit", "-q", "--no-verify", "-m", message]);
          const commit = (await gitIn(id, ["rev-parse", "HEAD"])).stdout.trim();
          const record = readRecord(id);
          const version = `v${record.versions.length + 1}`;
          if (result.ok) {
            patchRecord(id, {
              commit,
              versions: [...record.versions, { version, commit, createdAt: Date.now(), note: message.slice(0, 200) }],
            });
          }
          log(id, {
            at: Date.now(),
            action: "commit",
            ok: result.ok,
            detail: `${branch} ${commit.slice(0, 10)} by ${approver}: ${message.slice(0, 200)}`,
            exitCode: result.status,
          });
          return {
            ok: result.ok,
            status: result.status,
            branch,
            commit,
            version: result.ok ? version : null,
            approver,
            output: result.stdout || result.stderr,
          };
        }
        if (sub === "snapshot") {
          const record = readRecord(id);
          const commit = (await gitIn(id, ["rev-parse", "HEAD"])).stdout.trim();
          const version = `v${record.versions.length + 1}`;
          const note = String(body.note ?? "snapshot");
          patchRecord(id, { versions: [...record.versions, { version, commit, createdAt: Date.now(), note }] });
          log(id, { at: Date.now(), action: "snapshot", ok: true, detail: `${version} ${commit.slice(0, 10)} ${note}` });
          return { ok: true, version, commit };
        }
        throw new Error(`Unknown git subaction "${sub}".`);
      }

      case "rollback": {
        const id = safeId(body.id);
        const version = String(body.version ?? "");
        const record = readRecord(id);
        const target = record.versions.find((entry) => entry.version === version || entry.commit.startsWith(version));
        if (!target) throw new Error(`No recorded version "${version}" for this acquisition.`);
        const approver = consumeApproval(body, "destructive", id);
        const result = await gitIn(id, ["reset", "--hard", target.commit]);
        log(id, {
          at: Date.now(),
          action: "rollback",
          ok: result.ok,
          detail: `to ${target.version} (${target.commit.slice(0, 10)}) by ${approver}`,
          exitCode: result.status,
        });
        return { ok: result.ok, status: result.status, version: target.version, commit: target.commit, approver };
      }

      case "update": {
        const id = safeId(body.id);
        const record = readRecord(id);
        const allowedStatus = ["acquired", "inspected", "researched", "adapted", "tested", "approved", "integrated", "failed", "rolled-back"];
        const status = body.status === undefined ? record.status : String(body.status);
        if (!allowedStatus.includes(status)) throw new Error(`Unknown acquisition status "${status}".`);
        const notes = Array.isArray(body.notes)
          ? [...record.notes, ...body.notes.map((note) => String(note).slice(0, 500))].slice(-100)
          : record.notes;
        return {
          ok: true,
          acquisition: patchRecord(id, {
            status,
            capability: body.capability === undefined ? record.capability : String(body.capability).slice(0, 120),
            notes,
          }),
        };
      }

      case "delete": {
        const id = safeId(body.id);
        readRecord(id);
        const approver = consumeApproval(body, "destructive", id);
        const dir = dirOf(id);
        rmSync(dir, { recursive: true, force: true });
        syncIndex();
        return { ok: true, id, approver };
      }

      case "selftest": {
        // LÉLU's own integration tests, run in the runtime's workspace with
        // a scrubbed environment. This is the evidence the pipeline requires
        // before registration; it is not a simulated pass.
        const result = await runProcess(
          "npx",
          [
            "tsx",
            "--test",
            "tests/engineering-command-center.test.ts",
            "tests/repository-acquisition.test.ts",
          ],
          { cwd: adapter.workspaceRoot, timeoutMs: 240_000, env: scrubbedEnv() },
        );
        return { ok: true, result: { ...result, operation: "selftest" } };
      }

      case "maintenance": {
        return await maintenance(body);
      }

      case "upstream": {
        const identifier = String(body.identifier ?? "").trim();
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identifier)) {
          throw new Error("upstream requires owner/repository.");
        }
        const result = await runProcess(
          "git",
          ["ls-remote", `https://github.com/${identifier}.git`, "HEAD"],
          { cwd: adapter.workspaceRoot, timeoutMs: 30_000, env: scrubbedEnv() },
        );
        if (!result.ok) throw new Error(`git ls-remote failed: ${(result.stderr || result.stdout).trim()}`);
        const commit = (result.stdout.trim().split(/\s+/)[0] ?? "").padEnd(40, " ").slice(0, 40).trim();
        if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("git ls-remote returned no usable commit.");
        return { ok: true, identifier, commit };
      }

      case "logs": {
        const id = safeId(body.id);
        const limit = Math.max(1, Math.min(500, Number(body.limit ?? 50)));
        const file = path.join(dirOf(id), "exec-log.jsonl");
        if (!existsSync(file)) return { ok: true, entries: [] };
        const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-limit);
        return {
          ok: true,
          entries: lines.flatMap((line) => {
            try {
              return [JSON.parse(line) as AcquisitionLogEntry];
            } catch {
              return [];
            }
          }),
        };
      }

      case "github": {
        // Server-side GitHub reads: metadata, search, trees and files.
        // The token lives in this process, so the browser (and any model
        // reading a tool result) never holds it. Only read paths are
        // forwarded, and only to api.github.com.
        const rawPath = String(body.path ?? "");
        if (rawPath.includes("#")) throw new Error("A GitHub proxy path may not carry a fragment.");
        const [pathname, queryString = ""] = rawPath.split("?");
        if (!/^\/(search\/repositories|repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.\/%-]*)?|rate_limit)$/.test(pathname)) {
          throw new Error(`Refusing to proxy GitHub path ${JSON.stringify(rawPath)}.`);
        }
        const upstreamPath = queryString ? `${pathname}?${queryString}` : pathname;
        const token = githubToken();
        let response: Response;
        try {
          response = await fetch(`https://api.github.com${upstreamPath}`, {
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "lelu-acquisition",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: AbortSignal.timeout(20_000),
          });
        } catch (error) {
          throw new Error(`GitHub was unreachable: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok) {
          let detail = "";
          try {
            detail = ((await response.json()) as { message?: string }).message ?? "";
          } catch {
            detail = "";
          }
          throw new Error(`GitHub API ${pathname} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.`);
        }
        return { ok: true, path: upstreamPath, data: await response.json() };
      }

      case "approve":
        return await issueApproval(req, body);

      default:
        throw new Error(`Unknown acquisition action "${action}".`);
    }
  }

  function handleRoute(): Handler {
    return (req, res, next): void => {
      const method = req.method ?? "GET";
      applyCors(req, res);
      if (method === "OPTIONS") {
        res.statusCode = 204;
        res.end("");
        return;
      }
      if (method !== "POST") {
        next();
        return;
      }
      if (isCrossOrigin(req)) {
        sendJson(res, { ok: false, error: "Cross-origin acquisition requests are not permitted." }, 403);
        return;
      }
      if (tokenRequired() && !hasValidToken(req)) {
        sendJson(res, { ok: false, error: "The acquisition runtime requires an access token (LELU_ENGINEER_TOKEN)." }, 401);
        return;
      }
      void (async () => {
        try {
          const body = await readJsonBody(req);
          const payload = await handle(body, req);
          sendJson(res, payload);
        } catch (error) {
          sendJson(
            res,
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            400,
          );
        }
      })();
    };
  }

  return {
    attach(middlewares): void {
      mkdirSync(root, { recursive: true });
      middlewares.use("/api/acquisition", handleRoute());
    },
  };
}
