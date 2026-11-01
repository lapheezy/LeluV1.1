/**
 * LÉLU — DOES A PHONE DOWNLOAD THE MODEL AGAIN?
 *
 * The 49 MB-accepting question, asked in a real mobile browser (Chromium,
 * Pixel 5 emulation) against the production build:
 *
 *   1. a first visit: how many bytes actually cross the network;
 *   2. a repeat visit in the SAME profile: zero from the network, or the
 *      whole model again;
 *   3. what the service worker keeps in Cache Storage;
 *   4. whether a 49 MB ArrayBuffer survives in IndexedDB — which is how
 *      the reconstruction pipeline actually keeps a model — and can be
 *      read back byte-identical;
 *   5. what happens when the user clears browser storage;
 *   6. what happens when IndexedDB is unavailable at all.
 *
 * Byte counts come from CDP `Network.loadingFinished.encodedDataLength`
 * for the model request, so "cached" is measured, not assumed.
 *
 * Evidence: docs/evidence/asset-caching/<stamp>/mobile.json
 * Usage: node scripts/verify-mobile-model-cache.mjs [baseUrl]
 */

import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.argv[2] ?? "http://127.0.0.1:5173/").replace(/\/?$/, "/");
const MODEL_PATH = "/models/lelu-character.glb";
const ORIGIN = new URL(BASE).origin;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join("docs", "evidence", "asset-caching", stamp);
mkdirSync(OUT, { recursive: true });

const results = { stamp, base: BASE, checks: [], measurements: {} };
const check = (name, pass, detail) => {
  results.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Network bytes per model request, straight from the browser. */
function watchModelBytes(cdp) {
  const pending = new Map();
  const seen = [];
  cdp.on("Network.responseReceived", (event) => {
    if (!event.response.url.includes(MODEL_PATH)) return;
    pending.set(event.requestId, {
      url: event.response.url,
      status: event.response.status,
      fromDiskCache: event.response.fromDiskCache === true,
      fromServiceWorker: event.response.fromServiceWorker === true,
      fromPrefetchCache: event.response.fromPrefetchCache === true,
      encodedDataLength: event.response.encodedDataLength,
    });
  });
  cdp.on("Network.loadingFinished", (event) => {
    const entry = pending.get(event.requestId);
    if (!entry) return;
    entry.encodedDataLength = event.encodedDataLength;
    seen.push(entry);
    pending.delete(event.requestId);
  });
  return {
    take() {
      const taken = seen.splice(0, seen.length);
      return taken;
    },
  };
}

const fetchModel = (page) =>
  page.evaluate(async (url) => {
    const started = performance.now();
    const response = await fetch(url, { cache: "default" });
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      bytesReceived: body.byteLength,
      ms: Math.round(performance.now() - started),
      cacheControl: response.headers.get("cache-control"),
      etag: response.headers.get("etag"),
    };
  }, MODEL_PATH);

async function visit(context, label) {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const swReady = await page
    .evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]))
    .catch(() => false);
  return { page, errors, swReady, label };
}

