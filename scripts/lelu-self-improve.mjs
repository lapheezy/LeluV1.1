/**
 * LÉLU — SELF-IMPROVEMENT ACCEPTANCE RUN
 *
 * What this script does, and ONLY this:
 *   1. opens the real app (dev server) at phone size and the real chat;
 *   2. sends LÉLU one request, typed into her composer — a request that
 *      names no bug, no file and no fix;
 *   3. records, from her own event bus, every tool she calls and what
 *      it returned, every screenshot she captures, and her final reply;
 *   4. when she is done, reads back the diff of whatever workspace copy
 *      SHE created, from the engineering runtime.
 *
 * It does not edit code, pick the problem, or judge the outcome. The
 * work, the choice and the verdict are hers; the evidence is saved to
 * docs/evidence/self-improve/<stamp>/ so it can be checked.
 *
 * Usage: node scripts/lelu-self-improve.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const LIMIT_MS = Number(process.env.LELU_SELF_IMPROVE_LIMIT_MS ?? 35 * 60 * 1000);

const REQUEST = [
  "LÉLU, please improve your own interface using your self-development loop.",
  "1) Look at your own running app at phone size with browser_capture (target \"app\") — check several panels, not just the home screen.",
  "2) From the screenshots and layout reports, choose ONE concrete, low-risk problem a user would actually hit. Tell me the problem and a testable expected outcome before you change anything.",
  "3) Make a workspace copy (project_copy), find the code responsible (project_search, project_read), and fix it there with project_write. Do not change the real project.",
  "4) Validate the copy with project_validate (typecheck). If it fails, read the output and fix it.",
  "5) Start a preview of your copy (project_preview) and capture it the same way (browser_capture target \"preview\"), then compare it with the original capture.",
  "6) Show me the diff (project_diff) and tell me plainly whether your expected outcome is met, based on the evidence.",
].join("\n");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join("docs", "evidence", "self-improve", stamp);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
for (let i = 0; i < 6; i += 1) {
  const gate = page.locator("[data-lelu-signin-gate] button", { hasText: "Continue" });
  if (await gate.count()) await gate.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
}

// The recorder: LÉLU's own event bus, read-only.
await page.evaluate(async () => {
  const { default: Bus } = await import("/src/core/agent/AgentEvents.ts");
  window.__selfImprove = { events: [], images: [] };
  Bus.getInstance().subscribe((event) => {
    const record = { at: Date.now(), type: event.type };
    for (const key of ["taskId", "tool", "label", "error", "status", "agent", "objective", "url"]) {
      if (key in event && event[key] !== undefined) record[key] = String(event[key]).slice(0, 400);
    }
    if (event.type === "tool_result" && typeof event.result === "string") record.result = event.result.slice(0, 2000);
    if (event.type === "creative_artifact") {
      window.__selfImprove.images.push({ at: record.at, label: event.label, image: event.image });
      record.image = `#${window.__selfImprove.images.length}`;
    }
    window.__selfImprove.events.push(record);
  });
});

await page.evaluate(async () => {
  const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
  Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "self-improvement run", initiatedBy: "user" });
});
await page.waitForSelector("[data-lelu-composer] textarea", { state: "visible", timeout: 20000 });
await page.fill("[data-lelu-composer] textarea", REQUEST);
await page.keyboard.press("Enter");
const started = Date.now();
console.log(`[${new Date().toISOString()}] request sent; recording to ${OUT}`);

// Wait for her turn to end: the task for this message completes or fails.
let finished = null;
let lastCount = 0;
while (Date.now() - started < LIMIT_MS) {
  await page.waitForTimeout(5000);
  const state = await page.evaluate((head) => {
    const events = window.__selfImprove.events;
    const end = events.find((e) => (e.type === "task_completed" || e.type === "task_failed") && (e.label ?? "").startsWith(head));
    return { count: events.length, end: end ?? null, tools: events.filter((e) => e.type === "tool_started").map((e) => e.tool) };
  }, REQUEST.slice(0, 40));
  if (state.count !== lastCount) {
    console.log(`  +${Math.round((Date.now() - started) / 1000)}s  ${state.count} events; tools so far: ${state.tools.join(", ")}`);
    lastCount = state.count;
  }
  if (state.end) {
    finished = state.end;
    break;
  }
}

await page.waitForTimeout(3000);
const record = await page.evaluate(() => window.__selfImprove);
const transcript = await page.evaluate(() => {
  const chat = [...document.querySelectorAll("[data-lelu-chat-window]")].find((el) => getComputedStyle(el).display !== "none");
  return chat ? chat.innerText : document.body.innerText;
});
writeFileSync(path.join(OUT, "request.txt"), REQUEST + "\n");
writeFileSync(path.join(OUT, "transcript.txt"), transcript);
writeFileSync(path.join(OUT, "events.json"), JSON.stringify(record.events, null, 2));
record.images.forEach((img, i) => {
  const match = /^data:image\/(\w+);base64,(.*)$/.exec(img.image);
  if (match) writeFileSync(path.join(OUT, `capture-${String(i + 1).padStart(2, "0")}.${match[1] === "jpeg" ? "jpg" : match[1]}`), Buffer.from(match[2], "base64"));
});

// Whatever workspace SHE created: read its diff back from the runtime.
const workspaces = [...new Set(record.events.filter((e) => e.type === "tool_result" && e.tool === "project.copy").map((e) => /workspace\s+["“]?([A-Za-z0-9._-]+)/i.exec(e.result ?? "")?.[1]).filter(Boolean))];
const diffs = {};
for (const workspace of workspaces) {
  const response = await page.evaluate(async (ws) => {
    const r = await fetch("/api/engineer/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "diff", workspace: ws, includePatch: true }) });
    return r.json();
  }, workspace);
  diffs[workspace] = response;
  const patch = (response.changes ?? []).map((c) => `--- ${c.path} (${c.status}, +${c.addedLines}/-${c.removedLines})\n${c.patch ?? ""}`).join("\n");
  writeFileSync(path.join(OUT, `diff-${workspace}.patch.txt`), patch || "(no changes)\n");
}

const summary = {
  base: BASE,
  startedAt: new Date(started).toISOString(),
  durationSeconds: Math.round((Date.now() - started) / 1000),
  finished: finished ? finished.type : "time limit reached",
  toolCalls: record.events.filter((e) => e.type === "tool_started").map((e) => `${e.tool}: ${e.label ?? ""}`),
  failures: record.events.filter((e) => e.type === "tool_failed" || (e.type === "tool_result" && e.status === "error")).map((e) => `${e.tool}: ${e.error ?? e.result ?? ""}`.slice(0, 300)),
  captures: record.images.length,
  workspaces,
  changedFiles: Object.fromEntries(Object.entries(diffs).map(([ws, d]) => [ws, (d.changes ?? []).map((c) => `${c.path} +${c.addedLines}/-${c.removedLines}`)])),
  pageErrors,
};
writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
