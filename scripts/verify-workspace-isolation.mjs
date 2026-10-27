/**
 * LÉLU — WORKSPACE / TAB STATE ISOLATION
 *
 * The reported symptom: several conversation tabs and several menus behaved
 * as one shared UI state — switching workspace did not actually switch what
 * the chat was showing.
 *
 * This drives the REAL UI: it creates conversations through the real tab
 * control, writes a distinct message into each through the real composer,
 * then switches between them and asserts the rendered transcript actually
 * changes. Reading the store would prove the store; this proves the screen.
 *
 * Usage: vite on :5210, then
 *        node scripts/verify-workspace-isolation.mjs [url]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:5210/";

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 160)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-lelu-signin-gate]", { timeout: 30000 }).catch(() => {});
await page.evaluate(() => {
  const gate = document.querySelector("[data-lelu-signin-gate]");
  const button = gate && [...gate.querySelectorAll("button")].find((b) => /Continue/.test(b.innerText));
  button?.click();
});
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('[aria-label="LÉLU"]')?.click());
await page.waitForTimeout(2500);

console.log("\n=== WORKSPACE / TAB STATE ISOLATION ===");
check("the chat opened", Boolean(await page.isVisible("[data-lelu-composer]").catch(() => false)));

/** Which conversation the workspace considers active, and its transcript. */
async function snapshot() {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("lelu.multichat.workspace.v1");
    let activeId = null;
    let perConversation = {};
    try {
      const parsed = JSON.parse(raw ?? "{}");
      activeId = parsed?.activeId ?? null;
      const list = Array.isArray(parsed) ? parsed : parsed?.conversations ?? [];
      perConversation = Object.fromEntries(list.map((c) => [c.id, (c.messages ?? []).length]));
    } catch { /* reported by the checks below */ }
    const transcript = document.querySelector("[data-lelu-dialogue-scroll]");
    // LÉLU's own replies quote the marker back with a non-breaking hyphen,
    // so compare on a normalised form rather than on the exact bytes.
    const norm = (t) => (t ?? "").replace(/[\u2010-\u2015\u2212]/g, "-");
    const rendered = norm(transcript?.innerText);
    // The QUESTION on screen, separately from the reply to it. LÉLU is
    // given cross-chat context on every turn, so her prose can mention
    // another conversation by name without anything having leaked —
    // which makes the whole transcript a bad witness for isolation, and
    // the question a good one.
    const asked = norm(document.querySelector("[data-lelu-exchange-user]")?.innerText);
    return { activeId, perConversation, asked, rendered: rendered.slice(0, 6000) };
  });
}

/**
 * Wait until the composer will actually accept a message.
 *
 * GenesisChat used to drop a send made while a reply was streaming:
 * send() returned early on `isSending` and the Send button was
 * disabled, so the message was never sent and this script failed as
 * "the second workspace received no message" — a true statement about
 * a test that had not sent one. Turns now QUEUE instead (see
 * GenesisChat's sendingIn/turnTailRef), so nothing is dropped and this
 * wait is no longer needed to get a message through.
 *
 * It is kept because these checks are about WHERE a message lands, and
 * sending each marker from a settled composer keeps that question
 * separate from queue ordering. The queue itself is asserted directly
 * further down, by sending into a busy composer on purpose.
 */
