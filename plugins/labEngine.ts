/**
 * ==========================================================
 * LÉLU — LABORATORY ENGINE
 *
 * The engineering environment itself: repository authority,
 * evidence-based discovery, isolated experiment worktrees,
 * verification, previews and genealogy.
 *
 * There is exactly ONE implementation, and two callers:
 *
 *   plugins/labApi.ts        the HTTP routes the interface uses
 *   scripts/lab-scheduler.ts the durable daily cycle, which runs
 *                            with no browser and no dev server
 *
 * That split is deliberate. A scheduler with its own copy of
 * discovery would be a second laboratory that can disagree with
 * the first — exactly what the mission forbids.
 *
 * Boundaries (unchanged from Mission 43):
 *   • no push, merge, rebase, reset or deploy exists here.
 *   • git runs through execFile with a fixed argv array; no shell.
 *   • paths resolve inside the project or .lelu-lab.
 *   • no secret is read: the only env read is the origin allowlist,
 *     which lives in the HTTP layer, not here.
 * ==========================================================
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const LAB_DIR = ".lelu-lab";
export const LAB_STATE_DIR = path.join(LAB_DIR, "state");
export const EXPERIMENT_DIR = path.join(LAB_DIR, "experiments");

const SYNC_FILE = path.join(LAB_STATE_DIR, "sync.json");
const DISCOVERY_FILE = path.join(LAB_STATE_DIR, "discoveries.json");
const EXPERIMENTS_FILE = path.join(LAB_STATE_DIR, "experiments.json");
const JOURNAL_FILE = path.join(LAB_STATE_DIR, "journal.jsonl");
const MAX_OUTPUT = 200_000;

/** Identity for experiment commits: this host has no configured git identity. */
const LAB_IDENTITY = ["-c", "user.name=LÉLU Laboratory", "-c", "user.email=lab@lelu.invalid"];

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,48}$/;
const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_@./-]+$/;

export function safeExperimentId(raw: unknown): string {
  const id = String(raw ?? "");
  if (!SAFE_ID.test(id)) throw new Error(`Invalid experiment id: ${JSON.stringify(id).slice(0, 60)}`);
  return id;
}

export function safeRelativePath(raw: unknown): string {
  const value = String(raw ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!value || value.length > 300 || !SAFE_RELATIVE.test(value)) {
    throw new Error(`Refusing path outside the project: ${JSON.stringify(value).slice(0, 120)}`);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* process helpers                                                     */
/* ------------------------------------------------------------------ */

export interface RunResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function run(command: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout, stderr) => {
        const status =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code?: number }).code ?? 1)
            : error
              ? 1
              : 0;
        resolve({
          ok: !error,
          status,
          stdout: String(stdout ?? "").slice(0, MAX_OUTPUT),
          stderr: String(stderr ?? "").slice(0, MAX_OUTPUT),
          durationMs: Date.now() - started,
        });
      },
    );
  });
}

export function git(args: string[], root: string, timeoutMs?: number): Promise<RunResult> {
  return run("git", args, root, timeoutMs);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function latestCommitSubject(root: string): Promise<string> {
  return git(["log", "-1", "--format=%s"], root).then((result) => result.stdout.trim());
}

/** Never leak a credential embedded in a remote URL. */
export function sanitizeRemote(url: string): string {
  return url.replace(/\/\/[^/@]*@/, "//").trim();
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export interface LabHead {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
}

export interface LabSyncRecord {
  at: number;
  ok: boolean;
  commit: string;
  branch: string;
  remoteHeads: string[];
  newCommits: number;
  error?: string;
}

export type FindingKind =
  | "new-commits"
  | "unfinished-work"
  | "duplicate-functionality"
  | "unverified-capability"
  | "broken-validation"
  | "stale-component"
  | "regression-risk";

export type FindingSeverity = "info" | "low" | "medium" | "high";

export interface LabFinding {
  id: string;
  kind: FindingKind;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence: string[];
  files: string[];
}

export interface LabResearchNote {
  kind: "repository" | "external";
  question: string;
  sources: string[];
  conclusion: string;
}

/**
 * The seven questions an improvement must answer before it is worth doing.
 * Recorded with the discovery, so a later reader can see the reasoning rather
 * than only the conclusion.
 */
export interface ImprovementRationale {
  what: string;
  evidence: string;
  whyItMatters: string;
  alternatives: string[];
  research: string;
  smallestCorrection: string;
  successMeasure: string;
}

export interface LabDiscovery {
  id: string;
  at: number;
  repository: string;
  branch: string;
  commit: string;
  fingerprint: string;
  filesInspected: string[];
  findings: LabFinding[];
  research: LabResearchNote[];
  recommendedAction: string;
  priority: { score: number; severity: FindingSeverity; reach: number; rationale: string };
  status: "open" | "already-known" | "promoted" | "dismissed" | "resolved";
  supersedes?: string;
  /** The mission's seven questions, answered from this discovery only. */
  rationale?: ImprovementRationale;
  /** Discovery id of the previous inspection with the same fingerprint. */
  previous?: string;
  /** Recorded when a later inspection no longer reports the finding set. */
  resolvedBy?: string;
}

export interface LabPreview {
  port: number;
  pid: number;
  startedAt: number;
  url: string;
}

export interface LabExperiment {
  id: string;
  branch: string;
  root: string;
  createdAt: number;
  baseCommit: string;
  baseBranch: string;
  baselineCommit?: string;
  overlaidFiles: string[];
  preview: LabPreview | null;
  /** The finding this experiment exists to address, when it was opened from one. */
  discoveryId?: string;
  findingId?: string;
  /** Why the change is being made, in the words of whoever authorized it. */
  reason?: string;
  /** Final status, written when the experiment is concluded. */
  status?: "open" | "verified" | "abandoned";
  /** Verification runs, newest last. */
  verifications?: Array<{ at: number; command: string; ok: boolean; status: number; durationMs: number }>;
  /** The experiment's own commit, once made. */
  commit?: { sha: string; at: number; message: string } | null;
  /** Paths the overlay could not carry; the experiment differs from HEAD for them. */
  notCarried?: string[];
}

export interface LabDiffFile {
  path: string;
  addedLines: number;
  removedLines: number;
  status: string;
  patch: string;
}

export interface LabDiff {
  branch: string;
  baseCommit: string;
  files: LabDiffFile[];
  stat: string;
  head: string;
}

export interface LabCommandSpec {
  id: string;
  label: string;
  command: string;
  args: string[];
  timeoutMs: number;
}

export const LAB_COMMANDS: Record<string, LabCommandSpec> = {
  typecheck: {
    id: "typecheck",
    label: "Typecheck (tsc -b --force)",
    command: "npx",
    args: ["tsc", "-b", "--force"],
    timeoutMs: 300_000,
  },
  syntax: {
    id: "syntax",
    label: "Syntax check (scripts/syntax-check.mjs)",
    command: "node",
    args: ["scripts/syntax-check.mjs"],
    timeoutMs: 180_000,
  },
  tests: {
    id: "tests",
    label: "Full suite (npm test)",
    command: "npm",
    args: ["test"],
    timeoutMs: 900_000,
  },
  build: {
    id: "build",
    label: "Production build (npm run build)",
    command: "npm",
    args: ["run", "build"],
    timeoutMs: 600_000,
  },
};

/* ------------------------------------------------------------------ */
/* discovery helpers                                                   */
/* ------------------------------------------------------------------ */

interface CapabilityClaim {
  id: string;
  sources: string[];
  tests: string[];
}

/**
 * Read the capability table from the real source file.
 *
 * Parsing the declaration rather than importing it keeps this module usable
 * from a plain Node process (the scheduler) without pulling the client bundle
 * in, and means the check always describes the file as it is on disk.
 */
export function parseCapabilityEvidence(root: string): CapabilityClaim[] {
  const file = path.join(root, "src/core/selfdev/CapabilityEvidence.ts");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const start = text.indexOf("CAPABILITY_EVIDENCE");
  if (start === -1) return [];
  const claims: CapabilityClaim[] = [];
  const blocks = text.slice(start).split(/\n  \{\n/).slice(1);
  for (const block of blocks) {
    const id = /id:\s*"([^"]+)"/.exec(block)?.[1];
    if (!id) continue;
    const sources = [...block.matchAll(/"(src\/[^"]+)"/g)].map((match) => match[1]);
    const tests = [...block.matchAll(/"(tests\/[^"]+)"/g)].map((match) => match[1]);
    claims.push({ id, sources: [...new Set(sources)], tests: [...new Set(tests)] });
  }
  return claims;
}

export function walk(dir: string, root: string, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 6000) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === LAB_DIR || name === "dist") continue;
    const absolute = path.join(dir, name);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(absolute, root, out, depth + 1);
    else out.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
}

