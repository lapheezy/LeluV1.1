/**
 * ==========================================================
 * LÉLU — KNOWING WHAT WAS DONE TO HER, AND DOING IT HERSELF
 *
 * Whoever changes her — this assistant, another coder, another agent — the
 * change is a git commit. So her awareness is built from git itself, not from
 * a log someone has to remember to write:
 *
 *   GET  /api/self/changes?limit=30   commits (who, when, what, why, which of
 *                                     her parts), newest first, plus the
 *                                     journal entries written for her
 *   GET  /api/self/journal            the journal: what was done to her, why,
 *                                     and how she can repeat it
 *   GET  /api/self/playbooks          procedures she can run
 *   GET  /api/self/playbooks/<id>     one procedure, step by step
 *   POST /api/self/playbooks/<id>/run { params?, steps?, approveSpend?, approvedBy? }
 *                                     run it; returns a run id
 *   GET  /api/self/runs/<id>          that run's progress and output
 *
 * SAFETY (running is real work on this machine):
 *   - POST requires the engineering access token (plugins/engineerAuth.ts),
 *     fail-closed: no token configured → 503.
 *   - Only scripts inside scripts/ of this repository, launched without a
 *     shell, with argv arrays from the playbook file (params are substituted
 *     into arguments, never into a command line).
 *   - A step that spends credits (spend > 0) is refused unless the request
 *     carries approveSpend: true AND approvedBy (the person who said yes).
 *   - "tool" and "note" steps are returned as instructions, not executed here:
 *     tools run in her own tool table, notes are for her to follow and verify.
 * ==========================================================
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { engineerAuthVerdict, sendEngineerAuthFailure } from "./engineerAuth.ts";

export interface SelfChange {
  hash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  files: number;
  areas: string[];
}

export interface JournalEntry {
  file: string;
  date: string;
  title: string;
  commits: string[];
  playbooks: string[];
  text: string;
}

export interface PlaybookStep {
  id: string;
  title: string;
  kind: "blender" | "python" | "tsx" | "meshy" | "meshy-wait" | "tool" | "note";
  script?: string;
  args?: unknown;
  tool?: string;
  spend?: number;
  why?: string;
  check?: string;
}

export interface Playbook {
  id: string;
  title: string;
  why: string;
  spendsCredits: number;
  params?: Record<string, string>;
  learnedFrom?: string;
  steps: PlaybookStep[];
}

/** Which of her parts a file belongs to, in words she can use. */
const AREAS: Array<[RegExp, string]> = [
  [/^leluverse\/assets\/characters\/lelu_character\/(meshes|rig)\//, "my body and outfits (3D assets)"],
  [/^leluverse\/assets\/characters\/lelu_character\/(manifests|generation_logs)\//, "my wardrobe records"],
  [/^leluverse\/assets\/wardrobe\//, "my wardrobe plans"],
  [/^leluverse\/self\//, "my self-knowledge (journal, playbooks)"],
  [/^scripts\/blender\//, "my 3D build scripts"],
  [/^scripts\/foundry\//, "my foundry tools"],
  [/^artifacts\/foundry\//, "renders and measurements of me"],
  [/^src\/core\/avatar\//, "my avatar and wardrobe behaviour"],
  [/^src\/core\/(cognition|router|agent|agentic)\//, "how I think and route requests"],
  [/^src\/core\/(forge|asre)\//, "my 3D forge"],
  [/^src\/core\//, "my core runtime"],
  [/^src\//, "my interface"],
  [/^plugins\//, "my server"],
  [/^tests\//, "my tests"],
  [/^docs\//, "documentation about me"],
];

export function areaOf(file: string): string {
  return AREAS.find(([re]) => re.test(file))?.[1] ?? "other files";
}

/** Commits from git itself, so every coder's change is included. */
export function listChanges(root: string, limit = 30): SelfChange[] {
  const SEP = "\u001e";
  // `--diff-merges=first-parent`: a merge commit lists what it brought in (its diff
  // against the first parent). Plain --name-only lists no files for a merge,
  // so an integrated branch read as a change that touched nothing.
  const r = spawnSync("git", ["log", `-n${Math.max(1, Math.min(200, limit))}`, "--diff-merges=first-parent", "--name-only", `--format=${SEP}%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1f`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  return r.stdout
    .split(SEP)
    .filter((x) => x.trim())
    .map((chunk) => {
      const [hash, author, date, subject, body, rest] = chunk.split("\u001f");
      const files = (rest ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
      const areas = [...new Set(files.map(areaOf))];
      return {
        hash: hash.slice(0, 12),
        author,
        date,
        subject,
        body: body
          .split("\n")
          .filter((l) => !/^(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(l))
          .join("\n")
          .trim()
          .slice(0, 1500),
        files: files.length,
        areas,
      };
    });
}

function frontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

export function readJournal(root: string): JournalEntry[] {
  const dir = path.join(root, "leluverse/self/journal");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .map((f) => {
      const { meta, body } = frontmatter(readFileSync(path.join(dir, f), "utf8"));
      const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
      return { file: `journal/${f}`, date: meta.date ?? f.slice(0, 10), title: meta.title ?? f, commits: list(meta.commits), playbooks: list(meta.playbooks), text: body.trim() };
    });
}

export function readPlaybooks(root: string): Playbook[] {
  const dir = path.join(root, "leluverse/self/playbooks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Playbook);
}

/* ------------------------------------------------------------- runner */

export interface RunState {
  id: string;
  playbook: string;
  status: "running" | "done" | "failed" | "refused";
  steps: Array<{ id: string; status: "pending" | "running" | "ok" | "failed" | "skipped" | "instruction"; output: string; seconds?: number }>;
  outputs: Record<string, { task?: string; file?: string }>;
  error?: string;
}

const runs = new Map<string, RunState>();

function blender(): string {
  return process.env.LELU_BLENDER_BIN || path.join(os.homedir(), "lelu-tools/blender-4.5.9-linux-x64/blender");
}

/** Substitute ${param}, ${task:step}, ${file:step}; refuse anything left unresolved. */
export function resolveArgs(args: unknown, params: Record<string, string>, outputs: RunState["outputs"]): string[] {
  const list = Array.isArray(args) ? args.map(String) : [];
  return list.map((a) =>
    a.replace(/\$\{(task|file):([a-z0-9_-]+)\}|\$\{([a-zA-Z0-9_]+)\}/g, (_m, kind, step, name) => {
      if (name) {
        if (!(name in params)) throw new Error(`missing parameter "${name}"`);
        return params[name];
      }
      const o = outputs[step];
      const v = kind === "task" ? o?.task : o?.file;
      if (!v) throw new Error(`step "${step}" has not produced a ${kind} yet`);
      return v;
    }),
  );
}

/** The exact argv a step would run — no shell, script must live in scripts/. */
export function commandFor(root: string, step: PlaybookStep, args: string[]): string[] {
  if (!step.script) throw new Error(`step ${step.id} has no script`);
  const script = path.normalize(step.script);
  if (!script.startsWith("scripts" + path.sep) || script.includes("..")) throw new Error(`step ${step.id}: only scripts under scripts/ may run`);
  if (!existsSync(path.join(root, script))) throw new Error(`step ${step.id}: ${script} does not exist`);
  switch (step.kind) {
    case "blender":
      return [blender(), "-b", "--factory-startup", "--python", script, "--", ...args];
    case "python":
    case "meshy":
    case "meshy-wait":
      return ["python3", script, ...args];
    case "tsx":
      return ["npx", "tsx", script, ...args];
    default:
      throw new Error(`step ${step.id}: ${step.kind} steps are not executed by the runner`);
  }
}

export function startRun(
  root: string,
  playbook: Playbook,
  body: { params?: Record<string, string>; steps?: string[]; approveSpend?: boolean; approvedBy?: string },
  exec: (argv: string[]) => Promise<{ code: number; out: string }> = defaultExec(root),
): RunState {
  const id = `run_${Date.now().toString(36)}`;
  const chosen = playbook.steps.filter((s) => !body.steps?.length || body.steps.includes(s.id));
  const state: RunState = { id, playbook: playbook.id, status: "running", steps: chosen.map((s) => ({ id: s.id, status: "pending", output: "" })), outputs: {} };
  const spend = chosen.reduce((n, s) => n + (s.spend ?? 0), 0);
  if (spend > 0 && !(body.approveSpend === true && (body.approvedBy ?? "").trim())) {
    state.status = "refused";
    state.error = `This run would spend about ${spend} Meshy credits. It needs approveSpend: true and approvedBy (the person who said yes).`;
    runs.set(id, state);
    return state;
  }
  runs.set(id, state);
  void (async () => {
    for (const [i, step] of chosen.entries()) {
      const s = state.steps[i];
      if (step.kind === "tool" || step.kind === "note") {
        s.status = "instruction";
        s.output = step.kind === "tool" ? `call ${step.tool} ${JSON.stringify(step.args ?? {})} — ${step.why ?? ""}` : step.why ?? "";
        continue;
      }
      s.status = "running";
      const t0 = Date.now();
      try {
        const argv = commandFor(root, step, resolveArgs(step.args, body.params ?? {}, state.outputs));
        const { code, out } = await exec(argv);
        s.output = out.slice(-4000);
        s.seconds = Math.round((Date.now() - t0) / 1000);
        const task = out.match(/^TASK (\S+)/m)?.[1];
        const file = out.match(/"file": "([^"]+\.png)"/)?.[1];
        state.outputs[step.id] = { task, file: file && body.params?.dir ? `${body.params.dir}/${file}` : file };
        if (code !== 0) throw new Error(`exit ${code}`);
        s.status = "ok";
      } catch (e) {
        s.status = "failed";
        s.output += `\n${e instanceof Error ? e.message : String(e)}`;
        state.status = "failed";
        state.error = `step ${step.id} failed`;
        for (const rest of state.steps.slice(i + 1)) rest.status = "skipped";
        return;
      }
    }
    state.status = "done";
  })();
  return state;
}

function defaultExec(root: string) {
  return (argv: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      const p = spawn(argv[0], argv.slice(1), { cwd: root, env: process.env });
      let out = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.stderr.on("data", (d) => (out += d.toString()));
      p.on("close", (code) => resolve({ code: code ?? 1, out }));
      p.on("error", (e) => resolve({ code: 1, out: out + String(e) }));
    });
}

export function getRun(id: string): RunState | undefined {
  return runs.get(id);
}

/* ------------------------------------------------------------- http */

interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on: (e: string, h: (c?: unknown) => void) => void;
}
interface Res {
  statusCode?: number;
  setHeader: (n: string, v: string) => void;
  end: (b?: string) => void;
}

function send(res: Res, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: Req): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += String(c)));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export function createSelfJournalApi(root = process.cwd()) {
  const handle = async (req: Req, res: Res, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/api/self/")) return next();
    const parts = url.pathname.slice("/api/self/".length).split("/").filter(Boolean);
    try {
      if (req.method === "GET" && parts[0] === "changes") {
        return send(res, 200, { ok: true, changes: listChanges(root, Number(url.searchParams.get("limit") ?? 30)), journal: readJournal(root).slice(0, 10) });
      }
      if (req.method === "GET" && parts[0] === "journal") return send(res, 200, { ok: true, journal: readJournal(root) });
      if (req.method === "GET" && parts[0] === "playbooks" && !parts[1]) return send(res, 200, { ok: true, playbooks: readPlaybooks(root).map(({ steps, ...p }) => ({ ...p, steps: steps.length })) });
      if (req.method === "GET" && parts[0] === "playbooks" && parts[1]) {
        const pb = readPlaybooks(root).find((p) => p.id === parts[1]);
        return pb ? send(res, 200, { ok: true, playbook: pb }) : send(res, 404, { ok: false, error: `no playbook ${parts[1]}` });
      }
      if (req.method === "GET" && parts[0] === "runs" && parts[1]) {
        const r = getRun(parts[1]);
        return r ? send(res, 200, { ok: true, run: r }) : send(res, 404, { ok: false, error: `no run ${parts[1]}` });
      }
      if (req.method === "POST" && parts[0] === "playbooks" && parts[2] === "run") {
        const verdict = engineerAuthVerdict(req as never);
        if (!verdict.ok) return sendEngineerAuthFailure(res as never, verdict);
        const pb = readPlaybooks(root).find((p) => p.id === parts[1]);
        if (!pb) return send(res, 404, { ok: false, error: `no playbook ${parts[1]}` });
        const run = startRun(root, pb, (await readBody(req)) as never);
        return send(res, run.status === "refused" ? 402 : 202, { ok: run.status !== "refused", run, error: run.error });
      }
      return send(res, 404, { ok: false, error: "unknown /api/self route" });
    } catch (e) {
      return send(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  return {
    handle,
    /** Mounted at /api/self: connect strips the mount path, so it is put back before routing. */
    attach(m: { use: (route: string, fn: (req: Req, res: Res, next: () => void) => void) => void }) {
      m.use("/api/self", (req, res, next) => {
        const original = req.url ?? "/";
        void handle({ ...req, on: req.on.bind(req), headers: req.headers, method: req.method, url: `/api/self${original.startsWith("/") ? original : `/${original}`}` }, res, next);
      });
    },
  };
}
