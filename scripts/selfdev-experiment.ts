/**
 * ==========================================================
 * LÉLU — SELF-DEVELOPMENT EXPERIMENT HARNESS (Improvement 3)
 *
 * Drives LÉLU's REAL engines against her REAL source tree,
 * through a locally running development runtime, and records
 * what she did. Nothing in her reasoning is stubbed:
 *
 *   SelfStudyEngine.runCycle()      — she chooses what to study,
 *                                     reads her own source and
 *                                     concludes (model or evidence)
 *   ImprovementQueue                — a "change" conclusion becomes
 *                                     a Proposed self-study proposal
 *   SelfDevelopmentLoop.approve()   — Gate 1, ONLY with OWNER_GATE1=1
 *                                     (the owner's directive); her
 *                                     loop then generates the change
 *                                     in an isolated workspace copy,
 *                                     runs the relevant tests and the
 *                                     typecheck there, and stops at
 *                                     Ready (Gate 2 is the owner's)
 *
 * Safety, enforced here rather than promised:
 *   - Supabase: run with NODE_OPTIONS="--import tests/support/block-supabase.mjs";
 *     the harness refuses to start without the guard.
 *   - Model use: every request to the model broker is counted per UTC
 *     day (fallback attempts included) and refused before sending once
 *     MODEL_BUDGET (default 10) is reached. The count persists in the
 *     state file, so separate runs share one day's budget. This sits
 *     UNDER her own background allowance, which still applies.
 *   - Production: apply, commit and push need a Supabase-verified
 *     identity on the runtime and are never called here.
 *
 * Env: LELU_BASE_URL (default http://127.0.0.1:5173),
 *      VITE_LELU_ENGINEER_URL / VITE_LELU_ENGINEER_TOKEN (the runtime),
 *      STATE (state file), OUT (evidence JSON), CYCLES (default 40),
 *      MODEL_BUDGET (default 10), OWNER_GATE1=1 to approve her pending
 *      self-study proposal (the owner's decision, recorded as such).
 * ==========================================================
 */
import "./support/node-browser-shims";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const guard = (globalThis as { __leluSupabaseGuard?: { blocked: number } }).__leluSupabaseGuard;
if (!guard) {
  console.error("Refusing to run: load tests/support/block-supabase.mjs (NODE_OPTIONS=--import ...) first.");
  process.exit(2);
}

const BASE = (process.env.LELU_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/+$/, "");
const STATE = process.env.STATE ?? "selfdev-experiment-state.json";
const OUT = process.env.OUT ?? "selfdev-experiment-out.json";
const CYCLES = Number(process.env.CYCLES ?? 40);
const MODEL_BUDGET = Number(process.env.MODEL_BUDGET ?? 10);
const OWNER_GATE1 = process.env.OWNER_GATE1 === "1";

if (typeof (globalThis as { window?: unknown }).window === "undefined") (globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).location = new URL(`${BASE}/`);
// The shims put storage on `window`; LÉLU's stores read it from there.
const storage = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;

/* ---- persisted state: her stores + the day's model-request count ---- */
type Saved = { storage: Record<string, string>; modelRequests: Record<string, number> };
const saved: Saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { storage: {}, modelRequests: {} };
for (const [key, value] of Object.entries(saved.storage)) storage.setItem(key, value);
const utcDay = () => new Date().toISOString().slice(0, 10);
function save(): void {
  const copy: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)!;
    copy[key] = storage.getItem(key)!;
  }
  writeFileSync(STATE, JSON.stringify({ storage: copy, modelRequests: saved.modelRequests }, null, 1));
}

/* ---- network: same-origin paths resolve like a browser; EVERY model request is counted ----
   In a browser, model traffic goes through the server broker (/api/model/...).
   Under Node the providers call their upstream hosts directly with the
   process's keys, so both shapes are counted. Anthropic stays disabled:
   any request to it is refused here, and its keys are stripped by the
   launcher (env -u). Every other outbound POST is logged for audit. */
