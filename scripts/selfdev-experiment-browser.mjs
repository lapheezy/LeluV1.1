/**
 * ==========================================================
 * LÉLU — SELF-DEVELOPMENT EXPERIMENT, IN A REAL BROWSER
 *
 * The same experiment as scripts/selfdev-experiment.ts, run where
 * LÉLU actually runs: Chromium, against the local development
 * runtime, so her in-browser self-tests see a real environment
 * (Web Workers, IndexedDB, same-origin fetch). Under Node, four of
 * her 23 self-tests fail only because Node has no Worker; driving
 * her study there would hand her a defect the harness created.
 *
 * Her real modules are imported into the page from the dev server
 * and driven directly (no UI clicks, no stubs):
 *   SelfStudyEngine.runCycle() → conclusion → ImprovementQueue
 *   SelfDevelopmentLoop.approve()  — Gate 1, ONLY with OWNER_GATE1=1
 *
 * Safety (enforced by the browser's own router):
 *   - nothing leaves 127.0.0.1 except through the dev server; every
 *     *.supabase.co / *.supabase.in request is aborted;
 *   - every model-broker POST (/api/model/<provider>/...) is counted per
 *     UTC day in COUNTS (persisted) and aborted once MODEL_BUDGET (10)
 *     is reached; Anthropic is always aborted;
 *   - apply / commit / push need a Supabase-verified identity on the
 *     runtime and are never called.
 *
 *   BASE=http://127.0.0.1:5173 PROFILE=<dir> COUNTS=<file> OUT=<file>
 *   LELU_ENGINEER_TOKEN_FOR_PAGE=<the local runtime's token>
 *   CYCLES=40 MODEL_BUDGET=10 [OWNER_GATE1=1]
 *   LELU_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/selfdev-experiment-browser.mjs
 * ==========================================================
 */
import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://127.0.0.1:5173").replace(/\/+$/, "");
const PROFILE = process.env.PROFILE ?? "selfdev-browser-profile";
const COUNTS = process.env.COUNTS ?? "selfdev-browser-counts.json";
const OUT = process.env.OUT ?? "selfdev-browser-out.json";
const CYCLES = Number(process.env.CYCLES ?? 40);
const MODEL_BUDGET = Number(process.env.MODEL_BUDGET ?? 10);
const OWNER_GATE1 = process.env.OWNER_GATE1 === "1";

const counts = existsSync(COUNTS) ? JSON.parse(readFileSync(COUNTS, "utf8")) : {};
const utcDay = () => new Date().toISOString().slice(0, 10);
const modelLog = [];
const blocked = [];

const context = await chromium.launchPersistentContext(PROFILE, {
  ...(process.env.LELU_CHROMIUM_PATH ? { executablePath: process.env.LELU_CHROMIUM_PATH } : {}),
  viewport: { width: 900, height: 700 },
});
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const local = url.origin === new URL(BASE).origin;
  if (!local || /supabase\.(co|in)$/.test(url.hostname)) {
    blocked.push(`${request.method()} ${url.hostname}${url.pathname}`);
    return route.abort();
  }
  const model = /^\/api\/model\/(?!status\b)([a-z0-9-]+)/.exec(url.pathname);
  if (model && request.method() === "POST") {
    const at = new Date().toISOString();
    if (model[1] === "anthropic") {
      modelLog.push({ at, path: url.pathname, status: "refused-anthropic-disabled" });
      return route.abort();
    }
    const day = utcDay();
    if ((counts[day] ?? 0) >= MODEL_BUDGET) {
      modelLog.push({ at, path: url.pathname, status: "refused-by-harness-budget" });
      return route.abort();
    }
    counts[day] = (counts[day] ?? 0) + 1;
    writeFileSync(COUNTS, JSON.stringify(counts, null, 1));
    const response = await route.fetch();
    modelLog.push({ at, path: url.pathname, status: response.status() });
    return route.fulfill({ response });
  }
  return route.continue();
});

// The local runtime's URL and token reach THIS page only, through the
// resolver's documented globalThis.__LELU_*__ rung. The app never bridges
// the engineer token into a page; outside this harness the runtime is
// reached through a signed-in identity.
await context.addInitScript(({ url, token }) => {
  globalThis.__LELU_LELU_ENGINEER_URL__ = url;
  globalThis.__LELU_LELU_ENGINEER_TOKEN__ = token;
}, { url: BASE, token: process.env.LELU_ENGINEER_TOKEN_FOR_PAGE ?? "" });

