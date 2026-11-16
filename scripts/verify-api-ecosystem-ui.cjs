/**
 * Drive the real LÉLU app in a real browser for the API-ecosystem evidence.
 *
 *   node scripts/verify-api-ecosystem-ui.cjs <device|desktop> <outDir> "<prompt>"
 *       A REAL chat turn (real model provider, real knowledge sources), then the
 *       Settings → Usage & budgets view. Writes chat-*.png, usage-*.png and the
 *       recorded ledger (ledger-*.json).
 *
 *   node scripts/verify-api-ecosystem-ui.cjs <device|desktop> <outDir> --replay <ledger.json>
 *       NO chat turn: loads a ledger recorded by a real run, then captures the
 *       usage view. Used for layout checks at more viewports without paying for
 *       more model calls. Screenshots from this mode are labelled "replayed".
 *
 * Needs the dev server on http://127.0.0.1:5173 (npm run dev).
 */
const fs = require("node:fs");
const { chromium, devices } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const [kind, outDir, promptOrFlag, replayFile] = process.argv.slice(2);
const replay = promptOrFlag === "--replay";
const tag = kind.replace(/\s/g, "");

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = kind === "desktop"
    ? await browser.newContext({ viewport: { width: 1440, height: 900 } })
    : await browser.newContext({ ...devices[kind] });
  if (replay) {
    const seed = fs.readFileSync(replayFile, "utf8");
    await ctx.addInitScript((value) => {
      if (!sessionStorage.getItem("lelu-replay")) {
        localStorage.setItem("lelu.usage.v1", value);
        sessionStorage.setItem("lelu-replay", "1");
      }
    }, seed);
  }
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("response", (r) => {
    const u = r.url();
    if (/dictionaryapi|openlibrary|frankfurter|earthquake\.usgs|\/api\/model\/.+\/chat/.test(u)) calls.push(`${r.status()} ${u.slice(0, 100)}`);
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "attached", timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    [...(gate?.querySelectorAll("button") ?? [])].find((b) => /Continue/.test(b.innerText))?.click();
  });
  await page.waitForTimeout(3000);
  const openPanel = (target) => page.evaluate(async (t) => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    return Bus.getInstance().dispatch({ type: "open_panel", target: t, reason: "verify", initiatedBy: "lelu" });
  }, target);

  if (!replay) {
    await openPanel("chat");
    await page.waitForSelector("[data-lelu-composer] textarea", { state: "visible", timeout: 15000 });
    await page.locator("[data-lelu-composer] textarea").fill(promptOrFlag);
    await page.getByRole("button", { name: "Send message" }).click({ noWaitAfter: true });
    await page.waitForFunction(() => {
      try { return (JSON.parse(localStorage.getItem("lelu.usage.v1") || "{}").events || []).some((e) => e.kind === "ai"); } catch { return false; }
    }, null, { timeout: 120000 }).catch(() => errors.push("no AI call recorded within 120 s"));
    await page.waitForTimeout(15000);
    await page.screenshot({ path: `${outDir}/chat-${tag}.png`, timeout: 60000 });
    fs.writeFileSync(`${outDir}/ledger-${tag}.json`, (await page.evaluate(() => localStorage.getItem("lelu.usage.v1"))) || "{}");
    await page.click("button[aria-label='Close chat']", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
  }

  await openPanel("settings").catch((e) => errors.push(`settings: ${e}`));
  await page.waitForTimeout(1500);
  const usage = page.getByTestId("usage-section");
  await usage.scrollIntoViewIfNeeded().catch((e) => errors.push(`usage: ${e}`));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/usage-${tag}${replay ? "-replayed" : ""}.png`, timeout: 60000 });
  const layout = await page.evaluate(() => {
    const el = document.querySelector("[data-testid=usage-section]");
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    const overflowing = [...el.querySelectorAll("*")].filter((c) => c.getBoundingClientRect().right > innerWidth + 1).length;
    return { present: true, viewport: [innerWidth, innerHeight], left: Math.round(r.left), right: Math.round(r.right), horizontalOverflow: el.scrollWidth > el.clientWidth + 1, childrenPastViewport: overflowing };
  });
  const ledger = JSON.parse((await page.evaluate(() => localStorage.getItem("lelu.usage.v1"))) || "{}");
  console.log(JSON.stringify({ kind, replay, errors, calls, layout, events: (ledger.events || []).map((e) => ({ kind: e.kind, source: e.source, ok: e.ok, results: e.results, latencyMs: e.latencyMs, in: e.inputTokens, out: e.outputTokens, cost: e.costKind, error: e.error })) }, null, 1));
  await browser.close();
})();
