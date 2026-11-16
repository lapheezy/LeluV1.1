/**
 * M16.3 WP06 — live chat acceptance through the real composer.
 *
 * Every sentence is submitted by the real composer (value + input event on the
 * real textarea, then a real Enter press). Nothing here calls a dispatcher,
 * a tool, or a store directly: the app compiles, routes and executes, and this
 * script only reads back what it rendered and what it persisted.
 *
 * Input note: this VM's Chromium stops accepting per-key text after one
 * character in ANY textarea (verified on a blank page), so a sentence cannot be
 * typed key by key here. The inserted value plus `input` event is the same
 * event a human keystroke produces for React; Enter is a real key press.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "artifacts/m16-3/wp06";
mkdirSync(OUT, { recursive: true });
const ORIGIN = process.env.LELU_ORIGIN ?? "http://127.0.0.1:3003";
const STORE_KEY = "lelu.lelu.cosmos.objects.v1";
const PLAN = process.argv[2] ?? "full";

const report = { origin: ORIGIN, plan: PLAN, turns: [], checks: [], errors: [], timelines: {} };
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let modelCalls = 0;

page.on("pageerror", (error) => report.errors.push(String(error).slice(0, 300)));
page.on("response", (response) => {
  if (/\/api\/model\/.*chat\/completions/.test(response.url())) modelCalls += 1;
});

/* The chat surface is either a `chat:<id>` window or the Chat Universe; both
   render through the same chat engine, so the visible page text is the one
   surface-agnostic place to read what was rendered. */
const composer = () => page.locator('textarea[placeholder^="Message LÉLU"]').last();
const surfaceText = () => page.evaluate(() => document.body.textContent ?? "");
const chatText = surfaceText;

const conversationId = async () => {
  const id = await page.evaluate(() => {
    const window = [...document.querySelectorAll("[data-lelu-window^=\"chat:\"]")].at(-1);
    return window?.getAttribute("data-lelu-window") ?? null;
  }).catch(() => null);
  return id;
};

const readObjects = () =>
  page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { stored: false, objects: [] };
    try {
      const parsed = JSON.parse(raw);
      const objects = (Array.isArray(parsed) ? parsed : parsed.objects ?? []).map((object) => ({
        id: object.id,
        name: object.name,
        position: object.frame?.position ?? null,
        rotation: object.frame?.rotation ?? null,
        scale: object.frame?.scale ?? null,
        parts: object.scene?.objects?.length ?? null,
      }));
      return { stored: true, objects };
    } catch {
      return { stored: true, objects: [], unreadable: true };
    }
  }, STORE_KEY);

const objectOf = (store, id) => (store.objects ?? []).find((object) => object.id === id) ?? null;

async function openChat() {
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const openers = ['button:has-text("Continue without an account")', 'button[aria-label*="Summon the chat" i]', 'button[aria-label*="open chat" i]', 'button:text-is("Chat")'];
  for (let attempt = 0; attempt < 12 && !(await composer().count()); attempt += 1) {
    for (const selector of openers) {
      const element = page.locator(selector).first();
      if (!(await element.count().catch(() => 0))) continue;
      await element.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (await composer().count()) break;
    }
    if (!(await composer().count())) await page.waitForTimeout(800);
  }
  if (!(await composer().count())) throw new Error("composer never appeared");
  report.timelines.bootToComposerMs = await page.evaluate(() => Math.round(performance.now()));
}

/** Second conversation, created the way the UI creates one. */
async function newConversation(marker) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="New chat"]');
      if (!button) return false;
      button.click();
      return true;
    });
    if (!clicked) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
      await page.waitForTimeout(1500);
      continue;
    }
    await page.waitForTimeout(2600);
    /* The newest window is the conversation just created; it must not be
       showing the previous conversation's transcript. */
    const fresh = await page.evaluate((previous) => {
      const window = [...document.querySelectorAll('[data-lelu-window^="chat:"]')].at(-1);
      if (!window) return { window: null, fresh: true };
      const text = window.textContent ?? "";
      return { window: window.getAttribute("data-lelu-window"), fresh: !previous || !text.includes(previous) };
    }, marker);
    if (fresh.fresh) return;
  }
  throw new Error(`no second conversation (windows: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("[data-lelu-window]")].map((el) => el.getAttribute("data-lelu-window"))))})`);
}

