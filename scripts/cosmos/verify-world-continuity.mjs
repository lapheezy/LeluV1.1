/**
 * M17.3-WP02 — world continuity through the REAL app.
 *
 * Every transition path in the directive, driven with the interface's own
 * controls. After each step the app is polled (not sampled once) until it
 * settles, and the settled state is checked and the time it took recorded:
 *
 *   world     the Cosmos world is mounted (genesis-v1 canvases) exactly when
 *             the Cosmos is what is shown, and never twice
 *   room      Genesis V2 is mounted exactly when the Room is shown
 *   companion steps into the Room there, and is beside you everywhere else
 *   objects   the Cosmos objects (ids, positions) and the selected place
 *             survive every transition and reload
 *
 * This container has no GPU: WebGL runs in software at 1–3 fps, so a
 * transition takes seconds here. Times are reported, not hidden.
 *   node scripts/cosmos/verify-world-continuity.mjs     (vite dev on :5173)
 */
import { launch, track } from "../evolution/harness.mjs";
import { devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = process.env.SHOTS ?? "docs/missions/m17-cosmos/m17.3/wp02/shots";
const RESULTS = process.env.RESULTS ?? "docs/missions/m17-cosmos/m17.3/wp02/verify-world-continuity.json";
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 15000);
await mkdir(OUT, { recursive: true });
const results = [];
const timings = [];
let n = 0;
const check = (objective, name, ok, detail = "") => {
  results.push({ objective, name, status: ok ? "VERIFIED" : "FAILED", detail });
  console.log(`${ok ? "✓" : "✗"} [${objective}] ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};
const shot = async (page, name) => {
  n += 1;
  const path = `${OUT}/${String(n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path });
  console.log(`  📸 ${path}`);
};

async function enter(page, path = "") {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count()) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    }
    if (!(await page.locator("[data-lelu-signin-gate]").count()) && ((await page.locator("[data-lelu-home]").count()) || path)) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
}

/** Everything the transition must get right, read from the page. */
const read = (page) =>
  page.evaluate(async () => {
    const C = (await import("/src/core/interface/InterfaceCompositionStore.ts")).default.getState();
    const O = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance();
    const N = (await import("/src/core/cosmos/CosmosNavigation.ts")).default.getInstance().getState();
    const comp = document.querySelector("[data-testid=lelu-companion]");
    const regions = [...document.querySelectorAll("[data-region-key]")].map((e) => ({ id: e.dataset.interface, live: e.dataset.live === "true", current: e.dataset.current === "true" }));
    return {
      composition: C.open?.compositionId ?? null,
      current: regions.find((r) => r.current)?.id ?? null,
      liveWebgl: regions.filter((r) => r.live && (r.id === "cosmos" || r.id === "lelu-room")).map((r) => r.id),
      worldSections: document.querySelectorAll('[data-workspace="genesis-v1"]').length,
      worldCanvases: document.querySelectorAll('[data-workspace="genesis-v1"] canvas').length,
      roomScenes: document.querySelectorAll('[data-workspace="genesis-v2"]').length,
      companion: comp ? { presence: comp.dataset.presence, visible: getComputedStyle(comp).visibility === "visible" } : null,
      objects: O.list().map((o) => `${o.id}@${o.frame.position.join(",")}`).sort().join("|"),
      place: N.currentId ?? N.current ?? null,
      neuralOpen: Boolean(document.querySelector("[data-neural-map-view]")),
    };
  });

/** The settled state that is right for what is shown. */
const expectations = {
  cosmos: (s) => s.worldSections === 1 && s.worldCanvases > 0 && s.roomScenes === 0 && s.companion?.presence !== "world" && s.companion?.visible,
  room: (s) => s.roomScenes === 1 && s.worldCanvases === 0 && s.companion?.presence === "world" && !s.companion?.visible,
  other: (s) => s.roomScenes === 0 && s.worldCanvases === 0 && s.companion?.presence !== "world" && s.companion?.visible,
  home: (s) => s.roomScenes === 0 && s.composition === null && s.companion?.presence !== "world",
};
async function settle(page, label, want, extra = () => true) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < SETTLE_MS) {
    s = await read(page);
    if (expectations[want](s) && extra(s)) break;
    await page.waitForTimeout(200);
  }
  const ms = Date.now() - t0;
  const ok = Boolean(s && expectations[want](s) && extra(s));
  timings.push({ label, want, ms, ok });
  return { s, ms, ok };
}
const describe = (s) => `current ${s?.current} · world ${s?.worldSections}/${s?.worldCanvases} · room ${s?.roomScenes} · companion ${s?.companion?.presence}/${s?.companion?.visible ? "visible" : "hidden"}`;

const openLibrary = async (page) => {
  await page.click('nav.lsn button[aria-label="Infinite Library"]');
  await page.waitForSelector("[data-library-interfaces]");
  await page.waitForTimeout(1200);
};
const openOneLelu = async (page) => {
  await openLibrary(page);
  await page.click('[data-library-composition="one-lelu"] .lsh-world');
  await page.waitForSelector('[data-interface-journey="one-lelu"]');
  await page.waitForTimeout(1500);
};
const jump = (page, id) => page.click(`[data-jump="${id}"]`);
const step = async (page, objective, label, action, want, extra) => {
  await action();
  const r = await settle(page, label, want, extra);
  check(objective, `${label} → settles ${r.ok ? "correctly" : "WRONG"} in ${(r.ms / 1000).toFixed(1)} s`, r.ok, describe(r.s));
  return r;
};

