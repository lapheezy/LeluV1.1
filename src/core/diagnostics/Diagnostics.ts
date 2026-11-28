/**
 * Chat-driven diagnostics (Cosmos × Chat Universe, addendum v3 §16–19).
 *
 * LÉLU runs these from the conversation, inside Cosmos. A run is a list of checks; each check MEASURES
 * something real (the live page, the stores, the dev runtime, the project's own test files) and reports
 * exactly one of PASS, FAIL, PARTIAL, BLOCKED or NOT_RUN, with evidence or a reason.
 * - Nothing here is a mock: a check that cannot run in this environment says BLOCKED or NOT_RUN and why.
 * - Read-only by default: a check that changes something to measure it (moves an object, types into the
 *   composer) puts it back, and records the before and after.
 * - Test files run only through the existing engineering authority (EngineeringWorkspace.checkFiles →
 *   /api/engineer/command "test-files"), never a second runner.
 * - No message text, secrets or tokens are written into evidence.
 *
 * History is kept per conversation (the workspace), newest first, so a run can be reopened, compared
 * and rerun.
 */

export type CheckStatus = "PASS" | "FAIL" | "PARTIAL" | "BLOCKED" | "NOT_RUN";
export type MetricKind = "measured" | "estimated" | "simulated" | "unavailable";

export interface DiagnosticCheck {
  id: string;
  /** Sub-result group, e.g. "a-spatial", "b-borderless", "c-chat", "d-coexistence", "e-persistence", "f-device". */
  category: string;
  title: string;
  status: CheckStatus;
  /** What was measured (numbers, selectors, counts). Never message content. */
  evidence: string;
  /** Why it failed, or why it could not run. */
  reason?: string;
  /** Drill-down: the object, surface or source this check is about. */
  target?: { kind: "thread-object" | "selector" | "source" | "test"; ref: string };
  /** What could be done next, and what kind of action that is. */
  next?: { action: string; kind: "read-only" | "reversible" | "needs-approval" | "outside-environment" };
  metric?: { name: string; value: number; unit: string; kind: MetricKind };
  ms: number;
}

export interface DiagnosticRun {
  id: string;
  suite: string;
  conversationId: string | null;
  target: string;
  startedAt: number;
  finishedAt: number | null;
  environment: { device: string; viewport: string; touch: boolean; build: string };
  checks: DiagnosticCheck[];
  status: "running" | "done";
  /** Set when this run reruns an earlier one: before/after comparison. */
  rerunOf?: string;
}

export function summarize(run: Pick<DiagnosticRun, "checks">): Record<CheckStatus, number> {
  const out: Record<CheckStatus, number> = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, NOT_RUN: 0 };
  for (const c of run.checks) out[c.status]++;
  return out;
}

/** Overall verdict for a group: VERIFIED only when every check that ran passed and nothing required was blocked. */
export function verdict(checks: DiagnosticCheck[]): "VERIFIED" | "FAIL" | "PARTIAL" | "BLOCKED" | "NOT_RUN" {
  if (checks.length === 0) return "NOT_RUN";
  if (checks.some((c) => c.status === "FAIL")) return "FAIL";
  if (checks.every((c) => c.status === "PASS")) return "VERIFIED";
  if (checks.every((c) => c.status === "BLOCKED" || c.status === "NOT_RUN")) return checks.some((c) => c.status === "BLOCKED") ? "BLOCKED" : "NOT_RUN";
  return "PARTIAL";
}

/* ---------------------------------------------------------------- history store */

const KEY = "lelu.diagnostics.v1";
const MAX_RUNS = 24;
export const DIAGNOSTICS_EVENT = "lelu-diagnostics";
let memory: DiagnosticRun[] | null = null;
let storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage;
export function setDiagnosticsStorage(s: Storage | null): void {
  storage = s;
  memory = null;
}
function load(): DiagnosticRun[] {
  if (memory) return memory;
  try {
    memory = JSON.parse(storage?.getItem(KEY) ?? "[]") as DiagnosticRun[];
  } catch {
    memory = [];
  }
  return memory;
}
function save(): void {
  const list = load();
  if (list.length > MAX_RUNS) list.splice(0, list.length - MAX_RUNS);
  try {
    storage?.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota: history stays in memory */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DIAGNOSTICS_EVENT));
}
export function runs(conversationId?: string | null): DiagnosticRun[] {
  return load()
    .filter((r) => conversationId === undefined || r.conversationId === conversationId)
    .slice()
    .reverse();
}
export function getRun(id: string): DiagnosticRun | undefined {
  return load().find((r) => r.id === id);
}

/* ---------------------------------------------------------------- suites */

