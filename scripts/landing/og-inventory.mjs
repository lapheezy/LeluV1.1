/** Records every original screen as it is now (WP21.4 §6 step 1): one screenshot each. */
import { chromium } from "playwright";
const OUT = "docs/missions/wp21_4/og";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const shots = [
  ["01-og-core", "/og/core"], ["02-og-inner-sky", "/og/app"], ["03-og-inner-sky-chats", "/og/app/chats"], ["04-og-universes", "/og/app/universes"],
  ["05-lelu-system", "/?interface=lelu-system"], ["06-lelu-room", "/?interface=lelu-room"], ["07-neural-map", "/?interface=neural-map"],
];
const res = {};
for (const [name, path] of shots) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await p.goto("http://127.0.0.1:5173" + path, { waitUntil: "domcontentloaded" }).catch((e) => errs.push(String(e)));
  for (let i = 0; i < 16; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); await p.waitForTimeout(500); }
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  res[name] = { path, errors: errs.slice(0, 2), text: (await p.evaluate(() => document.body.innerText.slice(0, 80).replace(/\s+/g, " "))) };
  await p.context().close();
}
console.log(JSON.stringify(res, null, 1));
await b.close();
