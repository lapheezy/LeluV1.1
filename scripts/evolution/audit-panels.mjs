/** Opens each app alone and measures content that reaches past its window (clipping). */
import { launch, desktop, iphone, boot, shot, track } from "./harness.mjs";
const PANELS = ["projects", "eng-studio", "voice-studio", "security-center", "infra-monitor", "settings", "agents", "memory", "visualstudio", "creation"];
const tag = process.argv[2] ?? "audit";
const browser = await launch();
const errors = [];
const report = {};
for (const [label, mk] of [["iphone", () => iphone(browser)], ["desktop", () => desktop(browser)]]) {
  const ctx = await mk(); const page = await ctx.newPage(); track(page, errors);
  await boot(page);
  for (const id of PANELS) {
    await page.evaluate(async (t) => {
      const Bus = (await import("/src/core/cognition/UIActionBus.ts")).default.getInstance();
      for (const m of ["projects","eng-studio","voice-studio","security-center","infra-monitor","settings","agents","memory","visualstudio","creation"]) Bus.dispatch({ type: "close_module", target: m, reason: "audit", initiatedBy: "user" });
      return Bus.dispatch({ type: "open_module", target: t, reason: "audit", initiatedBy: "user" });
    }, id);
    await page.waitForTimeout(2200);
    const m = await page.evaluate((id) => {
      const content = document.querySelector(`[data-lelu-module-content="${id}"]`);
      if (!content || content.offsetParent === null) return { shown: false };
      const box = content.getBoundingClientRect();
      let worst = 0; const offenders = [];
      for (const el of content.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const over = Math.round(r.right - box.right);
        if (over > 2) { worst = Math.max(worst, over); if (offenders.length < 3) offenders.push(`${el.tagName.toLowerCase()}.${(el.className && typeof el.className === "string" ? el.className.split(" ")[0] : "")} +${over}`); }
      }
      return { shown: true, width: Math.round(box.width), overflowPx: worst, offenders };
    }, id);
    report[`${label}:${id}`] = m;
    await shot(page, `${tag}-${label}-${id}`);
  }
  await ctx.close();
}
console.log(JSON.stringify(report, null, 0).replace(/\},"/g, '},\n"'));
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 5));
await browser.close();
