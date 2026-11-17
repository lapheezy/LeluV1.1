/**
 * Development tab, in a real browser: Gate 1 and Gate 2 through the owner's
 * own buttons, against the real component and the real ImprovementQueue
 * served by the local dev runtime.
 *
 * Safety: the page can reach nothing but the local dev server. Every request
 * to *.supabase.co / *.supabase.in and every model-broker call is aborted.
 *
 *   node docs/missions/self-study-applied/evidence/development-tab-browser.mjs http://127.0.0.1:5173 <outdir>
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const out = process.argv[3] ?? "development-tab-out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.LELU_CHROMIUM_PATH ? { executablePath: process.env.LELU_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 760, height: 1100 }, deviceScaleFactor: 1 });
const blocked = [];
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  const local = url.origin === new URL(base).origin;
  if (!local || url.pathname.startsWith("/api/model/") || /supabase\.(co|in)$/.test(url.hostname)) {
    blocked.push(`${route.request().method()} ${url.hostname}${url.pathname}`);
    return route.abort();
  }
  return route.continue();
});
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

// A bare document on the dev origin; the component is imported into it directly.
await page.goto(`${base}/robots.txt`).catch(() => undefined);
await page.setContent(`<!doctype html><html><body style="background:#0b1020;color:#e2e8f0;font-family:system-ui;margin:16px"><div id="root"></div></body></html>`);

const results = await page.evaluate(async (origin) => {
  // @vitejs/plugin-react expects its refresh preamble when a .tsx module loads.
  const refresh = await import(`${origin}/@react-refresh`);
  refresh.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;

  // Use React by the exact URL (with Vite's ?v= hash) the component imports,
  // so the page and the component share one React.
  const transformed = await (await fetch(`${origin}/src/app/scene/genesis/DevelopmentRecordTab.tsx`)).text();
  const reactUrl = transformed.match(/["'](\/node_modules\/\.vite\/deps\/react\.js\?v=[^"']+)["']/)[1];
  const version = reactUrl.split("?")[1];
  const reactModule = await import(`${origin}${reactUrl}`);
  const React = reactModule.default ?? reactModule;
  const domModule = await import(`${origin}/node_modules/.vite/deps/react-dom_client.js?${version}`);
  const createRoot = domModule.createRoot ?? domModule.default.createRoot;
  const queue = (await import(`${origin}/src/core/selfdev/ImprovementQueue.ts`)).default.getInstance();
  const loop = (await import(`${origin}/src/core/selfdev/SelfDevelopmentLoop.ts`)).default.getInstance();
  const Tab = (await import(`${origin}/src/app/scene/genesis/DevelopmentRecordTab.tsx`)).default;

  // The loop's develop() needs the runtime; this test is about the gates, so
  // Gate 1's approve() is observed (status) and its background run stubbed.
  loop.develop = async () => null;

  const make = (subject, status) => queue.add({
    title: `Fix ${subject}`, problem: `What does ${subject} contribute?`, observation: `${subject} miscounts.`,
    evidence: `Read ${subject}.\nFAILING count check`, proposedSolution: `Correct the count in ${subject}.`,
    expectedBenefit: "Right count.", dependencies: [], risk: "low", requiredTools: [], requiredAgents: [],
    complexity: "low", kind: "Bug", version: "1", testPlan: "tests/x.test.ts",
    origin: { kind: "self-study", objectiveId: `browser-${subject}`, subject, cycle: 3 }, status,
  });
  const proposed = make("src/core/demo/GateOne.ts", "Proposed");
  const ready = make("src/core/demo/GateTwo.ts", "Ready");
  queue.update(ready.id, { lastExecution: { executionId: "e", kind: "develop", started: 1, finished: 2, filesInspected: ["src/a.ts"], filesChanged: ["src/a.ts"], checks: [{ name: "test", ok: true, detail: "3/3 pass" }], diff: "--- a/src/a.ts\n+++ b/src/a.ts\n-1\n+2" } });

  const root = document.getElementById("root");
  createRoot(root).render(React.createElement(Tab));
  await new Promise((resolve) => setTimeout(resolve, 400));
  window.__ids = { proposed: proposed.id, ready: ready.id };
  return { entries: document.querySelectorAll('[data-testid="development-entry"]').length };
}, base);

const status = (id) => page.evaluate(async ([origin, id]) => {
  const queue = (await import(`${origin}/src/core/selfdev/ImprovementQueue.ts`)).default.getInstance();
  const p = queue.get(id);
  return { status: p?.status, decision: p?.ownerDecision?.decision ?? null, note: p?.ownerDecision?.note ?? null, history: (p?.ownerFeedbackHistory ?? []).map((d) => d.note) };
}, [base, id]);
const ids = await page.evaluate(() => window.__ids);
const steps = [];
const card = (stage) => page.locator(`[data-testid="development-entry"][data-stage="${stage}"]`).first();

await page.screenshot({ path: `${out}/01-both-gates.png`, fullPage: true });
steps.push({ step: "rendered", entries: results.entries, stages: await page.locator('[data-testid="development-entry"]').evaluateAll((els) => els.map((e) => e.dataset.stage)) });

// Gate 2: "Return with feedback" is disabled until feedback is written.
const returnButton = card("awaiting-acceptance").getByRole("button", { name: "Return with feedback" });
steps.push({ step: "return disabled without feedback", disabled: await returnButton.isDisabled() });
await card("awaiting-acceptance").getByLabel("Feedback").fill("The count is still off by one on an empty list.");
await returnButton.click();
await page.waitForTimeout(300);
steps.push({ step: "returned", ...(await status(ids.ready)), stageShown: await card("returned").count() });
steps.push({ step: "develop-again offered on returned", visible: await card("returned").getByRole("button", { name: "Develop again with your feedback" }).isVisible() });
await page.screenshot({ path: `${out}/02-returned.png`, fullPage: true });

// Gate 2: accept.
await card("returned").getByRole("button", { name: "Accept (Gate 2)" }).click();
await page.waitForTimeout(300);
steps.push({ step: "accepted", ...(await status(ids.ready)), stageShown: await card("accepted").count() });
steps.push({ step: "no gate buttons once accepted", buttons: await card("accepted").getByRole("button", { name: /Accept|Return|Develop again|Approve/ }).count() });
// The accepted implementation cannot be replaced from here or from the loop.
const retry = await page.evaluate(async ([origin, id]) => {
  const loop = (await import(`${origin}/src/core/selfdev/SelfDevelopmentLoop.ts`)).default.getInstance();
  delete loop.develop; // the real develop(), with its Gate 2 guard
  const result = await loop.retry(id);
  return { success: result.success, summary: result.summary };
}, [base, ids.ready]);
steps.push({ step: "retry after acceptance refused", ...retry, ...(await status(ids.ready)) });

// Gate 1: approve. (Its background development run is stubbed again: this
// test is about the gate; the real run is the experiment's.)
await page.evaluate(async (origin) => {
  const loop = (await import(`${origin}/src/core/selfdev/SelfDevelopmentLoop.ts`)).default.getInstance();
  loop.develop = async () => null;
}, base);
await card("awaiting-approval").getByRole("button", { name: "Approve (Gate 1)" }).click();
await page.waitForTimeout(300);
steps.push({ step: "approved at Gate 1", ...(await status(ids.proposed)) });
await page.screenshot({ path: `${out}/03-after-gates.png`, fullPage: true });

await browser.close();
const summary = { base, steps, pageErrors: errors, blockedRequests: blocked };
writeFileSync(`${out}/result.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
