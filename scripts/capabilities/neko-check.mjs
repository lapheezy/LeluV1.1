/** Log into the local Neko web client, take control, drive its Chromium to a URL, screenshot the live stream. */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const urls = process.argv.slice(2).length ? process.argv.slice(2) : ["https://www.google.com/"];
// Neko runs on this machine: no proxy for the test browser (a proxied browser can keep WebRTC from connecting).
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] })).newPage();
await p.goto(env.VITE_NEKO_URL ?? "http://127.0.0.1:8080", { waitUntil: "load" });
await p.waitForTimeout(2000);
const inputs = await p.locator("input").count();
console.log("login inputs:", inputs);
await p.locator('input[type="text"], input:not([type])').first().fill("lelu");
await p.locator('input[type="password"]').first().fill(env.NEKO_ADMIN_PASSWORD);
await p.keyboard.press("Enter");
await p.waitForTimeout(6000);
await p.screenshot({ path: "docs/missions/capabilities/shots/neko-0-connected.png" });
const video = await p.evaluate(() => { const v = document.querySelector("video"); return v ? { w: v.videoWidth, h: v.videoHeight, playing: !v.paused, ready: v.readyState } : null; });
console.log("video:", JSON.stringify(video));
// Take host control (admin) and drive the remote browser by keyboard: Ctrl+L, type the URL, Enter.
// Take control: the switch beside the keyboard icon in the bottom bar.
const sw = p.locator('input[type="checkbox"]:not([aria-label="Lock Controls"])').first();
const swBox = await sw.boundingBox().catch(() => null);
if (swBox && swBox.width > 2) await p.mouse.click(swBox.x + swBox.width / 2, swBox.y + swBox.height / 2);
else await p.mouse.click(545, 775);
await p.waitForTimeout(1500);
const box = await p.locator("video").boundingBox();
for (const [k, url] of urls.entries()) {
  if (box) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.keyboard.press("Control+l");
  await p.keyboard.type(url, { delay: 15 });
  await p.keyboard.press("Enter");
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `docs/missions/capabilities/shots/neko-${k + 1}.png` });
  console.log("shot", url);
}
await b.close();
