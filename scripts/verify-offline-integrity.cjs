/**
 * MASTER INTEGRATION — offline behaviour against the PRODUCTION build
 * (`vite preview`, service worker registered), in Chromium.
 *
 *   LELU_BASE=http://127.0.0.1:4173/ node scripts/verify-offline-integrity.cjs <outDir>
 *
 *  1. Online: the service worker takes control; a direct command makes an artwork.
 *  2. Network cut (context.setOffline): a direct command still makes a sketch,
 *     and the conversation + Studio data are valid JSON with nothing lost.
 *  3. Reload while offline: does the shell boot from the service worker?
 *  4. Back online, reload: every conversation and artifact made before and
 *     during the outage is present and parses — no corruption.
 * Model generation routes are aborted and counted throughout.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:4173/";
const OUT = path.resolve(process.argv[2] ?? "docs/acceptance/master-integration");
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ""}`); };

const snapshot = (page) => page.evaluate(() => {
  const read = (k) => { const raw = localStorage.getItem(k); if (raw === null) return { present: false }; try { const v = JSON.parse(raw); return { present: true, valid: true, bytes: raw.length, value: v }; } catch { return { present: true, valid: false, bytes: raw.length }; } };
  const studio = read("lelu.studio.artifacts.v1");
  const chats = read("lelu.multichat.workspace.v1");
  const artifacts = studio.valid ? (Array.isArray(studio.value) ? studio.value : studio.value.artifacts ?? Object.values(studio.value)).length : null;
  const convs = chats.valid ? (chats.value.conversations ?? chats.value.chats ?? []) : [];
  const messages = Array.isArray(convs) ? convs.reduce((a, c) => a + (c.messages?.length ?? 0), 0) : null;
  return { studio: { present: studio.present, valid: studio.valid, bytes: studio.bytes }, chats: { present: chats.present, valid: chats.valid, bytes: chats.bytes }, artifacts, messages, titles: studio.valid ? JSON.stringify(studio.value).match(/"title":"[^"]{0,60}"/g)?.slice(0, 12) : null };
});

async function enter(page) {
  for (let i = 0; i < 80; i++) { await page.waitForTimeout(500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  const c = await page.evaluate(() => { const b = document.querySelector('[data-spatial-control="chat"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (c) await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(2500);
}
async function say(page, text) {
  const p = await page.evaluate(() => { const vis = (e) => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 40 && (h === e || e.contains(h)); }; const el = [...document.querySelectorAll(".lcu-win-composer textarea")].find(vis) ?? [...document.querySelectorAll(".lcu-input textarea")].find(vis); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (!p) return false;
  await page.mouse.click(p.x, p.y); await page.keyboard.type(text); await page.keyboard.press("Enter");
  await page.waitForTimeout(9000);
  return true;
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "allow" });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  let model = 0;
  await ctx.route(/\/api\/(model|ai|chat)(\/|$|\?)/, (r) => { if (r.request().method() === "GET") return r.continue(); model++; r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  // 1. online
  await page.goto(BASE, { waitUntil: "load" });
  const sw = await page.evaluate(async () => { const r = await Promise.race([navigator.serviceWorker.ready.then((x) => !!x.active), new Promise((res) => setTimeout(() => res(false), 15000))]); return { ready: r, scope: (await navigator.serviceWorker.getRegistration())?.scope ?? null }; });
  await page.reload({ waitUntil: "load" }); // controlled from here on; assets pass through the worker's cache
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check("production service worker registered and controlling the page", sw.ready && controlled, JSON.stringify({ ...sw, controlled }));
  await enter(page);
  await say(page, "/art orbits neon");
  const online = await snapshot(page);
  check("online: an artwork made with a direct command is stored", online.studio.valid && online.artifacts >= 1, JSON.stringify({ ...online, titles: undefined }));

  // 2. network cut
  await ctx.setOffline(true);
  await say(page, "/sketch offline evening gown");
  await page.screenshot({ path: path.join(SHOTS, "offline-1-sketch-made-offline.png") });
  const crashOffline = await page.evaluate(() => /GENESIS CRASH/.test(document.body.innerText));
  check("offline: no crash screen after making the sketch", !crashOffline);
  const during = await snapshot(page);
  check("offline: a direct command still works and stores its artifact", during.studio.valid && during.artifacts > online.artifacts, `${online.artifacts} → ${during.artifacts} artifacts`);
  check("offline: stored data stays valid JSON, nothing lost", during.studio.valid && during.chats.valid && during.messages >= online.messages, JSON.stringify({ ...during, titles: undefined }));

  // 3. reload while offline
  let offlineBoot = { navigated: false };
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(8000);
    offlineBoot = await page.evaluate(() => ({ navigated: true, title: document.title, root: !!document.querySelector("#root")?.children.length, crash: /GENESIS CRASH/.test(document.body.innerText), unavailableCards: document.querySelectorAll("[data-lelu-embed-unavailable]").length, entry: [...document.querySelectorAll("button")].some((b) => /Continue without an account/.test(b.textContent)) }));
  } catch (e) { offlineBoot = { navigated: false, error: String(e).slice(0, 160) }; }
  await page.screenshot({ path: path.join(SHOTS, "offline-2-reload-offline.png") }).catch(() => {});
  // A non-empty root is not enough: run 1 passed while the page showed "GENESIS CRASH".
  check("offline reload: the app shell is served by the service worker and does not crash", offlineBoot.navigated && offlineBoot.root && !offlineBoot.crash, JSON.stringify(offlineBoot));
  const afterOfflineReload = await snapshot(page).catch(() => null);
  check("offline reload: stored data still intact", afterOfflineReload && afterOfflineReload.studio.valid && afterOfflineReload.artifacts === during.artifacts, JSON.stringify(afterOfflineReload && { ...afterOfflineReload, titles: undefined }));

  // 4. back online
  await ctx.setOffline(false);
  await page.reload({ waitUntil: "load" });
  await enter(page);
  const back = await snapshot(page);
  await page.screenshot({ path: path.join(SHOTS, "offline-3-back-online.png") });
  check("back online: every artifact and message from before and during the outage is present and valid", back.studio.valid && back.chats.valid && back.artifacts >= during.artifacts && back.messages >= during.messages, `${JSON.stringify({ artifacts: back.artifacts, messages: back.messages })} · ${back.titles?.join(" ")}`);
  check("no model calls", model === 0, `${model}`);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  fs.writeFileSync(path.join(OUT, "offline-run.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), online: { ...online, titles: undefined }, during: { ...during, titles: undefined }, offlineBoot, back: { ...back }, modelCalls: model, errors, results }, null, 2));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