function findDuplicateModules(files: string[], root: string): Array<{ symbol: string; files: string[] }> {
  const bySymbol = new Map<string, string[]>();
  for (const file of files) {
    if (!/^src\/.*\.tsx?$/.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    const match = /export (?:default )?(?:class|function|const) ([A-Za-z0-9_]+)/.exec(text.slice(0, 4000));
    if (!match) continue;
    const list = bySymbol.get(match[1]) ?? [];
    list.push(file);
    bySymbol.set(match[1], list);
  }
  return [...bySymbol.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([symbol, list]) => ({ symbol, files: list }))
    .sort((a, b) => b.files.length - a.files.length);
}

function countPattern(files: string[], root: string, pattern: RegExp): Array<{ file: string; count: number }> {
  const hits: Array<{ file: string; count: number }> = [];
  for (const file of files) {
    if (!/\.(ts|tsx|mjs|js)$/.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    const count = [...text.matchAll(pattern)].length;
    if (count > 0) hits.push({ file, count });
  }
  return hits.sort((a, b) => b.count - a.count);
}

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = { info: 4, low: 10, medium: 22, high: 40 };

export function priorityOf(findings: LabFinding[]): LabDiscovery["priority"] {
  const weight = findings.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0);
  const reach = new Set(findings.flatMap((finding) => finding.files)).size;
  const score = Math.min(100, weight + Math.min(20, reach));
  const severity: FindingSeverity = findings.some((f) => f.severity === "high")
    ? "high"
    : findings.some((f) => f.severity === "medium")
      ? "medium"
      : findings.some((f) => f.severity === "low")
        ? "low"
        : "info";
  return {
    score,
    severity,
    reach,
    rationale: `${findings.length} finding(s); weighted severity ${weight} + ${Math.min(20, reach)} reach = ${score}/100.`,
  };
}

/** The stable identity of an opportunity: the same finding set never proposes twice. */
export function fingerprintOf(findings: LabFinding[], repository: string, branch: string): string {
  return sha1(findings.map((finding) => finding.id).sort().join("|") + `|${repository}|${branch}`);
}

/**
 * Answer the seven questions from the findings themselves.
 *
 * This is not a narrative written for the user: every field is derived from
 * what the inspection measured, and says so. Where an answer cannot be derived
 * from evidence the text says that rather than inventing a rationale.
 */
export function rationaleFor(findings: LabFinding[], filesInspected: string[]): ImprovementRationale {
  const ranked = [...findings].sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]);
  const top = ranked[0];
  if (!top) {
    return {
      what: "Nothing in this inspection is wrong or incomplete.",
      evidence: `No finding was raised across ${filesInspected.length} inspected file(s).`,
      whyItMatters: "A day without a defect is a valid outcome; proposing work would be inventing it.",
      alternatives: ["Re-inspect after the next commit."],
      research: "Repository inspection only.",
      smallestCorrection: "None.",
      successMeasure: "The next inspection reports the same clean result.",
    };
  }
  const sameKind = findings.filter((finding) => finding.kind === top.kind);
  return {
    what: top.title,
    evidence: top.evidence.slice(0, 4).join(" · "),
    whyItMatters:
      top.severity === "high"
        ? "This class of defect makes the checks that verify other work unreliable, so it is fixed first."
        : `It is the highest-severity finding in this inspection (${top.severity}).`,
    alternatives: [
      "Leave it and work on a lower-severity finding.",
      "Fix it in the canonical tree without an experiment.",
      "Fix it in an isolated worktree and verify there first.",
    ],
    research: `Repository evidence only: ${top.files.slice(0, 4).join(", ") || "no file named"}. No external source was consulted.`,
    smallestCorrection: `Change only what ${sameKind.length === 1 ? "this finding names" : "these findings share"}: ${top.files.slice(0, 3).join(", ") || "see evidence"}.`,
    successMeasure: `Re-run the inspection: “${top.id}” must no longer be reported, and the declared checks must still pass.`,
  };
}

/* ------------------------------------------------------------------ */
/* the engine                                                          */
/* ------------------------------------------------------------------ */

export interface LabStatusPayload {
  repository: {
    remote: string;
    fullName: string;
    branch: string;
    head: LabHead;
    dirty: number;
    dirtyFiles: string[];
    branches: number;
    branchList: string[];
    ahead: number;
    behind: number;
  };
  github: { reachable: boolean; heads: number; checkedAt: number; error?: string };
  sync: LabSyncRecord | null;
  discoveries: LabDiscovery[];
  experiments: LabExperiment[];
  worktrees: Array<{ path: string; head: string; branch: string }>;
  commands: Array<{ id: string; label: string }>;
  boundaries: Record<string, unknown>;
}

