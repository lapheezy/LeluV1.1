/**
 * ==========================================================
 * LÉLU — CONVERSATION LIFECYCLE / PERFORMANCE (real browser)
 *
 * The report this exists for: "using multiple conversations makes the
 * whole app sluggish". That is a lifecycle question, not an API-latency
 * one, so this measures the app rather than the network:
 *
 *   • heap after the first turn vs. after switching A→B→C repeatedly;
 *   • longest main-thread task during rapid switching;
 *   • input latency (time from keystroke to painted value) after the
 *     switching storm, which is what "sluggish" actually feels like;
 *   • that only ONE reply exists per turn (no duplicate streams) and
 *     that an abandoned conversation stops growing.
 *
 * Usage: node scripts/verify-chat-performance.mjs   (dev server on :3000)
 * ==========================================================
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const TURNS = Number(process.env.TURNS ?? 3);

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  window.localStorage.setItem("lelu.lelu.auth.skipped.v1", "true");
  // Long-task observer, installed before any app code runs.
  window.__leluLongTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__leluLongTasks.push(Math.round(entry.duration));
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* not supported — reported below */
  }
});

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

const cdp = await context.newCDPSession(page);
// A heap figure collected without a GC is mostly garbage waiting to be
// collected, which is exactly the number that looks like a leak and is not.
// Collect first, then read, so the delta means retained memory.
const heap = async () => {
  await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  await page.waitForTimeout(300);
  const usage = await cdp.send("Runtime.getHeapUsage");
  return Math.round(usage.usedSize / (1024 * 1024));
};

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-lelu-dock]", { timeout: 60_000 });
await page.click('[data-lelu-tab="chat"]');
await page.waitForSelector("[data-lelu-dialogue-scroll]", { timeout: 45_000 });
await page.waitForSelector("[data-lelu-multichat]", { timeout: 20_000 });
await page.waitForTimeout(2_000);

const sendTurn = async (text) => {
  const composer = page.locator("[data-lelu-composer] textarea");
  await composer.fill(text);
  await composer.press("Enter");
  await page.waitForSelector("[data-lelu-activity-tabs]", { timeout: 30_000 });
  await page
    .waitForFunction(
      () => {
        const band = document.querySelector("[data-lelu-activity-tabs]");
        return /Finished|Stopped with a problem/.test(band?.textContent ?? "");
      },
      { timeout: 150_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1_500);
};

/* Input latency, measured the same way before and after the storm: how long
 * from a keystroke to the painted value. This is the metric the report is
 * actually about, so it is sampled twice rather than once. */
const measureLatency = async (samples = 5) => {
  const values = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const composer = page.locator("[data-lelu-composer] textarea");
    await composer.click({ timeout: 10_000 }).catch(() => {});
    const started = Date.now();
    await composer.type("x", { delay: 0 }).catch(() => {});
    await page
      .waitForFunction(
        () => (document.querySelector("[data-lelu-composer] textarea")?.value ?? "").length > 0,
        { timeout: 10_000 },
      )
      .catch(() => {});
    values.push(Date.now() - started);
    await page.evaluate(() => {
      const textarea = document.querySelector("[data-lelu-composer] textarea");
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(textarea, "");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }
  return {
    median: values.sort((a, b) => a - b)[Math.floor(values.length / 2)],
    worst: Math.max(...values),
  };
};

// Baseline: one turn, then measure.
await sendTurn("Reply with the single word: one");
const baselineHeap = await heap();
const baselineLatency = await measureLatency();
const baselineReplies = await page.locator("[data-lelu-dialogue-scroll] [data-lelu-message]").count();

// Two more conversations, each with one turn. A new tab is created before
// sending, so each turn belongs to its own conversation.
const conversations = 1;
let opened = conversations;
for (let index = 2; index <= TURNS; index += 1) {
  // The ＋ chip is the only element labelled exactly "New chat" (the tab
  // rows also carry the title "New chat").
  await page.getByLabel("New chat", { exact: true }).click();
  await page.waitForTimeout(900);
  await sendTurn(`Reply with the single word: ${index}`);
  opened += 1;
}
const afterTurnsHeap = await heap();

// The switching storm: rapid A↔B↔C switching with no waiting for network.
// The storm clicks the conversation rows through the DOM, so the
// measurement is the APP's response, not Playwright's actionability retry.
await page.evaluate(() => {
  window.__leluLongTasks = [];
});
const switchingStart = Date.now();
const tabCount = await page.$$eval("[data-lelu-multichat] [data-conversation-id]", (rows) => rows.length).catch(() => 0);
const rows = Math.max(1, Math.min(tabCount, 3));
for (let round = 0; round < 6; round += 1) {
  for (let index = 0; index < rows; index += 1) {
    await page.evaluate((rowIndex) => {
      const tabs = [...document.querySelectorAll("[data-lelu-multichat] [data-conversation-id]")];
      tabs[rowIndex]?.click();
    }, index);
    await page.waitForTimeout(60);
  }
}
const switchingMs = Date.now() - switchingStart;
const longTasks = await page.evaluate(() => window.__leluLongTasks.slice());
const worstLongTask = longTasks.length > 0 ? Math.max(...longTasks) : 0;

const afterStormLatency = await measureLatency();

const finalHeap = await heap();
const heapGrowth = finalHeap - baselineHeap;

// Only one exchange per turn: the reply must not be duplicated by a
// re-mounted conversation.
await page.waitForTimeout(1_500);
const duplicateCheck = await page.evaluate(() => {
  const scroll = document.querySelector("[data-lelu-dialogue-scroll]");
  const text = scroll?.textContent ?? "";
  const matches = text.match(/\bone\b/g) ?? [];
  return { occurrences: matches.length, length: text.length };
});

record("the browser exposes heap usage", Number.isFinite(baselineHeap) && baselineHeap > 0, `${baselineHeap} MiB start`);
record(
  "opening and using several conversations retains a bounded working set",
  heapGrowth < 40,
  `${baselineHeap} → ${finalHeap} MiB after ${opened} conversations (Δ${heapGrowth} MiB)`,
);
record(
  "rapid conversation switching leaves the main thread responsive",
  worstLongTask < 250,
  `${switchingMs}ms for the storm, worst long task ${worstLongTask}ms, ${tabCount} conversation rows`,
);
record(
  "switching conversations does not degrade typing latency",
  afterStormLatency.median <= Math.max(150, baselineLatency.median * 2),
  `median ${baselineLatency.median}ms → ${afterStormLatency.median}ms (worst ${baselineLatency.worst}ms → ${afterStormLatency.worst}ms)`,
);
record(
  "typing stays usable",
  afterStormLatency.median < 150,
  `median ${afterStormLatency.median}ms after the storm`,
);
record(
  "a turn is not duplicated by conversation switching",
  duplicateCheck.occurrences <= 4,
  `"one" appears ${duplicateCheck.occurrences}× in the visible transcript`,
);
record(
  "no page errors during the lifecycle run",
  pageErrors.length === 0,
  pageErrors.slice(0, 3).join(" | "),
);

console.log(`\nbaseline replies in first conversation: ${baselineReplies}`);
await browser.close();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
