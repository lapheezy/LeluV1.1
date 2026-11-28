/** Opens Notifications after a reload and lists what it proposes. node scripts/landing/notifications.mjs */
import { chromium } from "playwright";
const OUT = "docs/missions/wp21_4/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
// Seed the stale proposal a page loaded before the fix would have kept, then reload: startup must close it.
await p.evaluate(async () => { const Q = (await import("/src/core/selfdev/ImprovementQueue.ts")).default.getInstance(); const R = (await import("/src/core/selfdev/CapabilityRegistry.ts")).default.getInstance(); const a = R.list().find((c) => c.name === "Avatar identity"); if (!Q.list().some((x) => x.title === "Complete capability: Avatar identity" && x.status === "Proposed")) Q.add({ title: "Complete capability: Avatar identity", kind: "Limitation", problem: "Capability “Avatar identity” is partial: 2D config only — no animation or embodied avatar yet.", observation: "Capability registry scan.", evidence: "CapabilityRegistry.byStatus(partial)", proposedSolution: "x", expectedBenefit: "x", dependencies: [], risk: "x", requiredTools: [], requiredAgents: [], complexity: "medium", capabilityId: a.id, version: "1.0", testPlan: "x" }); });
await p.reload({ waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(3000);
const state = await p.evaluate(async () => { const Q = (await import("/src/core/selfdev/ImprovementQueue.ts")).default.getInstance(); return Q.list().filter((x) => /^Complete capability/.test(x.title)).map((x) => `${x.status}: ${x.title}${x.superseded ? " (" + x.superseded.reason + ")" : ""}`); });
await p.evaluate(() => window.dispatchEvent(new CustomEvent("genesis-show-surface", { detail: { panel: "notifications" } })));
await p.evaluate(async () => { const el = [...document.querySelectorAll("button")].find((b) => /^Notifications/.test(b.getAttribute("aria-label") || "")); el?.click(); });
await p.waitForTimeout(3000);
await p.screenshot({ path: `${OUT}/notifications-corrected.png` });
console.log(JSON.stringify(state, null, 1));
await b.close();