export interface LabEngine {
  root: string;
  status(): Promise<LabStatusPayload>;
  sync(): Promise<{ sync: LabSyncRecord; fetch: { ok: boolean; output: string } }>;
  inspect(): Promise<LabDiscovery>;
  discoveries(): LabDiscovery[];
  journal(limit?: number): Array<Record<string, unknown>>;
  appendJournal(entry: Record<string, unknown>): void;
  tree(relative?: string): Array<{ name: string; path: string; type: "file" | "dir"; size?: number }>;
  file(relative: string): { path: string; content: string; lines: number; bytes: number };
  search(query: string): Array<{ path: string; line: number; text: string }>;
  commits(limit?: number): Promise<Array<{ sha: string; short: string; date: string; author: string; subject: string; files: string[] }>>;
  evidence(): Array<{ path: string; name: string; bytes: number }>;
  worktrees(): Promise<Array<{ path: string; head: string; branch: string }>>;
  genealogy(relative: string): Promise<{
    path: string;
    exists: boolean;
    origin: { commit: string; author: string; date: string; subject: string } | null;
    history: Array<{ commit: string; date: string; author: string; subject: string }>;
    contributors: Array<{ author: string; commits: number }>;
    branches: string[];
    lineCount: number;
    lastChange: { commit: string; date: string; author: string; subject: string } | null;
  }>;
  experiments: {
    list(): LabExperiment[];
    create(options?: { id?: string; discoveryId?: string; findingId?: string; reason?: string }): Promise<LabExperiment>;
    remove(id: string): Promise<void>;
    read(id: string, relative: string): { path: string; content: string | null };
    write(id: string, relative: string, content: string): { path: string; chars: number };
    patch(id: string, relative: string, find: string, replace: string): { path: string; before: number; after: number };
    diff(id: string): Promise<LabDiff>;
    command(id: string, command: string): Promise<{
      ok: boolean;
      command: string;
      label: string;
      status: number;
      durationMs: number;
      stdout: string;
      stderr: string;
      error?: string;
    }>;
    commit(id: string, message: string): Promise<{
      ok: boolean;
      commit: string | null;
      branch: string;
      files: string[];
      show: string;
      output: string;
      error?: string;
    }>;
    previewStart(id: string, port?: number): Promise<LabPreview>;
    previewStop(id: string): void;
    screenshot(id: string, viewport: { width: number; height: number }, label: string): Promise<{ ok: boolean; file?: string; error?: string }>;
    conclude(id: string, status: "verified" | "abandoned", note?: string): LabExperiment;
  };
}

