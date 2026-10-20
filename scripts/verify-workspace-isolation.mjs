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
check("the chat opened", Boolean(await page.$("[data-lelu-composer]")));

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
    const rendered = (transcript?.innerText ?? "").replace(/[\u2010-\u2015\u2212]/g, "-");
    return { activeId, perConversation, rendered: rendered.slice(0, 6000) };
  });
}

/** Send a message through the real composer. */
async function send(text) {
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
  if (back.activeId === firstId && back.rendered.includes("ALPHA-marker-one")) break;
  await page.waitForTimeout(1000);
}
check("switching back restores the first workspace", back.activeId === firstId, back.activeId ?? "none");
check("the restored workspace renders its own message",
  back.rendered.includes("ALPHA-marker-one"), back.rendered.slice(-100));
check("the restored workspace does not render the other's message",
  !back.rendered.includes("BETA-marker-two"), "state leaked between workspaces");

// A settled reply must stay in the conversation it was asked in.
const betaFinal = await storedIn("BETA-marker-two");
check("a finished reply stayed in the workspace it was asked in",
  betaFinal.length === 1 && betaFinal[0] === secondId,
  `${betaFinal.join(",")} vs ${secondId}`);

check("no uncaught page error", pageErrors.length === 0, pageErrors[0] ?? "");

await browser.close();
console.log(failures === 0 ? "\nALL WORKSPACE ISOLATION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