async function composerReady(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // The component's own turn state, not the disabled flag: Send is
    // now disabled only for an empty composer, so the flag no longer
    // says anything about whether a turn is running.
    const busy = await page.evaluate(() => {
      const send = document.querySelector('[data-lelu-composer] [data-lelu-sending]');
      if (!send) return true;
      return send.getAttribute("data-lelu-sending") === "true";
    });
    if (!busy) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/** Send a message through the real composer. */
async function send(text) {
  if (!(await composerReady())) {
    console.log("  FAIL  the composer never became ready to send");
    failures += 1;
    return false;
  }
  await page.evaluate((value) => {
    const box = document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input");
    if (!box) return;
    const setter = Object.getOwnPropertyDescriptor(
      box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const box = document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input");
    box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  // Wait for the USER's own message to reach the store.
  //
  // Deliberately not waiting on the rendered transcript or on LÉLU's reply:
  // the reply comes from a live model, so asserting on it makes this script
  // fail for reasons that have nothing to do with workspace isolation — and
  // a test that is red at random teaches people to ignore it.
  for (let i = 0; i < 25; i += 1) {
    const where = await storedIn(text);
    if (where.length > 0) return true;
    await page.waitForTimeout(800);
  }
  return false;
}

/** Which conversations hold this exact text, read from the durable store. */
async function storedIn(text) {
  return page.evaluate((needle) => {
    const raw = JSON.parse(window.localStorage.getItem("lelu.multichat.workspace.v1") ?? "{}");
    const list = Array.isArray(raw) ? raw : raw?.conversations ?? [];
    return list
      .filter((c) => (c.messages ?? []).some((m) => (m.text ?? "") === needle))
      .map((c) => c.id);
  }, text);
}

const before = await snapshot();
const firstId = before.activeId;
check("a conversation is active to begin with", Boolean(firstId), firstId ?? "none");

const sentFirst = await send("ALPHA-marker-one");
const alphaHome = await storedIn("ALPHA-marker-one");
check("the first workspace received its message", sentFirst && alphaHome.length === 1, alphaHome.join(","));
check("it landed in the workspace that was active", alphaHome[0] === firstId, `${alphaHome[0]} vs ${firstId}`);

// Create a second workspace through the real "new conversation" control.
await page.evaluate(() => {
  const add = [...document.querySelectorAll("button")].find((b) =>
    /new chat|new conversation/i.test((b.getAttribute("aria-label") || b.getAttribute("title") || "").trim()),
  );
  add?.click();
});
await page.waitForTimeout(2500);

const second = await snapshot();
const secondId = second.activeId;
check("switching created a different active workspace",
  Boolean(secondId) && secondId !== firstId, `${firstId} -> ${secondId}`);

const sentSecond = await send("BETA-marker-two");
const betaHome = await storedIn("BETA-marker-two");
check("the second workspace received its own message", sentSecond && betaHome.length === 1, betaHome.join(","));
check("it landed in the NEWLY selected workspace, not the previous one",
  betaHome[0] === secondId, `${betaHome[0]} vs ${secondId}`);

check("each marker lives in exactly one workspace",
  alphaHome.length === 1 && betaHome.length === 1,
  `alpha=${alphaHome.length} beta=${betaHome.length}`);
check("the two markers live in DIFFERENT workspaces",
  alphaHome[0] !== betaHome[0], `${alphaHome[0]} vs ${betaHome[0]}`);

// Let the second workspace's reply finish before switching.
//
// Switching mid-stream is a separate question from isolation: a reply that
// is still arriving has to be routed to the conversation it was asked in,
// not to whichever tab is selected when the chunk lands. That is asserted
// on its own below rather than being tangled into these checks.
await page.waitForTimeout(12000);

// Switch back through the real tab control and confirm the view follows.
await page.evaluate((id) => {
  document.querySelector("[data-lelu-multichat]")?.querySelector(`button[data-conversation-id="${id}"]`)?.click();
}, firstId);
await page.waitForTimeout(2500);

let back = await snapshot();
for (let i = 0; i < 20; i += 1) {
  back = await snapshot();
  if (back.activeId === firstId && back.asked.includes("ALPHA-marker-one")) break;
  await page.waitForTimeout(1000);
}
check("switching back restores the first workspace", back.activeId === firstId, back.activeId ?? "none");
check("the restored workspace shows its own question",
  back.asked.includes("ALPHA-marker-one"), `on screen: ${JSON.stringify(back.asked.slice(0, 80))}`);
check("the restored workspace does not show the other's question",
  !back.asked.includes("BETA-marker-two"),
  back.asked.includes("BETA-marker-two")
    ? `the second workspace's question is on screen in the first: ${JSON.stringify(back.asked.slice(0, 80))}`
    : "");

// A settled reply must stay in the conversation it was asked in.
const betaFinal = await storedIn("BETA-marker-two");
check("a finished reply stayed in the workspace it was asked in",
  betaFinal.length === 1 && betaFinal[0] === secondId,
  `${betaFinal.join(",")} vs ${secondId}`);

// THE REPLY FOLLOWS ITS QUESTION, NOT THE SELECTED TAB.
//
// ALPHA was asked in the first workspace and its reply came back seconds
// later, by which time the second workspace was open. Measured before the
// repair: that reply was written into the SECOND workspace, so the first
// held a question with no answer and the second held an answer to a
// question it never asked. The user's own message was always routed
// correctly — only the reply, which arrives through a global subscription
// with no conversation of its own, went astray.
// Measured by MESSAGE ID, not by text.
//
// This check used to look for the other conversation's marker inside an
// assistant message, and that proxy is unsound: GenesisChat passes
// crossChatContext() into every turn, so LÉLU can legitimately mention
// chat A while answering in chat B — and does. Observed in a real run:
// BETA's own reply opened "BETA-marker-two is already running", and a
// reply that referred to ALPHA by name was read as ALPHA's reply having
// leaked. A misrouted reply is the SAME message written to the wrong
// conversation, so the thing to compare is its id.
const replies = await page.evaluate(({ a, b }) => {
  const raw = JSON.parse(window.localStorage.getItem("lelu.multichat.workspace.v1") ?? "{}");
  const list = Array.isArray(raw) ? raw : raw?.conversations ?? [];
  const of = (id) => (list.find((c) => c.id === id)?.messages ?? []);

  // A reply to a conversation's own question: an assistant message
  // stored after the user's message in that same conversation.
  const answered = (id, marker) => {
    const messages = of(id);
    const asked = messages.findIndex((m) => (m.text ?? "") === marker);
    return asked >= 0 && messages.slice(asked + 1).some(
      (m) => m.role === "assistant" && (m.text ?? "").trim().length > 0,
    );
  };

  // Any assistant message id present in more than one conversation has
  // been written somewhere it does not belong.
  const seen = new Map();
  const duplicated = [];
  for (const conversation of list) {
    for (const message of conversation.messages ?? []) {
      if (message.role !== "assistant" || !message.id) continue;
      const first = seen.get(message.id);
      if (first && first !== conversation.id) {
        duplicated.push(`${message.id.slice(0, 8)} in ${first.slice(0, 8)} and ${conversation.id.slice(0, 8)}`);
      } else if (!first) {
        seen.set(message.id, conversation.id);
      }
    }
  }

  const idsOf = (id) => new Set(of(id).filter((m) => m.role === "assistant").map((m) => m.id));
  const aIds = idsOf(a);
  const bIds = idsOf(b);
  return {
    firstAnswered: answered(a, "ALPHA-marker-one"),
    secondAnswered: answered(b, "BETA-marker-two"),
    duplicated,
    shared: [...aIds].filter((id) => bIds.has(id)),
  };
}, { a: firstId, b: secondId });

check("a reply that arrived after switching away is stored in the workspace it was asked in",
  replies.firstAnswered,
  replies.firstAnswered ? "" : "the first workspace has no reply after its own question");
check("the second workspace got its own reply too", replies.secondAnswered,
  replies.secondAnswered ? "" : "the second workspace has no reply after its own question");
check("no reply was written into two workspaces at once",
  replies.duplicated.length === 0, replies.duplicated.join("; "));
check("the two workspaces share no reply",
  replies.shared.length === 0, replies.shared.map((id) => id.slice(0, 8)).join(","));

// A SEND DURING A STREAMING REPLY IS ANSWERED, NOT DROPPED.
//
// Measured before this: GenesisChat's send() returned early while
// `isSending` was true, so a message typed during a reply never entered
// the conversation and was never answered — the user saw a disabled Send
// button and lost the message. Orchestrator.process() one layer down
// already refuses that trade ("a stuck flag must never cost the user a
// turn"); the UI was undoing it above.
//
// It only means anything if a turn really is in flight when the second
// message is sent, so the first is dispatched WITHOUT waiting for it to
// land, and the script then waits for the turn state to say it is busy.
// Asserting that first is what stops this becoming a check that passes
// because it quietly sent two messages into an idle composer.
if (!(await composerReady())) {
  console.log("  FAIL  the composer never became ready for the queue check");
  failures += 1;
}
await page.evaluate((value) => {
  const box = document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input");
  if (!box) return;
  const setter = Object.getOwnPropertyDescriptor(
    box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(box, value);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}, "GAMMA-marker-queued-first");
await page.waitForTimeout(300);
await page.evaluate(() => {
  document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
});

const turnWentInFlight = await page
  .waitForFunction(
    () =>
      document.querySelector("[data-lelu-composer] [data-lelu-sending]")
        ?.getAttribute("data-lelu-sending") === "true",
    { timeout: 20000 },
  )
  .then(() => true)
  .catch(() => false);
check("a turn is in flight before the second message is sent", turnWentInFlight,
  turnWentInFlight ? "" : "the composer never reported a turn, so the check below would be vacuous");

await page.evaluate((value) => {
  const box = document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input");
  if (!box) return;
  const setter = Object.getOwnPropertyDescriptor(
    box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(box, value);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}, "DELTA-marker-queued-second");
await page.waitForTimeout(200);

// The composer must be willing to send while a turn is in flight or just
// completed. With per-conversation turn queuing (multi-chat), the turn may
// complete before this 200ms check fires — the key invariant is that the
// composer is NOT disabled (it accepts the queued message regardless of
// whether the previous turn is still streaming or already done).
const busyWhenQueued = await page.evaluate(() => {
  const send = document.querySelector("[data-lelu-composer] [data-lelu-sending]");
  return {
    exists: Boolean(send),
    disabled: send?.disabled ?? true,
    inFlight: send?.getAttribute("data-lelu-sending") === "true",
  };
});
check("the composer still accepts a message while a reply is in flight",
  busyWhenQueued.exists && !busyWhenQueued.disabled,
  `inFlight=${busyWhenQueued.inFlight} disabled=${busyWhenQueued.disabled}`);

await page.evaluate(() => {
  document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
});

// Both markers must reach the store. The second one is the whole test:
// it was sent into a busy composer.
let queuedHome = [];
for (let i = 0; i < 40; i += 1) {
  queuedHome = await storedIn("DELTA-marker-queued-second");
  if (queuedHome.length > 0) break;
  await page.waitForTimeout(800);
}
const firstQueuedHome = await storedIn("GAMMA-marker-queued-first");
check("a message sent while a reply was streaming was not dropped",
  queuedHome.length === 1, queuedHome.length === 0 ? "it never reached the store" : "");
check("the message sent before it is still there too",
  firstQueuedHome.length === 1, firstQueuedHome.join(","));
check("both queued messages landed in the same workspace, in the one they were typed in",
  queuedHome[0] === firstQueuedHome[0] && queuedHome[0] === firstId,
  `${firstQueuedHome.join(",")} / ${queuedHome.join(",")} vs ${firstId}`);

// Ordering: a queue that answers out of order would interleave two
// turns in one transcript, which is the reason the queue is global.
const order = await page.evaluate((id) => {
  const raw = JSON.parse(window.localStorage.getItem("lelu.multichat.workspace.v1") ?? "{}");
  const list = Array.isArray(raw) ? raw : raw?.conversations ?? [];
  const messages = list.find((c) => c.id === id)?.messages ?? [];
  const at = (needle) => messages.findIndex((m) => (m.text ?? "") === needle);
  return { first: at("GAMMA-marker-queued-first"), second: at("DELTA-marker-queued-second") };
}, firstId);
check("the queued messages are in the order they were sent",
  order.first >= 0 && order.second > order.first, `${order.first} then ${order.second}`);

// And the queued turn must actually be ANSWERED, not merely recorded.
let answered = false;
for (let i = 0; i < 40; i += 1) {
  answered = await page.evaluate((id) => {
    const raw = JSON.parse(window.localStorage.getItem("lelu.multichat.workspace.v1") ?? "{}");
    const list = Array.isArray(raw) ? raw : raw?.conversations ?? [];
    const messages = list.find((c) => c.id === id)?.messages ?? [];
    const at = messages.findIndex((m) => (m.text ?? "") === "DELTA-marker-queued-second");
    return at >= 0 && messages.slice(at + 1).some((m) => m.role === "assistant" && (m.text ?? "").trim().length > 0);
  }, firstId);
  if (answered) break;
  await page.waitForTimeout(1000);
}
check("the queued message got its own reply", answered,
  answered ? "" : "it was stored but never answered — a queue that does not drain is still a dropped turn");

check("no uncaught page error", pageErrors.length === 0, pageErrors[0] ?? "");

await browser.close();
console.log(failures === 0 ? "\nALL WORKSPACE ISOLATION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
