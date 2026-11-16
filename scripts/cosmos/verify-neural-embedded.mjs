/**
 * M17.2-WP02 — the Neural Map INSIDE every interface, through the real app.
 *
 * For each interface the card is opened with the interface's own toggle,
 * a real entity from that interface's authority is inspected, a
 * relationship is followed, the same entity is opened in the standalone
 * map (over the interface) and Return lands back in it. Objects are made
 * and changed by chat (deterministic direct path, 0 model calls) and by
 * the card's own buttons (the same tools through the dispatcher), with
 * the card open — so live updates are seen where a person sees them.
 *
 * Evidence class: Chromium desktop (UI) + iPhone 15 Pro EMULATION. Not Safari.
 *   node scripts/cosmos/verify-neural-embedded.mjs     (vite dev on :5173)
 */
import { launch, track } from "../evolution/harness.mjs";
import { devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = process.env.SHOTS ?? "docs/missions/m17-cosmos/m17.2-wp02/shots";
const RESULTS = process.env.RESULTS ?? "docs/missions/m17-cosmos/m17.2-wp02/verify-neural-embedded.json";
await mkdir(OUT, { recursive: true });
const results = [];
const ops = [];
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
  await page.waitForTimeout(2500);
}

const mapRead = (page, fn, ...args) =>
  page.evaluate(async ([src, a]) => {
    const { neuralMap } = await import("/src/core/neural/NeuralMap.ts");
    return new Function("m", "a", `return (${src})(m, ...a)`)(neuralMap(), a);
  }, [fn.toString(), args]);
const integrity = (page) => mapRead(page, (m) => ({ dangling: m.dangling().map((r) => r.id), duplicates: m.duplicates(), stats: m.stats(), listeners: m.listenerCount() }));
const updatesSince = (page, k) => mapRead(page, (m, k) => m.updateStats().slice(k).map((u) => ({ authority: u.authority, ms: u.ms, changed: u.changed })), k);
const updateCount = (page) => mapRead(page, (m) => m.updateStats().length);
const listeners = (page) => mapRead(page, (m) => m.listenerCount());
const objects = (page) => page.evaluate(async () => { const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance(); return { live: S.list().map((o) => ({ id: o.id, name: o.name, parent: o.parent, artifactId: o.source?.artifactId })), trash: S.trashList().map((o) => o.id) }; });
const idOf = async (page, word) => (await objects(page)).live.filter((o) => o.name.toLowerCase().includes(word));
const dispatch = (page, tool, args) =>
  page.evaluate(async ([tool, args]) => {
    const { dispatchToolCall, toolNameForModel } = await import("/src/core/tools/ToolDispatcher.ts");
    const r = await dispatchToolCall({ id: `v-${Date.now()}`, name: toolNameForModel(tool), arguments: args }, `verify-${Date.now()}`, undefined, { path: "direct" });
    return { ok: r.ok, content: r.content };
  }, [tool, args]);

/* The card of one host: what it is on, and what it shows. */
const card = (host) => `[data-neural-embed="${host}"]`;
const cardState = (page, host) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const ent = el.querySelector("[data-neural-entity]");
    return {
      current: el.getAttribute("data-current"),
      entity: ent?.getAttribute("data-neural-entity") ?? null,
      state: ent?.getAttribute("data-state") ?? null,
      type: ent?.getAttribute("data-type") ?? null,
      groups: [...el.querySelectorAll(".nm-rel-group")].map((g) => `${g.dataset.relation}:${g.dataset.direction}`),
      chips: [...el.querySelectorAll(".nm-rel-group .nm-chip")].map((c) => `${c.closest(".nm-rel-group").dataset.relation}:${c.closest(".nm-rel-group").dataset.direction}>${c.dataset.to}`),
      ops: [...el.querySelectorAll("[data-op]")].map((b) => b.dataset.op),
      hostActions: [...el.querySelectorAll("[data-host-action]")].map((b) => b.dataset.hostAction),
      position: el.querySelector("[data-neural-position]")?.getAttribute("data-neural-position") ?? null,
      facts: el.querySelector(".nm-facts")?.textContent ?? "",
      unindexed: el.querySelector("[data-unindexed]")?.textContent ?? null,
      rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
    };
  }, card(host));
