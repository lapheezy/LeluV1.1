/**
 * ==========================================================
 * LÉLU — BROWSE → WORKSPACE → FOLLOW-UP → CHANGE → INSPECT
 *
 * End to end in the running app, with her real model and real tools.
 * The user's messages name what they want, never a tool's arguments or
 * an answer. Every check reads the app's own state (WorkspaceEngine, the
 * conversation store) or the screen — never her reply's claims alone.
 *
 *   1. ask her to look at a real public page   → an artifact from a tool, with that page's content
 *   2. open the workspace, tap the artifact    → it is the user's selection, shown as such
 *   3. back in chat, the composer shows it     → "this" has a visible referent
 *   4. a follow-up about "this"                → answered from the artifact (its heading)
 *   5. ask her to change "this"                → artifact_edit ran; the SAME view has a new title, note and revision
 *   6. look again                              → the workspace shows the new revision
 *   7. the conversation is intact              → one conversation, every message in order
 *   8. phone: composer, chip and keyboard focus stay usable
 *
 * Usage: node scripts/verify-workspace-artifacts.mjs [base-url]
 * Evidence: docs/evidence/workspace-artifacts/<stamp>/
 * ==========================================================
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const PAGE_URL = "https://example.com/";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join("docs", "evidence", "workspace-artifacts", stamp);
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (viewport, check, pass, detail) => {
  results.push({ viewport, check, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${viewport}] ${check} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};

async function setup(name, viewport) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport, isMobile: name === "phone", hasTouch: name === "phone" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  const shot = (file) => page.screenshot({ path: path.join(OUT, `${name}-${file}.png`), timeout: 180_000 }).catch((e) => console.log(`  (screenshot ${file} failed: ${String(e).split("\n")[0]})`));
  const dismiss = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")].find((x) => x.textContent.trim() === "Continue");
    if (b) b.click();
    return Boolean(b);
  });
  const open = (target) => page.evaluate(async (t) => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    return Bus.getInstance().dispatch({ type: "open_panel", target: t, reason: "workspace acceptance", initiatedBy: "user" }).ok;
  }, target);
  const waitFor = async (predicate, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await predicate().catch(() => false)) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
  const workspace = () => page.evaluate(async () => {
    const { default: Engine } = await import("/src/core/workspace/WorkspaceEngine.ts");
    const s = Engine.getInstance().getState();
    return {
      selectedId: s.selectedId,
      focusId: s.focusId,
      views: s.views.map((v) => ({ id: v.id, kind: v.kind, title: v.title, revision: v.revision, source: v.source ?? null, text: (v.text ?? "").slice(0, 600), hasImage: typeof v.url === "string" && v.url.startsWith("data:image") })),
    };
  });
  const setFocus = (focus) => page.evaluate(async (f) => {
    const { default: Visual } = await import("/src/core/visual/VisualEngine.ts");
    Visual.getInstance().setInterfaceFocus(f);
  }, focus);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 16; i += 1) { await dismiss(); await page.waitForTimeout(500); }
  return { browser, page, errors, shot, dismiss, open, waitFor, workspace, setFocus };
}

/* ------------------------------ desktop: the flow ------------------------------ */
{
  const name = "desktop";
  const { browser, page, errors, shot, dismiss, open, waitFor, workspace, setFocus } = await setup(name, { width: 1280, height: 800 });

  // Her own event bus, read-only: which tools actually ran.
  await page.evaluate(async () => {
    const { default: Bus } = await import("/src/core/agent/AgentEvents.ts");
    window.__ws = { events: [] };
    Bus.getInstance().subscribe((event) => {
      window.__ws.events.push({ at: Date.now(), type: event.type, tool: event.tool ?? null, label: event.label ? String(event.label).slice(0, 200) : null, status: event.status ?? null });
    });
  });
  const toolsSince = (since) => page.evaluate((t) => window.__ws.events.filter((e) => e.at >= t && e.type === "tool_started").map((e) => e.tool), since);
  const conversation = () => page.evaluate(async () => {
    const { default: Store } = await import("/src/core/multichat/MultiChatStore.ts");
    const store = Store.getInstance();
    const c = store.get(store.getActiveId());
    return { id: c?.id ?? null, messages: (c?.messages ?? []).map((m) => ({ role: m.role, text: m.text })) };
  });
  /** Send as the user and wait for her reply to land in the conversation. */
  const say = async (text, ms = 240_000) => {
    await open("chat");
    await dismiss();
    await page.waitForSelector("[data-lelu-composer] textarea", { state: "visible", timeout: 30_000 });
    const before = (await conversation()).messages.length;
    const since = await page.evaluate(() => Date.now());
    await page.fill("[data-lelu-composer] textarea", text);
    await page.keyboard.press("Enter");
    const ended = await waitFor(async () => {
      const ends = await page.evaluate((t) => window.__ws.events.filter((e) => e.at >= t && (e.type === "task_completed" || e.type === "task_failed")).length, since);
      const c = await conversation();
      return ends > 0 && c.messages.length >= before + 2 && c.messages[c.messages.length - 1].role === "assistant" && c.messages[c.messages.length - 1].text.trim().length > 0;
    }, ms);
    const c = await conversation();
    const reply = c.messages[c.messages.length - 1]?.role === "assistant" ? c.messages[c.messages.length - 1].text : "";
    return { ended, reply, tools: await toolsSince(since) };
  };

  const first = await conversation();

  // 1. a real page, through her tools, into the workspace
  const t1 = await say(`Please look at ${PAGE_URL} for me and put it in the workspace so we can work on it together.`);
  writeFileSync(path.join(OUT, "reply-1.txt"), t1.reply);
  const ws1 = await workspace();
  const fromPage = ws1.views.filter((v) => v.source && /example\.com/.test(v.source.url ?? "") && ["capture", "browser"].includes(v.source.tool));
  const artifact = fromPage.find((v) => v.hasImage) ?? fromPage.find((v) => /Example Domain/i.test(`${v.title} ${v.text}`)) ?? fromPage[0];
  record(name, "a tool she ran put the real page into the workspace", Boolean(artifact) && /Example Domain|illustrative/i.test(`${artifact?.title} ${artifact?.text}`), { tools: t1.tools, artifacts: fromPage.map((v) => ({ id: v.id, kind: v.kind, title: v.title, source: v.source?.tool })) });
  if (!artifact) {
    writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    await shot("01-no-artifact");
    console.log("No artifact from the page — stopping here.");
    await browser.close();
    process.exit(1);
  }

  // 2. the workspace shows it; the user taps it
  await setFocus("visual");
  await page.waitForTimeout(2500);
  await dismiss();
  const card = page.locator(`[data-workspace-view="${artifact.id}"]`);
  const shown = await waitFor(async () => (await card.count()) > 0, 15_000);
  await shot("02-workspace");
  if (shown) await card.first().click({ force: true, position: { x: 30, y: 12 } });
  const selectedNow = await waitFor(async () => (await workspace()).selectedId === artifact.id && (await card.first().getAttribute("data-selected")) === "true", 10_000);
  await page.waitForTimeout(1500);
  await shot("03-selected");
  const rendered = shown ? await card.first().evaluate((el) => ({ img: Boolean(el.querySelector("img")), text: (el.textContent ?? "").slice(0, 300) })) : null;
  record(name, "the workspace shows the artifact itself, and a tap selects it", shown && selectedNow && (artifact.hasImage ? rendered?.img : /Example/i.test(rendered?.text ?? "")), { shown, selectedNow, rendered });

  // 3. back to chat through the card: the composer says what "this" is
  const ask = page.locator("[data-testid=workspace-ask-about]");
  if (await ask.count()) await ask.first().click({ force: true });
  await setFocus("genesis");
  await open("chat");
  await page.waitForTimeout(2000);
  await dismiss();
  const chip = page.locator("[data-testid=chat-selected-artifact]");
  const chipShown = await waitFor(async () => (await chip.count()) > 0 && (await chip.first().getAttribute("data-artifact-id")) === artifact.id, 10_000);
  await shot("04-chat-with-selection");
  record(name, "the chat composer shows the selected artifact", chipShown, chipShown ? await chip.first().innerText() : "no chip");

  // 4. a follow-up about "this"
  const t2 = await say("What is the main heading on this page?");
  writeFileSync(path.join(OUT, "reply-2.txt"), t2.reply);
  record(name, "a follow-up about “this” is answered from the selected artifact", /Example Domain/i.test(t2.reply), { tools: t2.tools, reply: t2.reply.slice(0, 300) });

  // 5. change it
  const before = (await workspace()).views.find((v) => v.id === artifact.id);
  const t3 = await say("Rename this to “Example Domain — reviewed” and add a note to it saying: Checked with LÉLU — one heading, one paragraph, one link.");
  writeFileSync(path.join(OUT, "reply-3.txt"), t3.reply);
  const after = (await workspace()).views.find((v) => v.id === artifact.id);
  record(name, "she changed the SAME artifact through artifact_edit: new title, the note, a new revision", t3.tools.includes("artifact.edit") && /reviewed/i.test(after?.title ?? "") && /one heading/i.test(after?.text ?? "") && (after?.revision ?? 0) > (before?.revision ?? 0), {
    tools: t3.tools,
    before: { title: before?.title, revision: before?.revision },
    after: { title: after?.title, revision: after?.revision, noteAdded: /one heading/i.test(after?.text ?? "") },
    reply: t3.reply.slice(0, 300),
  });

  // 6. look again
  const chipRev = await chip.first().getAttribute("data-revision").catch(() => null);
  await shot("05-chat-after-change");
  await setFocus("visual");
  await page.waitForTimeout(3000);
  await dismiss();
  const shownAfter = await card.first().evaluate((el) => ({ revision: el.getAttribute("data-revision"), text: el.textContent ?? "" })).catch(() => null);
  await shot("06-workspace-after-change");
  record(name, "the workspace and the chat both show the new revision", shownAfter?.revision === String(after?.revision) && /reviewed/i.test(shownAfter?.text ?? "") && /one heading/i.test(shownAfter?.text ?? "") && chipRev === String(after?.revision), { card: shownAfter ? { revision: shownAfter.revision, title: /reviewed/i.test(shownAfter.text), note: /one heading/i.test(shownAfter.text) } : null, chipRev });

  // 7. one conversation throughout
  await setFocus("genesis");
  const last = await conversation();
  const users = last.messages.filter((m) => m.role === "user").map((m) => m.text);
  record(name, "the conversation was never lost: same conversation, all three requests in order", last.id === first.id && users.slice(-3).length === 3 && /example\.com/.test(users[users.length - 3]) && /main heading/.test(users[users.length - 2]) && /reviewed/.test(users[users.length - 1]), { conversation: last.id, sameAsStart: last.id === first.id, messages: last.messages.length });
  writeFileSync(path.join(OUT, "transcript.txt"), last.messages.map((m) => `── ${m.role.toUpperCase()} ──\n${m.text}`).join("\n\n"));
  record(name, "no page errors", errors.length === 0, errors.slice(0, 5));
  await browser.close();
}

