/**
 * LÉLU — WHAT ONE MESSAGE COSTS
 *
 * Phase 6 moved the scene consumers behind a second, deliberately
 * stable context so a streamed token would stop re-rendering the 3D
 * scene, and moved the conversation's persistence behind a coalescing
 * writer so a token would stop saving the whole workspace. The storage
 * half was measurable. The render half was not: in a GPU-less container
 * the page runs through SwiftShader, and a CPU profile put 20.6s of
 * 26.6s in `(program)` — shader compilation — so long-task counts said
 * nothing about React at all. The improvement was reported as real but
 * UNPROVEN, which is where this script comes from.
 *
 * It measures the two things the claim is actually about, neither of
 * which needs a GPU:
 *
 *   RENDERS — the dev render ledger in useGenesisScene counts every
 *   useGenesis() and useGenesisScene() call. Scene consumers should be
 *   flat across a turn while chat consumers climb.
 *
 *   WRITES — Storage.setItem, with the key and byte count, so the
 *   persistence cost of one turn is attributed rather than estimated.
 *
 * Usage: dev server running, then
 *        node scripts/measure-render-cost.mjs [url]
 *
 * It prints measurements and exits 0. The assertions that must not
 * regress live in tests/write-cascades.test.ts and the verify scripts;
 * this is the instrument, not the gate.
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:5173";
const PROMPT = "Tell me in one sentence what you are working on.";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Instrument storage before any application code runs.
await page.addInitScript(() => {
  window.__writes = [];
  const proto = Object.getPrototypeOf(localStorage);
  const real = proto.setItem;
  // One KvStore.set writes to localStorage AND sessionStorage, so the
  // backend is recorded and only one of them is counted as a save.
  // Long tasks, for completeness and for honesty about what they are
  // worth here: in a GPU-less container they are dominated by
  // SwiftShader compiling shaders, so they move with the renderer, not
  // with React. Reported alongside the render ledger rather than
  // instead of it.
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
    }).observe({ entryTypes: ["longtask"] });
  } catch { /* not every build exposes it */ }

  proto.setItem = function (key, value) {
    try {
      window.__writes.push({
        key: String(key),
        bytes: String(value ?? "").length,
        session: this === window.sessionStorage,
      });
    } catch { /* never break the app to measure it */ }
    return real.call(this, key, value);
  };
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page
  .waitForFunction(() => (document.querySelector("#root")?.children.length ?? 0) > 0, { timeout: 40000 })
  .catch(() => {});
await page.waitForTimeout(5000);

// The real first-run choice, not a test shortcut.
await page.evaluate(() => {
  const gate = document.querySelector("[data-lelu-signin-gate]");
  const button = gate && [...gate.querySelectorAll("button")].find((b) => /Continue/.test(b.innerText));
  button?.click();
});
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('[aria-label="LÉLU"]')?.click());
await page.waitForTimeout(3000);

const composer = await page.$("[data-lelu-composer] textarea, [data-lelu-composer] input");
if (!composer) {
  console.error("The chat never opened, so there is nothing to measure.");
  await browser.close();
  process.exit(1);
}

const ledger = () =>
  page.evaluate(() => {
    const l = window.__leluRenderLedger ?? { scene: 0, chat: 0, by: {} };
    return { scene: l.scene, chat: l.chat, by: { ...(l.by ?? {}) } };
  });

// Let boot settle so the turn is measured, not the page load.
await page.waitForTimeout(3000);
const before = await ledger();
await page.evaluate(() => { window.__writes.length = 0; });

await page.evaluate((value) => {
  const box = document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input");
  const setter = Object.getOwnPropertyDescriptor(
    box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(box, value);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}, PROMPT);
await page.waitForTimeout(400);
const started = Date.now();
await page.evaluate(() => {
  document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
});

// Wait for the turn to finish rather than for a fixed time: a reply from
// a live model takes as long as it takes, and the numbers mean nothing if
// they are cut off halfway.
const finished = await page
  .waitForFunction(
    () => {
      const send = document.querySelector("[data-lelu-composer] [data-lelu-sending]");
      return Boolean(send) && send.getAttribute("data-lelu-sending") !== "true";
    },
    { timeout: 120000 },
  )
  .then(() => true)
  .catch(() => false);
// A moment for the final flush and the last commit.
await page.waitForTimeout(2000);

const after = await ledger();
const writes = await page.evaluate(() => window.__writes);
const longTasks = await page.evaluate(() => [...(window.__longTasks ?? [])]);
const elapsed = Date.now() - started;

const saves = writes.filter((w) => !w.session);
const byKey = new Map();
for (const w of saves) {
  const row = byKey.get(w.key) ?? { key: w.key, saves: 0, bytes: 0 };
  row.saves += 1;
  row.bytes += w.bytes;
  byKey.set(w.key, row);
}

console.log(`\n=== ONE TURN  (${(elapsed / 1000).toFixed(1)}s${finished ? "" : ", DID NOT FINISH"}) ===`);
console.log("\nCONSUMER RENDERS");
console.log(`  chat consumers   ${after.chat - before.chat}`);
console.log(`  scene consumers  ${after.scene - before.scene}`);
console.log(
  after.scene - before.scene === 0
    ? "  → a token cost the 3D scene nothing."
    : `  → the scene re-rendered ${after.scene - before.scene} times during one message.`,
);
const perConsumer = Object.keys({ ...before.by, ...after.by })
  .map((key) => [key, (after.by[key] ?? 0) - (before.by[key] ?? 0)])
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]);
if (perConsumer.length > 0) {
  console.log("\n  by consumer");
  for (const [key, n] of perConsumer) console.log(`    ${String(n).padStart(5)}  ${key}`);
}

console.log("\nPERSISTENCE  (saves, not setItem calls — each save writes two backends)");
let totalSaves = 0;
let totalBytes = 0;
for (const row of [...byKey.values()].sort((a, b) => b.bytes - a.bytes)) {
  console.log(`  ${String(row.saves).padStart(4)}  ${String(row.bytes).padStart(8)}B  ${row.key}`);
  totalSaves += row.saves;
  totalBytes += row.bytes;
}
console.log(`  ${String(totalSaves).padStart(4)}  ${String(totalBytes).padStart(8)}B  TOTAL`);

const blocked = longTasks.reduce((sum, ms) => sum + ms, 0);
console.log(`\nLONG TASKS (whole session)  ${longTasks.length} tasks, ${blocked}ms blocked`);
console.log(
  "  Reported, not relied on. This container renders through SwiftShader,\n" +
    "  so shaders compile on the CPU: a profile attributed 20.6s of 26.6s to\n" +
    "  `(program)`, native rather than JavaScript. These numbers move with the\n" +
    "  software renderer and say little about React. The render ledger above is\n" +
    "  the measurement of the thing actually changed.",
);

if (!finished) {
  console.log(
    "\nThe turn had not finished when the timeout expired, so these are a " +
      "lower bound rather than the cost of a complete turn.",
  );
}

await browser.close();