export interface CheckContext {
  conversationId: string | null;
  /** Report progress as checks finish (the surface streams them). */
  push(check: DiagnosticCheck): void;
}
export interface Suite {
  id: string;
  title: string;
  /** Natural-language phrases that select this suite. */
  match: RegExp;
  run(ctx: CheckContext): Promise<void>;
}
const SUITES = new Map<string, Suite>();
export function registerSuite(s: Suite): void {
  SUITES.set(s.id, s);
}
export function suites(): Suite[] {
  return [...SUITES.values()];
}
/** Which suite a request names ("validate Freestyle, including chat" → freestyle-chat). */
export function suiteFor(text: string): Suite | undefined {
  const t = text.trim();
  return SUITES.get(t) ?? suites().find((s) => s.match.test(t));
}

function environment(): DiagnosticRun["environment"] {
  if (typeof window === "undefined") return { device: "node", viewport: "n/a", touch: false, build: "n/a" };
  const touch = (navigator.maxTouchPoints ?? 0) > 0 && matchMedia?.("(pointer: coarse)").matches === true;
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /HeadlessChrome/.test(ua) ? "headless Chromium (automated)" : /Chrome/.test(ua) ? "Chromium desktop" : /Safari/.test(ua) ? "Safari desktop" : "browser";
  const build = (document.querySelector("[data-lelu-build]") as HTMLElement | null)?.dataset.leluBuild ?? (document.body.textContent?.match(/LÉLU ([0-9a-f]{7,8}\+?\w*)/)?.[1] ?? "unknown");
  return { device, viewport: `${innerWidth}×${innerHeight}@${devicePixelRatio}`, touch, build };
}

let runSeq = 0;
/** Run a suite (or several, for "full"). Checks stream into the stored run as they finish. */
export async function runDiagnostics(suiteId: string, conversationId: string | null, opts: { rerunOf?: string; ready?: (run: DiagnosticRun) => Promise<void> } = {}): Promise<DiagnosticRun> {
  const chosen = suiteId === "full" ? suites().filter((s) => s.id !== "full") : [SUITES.get(suiteId)].filter(Boolean) as Suite[];
  const run: DiagnosticRun = {
    id: `diag-${Date.now().toString(36)}${(runSeq++).toString(36)}`,
    suite: suiteId,
    conversationId,
    target: conversationId ? `conversation ${conversationId}` : "no open conversation",
    startedAt: Date.now(),
    finishedAt: null,
    environment: environment(),
    checks: [],
    status: "running",
    ...(opts.rerunOf ? { rerunOf: opts.rerunOf } : {}),
  };
  load().push(run);
  save();
  // Let the caller put the Diagnostics surface on screen and let the layout settle BEFORE any check
  // measures it: a surface arriving mid-run moved the objects under the "move" check (measured).
  if (opts.ready) await opts.ready(run);
  const ctx: CheckContext = {
    conversationId,
    push: (c) => {
      run.checks.push(c);
      save();
    },
  };
  for (const s of chosen) {
    try {
      await s.run(ctx);
    } catch (error) {
      ctx.push({ id: `${s.id}:crashed`, category: s.id, title: `${s.title} could not finish`, status: "FAIL", evidence: "", reason: error instanceof Error ? error.message : String(error), ms: 0 });
    }
  }
  run.finishedAt = Date.now();
  run.status = "done";
  save();
  return run;
}

/** Time a check and turn a thrown error into a FAIL with the message as its reason. */
export async function timed(ctx: CheckContext, base: Omit<DiagnosticCheck, "status" | "evidence" | "ms">, fn: () => Promise<Pick<DiagnosticCheck, "status" | "evidence"> & Partial<DiagnosticCheck>> | (Pick<DiagnosticCheck, "status" | "evidence"> & Partial<DiagnosticCheck>)): Promise<DiagnosticCheck> {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let out: DiagnosticCheck;
  try {
    const r = await fn();
    out = { ...base, ...r, ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) };
  } catch (error) {
    out = { ...base, status: "FAIL", evidence: "", reason: error instanceof Error ? error.message : String(error), ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) };
  }
  ctx.push(out);
  return out;
}

/** Compact chat summary of a run: counts per status, then every non-pass with its reason. */
export function chatSummary(run: DiagnosticRun): string {
  const s = summarize(run);
  const groups = [...new Set(run.checks.map((c) => c.category))].map((g) => `${g}: ${verdict(run.checks.filter((c) => c.category === g))}`);
  const issues = run.checks.filter((c) => c.status !== "PASS").slice(0, 12).map((c) => `- ${c.status} ${c.title}${c.reason ? `: ${c.reason}` : ""}`);
  return [
    `Diagnostics "${run.suite}" (${run.id}) on ${run.environment.device}, ${run.environment.viewport}, build ${run.environment.build}.`,
    `${run.checks.length} checks: ${s.PASS} pass, ${s.FAIL} fail, ${s.PARTIAL} partial, ${s.BLOCKED} blocked, ${s.NOT_RUN} not run.`,
    `By group: ${groups.join("; ")}.`,
    ...(issues.length ? ["Not passing:", ...issues] : ["Every check that ran passed."]),
    "Details, evidence and rerun are in the Diagnostics surface beside the chat.",
  ].join("\n");
}
