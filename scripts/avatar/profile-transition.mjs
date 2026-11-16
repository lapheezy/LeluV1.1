/**
 * M15.3 WP02 — what LÉLU's presence does during one screen switch on a phone
 * (Home → an app). CPU profile across the switch, attributed to the nearest
 * source function on the stack; long tasks counted.
 *   node scripts/avatar/profile-transition.mjs <App label> [label]
 */
import { chromium } from "playwright";
import fs from "node:fs";
const app = process.argv[2] ?? "Code";
const label = process.argv[3] ?? "run";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
if (process.argv.includes("--no-companion")) await ctx.addInitScript(() => localStorage.setItem("lelu.lelu.companion.v1", JSON.stringify({ enabled: false, pinned: false, x: 0.1, y: 0.15, size: "medium", framing: "full", lastMovedBy: "lelu", updatedAt: 1, window: null })));
await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((o) => { for (const e of o.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask" }); } catch {} });
const p = await ctx.newPage();
await p.goto(process.env.LELU_URL ?? "http://127.0.0.1:5173/");
for (let i = 0; i < 80; i++) { const c = p.getByRole("button", { name: "Continue without an account" }); if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true }); if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true" || (!document.querySelector('[data-testid="lelu-companion"]') && performance.now() > 15000))) break; await p.waitForTimeout(500); }
await p.waitForTimeout(6000);
await p.tap('button[aria-label="Open the app library"]'); await p.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(p);
await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
await p.evaluate(() => { window.__lt = []; });
await cdp.send("Profiler.start");
await p.locator(".lsh-app", { hasText: new RegExp(`^${app}`) }).first().click();
await p.waitForTimeout(9000);
const { profile } = await cdp.send("Profiler.stop");
const lt = await p.evaluate(() => window.__lt);
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const owner = new Map(); const leaf = new Map();
profile.samples.forEach((id, i) => {
  const n0 = byId.get(id); const fn = n0.callFrame.functionName; if (fn === "(idle)") return;
  const dt = profile.timeDeltas[i] / 1000;
  const lk = `${fn || "(anon)"} ${n0.callFrame.url.replace(/.*\//, "").replace(/\?.*/, "")}`; leaf.set(lk, (leaf.get(lk) ?? 0) + dt);
  let cur = id, name = null;
  while (cur !== undefined) { const n = byId.get(cur); if (/\/src\//.test(n.callFrame.url)) { name = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/src\//, "src/").replace(/\?.*/, "")}:${n.callFrame.lineNumber}`; break; } cur = parent.get(cur); }
  const k = name ?? `(no src) ${fn}`; owner.set(k, (owner.get(k) ?? 0) + dt);
});
// Call stacks of the heaviest leaf functions (who called them).
const stacks = {};
profile.samples.forEach((id) => {
  const n0 = byId.get(id); const fn = n0.callFrame.functionName;
  if (!["loseContext", "WebGLRenderer.setSize", "toDataURL", "getShaderInfoLog"].includes(fn)) return;
  const chain = []; let cur = parent.get(id);
  while (cur !== undefined && chain.length < 9) { const n = byId.get(cur); chain.push(`${n.callFrame.functionName || "(anon)"}@${n.callFrame.url.replace(/.*\//, "").replace(/\?.*/, "")}:${n.callFrame.lineNumber}`); cur = parent.get(cur); }
  const k = `${fn} <- ${chain.join(" <- ")}`; stacks[k] = (stacks[k] ?? 0) + 1;
});
const top = (m) => [...m.entries()].sort((a, c) => c[1] - a[1]).slice(0, 18).map(([k, v]) => `${Math.round(v)}ms ${k}`);
const res = { app, label, longTasks: lt.length, longTaskMs: lt.reduce((a, c) => a + c, 0), worst: Math.max(0, ...lt), byOwner: top(owner), byLeaf: top(leaf), stacks: Object.entries(stacks).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} samples: ${k}`) };
fs.mkdirSync("docs/missions/m15-home/avatar-15.3/wp02", { recursive: true });
fs.writeFileSync(`docs/missions/m15-home/avatar-15.3/wp02/transition-${app}-${label}.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1));
await b.close();
