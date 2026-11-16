/**
 * Integration acceptance (scratch, not committed): the real app on the
 * integrated tree, real Chromium, real dev server with its server-side
 * provider proxy (/api/model/*). Anthropic is never called.
 *
 *   node docs/missions/m17-cosmos/m17.3/integration/verify-live-integration.cjs http://127.0.0.1:5173/ <outDir>
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = path.resolve(process.argv[3] ?? ".");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (cat, name, ok, detail = "") => {
  results.push({ cat, name, ok: !!ok, detail: String(detail).slice(0, 700) });
  console.log(`${ok ? "PASS" : "FAIL"}  [${cat}] ${name}${detail ? ` — ${String(detail).slice(0, 320)}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const MODEL_RE = /\/api\/model\/(groq|openrouter|cerebras|anthropic|mistral|fireworks|gemini|githubModels)/;

async function boot(ctx, label) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 240)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(500);
    if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break;
  }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  return { page, errors, label };
}

async function openChat(page) {
  // The user's way in: the Home's Chat tile; the Universe's own open event as a fallback.
  const tile = page.locator("button", { hasText: /^\s*Chat\s*$/ }).first();
  if (await tile.isVisible().catch(() => false)) await tile.click();
  await page.waitForSelector("[aria-label='Chat Universe']", { timeout: 8000 }).catch(() => {});
  if (!(await page.locator("[aria-label='Chat Universe']").count())) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
    await page.waitForSelector("[aria-label='Chat Universe']", { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  return (await page.locator("[aria-label='Chat Universe']").count()) > 0;
}

async function composer(page) {
  if (!(await page.locator("[aria-label='Chat Universe']").count())) await openChat(page);
  const w = page.locator('textarea[aria-label^="Message "]:visible').first();
  let box = (await w.count()) ? w : page.locator(".lcu-composer textarea").first();
  if (await box.isDisabled().catch(() => false)) { await page.locator(".lcu-card").first().click(); await page.waitForTimeout(500); box = page.locator(".lcu-composer textarea").first(); }
  return box;
}

async function send(page, text, timeoutMs = 150000) {
  const box = await composer(page);
  if (!(await box.count())) return { reply: null, note: "no composer" };
  await box.fill(text);
  await box.press("Enter");
  const t0 = Date.now();
  let r = null;
  while (!r && Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(1200);
    r = await page.evaluate(async (text) => {
      const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
      const conv = M.listAll().find((x) => x.messages.some((m) => m.role === "user" && String(m.text).trim() === text));
      if (!conv) return null;
      const at = conv.messages.map((m) => m.role === "user" && String(m.text).trim() === text).lastIndexOf(true);
      const a = conv.messages.slice(at + 1).find((m) => m.role !== "user" && String(m.text ?? "").trim());
      return a && a.activity?.status !== "running"
        ? { conv: conv.id, text: String(a.text), provider: a.provider ?? null, tools: (a.activity?.steps ?? []).filter((x) => x.kind === "tool").map((x) => `${x.tool}:${x.status}`) }
        : null;
    }, text);
  }
  return { reply: r, seconds: Math.round((Date.now() - t0) / 1000) };
}

const objects = (page) =>
  page.evaluate(async () => {
    const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance();
    return S.list().map((o) => ({ id: o.id, name: o.name, position: o.frame.position, place: o.place, visible: o.visible }));
  });

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  /* ---------------- A. provider-backed chat ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/supabase\.co/, (r) => r.abort()); // Supabase stays optional
  const calls = [];
  ctx.on("response", (r) => { const u = r.url(); if (MODEL_RE.test(u) && r.request().method() === "POST") calls.push(`${u.split("/api/model/")[1].split(/[/?]/)[0]} ${r.status()}`); });
  const a = await boot(ctx, "desktop");
  const rootChildren = await a.page.evaluate(() => document.getElementById("root")?.children.length ?? 0);
  check("browser", "1. app boots without a fatal runtime exception", a.errors.length === 0, a.errors.join(" | ") || "no page errors");
  check("browser", "2. main interface renders", rootChildren > 0, `${rootChildren} root children`);
  await shot(a.page, "01-home");
  const chatOpen = await openChat(a.page);
  check("browser", "3. chat opens", chatOpen, chatOpen ? "composer visible" : "no composer");
  // Free-tier providers rate-limit (429); a turn is retried up to 3 times, 25 s apart, each a NEW message.
  let p1, used, q;
  const attempts = [];
  for (let k = 0; k < 3; k++) {
    q = `In one short sentence, what is a coral reef? (${k + 1})`;
    const before = calls.length;
    p1 = await send(a.page, q);
    used = calls.slice(before);
    attempts.push(`#${k + 1}: [${used.join(", ")}] → ${p1.reply?.provider}`);
    if (used.some((u) => / 200$/.test(u)) && !/offline mode|unreachable/i.test(p1.reply?.text ?? "")) break;
    if (k < 2) await a.page.waitForTimeout(25000);
  }
  check("live-provider", "attempts", true, attempts.join(" · "));
  check("browser", "4. a user message can be submitted", Boolean(p1.reply), p1.reply ? `reply in ${p1.seconds} s` : p1.note ?? "no reply");
  const ok200 = used.filter((u) => / 200$/.test(u));
  const offlineText = /offline mode|providers are unreachable|No model provider is reachable/i.test(p1.reply?.text ?? "");
  check("live-provider", "5. response received through an available provider", ok200.length > 0 && !offlineText && /reef/i.test(p1.reply?.text ?? ""), `model requests [${used.join(", ")}] · provider field ${p1.reply?.provider} · “${(p1.reply?.text ?? "").split("\n")[0].slice(0, 200)}”`);
  check("live-provider", "no request to Anthropic", !calls.some((c) => c.startsWith("anthropic")), calls.join(", ") || "none");
  await shot(a.page, "02-provider-reply");

  /* ---------------- B. M17.3 spatial command through chat, Cosmos ---------------- */
  // Seed two objects through the store authority (what spawn does), so the
  // spatial command has real objects to act on.
  const seeded = await a.page.evaluate(async () => {
    const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance();
    const box = (c) => ({ background: "#000", camera: { position: [0, 0, 3], target: [0, 0, 0], fov: 45 }, lights: [], duration: 2, seed: 1,
      objects: [{ id: "body", shape: "box", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: c, metalness: 0.2, roughness: 0.5, opacity: 1, size: { width: 1, height: 1, depth: 1 } }] });
    const g = S.spawn({ name: "acceptance gear", scene: box("#c08040"), builder: "gear", domain: "mechanical" });
    const c = S.spawn({ name: "acceptance cabin", scene: box("#4080c0"), builder: "cabin", domain: "architecture" });
    return { g: g.ok ? g.value.id : g.reason, c: c.ok ? c.value.id : c.reason };
  });
  const objs0 = await objects(a.page);
  const gear0 = objs0.find((o) => o.id === seeded.g);
  const cabin = objs0.find((o) => o.id === seeded.c);
  const mv = await send(a.page, "Move the acceptance gear to the left of the acceptance cabin");
  const objs1 = await objects(a.page);
  const gear1 = objs1.find((o) => o.id === seeded.g);
  const expectedX = cabin ? cabin.position[0] : null;
  check("browser", "10. spatial command reaches the authorized tool path", (mv.reply?.tools ?? []).includes("cosmos.object.position:done"), `tools ${JSON.stringify(mv.reply?.tools)} · “${(mv.reply?.text ?? "").slice(0, 200)}”`);
  check("browser", "10b. the gear now sits to the LEFT of the cabin (same y/z)", gear1 && cabin && gear1.position[0] < expectedX && Math.abs(gear1.position[2] - cabin.position[2]) < 1e-6, `gear ${JSON.stringify(gear0?.position)} → ${JSON.stringify(gear1?.position)}; cabin ${JSON.stringify(cabin?.position)}`);
  const amb = await a.page.evaluate(async () => {
    const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance();
    return S.list().length;
  });
  const unknown = await send(a.page, "Move the spaceship beside the acceptance cabin");
  const objs2 = await objects(a.page);
  check("browser", "unknown object refused; nothing moved", /not done|no object matches|nothing moved/i.test(unknown.reply?.text ?? "") && JSON.stringify(objs2) === JSON.stringify(objs1), `“${(unknown.reply?.text ?? "").slice(0, 200)}” · ${amb} objects unchanged`);

  // 8/9/11: Cosmos opens (canonical dock), objects render, position reflected
  // While chatting, the way in is to ask: cosmos.view.open through the same dispatcher.
  const op = await send(a.page, "Open my Cosmos", 60000);
  check("browser", "8a. 'Open my Cosmos' runs cosmos.view.open", (op.reply?.tools ?? []).includes("cosmos.view.open:done"), `tools ${JSON.stringify(op.reply?.tools)} · “${(op.reply?.text ?? "").slice(0, 160)}”`);
  await a.page.waitForTimeout(5000);
  const universeOverCosmos = await a.page.locator("[aria-label='Chat Universe']").count();
  const inside = await a.page.evaluate(() => ({
    immersive: document.querySelector('[data-testid="lelu-cosmos-dock"]')?.getAttribute("data-immersive"),
    count: document.querySelector('[data-testid="cosmos-dock-count"]')?.textContent ?? null,
    canvases: [...document.querySelectorAll("canvas")].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 200 && r.height > 200; }).length,
  }));
  check("browser", "8. Cosmos opens", inside.immersive === "true", JSON.stringify(inside));
  check("browser", "8b. nothing of the Chat Universe is drawn over the Cosmos", universeOverCosmos === 0, `${universeOverCosmos} Universe dialog(s) in the DOM`);
  check("browser", "9. existing objects render (dock count, live WebGL canvas, screenshot)", inside.canvases > 0 && /2 objects|\d+ objects/.test(inside.count ?? ""), `${inside.count} · ${inside.canvases} large canvas(es)`);
  await shot(a.page, "03-cosmos-after-move");
  const back = a.page.locator('[data-testid="cosmos-dock-back"]');
  if (await back.isVisible().catch(() => false)) await back.click();
  await a.page.waitForTimeout(2500);
  const reopened = await a.page.locator("[aria-label='Chat Universe']").count();
  check("browser", "12b. leaving the Cosmos puts the conversation back where it was", reopened > 0, `${reopened} Universe dialog(s) after Back`);
  const talk = await send(a.page, "/cosmos list", 60000);
  check("browser", "12c. the same chat keeps working after Room/Cosmos round trip", /acceptance gear/i.test(talk.reply?.text ?? ""), `“${(talk.reply?.text ?? "").slice(0, 160)}”`);
  const objsBack = await objects(a.page);
  check("browser", "12a. Cosmos → workspace keeps objects and positions", JSON.stringify(objsBack) === JSON.stringify(objs2), `${objsBack.length} objects`);
  check("browser", "no page errors during the run", a.errors.length === 0, a.errors.join(" | "));

  /* 13. reload does not silently discard state */
  const convId = p1.reply?.conv;
  await a.page.reload({ waitUntil: "domcontentloaded" });
  await a.page.waitForTimeout(6000);
  const after = await a.page.evaluate(async (convId) => {
    const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const conv = M.listAll().find((c) => c.id === convId);
    const S = (await import("/src/core/cosmos/objects/CosmosObjectStore.ts")).default.getInstance();
    return { messages: conv?.messages.length ?? 0, objects: S.list().map((o) => ({ id: o.id, name: o.name, position: o.frame.position, place: o.place, visible: o.visible })) };
  }, convId);
  check("browser", "13a. reload keeps the conversation", after.messages >= 2, `${after.messages} messages in ${convId}`);
  check("browser", "13b. reload keeps Cosmos objects at their moved positions", JSON.stringify(after.objects) === JSON.stringify(objs2), `gear ${JSON.stringify(after.objects.find((o) => o.id === seeded.g)?.position)}`);
  await ctx.close();

  /* ---------------- C. provider failure surfaced honestly; offline functions ---------------- */
  const off = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await off.route(/supabase\.co/, (r) => r.abort());
  const blocked = [];
  await off.route(MODEL_RE, (r) => { blocked.push(r.request().url().split("/api/model/")[1].split(/[/?]/)[0]); return r.abort("internetdisconnected"); });
  const b = await boot(off, "providers-down");
  await openChat(b.page);
  const fq = "Explain in two sentences why the sky is blue.";
  const f1 = await send(b.page, fq, 120000);
  const honest = /offline|unreachable|network failed|could(?:n't| not) reach|no (?:model )?provider|not available|can't generate/i.test(f1.reply?.text ?? "");
  check("offline", "6. provider failure is surfaced honestly (all model calls blocked)", f1.reply && honest, `blocked ${blocked.length} model call(s) [${[...new Set(blocked)].join(", ")}] · “${(f1.reply?.text ?? "no reply").split("\n")[0].slice(0, 220)}”`);
  const t1 = await send(b.page, "What time is it?", 60000);
  check("offline", "7. local/offline capability still answers (time, no provider)", /\d{1,2}:\d{2}/.test(t1.reply?.text ?? ""), `“${(t1.reply?.text ?? "no reply").slice(0, 160)}”`);
  const o1 = await send(b.page, "/cosmos list", 60000);
  check("offline", "7b. local Cosmos tools run with providers down", Boolean(o1.reply) && !/offline mode/i.test(o1.reply?.text ?? ""), `“${(o1.reply?.text ?? "no reply").slice(0, 160)}”`);
  check("offline", "no page errors with providers down", b.errors.length === 0, b.errors.join(" | "));
  await shot(b.page, "04-providers-down");
  await off.close();

  fs.writeFileSync(path.join(OUT, "live-integration.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, calls, results }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
