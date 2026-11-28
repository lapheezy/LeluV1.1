/**
 * Themes, from the Cosmos landing: + → Theme → a family; the Cosmos takes it; the chat workspace (every
 * variant) takes it; then "go back to the primary cosmos" typed to LÉLU.
 *   node scripts/landing/theme.mjs [family]
 */
import { chromium } from "playwright";
const OUT = "docs/missions/unify/shots";
const FAMILY = process.argv[2] ?? "volcano";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(2500);
const state = () => p.evaluate(() => ({ cosmosTheme: document.querySelector("[data-cosmos-theme]")?.getAttribute("data-cosmos-theme") ?? null, worldCanvas: !!document.querySelector("[data-cosmos-theme] canvas, [data-cosmos-theme] [data-world]"), threadWorld: document.querySelector(".tw-host")?.getAttribute("data-world-active") || null }));
const out = { start: await state() };
await p.locator(".ccx-plus").click();
await p.waitForTimeout(500);
await p.locator(`[data-theme="${FAMILY}"]`).click();
await p.waitForTimeout(6000);
await p.locator(".ccx-plus").click();
await p.waitForTimeout(500);
out.themed = await state();
await p.screenshot({ path: `${OUT}/theme-1-cosmos-${FAMILY}.png` });
// The chat workspace takes the same theme.
await p.locator(".ccx-plus").click();
await p.waitForTimeout(400);
await p.locator('[data-open="workspace"]').click();
await p.waitForTimeout(6000);
out.workspace = await state();
await p.screenshot({ path: `${OUT}/theme-2-workspace-${FAMILY}.png` });
// Back to the primary Cosmos, by asking her (in the workspace chat).
const box = p.locator('[data-lelu-universe-window] textarea[aria-label^="Message"]').first();
await box.fill("go back to the primary cosmos");
await p.locator("button.lcu-send").first().click();
await p.waitForTimeout(6000);
out.back = await state();
await p.screenshot({ path: `${OUT}/theme-3-back-primary.png` });
console.log(JSON.stringify({ ...out, errors: errors.slice(0, 3) }, null, 1));
await b.close();