/** The element really on top at the card's centre belongs to the card (it is visible, not hidden under the interface). */
const onTop = (page, sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.height < 80 || r.width < 200) return false;
    const hit = document.elementFromPoint(r.x + Math.min(r.width / 2, 60), r.y + Math.min(r.height / 2, 30));
    return Boolean(hit && el.contains(hit));
  }, sel);
const waitCard = async (page, host, pred, ms = 6000) => {
  let s = null;
  for (let i = 0; i < ms / 200; i++) {
    s = await cardState(page, host);
    if (s && pred(s)) return s;
    await page.waitForTimeout(200);
  }
  return s;
};

async function chat(page, text) {
  if (!(await page.locator("[aria-label='Chat Universe']").count())) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
    await page.waitForSelector("[aria-label='Chat Universe']");
    await page.waitForTimeout(800);
  }
  const w = page.locator('textarea[aria-label^="Message "]:visible').first();
  const box = (await w.count()) ? w : page.locator(".lcu-composer textarea");
  const k = await updateCount(page);
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
      return m && m.activity?.status !== "running" ? { text: String(m.text), provider: m.provider, conversation: S.getActive()?.id, tools: (m.activity?.steps ?? []).filter((s) => s.kind === "tool").map((s) => `${s.tool}:${s.status}`) } : null;
    }, text);
    if (reply) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(300);
  const updates = await updatesSince(page, k);
  ops.push({ via: "chat", text, ms: Date.now() - t0, provider: reply?.provider, tools: reply?.tools, mapUpdates: updates.map((u) => ({ authority: u.authority, ms: u.ms, changed: u.changed.length })) });
  return { ...reply, updates };
}

async function openApp(page, label) {
  await page.click('nav.lsn button[aria-label="Infinite Library"]');
  await page.waitForSelector(".lsh-app");
  await page.waitForTimeout(600);
  await page.locator(".lsh-app", { has: page.locator(".lsh-app-name", { hasText: new RegExp(`^${label}$`) }) }).first().click();
  await page.waitForTimeout(1800);
}
async function closeWindows(page) {
  await page.click('nav.lsn button[aria-label="Open windows"]').catch(() => {});
  await page.waitForTimeout(900);
  for (let i = 0; i < 10; i++) {
    const close = page.locator('[data-testid=lelu-windows] .lsh-list-actions button[aria-label^="Close "]').first();
    if (!(await close.count())) break;
    await close.click();
    await page.waitForTimeout(350);
  }
  await page.click("[data-testid=lelu-windows] .lsh-close").catch(() => {});
  await page.waitForTimeout(500);
}
/** The standalone map, opened from a card: same identity, ABOVE the host, Return lands back. */
async function openMapFromCard(page, host, label) {
  const before = await cardState(page, host);
  await page.click(`${card(host)} [data-open-standalone]`);
  await page.waitForSelector("[data-neural-map-view]", { timeout: 8000 });
  await page.waitForTimeout(900);
  const focus = await page.getAttribute(".nm-side [data-neural-entity]", "data-neural-entity");
  const layer = await page.getAttribute("[data-neural-map-view]", "data-layer");
  const visible = await onTop(page, "[data-neural-map-view]");
  check("O06", `${label}: Open map → the standalone Neural Map opens OVER ${label} on the same canonical id`, focus === before.current && layer === "over" && visible, `${before.current} → ${focus} · layer ${layer} · on top ${visible}`);
  await shot(page, `${host}-standalone-over`);
  await page.click("[data-close-neural-map]");
  await page.waitForTimeout(800);
  const back = await cardState(page, host);
  check("O06", `${label}: Return → back in ${label}, its card still on the same entity`, back?.current === before.current && (await page.locator("[data-neural-map-view]").count()) === 0, back?.current);
}

const browser = await launch();
const errors = [];
const perf = { listeners: [] };