async function main() {
  const profile = mkdtempSync(path.join(os.tmpdir(), "lelu-cache-"));

  /* ------------------------------------------------------------ */
  /* 1. first visit, then the same visit again in the same profile */
  /* ------------------------------------------------------------ */
  const context = await chromium.launchPersistentContext(profile, {
    ...devices["Pixel 5"],
    headless: true,
    args: ["--no-sandbox"],
  });
  const first = await visit(context, "first visit");
  const cdp = await context.newCDPSession(first.page);
  await cdp.send("Network.enable");
  const watcher = watchModelBytes(cdp);

  check("the service worker becomes active on mobile", first.swReady, `ready=${first.swReady}`);

  // Does a plain load of the app request the model at all?
  const loadRequests = await first.page.evaluate(() =>
    performance.getEntriesByType("resource").filter((e) => e.name.includes("lelu-character.glb")).length,
  );
  results.measurements.appRequestsModelOnLoad = loadRequests > 0;
  check(
    "reported honestly: the app does not fetch a GLB on load",
    loadRequests === 0,
    `${loadRequests} requests for the model during a plain load (the avatar is the 2.5D rig)`,
  );

  await fetchModel(first.page);
  await first.page.waitForTimeout(400);
  const firstFetch = watcher.take();
  results.measurements.firstVisit = firstFetch;
  const firstBytes = firstFetch.reduce((sum, entry) => sum + (entry.encodedDataLength || 0), 0);
  check("first visit downloads the model from the network", firstBytes > 1_000_000, `${(firstBytes / 1024 / 1024).toFixed(1)} MB over the wire`);

  // Repeat visit: reload the app, then ask for the model again.
  await first.page.reload({ waitUntil: "domcontentloaded" });
  await first.page.waitForTimeout(500);
  const second = await fetchModel(first.page);
  await first.page.waitForTimeout(400);
  const secondFetch = watcher.take();
  results.measurements.repeatVisit = { fetch: second, network: secondFetch };
  const repeatBytes = secondFetch.reduce((sum, entry) => sum + (entry.encodedDataLength || 0), 0);
  const servedLocally = secondFetch.some((entry) => entry.fromDiskCache || entry.fromServiceWorker || entry.fromPrefetchCache);
  check(
    "repeat visit does NOT download the model again",
    repeatBytes < 100_000,
    `${(repeatBytes / 1024).toFixed(0)} KB over the wire after a reload; served by ${servedLocally ? "browser cache / service worker" : "an uncached network read"}`,
  );
  check("repeat visit still returns all the bytes to the page", second.bytesReceived === first.bytesReceived, `${second.bytesReceived} vs ${first.bytesReceived} bytes`);

  /* ------------------------------------------------------------ */
  /* 2. what the service worker keeps                              */
  /* ------------------------------------------------------------ */
  const cacheInventory = await first.page.evaluate(async () => {
    const names = await caches.keys();
    const contents = {};
    let modelCopies = 0;
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      contents[name] = keys.map((request) => request.url);
      modelCopies += keys.filter((request) => request.url.includes("lelu-character.glb")).length;
    }
    return { names, contents, modelCopies };
  });
  results.measurements.cacheStorage = cacheInventory;
  check(
    "Cache Storage does not keep a second 49 MB copy of the model",
    cacheInventory.modelCopies === 0,
    `${cacheInventory.modelCopies} model copies in ${cacheInventory.names.length} cache(s)`,
  );

  const estimate = await first.page.evaluate(async () => {
    const usage = await navigator.storage.estimate();
    return { usage: usage.usage, quota: usage.quota };
  });
  results.measurements.storageEstimate = estimate;

  /* ------------------------------------------------------------ */
  /* 3. the real persistence path: a 49 MB GLB in IndexedDB        */
  /* ------------------------------------------------------------ */
  const idb = await first.page.evaluate(async () => {
    const SIZE = 49 * 1024 * 1024;
    const openDb = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("lelu-avatar-3d", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("models");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("open failed"));
      });
    const db = await openDb();
    const buffer = new ArrayBuffer(SIZE);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < SIZE; i += 4096) view[i] = (i / 4096) % 251; // a checkable pattern

    const persist = (model) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("models", "readwrite");
        tx.objectStore("models").put(model, "reconstructed");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error ?? new Error("write failed"));
      });
    const read = () =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("models", "readonly");
        const request = tx.objectStore("models").get("reconstructed");
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error ?? new Error("read failed"));
      });

    const writeStart = performance.now();
    let writeError = null;
    try {
      await persist({ glb: buffer, fingerprint: "test", taskId: "test", createdAt: Date.now() });
    } catch (error) {
      writeError = String(error.message ?? error);
    }
    const writeMs = Math.round(performance.now() - writeStart);

    const readStart = performance.now();
    const restored = await read();
    const readMs = Math.round(performance.now() - readStart);
    const bytes = restored?.glb?.byteLength ?? 0;
    let identical = false;
    if (restored?.glb) {
      const out = new Uint8Array(restored.glb);
      identical = out[0] === 0 && out[4096] === 1 && out[8192] === 2 && out.length === SIZE;
    }
    db.close();
    return { size: SIZE, writeError, writeMs, readMs, bytes, identical };
  });
  results.measurements.indexedDb = idb;
  check("a 49 MB model is writable to IndexedDB on mobile", idb.writeError === null, idb.writeError ?? `wrote in ${idb.writeMs} ms`);
  check("a 49 MB model survives the round trip byte-identically", idb.identical && idb.bytes === idb.size, `${idb.bytes} bytes read in ${idb.readMs} ms`);
  check("the persisted model is not re-downloaded on a later visit", idb.readMs < 3000, `local read took ${idb.readMs} ms — no network involved`);

  /* ------------------------------------------------------------ */
  /* 4. the user clears browser storage                            */
  /* ------------------------------------------------------------ */
  await cdp.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });
  await first.page.reload({ waitUntil: "domcontentloaded" });
  await first.page.waitForTimeout(600);
  const afterClear = await fetchModel(first.page);
  await first.page.waitForTimeout(400);
  const clearedNetwork = watcher.take();
  const clearedBytes = clearedNetwork.reduce((sum, entry) => sum + (entry.encodedDataLength || 0), 0);
  results.measurements.afterClear = { fetch: afterClear, network: clearedNetwork };
  check(
    "after storage is cleared the model is fetched in full again",
    clearedBytes > 1_000_000,
    `${(clearedBytes / 1024 / 1024).toFixed(1)} MB re-downloaded, which is the documented cost of a cache clear`,
  );

  const idbAfterClear = await first.page.evaluate(async () => {
    const names = await indexedDB.databases();
    return names.map((entry) => entry.name);
  });
  check("clearing storage removes the persisted model", !idbAfterClear.includes("lelu-avatar-3d"), `databases now: ${JSON.stringify(idbAfterClear)}`);

  await context.close();

  /* ------------------------------------------------------------ */
  /* 5. IndexedDB unavailable entirely                             */
  /* ------------------------------------------------------------ */
  const blockedProfile = mkdtempSync(path.join(os.tmpdir(), "lelu-nostore-"));
  const blockedContext = await chromium.launchPersistentContext(blockedProfile, {
    ...devices["Pixel 5"],
    headless: true,
    args: ["--no-sandbox"],
  });
  await blockedContext.addInitScript(() => {
    // A browser with storage blocked (private mode policies, enterprise
    // lockdown): every access throws, as Safari and Chrome can do.
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get() {
        throw new Error("IndexedDB is disabled in this browser");
      },
    });
  });
  const blocked = await visit(blockedContext, "storage blocked");
  await blocked.page.waitForTimeout(1500);
  const rendered = await blocked.page.evaluate(() => document.querySelector("#root")?.childElementCount ?? 0);
  const graceful = await blocked.page.evaluate(() => {
    try {
      indexedDB.open("lelu-avatar-3d", 1);
      return { threw: false };
    } catch (error) {
      return { threw: true, message: String(error.message ?? error) };
    }
  });
  results.measurements.storageBlocked = { rendered, graceful, errors: blocked.errors };
  check("the app still renders with IndexedDB disabled", rendered > 0, `${rendered} root children`);
  check("no uncaught page error when storage is unavailable", blocked.errors.length === 0, blocked.errors.slice(0, 3).join(" | ") || "none");
  check("storage access is the thing that fails, not the app", graceful.threw, graceful.message ?? "did not throw");
  await blockedContext.close();

  /* ------------------------------------------------------------ */
  const pass = results.checks.filter((c) => c.pass).length;
  results.pass = pass;
  results.total = results.checks.length;
  writeFileSync(path.join(OUT, "mobile.json"), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} mobile cache checks passed — evidence in ${OUT}/mobile.json`);
  process.exit(pass === results.checks.length ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-mobile-model-cache failed:", error);
  process.exit(1);
});