const browser = await launch();
const errors = [];

/* =============================== desktop =============================== */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {} });
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);

  // Real objects in the Cosmos, so "restore its objects" is checked against something.
  await page.evaluate(async () => {
    const { buildCabin, buildGearbox } = await import("/src/core/creative/kit/build/index.ts");
    const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance();
    for (const [name, p] of [["Cabin", buildCabin({}).program], ["Gearbox", buildGearbox({ teethIn: 14, teethOut: 28 }).program]]) {
      S.spawn({ name, scene: p.scene, domain: p.domain, builder: p.builder, partCount: p.parts.length });
    }
  });
  const objects0 = (await read(page)).objects;
  check("B.3", "Two Cosmos objects exist before the transitions", objects0.split("|").length === 2, objects0);

  /* ---- the original failure, exactly: another composition's Room first ---- */
  await openLibrary(page);
  await page.click('[data-library-interface="og-inner-sky"] .lsh-pick');
  await page.click('[data-library-interface="lelu-room"] .lsh-pick');
  await page.click("[data-compose-picked]");
  await page.waitForSelector("[data-interface-journey]");
  await step(page, "B.1", "Original LÉLU + Room → Room", () => jump(page, "lelu-room"), "room");
  await step(page, "B.1", "Close the composition (back to the Cosmos)", () => page.click('button[aria-label="Close and return to the Cosmos"]'), "home", (s) => s.composition === null);
  await openOneLelu(page);
  await shot(page, "one-lelu-start");

  /* ---- B.4: Cosmos → Room → Cosmos, repeated ---- */
  await step(page, "B.4", "One LÉLU → Cosmos", () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");
  await step(page, "B.4", "Cosmos → Room", () => jump(page, "lelu-room"), "room", (s) => s.current === "lelu-room");
  await shot(page, "in-room");
  let r = await step(page, "B.1", "Room → Cosmos (the M17.1 failing step)", () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");
  check("B.3", "…the world is restored with the same objects (ids and positions)", r.s?.objects === objects0, r.s?.objects);
  await shot(page, "room-to-cosmos-restored");
  for (let i = 1; i <= 3; i++) {
    await step(page, "B.4", `Repeat ${i}: Cosmos → Room`, () => jump(page, "lelu-room"), "room", (s) => s.current === "lelu-room");
    r = await step(page, "B.4", `Repeat ${i}: Room → Cosmos`, () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");
  }
  check("B.4", "After 4 round trips: one world section, no Room left behind, objects unchanged", r.s?.worldSections === 1 && r.s?.roomScenes === 0 && r.s?.objects === objects0, describe(r.s));

  /* ---- Cosmos → Room → another interface → Cosmos ---- */
  await step(page, "B.4", "Cosmos → Room", () => jump(page, "lelu-room"), "room", (s) => s.current === "lelu-room");
  await step(page, "B.4", "Room → System UI", () => jump(page, "lelu-system"), "other", (s) => s.current === "lelu-system");
  await step(page, "B.4", "System UI → Cosmos", () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");

  /* ---- rapid: Room and Cosmos pressed back to back, then settle ---- */
  await jump(page, "lelu-room");
  await page.waitForTimeout(150);
  await jump(page, "cosmos");
  await page.waitForTimeout(150);
  await jump(page, "lelu-room");
  await page.waitForTimeout(150);
  r = await step(page, "B.4", "Rapid Room/Cosmos/Room/Cosmos presses settle on the LAST one (Cosmos)", () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");
  check("B.4", "…with exactly one world and no Room scene left mounted", r.s?.worldSections === 1 && r.s?.roomScenes === 0, describe(r.s));

  /* ---- Cosmos → Room → Home → Cosmos ---- */
  await step(page, "B.4", "Cosmos → Room", () => jump(page, "lelu-room"), "room", (s) => s.current === "lelu-room");
  await step(page, "B.4", "Room → Home (the Home button)", () => page.click('nav.lsn button[aria-label="Home"]'), "home", (s) => s.composition === null);
  await openOneLelu(page);
  await step(page, "B.4", "Home → One LÉLU → Cosmos", () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");

  /* ---- Cosmos → Room → browser back → … ---- */
  await step(page, "B.4", "Cosmos → Room", () => jump(page, "lelu-room"), "room", (s) => s.current === "lelu-room");
  const urlBefore = page.url();
  await page.goBack().catch(() => {});
  await page.waitForTimeout(1500);
  const afterBack = await read(page);
  results.push({ objective: "B.4", name: "Browser Back from inside the Room (observed: the composition is not in the browser history)", status: "OBSERVED", informational: true, detail: `url ${urlBefore} → ${page.url()} · ${describe(afterBack)}` });
  console.log(`  · Back: ${urlBefore} → ${page.url()} · ${describe(afterBack)}`);
  if (page.url() !== urlBefore) await enter(page);
  // Whatever Back did, the app must be in one consistent state.
  const consistent = (s) => (s.current === "lelu-room" ? expectations.room(s) : s.current === "cosmos" ? expectations.cosmos(s) : s.roomScenes === 0);
  check("B.4", "After Back, the app is in one consistent state (no stale Room, no missing world)", consistent(await read(page)), describe(await read(page)));

  /* ---- with the Neural Map open ---- */
  await openOneLelu(page).catch(() => {});
  await step(page, "B.4", "Cosmos (with the Neural Map about to open)", () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");
  await page.evaluate(async () => (await import("/src/app/scene/genesis/neural/neuralView.ts")).NeuralView.openStandalone("cosmos.place:cosmos-core"));
  await page.waitForSelector("[data-neural-map-view]");
  await step(page, "B.4", "Neural Map open: Cosmos → Room", () => jump(page, "lelu-room").catch(() => page.evaluate(() => document.querySelector('[data-jump="lelu-room"]')?.click())), "room", (s) => s.current === "lelu-room");
  await page.evaluate(async () => (await import("/src/app/scene/genesis/neural/neuralView.ts")).NeuralView.closeStandalone());
  await step(page, "B.4", "Neural Map closed: Room → Cosmos", () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");

  /* ---- reloads ---- */
  await step(page, "B.4", "Cosmos → Room (before reload)", () => jump(page, "lelu-room"), "room", (s) => s.current === "lelu-room");
  await page.reload();
  await enter(page);
  r = await settle(page, "reload inside the Room", "home");
  const afterReloadRoom = await read(page);
  check("B.4", "Reload inside the Room: one consistent state; objects intact", afterReloadRoom.roomScenes <= 1 && afterReloadRoom.worldSections <= 1 && afterReloadRoom.objects === objects0 && (afterReloadRoom.roomScenes === 0 || afterReloadRoom.worldCanvases === 0), describe(afterReloadRoom));
  results.push({ objective: "B.4", name: "Where a reload inside the Room lands", status: "OBSERVED", informational: true, detail: describe(afterReloadRoom) + ` · composition ${afterReloadRoom.composition}` });
  await openOneLelu(page);
  await step(page, "B.4", "After that reload: → Cosmos", () => jump(page, "cosmos"), "cosmos", (s) => s.current === "cosmos");
  await page.reload();
  await enter(page);
  const afterReloadCosmos = await read(page);
  check("B.4", "Reload inside the Cosmos: objects intact, no Room scene, at most one world", afterReloadCosmos.objects === objects0 && afterReloadCosmos.roomScenes === 0 && afterReloadCosmos.worldSections <= 1, describe(afterReloadCosmos));
  await openOneLelu(page);
  r = await step(page, "B.1", "After both reloads: Room → Cosmos still restores", () => jump(page, "lelu-room").then(() => settle(page, "room", "room", (s) => s.current === "lelu-room")).then(() => jump(page, "cosmos")), "cosmos", (s) => s.current === "cosmos");
  await shot(page, "after-reloads-cosmos");
  await ctx.close();
}

/* =============================== iPhone (EMULATION) =============================== */
{
  const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
  await ctx.addInitScript(() => { try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {} });
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  await page.evaluate(async () => (await import("/src/core/interface/InterfaceCompositionStore.ts")).default.open("one-lelu"));
  await page.waitForSelector('[data-interface-journey="one-lelu"]');
  await page.waitForTimeout(1500);
  const tap = (id) => page.locator(`[data-jump="${id}"]`).tap();
  await step(page, "WP04", "iPhone (EMULATED): → Room", () => tap("lelu-room"), "room", (s) => s.current === "lelu-room");
  await step(page, "WP04", "iPhone (EMULATED): Room → Cosmos", () => tap("cosmos"), "cosmos", (s) => s.current === "cosmos");
  await shot(page, "iphone-room-to-cosmos");
  await ctx.close();
}

await browser.close();
const relevant = errors.filter((e) => !/ERR_CONNECTION|Failed to load resource|429|503|401|livekit|supabase|Provider|Wrong API Key|api\/integration|api\/engineer/i.test(e));
check("WP03", "No new page errors during the run", relevant.length === 0, relevant.slice(0, 4).join(" | "));
const restore = timings.filter((t) => t.want === "cosmos").map((t) => t.ms);
results.push({ objective: "WP05", name: "Time to a settled, correct state (this GPU-less container)", status: "MEASURED", informational: true, detail: JSON.stringify({ cosmosRestoreMs: { n: restore.length, min: Math.min(...restore), max: Math.max(...restore), median: restore.sort((a, b) => a - b)[Math.floor(restore.length / 2)] }, all: timings }) });
await writeFile(RESULTS, JSON.stringify({ at: new Date().toISOString(), results, timings, errors: relevant }, null, 2));
const scored = results.filter((x) => !x.informational);
const failed = scored.filter((x) => x.status !== "VERIFIED").length;
console.log(`\n${scored.length - failed}/${scored.length} VERIFIED`);
process.exit(failed ? 1 : 0);
