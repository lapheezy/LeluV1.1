/** Renders composed worlds full-screen from the dev lab page: node scripts/worlds/render-lab.mjs celestial,volcano+aurora [outPrefix] */
import { launch } from "../evolution/harness.mjs";
const fams = (process.argv[2] ?? "celestial").split(",");
const out = process.argv[3] ?? "docs/missions/wp21/shots/lab";
const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
for (const f of fams) {
  await p.goto(`http://127.0.0.1:5173/world-lab.html?f=${f}&q=high&auto=0`, { waitUntil: "load" });
  await p.waitForSelector("[data-world] canvas, [data-world] .ws-flat", { timeout: 60000 });
  await p.waitForTimeout(5000);
  await p.screenshot({ path: `${out}-${f.replace(/\+/g, "_")}.png` });
  console.log(f, await p.evaluate(() => { const w = document.querySelector("[data-world]"); return w.dataset.worldTier + " " + w.dataset.worldMs; }));
}
console.log("errors:", [...new Set(errs)].slice(0, 6).join("\n"));
await b.close();
