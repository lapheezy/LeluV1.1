/**
 * Screenshot the running LÉLU app so the Cosmos can be inspected as it
 * actually renders: the preview hostname is DNS-mapped onto 127.0.0.1 so
 * the app sees the Host header it expects, and Chromium uses SwiftShader
 * so three.js can draw without a GPU.
 *
 *   PV_HOST=pv-....style.dev PV_SCHEME=https PV_PORT=3443 node artifacts/shoot-cosmos.mjs out.png
 */
import { chromium } from "playwright";

const HOST = process.env.PV_HOST;
const PORT = process.env.PV_PORT ?? "3002";
const SCHEME = process.env.PV_SCHEME ?? "http";
const OUT = process.argv[2] ?? "artifacts/cosmos.png";
if (!HOST) throw new Error("PV_HOST is required");

const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--ignore-certificate-errors",
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

const glbs = [];
const forgeCalls = [];
page.on("request", (r) => {
  const u = r.url();
  if (/\.glb(\?|$)/.test(u)) glbs.push(u);
  if (u.includes("/api/forge/")) forgeCalls.push(u.replace(/^https?:\/\/[^/]+/, ""));
});
page.on("response", async (r) => {
  if (/\.glb(\?|$)/.test(r.url()) || r.url().includes("/active")) {
    console.log("net", r.status(), r.url().replace(/^https?:\/\/[^/]+/, ""));
  }
  if (r.status() >= 400) console.log("net", r.status(), r.url().replace(/^https?:\/\/[^/]+/, ""));
});
page.on("console", (m) => {
  if (m.type() === "error") console.log("console.error:", m.text().slice(0, 220));
});
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 220)));

const res = await page.goto(`${SCHEME}://${HOST}:${PORT}/`, { waitUntil: "load", timeout: 90_000 });
console.log("HTTP", res?.status(), "| title:", await page.title());

// Let the canvas mount, the character GLB download and the first frames draw.
await page.waitForTimeout(Number(process.env.PV_WAIT ?? 20_000));
for (const label of [/enter/i, /begin/i, /start/i, /continue/i, /tap to/i]) {
  const button = page.getByRole("button", { name: label });
  if (await button.count()) {
    await button.first().click({ timeout: 5_000 }).catch(() => {});
    console.log("dismissed gate via", String(label));
    await page.waitForTimeout(Number(process.env.PV_AFTER ?? 15_000));
    break;
  }
}
// SwiftShader takes a long time to composite a 1400x900 three.js scene, so the
// default 30s capture budget is not enough; the render itself is fine.
await page.screenshot({ path: OUT, timeout: 180_000, animations: "disabled", caret: "hide" });

const canvases = await page.locator("canvas").count();
console.log("canvases:", canvases);
console.log("glb requests:", glbs.length);
for (const g of glbs.slice(0, 6)) console.log("  ", g.replace(/^https?:\/\/[^/]+/, ""));
console.log("forge calls:", forgeCalls.length);
for (const f of [...new Set(forgeCalls)].slice(0, 10)) console.log("  ", f);
const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
console.log("body:", text.slice(0, 500));
await browser.close();
console.log("wrote", OUT);
