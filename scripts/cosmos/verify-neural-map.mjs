/**
 * M17.2 — Cosmos → Neural Map, through the REAL app UI.
 *
 * Objects are made and changed the way a person does it (Chat Universe
 * messages, which run the deterministic direct path — 0 model calls), and
 * through the Neural Map's own buttons (which run the same tools through
 * the dispatcher). After each operation the canonical map is read and
 * checked: identity, typed relations, no orphans, no duplicates.
 *
 * Evidence class: Chromium desktop (UI) + iPhone 15 Pro EMULATION. Not Safari.
 *   node scripts/cosmos/verify-neural-map.mjs     (vite dev on :5173)
 */
import { launch, track } from "../evolution/harness.mjs";
import { devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = process.env.SHOTS ?? "docs/missions/m17-cosmos/m17.2/shots";
const RESULTS = process.env.RESULTS ?? "docs/missions/m17-cosmos/m17.2/verify-neural-map.json";
await mkdir(OUT, { recursive: true });
const results = [];
const ops = [];
let n = 0;
const check = (objective, name, ok, detail = "") => {
  results.push({ objective, name, status: ok ? "VERIFIED" : "FAILED", detail });
  console.log(`${ok ? "✓" : "✗"} [${objective}] ${name}${detail ? ` — ${String(detail).slice(0, 260)}` : ""}`);
};
const shot = async (page, name) => {
  n += 1;
  const path = `${OUT}/${String(n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path });
  console.log(`  📸 ${path}`);
  return path;
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
  await page.waitForTimeout(2000);
}

/* The canonical map, read in the page (the same index every view reads). */
const mapRead = (page, fn, ...args) =>
  page.evaluate(async ([src, a]) => {
    const { neuralMap } = await import("/src/core/neural/NeuralMap.ts");
    return new Function("m", "a", `return (${src})(m, ...a)`)(neuralMap(), a);
  }, [fn.toString(), args]);
const rels = (page, id) => mapRead(page, (m, id) => m.relations(id, { direction: "out" }).map((x) => `${x.relation.type}>${x.relation.to}`).sort(), id);
const integrity = (page) => mapRead(page, (m) => ({ dangling: m.dangling().map((r) => r.id), duplicates: m.duplicates(), stats: m.stats() }));
const objects = (page) => page.evaluate(async () => { const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance(); return { live: S.list().map((o) => ({ id: o.id, name: o.name, parent: o.parent })), trash: S.trashList().map((o) => o.id) }; });
const idOf = async (page, word) => (await objects(page)).live.filter((o) => o.name.toLowerCase().includes(word)).map((o) => o.id);

async function chat(page, text) {
  if (!(await page.locator("[aria-label='Chat Universe']").count())) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
    await page.waitForSelector("[aria-label='Chat Universe']");
    await page.waitForTimeout(800);
  }
  const w = page.locator('textarea[aria-label^="Message "]:visible').first();
  const box = (await w.count()) ? w : page.locator(".lcu-composer textarea");
  const before = await page.evaluate(async () => (await import("/src/core/neural/NeuralMap.ts")).neuralMap().updateStats().length);
  const t0 = Date.now();
  await box.fill(text);
  await box.press("Enter");
  let reply = null;
  for (let i = 0; i < 60; i++) {
    reply = await page.evaluate(async (sent) => {
      const S = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
      const msgs = S.getActive()?.messages ?? [];
      let u = -1;
      msgs.forEach((m, i) => { if (m.role === "user" && String(m.text).trim() === sent) u = i; });
      const m = u < 0 ? null : msgs.slice(u + 1).find((x) => x.role !== "user");
      return m && m.activity?.status !== "running" ? { text: String(m.text), provider: m.provider, tools: (m.activity?.steps ?? []).filter((s) => s.kind === "tool").map((s) => `${s.tool}:${s.status}`) } : null;
    }, text);
    if (reply) break;
    await page.waitForTimeout(300);
  }
  const updates = await page.evaluate(async (k) => (await import("/src/core/neural/NeuralMap.ts")).neuralMap().updateStats().slice(k), before);
  ops.push({ via: "chat", text, ms: Date.now() - t0, provider: reply?.provider, tools: reply?.tools, mapUpdates: updates.map((u) => ({ authority: u.authority, ms: u.ms, changed: u.changed.length })) });
  return reply;
}
const closeChat = async (page) => { if (await page.locator("[aria-label='Chat Universe']").count()) await page.click("button[aria-label='Close Chat Universe']", { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(700); };

const browser = await launch();
const errors = [];

/* =============================== desktop =============================== */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {} });
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  await shot(page, "home");

  // The Neural Map is an interface of its own, in the Infinite Library.
  await page.click('nav.lsn button[aria-label="Infinite Library"]');
  await page.waitForSelector("[data-library-interfaces]");
  await page.waitForTimeout(2200);
  const listed = await page.locator('[data-library-category="Neural Map"] [data-library-interface="neural-map"]').count();
  check("O07", "The Neural Map is listed in the Infinite Library as its own interface", listed === 1);
  await page.locator('[data-library-category="Neural Map"]').scrollIntoViewIfNeeded();
  await shot(page, "library-neural-map");
  await page.click(".lsh-close");
  await page.waitForTimeout(500);

  /* ---------- objects into the Cosmos, by chat (deterministic path) ---------- */
  let r = await chat(page, "/build cabin");
  r = await chat(page, "put it into the cosmos");
  check("O04", "Chat: a built cabin is put into the Cosmos (cosmos.object.spawn, lelu-direct, 0 model calls)", r?.tools?.includes("cosmos.object.spawn:done") && r.provider === "lelu-direct", r?.tools);
  r = await chat(page, "/build gearbox");
  r = await chat(page, "put it into the cosmos");
  check("O04", "Chat: a built gearbox is put into the Cosmos", r?.tools?.includes("cosmos.object.spawn:done"), r?.tools);
  const [cabin] = await idOf(page, "cabin");
  const [gear] = await idOf(page, "gear");
  const CABIN = `cosmos.object:${cabin}`;
  const GEAR = `cosmos.object:${gear}`;
  let g = await rels(page, GEAR);
  check("O02", "Each object has its canonical identity in the map, located in the Cosmos core, created from its artifact", Boolean(cabin && gear) && g.includes("located-in>cosmos.place:cosmos-core") && g.some((x) => x.startsWith("created-from>record:artifact:")), `${GEAR}: ${g.join(", ")}`);
  await shot(page, "chat-objects-in-cosmos");

  // Attach (integrate)
  r = await chat(page, "attach the gear into the cabin");
  g = await rels(page, GEAR);
  check("O03", "Chat: attach the gearbox into the cabin → attached-to the cabin, no longer loose in the core", r?.tools?.includes("cosmos.object.integrate:done") && g.includes(`attached-to>${CABIN}`) && !g.some((x) => x.startsWith("located-in")), g.join(", "));
  // Extract
  r = await chat(page, "take the gear out");
  g = await rels(page, GEAR);
  check("O03", "Chat: take it out → extracted-from the cabin, located in the core again, same identity", r?.tools?.includes("cosmos.object.extract:done") && g.includes(`extracted-from>${CABIN}`) && g.includes("located-in>cosmos.place:cosmos-core") && (await idOf(page, "gear")).includes(gear), g.join(", "));
  // Duplicate
  r = await chat(page, "duplicate the gear");
  const gears = await idOf(page, "gear");
  const copy = gears.find((x) => x !== gear);
  const COPY = `cosmos.object:${copy}`;
  const c = copy ? await rels(page, COPY) : [];
  check("O03", "Chat: duplicate → a NEW identity derived-from the original (the original unchanged)", Boolean(copy) && c.includes(`derived-from>${GEAR}`) && (await rels(page, GEAR)).join() === g.join(), `${COPY}: ${c.join(", ")}`);
  // Move (spatial only)
  const relBeforeMove = await rels(page, GEAR);
  const posBefore = await mapRead(page, (m, id) => m.get(id).spatial.position, GEAR);
  // FINDING: in chat, "move the gear next to the cabin" is claimed by LÉLU's
  // World tools (world.state / world.object), not the Cosmos object tools —
  // a pre-existing routing overlap between two spatial systems. Recorded:
  r = await chat(page, "move the gear next to the cabin");
  results.push({ objective: "O11", name: "FINDING: chat 'move the gear next to the cabin' is routed to LÉLU's World tools, not cosmos.object.*", status: "OBSERVED", detail: JSON.stringify(r?.tools), informational: true });
  // The move itself, through the dispatcher — the path LÉLU's own tool call takes.
  const mv = await page.evaluate(async ([id]) => {
    const { neuralMap } = await import("/src/core/neural/NeuralMap.ts");
    const k = neuralMap().updateStats().length;
    const { dispatchToolCall, toolNameForModel } = await import("/src/core/tools/ToolDispatcher.ts");
    const t0 = performance.now();
    const res = await dispatchToolCall({ id: "mv", name: toolNameForModel("cosmos.object.transform"), arguments: { object: id, position: [9, 2, -14] } }, "verify-move", undefined, { path: "direct" });
    return { ok: res.ok, ms: Math.round((performance.now() - t0) * 100) / 100, updates: neuralMap().updateStats().slice(k).map((u) => ({ authority: u.authority, ms: u.ms, changed: u.changed })) };
  }, [gear]);
  ops.push({ via: "dispatcher", text: "cosmos.object.transform position", ms: mv.ms, mapUpdates: mv.updates.map((u) => ({ authority: u.authority, ms: u.ms, changed: u.changed.length })) });
  const posAfter = await mapRead(page, (m, id) => m.get(id).spatial.position, GEAR);
  const relAfterMove = await rels(page, GEAR);
  check("O03", "Move (cosmos.object.transform via the dispatcher) → spatial position changes, semantic relations untouched", mv.ok && JSON.stringify(posAfter) === JSON.stringify([9, 2, -14]) && relBeforeMove.join() === relAfterMove.join(), `${JSON.stringify(posBefore)} → ${JSON.stringify(posAfter)}`);
  const other = mv.updates.flatMap((u) => u.changed).filter((id) => id !== GEAR);
  check("O10", "A move updates ONLY the objects partition and reports only the moved object as changed", mv.updates.length > 0 && mv.updates.every((u) => u.authority === "cosmos.objects") && other.length === 0, JSON.stringify(mv.updates.map((u) => ({ a: u.authority, ms: u.ms, changed: u.changed }))));
  let integ = await integrity(page);
  check("O02", "No dangling relations and no duplicate identities after the chat lifecycle", integ.dangling.length === 0 && integ.duplicates.length === 0, JSON.stringify({ dangling: integ.dangling, duplicates: integ.duplicates }));
  await closeChat(page);

  /* ---------- the standalone Neural Map ---------- */
  await enter(page, `?interface=neural-map&entity=${encodeURIComponent(GEAR)}`);
  await page.waitForSelector("[data-neural-map-view]", { timeout: 15000 });
  await page.waitForTimeout(1500);
  const focused = await page.getAttribute(".nm-side [data-neural-entity]", "data-neural-entity");
  check("O07", "Standalone map opened by deep link resolves the Cosmos object's canonical identity", focused === GEAR, focused);
  const chips = await page.$$eval(".nm-side .nm-rel-group", (els) => els.map((e) => `${e.dataset.relation}:${e.dataset.direction}`));
  check("O07", "…with the same typed relations the map holds (extracted-from, located-in, created-from, duplicated into)", ["extracted-from:out", "located-in:out", "created-from:out", "derived-from:in"].every((k) => chips.includes(k)), chips.join(", "));
  await shot(page, "standalone-gear");
  // Follow a relationship: to the cabin it was extracted from.
  await page.click(`.nm-side .nm-rel-group[data-relation="extracted-from"] .nm-chip[data-to="${CABIN}"]`);
  await page.waitForTimeout(700);
  check("O06", "Follow a relationship in the map: gear → the cabin it was extracted from", (await page.getAttribute(".nm-side [data-neural-entity]", "data-neural-entity")) === CABIN);
  await shot(page, "standalone-follow-to-cabin");
  await page.click('button[aria-label="Back to the previous entity"]');
  await page.waitForTimeout(500);

  // Cross-view: an operation FROM the map (Remove → the existing tool) changes Cosmos.
  await page.click(`.nm-side [data-op="cosmos.object.remove"]`);
  await page.waitForTimeout(1200);
  let st = await mapRead(page, (m, id) => m.get(id)?.state, GEAR);
  let o = await objects(page);
  check("O08", "Map → Remove (cosmos.object.remove via the dispatcher): the object is in the store's trash and the map shows it trashed, lineage kept", st === "trashed" && o.trash.includes(gear) && (await rels(page, GEAR)).some((x) => x.startsWith("extracted-from")), `${st} · trash ${o.trash.join(",")}`);
  check("O08", "The copy's derived-from still resolves while its original is in the trash (no orphan)", (await rels(page, COPY)).includes(`derived-from>${GEAR}`) && (await integrity(page)).dangling.length === 0);
  await shot(page, "standalone-removed");
  await page.click(`.nm-side [data-op="cosmos.object.restore"]`);
  await page.waitForTimeout(1200);
  st = await mapRead(page, (m, id) => m.get(id)?.state, GEAR);
  check("O08", "Map → Restore: active again, same identity, located in the core", st === "active" && (await rels(page, GEAR)).includes("located-in>cosmos.place:cosmos-core"), st);
  // Map → Duplicate: a new entity, the view follows it.
  const before = (await objects(page)).live.length;
  await page.click(`.nm-side [data-op="cosmos.object.duplicate"]`);
  await page.waitForTimeout(1500);
  const nowFocus = await page.getAttribute(".nm-side [data-neural-entity]", "data-neural-entity");
  const after = (await objects(page)).live.length;
  check("O08", "Map → Duplicate: the Cosmos store gains an object and the map focuses its new identity, derived from the gear", after === before + 1 && nowFocus !== GEAR && (await rels(page, nowFocus)).includes(`derived-from>${GEAR}`), `${before} → ${after}, focus ${nowFocus}`);
  await shot(page, "standalone-duplicated");

  // Cross-view the other way: a CHAT operation while the map is open updates the map view live.
  await page.evaluate((id) => import("/src/app/scene/genesis/neural/neuralView.ts").then((v) => v.NeuralView.focus(id)), GEAR);
  await page.waitForTimeout(500);
  // By id: after duplicating, "the gear" names the newest copy (the resolver picks the latest match).
  r = await chat(page, `attach ${gear} into the cabin`);
  await closeChat(page);
  await page.waitForTimeout(800);
  const liveChips = await page.$$eval(".nm-side .nm-rel-group", (els) => els.map((e) => `${e.dataset.relation}:${e.dataset.direction}`));
  check("O08", "Chat → attach while the standalone map is open: the open map shows attached-to without reload or rebuild", liveChips.includes("attached-to:out"), liveChips.join(", "));
  await shot(page, "standalone-live-after-chat");

  // A clean page for the Cosmos steps. ?perf-world is the app's own dev-only
  // switch that paints the real Cosmos on a software renderer (this container
  // has no GPU; without it the world deliberately does not paint).
  await enter(page, `?perf-world&interface=neural-map&entity=${encodeURIComponent(GEAR)}`);
  await page.waitForSelector("[data-neural-map-view]", { timeout: 15000 });
  await page.waitForTimeout(800);
  // "Show in Cosmos" selects it (cosmos.object.select) and Return goes back with the selection.
  await page.click(`.nm-side [data-op="cosmos.object.select"]`);
  await page.waitForTimeout(800);
  await page.click("[data-close-neural-map]");
  await page.waitForTimeout(1500);
  const selected = await page.evaluate(async () => (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance().selectedId());
  check("O06", "Show in Cosmos → Return: back in the Cosmos with the object selected", selected === gear && (await page.locator("[data-neural-map-view]").count()) === 0, selected);

  /* ---------- the embedded inspector, from the Cosmos object's own controls ---------- */
  // Close every open window through the real "Open windows" sheet, so the Cosmos is what is on screen.
  await page.click('nav.lsn button[aria-label="Open windows"]').catch(() => {});
  await page.waitForTimeout(1200);
  for (let i = 0; i < 8; i++) {
    const close = page.locator('[data-testid=lelu-windows] .lsh-list-actions button[aria-label^="Close "]').first();
    if (!(await close.count())) break;
    await close.click();
    await page.waitForTimeout(400);
  }
  await page.click('[data-testid=lelu-windows] .lsh-close').catch(() => {});
  await page.waitForTimeout(600);
  // Look at the Cosmos (the Home steps aside), where the selected object shows its controls.
  await page.evaluate(async () => (await import("/src/app/scene/genesis/home/homeStore.ts")).default.setImmersive(true));
  await page.waitForTimeout(2500);
  // The object's OWN controls are drawn in the 3D scene next to it (drei <Html>), inside the Cosmos canvas wrapper.
  const neuralBtn = page.locator('[data-workspace="genesis-v1"] button', { hasText: /^Neural$/ }).first();
  const hasBtn = (await neuralBtn.count()) > 0;
  if (hasBtn) await neuralBtn.click({ timeout: 5000 }).catch(async () => neuralBtn.evaluate((b) => b.click()));
  await page.waitForTimeout(1200);
  const insp = await page.getAttribute("[data-neural-inspector] [data-neural-entity]", "data-neural-entity").catch(() => null);
  const chatCovering = await page.locator("[aria-label='Chat Universe'], [data-lelu-chat-window], [data-lelu-module-window]:visible, [data-lelu-universe-window]:visible").count();
  check("O06", "Cosmos object controls (in the 3D scene) → Neural: the embedded inspector shows the same canonical entity", hasBtn && insp === GEAR && chatCovering === 0, `button in Cosmos ${hasBtn} · inspector ${insp} · chat surfaces open ${chatCovering}`);
  await shot(page, "cosmos-embedded-inspector");
  // Inspector → Open map: same identity in the standalone view.
  await page.click("[data-neural-inspector] [data-open-standalone]");
  await page.waitForTimeout(1200);
  check("O07", "Embedded → Open map: the standalone map opens on the same identity", (await page.getAttribute(".nm-side [data-neural-entity]", "data-neural-entity")) === GEAR);
  await page.click("[data-close-neural-map]");
  await page.waitForTimeout(800);
  await page.click('[data-neural-inspector] button[aria-label="Close the Neural Map card"]').catch(() => {});

  /* ---------- an interface is part of the map too (composition region bar) ---------- */
  await page.evaluate(async () => (await import("/src/core/interface/InterfaceCompositionStore.ts")).default.open("one-lelu"));
  await page.waitForTimeout(2000);
  await page.click('[data-neural-of="og-inner-sky"]');
  await page.waitForTimeout(1000);
  const ifaceInsp = await page.getAttribute("[data-neural-inspector] [data-neural-entity]", "data-neural-entity").catch(() => null);
  check("O06", "A composition region's own bar opens its interface in the embedded Neural Map (interface:og-inner-sky, presented by One LÉLU)", ifaceInsp === "interface:og-inner-sky" && (await page.$$eval("[data-neural-inspector] .nm-rel-group", (els) => els.map((e) => e.dataset.relation))).includes("presents"), ifaceInsp);
  await shot(page, "composition-region-in-neural-map");
  await page.click('[data-neural-inspector] button[aria-label="Close the Neural Map card"]').catch(() => {});
  await page.evaluate(async () => (await import("/src/core/interface/InterfaceCompositionStore.ts")).default.close());

  /* ---------- reload: identities and relations re-derived, not duplicated ---------- */
  const snapshotOf = () => mapRead(page, (m) => ({
    entities: m.search({ authorities: ["cosmos.objects"], limit: 500 }).map((e) => `${e.id}:${e.state}`).sort(),
    relations: m.authorities().includes("cosmos.objects") ? m.search({ authorities: ["cosmos.objects"], limit: 500 }).flatMap((e) => m.relations(e.id, { direction: "out" }).map((x) => x.relation.id)).sort() : [],
  }));
  const beforeReload = await snapshotOf();
  await page.reload();
  await enter(page);
  await page.waitForTimeout(1500);
  const afterReload = await snapshotOf();
  check("O05", "Reload: every Cosmos object keeps its identity, state and relations (re-derived from the store's own persistence)", JSON.stringify(beforeReload) === JSON.stringify(afterReload) && beforeReload.entities.length >= 4, `${beforeReload.entities.length} objects · ${beforeReload.relations.length} relations`);
  integ = await integrity(page);
  check("O02", "After reload: 0 dangling, 0 duplicate identities", integ.dangling.length === 0 && integ.duplicates.length === 0, JSON.stringify(integ.stats.byAuthority));

  /* ---------- tools: LÉLU reads the same map ---------- */
  const viaTool = await page.evaluate(async (id) => {
    const { dispatchToolCall, toolNameForModel } = await import("/src/core/tools/ToolDispatcher.ts");
    const res = await dispatchToolCall({ id: "v", name: toolNameForModel("neural.inspect"), arguments: { entity: id } }, "verify", undefined, { path: "direct" });
    return { ok: res.ok, content: res.content };
  }, GEAR);
  check("O09", "neural.inspect (registered tool, through the dispatcher) describes the same entity", viaTool.ok && viaTool.content.includes(GEAR) && /is attached to/.test(viaTool.content), viaTool.content.split("\n").slice(0, 3).join(" | "));

  /* ---------- performance ---------- */
  // Every map update recorded during the session's operations (before the reload).
  const all = ops.flatMap((o) => o.mapUpdates.filter((u) => u.authority === "cosmos.objects").map((u) => u.ms));
  const objPerf = all.length ? { n: all.length, maxMs: Math.max(...all), avgMs: Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 1000) / 1000 } : null;
  // Since M17.2-WP02 the chat itself (chats) and the orchestrator's checkpoint project (projects) are
  // in the map and really change on every chat turn; no OTHER Cosmos-side partition may be rebuilt.
  const otherAuthorities = ops.flatMap((o) => o.mapUpdates.filter((u) => !["cosmos.objects", "chats", "projects", "studio"].includes(u.authority)));
  check("O10", "Every object operation in the session updated the map in < 5 ms; no other Cosmos-side partition was rebuilt (the chat turn's own chats/projects/studio updates are real changes since WP02)", objPerf && objPerf.maxMs < 5 && otherAuthorities.length === 0, `${JSON.stringify(objPerf)} · other partitions rebuilt: ${otherAuthorities.length}`);
  results.push({ objective: "O10", name: "Per-operation timings (chat round trip incl. UI; map update per authority)", status: "MEASURED", detail: JSON.stringify(ops.map((x) => ({ text: x.text, ms: x.ms, map: x.mapUpdates }))), informational: true });
  await ctx.close();
}

/* =============================== iPhone (EMULATION) =============================== */
{
  const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
  await ctx.addInitScript(() => { try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {} });
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page, "?interface=neural-map");
  await page.waitForSelector("[data-neural-map-view]", { timeout: 15000 });
  await page.waitForTimeout(1500);
  const fits = await page.evaluate(() => { const v = document.querySelector("[data-neural-map-view]").getBoundingClientRect(); return v.width <= window.innerWidth + 1; });
  check("O12", "iPhone (emulated): the standalone Neural Map opens and fits the screen", fits);
  await shot(page, "iphone-neural-map");
  await page.locator('[aria-label="Find in the Neural Map"]').fill("cosmos");
  await page.waitForTimeout(500);
  await page.locator(".nm-hits [data-hit]").first().tap();
  await page.waitForTimeout(800);
  await shot(page, "iphone-neural-map-focused");
  await ctx.close();
}

await browser.close();
const relevant = errors.filter((e) => !/ERR_CONNECTION|Failed to load resource|429|503|livekit|supabase|Access to fetch at 'https:\/\/export\.arxiv/i.test(e));
check("O11", "No new page errors during the run", relevant.length === 0, relevant.slice(0, 4).join(" | "));
await writeFile(RESULTS, JSON.stringify({ at: new Date().toISOString(), results, ops, errors: relevant }, null, 2));
const scored = results.filter((x) => !x.informational);
const failed = scored.filter((x) => x.status !== "VERIFIED").length;
console.log(`\n${scored.length - failed}/${scored.length} VERIFIED`);
process.exit(failed ? 1 : 0);
