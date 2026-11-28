/** Her Browser in Neko live mode: switch to Neko, go to Google, ChatGPT, YouTube; screenshot the panel. */
import { chromium } from "playwright";
const OUT = "docs/missions/capabilities/shots";
// No proxy: the app and Neko are on this machine. mDNS hiding off so local WebRTC connects.
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-lelu-home]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(1500);
await p.evaluate(() => { const el = [...document.querySelectorAll("button, a, [role=button]")].find((e) => e.textContent.trim() === "Browser"); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await p.waitForSelector(".lbr-page", { timeout: 20000 });
const results = {};
for (const [name, url] of [["google", "https://www.google.com/search?q=oversized+bomber+sewing+pattern"], ["chatgpt", "https://chatgpt.com/"], ["youtube", "https://www.youtube.com/watch?v=aircAruvnKk"]]) {
  await p.evaluate((url) => window.dispatchEvent(new CustomEvent("genesis-browser-goto", { detail: { url } })), url);
  await p.waitForTimeout(1500);
  // Switch to Neko live (once; the chip appears when Neko is reachable).
  if (!process.env.AUTO && !(await p.locator('.lbr-page[data-mode="neko"]').count())) {
    await p.waitForFunction(() => [...document.querySelectorAll("button.lbr-chip")].some((e) => /Neko live/.test(e.textContent)), null, { timeout: 20000 });
    await p.evaluate(() => [...document.querySelectorAll("button.lbr-chip")].find((e) => /Neko live/.test(e.textContent)).dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }
  await p.waitForTimeout(14000);
  results[name] = await p.evaluate(() => { const f = document.querySelector('.lbr-page[data-mode="neko"] iframe'); return { mode: document.querySelector(".lbr-page")?.dataset.mode, nav: f?.dataset.nekoNav, live: f?.dataset.nekoLive, client: (f?.getAttribute("src") ?? "").replace(/pwd=[^&]*/, "pwd=***") }; });
  await p.screenshot({ path: `${OUT}/neko-in-browser-${process.env.AUTO ? "auto-" : ""}${name}.png` });
}
console.log(JSON.stringify(results, null, 1));
await b.close();
