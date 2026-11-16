/**
 * LÉLU — MEMORY REACHES COGNITION, MEASURED END TO END
 *
 * The requirement is not "a memory provider class exists". It is: something
 * the user said in one conversation is available to the model in another,
 * because the runtime recalled it BEFORE generating.
 *
 * This says one fact in thread A, opens a fresh thread B, and asks for the
 * fact. Both threads are local (no session needed), so the recall being
 * exercised is LÉLU's own memory → MemoryBridge → cognition → provider path.
 *
 * The OG archive band (`legacy_memories`) is RLS-scoped to a signed-in user;
 * that half needs the owner's session and is reported separately.
 *
 * Usage:
 *   LD_LIBRARY_PATH=… FONTCONFIG_FILE=… node scripts/verify-og-memory-recall.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:3000";

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? `  — ${note}` : ""}`);
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const texts = () =>
  page.$$eval(".prose", (nodes) => nodes.map((n) => ((n.innerText || n.textContent) ?? "").trim()).filter(Boolean));

async function openThread(id) {
  await page.goto(`${BASE}/og/chat/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('textarea[placeholder*="say something"]', { timeout: 60_000 });
}

async function ask(question, budgetMs = 90_000) {
  const before = (await texts()).length;
  await page.fill('textarea[placeholder*="say something"]', question);
  await page.press('textarea[placeholder*="say something"]', "Enter");
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const now = await texts();
    if (now.length > before) return now.at(-1) ?? "";
    await page.waitForTimeout(500);
  }
  return "";
}

const stamp = Date.now();
console.log("\n== 1 — teach LÉLU a fact in one conversation ==");
await openThread(`conv-${stamp}-memA`);
const taught = await ask(
  "Remember this about me: my name is Zephyrine, and the project I am building is called the Halo Array.",
);
check("the teaching turn was answered", taught.length > 0, taught.slice(0, 120));

// Consolidation happens inside the turn; give the profile a moment.
await page.waitForTimeout(3_000);

console.log("\n== 2 — recall it in a DIFFERENT conversation ==");
await openThread(`conv-${stamp}-memB`);
const recalled = await ask("What is my name, and what am I building? Answer with just those two things.");
check("the recall turn was answered", recalled.length > 0, recalled.slice(0, 200));

const lower = recalled.toLowerCase();
check(
  "the name said in the other thread came back",
  lower.includes("zephyrine"),
  recalled.slice(0, 200),
);
check(
  "the project said in the other thread came back",
  lower.includes("halo"),
  recalled.slice(0, 200),
);

// The memory really is a stored pattern, not a lucky conversational echo.
// Thread B was a full page load, so this is durable storage: LÉLU's memory
// lives in the IndexedDB database `lelu-memory`, and the fact should be there.
const stored = await page.evaluate(async () => {
  const hits = [];
  const databases = (await indexedDB.databases?.()) ?? [];
  for (const info of databases) {
    if (!info.name) continue;
    const db = await new Promise((resolve) => {
      const request = indexedDB.open(info.name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) continue;
    for (const storeName of [...db.objectStoreNames]) {
      const rows = await new Promise((resolve) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => resolve([]);
      });
      for (const row of rows) {
        if (/zephyrine/i.test(JSON.stringify(row))) hits.push(`${info.name}/${storeName}`);
      }
    }
    db.close();
  }
  // The brain's own snapshot and the user profile also live in localStorage.
  for (const key of Object.keys(localStorage)) {
    if (/zephyrine/i.test(localStorage.getItem(key) ?? "")) hits.push(`localStorage:${key}`);
  }
  return [...new Set(hits)];
});
check(
  "the fact is in durable storage (IndexedDB / localStorage)",
  stored.length > 0,
  stored.length > 0 ? stored.join(", ") : "nothing durable contains the name",
);

await page.screenshot({ path: `artifacts/og-memory-recall-${stamp}.png` });
await browser.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
