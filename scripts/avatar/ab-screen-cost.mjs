/**
 * M15.3 WP02 — A/B cost of LÉLU's presence on one app screen (phone size).
 * Opens the screen once, lets it settle, then samples frame times for each
 * variant in turn (same page, same state), repeated: her as shipped, her
 * element out of the page, her shadow filter off, her hologram material off.
 *   node scripts/avatar/ab-screen-cost.mjs <App label> [rounds]
 */
import { chromium } from "playwright";
const app = process.argv[2] ?? "Code";
const rounds = Number(process.argv[3] ?? 3);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { window.__d = []; let l = 0; const t = (x) => { if (l) window.__d.push(x - l); l = x; requestAnimationFrame(t); }; requestAnimationFrame(t); window.__lt = []; try { new PerformanceObserver((o) => { for (const e of o.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask" }); } catch {} });
const p = await ctx.newPage();
await p.goto(process.env.LELU_URL ?? "http://127.0.0.1:5173/");
for (let i = 0; i < 80; i++) { const c = p.getByRole("button", { name: "Continue without an account" }); if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true }); if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true")) break; await p.waitForTimeout(500); }
await p.tap('button[aria-label="Open the app library"]'); await p.waitForTimeout(800);
await p.locator(".lsh-app", { hasText: new RegExp(`^${app}`) }).first().click();
await p.waitForTimeout(12000);
const only = (process.argv[4] ?? "").split(",").filter(Boolean);
const allVariants = {
  shipped: "",
  "no-companion": '[data-testid="lelu-companion"]{display:none!important}',
  "no-shadow-filter": '[data-testid="lelu-companion"]{filter:none!important}',
  "no-transition": '[data-testid="lelu-companion"],[data-testid="lelu-companion-body"]{transition:none!important}',
};
const variants = only.length ? Object.fromEntries(Object.entries(allVariants).filter(([k]) => only.includes(k))) : allVariants;
const out = {};
for (let r = 0; r < rounds; r++) {
  for (const [name, css] of Object.entries(variants)) {
    await p.evaluate((c) => { let st = document.getElementById("ab"); if (!st) { st = document.createElement("style"); st.id = "ab"; document.head.appendChild(st); } st.textContent = c; }, css);
    await p.waitForTimeout(1500);
    await p.evaluate(() => { window.__d = []; window.__lt = []; });
    await p.waitForTimeout(5000);
    const d = await p.evaluate(() => ({ d: window.__d.slice(), lt: window.__lt.slice() }));
    const s = d.d.slice().sort((a, c) => a - c);
    const q = (x) => s[Math.min(s.length - 1, Math.floor(x * s.length))];
    (out[name] ??= []).push({ fps: +(d.d.length / 5).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), dropped: d.d.filter((x) => x > 33.4).length, longTaskMs: Math.round(d.lt.reduce((a, c) => a + c, 0)) });
  }
}
const info = await p.evaluate(() => { const c = document.querySelector('[data-testid="lelu-companion"]'); return { form: c?.dataset.form, framing: c?.dataset.framing, lowPower: c?.dataset.lowPower, still: Boolean(document.querySelector('[data-testid="lelu-companion-still"]')) }; });
console.log(app, JSON.stringify(info));
for (const [k, v] of Object.entries(out)) {
  const fps = v.map((x) => x.fps).sort((a, c) => a - c);
  const med = fps[Math.floor(fps.length / 2)];
  const drops = v.reduce((a, x) => a + x.dropped, 0);
  console.log(k.padEnd(18), `median ${med} fps, min ${fps[0]}, dropped frames total ${drops} over ${v.length}×5 s |`, v.map((x) => x.fps).join(" "));
}
await b.close();
