import { chromium } from "playwright";
const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(8000);

const out = await page.evaluate(async () => {
  const { default: SourceAccess } = await import("/src/core/selfdev/SourceAccess.ts");
  const a = SourceAccess.getInstance();
  const res = {};

  res.snapshotPathCount = a.snapshotPaths().length;
  res.snapshotSample = a.snapshotPaths().slice(0, 3);
  res.hasSelfStudyInSnapshot = a.snapshotPaths().includes("/src/core/cognition/SelfStudyEngine.ts");

  // Probe repeatedly to see whether the status probe is flaky.
  const probes = [];
  for (let i = 0; i < 5; i++) {
    const s = await a.status(true);
    probes.push({ reachable: s.reachable, error: s.error ?? null });
  }
  res.probes = probes;

  // Read with the runtime reachable.
  const live = await a.read("src/core/cognition/SelfStudyEngine.ts");
  res.liveRead = { origin: live.origin, bytes: live.content?.length ?? 0, error: live.error ?? null };

  // Now force the snapshot path by pointing the client at a dead runtime.
  const originalBase = a.baseUrl;
  a.baseUrl = () => "http://127.0.0.1:59999";
  a.cachedStatus = null;
  const deadStatus = await a.status(true);
  const snap = await a.read("src/core/cognition/SelfStudyEngine.ts");
  res.snapshotRead = {
    runtimeReachable: deadStatus.reachable,
    origin: snap.origin,
    bytes: snap.content?.length ?? 0,
    error: snap.error ?? null,
  };
  const snapList = await a.list("src/core/cognition");
  res.snapshotList = { origin: snapList.origin, entries: snapList.entries.length };
  a.baseUrl = originalBase;
  a.cachedStatus = null;
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
