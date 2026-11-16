/** Mission 15 — capture every Design Studio prototype (all three devices). */
import { launch, track } from "../evolution/harness.mjs";
const out = "docs/missions/m15-home/shots";
const ids = ["lelu-central","bento-universe","cosmos-orbit","spatial-home","executive-command","organic-asymmetry","creative-gallery","project-hub","minimal-focus","adaptive-intelligence","workspace-deck","living-ecosystem"];
const b = await launch(); const errs = [];
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const p = await ctx.newPage(); track(p, errs);
await p.goto("http://127.0.0.1:5173/?homeStudio=lelu-central", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 40 && !(await p.locator("[data-lelu-signin-gate],[data-home-studio]").count()); i++) await p.waitForTimeout(500);
await p.evaluate(() => { const g=[...document.querySelectorAll("[data-lelu-signin-gate] button")]; (g.find((e)=>/continue/i.test(e.textContent||""))??g.at(-1))?.click(); });
await p.waitForSelector("[data-home-studio]", { timeout: 60000 });
let n = 0;
for (const id of ids) {
  n++;
  await p.click(`.hs-list [data-template="${id}"]`);
  await p.waitForTimeout(900);
  await p.locator(".hs-main").screenshot({ path: `${out}/proto-${String(n).padStart(2,"0")}-${id}.png` });
}
await b.close();
console.log(errs.filter((e)=>!/ERR_CONNECTION|503|429/.test(e)).slice(0,6).join("\n") || "no page errors");