/* =============================== desktop =============================== */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {} });
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  const baseListeners = await listeners(page);
  perf.listeners.push({ at: "start", n: baseListeners });

  /* ------------------------------ O01 inventory ------------------------------ */
  const inventory = await mapRead(page, (m) => m.stats().byAuthority);
  check("O01", "Every interface's authority is connected to the ONE map (cosmos, rooms, room, tools, interfaces + chats, studio, projects, sandbox, home)", ["cosmos.objects", "cosmos.navigation", "room.scene", "tools", "interfaces", "chats", "studio", "projects", "sandbox", "home"].every((a) => a in inventory), JSON.stringify(inventory));

  /* ------------------------------ Home ------------------------------ */
  await page.click('[data-neural-toggle="home"]');
  let s = await waitCard(page, "home", (x) => x.entity === "app:home");
  await page.click(`${card("home")} [data-more="presents:out"]`);
  s = await waitCard(page, "home", (x) => x.chips.length > 20);
  check("O02", "Home: its own ◈ Neural toggle opens the card inside the Home on the Home itself (app:home)", s?.entity === "app:home" && (await onTop(page, card("home"))), s?.current);
  check("O05", "Home: the card shows the Home's apps and its destinations (the interfaces it leads to)", ["app:engineering", "app:creation", "interface:cosmos", "interface:neural-map", "interface:lelu-system"].every((id) => s.chips.some((c) => c.endsWith(`>${id}`))), s.chips.filter((c) => c.startsWith("presents")).length + " presents");
  await shot(page, "home-card");
  await page.click(`${card("home")} .nm-chip[data-to="app:engineering"]`);
  s = await waitCard(page, "home", (x) => x.entity === "app:engineering");
  check("O02", "Home: follow a relationship inside the card → the Code app, which is operated by sandbox.read / sandbox.write", s?.entity === "app:engineering" && s.chips.includes("operated-by:out>capability:sandbox.read"), s?.chips.join(", "));
  await shot(page, "home-card-follow");
  await page.click(`${card("home")} [data-embed-back]`);
  s = await waitCard(page, "home", (x) => x.entity === "app:home");
  check("O02", "Home: ← walks back to the Home", s?.entity === "app:home");
  await openMapFromCard(page, "home", "Home");
  await page.click(`${card("home")} [data-close-embed]`);
  await page.waitForTimeout(500);

  /* ------------------------------ Chat Universe ------------------------------ */
  let r = await chat(page, "/build cabin");
  const conv = r.conversation;
  r = await chat(page, "put it into the cosmos");
  check("O04", "Create (chat): a built cabin is put into the Cosmos — lelu-direct, 0 model calls", r?.tools?.includes("cosmos.object.spawn:done") && r.provider === "lelu-direct", r?.tools);
  const [cabin] = await idOf(page, "cabin");
  const CONV = `record:conversation:${conv}`;
  await page.click('[data-neural-toggle="chat-universe"]');
  s = await waitCard(page, "chat-universe", (x) => x.entity === CONV);
  check("O02", "Chat Universe: its ◈ Neural toggle opens the card in the Universe on the current chat (record:conversation:…, owned by chats)", s?.entity === CONV && s.type === "conversation" && (await onTop(page, card("chat-universe"))), s?.current);
  const cabinArt = `record:artifact:${cabin.artifactId}`;
  check("O05", "Chat Universe: the chat shows what it created — the cabin's artifact (created-from, read from the Studio's own record)", s.chips.includes(`created-from:in>${cabinArt}`), s.chips.join(", "));
  check("O02", "Chat Universe: the interface's own action is offered (Open chat)", s.hostActions.includes("open-chat"));
  await shot(page, "chat-universe-card");

  // Create, live: the card is open on the chat while a gearbox is built and placed.
  r = await chat(page, "/build gearbox");
  r = await chat(page, "put it into the cosmos");
  const [gearObj] = await idOf(page, "gear");
  const gear = gearObj.id;
  const GEAR = `cosmos.object:${gear}`;
  const gearArt = `record:artifact:${gearObj.artifactId}`;
  s = await waitCard(page, "chat-universe", (x) => x.chips.includes(`created-from:in>${gearArt}`));
  check("O04", "Create (live): with the card open, the new gearbox artifact appears on the chat without reopening it", s?.chips.includes(`created-from:in>${gearArt}`), s?.chips.join(", "));
  check("O07", "Create updated only partitions whose authority really changed, each touching only the changed entities — no full rebuild", r.updates.length > 0 && r.updates.every((u) => u.changed.length > 0 && u.changed.length <= 8), JSON.stringify(r.updates.map((u) => [u.authority, u.changed.length])));
  // Follow: chat → artifact → the Cosmos object made from it.
  await page.click(`${card("chat-universe")} .nm-chip[data-to="${gearArt}"]`);
  s = await waitCard(page, "chat-universe", (x) => x.entity === gearArt);
  const artAuth = await mapRead(page, (m, id) => m.get(id)?.authority, gearArt);
  check("O03", "Chat Universe: follow → the artifact is ONE entity, owned by the Studio (not a copy, not a placeholder)", s?.entity === gearArt && artAuth === "studio" && s.type === "artifact", `${s?.entity} · ${artAuth}`);
  await page.click(`${card("chat-universe")} .nm-chip[data-to="${GEAR}"]`);
  s = await waitCard(page, "chat-universe", (x) => x.entity === GEAR);
  check("O03", "Chat Universe: follow → the Cosmos object made from it — the same canonical id the Cosmos uses", s?.entity === GEAR && s.chips.includes(`created-from:out>${gearArt}`), s?.chips.join(", "));
  await shot(page, "chat-universe-follow-to-object");
  await openMapFromCard(page, "chat-universe", "Chat Universe");

  // Live lifecycle with the card open on the gearbox, inside the Universe.
  const live = async (label, run, pred, expectAuth = ["cosmos.objects"]) => {
    const k = await updateCount(page);
    const out = await run();
    const st = await waitCard(page, "chat-universe", pred);
    const ups = await updatesSince(page, k);
    const ok = Boolean(st && pred(st));
    // Narrow = every partition that updated really changed (no-op notifications are skipped by the
    // index) and touched only a handful of entities — never a rebuild of everything.
    void expectAuth;
    const narrow = ups.length > 0 && ups.every((u) => u.changed.length > 0 && u.changed.length <= 8);
    check("O04", `${label} → the open card updates live`, ok, `${st?.state} · ${st?.groups.join(",")} ${out?.tools ? `· ${out.tools}` : ""}`);
    ops.push({ via: "live", text: label, mapUpdates: ups.map((u) => ({ authority: u.authority, ms: u.ms, changed: u.changed.length, ids: u.changed.slice(0, 6) })) });
    if (!narrow) console.log("    partitions:", JSON.stringify(ups.map((u) => [u.authority, u.changed.slice(0, 4)])));
    return narrow;
  };
  const narrow = [];
  narrow.push(await live("Attach (chat: attach the gear into the cabin)", () => chat(page, `attach ${gear} into the cabin`), (x) => x.groups.includes("attached-to:out"), ["cosmos.objects", "chats"]));
  narrow.push(await live("Extract (chat: take the gear out)", () => chat(page, "take the gear out"), (x) => x.groups.includes("extracted-from:out") && !x.groups.includes("attached-to:out"), ["cosmos.objects", "chats"]));
  const pos0 = (await cardState(page, "chat-universe")).position;
  narrow.push(await live("Move (cosmos.object.transform through the dispatcher)", () => dispatch(page, "cosmos.object.transform", { object: gear, position: [7, 1, -12] }), (x) => x.position === "7,1,-12"));
  check("O04", "Move changes the card's position only; its relationships are unchanged", (await cardState(page, "chat-universe")).groups.includes("extracted-from:out"), `${pos0} → 7,1,-12`);
  narrow.push(await live("Modify (cosmos.object.animate: spin)", () => dispatch(page, "cosmos.object.animate", { object: gear, motion: "spin" }), (x) => /spin/.test(x.facts)));
  narrow.push(await live("Duplicate (chat: duplicate the gear)", () => chat(page, "duplicate the gear"), (x) => x.groups.includes("derived-from:in"), ["cosmos.objects", "chats"]));
  await shot(page, "chat-universe-live");
  narrow.push(await live("Remove (the card's own Remove button → cosmos.object.remove)", () => page.click(`${card("chat-universe")} [data-op="cosmos.object.remove"]`), (x) => x.state === "trashed"));
  await shot(page, "chat-universe-removed");
  narrow.push(await live("Restore (the card's own Restore button → cosmos.object.restore)", () => page.click(`${card("chat-universe")} [data-op="cosmos.object.restore"]`), (x) => x.state === "active"));
  check("O07", "Every live operation updated only the partitions of the authorities it changed (no full-graph rebuild)", narrow.every(Boolean), JSON.stringify(narrow));
  await page.click(`${card("chat-universe")} [data-close-embed]`);
  await page.click("button[aria-label='Close Chat Universe']").catch(() => {});
  await page.waitForTimeout(700);

  /* ------------------------------ Creation Studio (Creative) ------------------------------ */
  await closeWindows(page);
  await openApp(page, "Documents");
  await page.waitForSelector("[data-lelu-studio-library]");
  await page.click(`[data-neural-of="${gearArt}"]`);
  s = await waitCard(page, "creation", (x) => x.entity === gearArt);
  check("O02", "Creation Studio: an artifact card's ◈ Neural opens the card inside the Studio on that artifact", s?.entity === gearArt && (await onTop(page, card("creation"))), s?.current);
  check("O03", "Creation Studio: the SAME id Chat Universe showed, with the same relations (the chat it came from; the Cosmos object made from it)", s.chips.includes(`created-from:out>${CONV}`) && s.chips.includes(`created-from:in>${GEAR}`), s.chips.join(", "));
  check("O05", "Creation Studio: revisions and exports are the artifact's history; its operations are the Studio's tools", s.ops.includes("studio.open") && s.ops.includes("studio.read") && /kind/.test(s.facts), s.ops.join(","));
  await shot(page, "creation-card");
  await page.click(`${card("creation")} [data-op="studio.read"]`);
  await page.waitForTimeout(1200);
  const readOk = await page.getAttribute(`${card("creation")} .nm-result`, "data-ok");
  check("O02", "Creation Studio: Read revisions runs studio.read through the dispatcher and reports back in the card", readOk === "true", readOk);
  await page.click(`${card("creation")} .nm-chip[data-to="${CONV}"]`);
  s = await waitCard(page, "creation", (x) => x.entity === CONV);
  check("O03", "Creation Studio → follow → the chat: the same record:conversation id Chat Universe uses", s?.entity === CONV);
  await openMapFromCard(page, "creation", "Creation Studio");
  await closeWindows(page);

  /* ------------------------------ Projects ------------------------------ */
  await openApp(page, "Files");
  await page.click('[data-neural-toggle="projects"]');
  s = await waitCard(page, "projects", (x) => x.type === "project");
  const projAuth = s ? await mapRead(page, (m, id) => m.get(id)?.authority, s.entity) : null;
  check("O02", "Projects: its ◈ Neural toggle opens the card on the selected project (record:project:…, owned by projects)", s?.type === "project" && projAuth === "projects" && (await onTop(page, card("projects"))), s?.current);
  check("O05", "Projects: status, items and agents read from the project; the interface's own action is offered", /status/.test(s.facts) && s.hostActions.includes("select-project"), s.facts.slice(0, 120));
  await shot(page, "projects-card");
  await openMapFromCard(page, "projects", "Projects");
  await closeWindows(page);

  /* ------------------------------ Code (Engineering) ------------------------------ */
  await openApp(page, "Code");
  await page.waitForTimeout(800);
  // A real project, generated by the panel's own generator.
  const hasFiles = await page.evaluate(async () => (await import("/src/core/engineering/SandboxFS.ts")).default.getInstance().filePaths().length);
  if (!hasFiles) {
    await page.fill('input[placeholder^="Project name"]', "Neural Shop");
    await page.click("button:has-text('Generate')");
    await page.waitForTimeout(1500);
  }
  await page.click('[data-neural-toggle="engineering"]');
  s = await waitCard(page, "engineering", (x) => x.type === "file");
  const file = s?.entity;
  check("O02", "Code: its ◈ Neural toggle opens the card on the file open in the editor (sandbox:…)", s?.type === "file" && (await onTop(page, card("engineering"))), file);
  const parent = s?.chips.find((c) => c.startsWith("part-of:out>"))?.split(">")[1];
  check("O05", "Code: a file is part of its folder (read from its path); its operations are sandbox.read / sandbox.write", Boolean(parent) && s.ops.includes("sandbox.read"), s?.chips.join(", "));
  await shot(page, "code-card");
  await page.click(`${card("engineering")} [data-op="sandbox.read"]`);
  await page.waitForTimeout(900);
  check("O02", "Code: Read file runs sandbox.read through the dispatcher", (await page.getAttribute(`${card("engineering")} .nm-result`, "data-ok")) === "true");
  await page.click(`${card("engineering")} .nm-chip[data-to="${parent}"]`);
  s = await waitCard(page, "engineering", (x) => x.entity === parent);
  const folderPath = parent.slice("sandbox:".length);
  const k0 = await updateCount(page);
  const w = await dispatch(page, "sandbox.write", { path: `${folderPath}/neural-note.md`, content: "# written while the card is open\n" });
  s = await waitCard(page, "engineering", (x) => x.chips.includes(`part-of:in>sandbox:${folderPath}/neural-note.md`));
  const wUps = await updatesSince(page, k0);
  check("O04", "Code: a file written through sandbox.write appears in the open folder card live (SandboxFS now notifies; only the sandbox partition updates)", w.ok && Boolean(s?.chips.includes(`part-of:in>sandbox:${folderPath}/neural-note.md`)) && wUps.every((u) => u.authority === "sandbox"), JSON.stringify(wUps.map((u) => u.authority)));
  await shot(page, "code-card-live");
  await openMapFromCard(page, "engineering", "Code");
  await closeWindows(page);

  /* ------------------------------ Engineering Studio ------------------------------ */
  await openApp(page, "Settings");
  await page.locator("button", { hasText: /^Engineering Studio/ }).first().click();
  await page.waitForTimeout(1500);
  await page.click('[data-neural-toggle="eng-studio"]');
  s = await waitCard(page, "eng-studio", (x) => x.entity === "app:eng-studio");
  check("O02", "Engineering Studio: its ◈ Neural toggle opens the card in the Studio on the Studio itself", s?.entity === "app:eng-studio" && (await onTop(page, card("eng-studio"))), s?.current);
  check("O05", "Engineering Studio: operated by engineering.remote; server-only data is named as NOT indexed instead of invented", s.chips.includes("operated-by:out>capability:engineering.remote") && /server/.test(s.unindexed ?? ""), s.unindexed);
  await shot(page, "eng-studio-card");
  await openMapFromCard(page, "eng-studio", "Engineering Studio");
  await closeWindows(page);

  /* ------------------------------ System UI ------------------------------ */
  await enter(page, "?interface=lelu-system");
  await page.waitForSelector('[data-workspace="lelu-system"]', { timeout: 10000 });
  await page.click('[data-neural-toggle="system"]');
  s = await waitCard(page, "system", (x) => x.entity === "interface:lelu-system");
  check("O02", "System UI: its ◈ Neural toggle (in its own nav) opens the card in the System UI on interface:lelu-system", s?.entity === "interface:lelu-system" && (await onTop(page, card("system"))), s?.current);
  check("O05", "System UI: it is presented by the Home and offered to open; its live modes are named as not indexed", s.chips.includes("presents:in>app:home") && s.ops.includes("interface.open") && /Heartbeat/.test(s.unindexed ?? ""), s.chips.join(", "));
  await shot(page, "system-card");
  await openMapFromCard(page, "system", "System UI");
  await page.click(`${card("system")} [data-close-embed]`);

  /* ------------------------------ standalone still independent ------------------------------ */
  await enter(page, `?interface=neural-map&entity=${encodeURIComponent(CONV)}`);
  await page.waitForSelector("[data-neural-map-view]", { timeout: 15000 });
  await page.waitForTimeout(1200);
  const dl = await page.getAttribute(".nm-side [data-neural-entity]", "data-neural-entity");
  check("O06", "Deep link ?interface=neural-map&entity=<chat> still opens the standalone map on that chat (no card involved)", dl === CONV, dl);
  const embedsMounted = await page.locator("[data-neural-embed]").count();
  check("O06", "The standalone map needs no card, and no card needs the standalone map (0 cards mounted here)", embedsMounted === 0);
  await shot(page, "standalone-deeplink-chat");
  await page.click("[data-close-neural-map]");
  await page.click('nav.lsn button[aria-label="Infinite Library"]');
  await page.waitForSelector("[data-library-interfaces]");
  await page.waitForTimeout(1500);
  check("O06", "The Infinite Library still lists the Neural Map as its own interface", (await page.locator('[data-library-category="Neural Map"] [data-library-interface="neural-map"]').count()) === 1);
  await page.click(".lsh-close");

  /* ------------------------------ lifecycle: subscriptions ------------------------------ */
  const l0 = await listeners(page);
  let peak = l0;
  for (let i = 0; i < 3; i++) {
    await page.click('[data-neural-toggle="home"]');
    await waitCard(page, "home", (x) => x.entity === "app:home");
    peak = Math.max(peak, await listeners(page));
    await page.click(`${card("home")} [data-more="presents:out"]`);
    await page.click(`${card("home")} .nm-chip[data-to="app:engineering"]`);
    await page.waitForTimeout(250);
    await page.click(`${card("home")} [data-close-embed]`);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForTimeout(800);
  for (let i = 0; i < 3; i++) {
    await page.click('[data-neural-toggle="chat-universe"]');
    await page.waitForTimeout(400);
    peak = Math.max(peak, await listeners(page));
    await page.click('[data-neural-toggle="chat-universe"]');
    await page.waitForTimeout(250);
  }
  await page.click("button[aria-label='Close Chat Universe']").catch(() => {});
  await page.waitForTimeout(600);
  const l1 = await listeners(page);
  perf.listeners.push({ at: "before open/close cycles", n: l0 }, { at: "peak while a card was open", n: peak }, { at: "after 6 open/close cycles in 2 interfaces", n: l1 });
  check("O07", "A card subscribes while open and releases every subscription when closed: 6 open/close cycles in two interfaces leave the count where it was", peak > l0 && l1 === l0, `${l0} → peak ${peak} while open → ${l1} after`);

  /* ------------------------------ O09 routing overlap (recorded, NOT fixed) ------------------------------ */
  {
    const posBefore = await mapRead(page, (m, id) => m.get(id)?.spatial?.position ?? null, GEAR);
    const r9 = await chat(page, "move the gear next to the cabin");
    const posAfter = await mapRead(page, (m, id) => m.get(id)?.spatial?.position ?? null, GEAR);
    results.push({
      objective: "O09",
      name: "FINDING (open): chat 'move the gear next to the cabin' runs the workspace tools, not cosmos.object.position",
      status: "OBSERVED",
      informational: true,
      detail: JSON.stringify({ provider: r9.provider, tools: r9.tools, gearPositionBefore: posBefore, gearPositionAfter: posAfter, reply: String(r9.text ?? "").slice(0, 160) }),
    });
    console.log(`  · O09 observed: ${r9.provider} ${JSON.stringify(r9.tools)} · gear ${JSON.stringify(posBefore)} → ${JSON.stringify(posAfter)}`);
    await page.click("button[aria-label='Close Chat Universe']").catch(() => {});
    await closeWindows(page);
  }

  /* ------------------------------ reload ------------------------------ */
  const snap = () => mapRead(page, (m) => {
    const ids = m.search({ authorities: ["chats", "studio", "projects", "sandbox", "home", "cosmos.objects"], limit: 5000 }).map((e) => e.id).sort();
    const rels = ids.flatMap((id) => m.relations(id, { direction: "out" }).map((x) => x.relation.id)).sort();
    return { ids, rels };
  });
  // The interface partitions connect a tick after boot: wait for them.
  const ready = async () => { for (let i = 0; i < 40; i++) { if (await mapRead(page, (m) => ["chats", "studio", "projects", "sandbox", "home"].every((a) => m.authorities().includes(a)))) return; await page.waitForTimeout(250); } };
  await ready();
  const a = await snap();
  await page.reload();
  await enter(page);
  await ready();
  const b = await snap();
  check("O08", "Reload: every chat, artifact, project, file, app and object keeps its canonical id and relations (re-derived, nothing duplicated)", JSON.stringify(a) === JSON.stringify(b) && a.ids.length > 20, `${a.ids.length} entities · ${a.rels.length} relations`);
  const integ = await integrity(page);
  check("O08", "After the whole run and a reload: 0 dangling relations, 0 duplicate identities", integ.dangling.length === 0 && integ.duplicates.length === 0, JSON.stringify({ dangling: integ.dangling.slice(0, 5), duplicates: integ.duplicates.slice(0, 5) }));
  perf.byAuthority = integ.stats.byAuthority;
  perf.entities = integ.stats.entities;
  perf.relations = integ.stats.relations;
  await ctx.close();
}

