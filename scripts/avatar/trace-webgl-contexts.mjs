/**
 * M15.3 — which canvas created each WebGL context (stack per creation) and
 * which contexts were lost, across four Chat open/close cycles on a phone size.
 */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  const o = HTMLCanvasElement.prototype.getContext; const seen = new WeakSet();
  window.__stacks = []; window.__lost = [];
  HTMLCanvasElement.prototype.getContext = function (t, ...r) { const c = o.call(this, t, ...r); if (c && /webgl/.test(t) && !seen.has(c)) { seen.add(c); const st = (new Error().stack || "").split("\n").slice(2, 6).map((l) => l.replace(/https?:\/\/[^/]+\//, "").replace(/\?[^:]*/, "").trim()).join(" < "); window.__stacks.push(st); this.addEventListener("webglcontextlost", () => window.__lost.push({ owner: this.closest("[data-testid]")?.dataset.testid ?? (this.isConnected ? "page" : "detached"), size: `${this.width}x${this.height}`, at: Math.round(performance.now()) })); } return c; };
});
const p = await ctx.newPage();
const warns = [];
p.on("console", (m) => { if (/too many active webgl|context lost|CONTEXT_LOST/i.test(m.text())) warns.push(m.type() + ": " + m.text().slice(0, 140)); });
await p.goto("http://127.0.0.1:5173/"); await p.waitForTimeout(9000);
const g = p.getByRole("button", { name: "Continue without an account" }); if ((await g.count()) && (await g.first().isVisible())) await g.first().click({ force: true });
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))); await p.waitForTimeout(2500);
  await p.getByRole("button", { name: "Close Chat Universe" }).click(); await p.waitForTimeout(3500);
}
const r = await p.evaluate(() => ({ stacks: window.__stacks, lost: window.__lost }));
const counts = {}; for (const s of r.stacks) counts[s] = (counts[s] ?? 0) + 1;
for (const [s, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(n, s.slice(0, 260));
console.log("LOST:", JSON.stringify(r.lost)); console.log("WARN:", warns.length, warns.slice(0, 3));
await b.close();
