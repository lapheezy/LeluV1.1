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
const LIMIT_MS = Number(process.env.LELU_SELF_IMPROVE_LIMIT_MS ?? 60 * 60 * 1000);
// At most this many neutral go-aheads. Four cut run 19 off mid-iteration,
// right after the edits that worked and before she could validate them.
const MAX_GO_AHEADS = 8;

const REQUEST = [
  "LÉLU, please improve your own interface using your self-development loop.",
  "1) Look at your own running app at phone size with browser_capture (target \"app\") — check several panels, not just the home screen.",
  "2) From the screenshots and layout reports, choose ONE concrete, low-risk problem a user would actually hit. Tell me the problem and a testable expected outcome before you change anything.",
  "3) Make a workspace copy (project_copy), find the code responsible (project_search, project_read), and fix it there with project_write. Do not change the real project.",
  "4) Validate the copy with project_validate (typecheck). If it fails, read the output and fix it.",
  "5) Start a preview of your copy (project_preview) and capture it under the same conditions (browser_capture target \"preview\", same viewport and panel), then compare it with the original capture.",
  "6) If the comparison shows the problem is still there, find out why, change your fix, validate and compare again — keep going until the comparison shows it resolved, or until you have genuinely tried three different approaches. Decide the approach yourself; don't stop to ask me.",
  "7) Show me the diff (project_diff) and tell me plainly whether your expected outcome is met, based on the evidence.",
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
const pageNow = () => page.evaluate(() => Date.now());
let sentAt = await pageNow();
await page.fill("[data-lelu-composer] textarea", REQUEST);
await page.keyboard.press("Enter");
const started = Date.now();
console.log(`[${new Date().toISOString()}] request sent; recording to ${OUT}`);

/** Wait for the turn started by `message` to end; returns its end event or null. */
async function waitForTurn(message, deadline, since) {
  // Only an end AFTER this message was sent: every go-ahead has the same
  // text, and matching an earlier one's end fired the next go-ahead while
  // she was still working (measured in run 13: three go-aheads 5 s apart).
  // `since` is taken BEFORE sending: an offline reply can end the turn in
  // under a second, before a timestamp taken afterwards (run 18 waited out
  // its whole time limit for an end that had already happened).
  let lastCount = -1;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    const state = await page.evaluate(({ head, since }) => {
      const events = window.__selfImprove.events;
      const end = events.find((e) => e.at >= since && (e.type === "task_completed" || e.type === "task_failed") && (e.label ?? "").startsWith(head));
      return { count: events.length, end: end ?? null, tools: events.filter((e) => e.type === "tool_started").map((e) => e.tool) };
    }, { head: message.slice(0, 40), since });
    if (state.count !== lastCount) {
      console.log(`  +${Math.round((Date.now() - started) / 1000)}s  ${state.count} events; tools so far: ${state.tools.join(", ")}`);
      lastCount = state.count;
    }
    if (state.end) return state.end;
  }
  return null;
}

/** Her replies, from the conversation store (not from whatever covers the screen). */
const replies = () =>
  page.evaluate(async () => {
    const { default: Store } = await import("/src/core/multichat/MultiChatStore.ts");
    const store = Store.getInstance();
    const conversation = store.get(store.getActiveId());
    return (conversation?.messages ?? []).map((m) => ({ role: m.role, text: m.text }));
  });