const page = context.pages()[0] ?? (await context.newPage());
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
page.on("console", (message) => {
  if (/self-?study|SelfDevelopment|ProposalEngineer/i.test(message.text())) process.stdout.write(`[page] ${message.text().slice(0, 240)}\n`);
});
// A document on the dev origin (storage persists per origin in the profile).
await page.goto(`${BASE}/robots.txt`).catch(() => undefined);
await page.setContent("<!doctype html><title>LÉLU self-development experiment</title><body></body>");

const result = await page.evaluate(
  async ({ origin, cycles, ownerGate1 }) => {
    const load = async (path) => (await import(`${origin}${path}`)).default;
    const { stopBackgroundCognition } = await import(`${origin}/tests/support/isolation.ts`);
    await stopBackgroundCognition();
    const engine = (await load("/src/core/cognition/SelfStudyEngine.ts")).getInstance();
    const objectives = (await load("/src/core/cognition/StudyObjectives.ts")).getInstance();
    const queueModule = await import(`${origin}/src/core/selfdev/ImprovementQueue.ts`);
    const queue = queueModule.default.getInstance();
    const loop = (await load("/src/core/selfdev/SelfDevelopmentLoop.ts")).getInstance();
    const ledger = (await load("/src/core/observability/UsageLedger.ts")).getInstance();
    const gate = (await load("/src/core/observability/UsageBudgetGate.ts")).getInstance();
    const access = (await load("/src/core/selfdev/SourceAccess.ts")).getInstance();
    const autonomy = (await load("/src/core/cognition/AutonomyGate.ts")).getInstance();
    const tests = (await load("/src/core/selfdev/SelfTestRunner.ts")).getInstance();
    const record = await import(`${origin}/src/core/selfdev/DevelopmentRecord.ts`);

    const selfStudy = () => queue.list().filter((p) => p.origin?.kind === "self-study");
    const proposed = () => selfStudy().find((p) => p.status === "Proposed");
    const sourceStatus = await access.status(true).catch((e) => ({ error: String(e) }));
    const selfTests = await tests.run();

    const rows = [];
    if (!selfStudy().some((p) => !["Rejected", "Rolled Back"].includes(p.status))) {
      for (let i = 0; i < cycles; i += 1) {
        const r = await engine.runCycle();
        rows.push({
          cycle: r.cycle, question: r.objective?.question, origin: r.objective?.origin, target: r.objective?.target,
          tool: r.tool, verdict: r.conclusion?.verdict, by: r.conclusion?.synthesizedBy,
          proposalId: r.conclusion?.proposalId, held: Boolean(r.conclusion?.held), note: r.conclusion?.note,
        });
        if (proposed()) break;
      }
    }

    let development = null;
    const pending = proposed();
    if (pending && ownerGate1) {
      const approved = loop.approve(pending.id);
      const deadline = Date.now() + 30 * 60_000;
      const running = () => ["Approved", ...queueModule.RUNNING_STATUSES].includes(queue.get(pending.id)?.status);
      while (approved && running() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000));
      development = { approvedBy: "owner directive (OWNER_GATE1=1)", approved, lastRun: loop.getLastRun() };
    }

    const entries = record.buildDevelopmentRecord(objectives.list(), queue.list());
    return {
      autonomy: { level: autonomy.getLevel(), source: autonomy.source() },
      sourceStatus,
      selfTests: { summary: selfTests.summary, failing: selfTests.results.filter((r) => !r.passed).map((r) => `${r.category}/${r.name}: ${r.detail}`) },
      allowance: gate.backgroundAllowance(),
      usageEvents: ledger.allEvents().map((e) => ({
        at: new Date(e.at).toISOString(), source: e.source, model: e.model, operation: e.operation, ok: e.ok,
        inputTokens: e.inputTokens, outputTokens: e.outputTokens, error: e.error?.slice(0, 240),
      })),
      rows,
      conclusions: objectives.conclusions().map((o) => ({ question: o.question, ...o.conclusion })),
      selfStudyProposals: selfStudy(),
      development,
      developmentRecord: entries,
      developmentRecordAsSheReadsIt: record.formatDevelopmentRecord(entries),
    };
  },
  { origin: BASE, cycles: CYCLES, ownerGate1: OWNER_GATE1 },
);

await context.close();
const out = { started: new Date().toISOString(), base: BASE, harness: { modelBudget: MODEL_BUDGET, modelRequestsByDay: counts, thisRun: modelLog, blockedRequests: blocked }, pageErrors, ...result };
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  cycles: result.rows.length,
  selfTests: result.selfTests.summary,
  modelRequestsToday: counts[utcDay()] ?? 0,
  proposals: result.selfStudyProposals.map((p) => ({ id: p.id, title: p.title, status: p.status })),
  pageErrors: pageErrors.length,
}, null, 2));