export function createLabEngine(rootInput: string): LabEngine {
  const root = path.resolve(rootInput);
  const experimentsRoot = path.join(root, EXPERIMENT_DIR);

  /* ------------------------------ authority ----------------------------- */

  async function headInfo(): Promise<LabHead> {
    const [sha, subject, author, date] = await Promise.all([
      git(["rev-parse", "HEAD"], root),
      git(["log", "-1", "--format=%s"], root),
      git(["log", "-1", "--format=%an"], root),
      git(["log", "-1", "--format=%cI"], root),
    ]);
    const full = sha.stdout.trim();
    return {
      sha: full,
      shortSha: full.slice(0, 7),
      subject: subject.stdout.trim(),
      author: author.stdout.trim(),
      date: date.stdout.trim(),
    };
  }

  async function remoteUrl(): Promise<string> {
    const result = await git(["remote", "get-url", "origin"], root);
    return sanitizeRemote(result.stdout.trim());
  }

  /**
   * Uncommitted paths.
   *
   * The laboratory's own state directory is excluded even when a project has
   * not ignored it: `sync` writes there, so counting it would report the
   * laboratory's own heartbeat as the user's unfinished work — and, worse,
   * would make the next inspection scan nothing but `.lelu-lab/`.
   */
  async function dirtyFiles(): Promise<string[]> {
    const result = await git(["status", "--porcelain=v1"], root);
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter((file) => file !== LAB_DIR && !file.startsWith(`${LAB_DIR}/`));
  }

  async function branchList(): Promise<string[]> {
    const result = await git(["branch", "-a", "--format=%(refname:short)"], root);
    return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  async function githubReachable(): Promise<{ reachable: boolean; heads: string[]; error?: string }> {
    const result = await git(["ls-remote", "--heads", "origin"], root, 45_000);
    if (!result.ok) {
      return { reachable: false, heads: [], error: (result.stderr || result.stdout).trim().slice(0, 400) };
    }
    return {
      reachable: true,
      heads: result.stdout.split("\n").filter(Boolean).map((line) => line.replace(/\s+/g, " ").trim()),
    };
  }

  async function worktrees(): Promise<Array<{ path: string; head: string; branch: string }>> {
    const result = await git(["worktree", "list", "--porcelain"], root, 30_000);
    const out: Array<{ path: string; head: string; branch: string }> = [];
    let current: { path: string; head: string; branch: string } | null = null;
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current) out.push(current);
        current = { path: line.slice(9), head: "", branch: "" };
      } else if (line.startsWith("HEAD ") && current) {
        current.head = line.slice(5, 12);
      } else if (line.startsWith("branch ") && current) {
        current.branch = line.slice(7).replace("refs/heads/", "");
      }
    }
    if (current) out.push(current);
    return out;
  }

  function loadSync(): LabSyncRecord | null {
    return readJson<LabSyncRecord | null>(path.join(root, SYNC_FILE), null);
  }

  function loadDiscoveries(): LabDiscovery[] {
    return readJson<LabDiscovery[]>(path.join(root, DISCOVERY_FILE), []);
  }

  function appendJournal(entry: Record<string, unknown>): void {
    mkdirSync(path.join(root, LAB_STATE_DIR), { recursive: true });
    try {
      const file = path.join(root, JOURNAL_FILE);
      const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
      const lines = existing.split("\n").filter(Boolean).slice(-600);
      lines.push(JSON.stringify(entry));
      writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
    } catch {
      /* journal is best-effort; the operation already happened */
    }
  }

  function journal(limit = 120): Array<Record<string, unknown>> {
    const file = path.join(root, JOURNAL_FILE);
    const raw = existsSync(file) ? readFileSync(file, "utf8") : "";
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .slice(-limit)
      .reverse();
  }

  async function status(): Promise<LabStatusPayload> {
    const [head, branch, remote, dirty, branches, remoteState] = await Promise.all([
      headInfo(),
      git(["rev-parse", "--abbrev-ref", "HEAD"], root).then((result) => result.stdout.trim()),
      remoteUrl(),
      dirtyFiles(),
      branchList(),
      githubReachable(),
    ]);
    const porcelain = await git(["status", "--porcelain=v1", "--branch"], root);
    const aheadBehind = /\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/.exec(porcelain.stdout.split("\n")[0] ?? "");
    return {
      repository: {
        remote,
        fullName: /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)?.[1] ?? "",
        branch,
        head,
        dirty: dirty.length,
        dirtyFiles: dirty.slice(0, 60),
        branches: branches.length,
        branchList: branches.slice(0, 80),
        ahead: Number(aheadBehind?.[1] ?? 0),
        behind: Number(aheadBehind?.[2] ?? 0),
      },
      github: {
        reachable: remoteState.reachable,
        heads: remoteState.heads.length,
        checkedAt: Date.now(),
        ...(remoteState.error ? { error: remoteState.error } : {}),
      },
      sync: loadSync(),
      discoveries: loadDiscoveries().slice(0, 30),
      experiments: listExperiments(),
      worktrees: await worktrees(),
      commands: Object.values(LAB_COMMANDS).map((spec) => ({ id: spec.id, label: spec.label })),
      boundaries: {
        pushes: false,
        merges: false,
        defaultBranchWrites: false,
        productionDeploy: false,
        experimentRoot: EXPERIMENT_DIR,
      },
    };
  }

  async function sync(): Promise<{ sync: LabSyncRecord; fetch: { ok: boolean; output: string } }> {
    const fetched = await git(["fetch", "--prune", "origin"], root, 120_000);
    const remote = await githubReachable();
    const head = await headInfo();
    const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], root)).stdout.trim();
    const previous = loadSync();
    const range = previous?.commit ? await git(["rev-list", "--count", `${previous.commit}..HEAD`], root) : null;
    const record: LabSyncRecord = {
      at: Date.now(),
      ok: remote.reachable,
      commit: head.sha,
      branch,
      remoteHeads: remote.heads.map((line) => line.split(" ")[1] ?? line).slice(0, 400),
      newCommits: Number(range?.stdout.trim() ?? 0) || 0,
      ...(remote.reachable ? {} : { error: remote.error ?? fetched.stderr.slice(0, 300) }),
    };
    writeJson(path.join(root, SYNC_FILE), record);
    appendJournal({ at: record.at, kind: "sync", ok: record.ok, commit: record.commit, heads: record.remoteHeads.length });
    return { sync: record, fetch: { ok: fetched.ok, output: (fetched.stderr || fetched.stdout).slice(0, 1200) } };
  }

  /* ------------------------------ discovery ----------------------------- */

  async function inspect(): Promise<LabDiscovery> {
    const [head, branch, repository, dirty] = await Promise.all([
      headInfo(),
      git(["rev-parse", "--abbrev-ref", "HEAD"], root).then((result) => result.stdout.trim()),
      remoteUrl(),
      dirtyFiles(),
    ]);

    const previous = loadSync();
    const remote = await githubReachable();
    const findings: LabFinding[] = [];
    const filesInspected = new Set<string>();

    let newCommits: string[] = [];
    if (previous?.commit && previous.commit !== head.sha) {
      const range = await git(["log", "--format=%h %s", `${previous.commit}..HEAD`], root);
      newCommits = range.stdout.split("\n").filter(Boolean);
      const changed = await git(["diff", "--name-only", `${previous.commit}..HEAD`], root);
      changed.stdout.split("\n").filter(Boolean).forEach((file) => filesInspected.add(file));
      if (newCommits.length > 0) {
        findings.push({
          id: "new-commits",
          kind: "new-commits",
          severity: "info",
          title: `${newCommits.length} new commit(s) since the last inspection`,
          detail: `Repository moved from ${previous.commit.slice(0, 7)} to ${head.shortSha}; ${filesInspected.size} file(s) changed.`,
          evidence: newCommits.slice(0, 12),
          files: [...filesInspected].slice(0, 40),
        });
      }
    }

    if (dirty.length > 0) {
      dirty.slice(0, 40).forEach((file) => filesInspected.add(file));
      findings.push({
        id: "dirty-tree",
        kind: "unfinished-work",
        severity: "low",
        title: `${dirty.length} uncommitted path(s) in the working tree`,
        detail:
          "Work that exists on disk but not in any commit: it is not yet part of the repository's history and cannot be verified from a clone.",
        evidence: dirty.slice(0, 25),
        files: dirty.slice(0, 40),
      });
    }

    const claims = parseCapabilityEvidence(root);
    const missing: Array<{ capability: string; path: string }> = [];
    for (const claim of claims) {
      for (const source of claim.sources) {
        if (!existsSync(path.join(root, source))) missing.push({ capability: claim.id, path: source });
      }
    }
    if (missing.length > 0) {
      findings.push({
        id: "capability-missing-source",
        kind: "unverified-capability",
        severity: "high",
        title: `${missing.length} capability claim(s) name a source file that does not exist`,
        detail:
          "CapabilityEvidence is what turns a status into an assessment. A claim whose implementation path is gone describes code that is no longer there.",
        evidence: missing.map((entry) => `${entry.capability}: ${entry.path}`),
        files: [...new Set(missing.map((entry) => entry.path))],
      });
    }
    const unverified = claims.filter((claim) => claim.tests.length === 0);
    if (unverified.length > 0) {
      findings.push({
        id: "capability-no-tests",
        kind: "unverified-capability",
        severity: "medium",
        title: `${unverified.length} capability claim(s) name no verifying test`,
        detail: "A capability with implementation but no named check is unverified — it must not be reported as working.",
        evidence: unverified.map((claim) => claim.id),
        files: [],
      });
    }

    const brokenValidation: string[] = [];
    for (const spec of Object.values(LAB_COMMANDS)) {
      const which = await run("sh", ["-c", `command -v ${spec.command}`], root, 10_000);
      if (!which.ok || !which.stdout.trim()) {
        brokenValidation.push(`${spec.id}: “${spec.command}” is not on PATH (${spec.args.join(" ")})`);
      }
    }
    const engineerOps = path.join(root, "plugins/engineerApi.ts");
    if (existsSync(engineerOps)) {
      const text = readFileSync(engineerOps, "utf8");
      const declared = [...text.matchAll(/(\w+):\s*"(bun [^"]+)"/g)].map((match) => `${match[1]} → ${match[2]}`);
      if (declared.length > 0) {
        const bun = await run("sh", ["-c", "command -v bun"], root, 10_000);
        if (!bun.ok || !bun.stdout.trim()) {
          brokenValidation.push(
            ...declared.map(
              (entry) => `plugins/engineerApi.ts ENGINEER_OPERATIONS ${entry} — “bun” is not installed, so the operation exits 127`,
            ),
          );
        }
      }
    }
    if (brokenValidation.length > 0) {
      findings.push({
        id: "validation-unrunnable",
        kind: "broken-validation",
        severity: "high",
        title: `${brokenValidation.length} validation command(s) cannot execute in this runtime`,
        detail:
          "These are the checks that decide whether an improvement is verified. If they cannot run, every verification result from them is a failure that looks like a verdict.",
        evidence: brokenValidation,
        files: ["plugins/engineerApi.ts"],
      });
    }

    const allFiles: string[] = [];
    walk(root, root, allFiles);
    const duplicates = findDuplicateModules(allFiles, root).filter((entry) => entry.files.length >= 2);
    const significant = duplicates.filter((entry) => !["index", "types", "constants"].includes(entry.symbol.toLowerCase()));
    if (significant.length > 0) {
      findings.push({
        id: "duplicate-modules",
        kind: "duplicate-functionality",
        severity: "low",
        title: `${significant.length} exported symbol(s) are declared in more than one module`,
        detail:
          "Two modules exporting the same symbol name is not proof of duplication, but it is where divergence starts — one copy gets fixed and the other does not.",
        evidence: significant.slice(0, 12).map((entry) => `${entry.symbol}: ${entry.files.join(", ")}`),
        files: significant.flatMap((entry) => entry.files).slice(0, 30),
      });
    }

    const scanned = filesInspected.size > 0 ? [...filesInspected] : allFiles.filter((file) => file.startsWith("src/"));
    const markers = countPattern(scanned, root, /\b(TODO|FIXME|XXX|not implemented|placeholder)\b/gi);
    if (markers.length > 0) {
      findings.push({
        id: "unfinished-markers",
        kind: "unfinished-work",
        severity: "low",
        title: `${markers.reduce((sum, hit) => sum + hit.count, 0)} unfinished marker(s) across ${markers.length} file(s)`,
        detail: "Markers left in source are unfinished implementations, not documentation.",
        evidence: markers.slice(0, 12).map((hit) => `${hit.file}: ${hit.count}`),
        files: markers.slice(0, 20).map((hit) => hit.file),
      });
    }

    const stale: string[] = [];
    for (const file of allFiles.filter((candidate) => /^src\/.*\.tsx?$/.test(candidate))) {
      try {
        const stat = statSync(path.join(root, file));
        if (stat.size > 60_000) stale.push(`${file} — ${Math.round(stat.size / 1024)} KB`);
      } catch {
        /* ignore */
      }
    }
    if (stale.length > 0) {
      findings.push({
        id: "large-modules",
        kind: "stale-component",
        severity: "low",
        title: `${stale.length} source module(s) exceed 60 KB`,
        detail: "Large single modules concentrate unrelated responsibilities and are where regressions hide.",
        evidence: stale.slice(0, 15),
        files: stale.map((entry) => entry.split(" — ")[0]).slice(0, 20),
      });
    }

    const research: LabResearchNote[] = [];
    const top = [...findings].sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity])[0];
    if (top) {
      research.push({
        kind: "repository",
        question: `What in this tree already governs “${top.title}”?`,
        sources: allFiles.filter((file) => /^src\/core\/selfdev\/|^plugins\//.test(file)).slice(0, 12),
        conclusion:
          "The laboratory restricts itself to what it can prove from the tree: the files above are the modules that own validation and self-assessment. No external claim is made here.",
      });
    }

    const fingerprint = fingerprintOf(findings, repository, branch);
    const history = loadDiscoveries();
    const known = history.find((entry) => entry.fingerprint === fingerprint);

    /*
     * Resolution reconciliation, not assumption: an earlier discovery counts as
     * resolved only when a later inspection no longer raises its findings. A
     * passing build proves nothing about a discovery — the inspection is the
     * instrument that found it, so the inspection is what must stop finding it.
     */
    const reconciled = history.map((entry) => {
      const stillPresent = findings.some((finding) => finding.id === entry.findings?.find((f) => f.severity === "high")?.id);
      if (entry.status === "resolved") return entry;
      const previousHigh = (entry.findings ?? []).filter((finding) => finding.severity === "high");
      if (previousHigh.length === 0) return entry;
      const gone = previousHigh.filter((finding) => !findings.some((current) => current.id === finding.id));
      if (gone.length === 0 || stillPresent) return entry;
      return { ...entry, status: "resolved" as const, resolvedBy: `Inspection ${head.shortSha} no longer reports: ${gone.map((f) => f.id).join(", ")}` };
    });

    const discovery: LabDiscovery = {
      id: `disc-${Date.now().toString(36)}-${fingerprint.slice(0, 6)}`,
      at: Date.now(),
      repository,
      branch,
      commit: head.sha,
      fingerprint,
      filesInspected: [...filesInspected].slice(0, 120),
      findings,
      research,
      recommendedAction: recommend(findings),
      priority: priorityOf(findings),
      status: known ? "already-known" : "open",
      rationale: rationaleFor(findings, [...filesInspected]),
      ...(known ? { previous: known.id } : {}),
    };

    writeJson(path.join(root, DISCOVERY_FILE), [discovery, ...reconciled].slice(0, 80));
    writeJson(path.join(root, SYNC_FILE), {
      at: Date.now(),
      ok: remote.reachable,
      commit: head.sha,
      branch,
      remoteHeads: remote.heads.map((line) => line.split(" ")[1] ?? line).slice(0, 400),
      newCommits: newCommits.length,
      ...(remote.error ? { error: remote.error } : {}),
    } satisfies LabSyncRecord);
    appendJournal({
      at: discovery.at,
      kind: "discovery",
      id: discovery.id,
      fingerprint,
      findings: findings.length,
      priority: discovery.priority.score,
      status: discovery.status,
    });

    return discovery;
  }

  function recommend(findings: LabFinding[]): string {
    const high = findings.filter((finding) => finding.severity === "high");
    if (high.length > 0) {
      return `Investigate “${high[0].title}” first — it is the only class of finding that makes verification itself unreliable.`;
    }
    const medium = findings.filter((finding) => finding.severity === "medium");
    if (medium.length > 0) return `Close the verification gap: ${medium[0].title}.`;
    return "No high-severity opportunity. Record the finding and keep the tree as it is; a day without a change is a valid outcome.";
  }

  /* ---------------------------- experiments ----------------------------- */

  function listExperiments(): LabExperiment[] {
    return readJson<LabExperiment[]>(path.join(root, EXPERIMENTS_FILE), []).filter((experiment) =>
      existsSync(path.join(root, experiment.root)),
    );
  }

  function saveExperiments(experiments: LabExperiment[]): void {
    writeJson(path.join(root, EXPERIMENTS_FILE), experiments);
  }

  function patchExperiment(id: string, patch: Partial<LabExperiment>): LabExperiment {
    const experiments = listExperiments();
    const index = experiments.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw new Error(`No experiment ${JSON.stringify(id)}.`);
    experiments[index] = { ...experiments[index], ...patch };
    saveExperiments(experiments);
    return experiments[index];
  }

  function findExperiment(id: string): LabExperiment {
    const experiment = listExperiments().find((candidate) => candidate.id === id);
    if (!experiment) throw new Error(`No experiment ${JSON.stringify(id)}.`);
    return experiment;
  }

  function experimentIndex(id: string): LabExperiment {
    return findExperiment(safeExperimentId(id));
  }

  /** Resolve a path inside an experiment, refusing anything that escapes it. */
  function withinExperiment(experiment: LabExperiment, relative: string): string {
    const absolute = path.resolve(path.join(root, experiment.root, relative));
    const boundary = path.resolve(path.join(root, experiment.root));
    if (!absolute.startsWith(boundary)) throw new Error("Path escapes the experiment.");
    return absolute;
  }

  async function createExperiment(options: {
    id?: string;
    discoveryId?: string;
    findingId?: string;
    reason?: string;
  } = {}): Promise<LabExperiment> {
    const baseBranch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], root)).stdout.trim();
    const base = await headInfo();
    const id = options.id && SAFE_ID.test(options.id) ? options.id : `exp-${Date.now().toString(36)}`;
    const dir = path.join(experimentsRoot, id);
    if (existsSync(dir)) throw new Error(`Experiment ${id} already exists.`);
    mkdirSync(experimentsRoot, { recursive: true });

    const added = await git(["worktree", "add", "--detach", dir, "HEAD"], root, 180_000);
    if (!added.ok) throw new Error(`git worktree add failed: ${added.stderr || added.stdout}`);

    /*
     * Carry the canonical UNCOMMITTED work into the copy: the experiment must
     * start from what is actually running, not from the last commit.
     *
     * `git status` reports an untracked DIRECTORY as one entry (`?? src/x/y/`),
     * and copying that path fails silently — which is exactly how three
     * experiments in Mission 44 inherited a tree where half the laboratory's
     * own modules were missing, and every one of them failed to typecheck.
     * `git ls-files --others` lists the files themselves, so the overlay is
     * built from files and nothing is skipped for being inside a directory.
     */
    const overlaySources = new Set<string>();
    const untracked = await git(["ls-files", "--others", "--exclude-standard"], root, 60_000);
    untracked.stdout.split("\n").filter(Boolean).forEach((file) => overlaySources.add(file));
    const trackedChanges = await git(["diff", "--name-only", "HEAD"], root, 60_000);
    trackedChanges.stdout.split("\n").filter(Boolean).forEach((file) => overlaySources.add(file));

    const overlaid: string[] = [];
    const notCarried: string[] = [];
    for (const relative of overlaySources) {
      if (!SAFE_RELATIVE.test(relative) || relative.startsWith(`${LAB_DIR}/`)) continue;
      const from = path.join(root, relative);
      const to = path.join(dir, relative);
      try {
        if (!existsSync(from) || statSync(from).isDirectory()) continue;
        mkdirSync(path.dirname(to), { recursive: true });
        writeFileSync(to, readFileSync(from));
        overlaid.push(relative);
      } catch {
        notCarried.push(relative);
      }
    }
    if (notCarried.length > 0) {
      appendJournal({ at: Date.now(), kind: "experiment-overlay-incomplete", id, notCarried: notCarried.slice(0, 40) });
    }

    const branch = `lelu-lab/${id}`;
    const checkedOut = await git(["checkout", "-B", branch], dir, 60_000);
    if (!checkedOut.ok) throw new Error(`git checkout -B ${branch} failed: ${checkedOut.stderr}`);

    /*
     * A baseline commit, so the experiment's diff means what a reviewer
     * expects: ONLY what the experiment itself changed.
     */
    await git(["add", "--all"], dir, 60_000);
    const baseline = await git(
      [
        ...LAB_IDENTITY,
        "commit",
        "--allow-empty",
        "-m",
        `LÉLU lab baseline: ${base.shortSha}${overlaid.length ? ` + ${overlaid.length} uncommitted path(s)` : ""}\n\nThe experiment starts from what was running, so its diff shows only its own change.`,
      ],
      dir,
      60_000,
    );
    if (!baseline.ok) {
      throw new Error(`Baseline commit failed, so the experiment's diff would be meaningless: ${baseline.stderr || baseline.stdout}`);
    }

    const modules = path.join(root, "node_modules");
    const link = path.join(dir, "node_modules");
    if (existsSync(modules) && !existsSync(link)) {
      try {
        symlinkSync(modules, link, "dir");
      } catch {
        /* the experiment still holds source; commands report the missing deps */
      }
    }

    const experiment: LabExperiment = {
      id,
      branch,
      root: path.join(EXPERIMENT_DIR, id),
      createdAt: Date.now(),
      /* Reported, not hidden: an overlay that could not carry a path is a
         difference between the experiment and the running tree. */
      ...(notCarried.length > 0 ? { notCarried: notCarried.slice(0, 40) } : {}),
      baseCommit: base.sha,
      baseBranch,
      baselineCommit: (await git(["rev-parse", "HEAD"], dir)).stdout.trim(),
      overlaidFiles: overlaid,
      preview: null,
      status: "open",
      verifications: [],
      commit: null,
      ...(options.discoveryId ? { discoveryId: options.discoveryId } : {}),
      ...(options.findingId ? { findingId: options.findingId } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
    saveExperiments([...listExperiments(), experiment]);
    appendJournal({
      at: experiment.createdAt,
      kind: "experiment-created",
      id,
      branch,
      baseCommit: base.sha,
      overlaid: overlaid.length,
      ...(options.discoveryId ? { discoveryId: options.discoveryId } : {}),
    });
    return experiment;
  }

  function stopPreview(id: string): void {
    const experiments = listExperiments();
    const experiment = experiments.find((candidate) => candidate.id === id);
    if (!experiment?.preview) return;
    try {
      process.kill(experiment.preview.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    experiment.preview = null;
    saveExperiments(experiments);
    appendJournal({ at: Date.now(), kind: "preview-stopped", id });
  }

  async function removeExperiment(id: string): Promise<void> {
    const experiment = findExperiment(id);
    if (experiment.preview) stopPreview(id);
    // An abandoned experiment keeps its branch and record: discarding a failed
    // attempt silently is how the same dead end gets walked twice.
    await git(["worktree", "remove", "--force", experiment.root], root, 120_000);
    if (existsSync(path.join(root, experiment.root))) {
      rmSync(path.join(root, experiment.root), { recursive: true, force: true });
    }
    if (experiment.branch.startsWith("lelu-lab/") && !experiment.commit) {
      await git(["branch", "-D", experiment.branch], root, 30_000);
    }
    saveExperiments(listExperiments().filter((candidate) => candidate.id !== id));
    appendJournal({ at: Date.now(), kind: "experiment-removed", id, branch: experiment.branch, keptBranch: Boolean(experiment.commit) });
  }

  function countLines(file: string): number {
    try {
      return readFileSync(file, "utf8").split("\n").length;
    } catch {
      return 0;
    }
  }

  function untrackedPatch(file: string, relative: string): string {
    try {
      const lines = readFileSync(file, "utf8").split("\n").slice(0, 400);
      return [`--- /dev/null`, `+++ b/${relative}`, ...lines.map((line) => `+${line}`)].join("\n");
    } catch {
      return `+++ b/${relative}\n+ (unreadable)`;
    }
  }

  async function experimentDiff(id: string): Promise<LabDiff> {
    const experiment = findExperiment(id);
    const dir = path.join(root, experiment.root);
    /*
     * The comparison is against the experiment's BASELINE, not HEAD: a change
     * must stay visible after it is committed, which is when it matters most.
     */
    const base = experiment.baselineCommit ?? experiment.baseCommit;
    const nameStatus = await git(["diff", "--name-status", base], dir);
    const numstat = await git(["diff", "--numstat", base], dir);
    const stat = await git(["diff", "--stat", base], dir);
    const head = (await git(["rev-parse", "HEAD"], dir)).stdout.trim();

    const counts = new Map<string, { added: number; removed: number }>();
    for (const line of numstat.stdout.split("\n").filter(Boolean)) {
      const [added, removed, ...rest] = line.split("\t");
      if (!rest.length) continue;
      counts.set(rest.join("\t"), { added: Number(added) || 0, removed: Number(removed) || 0 });
    }

    const files: LabDiffFile[] = [];
    for (const line of nameStatus.stdout.split("\n").filter(Boolean)) {
      const [code, ...rest] = line.split("\t");
      const filePath = rest.join("\t");
      if (!filePath) continue;
      const counter = counts.get(filePath) ?? { added: 0, removed: 0 };
      const body = await git(["diff", "--unified=3", base, "--", filePath], dir);
      files.push({
        path: filePath,
        addedLines: counter.added,
        removedLines: counter.removed,
        status: code.startsWith("D") ? "deleted" : code.startsWith("A") ? "added" : "modified",
        patch: body.stdout,
      });
    }

    const untracked = await git(["ls-files", "--others", "--exclude-standard"], dir);
    for (const filePath of untracked.stdout.split("\n").filter(Boolean)) {
      files.push({
        path: filePath,
        addedLines: countLines(path.join(dir, filePath)),
        removedLines: 0,
        status: "added",
        patch: untrackedPatch(path.join(dir, filePath), filePath),
      });
    }

    return { branch: experiment.branch, baseCommit: base, files, stat: stat.stdout.trim(), head };
  }

  function stopPreviewOf(id: string): void {
    stopPreview(id);
  }

  async function startPreview(id: string, requestedPort?: number): Promise<LabPreview> {
    const experiment = findExperiment(id);
    if (experiment.preview) return experiment.preview;
    const port = Number.isFinite(Number(requestedPort)) && Number(requestedPort) > 1024 ? Number(requestedPort) : 3002;
    const dir = path.join(root, experiment.root);
    const logFile = path.join(root, LAB_STATE_DIR, `preview-${id}.log`);
    mkdirSync(path.dirname(logFile), { recursive: true });

    const { spawn } = await import("node:child_process");
    const child = spawn("npx", ["vite", "--host", "0.0.0.0", "--strictPort", "--port", String(port)], {
      cwd: dir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let log = "";
    child.stdout?.on("data", (chunk) => {
      log += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      log += String(chunk);
    });
    child.unref();

    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(4000) });
        if (response.ok || response.status === 404) {
          ready = true;
          break;
        }
      } catch {
        /* not up yet */
      }
    }
    writeFileSync(logFile, log.slice(-40_000), "utf8");

    const preview: LabPreview = { port, pid: child.pid ?? 0, startedAt: Date.now(), url: `http://127.0.0.1:${port}/` };
    if (ready) patchExperiment(id, { preview });
    appendJournal({ at: preview.startedAt, kind: "preview-started", id, port, ready, log: log.slice(-2000) });
    if (!ready) {
      throw new Error(`The experimental preview did not answer on port ${port} within 90s. Log:\n${log.slice(-1500)}`);
    }
    return preview;
  }

  return {
    root,
    status,
    sync,
    inspect,
    discoveries: loadDiscoveries,
    journal,
    appendJournal,
    worktrees,

    tree(relative = "") {
      const base = relative && relative !== "." ? safeRelativePath(relative) : "";
      const absolute = base ? path.join(root, base) : root;
      if (!existsSync(absolute)) return [];
      const entries: Array<{ name: string; path: string; type: "file" | "dir"; size?: number }> = [];
      for (const name of readdirSync(absolute)) {
        if (name === ".git" || name === "node_modules" || name === "dist" || name === LAB_DIR || name === ".lelu-sandbox") continue;
        const childAbsolute = path.join(absolute, name);
        const childRelative = base ? `${base}/${name}` : name;
        try {
          const stat = statSync(childAbsolute);
          entries.push(
            stat.isDirectory()
              ? { name, path: childRelative, type: "dir" }
              : { name, path: childRelative, type: "file", size: stat.size },
          );
        } catch {
          /* a file that vanished mid-listing is not an entry */
        }
      }
      return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    },

    file(relative: string) {
      const safe = safeRelativePath(relative);
      const absolute = path.join(root, safe);
      if (!existsSync(absolute) || statSync(absolute).isDirectory()) {
        throw new Error(`${safe} is not a readable file.`);
      }
      const content = readFileSync(absolute, "utf8").slice(0, 400_000);
      return { path: safe, content, lines: content.split("\n").length, bytes: statSync(absolute).size };
    },

    search(query: string) {
      const needle = query.toLowerCase();
      const files: string[] = [];
      for (const top of ["src", "plugins", "tests", "scripts"]) {
        const dir = path.join(root, top);
        if (existsSync(dir)) walk(dir, root, files);
      }
      const hits: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        if (!/\.(ts|tsx|mjs|js|css|md)$/.test(file)) continue;
        let text: string;
        try {
          text = readFileSync(path.join(root, file), "utf8");
        } catch {
          continue;
        }
        const lines = text.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index].toLowerCase().includes(needle)) {
            hits.push({ path: file, line: index + 1, text: lines[index].trim().slice(0, 200) });
            if (hits.length >= 80) return hits;
          }
        }
      }
      return hits;
    },

    async commits(limit = 12) {
      const result = await git(
        ["log", `-${limit}`, "--format=%H%x09%aI%x09%an%x09%s", "--name-only", "--no-merges"],
        root,
        60_000,
      );
      const commits: Array<{ sha: string; short: string; date: string; author: string; subject: string; files: string[] }> = [];
      let current: (typeof commits)[number] | null = null;
      for (const line of result.stdout.split("\n")) {
        if (/^[0-9a-f]{40}\t/.test(line)) {
          const [sha, date, author, subject] = line.split("\t");
          current = { sha, short: sha.slice(0, 7), date, author, subject: subject ?? "", files: [] };
          commits.push(current);
        } else if (current && line.trim()) {
          current.files.push(line.trim());
        }
      }
      return commits;
    },

    evidence() {
      const dir = path.join(root, "docs/missions/evidence/mission-43");
      const dir44 = path.join(root, "docs/missions/evidence/mission-44");
      const list: Array<{ path: string; name: string; bytes: number }> = [];
      for (const [label, absolute] of [["mission-43", dir], ["mission-44", dir44]] as const) {
        if (!existsSync(absolute)) continue;
        for (const name of readdirSync(absolute)) {
          if (!/\.(png|jpg|jpeg|webp)$/i.test(name)) continue;
          const relative = `docs/missions/evidence/${label}/${name}`;
          list.push({ path: relative, name, bytes: statSync(path.join(absolute, name)).size });
        }
      }
      return list.sort((a, b) => a.path.localeCompare(b.path));
    },

    async genealogy(relative: string) {
      const safe = safeRelativePath(relative);
      const exists = existsSync(path.join(root, safe));
      const log = await git(["log", "--follow", "--format=%h%x09%an%x09%cI%x09%s", "--max-count=25", "--", safe], root);
      const history = log.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [commit, author, date, subject] = line.split("\t");
          return { commit, author, date, subject: subject ?? "" };
        });
      const origin = history.length > 0 ? history[history.length - 1] : null;
      const contributors = new Map<string, number>();
      for (const entry of history) contributors.set(entry.author, (contributors.get(entry.author) ?? 0) + 1);
      const containing = await git(["branch", "-a", "--contains", history[0]?.commit ?? "HEAD", "--format=%(refname:short)"], root);
      return {
        path: safe,
        exists,
        origin,
        history,
        contributors: [...contributors.entries()].map(([author, commits]) => ({ author, commits })),
        branches: containing.stdout.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 20),
        lineCount: exists ? countLines(path.join(root, safe)) : 0,
        lastChange: history[0] ?? null,
      };
    },

    experiments: {
      list: listExperiments,
      create: createExperiment,

      remove: removeExperiment,

      read(id: string, relative: string) {
        const experiment = experimentIndex(id);
        const safe = safeRelativePath(relative);
        const absolute = withinExperiment(experiment, safe);
        return { path: safe, content: existsSync(absolute) ? readFileSync(absolute, "utf8") : null };
      },

      write(id: string, relative: string, content: string) {
        const experiment = experimentIndex(id);
        const safe = safeRelativePath(relative);
        const absolute = withinExperiment(experiment, safe);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, "utf8");
        appendJournal({ at: Date.now(), kind: "experiment-write", id, path: safe, chars: content.length });
        return { path: safe, chars: content.length };
      },

      /**
       * Apply one exact replacement inside the experiment.
       *
       * Refuses when the anchor is absent or ambiguous: a patch that matched
       * twice is a patch that changed something the author did not name.
       */
      patch(id: string, relative: string, find: string, replace: string) {
        const experiment = experimentIndex(id);
        const safe = safeRelativePath(relative);
        const absolute = withinExperiment(experiment, safe);
        if (!existsSync(absolute)) throw new Error(`${safe} does not exist in the experiment.`);
        const before = readFileSync(absolute, "utf8");
        const occurrences = before.split(find).length - 1;
        if (occurrences !== 1) {
          throw new Error(
            occurrences === 0
              ? `The anchor was not found in ${safe}; nothing was changed.`
              : `The anchor matches ${occurrences} times in ${safe}; it must be unique.`,
          );
        }
        const after = before.replace(find, replace);
        writeFileSync(absolute, after, "utf8");
        appendJournal({ at: Date.now(), kind: "experiment-patch", id, path: safe, chars: after.length - before.length });
        return { path: safe, before: before.length, after: after.length };
      },

      diff: experimentDiff,

      async command(id: string, commandId: string) {
        const experiment = experimentIndex(id);
        const spec = LAB_COMMANDS[commandId];
        if (!spec) {
          return {
            ok: false,
            command: commandId,
            label: commandId,
            status: 400,
            durationMs: 0,
            stdout: "",
            stderr: "",
            error: `Unknown command. Allowed: ${Object.keys(LAB_COMMANDS).join(", ")}.`,
          };
        }
        const dir = path.join(root, experiment.root);
        const result = await run(spec.command, spec.args, dir, spec.timeoutMs);
        patchExperiment(id, {
          verifications: [
            ...(experiment.verifications ?? []),
            { at: Date.now(), command: spec.id, ok: result.ok, status: result.status, durationMs: result.durationMs },
          ].slice(-20),
        });
        appendJournal({
          at: Date.now(),
          kind: "experiment-command",
          id,
          command: spec.id,
          status: result.status,
          ok: result.ok,
          durationMs: result.durationMs,
        });
        return {
          ok: result.ok,
          command: spec.id,
          label: spec.label,
          status: result.status,
          durationMs: result.durationMs,
          stdout: result.stdout.slice(-20_000),
          stderr: result.stderr.slice(-20_000),
        };
      },

      async commit(id: string, message: string) {
        const experiment = experimentIndex(id);
        const dir = path.join(root, experiment.root);
        const trimmed = message.trim();
        if (!trimmed) {
          return { ok: false, commit: null, branch: experiment.branch, files: [], show: "", output: "", error: "A commit needs a message." };
        }
        const pending = await git(["status", "--porcelain=v1"], dir);
        if (!pending.stdout.trim()) {
          return {
            ok: false,
            commit: null,
            branch: experiment.branch,
            files: [],
            show: "",
            output: "",
            error: "Nothing to commit: the experiment matches its last commit.",
          };
        }
        const staged = await git(["add", "--all"], dir, 60_000);
        if (!staged.ok) throw new Error(`git add failed: ${staged.stderr}`);
        const diff = await experimentDiff(id);
        const committed = await git([...LAB_IDENTITY, "commit", "-m", trimmed], dir, 60_000);
        const sha = (await git(["rev-parse", "HEAD"], dir)).stdout.trim();
        const show = await git(["show", "--stat", "--oneline", "HEAD"], dir, 60_000);
        if (committed.ok) {
          patchExperiment(id, { commit: { sha, at: Date.now(), message: trimmed } });
        }
        appendJournal({ at: Date.now(), kind: "experiment-commit", id, sha, files: diff.files.length, ok: committed.ok });
        return {
          ok: committed.ok,
          commit: committed.ok ? sha : null,
          branch: experiment.branch,
          files: diff.files.map((file) => file.path),
          show: show.stdout,
          output: `${committed.stdout}\n${committed.stderr}`.trim().slice(0, 4000),
          ...(committed.ok ? {} : { error: committed.stderr || committed.stdout }),
        };
      },

      previewStart: startPreview,
      previewStop: stopPreviewOf,

      async screenshot(id, viewport, label) {
        const experiment = experimentIndex(id);
        if (!experiment.preview) return { ok: false, error: "Start the experimental preview first." };
        const outDir = path.join(root, "docs/missions/evidence/mission-44");
        mkdirSync(outDir, { recursive: true });
        const file = path.join(outDir, `${id}-${label}-${viewport.width}x${viewport.height}.png`);
        try {
          const playwright = (await import("playwright")) as typeof import("playwright");
          const browser = await playwright.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
          const page = await browser.newPage({ viewport });
          await page.goto(experiment.preview.url, { waitUntil: "networkidle", timeout: 60_000 });
          await page.screenshot({ path: file, fullPage: false });
          await browser.close();
          appendJournal({ at: Date.now(), kind: "screenshot", id, file: path.relative(root, file), viewport });
          return { ok: true, file: path.relative(root, file).split(path.sep).join("/") };
        } catch (error) {
          const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
          appendJournal({ at: Date.now(), kind: "screenshot-unavailable", id, reason });
          return {
            ok: false,
            error: `This host cannot launch a headless browser: ${reason}. The experimental preview is live at ${experiment.preview.url} — open it in a browser to capture the image.`,
          };
        }
      },

      conclude(id: string, status: "verified" | "abandoned", note?: string) {
        const experiment = experimentIndex(id);
        const updated = patchExperiment(id, { status });
        appendJournal({ at: Date.now(), kind: "experiment-concluded", id, status, note: note ?? "", commit: experiment.commit?.sha ?? null });
        return updated;
      },
    },
  };
}