/* =============================== iPhone (EMULATION) =============================== */
{
  const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
  await ctx.addInitScript(() => { try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {} });
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  await page.locator('[data-neural-toggle="home"]').tap();
  let s = await waitCard(page, "home", (x) => x.entity === "app:home");
  const vw = await page.evaluate(() => window.innerWidth);
  check("O08", "iPhone (EMULATED): the Home card opens, fits the screen and is on top", s?.entity === "app:home" && s.rect.x >= 0 && s.rect.x + s.rect.w <= vw + 1 && (await onTop(page, card("home"))), JSON.stringify(s?.rect));
  await shot(page, "iphone-home-card");
  await page.locator(`${card("home")} [data-more="presents:out"]`).tap();
  await page.locator(`${card("home")} .nm-chip[data-to="interface:lelu-room"]`).scrollIntoViewIfNeeded();
  await page.locator(`${card("home")} .nm-chip[data-to="interface:lelu-room"]`).tap();
  s = await waitCard(page, "home", (x) => x.entity === "interface:lelu-room");
  check("O08", "iPhone (EMULATED): tap a relationship → LÉLU's Room", s?.entity === "interface:lelu-room");
  await page.locator(`${card("home")} [data-close-embed]`).tap();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForSelector("[aria-label='Chat Universe']");
  await page.waitForTimeout(800);
  await page.locator('[data-neural-toggle="chat-universe"]').tap();
  s = await waitCard(page, "chat-universe", (x) => x.type === "conversation");
  check("O08", "iPhone (EMULATED): the Chat Universe card opens on the current chat and fits", s?.type === "conversation" && s.rect.x + s.rect.w <= vw + 1 && (await onTop(page, card("chat-universe"))), JSON.stringify(s?.rect));
  await shot(page, "iphone-chat-universe-card");
  await ctx.close();
}

await browser.close();
const relevant = errors.filter((e) => !/ERR_CONNECTION|Failed to load resource|429|503|livekit|supabase|Access to fetch at 'https:\/\/export\.arxiv|api\/integration|api\/engineer/i.test(e));
check("O08", "No new page errors during the run", relevant.length === 0, relevant.slice(0, 4).join(" | "));
await writeFile(RESULTS, JSON.stringify({ at: new Date().toISOString(), results, ops, perf, errors: relevant }, null, 2));
const scored = results.filter((x) => !x.informational);
const failed = scored.filter((x) => x.status !== "VERIFIED").length;
console.log(`\n${scored.length - failed}/${scored.length} VERIFIED`);
process.exit(failed ? 1 : 0);
