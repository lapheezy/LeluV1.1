/** Play a studio game for real: load it, hold the arrow keys, read the score, screenshot. node scripts/capabilities/play-game.mjs <project> */
import { launch } from "../evolution/harness.mjs";
const project = process.argv[2];
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 960, height: 640 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(`http://127.0.0.1:5173/.lelu-studio/${project}/index.html`, { waitUntil: "load" });
await p.waitForTimeout(1500);
const read = () => p.evaluate(() => ({ score: (document.querySelector("#score")?.textContent ?? "").trim(), canvas: !!document.querySelector("canvas"), body: document.body.innerText.slice(0, 160) }));
const s0 = await read();
await p.screenshot({ path: "docs/missions/capabilities/shots/game-0-start.png" });
const frames = [];
for (const [key, ms] of [["ArrowLeft", 1500], ["ArrowRight", 3000], ["ArrowLeft", 2500], ["ArrowRight", 2500]]) {
  await p.keyboard.down(key); await p.waitForTimeout(ms); await p.keyboard.up(key);
  frames.push(await p.screenshot());
}
await p.waitForTimeout(4000);
const s1 = await read();
await p.screenshot({ path: "docs/missions/capabilities/shots/game-1-after-play.png" });
const moved = await import("sharp").then(async ({ default: sharp }) => { const [a, c] = await Promise.all([frames[0], frames[1]].map((f) => sharp(f).resize(160, 100).raw().toBuffer())); let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]) > 40) n++; return n / (a.length / 3); });
console.log(JSON.stringify({ start: s0, after: s1, frameChange: +moved.toFixed(3), errors }, null, 1));
await b.close();
