/**
 * M15.3 WP04: what occupies the main thread when her world first paints.
 *
 *   node scripts/avatar/profile-world-first-paint.mjs <scenario> <label> [phone|desktop]
 *     scenario A  enter the world normally, profile its first paint
 *     scenario B  enter the world, open the Chat Universe at once (the world
 *                 mounts under it, unpainted), type "walk to the studio" and
 *                 profile from Enter (the WP03 condition)
 *
 * Records (wp04/firstpaint/<scenario>-<label>.json + pictures):
 *  - a CPU profile (Profiler domain, 250 µs) attributed to the nearest
 *    source frame and to the leaf function, with call stacks of the
 *    heaviest leaves;
 *  - long tasks WITH start times, on the same clock as the in-page marks;
 *  - in-page marks: universe open/close, render budget, world data,
 *    command issued/resolved, her telemetry, first frame of her world;
 *  - a screenshot at every stage.
 * Instrumentation lives only in this script; the app is not modified.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const [scenario = "B", label = "run", dev = "desktop"] = process.argv.slice(2);
const OUT = process.env.LELU_FP_OUT ?? "docs/missions/m15-home/avatar-15.3/wp04/firstpaint";
fs.mkdirSync(OUT, { recursive: true });
const tag = `${scenario}-${label}-${dev}`;
const vp = dev === "phone" ? { width: 393, height: 852 } : { width: 1440, height: 900 };
const mobile = vp.width < 1000;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
await ctx.addInitScript(() => {
  window.__lt = [];
  try { new PerformanceObserver((o) => { for (const e of o.getEntries()) window.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch {}
});
// Which shader programs are linked, and when (three.js names them with #define SHADER_NAME).
await ctx.addInitScript(() => {
  window.__links = [];
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const proto = C.prototype;
    const link = proto.linkProgram;
    proto.linkProgram = function (prog) {
      let name = "?", kind = "";
      try {
        for (const sh of this.getAttachedShaders(prog) ?? []) {
          const src = this.getShaderSource(sh) ?? "";
          const m = src.match(/#define SHADER_NAME (\S+)/);
          if (m) name = m[1];
          if (/#define USE_SKINNING/.test(src)) kind += "skin ";
          if (/#define USE_MORPHTARGETS/.test(src)) kind += "morph ";
          if (/#define USE_SHADOWMAP/.test(src)) kind += "shadow ";
          const lights = src.match(/#define NUM_(DIR|POINT|SPOT)_LIGHTS (\d+)/g);
          if (lights) kind += lights.map((l) => l.replace("#define NUM_", "").replace("_LIGHTS", "")).join(",") + " ";
        }
      } catch {}
      window.__links.push({ t: Math.round(performance.now()), name, kind: kind.trim(), w: this.canvas?.width ?? 0 });
      (window.__progName ??= new WeakMap()).set(prog, `${name} [${kind.trim()}]`);
      return link.call(this, prog);
    };
    // How long each blocking query waits, and for which program.
    for (const fn of ["getProgramParameter", "getProgramInfoLog", "getShaderInfoLog", "getUniformLocation", "getActiveUniform"]) {
      const orig = proto[fn];
      proto[fn] = function (obj, ...rest) {
        const t0 = performance.now();
        const r = orig.call(this, obj, ...rest);
        const dt = performance.now() - t0;
        if (dt > 15) (window.__waits ??= []).push({ t: Math.round(t0), fn, ms: Math.round(dt), prog: window.__progName?.get(obj) ?? (fn === "getShaderInfoLog" ? "(shader)" : "?"), w: this.canvas?.width ?? 0 });
        return r;
      };
    }
  }
});
const p = await ctx.newPage();
const shots = [];
let shotN = 0;
async function shot(name) {
  const file = `${OUT}/${tag}-${String(++shotN).padStart(2, "0")}-${name}.png`;
  const t = await p.evaluate(() => Math.round(performance.now())).catch(() => null);
  await p.screenshot({ path: file }).catch(() => {});
  shots.push({ name, file, pageT: t });
  console.log(`shot ${name} (page t ${t})`);
}
await p.goto(process.env.LELU_URL ?? "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) {
  const c = p.getByRole("button", { name: "Continue without an account" });
  if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true });
  if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true").catch(() => false)) break;
  await p.waitForTimeout(500);
}
await p.waitForTimeout(3000);
await shot("home-ready");
// In-page marks on the page's own clock (performance.now), same as long tasks.
await p.evaluate(async () => {
  const marks = (window.__marks = []);
  const M = (ev, d = {}) => marks.push({ t: Math.round(performance.now()), ev, ...d });
  const { default: Bus } = await import("/src/core/avatar/AvatarCommandBus.ts");
  const { isUniverseOpen, subscribeUniverseOpen } = await import("/src/app/scene/genesis/chat/universe/universeOpen.ts");
  const { getSceneRenderBudget } = await import("/src/app/scene/genesis/SceneRenderBudget.ts");
  const bus = Bus.getInstance();
  const issue = bus.issue.bind(bus);
  bus.issue = (kind, label, timeout, target) => {
    M("command-issued", { label });
    const pr = issue(kind, label, timeout, target);
    pr.then((o) => M("command-resolved", { o }), (r) => M("command-rejected", { r: String(r) }));
    return pr;
  };
  subscribeUniverseOpen(() => M("universe", { open: isUniverseOpen() }));
  const budget = getSceneRenderBudget();
  budget.subscribe(() => M("render-budget", { mode: budget.mode() }));
  let firstSpatial = false;
  window.addEventListener("lelu:spatial-state", (e) => {
    const d = e.detail ?? {};
    if (d.persisted) return;
    if (!firstSpatial) { firstSpatial = true; M("her-world-first-frame"); }
    M("spatial", { position: d.position, outcome: d.goal?.outcome ?? null, remaining: d.goal?.remaining ?? null });
  });
  const f = window.fetch;
  window.fetch = async (...a) => {
    const url = String(a[0]?.url ?? a[0]);
    if (!/\/api\/forge\/world/.test(url)) return f(...a);
    M("world-data-start", { url });
    const r = await f(...a);
    M("world-data-done", { url });
    return r;
  };
  // A frame-gap detector: any gap > 250 ms between animation frames.
  let last = performance.now();
  const tick = (now) => { if (now - last > 250) M("frame-gap", { from: Math.round(last), ms: Math.round(now - last) }); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const cdp = await ctx.newCDPSession(p);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
const mark = (ev, d = {}) => p.evaluate(([e, x]) => window.__marks.push({ t: Math.round(performance.now()), ev: e, ...x }), [ev, d]).catch(() => {});

let profileStart; // eslint-disable-line no-unused-vars
if (scenario === "A") {
  await mark("profile-start");
  await cdp.send("Profiler.start");
  profileStart = Date.now();
  await p.locator('.lsn-item[aria-label="Worlds"]').click();
  await p.waitForTimeout(600);
  await shot("worlds-menu");
  await mark("world-clicked");
  await p.locator('[data-world="genesisv2"]').click();
  for (const s of [3, 8, 15]) { await p.waitForTimeout(s === 3 ? 3000 : (s === 8 ? 5000 : 7000)); await shot(`world-+${s}s`); }
} else {
  await p.locator('.lsn-item[aria-label="Worlds"]').click();
  await p.waitForTimeout(600);
  await mark("world-clicked");
  await p.locator('[data-world="genesisv2"]').click();
  await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await p.waitForTimeout(1500);
  if (!(await p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").count())) { await p.locator("button.lcu-card:visible").first().click().catch(() => {}); await p.waitForTimeout(1500); }
  await shot("chat-over-unpainted-world");
  const box = p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").first();
  await box.click();
  await box.fill("walk to the studio");
  // Every canvas on the page as the walk is asked: size, owner, preparation state.
  await mark("canvases-before-enter", { canvases: await p.evaluate(() => [...document.querySelectorAll("canvas")].map((c) => ({ w: c.width, h: c.height, spatial: Boolean(c.dataset.leluSpatial), prepared: c.dataset.leluPrepared ?? null, parent: c.closest("[data-workspace],[data-testid]")?.getAttribute("data-workspace") ?? c.closest("[data-testid]")?.getAttribute("data-testid") ?? null }))) });
  await mark("profile-start");
  await cdp.send("Profiler.start");
  profileStart = Date.now();
  await box.press("Enter");
  await mark("enter-pressed");
  for (const s of [1, 5, 12, 20]) { await p.waitForTimeout(s === 1 ? 1000 : s === 5 ? 4000 : s === 12 ? 7000 : 8000); await shot(`after-enter-+${s}s`); }
}
const { profile } = await cdp.send("Profiler.stop");
await mark("profile-stop");
await p.waitForTimeout(500);
await shot("end");
const marks = await p.evaluate(() => window.__marks);
const links = await p.evaluate(() => window.__links);
const waits = await p.evaluate(() => window.__waits ?? []);
const longTasks = await p.evaluate(() => window.__lt);

// ---- attribution
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const owner = new Map(); const leaf = new Map(); const pkg = new Map();
const tStart = profile.startTime; // µs, profiler clock
let t = tStart;
const timeline = []; // per-100ms bucket: busy ms and top owner
profile.samples.forEach((id, i) => {
  t += profile.timeDeltas[i];
  const n0 = byId.get(id); const fn = n0.callFrame.functionName;
  if (fn === "(idle)") return;
  const dt = profile.timeDeltas[i] / 1000;
  const lk = `${fn || "(anon)"} ${n0.callFrame.url.replace(/.*\//, "").replace(/\?.*/, "")}`;
  leaf.set(lk, (leaf.get(lk) ?? 0) + dt);
  let cur = id, name = null, dep = null;
  while (cur !== undefined) {
    const n = byId.get(cur); const u = n.callFrame.url;
    if (!dep && /node_modules\/\.vite\/deps\/([^?]+)/.test(u)) dep = u.match(/deps\/([^?.]+)/)[1];
    if (/\/src\//.test(u)) { name = `${n.callFrame.functionName || "(anon)"} ${u.replace(/.*\/src\//, "src/").replace(/\?.*/, "")}:${n.callFrame.lineNumber}`; break; }
    cur = parent.get(cur);
  }
  const k = name ?? `(no src) ${fn}`; owner.set(k, (owner.get(k) ?? 0) + dt);
  const pk = dep ?? (name ? name.split(" ")[1].split(":")[0] : `(native) ${fn}`); pkg.set(pk, (pkg.get(pk) ?? 0) + dt);
  const bucket = Math.floor((t - tStart) / 1e5);
  (timeline[bucket] ??= new Map()).set(k, ((timeline[bucket]?.get(k)) ?? 0) + dt);
});
const top = (m, n = 25) => [...m.entries()].sort((a, c) => c[1] - a[1]).slice(0, n).map(([k, v]) => `${Math.round(v)}ms ${k}`);
// Stacks of the heaviest leaves.
const heavy = [...leaf.entries()].sort((a, c) => c[1] - a[1]).slice(0, 8).map(([k]) => k.split(" ")[0]);
const stacks = {};
profile.samples.forEach((id) => {
  const n0 = byId.get(id); const fn = n0.callFrame.functionName;
  if (!heavy.includes(fn) || fn === "(program)" || fn === "(garbage collector)") return;
  const chain = []; let cur = parent.get(id);
  while (cur !== undefined && chain.length < 14) { const n = byId.get(cur); chain.push(`${n.callFrame.functionName || "(anon)"}@${n.callFrame.url.replace(/.*\//, "").replace(/\?.*/, "")}:${n.callFrame.lineNumber}`); cur = parent.get(cur); }
  const k = `${fn} <- ${chain.join(" <- ")}`; stacks[k] = (stacks[k] ?? 0) + 0.25;
});
const p0 = marks.find((m) => m.ev === "profile-start")?.t ?? 0;
const ltIn = longTasks.filter((x) => x.start >= p0 - 50);
const busySeconds = timeline.map((m, i) => ({ s: (i / 10).toFixed(1), busy: Math.round([...(m?.values() ?? [])].reduce((a, c) => a + c, 0)), top: m ? [...m.entries()].sort((a, c) => c[1] - a[1])[0][0] : null })).filter((x) => x.busy > 60);
const res = {
  scenario, label, dev, viewport: vp,
  marks: marks.map((m) => ({ ...m, rel: m.t - p0 })),
  longTasks: ltIn.map((x) => ({ ...x, rel: x.start - p0 })),
  // Every long task since the world was clicked (the covered phase included).
  longTasksAll: longTasks.map((x) => ({ ...x, rel: x.start - p0 })),
  longTaskMs: ltIn.reduce((a, c) => a + c.dur, 0), worst: Math.max(0, ...ltIn.map((x) => x.dur)),
  byOwner: top(owner), byLeaf: top(leaf), byPackage: top(pkg, 15),
  stacks: Object.entries(stacks).sort((a, c) => c[1] - a[1]).slice(0, 10).map(([k, v]) => `${Math.round(v)}ms: ${k}`),
  busy100ms: busySeconds,
  shots,
  links: links.map((l) => ({ ...l, rel: l.t - p0 })),
  waits: waits.map((w) => ({ ...w, rel: w.t - p0 })),
};
fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(res, null, 1));
{
  const big = res.links.filter((l) => l.w > 600);
  const before = big.filter((l) => l.rel < 0), after = big.filter((l) => l.rel >= 0);
  const group = (xs) => Object.entries(xs.reduce((a, l) => { const k = `${l.name} [${l.kind}]`; a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${v}× ${k}`);
  console.log(`world-canvas programs linked BEFORE profile start: ${before.length}; AFTER: ${after.length}`);
  console.log("  after:\n    " + group(after).slice(0, 30).join("\n    "));
  console.log("  before:\n    " + group(before).slice(0, 12).join("\n    "));
}
console.log("blocking GL queries > 15 ms after profile start:\n  " + res.waits.filter((w) => w.rel >= 0).map((w) => `+${w.rel} ${w.ms}ms ${w.fn} ${w.prog} (canvas ${w.w})`).slice(0, 30).join("\n  "));
console.log(`long tasks ${ltIn.length}, ${res.longTaskMs} ms, worst ${res.worst} ms`);
console.log(res.longTasks.slice(0, 12).map((x) => `  +${x.rel}ms ${x.dur}ms`).join("\n"));
console.log("marks:\n" + res.marks.filter((m) => m.ev !== "spatial").map((m) => `  +${m.rel} ${m.ev} ${JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => !["t", "ev", "rel"].includes(k)))).slice(0, 120)}`).join("\n"));
console.log("by owner:\n  " + res.byOwner.slice(0, 15).join("\n  "));
console.log("by leaf:\n  " + res.byLeaf.slice(0, 15).join("\n  "));
console.log("by package:\n  " + res.byPackage.slice(0, 10).join("\n  "));
await b.close();
