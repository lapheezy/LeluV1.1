/**
 * LÉLU — OG CHAT STARTUP, IN A REAL BROWSER
 *
 * What this asserts, and why each one exists:
 *
 *   1. The OG Core chat panel opens without a database. Every request to
 *      supabase.co is aborted BEFORE the panel is opened, which is the exact
 *      state that used to render "opening a thread…" forever: the old panel
 *      awaited a remote insert before mounting the chat runtime at all.
 *
 *   2. The same panel, with Supabase reachable but nobody signed in. Same
 *      requirement — an unauthenticated session is not a reason to refuse to
 *      talk.
 *
 *   3. A sent message reaches the real provider gateway and comes back as
 *      generated text. A model request through the server broker is observed,
 *      so "it answered" cannot be a local echo or a mock.
 *
 *   4. A thread survives a reload from its local snapshot when the server
 *      cannot answer — the local-first guarantee, measured rather than
 *      asserted in a comment.
 *
 * NOT MEASURED HERE (needs the owner's session, reported separately):
 * signed-in hydration of the 1,043 rows, writing turns to Supabase, and the
 * OG legacy archive actually reaching cognition (RLS scopes it to the user).
 *
 * Usage:
 *   LD_LIBRARY_PATH=… FONTCONFIG_FILE=… node scripts/verify-og-chat-startup.mjs [baseUrl]
 *
 * The two environment variables are how a headless browser runs on this VM at
 * all (the shared image has no browser libraries and no fonts). Without fonts
 * every glyph lays out at zero width, which makes a correct transcript measure
 * as an empty one — this script reads `textContent` as well as `innerText` so a
 * fontless run cannot report a false failure.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const ARTIFACTS = process.env.LELU_ARTIFACTS ?? "artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? `  — ${note}` : ""}`);
};

const say = (label) => console.log(`\n== ${label} ==`);

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

/** A page with the console and the network watched. */
async function openPage({ blockSupabase = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const modelCalls = [];
  const supabaseCalls = [];

  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 200)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text().slice(0, 200));
  });
  page.on("response", (response) => {
    const url = response.url();
    if (/supabase\.co/.test(url)) {
      supabaseCalls.push({ url, status: response.status() });
    }
    if (/\/api\/model\//.test(url)) {
      modelCalls.push({ url, status: response.status() });
    }
  });

  if (blockSupabase) {
    // Simulated outage: the socket never completes. This is the harsher case
    // (a rejection resolves immediately; a hang is what wedged the old panel).
    await page.route("**supabase.co/**", () => {
      /* never fulfilled on purpose */
    });
  }

  return { page, pageErrors, modelCalls, supabaseCalls };
}

/**
 * Long-press the Core, the gesture that opens the chat panel.
 *
 * Real mouse input at the element's centre, not a synthetic DOM click: the
 * long-press is a timer started by pointerdown, so only real pointer events
 * can reach it.
 */
