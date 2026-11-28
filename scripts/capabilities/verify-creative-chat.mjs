/**
 * Her creative tools in a real conversation: generative art, a 3D scene, a
 * sketch (Excalidraw drawing), a diagram, and page captures of Google and
 * ChatGPT — each dispatched through ToolDispatcher with the conversation as
 * context, then the chat is screenshotted. Screens go to
 * docs/missions/capabilities/shots (no owner reference images in them).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { launch, track } from "../evolution/harness.mjs";
const OUT = "docs/missions/capabilities/shots";
await mkdir(OUT, { recursive: true });
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
track(p, errors);
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-lelu-home]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(2000);
const title = `Creative check ${Date.now() % 1e5}`;
const conv = await p.evaluate(async (t) => { localStorage.removeItem("lelu.worlds.v1"); const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); const c = MC.create(t); MC.addMessage(c.id, { id: `${c.id}-u`, role: "user", text: "Show me what you can make: art, 3D, a sketch, a diagram, and Google and ChatGPT.", timestamp: Date.now(), source: "local" }); return c.id; }, title);
await p.waitForTimeout(600);
await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await p.waitForSelector(`button[aria-label="Open ${title}"]`, { state: "attached" });
await p.evaluate((t) => document.querySelector(`button[aria-label="Open ${t}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true })), title);
await p.waitForTimeout(1500);
const calls = [
  ["creative.art", { style: "flow-field", seed: 11, title: "Copper rose flow" }],
  ["creative.scene3d", { preset: "runway", title: "Runway for the LÉLU look" }],
  ["studio.create", { kind: "drawing", title: "Croquis: oversized bomber", scene: { elements: [{ type: "rectangle", x: 60, y: 40, width: 220, height: 260 }, { type: "ellipse", x: 120, y: 0, width: 100, height: 60 }, { type: "line", x: 60, y: 300, points: [[0, 0], [-30, 240]] }, { type: "line", x: 280, y: 300, points: [[0, 0], [30, 240]] }, { type: "text", x: 70, y: 330, text: "wide cargo, stacked hem" }] } }],
  ["creative.diagram", { title: "Outfit build", source: "flowchart LR\n  A[Reference U-09] --> B[Patterns]\n  B --> C[Cutting layout]\n  C --> D[Sewing order]\n  D --> E[Fitting]" }],
  ["browser.capture", { url: "https://www.google.com/" }],
  ["browser.capture", { url: "https://chatgpt.com/" }],
];
const results = [];
for (const [name, args] of calls) {
  const r = await p.evaluate(async ([name, args, conv]) => {
    const D = await import("/src/core/tools/ToolDispatcher.ts");
    try { const r = await D.dispatchToolCall({ id: `cc-${name}-${Math.random()}`, name: D.toolNameForModel(name), arguments: args }, `cc-${Date.now()}`, { request: { conversationId: conv, timestamp: Date.now() } }); return { name, ok: r.ok, content: String(r.content).slice(0, 300) }; }
    catch (e) { return { name, ok: false, content: `threw: ${String(e).slice(0, 200)}` }; }
  }, [name, args, conv]);
  results.push(r);
  console.log(`${r.ok ? "✓" : "✗"} ${name} — ${r.content.replace(/\n/g, " ").slice(0, 200)}`);
  await p.waitForTimeout(1200);
}
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/01-chat-after-creative-tools.png` });
// Scroll the chat transcript to show every card.
for (let k = 0; k < 4; k++) {
  await p.evaluate((k) => { const el = document.querySelector("[data-lelu-universe-window] .lcu-thread, [data-lelu-universe-window] [data-lelu-transcript], .lcu-thread"); if (el) el.scrollTop = k * 700; }, k);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/02-chat-scroll-${k}.png` });
}
await writeFile("docs/missions/capabilities/creative-chat.json", JSON.stringify({ at: new Date().toISOString(), results, errors: errors.slice(0, 10) }, null, 1));
await b.close();
