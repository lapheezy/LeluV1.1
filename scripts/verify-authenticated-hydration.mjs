/**
 * LÉLU — AUTHENTICATED BROWSER HYDRATION, AGAINST REAL SUPABASE
 *
 * The gap this closes: paging was proven against a simulated server and
 * against SQL, but never through the real application, in a real browser,
 * signed in, reading real rows over PostgREST.
 *
 * It signs in as a DEDICATED E2E account — never the owner's — whose rows
 * are isolated by the same RLS policies as everyone else's, seeds it to
 * 1043 messages (the size of the owner's real table, and the size that
 * exposed the 1000-row cap), injects the resulting session into
 * localStorage exactly as supabase-js stores it, and then lets the
 * application hydrate itself.
 *
 * The assertion is on what the REAL MultiChatStore ends up holding, read
 * back from the store's own persisted state — not on a count the script
 * computed for itself.
 *
 * Usage: SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... vite on :5210, then
 *        node scripts/verify-authenticated-hydration.mjs [url]
 */

import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5210/";
const SC = process.env.LELU_E2E_DIR ?? ".";
const PROJECT_REF = "nrehsldbfxthspikaxvr";
const CONVERSATION = "e2e-hydration-conversation";
const EXPECTED = 1043;

const session = JSON.parse(readFileSync(`${SC}/e2e-session.json`, "utf8"));

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 160)));

// supabase-js reads its session from this key before anything else runs.
await page.addInitScript(
  ({ ref, value }) => {
    try {
      window.localStorage.setItem(`sb-${ref}-auth-token`, value);
    } catch {
      /* storage blocked — the check below will report it */
    }
  },
  { ref: PROJECT_REF, value: JSON.stringify(session) },
);

console.log("\n=== AUTHENTICATED HYDRATION ===");
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => (document.querySelector("#root")?.children.length ?? 0) > 0, { timeout: 60000 }).catch(() => {});

check("the app opens for the signed-in user",
  (await page.$eval("#root", (el) => el.children.length).catch(() => 0)) > 0);

const signedIn = await page.evaluate((ref) => {
  const raw = window.localStorage.getItem(`sb-${ref}-auth-token`);
  if (!raw) return null;
  try { return JSON.parse(raw)?.user?.id ?? null; } catch { return null; }
}, PROJECT_REF);
check("the session is present in the browser", Boolean(signedIn), signedIn ?? "no session");

/** Count the messages the REAL store holds for the seeded conversation. */
async function storeState() {
  return page.evaluate((conversationId) => {
    const raw = window.localStorage.getItem("lelu.multichat.workspace.v1");
    if (!raw) return { found: false, total: 0, unique: 0, conversations: 0 };
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { found: false, total: 0, unique: 0, conversations: 0 }; }
    const list = Array.isArray(parsed) ? parsed : parsed?.conversations ?? [];
    const target = list.find((c) => c?.id === conversationId);
    const messages = target?.messages ?? [];
    return {
      found: Boolean(target),
      total: messages.length,
      unique: new Set(messages.map((m) => m?.id)).size,
      conversations: list.length,
    };
  }, CONVERSATION);
}

// Hydration is deliberately incremental, so poll until it settles rather
// than guessing a duration. Progress must only ever grow.
let last = -1;
let stable = 0;
const progression = [];
const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  const state = await storeState();
  if (state.total !== last) {
    progression.push(state.total);
    if (state.total < last) {
      check("hydration progress never goes backwards", false, `${last} -> ${state.total}`);
    }
    last = state.total;
    stable = 0;
  } else {
    stable += 1;
  }
  if (state.total >= EXPECTED && stable >= 2) break;
  await page.waitForTimeout(2000);
}

const finalState = await storeState();
check("the seeded conversation loaded", finalState.found, `conversations=${finalState.conversations}`);
check("hydration continued past the first page",
  progression.filter((n) => n > 0).length > 0 && finalState.total > 500,
  `progression: ${progression.join(" -> ")}`);
check(`messages are not truncated at 1000 (expected ${EXPECTED})`,
  finalState.total === EXPECTED, `store holds ${finalState.total}`);
check("no message is duplicated",
  finalState.unique === finalState.total, `${finalState.unique} unique of ${finalState.total}`);

// The UI has to stay usable while all that is happening.
const usable = await page.evaluate(() => {
  const root = document.querySelector('[data-workspace="genesis-unified"]');
  const dock = document.querySelector("[data-lelu-dock]");
  const box = dock?.getBoundingClientRect();
  return {
    rootSized: Boolean(root && root.getBoundingClientRect().width > 0),
    dockVisible: Boolean(box && box.width > 0 && box.height > 0),
    noHScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  };
});
check("the workspace stayed rendered during hydration", usable.rootSized);
check("the dock stayed visible during hydration", usable.dockVisible);
check("no horizontal overflow during hydration", usable.noHScroll);
check("no uncaught page error", pageErrors.length === 0, pageErrors[0] ?? "");

await browser.close();
console.log(failures === 0 ? "\nALL AUTHENTICATED HYDRATION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
