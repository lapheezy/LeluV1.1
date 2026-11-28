/** Her browser panel on Google, ChatGPT and YouTube: what actually shows. node scripts/capabilities/browser-views.mjs */
import { launch } from "../evolution/harness.mjs";
const OUT = "docs/missions/capabilities/shots";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-lelu-home]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(1500);
// Open her Browser the way a person does: the Browser entry in the side menu.
await p.evaluate(() => { const el = [...document.querySelectorAll("button, a, [role=button]")].find((e) => e.textContent.trim() === "Browser"); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await p.waitForSelector(".lbr-page", { timeout: 20000 }).catch(() => console.log("browser panel did not open"));
const results = {};
for (const [name, url] of [["google", "https://www.google.com/search?q=oversized+bomber+sewing+pattern"], ["chatgpt", "https://chatgpt.com/"], ["youtube", "https://www.youtube.com/watch?v=aircAruvnKk"], ["wikipedia", "https://en.wikipedia.org/wiki/Bomber_jacket"]]) {
  await p.evaluate((url) => window.dispatchEvent(new CustomEvent("genesis-browser-goto", { detail: { url } })), url);
  await p.waitForTimeout(9000);
  results[name] = await p.evaluate(() => {
    const page = document.querySelector(".lbr-page");
    const reader = document.querySelector("[data-lelu-browser-reader]");
    const frame = page?.querySelector("iframe");
    return { panel: !!page, mode: page?.getAttribute("data-mode"), iframeSrc: frame?.getAttribute("src")?.slice(0, 90) ?? null, reader: reader ? { status: reader.getAttribute("data-status"), text: reader.textContent.slice(0, 160) } : null, notice: (document.querySelector(".lbr-page")?.textContent ?? "").slice(0, 200) };
  });
  await p.screenshot({ path: `${OUT}/browser-${name}.png` });
}
console.log(JSON.stringify(results, null, 1));
await b.close();
