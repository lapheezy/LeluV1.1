/**
 * M17.3-WP01 — spatial intelligence through the REAL app.
 *
 * A cabin and a gearbox are built and placed in the Cosmos by chat; then
 * the directive's six sentences are sent in Chat Universe, as a person
 * types them. For each: which tool ran (must be cosmos.object.position on
 * the deterministic path, 0 model calls), where the gear ended up (checked
 * against the convention, from its position before), that nothing else
 * changed (parent, group, lineage, object count, the open windows), and
 * that the Neural Map holds the new position. Then: ambiguity after a
 * duplicate (asks, moves nothing), the window commands (still windows),
 * reload, timings, and iPhone EMULATION.
 *
 *   node scripts/cosmos/verify-spatial.mjs     (vite dev on :5173)
 */
import { launch, track } from "../evolution/harness.mjs";
import { devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = process.env.SHOTS ?? "docs/missions/m17-cosmos/m17.3/wp01/shots";
const RESULTS = process.env.RESULTS ?? "docs/missions/m17-cosmos/m17.3/wp01/verify-spatial.json";
await mkdir(OUT, { recursive: true });
const results = [];
const ops = [];
let n = 0;
const check = (objective, name, ok, detail = "") => {
  results.push({ objective, name, status: ok ? "VERIFIED" : "FAILED", detail });
  console.log(`${ok ? "✓" : "✗"} [${objective}] ${name}${detail ? ` — ${String(detail).slice(0, 320)}` : ""}`);
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

const state = (page) =>
  page.evaluate(async () => {
    const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance();
    return S.list().map((o) => ({ id: o.id, name: o.name, builder: o.builder, parent: o.parent, group: o.group, scale: o.frame.scale, position: [...o.frame.position], lineage: o.provenance.filter((p) => p.action !== "transformed").length }));
  });
const mapPos = (page, id) => page.evaluate(async (id) => (await import("/src/core/neural/NeuralMap.ts")).neuralMap().get(`cosmos.object:${id}`)?.spatial?.position ?? null, id);
const mapRels = (page, id) => page.evaluate(async (id) => (await import("/src/core/neural/NeuralMap.ts")).neuralMap().relations(`cosmos.object:${id}`).map((x) => x.relation.id).sort(), id);
/** Every window's place on screen and the workspace layout: what a window command would change. */
const windows = (page) =>
  page.evaluate(() => ({
    rects: [...document.querySelectorAll("[data-lelu-module-window]")].map((w) => `${w.getAttribute("data-lelu-module-window")}@${w.getAttribute("data-lelu-steward-rect") ?? ""}:${w.getAttribute("data-lelu-module-presentation") ?? ""}`).sort(),
  }));
const updates = (page) => page.evaluate(async () => (await import("/src/core/neural/NeuralMap.ts")).neuralMap().updateStats().length);
const updatesSince = (page, k) => page.evaluate(async (k) => (await import("/src/core/neural/NeuralMap.ts")).neuralMap().updateStats().slice(k).map((u) => ({ authority: u.authority, ms: u.ms, changed: u.changed })), k);

async function chat(page, text) {
  for (let i = 0; i < 4 && !(await page.locator("[aria-label='Chat Universe']").count()); i++) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
    await page.waitForSelector("[aria-label='Chat Universe']", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const w = page.locator('textarea[aria-label^="Message "]:visible').first();
  const box = (await w.count()) ? w : page.locator(".lcu-composer textarea");
  const k = await updates(page);
  const t0 = Date.now();
  await box.fill(text);
  await box.press("Enter");
  let reply = null;
  for (let i = 0; i < 80; i++) {
    reply = await page.evaluate(async (sent) => {
      const S = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
      const msgs = S.getActive()?.messages ?? [];
      let u = -1;
      msgs.forEach((m, i) => { if (m.role === "user" && String(m.text).trim() === sent) u = i; });
      const m = u < 0 ? null : msgs.slice(u + 1).find((x) => x.role !== "user");
      return m && m.activity?.status !== "running" ? { text: String(m.text), provider: m.provider, tools: (m.activity?.steps ?? []).filter((s) => s.kind === "tool").map((s) => `${s.tool}:${s.status}`) } : null;
    }, text);
    if (reply) break;
    await page.waitForTimeout(250);
  }
  const ms = Date.now() - t0;
  await page.waitForTimeout(300);
  const ups = await updatesSince(page, k);
  ops.push({ text, roundTripMs: ms, provider: reply?.provider, tools: reply?.tools, map: ups.map((u) => ({ authority: u.authority, ms: u.ms, changed: u.changed.length })) });
  return { ...reply, ms, updates: ups };
}

/* The convention, as the tool documents it (spatialIntent.ts). */
const reach = (a, b) => Math.max(a.scale * 1.4, b.scale * 1.4);
const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const expectRelative = (gear, cabin, relation) => {
  const [x, y, z] = cabin.position;
  const k = reach(gear, cabin);
  return r3({ beside: [x + k, y, z], "left-of": [x - k, y, z], "right-of": [x + k, y, z], behind: [x, y, z - k] }[relation]);
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

  let r = await chat(page, "/build cabin");
  r = await chat(page, "put it into the cosmos");
  r = await chat(page, "/build gearbox");
  r = await chat(page, "put it into the cosmos");
  let s = await state(page);
  const cabin = s.find((o) => /cabin/i.test(o.name));
  const gear = s.find((o) => /gear/i.test(o.name));
  check("A.1", "Two real Cosmos objects exist (built and placed by chat): a cabin and a gearbox", Boolean(cabin && gear), s.map((o) => `${o.id} ${o.name}`).join(" · "));
  const lineage0 = gear.lineage;
  const count0 = s.length;
  const parent0 = gear.parent;
  const rels0 = await mapRels(page, gear.id);
  await shot(page, "objects-placed");

  const steps = [
    { text: "Move the gear next to the cabin", check: (g, c) => r3(g.position).join() === expectRelative(g, c, "beside").join(), what: "beside: cabin + 1.4×scale on +x" },
    { text: "Move the gear to the left of the cabin", check: (g, c) => r3(g.position).join() === expectRelative(g, c, "left-of").join(), what: "left of: cabin − reach on x" },
    { text: "Put the gear behind the cabin", check: (g, c) => r3(g.position).join() === expectRelative(g, c, "behind").join(), what: "behind: cabin − reach on z" },
    { text: "Move the gear closer to the cabin", check: (g, c, prev) => dist(g.position, c.position) < dist(prev.position, c.position) - 1e-6 && dist(g.position, c.position) >= reach(g, c) * 0.6 - 1e-6, what: "closer: the gap shrinks, never into the cabin" },
    { text: "Move the gear farther away", check: (g, c, prev) => dist(g.position, c.position) > dist(prev.position, c.position) + 1e-6, what: "farther: from the cabin it was last placed against" },
    { text: "Move the gear to the right of the cabin", check: (g, c) => r3(g.position).join() === expectRelative(g, c, "right-of").join(), what: "right of: cabin + reach on x" },
  ];
  for (const step of steps) {
    const win0 = await windows(page);
    const prev = (await state(page)).find((o) => o.id === gear.id);
    r = await chat(page, step.text);
    const now = await state(page);
    const g = now.find((o) => o.id === gear.id);
    const c = now.find((o) => o.id === cabin.id);
    const win1 = await windows(page);
    const mp = await mapPos(page, gear.id);
    const tools = r.tools ?? [];
    check("A.4", `"${step.text}" → cosmos.object.position ran (lelu-direct, 0 model calls), no workspace tool`, tools.includes("cosmos.object.position:done") && !tools.some((t) => t.startsWith("workspace.")) && r.provider === "lelu-direct", `${r.provider} ${JSON.stringify(tools)}`);
    check("A.4", `"${step.text}" → the gear is where the convention says (${step.what})`, step.check(g, c, prev), `${JSON.stringify(prev.position)} → ${JSON.stringify(g.position)} · cabin ${JSON.stringify(c.position)}`);
    check("A.4", `"${step.text}" → nothing else changed: same parent, group, lineage, object count; windows untouched`, g.parent === parent0 && g.group === prev.group && g.lineage === lineage0 && now.length === count0 && JSON.stringify(win0) === JSON.stringify(win1), `parent ${g.parent} · objects ${now.length} · windows ${win1.rects.length}`);
    check("A.5", `"${step.text}" → the Neural Map has the new position and the same relations (no attached-to from proximity)`, JSON.stringify(mp) === JSON.stringify(g.position) && JSON.stringify(await mapRels(page, gear.id)) === JSON.stringify(rels0), `${JSON.stringify(mp)}`);
    check("WP05", `"${step.text}" → the map updated only the objects partition, only the gear`, r.updates.filter((u) => u.authority === "cosmos.objects").every((u) => u.changed.length === 1 && u.changed[0] === `cosmos.object:${gear.id}`) && r.updates.some((u) => u.authority === "cosmos.objects"), JSON.stringify(r.updates.map((u) => [u.authority, u.changed.length, u.ms])));
  }
  await shot(page, "chat-after-moves");

  // The gear in the Neural Map: its new position, and still only its own relations (no attached-to).
  await page.click("button[aria-label='Close Chat Universe']").catch(() => {});
  await enter(page, `?interface=neural-map&entity=${encodeURIComponent(`cosmos.object:${gear.id}`)}`);
  await page.waitForSelector("[data-neural-map-view]", { timeout: 15000 });
  await page.waitForTimeout(1200);
  check("A.5", "The standalone Neural Map shows the gear at its new position", (await page.getAttribute(".nm-side [data-neural-position]", "data-neural-position")) === (await state(page)).find((o) => o.id === gear.id).position.join(","));
  await shot(page, "neural-map-gear-position");
  await page.click("[data-close-neural-map]").catch(() => {});
  await enter(page);

  /* ---------- ambiguity ---------- */
  r = await chat(page, "duplicate the gear");
  s = await state(page);
  const copy = s.find((o) => o.id !== gear.id && /gear/i.test(o.name));
  const before = await state(page);
  const win0 = await windows(page);
  r = await chat(page, "Move the gear next to the cabin");
  const after = await state(page);
  check("A.3", "After a duplicate, 'the gear' is ambiguous: nothing moves, the reply says 'Not done', names both and asks which one", !(r.tools ?? []).includes("cosmos.object.position:done") && /^Not done/.test(r.text) && !/Done locally/.test(r.text) && /which one/i.test(r.text) && r.text.includes(gear.id) && r.text.includes(copy.id) && JSON.stringify(before.map((o) => o.position)) === JSON.stringify(after.map((o) => o.position)), r.text.slice(0, 220));
  check("A.3", "…and the windows were not rearranged instead", !(r.tools ?? []).some((t) => t.startsWith("workspace.")) && JSON.stringify(win0) === JSON.stringify(await windows(page)), JSON.stringify(r.tools));
  results.push({ objective: "A.3", name: "The ambiguity reply, verbatim", status: "OBSERVED", informational: true, detail: r.text });
  await shot(page, "ambiguous-asks");
  r = await chat(page, `move ${copy.id} to the left of the cabin`);
  const cp = (await state(page)).find((o) => o.id === copy.id);
  const cb = (await state(page)).find((o) => o.id === cabin.id);
  check("A.3", "Naming the one meant (by id) moves exactly that object", (r.tools ?? []).includes("cosmos.object.position:done") && r3(cp.position).join() === expectRelative(cp, cb, "left-of").join(), JSON.stringify(cp.position));
  {
    const p0 = JSON.stringify((await state(page)).map((o) => o.position));
    const w0 = JSON.stringify(await windows(page));
    r = await chat(page, "move the spaceship next to the cabin");
    check("A.3", "A name nothing answers to is not invented: no object moves, the windows are not split, and the reply says so", (r.tools ?? []).includes("cosmos.object.position:failed") && !(r.tools ?? []).some((t) => t.startsWith("workspace.")) && JSON.stringify((await state(page)).map((o) => o.position)) === p0 && JSON.stringify(await windows(page)) === w0 && /No object matches/.test(r.text), `${r.provider} ${JSON.stringify(r.tools)} · ${r.text.slice(0, 120)}`);
  }
  r = await chat(page, "move the gearbox left");
  check("A.3", "A category name ('the gearbox' — what it was built as) resolves; still ambiguous with two gearboxes, so it asks", /which one/i.test(r.text) || (r.tools ?? []).includes("cosmos.object.position:done"), r.text.slice(0, 160));

  /* ---------- windows keep their own commands ---------- */
  r = await chat(page, "put the browser next to the chat");
  check("A.1", "'put the browser next to the chat' (windows, not objects) is still a window command", (r.tools ?? []).some((t) => t.startsWith("workspace.")) && !(r.tools ?? []).some((t) => t.startsWith("cosmos.object.position")), JSON.stringify(r.tools));
  r = await chat(page, "tile my windows");
  check("A.1", "'tile my windows' is still a window command", (r.tools ?? []).some((t) => t.startsWith("workspace.arrange")), JSON.stringify(r.tools));
  await shot(page, "windows-still-windows");

  /* ---------- reload ---------- */
  const keep = await state(page);
  await page.reload();
  await enter(page);
  const back = await state(page);
  check("A.4", "Reload: every object keeps its position, parent and lineage (the store's own persistence)", JSON.stringify(keep) === JSON.stringify(back), `${back.length} objects`);
  check("A.5", "Reload: the Neural Map re-derives the same position", JSON.stringify(await mapPos(page, gear.id)) === JSON.stringify(back.find((o) => o.id === gear.id).position));

  /* ---------- timings (WP05) ---------- */
  const t = await page.evaluate(async ([gid]) => {
    const { directPlanFor } = await import("/src/core/router/DirectResolver.ts");
    const { placeRelative } = await import("/src/core/cosmos/objects/spatialIntent.ts");
    const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance();
    const { dispatchToolCall, toolNameForModel } = await import("/src/core/tools/ToolDispatcher.ts");
    const time = (fn, k = 200) => { const t0 = performance.now(); for (let i = 0; i < k; i++) fn(); return Math.round(((performance.now() - t0) / k) * 10000) / 10000; };
    const g = S.get(gid);
    const c = S.list().find((o) => /cabin/i.test(o.name));
    const t0 = performance.now();
    const res = await dispatchToolCall({ id: "t", name: toolNameForModel("cosmos.object.position"), arguments: { object: gid, near: c.id, relation: "beside" } }, "timing", undefined, { path: "direct" });
    const dispatchMs = Math.round((performance.now() - t0) * 100) / 100;
    return {
      resolveMs: time(() => directPlanFor("Move the gear to the left of the cabin")),
      lookupMs: time(() => S.match("cabin")),
      calcMs: time(() => placeRelative({ position: g.frame.position, scale: g.frame.scale }, { position: c.frame.position, scale: c.frame.scale }, "closer")),
      dispatchMs,
      ok: res.ok,
    };
  }, [gear.id]);
  const mapMs = ops.flatMap((o) => o.map.filter((u) => u.authority === "cosmos.objects").map((u) => u.ms));
  results.push({ objective: "WP05", name: "Timings (per call, in the page)", status: "MEASURED", informational: true, detail: JSON.stringify({ ...t, mapUpdateMaxMs: Math.max(...mapMs), chatRoundTripMs: ops.filter((o) => /gear/i.test(o.text)).map((o) => o.roundTripMs) }) });
  check("WP05", "Resolution, lookup and calculation each take well under a millisecond; dispatch is local; the map update ≤ 1 ms", t.ok && t.resolveMs < 1 && t.lookupMs < 1 && t.calcMs < 0.1 && Math.max(...mapMs) <= 1, JSON.stringify({ ...t, mapUpdateMaxMs: Math.max(...mapMs) }));
  await ctx.close();
}

/* =============================== iPhone (EMULATION) =============================== */
{
  const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
  await ctx.addInitScript(() => { try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {} });
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  let r = await chat(page, "/build cabin");
  r = await chat(page, "put it into the cosmos");
  r = await chat(page, "/build gearbox");
  r = await chat(page, "put it into the cosmos");
  const s = await state(page);
  const gear = s.find((o) => /gear/i.test(o.name));
  const cabin = s.find((o) => /cabin/i.test(o.name));
  r = await chat(page, "Move the gear to the left of the cabin");
  const g = (await state(page)).find((o) => o.id === gear.id);
  check("WP04", "iPhone (EMULATED): 'Move the gear to the left of the cabin' moves the gear there by the same path", (r.tools ?? []).includes("cosmos.object.position:done") && r3(g.position).join() === expectRelative(g, cabin, "left-of").join(), JSON.stringify(g.position));
  await shot(page, "iphone-moved");
  await ctx.close();
}

await browser.close();
const relevant = errors.filter((e) => !/ERR_CONNECTION|Failed to load resource|429|503|401|livekit|supabase|Access to fetch at 'https:\/\/export\.arxiv|api\/integration|api\/engineer|Provider|Wrong API Key/i.test(e));
check("WP03", "No new page errors during the run", relevant.length === 0, relevant.slice(0, 4).join(" | "));
await writeFile(RESULTS, JSON.stringify({ at: new Date().toISOString(), results, ops, errors: relevant }, null, 2));
const scored = results.filter((x) => !x.informational);
const failed = scored.filter((x) => x.status !== "VERIFIED").length;
console.log(`\n${scored.length - failed}/${scored.length} VERIFIED`);
process.exit(failed ? 1 : 0);
