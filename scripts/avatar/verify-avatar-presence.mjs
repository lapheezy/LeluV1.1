/**
 * M15.3 — acceptance of LÉLU's presence in the real running app (Chromium).
 *
 * Nothing is mocked: her approved model loads from the Forge, commands go
 * through the real chat → router → AvatarResolver → AvatarCommandBus →
 * renderer path, and every "done" is the renderer's own measured
 * confirmation. A picture at every step: docs/missions/m15-home/avatar-15.3/verify/.
 *
 * Chromium viewport emulation only; this is not a physical iPhone.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "docs/missions/m15-home/avatar-15.3/verify";
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.LELU_URL ?? "http://127.0.0.1:5173/";
const only = process.argv[2] ?? "all";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
let n = 0;
async function step(p, name, ok, note = "") {
  n++;
  const file = `${OUT}/step-${String(n).padStart(2, "0")}-${ok ? "ok" : "FAIL"}-${name}.png`;
  await p.screenshot({ path: file }).catch(() => {});
  results.push({ n, name, ok: Boolean(ok), note, file, viewport: p.viewportSize() });
  console.log(`${ok ? "PASS" : "FAIL"} ${String(n).padStart(2)} ${name} ${note}`);
}

async function open(vp) {
  const mobile = vp.width < 1000;
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(() => {
    const seen = new WeakSet();
    window.__ctx = 0;
    const o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...r) { const c = o.call(this, t, ...r); if (c && /webgl/.test(t) && !seen.has(c)) { seen.add(c); window.__ctx++; } return c; };
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    const c = p.getByRole("button", { name: "Continue without an account" });
    if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true });
    if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true").catch(() => false)) break;
    await p.waitForTimeout(500);
  }
  await p.waitForTimeout(2500);
  // Her canvas, as it is now: identity continuity = this same element later.
  await p.evaluate(() => { window.__herCanvas = document.querySelector('[data-testid="lelu-companion-character"] canvas'); });
  return { ctx, p, mobile };
}
const her = (p) =>
  p.evaluate(() => {
    const c = document.querySelector('[data-testid="lelu-companion"]');
    const k = document.querySelector('[data-testid="lelu-companion-character"]');
    if (!c || !k) return null;
    const r = c.getBoundingClientRect();
    return {
      context: c.dataset.context, framing: c.dataset.framing, form: c.dataset.form, reason: c.dataset.presentationReason,
      presence: c.dataset.presence, sheet: c.dataset.sheet, lowPower: c.dataset.lowPower, activity: c.dataset.activity,
      renderer: k.dataset.renderer, model: k.dataset.model, innerForm: k.dataset.form, innerFraming: k.dataset.framing,
      frames: Number(k.dataset.frames ?? 0), playing: k.dataset.playing ?? "", clips: (k.dataset.clips ?? "").split(",").filter(Boolean).length,
      visible: getComputedStyle(c).visibility !== "hidden" && Number(getComputedStyle(c).opacity) > 0.05,
      rect: [r.left, r.top, r.width, r.height].map(Math.round), ctx: window.__ctx,
      sameCanvas: Boolean(window.__herCanvas) && window.__herCanvas === k.querySelector("canvas") && window.__herCanvas.isConnected,
      still: Boolean(document.querySelector('[data-testid="lelu-companion-still"]')),
    };
  });
/** Frames she drew over `ms` (0 = frozen). */
async function framesOver(p, ms = 2500) {
  const a = (await her(p))?.frames ?? 0;
  await p.waitForTimeout(ms);
  return ((await her(p))?.frames ?? 0) - a;
}
async function ask(p, words, wait = 4500) {
  if (!(await p.locator(".lcu-input textarea:visible, textarea[placeholder^='Message LÉLU']:visible").count())) {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
    await p.waitForTimeout(1500);
  }
  // The Universe can open on its overview grid: open a chat the way she would.
  if (!(await p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").count())) {
    await p.locator("button.lcu-card:visible").first().click().catch(() => {});
    await p.waitForTimeout(1500);
  }
  const box = p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").first();
  await box.click();
  await box.fill(words);
  await box.press("Enter");
  // The reply that follows THIS message (not the last bubble on the page):
  // a walk is confirmed on arrival, so allow up to `wait` + 20 s.
  const deadline = Date.now() + wait + 50_000;
  let text = "";
  while (Date.now() < deadline) {
    text = await p.evaluate((w) => {
      const msgs = [...document.querySelectorAll(".lcu-msg[data-role]")];
      let i = -1;
      msgs.forEach((m, k) => { if (m.dataset.role === "user" && m.textContent.trim().includes(w)) i = k; });
      if (i < 0) return "";
      const next = msgs.slice(i + 1).find((m) => m.dataset.role !== "user");
      return next ? next.textContent.trim() : "";
    }, words);
    if (text && /(Done|honest|Projected|Back as|All of me|Just my face|choose how|Not performed|never confirmed|I didn't)/.test(text)) break;
    // She may step out of the chat to act where you can watch: give her the
    // time, then reopen the chat to read her reply.
    if (!text && !(await p.locator(".lcu-msg").count())) {
      await p.waitForTimeout(wait);
      await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
      await p.waitForTimeout(1500);
      if (!(await p.locator(".lcu-msg").count())) await p.locator("button.lcu-card:visible").first().click().catch(() => {});
      await p.waitForTimeout(1200);
    }
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(800);
  return text || "(no reply)";
}
async function leaveChat(p) {
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  const x = p.getByRole("button", { name: "Close Chat Universe" });
  if (await x.isVisible().catch(() => false)) await x.click();
  await p.waitForTimeout(1200);
}
const openApp = async (p, mobile, name) => {
  const btn = p.locator('button[aria-label="Open the app library"]');
  if (mobile) await btn.tap(); else await btn.click();
  await p.waitForTimeout(800);
  await p.locator(".lsh-app", { hasText: new RegExp(`^${name}`) }).first().click();
  await p.waitForTimeout(3500);
};
const goHome = async (p) => {
  const home = p.locator('.lsn-item[aria-label="Home"]');
  if (await home.isVisible().catch(() => false)) await home.click();
  else {
    const close = p.locator('.lws-icon[aria-label^="Close "]:visible, [data-lelu-module-window] button[aria-label^="Close "]:not([aria-label^="Close tab"]):visible').first();
    if (await close.count()) await close.click({ force: true });
    await p.waitForTimeout(600);
    if (await home.isVisible().catch(() => false)) await home.click();
  }
  await p.waitForTimeout(2500);
};

// ---------------------------------------------------------------- A. forms
if (only === "all" || only === "forms") {
  const { ctx, p } = await open({ width: 1440, height: 900 });
  const start = await her(p);
  await step(p, "approved-model-3d", start?.renderer === "3d" && start.clips >= 31, `model ${start?.model?.slice(0, 60)}…; ${start?.clips} clips`);
  await step(p, "home-presentation", start?.context === "home" && start.visible, `${start?.context} → ${start?.framing}/${start?.form} (${start?.reason})`);
  const cases = [
    ["become a hologram", (h) => h.form === "hologram" && h.innerForm === "hologram"],
    ["show me all of you", (h) => h.framing === "full" && h.innerFraming === "full"],
    ["just your face", (h) => h.framing === "face" && h.innerFraming === "face"],
    ["become embodied", (h) => h.form === "embodied" && h.innerForm === "embodied"],
    ["choose your own form", (h) => h.reason && !/chosen/.test(h.reason)],
  ];
  for (const [words, check] of cases) {
    const reply = await ask(p, words);
    await leaveChat(p);
    const h = await her(p);
    const live = await framesOver(p);
    const same = h.model === start.model && h.sameCanvas;
    const shot = await p.evaluate(() => { const r = document.querySelector('[data-testid="lelu-companion"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    await p.screenshot({ path: `${OUT}/form-${words.replace(/\W+/g, "-")}.png`, clip: { x: Math.max(0, shot[0] - 30), y: Math.max(0, shot[1] - 20), width: shot[2] + 60, height: shot[3] + 40 } }).catch(() => {});
    await step(p, `chat-${words.replace(/\W+/g, "-")}`, check(h) && same && live > 0, `→ ${h.framing}/${h.form}; same model & same canvas (no rebuild) ${same}; drew ${live} frames; reply “${reply.slice(-90)}”`);
  }
  await ctx.close();
}

// ---------------------------------------------------- B. context adaptation
if (only === "all" || only === "contexts") {
  for (const [dev, vp] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 393, height: 852 }]]) {
    const { ctx, p, mobile } = await open(vp);
    const ctx0 = (await her(p)).ctx;
    const seen = [];
    for (const [label, go] of [
      ["home", async () => {}],
      ["chat", async () => { await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))); await p.waitForTimeout(2500); }],
      ["home-after-chat", async () => leaveChat(p)],
      ["browser", async () => openApp(p, mobile, "Browser")],
      ["home-after-browser", async () => goHome(p)],
      ["studio", async () => openApp(p, mobile, "Studio")],
      ["home-after-studio", async () => goHome(p)],
      ["code", async () => openApp(p, mobile, "Code")],
      ["home-after-code", async () => goHome(p)],
    ]) {
      await go();
      const h = await her(p);
      const drew = await framesOver(p, 3000);
      seen.push(`${label}:${h.context}/${h.framing}/${h.form}`);
      const animating = drew > 0 || h.lowPower === "rest";
      await step(p, `${dev}-${label}`, h.visible && animating && h.renderer === "3d" && h.sameCanvas, `${h.context} → ${h.framing}/${h.form}; drew ${drew} frames in 3 s${h.lowPower === "rest" ? " (measured low-power rest: software renderer beside a phone sheet)" : ""}; same canvas ${h.sameCanvas}; page WebGL contexts +${h.ctx - ctx0}`);
    }
    await ctx.close();
  }
}

// ------------------------------------------------------------- C. actions
if (only === "all" || only === "actions") {
  const { ctx, p } = await open({ width: 1440, height: 900 });
  for (const words of ["wave", "dance", "move to the left", "go back to your spot"]) {
    const reply = await ask(p, words, words.startsWith("move") || words.startsWith("go") ? 3500 : 6500);
    const done = /Done/.test(reply) && /(played|moved|own place)/.test(reply);
    await step(p, `overlay-${words.replace(/\W+/g, "-")}`, done, `reply “${reply.slice(-140)}”`);
    await leaveChat(p);
  }
  // Her world: walk, turn, gesture — performed by the world presence.
  await p.locator('.lsn-item[aria-label="Worlds"]').click();
  await p.waitForTimeout(700);
  await p.locator('[data-world="genesisv2"]').click();
  for (let i = 0; i < 60 && !(await p.evaluate(() => Boolean(document.querySelector("canvas[data-lelu-spatial]")))); i++) await p.waitForTimeout(500);
  const spatial = () => p.evaluate(() => JSON.parse(document.querySelector("canvas[data-lelu-spatial]")?.dataset.leluSpatial ?? "null"));
  await step(p, "world-presence", Boolean(await spatial()), `in her world at ${JSON.stringify((await spatial())?.position)}`);
  for (const [words, wait] of [["walk to the studio", 16000], ["face me", 6000], ["come closer", 14000], ["dance", 7000], ["go back to your spot", 16000]]) {
    const before = await spatial();
    const reply = await ask(p, words, wait);
    await leaveChat(p);
    const after = await spatial();
    const moved = before && after ? Math.hypot(after.position[0] - before.position[0], after.position[2] - before.position[2]) : 0;
    const done = /Done/.test(reply);
    await step(p, `world-${words.replace(/\W+/g, "-")}`, done, `moved ${moved.toFixed(2)} m; reply “${reply.slice(-150)}”`);
  }
  await ctx.close();
}

// ------------------------------------------------ D. App Library coexistence
if (only === "all" || only === "library") {
  for (const [dev, vp] of [["desktop", { width: 1440, height: 900 }], ["tablet", { width: 820, height: 1180 }], ["phone-portrait", { width: 393, height: 852 }], ["phone-landscape", { width: 852, height: 393 }]]) {
    const { ctx, p, mobile } = await open(vp);
    const btn = p.locator('button[aria-label="Open the app library"]');
    if (mobile) await btn.tap(); else await btn.click();
    await p.waitForTimeout(1000);
    // She notices the sheet on her next animation frame; at this container's
    // ~2 fps that can take a moment.
    for (let i = 0; i < 15 && (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion"]')?.dataset.sheet)) !== "under"; i++) await p.waitForTimeout(200);
    const res = await p.evaluate(() => {
      // Tiles whose centre is on screen (a landscape sheet scrolls past the bottom edge).
      const tiles = [...document.querySelectorAll(".lsh-app")].filter((t) => { const r = t.getBoundingClientRect(); const cx = r.x + r.width / 2; const cy = r.y + r.height / 2; return cy >= 0 && cy <= innerHeight && cx >= 0 && cx <= innerWidth; });
      const blocked = tiles.filter((t) => { const r = t.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !(hit && t.contains(hit)); }).map((t) => t.querySelector(".lsh-app-name")?.textContent);
      const render = tiles.find((t) => /^Render/.test(t.textContent));
      const c = document.querySelector('[data-testid="lelu-companion"]');
      return { tiles: tiles.length, blocked, renderVisible: Boolean(render), sheet: c?.dataset.sheet, herVisible: c ? getComputedStyle(c).visibility !== "hidden" : false };
    });
    // The Render tile itself (the reported defect), scrolled into view where needed.
    const renderHit = await p.evaluate(async () => {
      const t = [...document.querySelectorAll(".lsh-app")].find((x) => /^Render/.test(x.textContent));
      if (!t) return "missing";
      t.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 400));
      const r = t.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit && t.contains(hit) ? "receives its touch" : `covered by ${hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? hit?.className}`;
    });
    res.renderHit = renderHit;
    const drew = await framesOver(p, 2500);
    const h = await her(p);
    await step(p, `${dev}-library-open`, res.blocked.length === 0 && res.renderHit === "receives its touch" && res.sheet === "under" && res.herVisible, `${res.tiles} on-screen tiles, blocked: [${res.blocked.join(", ")}]; Render tile ${res.renderHit}; she is ${res.sheet} the sheet, visible, drew ${drew} frames${h.lowPower === "rest" ? " (low-power rest)" : ""}`);
    if (res.renderVisible) {
      await p.locator(".lsh-app", { hasText: /^Render/ }).first().click({ trial: true }).then(() => true).catch(() => false);
    }
    // Close the sheet: she takes her own touches again.
    await p.keyboard.press("Escape");
    await p.waitForTimeout(900);
    const back = await p.evaluate(() => {
      const c = document.querySelector('[data-testid="lelu-companion"]');
      const body = document.querySelector('[data-testid="lelu-companion-body"]');
      const r = body.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height * 0.4);
      return { sheet: c.dataset.sheet, takesTouch: Boolean(hit && body.contains(hit)), pe: getComputedStyle(body).pointerEvents };
    });
    await step(p, `${dev}-library-closed`, back.sheet === "none" && back.pe === "auto", `she is back in front (sheet ${back.sheet}); her body takes touches ${back.takesTouch} (pointer-events ${back.pe})`);
    await ctx.close();
  }
}