// A neutral go-ahead when she pauses or stops short — it names no problem,
// file or fix. At most MAX_GO_AHEADS.
const GO_AHEAD = "Go ahead — carry out the rest of the loop yourself and report back with the evidence.";
const deadline = started + LIMIT_MS;
let finished = null;
try {
finished = await waitForTurn(REQUEST, deadline, sentAt);
// "Done" is what her own event bus shows she RAN — a validation, a capture
// of her preview and a diff — never what a reply says she did.
const loopDone = () =>
  page.evaluate(() => {
    const ran = (tool, pred = () => true) => window.__selfImprove.events.some((e) => e.type === "tool_result" && e.tool === tool && pred(e));
    return {
      validated: ran("project.validate"),
      previewCaptured: ran("capture", (e) => /preview|5310|layout finding/i.test(e.result ?? "")) && window.__selfImprove.events.some((e) => e.type === "tool_started" && e.tool === "capture" && /workspace/.test(e.label ?? "")),
      diffed: ran("project.diff"),
    };
  });
// Her turn ended by offering to go on and asking permission ("Let me know
// if you'd like me to try one of them") although the request says "decide
// the approach yourself; don't stop to ask me" — measured in run 17, which
// stopped after two approaches with the third named but not tried. The
// answer is the same neutral go-ahead; whether to continue stays hers.
const asksToContinue = async () => {
  const messages = await replies().catch(() => []);
  const last = [...messages].reverse().find((m) => m.role !== "user");
  return /let me know|would you like|shall i|should i|want me to|i can (?:proceed|continue|try)/i.test((last?.text ?? "").slice(-600));
};
for (let nudge = 0; nudge < MAX_GO_AHEADS && finished && Date.now() < deadline; nudge += 1) {
  const done = await loopDone();
  if (done.validated && done.previewCaptured && done.diffed && !(await asksToContinue())) break;
  console.log(`  her turn ended; recorded so far ${JSON.stringify(done)} — sending the go-ahead (${nudge + 1}/${MAX_GO_AHEADS})`);
  await page.evaluate(async () => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "self-improvement run", initiatedBy: "user" });
  });
  if (!(await page.isVisible("[data-lelu-composer] textarea").catch(() => false))) {
    // Something owns the screen. Record what, then go back the way a user
    // would: the module's own "Back to chat" control.
    await page.screenshot({ path: path.join(OUT, `screen-before-go-ahead-${nudge + 1}.png`) });
    const owner = await page.evaluate(() => [...document.querySelectorAll("[data-module-id], [data-lelu-module]")].map((el) => el.getAttribute("data-module-id") ?? el.getAttribute("data-lelu-module")).join(","));
    console.log(`  composer hidden; on screen: ${owner || "(unknown)"} — using Back to chat`);
    await page.getByRole("button", { name: /back to chat/i }).first().click({ timeout: 5000, force: true }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector("[data-lelu-composer] textarea", { state: "visible", timeout: 20000 });
  sentAt = await pageNow();
  await page.fill("[data-lelu-composer] textarea", GO_AHEAD);
  await page.keyboard.press("Enter");
  finished = await waitForTurn(GO_AHEAD, deadline, sentAt);
}
} catch (error) {
  console.log(`  run interrupted: ${String(error).split("\n")[0]}`);
  await page.screenshot({ path: path.join(OUT, "screen-at-interruption.png") }).catch(() => {});
}

await page.waitForTimeout(3000);
const record = await page.evaluate(() => window.__selfImprove).catch(() => ({ events: [], images: [] }));
// Evidence is written even when the server has gone away (measured in
// run 12: the dev server exited mid-run and the recorder crashed before
// saving anything). What could not be read is said so in the files.
const transcript = await replies()
  .then((messages) => messages.map((m) => `── ${m.role.toUpperCase()} ──\n${m.text}`).join("\n\n"))
  .catch((error) => `(the conversation could not be read: ${String(error).split("\n")[0]})`);
// Whatever workspace SHE created: read its diff back from the runtime —
// before this run writes any evidence file into the project.
const workspaces = [...new Set(record.events.filter((e) => e.type === "tool_result" && e.tool === "project.copy").map((e) => /workspace\s+["“]?([A-Za-z0-9._-]+)/i.exec(e.result ?? "")?.[1]).filter(Boolean))];
const diffs = {};
for (const workspace of workspaces) {
  const response = await page
    .evaluate(async (ws) => {
      const r = await fetch("/api/engineer/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "diff", workspace: ws, includePatch: true }) });
      return r.json();
    }, workspace)
    .catch((error) => ({ ok: false, error: `the diff could not be read: ${String(error).split("\n")[0]}` }));
  diffs[workspace] = response;
}

for (const [workspace, response] of Object.entries(diffs)) {
  const patch = (response.changes ?? []).map((c) => `--- ${c.path} (${c.status}, +${c.addedLines}/-${c.removedLines})\n${c.patch ?? ""}`).join("\n");
  writeFileSync(path.join(OUT, `diff-${workspace}.patch.txt`), patch || (response.error ? `(${response.error})\n` : "(no changes)\n"));
}
// Written only now: the diff above compares her copy with the real
// project, and evidence files written earlier would show up in it as
// changes of hers (measured in runs 8 and 10).
writeFileSync(path.join(OUT, "request.txt"), REQUEST + "\n");
writeFileSync(path.join(OUT, "transcript.txt"), transcript);
writeFileSync(path.join(OUT, "events.json"), JSON.stringify(record.events, null, 2));
record.images.forEach((img, i) => {
  const match = /^data:image\/(\w+);base64,(.*)$/.exec(img.image);
  if (match) writeFileSync(path.join(OUT, `capture-${String(i + 1).padStart(2, "0")}.${match[1] === "jpeg" ? "jpg" : match[1]}`), Buffer.from(match[2], "base64"));
});

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