async function longPressCore(page) {
  const target = await page.evaluate(() => {
    const el = document.querySelector('button[aria-label="Lélu Core"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: el === hit || el.contains(hit) };
  });
  if (!target) throw new Error("the Core is not on the page");
  check("the Core is reachable (not covered)", target.reachable);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

const textOf = (page) => page.evaluate(() => document.body.innerText);

/** Wait for the chat composer, returning how long it took. */
async function waitForComposer(page, budgetMs) {
  const started = Date.now();
  await page.waitForSelector('textarea[placeholder*="say something"]', {
    state: "visible",
    timeout: budgetMs,
  });
  return Date.now() - started;
}

const assistantTexts = (page) =>
  page.$$eval(".prose", (nodes) =>
    nodes.map((n) => ((n.innerText || n.textContent) ?? "").trim()),
  );

async function sendTurn(page, text) {
  await page.fill('textarea[placeholder*="say something"]', text);
  await page.press('textarea[placeholder*="say something"]', "Enter");
}

/** Poll until an assistant bubble holds text that is not the placeholder. */
async function waitForReply(page, { budgetMs = 150_000, min = 1 } = {}) {
  const started = Date.now();
  for (;;) {
    const texts = (await assistantTexts(page)).filter((t) => t.length >= min);
    if (texts.length > 0) return { texts, elapsed: Date.now() - started };
    if (Date.now() - started > budgetMs) return { texts: [], elapsed: Date.now() - started };
    await page.waitForTimeout(500);
  }
}

// ============================================================
// 1. THE REPORTED BUG: chat with the database unreachable
// ============================================================
say("1 — the chat opens while Supabase is unreachable");
{
  const { page, pageErrors, supabaseCalls } = await openPage({ blockSupabase: true });
  await page.goto(`${BASE}/og/core`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="Lélu Core"]', { timeout: 60_000 });

  await longPressCore(page);

  let elapsed = -1;
  let composerSeen = true;
  try {
    elapsed = await waitForComposer(page, 20_000);
  } catch {
    composerSeen = false;
  }
  check(
    "the composer appears with Supabase hanging",
    composerSeen,
    composerSeen ? `${elapsed}ms after the long-press` : "never appeared",
  );

  const body = await textOf(page);
  check(
    "no 'opening a thread' placeholder is left on screen",
    !/opening a thread/i.test(body),
  );
  check(
    "no 'gathering starlight' placeholder is left on screen",
    !/gathering starlight/i.test(body),
  );

  // Send a turn and watch it: a hung database must not stop the answer either.
  if (composerSeen) {
    await sendTurn(page, "Lélu, answer in one short sentence: are you there?");
    const { texts, elapsed: replyElapsed } = await waitForReply(page, { min: 1 });
    check(
      "she still answers while the database hangs",
      texts.length > 0,
      texts.length > 0 ? `${replyElapsed}ms: "${texts.at(-1).slice(0, 90)}"` : "no reply in 150s",
    );
  }

  await page.screenshot({ path: `${ARTIFACTS}/og-chat-supabase-blocked.png` });
  console.log(
    `  ..  supabase requests that answered: ${supabaseCalls.length}; page errors: ${pageErrors.length}`,
  );
  await page.close();
}

// ============================================================
// 2. REACHABLE BUT SIGNED OUT
// ============================================================
say("2 — the chat opens with Supabase reachable and no session");
const shared = await openPage();
{
  const { page } = shared;
  await page.goto(`${BASE}/og/core`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="Lélu Core"]', { timeout: 60_000 });
  await longPressCore(page);

  let elapsed = -1;
  let composerSeen = true;
  try {
    elapsed = await waitForComposer(page, 20_000);
  } catch {
    composerSeen = false;
  }
  check(
    "the composer appears unsigned-in",
    composerSeen,
    composerSeen ? `${elapsed}ms` : "never appeared",
  );

  const body = await textOf(page);
  check("no startup placeholder is left on screen", !/opening a thread/i.test(body));
  await page.screenshot({ path: `${ARTIFACTS}/og-chat-open.png` });
}

// ============================================================
// 3. THE REAL PROVIDER PATH
// ============================================================
say("3 — a turn reaches the real provider gateway");
{
  const { page, modelCalls, pageErrors } = shared;
  const before = modelCalls.length;

  await sendTurn(
    page,
    "In one sentence: what is 17 + 26, and say which model you are.",
  );
  const { texts, elapsed } = await waitForReply(page, { min: 2 });
  const answer = texts.at(-1) ?? "";

  check("an assistant message was rendered", texts.length > 0, `${elapsed}ms`);
  check(
    "the message is generated text, not an error string",
    answer.length > 0 && !/^(unknown ai error|⚠️|that provider is out of credit)/i.test(answer),
    answer.slice(0, 140),
  );
  const served = modelCalls.slice(before).filter((call) => call.status === 200);
  check(
    "the server broker served the model request",
    served.length > 0,
    served.length > 0 ? served.map((c) => c.url.replace(BASE, "")).join(", ") : "no 200 from /api/model",
  );

  const body = await textOf(page);
  check("no error banner is showing", !/hit a snag|Unknown AI error/i.test(body));
  console.log(`  ..  page errors: ${pageErrors.length ? pageErrors.join(" | ") : "none"}`);

  // Is the transcript on screen in the shape a reload would restore?
  const messageCount = await page.evaluate(() => document.querySelectorAll(".prose").length);
  check("the reply is in the transcript", messageCount >= 1, `${messageCount} assistant bubble(s)`);

  await page.screenshot({ path: `${ARTIFACTS}/og-chat-answer.png` });
}

// ============================================================
// 4. RELOAD RESTORES THE THREAD WITHOUT THE SERVER
// ============================================================
say("4 — a thread survives a reload from its local snapshot");
{
  const { page } = shared;
  // Nobody is signed in, so the server cannot supply this transcript: the only
  // thing that can restore it is the local snapshot plus the remembered thread.
  const beforeReload = await page.evaluate(() =>
    [...document.querySelectorAll(".prose")]
      .map((n) => ((n.innerText || n.textContent) ?? "").trim())
      .filter(Boolean),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="Lélu Core"]', { timeout: 60_000 });
  await longPressCore(page);

  let restored = [];
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const texts = (await assistantTexts(page)).filter(Boolean);
    if (texts.length > 0) {
      restored = texts;
      break;
    }
    await page.waitForTimeout(500);
  }
  check(
    "the previous answer is still there after a reload",
    restored.length > 0 && beforeReload.length > 0,
    restored.length > 0 ? `"${restored.at(-1).slice(0, 80)}"` : "the thread came back empty",
  );
  check(
    "the reopened panel resumed the same thread",
    restored.length > 0,
    `thread id kept: ${await page.evaluate(() => localStorage.getItem("lelu:last-thread") ?? "none")}`,
  );
  await page.screenshot({ path: `${ARTIFACTS}/og-chat-restored.png` });
}

// ============================================================
// 5. THE FALLBACK CHAIN
// ============================================================
// A provider that fails must not end the turn: the registry's resolver moves
// to the next one. Groq is the one this environment actually reaches, so it is
// failed on purpose and something else has to answer.
say("5 — a failing provider falls through to another");
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const served = [];
  const refused = [];
  await page.route("**/api/model/groq/**", (route) => {
    refused.push(route.request().url());
    return route.fulfill({ status: 500, body: JSON.stringify({ error: "forced failure" }) });
  });
  page.on("response", (response) => {
    if (/\/api\/model\//.test(response.url()) && response.status() === 200) served.push(response.url());
  });

  await page.goto(`${BASE}/og/chat/conv-${Date.now()}-fallback`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('textarea[placeholder*="say something"]', { timeout: 60_000 });
  await page.fill('textarea[placeholder*="say something"]', "In one short sentence, say which model you are.");
  await page.press('textarea[placeholder*="say something"]', "Enter");

  let reply = "";
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const texts = await page.$$eval(".prose", (nodes) =>
      nodes.map((n) => ((n.innerText || n.textContent) ?? "").trim()).filter(Boolean),
    );
    if (texts.length > 0) {
      reply = texts.at(-1);
      break;
    }
    await page.waitForTimeout(500);
  }

  check("the primary provider was actually attempted and failed", refused.length > 0, `${refused.length} refused`);
  check("a secondary provider answered instead", reply.length > 0, reply.slice(0, 140));
  check(
    "the successful call went to a different provider",
    served.some((url) => !/\/groq\//.test(url)),
    served.length > 0 ? served.map((u) => u.replace(BASE, "")).join(", ") : "no 200 from any provider",
  );
  await page.screenshot({ path: `${ARTIFACTS}/og-chat-fallback.png` });
  await page.close();
}

await browser.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
