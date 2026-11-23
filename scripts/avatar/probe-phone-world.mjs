/** M15.3 WP04: what is mounted when her world is entered at phone size (software renderer)? */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const vp = process.argv[2] === "desktop" ? { width: 1440, height: 900 } : { width: 393, height: 852 };
const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 1000, isMobile: vp.width < 1000 });
const p = await ctx.newPage();
const logs = [];
p.on("console", (m) => { if (/scene|Scene|world|World|profile|light/.test(m.text())) logs.push(m.text().slice(0, 160)); });
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) {
  const c = p.getByRole("button", { name: "Continue without an account" });
  if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true });
  if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true").catch(() => false)) break;
  await p.waitForTimeout(500);
}
await p.locator('.lsn-item[aria-label="Worlds"]').click();
await p.waitForTimeout(600);
await p.locator('[data-world="genesisv2"]').click();
await p.waitForTimeout(15000);
console.log(JSON.stringify(await p.evaluate(() => ({
  workspaces: [...document.querySelectorAll("[data-workspace]")].map((e) => `${e.getAttribute("data-workspace")} profile=${e.getAttribute("data-render-profile")}`),
  canvases: [...document.querySelectorAll("canvas")].map((c) => `${c.width}x${c.height} ${c.closest("[data-workspace],[data-testid]")?.getAttribute("data-workspace") ?? c.closest("[data-testid]")?.getAttribute("data-testid")}`),
  surface: document.body.dataset.surface ?? null,
  companion: document.querySelector('[data-testid="lelu-companion"]')?.dataset.context,
  fallback: Boolean(document.querySelector('[data-testid="scene-loading-fallback"]')),
  text: document.body.innerText.slice(0, 300),
  // Read-only: the Genesis provider's state, found through React's fiber tree.
  genesis: (() => {
    const root = document.querySelector("[data-workspace]") ?? document.body.firstElementChild;
    const key = root && Object.keys(root).find((k) => k.startsWith("__reactFiber$"));
    for (let f = key ? root[key] : null; f; f = f.return) {
      const v = f.memoizedProps?.value;
      if (v && v.state && "activePanel" in v.state) return { activePanel: v.state.activePanel, activeScene: v.state.activeScene, minimized: v.state.minimized, modules: Object.fromEntries(Object.entries(v.state.modules).map(([k, m]) => [k, m.presentation])) };
    }
    return null;
  })(),
})), null, 1));
console.log(logs.slice(-15).join("\n"));
await p.screenshot({ path: `docs/missions/m15-home/avatar-15.3/wp04/phone-world-${vp.width}.png` });
await b.close();