async function say(text, label) {
  await composer().waitFor({ state: "visible", timeout: 10000 });
  await composer().focus();
  await page.evaluate((value) => {
    const box = [...document.querySelectorAll('textarea[placeholder^="Message LÉLU"]')].at(-1);
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await page.waitForTimeout(120);
  const typed = await composer().inputValue();
  const before = await chatText();
  const callsBefore = modelCalls;
  const conversation = await conversationId();
  const sentAt = Date.now();
  await page.keyboard.press("Enter");

  /* The turn is over when the stop control is gone and the transcript grew. */
  let reply = "";
  let pageText = "";
  let renderedAt = 0;
  for (let waited = 0; waited < 40000; waited += 200) {
    await page.waitForTimeout(200);
    pageText = await chatText();
    const sending = await page.locator("[data-lelu-stop-button]").count();
    if (!sending && pageText.length > before.length) {
      /* Everything rendered after the sentence the user submitted: the reply
         the user sees for this turn. */
      const cut = pageText.lastIndexOf(text);
      reply = cut === -1 ? pageText.slice(before.length) : pageText.slice(cut + text.length);
      renderedAt = Date.now();
      break;
    }
  }
  const store = await readObjects();
  const turn = {
    label,
    conversation,
    said: text,
    typed,
    submitToRenderMs: renderedAt ? renderedAt - sentAt : null,
    modelRequests: modelCalls - callsBefore,
    reply: reply.slice(0, 2000),
    rendered: pageText.slice(-3000),
    objects: store.objects,
  };
  report.turns.push(turn);
  await page.screenshot({ path: `${OUT}/${String(report.turns.length).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png` });
  console.log(`\n── ${label} [${conversation}] (${turn.submitToRenderMs}ms, model=${turn.modelRequests})\n   said: ${text}\n   typed: ${JSON.stringify(typed)}\n   reply: ${reply.replace(/\s+/g, " ").slice(0, 420)}`);
  console.log(`   objects: ${JSON.stringify(store.objects).slice(0, 340)}`);
  return turn;
}

const check = (name, ok, detail) => {
  report.checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
};

/** P04.1–P04.8: one object, live transforms, persistence. */
async function phaseTransforms() {
  await say("build a chair", "build-chair");
  await say("spawn it into the cosmos", "spawn");
  const afterSpawn = await readObjects();
  const first = afterSpawn.objects.at(-1) ?? null;
  check("spawn created one Cosmos object", afterSpawn.objects.length === 1 && first, JSON.stringify(first));
  const id = first?.id ?? null;
  report.objectId = id;

  await say("select the chair", "select-by-name");
  check("select by name resolves without an id", report.turns.at(-1).reply.includes(id ?? "obj_"), report.turns.at(-1).reply.slice(0, 160));

  const beforeRotate = objectOf(await readObjects(), id);
  report.beforeRotate = beforeRotate;
  await say("rotate it 90 degrees", "rotate-90");
  const afterRotate = objectOf(await readObjects(), id);
  report.afterRotate = afterRotate;
  const rotated = JSON.stringify(afterRotate?.rotation) === JSON.stringify([0, 90, 0]);
  check("rotate 90 changed rotation to [0,90,0]", rotated, `before=${JSON.stringify(beforeRotate?.rotation)} after=${JSON.stringify(afterRotate?.rotation)}`);
  check("rotate left position and scale untouched", JSON.stringify(afterRotate?.position) === JSON.stringify(beforeRotate?.position) && afterRotate?.scale === beforeRotate?.scale, `position=${JSON.stringify(afterRotate?.position)} scale=${afterRotate?.scale}`);

  await say("make it twice as large", "double-size");
  const afterScale = objectOf(await readObjects(), id);
  report.afterScale = afterScale;
  check("double size multiplied scale by 2", afterScale?.scale === (beforeRotate?.scale ?? 4) * 2, `${beforeRotate?.scale} → ${afterScale?.scale}`);
  check("double size kept rotation and position", JSON.stringify(afterScale?.rotation) === JSON.stringify([0, 90, 0]) && JSON.stringify(afterScale?.position) === JSON.stringify(beforeRotate?.position), `${JSON.stringify(afterScale?.rotation)} ${JSON.stringify(afterScale?.position)}`);

  const positionBefore = afterScale?.position;
  await say("move it to the left", "move-left");
  const afterMove = objectOf(await readObjects(), id);
  report.afterMove = afterMove;
  check("move left decreased x", (afterMove?.position?.[0] ?? 0) < (positionBefore?.[0] ?? 0), `${JSON.stringify(positionBefore)} → ${JSON.stringify(afterMove?.position)}`);
  check("move kept rotation and scale", JSON.stringify(afterMove?.rotation) === JSON.stringify([0, 90, 0]) && afterMove?.scale === afterScale?.scale, `${JSON.stringify(afterMove?.rotation)} scale=${afterMove?.scale}`);

  await say("select the chair", "select-again");
  const reselected = objectOf(await readObjects(), id);
  check("same object id after re-select, transforms preserved", reselected && JSON.stringify(reselected) === JSON.stringify(afterMove), JSON.stringify(reselected));

  /* P04.8 — reload hydration */
  const beforeReload = await readObjects();
  const reloadStart = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  let hydrated = null;
  for (let waited = 0; waited < 30000; waited += 250) {
    await page.waitForTimeout(250);
    const store = await readObjects();
    if (store.objects.length) {
      hydrated = { afterMs: Date.now() - reloadStart, store };
      break;
    }
  }
  report.timelines.reloadHydrationMs = hydrated?.afterMs ?? null;
  const reloaded = objectOf(hydrated?.store ?? { objects: [] }, id);
  check("reload preserved the persisted transforms", JSON.stringify(reloaded) === JSON.stringify(objectOf(beforeReload, id)), `hydration=${report.timelines.reloadHydrationMs}ms ${JSON.stringify(reloaded)}`);
  return id;
}

/** P04.9–P04.12: conversation scoping, ambiguity, honest failure, dependent skip. */
async function phaseConversations(id) {
  await newConversation(report.turns.at(-1)?.reply?.slice(0, 40) ?? null);
  const secondId = await conversationId();
  report.secondConversation = secondId;
  check("second conversation is a different conversation", !secondId || secondId !== report.turns[0].conversation, `${report.turns[0].conversation} vs ${secondId ?? "(universe surface)"}`);

  const storeBefore = await readObjects();
  await say("rotate it 90 degrees", "pronoun-only-new-conversation");
  const pronounTurn = report.turns.at(-1);
  const pronounText = pronounTurn.rendered ?? pronounTurn.reply;
  const storeAfterPronoun = await readObjects();
  const unchanged = JSON.stringify(storeBefore.objects) === JSON.stringify(storeAfterPronoun.objects);
  const refused = /could not tell which object|nothing in the Cosmos|no object matches/i.test(pronounText);
  check("pronoun-only command in a fresh conversation refuses instead of inheriting", unchanged && refused, `unchanged=${unchanged} reply=${pronounText.replace(/\s+/g, " ").slice(0, 220)}`);

  await say("build a chair", "ambiguity-build-1");
  await say("spawn it into the cosmos", "ambiguity-spawn-1");
  await say("build a chair", "ambiguity-build-2");
  await say("spawn it into the cosmos", "ambiguity-spawn-2");
  const twoObjects = await readObjects();
  const names = twoObjects.objects.map((object) => object.name);
  const sameName = names.filter((name) => name === names.at(-1)).length;
  check("two objects share a name (ambiguity set up)", sameName >= 2 && twoObjects.objects.length >= 3, JSON.stringify(names));

  await say("select the chair", "ambiguity-select");
  const ambiguousTurn = report.turns.at(-1);
  const ambiguous = ambiguousTurn.rendered ?? ambiguousTurn.reply;
  check("vague selection asks which one", /matches \d+ objects|which one/i.test(ambiguous), ambiguous.replace(/\s+/g, " ").slice(0, 240));

  /* An operation the tools must refuse: a name that is not in the Cosmos. */
  await say("select the lamp", "invalid-operation");
  const invalid = report.turns.at(-1);
  const invalidText = invalid.rendered ?? invalid.reply;
  check("invalid operation reports the real failure", /no object matches|couldn.t/i.test(invalidText), invalidText.replace(/\s+/g, " ").slice(-260));

  /* The named prerequisite ("select the lamp") failed. The follow-up pronoun
     must not reach past this conversation: only the object THIS conversation
     last worked on may be touched, and the reply has to say which one. */
  const beforeDependent = await readObjects();
  await say("rotate it 90 degrees", "after-failed-prerequisite");
  const dependent = report.turns.at(-1);
  const dependentText = dependent.rendered ?? dependent.reply;
  const afterDependent = await readObjects();
  const changed = afterDependent.objects.filter((object, index) => JSON.stringify(object) !== JSON.stringify(beforeDependent.objects[index]));
  const conversationObject = beforeDependent.objects.filter((object) => object.name.includes("chair")).at(-1)?.id ?? null;
  check(
    "after a failed prerequisite the pronoun acts only on this conversation's own object",
    changed.length === 1 && changed[0]?.id === conversationObject,
    `changed=${JSON.stringify(changed.map((object) => object.id))} expected=${conversationObject}`,
  );
  check("the reply names the object it acted on", new RegExp(`${conversationObject}`).test(dependentText), dependentText.replace(/\s+/g, " ").slice(-200));
}

try {
  await openChat();
  report.initialStore = await readObjects();
  const id = (await readObjects()).objects.at(-1)?.id ?? null;
  if (PLAN !== "conv") report.objectId = await phaseTransforms();
  else {
    await say("build a chair", "conv-build");
    await say("spawn it into the cosmos", "conv-spawn");
    await say("select the chair", "conv-select");
    report.objectId = (await readObjects()).objects.at(-1)?.id ?? null;
  }
  if (PLAN !== "store") await phaseConversations(report.objectId ?? id);
  report.modelRequestsDuringTurns = report.turns.reduce((sum, turn) => sum + turn.modelRequests, 0);
  report.finalStore = await readObjects();
} catch (error) {
  report.fatal = error instanceof Error ? (error.stack ?? error.message).slice(0, 900) : String(error);
} finally {
  writeFileSync(`${OUT}/live-${PLAN}-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
const passed = report.checks.filter((entry) => entry.ok).length;
console.log(`\nFATAL: ${report.fatal ?? "none"} | checks ${passed}/${report.checks.length} | turns=${report.turns.length} | modelRequestsDuringTurns=${report.modelRequestsDuringTurns}`);
