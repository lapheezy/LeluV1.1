/** Mission 15 Home — screenshot helper: node scripts/home/shoot.mjs <name> [url-suffix] [eval-js] */
import { launch, boot, desktop, iphone, track } from "../evolution/harness.mjs";
import { devices } from "playwright";
const [name = "home", suffix = "", js = ""] = process.argv.slice(2);
const out = "docs/missions/m15-home/shots";
const b = await launch();
const errs = [];
for (const [dev, mk] of [["iphone", iphone], ["tablet", (br) => br.newContext({ ...devices["iPad Pro 11"] })], ["desktop", desktop]]) {
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(dev)) continue;
  const ctx = await mk(b); const p = await ctx.newPage(); track(p, errs);
  process.env.LELU_BASE = `http://127.0.0.1:5173/${suffix}`;
  await p.goto(`http://127.0.0.1:5173/${suffix}`, { waitUntil: "domcontentloaded" });
  await boot(p);
  if (suffix && !p.url().includes(suffix)) { await p.goto(`http://127.0.0.1:5173/${suffix}`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(6000); }
  if (js) { await p.evaluate(js).catch((e) => errs.push("eval: " + e.message)); await p.waitForTimeout(1200); }
  await p.screenshot({ path: `${out}/${name}-${dev}.png` });
  await ctx.close();
}
await b.close();
console.log(errs.slice(0, 8).join("\n") || "no page errors");