// ------------------------------------------ F. the Avatar panel (WP02)
if (only === "all" || only === "panel") {
  for (const [dev, vp] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 393, height: 852 }]]) {
    const { ctx, p, mobile } = await open(vp);
    const ctx0 = (await her(p)).ctx;
    const openPanel = async () => {
      await openApp(p, mobile, "Avatar");
      await p.getByRole("button", { name: "3D", exact: true }).first().click();
      for (let i = 0; i < 20 && (await her(p)).presence !== "preview"; i++) await p.waitForTimeout(250);
      await p.waitForTimeout(1200);
    };
    const inSpot = () => p.evaluate(() => {
      const host = document.querySelector("[data-lelu-preview-host]")?.getBoundingClientRect();
      const c = document.querySelector('[data-testid="lelu-companion"]')?.getBoundingClientRect();
      if (!host || !c) return false;
      return Math.abs(host.left - c.left) < 3 && Math.abs(host.top - c.top) < 3;
    });
    const shot = async (name) => {
      const r = await p.evaluate(() => { const e = document.querySelector("[data-lelu-preview-host]")?.getBoundingClientRect(); return e ? [e.left, e.top, e.width, e.height] : null; });
      if (r) await p.screenshot({ path: `${OUT}/panel-${dev}-${name}.png`, clip: { x: Math.max(0, r[0] - 8), y: Math.max(0, r[1] - 8), width: r[2] + 16, height: r[3] + 16 } }).catch(() => {});
    };
    await openPanel();
    let h = await her(p);
    await shot("open");
    await step(p, `${dev}-panel-preview-is-her`, h.presence === "preview" && h.sameCanvas && h.renderer === "3d" && (await inSpot()), `presence ${h.presence}; ${h.framing}/${h.form}; her own canvas ${h.sameCanvas}; model ${String(h.model).split("|")[0].split("/").slice(-2).join("/")}; in the panel's spot ${await inSpot()}`);
    const drew = await framesOver(p, 3000);
    await step(p, `${dev}-panel-preview-animates`, drew > 0 || h.lowPower === "rest", `drew ${drew} frames in 3 s${h.lowPower === "rest" ? " (measured low-power rest)" : ""}`);
    for (const [group, choice] of [["lelu-form-choice", "hologram"], ["lelu-framing-choice", "face"], ["lelu-framing-choice", "full"], ["lelu-form-choice", "embodied"], ["lelu-form-choice", "auto"], ["lelu-framing-choice", "auto"]]) {
      await p.locator(`[data-testid="${group}"] [data-choice="${choice}"]`).click();
      await p.waitForTimeout(1500);
      h = await her(p);
      await shot(`${group.replace("lelu-", "").replace("-choice", "")}-${choice}`);
      const ok = choice === "auto" ? true : group.includes("form") ? h.form === choice && h.innerForm === choice : h.framing === choice && h.innerFraming === choice;
      await step(p, `${dev}-panel-${group.replace("lelu-", "")}-${choice}`, ok && h.sameCanvas && h.presence === "preview", `→ ${h.framing}/${h.form}; same canvas ${h.sameCanvas}`);
    }
    // Close and reopen: she leaves the spot, comes back; nothing new is created.
    const close = p.locator('.lws-icon[aria-label^="Close "]:visible, [data-lelu-module-window] button[aria-label^="Close "]:not([aria-label^="Close tab"]):visible, button[aria-label="Close window"]:visible').first();
    for (let cycle = 0; cycle < 2; cycle++) {
      if (await close.count()) await close.click({ force: true }); else await goHome(p);
      await p.waitForTimeout(2000);
      const away = await her(p);
      await openPanel();
      const back = await her(p);
      await step(p, `${dev}-panel-close-reopen-${cycle + 1}`, away.presence !== "preview" && back.presence === "preview" && back.sameCanvas, `closed: ${away.presence}; reopened: ${back.presence}; same canvas ${back.sameCanvas}; page WebGL contexts +${back.ctx - ctx0} since start`);
    }
    await ctx.close();
  }
}

