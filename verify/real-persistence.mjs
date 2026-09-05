/**
 * REAL LOCAL PERSISTENCE — write, RELOAD THE PAGE, read back.
 *
 * Real Chromium, real IndexedDB ("lelu-memory"), the production
 * write path (AIService.consolidate -> Brain.rememberKnowledge) and
 * the production read path (AIService.recall -> Brain.recall).
 * A page reload is a genuinely fresh runtime: new JS context, new
 * singletons, same origin storage.
 */
import { chromium } from "playwright";

const MARKER = `axolotl-${Date.now().toString(36)}`;
const FACT = `The user's axolotl is named Zephyrine-${MARKER}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
// One persistent context so storage survives the reload, like a real user.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(16000);

/* ---------- SESSION A: write through the production path ---------- */
const wrote = await page.evaluate(async ({ fact }) => {
  const { default: AIService } = await import("/src/core/AIService.ts");
  const ai = AIService.getInstance();
  await ai.initialize();
  const ok = await ai.consolidate("knowledge", fact, ["axolotl", "pet", "name", "zephyrine"]);
  const immediate = await ai.recall("axolotl name");
  return { ok, immediate: immediate.length, dbs: (await indexedDB.databases()).map(d => d.name) };
}, { fact: FACT });
console.log("SESSION A — consolidate() returned:", wrote.ok);
console.log("SESSION A — immediate recall count:", wrote.immediate);
console.log("SESSION A — IndexedDB databases:", JSON.stringify(wrote.dbs));

/* ---------- inspect the RAW database, not the API ---------- */
const raw = await page.evaluate(async ({ marker }) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open("lelu-memory");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const db = await open();
  const stores = [...db.objectStoreNames];
  const out = {};
  for (const name of stores) {
    const rows = await new Promise((res) => {
      const tx = db.transaction(name, "readonly").objectStore(name).getAll();
      tx.onsuccess = () => res(tx.result || []); tx.onerror = () => res([]);
    });
    out[name] = { count: rows.length, hasMarker: JSON.stringify(rows).includes(marker) };
  }
  return { stores, out };
}, { marker: MARKER });
console.log("SESSION A — raw IndexedDB stores:", JSON.stringify(raw.out));

/* ---------- RELOAD: a genuinely fresh runtime ---------- */
await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(16000);

const read = await page.evaluate(async () => {
  const { default: AIService } = await import("/src/core/AIService.ts");
  const ai = AIService.getInstance();
  await ai.initialize();
  const recalled = await ai.recall("what is the axolotl called");
  const all = await ai.getMemories(500);
  return {
    recalled: recalled.map(r => ({ response: r.response, confidence: r.confidence })),
    total: all.length,
  };
});
console.log("\nSESSION B (after reload) — total memories:", read.total);
console.log("SESSION B — recall('what is the axolotl called'):");
for (const r of read.recalled) console.log("   ", JSON.stringify(r.response).slice(0, 140));
const survived = read.recalled.some(r => r.response.includes(MARKER));
console.log("\nUNIQUE MARKER SURVIVED THE RELOAD:", survived ? "YES" : "NO");
console.log("marker was:", MARKER);
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(survived ? 0 : 1);
