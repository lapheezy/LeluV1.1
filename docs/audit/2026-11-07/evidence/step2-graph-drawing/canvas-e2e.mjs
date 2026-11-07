import { chromium } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const [W, H, OUT] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const touch = W < 800;
mkdirSync(OUT, { recursive: true });
const checks = []; const rec = (n, ok, d = "") => { checks.push({ n, ok: !!ok, d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
const cdp = await ctx.newCDPSession(page);
const shot = (n) => page.screenshot({ path: `${OUT}/${W}x${H}-${n}.png` });
const sleep = (ms) => page.waitForTimeout(ms);
/** A real drag: mouse on desktop, CDP touch events on phones. */
async function drag(x1, y1, x2, y2, steps = 12) {
  if (!touch) { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.mouse.up(); return; }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] }); await sleep(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function tap(loc, yFrac = 0.5) { const b = await loc.boundingBox(); if (!b) throw new Error("no box"); const x = b.x + b.width / 2, y = b.y + Math.max(3, b.height * yFrac); if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }
const studio = () => page.evaluate(async () => { const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance(); return S.list().filter((a) => a.kind === "graph" || a.kind === "drawing").map((a) => { const s = a.revisions.at(-1).spec; return { id: a.id, kind: a.kind, revs: a.revisions.length, nodes: s.nodes?.length, edges: s.edges?.length, elements: s.scene?.elements?.length, first: s.nodes?.[0] && [s.nodes[0].id, s.nodes[0].x, s.nodes[0].y] }; }); });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const gate = async () => {
  const b = await page.getByText("Continue without an account").first().boundingBox();
  const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}${e.getAttribute("data-spatial-groups") !== null ? "[data-spatial-groups]" : ""}.${String(e.className).slice(0, 40)} “${(e.textContent ?? "").trim().slice(0, 30)}”` : null; }, [b.x + b.width / 2, b.y + b.height / 2]);
  console.log("FINDING element under the centre of 'Continue without an account':", hit);
  // The gate is not under test: dismiss it directly (the overlap above is recorded as a finding).
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account")?.click());
};
async function openLibrary() {
  // Home → App Library → Documents. The App Library sheet is drawn but does
  // not receive pointer input in this build (hit-testing reaches the Home
  // section beneath it — recorded as a finding), so these two NAVIGATION
  // clicks run the tiles' own handlers. All canvas interaction is real input.
  await page.evaluate(() => [...document.querySelectorAll("*")].find((e) => e.textContent.trim() === "App Library" && e.children.length === 0)?.closest("button, a, [role=button], section")?.click());
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Docs, decks and spreadsheets")).at(-1)?.click());
  await sleep(2500);
}
try {
  await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { await sleep(1500); if (await page.getByText("Continue without an account").count()) break; }
  await gate(); await sleep(5000);
  await openLibrary();
  rec("the Creation Studio library opens from App Library → Documents", await page.locator("[data-lelu-studio-library]").count());
  const reqs = []; page.on("request", (r) => { if (/GraphEditor|DrawingEditor|xyflow|excalidraw/i.test(r.url())) reqs.push(r.url().split("/").pop().split("?")[0]); });
  rec("neither editor was loaded before one is opened", reqs.length === 0 && !(await page.evaluate(() => performance.getEntriesByType("resource").some((e) => /GraphEditor|DrawingEditor|@xyflow|@excalidraw/.test(e.name)))));
  await shot("01-library");

  // ---- React Flow: the real agent hierarchy, moved and connected by hand.
  await tap(page.locator("[data-lelu-studio-new=hierarchy]"));
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0, null, { timeout: 30000 }); await sleep(2000);
  // The spatial navigator panel opens over the workspace; a person collapses it with the LÉLU pill.
  if (await page.locator("[data-spatial-groups]").count()) { await tap(page.locator("[data-spatial-control=expand]").first()); await sleep(800); }
  await tap(page.locator(".react-flow__controls-fitview").first()); await sleep(800);
  rec("only the graph editor's code loaded for a graph", reqs.some((u) => /GraphEditor|xyflow/i.test(u)) && !reqs.some((u) => /DrawingEditor|excalidraw/i.test(u)), reqs.slice(0, 4).join(", "));
  const before = (await studio()).find((a) => a.kind === "graph");
  rec("the hierarchy graph is built from LÉLU's agents", before && before.nodes >= 8, JSON.stringify(before));
  await shot("02-graph-open");
  const node = page.locator(".react-flow__node").filter({ hasText: "SHAMAN" }).first();
  const nb = await node.boundingBox();
  await drag(nb.x + nb.width / 2, nb.y + nb.height / 2, nb.x + nb.width / 2 + 90, nb.y + nb.height / 2 + 40);
  await sleep(1500);
  const moved = (await studio()).find((a) => a.id === before.id);
  const shaman = await page.evaluate(async (id) => (await import("/src/core/studio/StudioStore.ts")).default.getInstance().get(id).revisions.at(-1).spec.nodes.find((n) => n.id === "shaman"), before.id);
  rec("dragging a node moves it and saves the position", shaman && (shaman.x !== 0 || shaman.y !== 140), JSON.stringify(shaman));
  // Connect: from LÉLU Core's source handle to an agent/executive node's target handle.
  const src = page.locator(".react-flow__node").filter({ hasText: "LÉLU Core" }).locator(".react-flow__handle.source").first();
  const dst = page.locator(".react-flow__node").filter({ hasText: /^Forge$/ }).locator(".react-flow__handle.target").first();
  const sb = await src.boundingBox(), db = await dst.boundingBox();
  if (sb && db) await drag(sb.x + sb.width / 2, sb.y + sb.height / 2, db.x + db.width / 2, db.y + db.height / 2, 20);
  await sleep(1500);
  const connected = (await studio()).find((a) => a.id === before.id);
  rec("connecting two nodes adds an edge and saves it", connected.edges === before.edges + 1, `${before.edges} → ${connected.edges}`);
  await shot("03-graph-moved-connected");
  rec("no horizontal overflow (graph)", (await overflow()) <= 0, `${await overflow()}px`);

  // Close within the save delay: the pending save must not be lost.
  await tap(page.locator("[data-lelu-graph-add]")); await sleep(100);
  const closeBtn = page.locator("[data-lelu-graph-editor]").locator("xpath=ancestor::*[@data-lelu-module-window][1]").locator("button[aria-label^='Close']").first();
  await tap(closeBtn); await sleep(1200);
  const afterClose = (await studio()).find((a) => a.id === before.id);
  rec("a node added just before closing is saved", afterClose.nodes === connected.nodes + 1, `${connected.nodes} → ${afterClose.nodes}`);

  // ---- Excalidraw: a drawing made with the rectangle tool.
  if (!(await page.locator("[data-lelu-studio-library]").count())) await openLibrary();
  await tap(page.locator("[data-lelu-studio-new=drawing]"));
  await page.waitForFunction(() => document.querySelectorAll(".excalidraw canvas").length > 0, null, { timeout: 60000 }); await sleep(2500);
  rec("the drawing editor's code loaded only when a drawing was opened", reqs.some((u) => /DrawingEditor|excalidraw/i.test(u)));
  await shot("04-drawing-open");
  const rectTool = page.locator("[data-testid='toolbar-rectangle']").first();
  if (await rectTool.count()) await tap(rectTool); else await page.keyboard.press("r");
  const cv = await page.locator(".excalidraw .excalidraw__canvas.interactive, .excalidraw canvas").last().boundingBox();
  await drag(cv.x + cv.width * 0.25, cv.y + cv.height * 0.3, cv.x + cv.width * 0.6, cv.y + cv.height * 0.55, 16);
  await sleep(2000);
  const drawing = (await studio()).find((a) => a.kind === "drawing");
  rec("drawing a rectangle creates an element and saves it", drawing && drawing.elements >= 1, JSON.stringify(drawing));
  await shot("05-drawing-rectangle");
  rec("no horizontal overflow (drawing)", (await overflow()) <= 0, `${await overflow()}px`);
  const chatReachable = await page.evaluate(() => [...document.querySelectorAll("button, [role=button]")].some((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && /chat/i.test((b.getAttribute("aria-label") ?? "") + b.textContent); }));
  rec("chat stays reachable while drawing", chatReachable);

  // ---- Switch back to the graph: nothing lost.
  const closeD = page.locator("[data-lelu-drawing-editor]").locator("xpath=ancestor::*[@data-lelu-module-window][1]").locator("button[aria-label^='Close']").first();
  await tap(closeD); await sleep(1200);
  if (!(await page.locator("[data-lelu-studio-library]").count())) await openLibrary();
  await tap(page.locator(`[data-lelu-studio-card='${before.id}']`)); await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0); await sleep(1500);
  const back = await page.locator(".react-flow__edge").count();
  rec("switching back to the graph keeps its edits", back === afterClose.edges, `${back} edges drawn, ${afterClose.edges} stored`);
  await shot("06-switched-back-to-graph");

  // ---- Reload: both survive.
  await page.reload({ waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { await sleep(1500); if (await page.getByText("Continue without an account").count()) break; }
  if (await page.getByText("Continue without an account").count()) { await gate(); await sleep(4000); }
  const survived = await studio();
  rec("after reload the graph and drawing are still there, as saved", survived.some((a) => a.id === before.id && a.edges === afterClose.edges && a.nodes === afterClose.nodes) && survived.some((a) => a.kind === "drawing" && a.elements >= 1), JSON.stringify(survived.map((a) => [a.kind, a.nodes ?? a.elements, a.revs])));
  await openLibrary();
  const did = survived.find((a) => a.kind === "drawing").id;
  await tap(page.locator(`[data-lelu-studio-card='${did}']`)); await page.waitForFunction(() => document.querySelectorAll(".excalidraw canvas").length > 0, null, { timeout: 60000 }); await sleep(3000);
  await shot("07-drawing-after-reload");
  rec("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) { rec("run completed", false, String(e).slice(0, 240)); await shot("99-failure").catch(() => {}); }
writeFileSync(`${OUT}/${W}x${H}-report.json`, JSON.stringify({ viewport: [W, H], touch, checks }, null, 1));
console.log(JSON.stringify({ checks: checks.length, failed: checks.filter((c) => !c.ok).length }));
await browser.close();