const MODEL_HOSTS = [
  "api.groq.com", "openrouter.ai", "api.cerebras.ai", "api.fireworks.ai", "api.mistral.ai",
  "generativelanguage.googleapis.com", "models.github.ai", "models.inference.ai.azure.com",
  "api.openai.com", "api.together.xyz", "api.deepseek.com", "api.moonshot.ai", "api.anthropic.com",
];
const modelLog: Array<{ at: string; host: string; path: string; status: number | string }> = [];
const otherPosts: Array<{ at: string; host: string; path: string }> = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/")) url = `${BASE}${url}`;
  const target = new URL(url);
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const brokered = target.origin === new URL(BASE).origin && /^\/api\/model\/(?!status\b)[a-z0-9-]+/.test(target.pathname);
  const direct = MODEL_HOSTS.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`));
  const isModelRequest = method === "POST" && (brokered || direct);
  if (method === "POST" && !isModelRequest && target.origin !== new URL(BASE).origin) {
    otherPosts.push({ at: new Date().toISOString(), host: target.hostname, path: target.pathname });
  }
  if (isModelRequest) {
    if (target.hostname.endsWith("anthropic.com") || /\/api\/model\/anthropic\b/.test(target.pathname)) {
      modelLog.push({ at: new Date().toISOString(), host: target.hostname, path: target.pathname, status: "refused-anthropic-disabled" });
      throw new TypeError("Anthropic is disabled for this experiment.");
    }
    const day = utcDay();
    const used = saved.modelRequests[day] ?? 0;
    if (used >= MODEL_BUDGET) {
      modelLog.push({ at: new Date().toISOString(), host: target.hostname, path: target.pathname, status: "refused-by-harness-budget" });
      throw new TypeError(`Harness model budget spent: ${used}/${MODEL_BUDGET} requests on ${day} (UTC).`);
    }
    saved.modelRequests[day] = used + 1;
    save();
  }
  const response = await realFetch(typeof input === "string" || input instanceof URL ? url : new Request(url, input as Request), init);
  if (isModelRequest) modelLog.push({ at: new Date().toISOString(), host: target.hostname, path: target.pathname, status: response.status });
  return response;
}) as typeof fetch;

const { default: SelfStudyEngine } = await import("../src/core/cognition/SelfStudyEngine");
const { default: StudyObjectives } = await import("../src/core/cognition/StudyObjectives");
const { default: ImprovementQueue, RUNNING_STATUSES } = await import("../src/core/selfdev/ImprovementQueue");
const { default: SelfDevelopmentLoop } = await import("../src/core/selfdev/SelfDevelopmentLoop");
const { default: UsageLedger } = await import("../src/core/observability/UsageLedger");
const { default: UsageBudgetGate } = await import("../src/core/observability/UsageBudgetGate");
const { default: SourceAccess } = await import("../src/core/selfdev/SourceAccess");
const { default: AutonomyGate } = await import("../src/core/cognition/AutonomyGate");
const { buildDevelopmentRecord, formatDevelopmentRecord } = await import("../src/core/selfdev/DevelopmentRecord");
const { stopBackgroundCognition } = await import("../tests/support/isolation");

await stopBackgroundCognition();
const engine = SelfStudyEngine.getInstance();
const queue = ImprovementQueue.getInstance();
const selfStudyProposals = () => queue.list().filter((proposal) => proposal.origin?.kind === "self-study");
const open = () => selfStudyProposals().find((proposal) => proposal.status === "Proposed");

const source = await SourceAccess.getInstance().status(true).catch(() => null);
const rows: unknown[] = [];
const started = new Date().toISOString();

/* 1–4. She studies her own source until a conclusion calls for a change. */
if (!open() && !selfStudyProposals().some((proposal) => !["Rejected", "Rolled Back"].includes(proposal.status))) {
  for (let index = 0; index < CYCLES; index += 1) {
    const report = await engine.runCycle();
    rows.push({
      cycle: report.cycle,
      question: report.objective?.question,
      origin: report.objective?.origin,
      target: report.objective?.target,
      tool: report.tool,
      verdict: report.conclusion?.verdict,
      by: report.conclusion?.synthesizedBy,
      proposalId: report.conclusion?.proposalId,
      held: Boolean(report.conclusion?.held),
      note: report.conclusion?.note,
    });
    save();
    if (open()) break;
  }
}

/* 5–6. Gate 1 only by the owner's directive; her loop implements and tests in an isolated copy. */
let development: unknown = null;
const pending = open();
if (pending && OWNER_GATE1) {
  const approved = SelfDevelopmentLoop.getInstance().approve(pending.id);
  const deadline = Date.now() + 30 * 60_000;
  const settled = () => {
    const status = queue.get(pending.id)?.status;
    return status !== undefined && status !== "Approved" && !RUNNING_STATUSES.includes(status);
  };
  while (approved && !settled() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 2000));
  development = { approvedBy: "owner directive (OWNER_GATE1=1)", approved, lastRun: SelfDevelopmentLoop.getInstance().getLastRun() };
  save();
}

/* 7. Evidence. Gate 2 is left to the owner. */
const ledger = UsageLedger.getInstance();
const out = {
  started,
  finished: new Date().toISOString(),
  base: BASE,
  autonomy: { level: AutonomyGate.getInstance().getLevel(), source: AutonomyGate.getInstance().source() },
  sourceAccess: source ?? null,
  harnessModelRequests: { budget: MODEL_BUDGET, byDay: saved.modelRequests, thisRun: modelLog },
  otherOutboundPosts: otherPosts,
  supabaseRequestsRefused: guard.blocked,
  allowance: UsageBudgetGate.getInstance().backgroundAllowance(),
  usageEvents: ledger.allEvents().map((event) => ({
    at: new Date(event.at).toISOString(), source: event.source, model: event.model, operation: event.operation, ok: event.ok,
    inputTokens: event.inputTokens, outputTokens: event.outputTokens, error: event.error?.slice(0, 240),
  })),
  rows,
  conclusions: StudyObjectives.getInstance().conclusions().map((objective) => ({ question: objective.question, ...objective.conclusion })),
  selfStudyProposals: selfStudyProposals(),
  development,
  developmentRecord: buildDevelopmentRecord(StudyObjectives.getInstance().list(), queue.list()),
  developmentRecordAsSheReadsIt: formatDevelopmentRecord(buildDevelopmentRecord(StudyObjectives.getInstance().list(), queue.list())),
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
save();
console.log(JSON.stringify({
  cycles: rows.length,
  modelRequestsToday: saved.modelRequests[utcDay()] ?? 0,
  supabaseRequestsRefused: guard.blocked,
  proposals: selfStudyProposals().map((proposal) => ({ id: proposal.id, title: proposal.title, status: proposal.status })),
}, null, 2));
process.exit(0);
