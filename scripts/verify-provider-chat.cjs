/**
 * MASTER INTEGRATION — normal provider-based chat still works on the merged
 * tree (free-tier providers only; Anthropic not configured). Two turns typed
 * into Chat Universe; records which provider answered and what the server's
 * spend policy decided. Nothing here bypasses the policy.
 *   LELU_BASE=http://127.0.0.1:5174/ node scripts/verify-provider-chat.cjs <outDir>
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const OUT = path.resolve(process.argv[2] ?? "docs/acceptance/master-integration");
fs.mkdirSync(path.join(OUT, "screenshots"), { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const calls = [];
  ctx.on("response", (r) => { const u = r.url(); if (/\/api\/model\/(groq|openrouter|cerebras|anthropic|mistral|fireworks|gemini|githubModels)/.test(u) && r.request().method() === "POST") calls.push(`${u.split("/api/model/")[1].split(/[/?]/)[0]} ${r.status()}`); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) { await page.waitForTimeout(500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  const c = await page.evaluate(() => { const b = document.querySelector('[data-spatial-control="chat"]'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(2500);
  for (const [id, text, expectTool] of [["p1-chat", "In one short sentence, what is a coral reef?", null], ["p2-creative", "Make me a generative artwork of ocean currents in ocean colours", "visual"]]) {
    const p = await page.evaluate(() => { const vis = (e) => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 40 && (h === e || e.contains(h)); }; const el = [...document.querySelectorAll(".lcu-win-composer textarea")].find(vis) ?? [...document.querySelectorAll(".lcu-input textarea")].find(vis); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const before = calls.length;
    await page.mouse.click(p.x, p.y); await page.keyboard.type(text); await page.keyboard.press("Enter");
    let r = null; const t0 = Date.now();
    while (!r && Date.now() - t0 < 180000) {
      await page.waitForTimeout(1500);
      r = await page.evaluate(async (text) => { const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); const conv = M.listAll().find((x) => x.messages.some((m) => m.role === "user" && m.text.trim() === text)); if (!conv) return null; const at = conv.messages.map((m) => m.role === "user" && m.text.trim() === text).lastIndexOf(true); const a = conv.messages.slice(at + 1).find((m) => m.role === "assistant" && m.text.trim()); return a && a.activity?.status !== "running" ? { text: a.text, provider: a.provider ?? a.meta?.provider ?? null, artifacts: (a.activity?.artifacts ?? []).map((x) => x.kind) } : null; }, text);
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, "screenshots", `provider-${id}.png`) });
    const used = calls.slice(before);
    check(`${id}: “${text}”`, r && (expectTool ? r.artifacts.includes(expectTool) : used.some((u) => / 200$/.test(u)) && !/No model provider is reachable|offline/i.test(r.text)), `${Math.round((Date.now() - t0) / 1000)} s · provider ${r?.provider} · model requests [${used.join(", ")}] · artifacts [${r?.artifacts ?? []}] · ${(r?.text ?? "no reply").split("\n")[0].slice(0, 160)}`);
  }
  check("no request to Anthropic", !calls.some((c) => c.startsWith("anthropic")), calls.join(", "));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  fs.writeFileSync(path.join(OUT, "provider-run.json"), JSON.stringify({ at: new Date().toISOString(), calls, errors, results }, null, 2));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