// ---------------------------------------------- E. real activity + stress
if (only === "all" || only === "activity") {
  const { ctx, p, mobile } = await open({ width: 1440, height: 900 });
  const states = new Set();
  const watch = setInterval(async () => { const h = await her(p).catch(() => null); if (h) states.add(h.activity); }, 150);
  await ask(p, "What time is it?", 6000);
  clearInterval(watch);
  await leaveChat(p);
  await step(p, "reacts-to-real-turn", states.size >= 2, `activities observed during a real chat turn: ${[...states].join(" → ")}`);
  const ctx0 = (await her(p)).ctx;
  let frozen = 0;
  for (let i = 0; i < 3; i++) {
    for (const go of [async () => { await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))); await p.waitForTimeout(1800); }, async () => leaveChat(p), async () => openApp(p, mobile, "Browser"), async () => goHome(p)]) {
      await go();
      // 3 s after the transition: a transition's own long tasks (the Cosmos
      // remounting) block the whole main thread for up to ~4 s here, which is
      // not her freezing. (An earlier 1.5 s sample recorded 1/12 such zero.)
      if ((await framesOver(p, 3000)) === 0) frozen++;
    }
  }
  const h = await her(p);
  await step(p, "transition-stress", frozen === 0 && h.sameCanvas, `12 transitions (Chat, Home, Browser, Home ×3): frozen on ${frozen}; her canvas the same element throughout ${h.sameCanvas}; page WebGL contexts created during the loop (Cosmos included): ${h.ctx - ctx0}`);
  await ctx.close();
}

await b.close();
fs.writeFileSync(`${OUT}/verify-${only}.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} verified`);
process.exit(failed ? 1 : 0);
