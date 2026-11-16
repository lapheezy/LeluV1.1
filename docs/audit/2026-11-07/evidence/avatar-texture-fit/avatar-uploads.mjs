import { chromium, devices } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__gl = { contexts: 0, texBytes: 0, texCalls: 0 };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = orig.call(this, type, ...rest);
    if (c && /webgl/.test(type) && !this.__counted) { this.__counted = true; window.__gl.contexts++; }
    return c;
  };
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const fn of ["texImage2D", "texImage3D", "texSubImage2D", "compressedTexImage2D"]) {
      const o = P[fn]; if (!o) continue;
      P[fn] = function (...a) {
        window.__gl.texCalls++;
        const src = a.find((x) => x && typeof x === "object" && ("width" in x || "byteLength" in x));
        const bytes = src?.byteLength ?? ((src?.width ?? 0) * (src?.height ?? 0) * 4);
        window.__gl.texBytes += bytes;
        const host = this.canvas?.closest?.("[data-testid]")?.getAttribute("data-testid") ?? this.canvas?.parentElement?.className?.toString().slice(0, 24) ?? "?";
        window.__gl.by = window.__gl.by ?? {}; window.__gl.by[host] = (window.__gl.by[host] ?? 0) + Math.round(bytes / 1048576);
        return o.apply(this, a);
      };
    }
  }
});
const snap = async (label) => { const s = await Promise.race([page.evaluate(() => ({ ...window.__gl, canvases: document.querySelectorAll("canvas").length, avatar: [...document.querySelectorAll("[data-testid=lelu-companion]")].map((e) => e.dataset.presence) })), new Promise((r) => setTimeout(() => r("timeout"), 15000))]); console.log(label.padEnd(26), JSON.stringify({ ...s, MB: s.texBytes ? +(s.texBytes / 1048576).toFixed(1) : 0 })); };
await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
for (let i = 0; i < 60; i++) { await page.waitForTimeout(2000); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null).catch(() => false)) break; }
await page.waitForTimeout(3000); await snap("1 home (her model ready)");
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
await page.waitForTimeout(5000); await snap("2 chat universe open");
await page.evaluate(() => [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? ""))?.click());
await page.waitForTimeout(5000); await snap("3 conversation sheet");
await page.evaluate(() => { const w = document.querySelector("[data-lelu-fullscreen]"); [...(w?.querySelectorAll("button") ?? [])].find((b) => /^Close /.test(b.getAttribute("aria-label") ?? ""))?.click(); });
await page.waitForTimeout(3000); await snap("4 universe again");
await page.evaluate(() => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === "Home")?.click());
for (let i = 0; i < 30; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null).catch(() => false)) break; }
await page.waitForTimeout(3000);
await snap("5 home again"); await page.screenshot({ path: "avatar-home-again.png" }); void ("step4 state", JSON.stringify(await page.evaluate(() => ({ universe: !!document.querySelector(".lcu-card"), sheet: !!document.querySelector("[data-lelu-fullscreen]"), home: !!document.querySelector("[data-lelu-home], [data-testid=cosmos-home]"), text: document.body.innerText.slice(0, 120) }))));
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
await page.waitForTimeout(5000);
await page.evaluate(() => [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? ""))?.click());
await page.waitForTimeout(5000);
await page.evaluate(() => { const w = document.querySelector("[data-lelu-fullscreen]"); [...(w?.querySelectorAll("button") ?? [])].find((b) => /^Close /.test(b.getAttribute("aria-label") ?? ""))?.click(); });
await page.evaluate(() => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === "Home")?.click());
for (let i = 0; i < 30; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null).catch(() => false)) break; }
await page.waitForTimeout(3000);
await snap("6 home after 2nd round");
await browser.close();
