/**
 * M15.3 WP02 — LÉLU's main-thread cost while live. Desktop, Chat Universe in
 * workspace mode (the Cosmos is paused by its own budget), so what remains on
 * the main thread is mostly her. CPU profile over 6 s: self time by function,
 * grouped into her code, three.js, React and the rest.
 *   node scripts/avatar/profile-avatar-cpu.mjs [label]
 */
import { chromium } from "playwright";
import fs from "node:fs";
const label = process.argv[2] ?? "run";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
// A/B: "--no-companion" turns her companion off through its own setting
// (CompanionStore.enabled = false unmounts her presence) — same session otherwise.
if (process.argv.includes("--no-companion")) await ctx.addInitScript(() => localStorage.setItem("lelu.lelu.companion.v1", JSON.stringify({ enabled: false, pinned: false, x: 0.1, y: 0.15, size: "medium", framing: "full", lastMovedBy: "lelu", updatedAt: 1, window: null })));
const where = process.argv.includes("--home") ? "home" : "chat";
const p = await ctx.newPage();
await p.goto(process.env.LELU_URL ?? "http://127.0.0.1:5173/");
for (let i = 0; i < 80; i++) { const c = p.getByRole("button", { name: "Continue without an account" }); if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true }); if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true" || Boolean(document.querySelector("[data-lelu-home]")) && performance.now() > 20000)) break; await p.waitForTimeout(500); }
if (where === "chat") await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await p.waitForTimeout(8000);
const frameCount = () => p.evaluate(() => Number(document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.frames || 0));
const f0 = await frameCount();
const cdp = await ctx.newCDPSession(p);
await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start");
await p.waitForTimeout(6000);
const { profile } = await cdp.send("Profiler.stop");
const f1 = await frameCount();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map(); const group = { her: 0, three: 0, r3f: 0, react: 0, idle: 0, gc: 0, program: 0, other: 0 };
profile.samples.forEach((id, i) => {
  const n = byId.get(id); const dt = profile.timeDeltas[i] / 1000; const url = n.callFrame.url;
  const k = `${n.callFrame.functionName || "(anon)"} ${url.replace(/.*\//, "").replace(/\?.*/, "")}:${n.callFrame.lineNumber}`;
  self.set(k, (self.get(k) ?? 0) + dt);
  const g = n.callFrame.functionName === "(idle)" ? "idle" : n.callFrame.functionName === "(garbage collector)" ? "gc" : n.callFrame.functionName === "(program)" ? "program" : /avatar\/|LeluBody|LeluMotion|AvatarBehaviour|LeluLife|holoMaterial/.test(url) ? "her" : /three/.test(url) ? "three" : /react-three|fiber/.test(url) ? "r3f" : /react/.test(url) ? "react" : "other";
  group[g] += dt;
});
// Which of OUR source functions is on the stack when the time is spent
// (nearest ancestor in /src/), so React work is attributed to its component.
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const owner = new Map();
profile.samples.forEach((id, i) => {
  const dt = profile.timeDeltas[i] / 1000;
  let cur = id, name = null;
  while (cur !== undefined) { const n = byId.get(cur); if (/\/src\//.test(n.callFrame.url)) { name = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/src\//, "src/").replace(/\?.*/, "")}`; break; } cur = parent.get(cur); }
  const fn = byId.get(id).callFrame.functionName;
  if (fn === "(idle)" || fn === "(program)") return;
  const k = name ?? "(no src frame)";
  owner.set(k, (owner.get(k) ?? 0) + dt);
});
const total = Object.values(group).reduce((a, c) => a + c, 0);
const busy = total - group.idle;
const frames = f1 - f0;
const res = { label, frames, avatarFps: +(frames / 6).toFixed(1), busyMs: Math.round(busy), busyPct: +((busy / total) * 100).toFixed(1), msPerAvatarFrame: frames ? +((group.her + group.three + group.r3f) / frames).toFixed(2) : null, group: Object.fromEntries(Object.entries(group).map(([k, v]) => [k, Math.round(v)])), top: [...self.entries()].filter(([k]) => !/^\((idle|program)\)/.test(k)).sort((a, c) => c[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v)}ms ${k}`), bySourceOwner: [...owner.entries()].sort((a, c) => c[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v)}ms ${k}`) };
fs.mkdirSync("docs/missions/m15-home/avatar-15.3/wp02", { recursive: true });
fs.writeFileSync(`docs/missions/m15-home/avatar-15.3/wp02/cpu-${label}.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1));
await b.close();