/* -------------------- phone: composer, chip, keyboard focus -------------------- */
{
  const name = "phone";
  const { browser, page, errors, shot, dismiss, open, waitFor, setFocus } = await setup(name, { width: 390, height: 844 });
  // Layout check only: an artifact and a selection are set up directly
  // (the flow above is where she produces and changes them).
  await page.evaluate(async () => {
    const { default: Engine } = await import("/src/core/workspace/WorkspaceEngine.ts");
    const engine = Engine.getInstance();
    engine.openView({ id: "phone-note", kind: "file", title: "A note with a rather long title to test the chip", text: "One heading, one paragraph, one link.", source: { tool: "lelu" } });
    engine.selectView("phone-note");
  });
  await setFocus("visual");
  await page.waitForTimeout(2500);
  await dismiss();
  const card = page.locator('[data-workspace-view="phone-note"]');
  const cardBox = await card.first().boundingBox().catch(() => null);
  await shot("01-workspace");
  record(name, "the selected artifact is on screen", Boolean(cardBox) && cardBox.x >= 0 && cardBox.x + cardBox.width <= 390 + 1 && cardBox.y >= 0 && cardBox.y < 844, cardBox);
  await setFocus("genesis");
  await open("chat");
  await page.waitForTimeout(2500);
  await dismiss();
  const textarea = page.locator("[data-lelu-composer] textarea");
  await textarea.first().tap({ force: true }).catch(() => textarea.first().click({ force: true }));
  await page.waitForTimeout(800);
  const layout = await page.evaluate(() => {
    const chip = document.querySelector("[data-testid=chat-selected-artifact]");
    const ta = document.querySelector("[data-lelu-composer] textarea");
    const inView = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 40);
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, reachable: Boolean(hit && (el === hit || el.contains(hit))) };
    };
    return { chip: inView(chip), textarea: inView(ta), focused: document.activeElement === ta, scrollWidth: document.documentElement.scrollWidth };
  });
  await page.keyboard.type("hello");
  const typed = await textarea.first().inputValue().catch(() => "");
  await shot("02-chat-composer");
  record(name, "chip and composer on screen, not covered; the input takes focus and typing; no sideways scroll", layout.chip?.inside && layout.chip?.reachable && layout.textarea?.inside && layout.textarea?.reachable && layout.focused && typed.endsWith("hello") && layout.scrollWidth <= 391, { ...layout, typed });
  record(name, "no page errors", errors.length === 0, errors.slice(0, 5));
  await browser.close();
}

writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed — evidence in ${OUT}`);
process.exit(failed.length ? 1 : 0);
