import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const BASE = "http://localhost:5173";
const results = [];
const check = (name, ok, note = "") => { results.push({ name, ok, note }); console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };

const viewports = [
  ["phone", { width: 390, height: 844 }, true],
  ["tablet", { width: 820, height: 1180 }, true],
  ["desktop", { width: 1440, height: 900 }, false],
];

console.log("\n=== CORE: every surface renders, at every size, with no Supabase ===");
for (const [vpName, viewport, isMobile] of viewports) {
  for (const [label, path] of [["v1.1","/"],["OG Core","/og/core"],["OG Chat","/og/chat"]]) {
    const page = await browser.newPage({ viewport, isMobile, hasTouch: isMobile });
    const fatal = [];
    page.on("pageerror", (e) => fatal.push(String(e.message).slice(0,100)));
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const kids = await page.$eval("#root", el => el.children.length).catch(() => 0);
    const hOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    check(`${label} renders @ ${vpName}`, kids > 0, kids === 0 ? "blank" : "");
    // Strict: an OG surface that bounced to Genesis would still have rendered
    // #root children, so "renders" alone was passing on the wrong page.
    if (path !== "/") {
      check(`${label} stays on its route @ ${vpName}`, page.url().includes(path), page.url());
    }
    check(`${label} no h-scroll @ ${vpName}`, !hOverflow);
    if (fatal.length) check(`${label} no fatal error @ ${vpName}`, false, fatal[0]);
    await page.close();
  }
}

console.log("\n=== INNER SKY: the OG page set, not just its shell ===");
{
  // The error boundary's own message must never count as "rendered": before
  // the QueryClientProvider was added, every OG page threw and the boundary's
  // text passed a naive length check.
  const BOUNDARY = "this interface did not open";
  for (const [label, path] of [
    ["Home", "/og/app"], ["Chats", "/og/app/chats"], ["Agents", "/og/app/agents"],
    ["Memories", "/og/app/memories"], ["Files", "/og/app/files"],
    ["Projects", "/og/app/universes"], ["Queue", "/og/app/queue"],
    ["Settings", "/og/app/settings"],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fatal = [];
    page.on("pageerror", (e) => fatal.push(String(e.message).slice(0, 70)));
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    const text = ((await page.textContent("body")) || "").replace(/\s+/g, " ").trim();
    check(`${label} renders real content`,
      text.length > 40 && !text.includes(BOUNDARY) && page.url().includes(path),
      text.includes(BOUNDARY) ? "ERROR BOUNDARY" : `${text.length} chars`);
    check(`${label} no unhandled error`, fatal.length === 0, fatal[0] || "");
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + "/og/app", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const hrefs = await page.$$eval("a", (as) => as.map((a) => a.getAttribute("href")));
  check("shell nav is /og-scoped", hrefs.some((h) => h && h.startsWith("/og/app/")), hrefs.slice(0, 5).join(" "));
  await page.close();
}

console.log("\n=== NAVIGATION: OG reachable from v1.1's own dock ===");
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const ogCore = await page.$('[aria-label="OG Core"]');
  const ogChat = await page.$('[aria-label="OG Chat"]');
  check("OG Core tab present in dock", !!ogCore);
  check("OG Chat tab present in dock", !!ogChat);
  if (ogCore) {
    await ogCore.click();
    await page.waitForTimeout(4000);
    check("dock tab navigates to OG Core", page.url().includes("/og/core"), page.url());
    // §18 — going back must return to Genesis without a reload
    await page.goBack(); await page.waitForTimeout(3000);
    const kids = await page.$eval("#root", el => el.children.length).catch(() => 0);
    check("back returns to v1.1 intact", kids > 0 && !page.url().includes("/og/"));
  }
  // touch targets
  for (const sel of ['[aria-label="OG Core"]','[aria-label="OG Chat"]']) {
    const box = await (await page.$(sel))?.boundingBox();
    if (box) check(`touch target >=40px (${sel.slice(13,-2)})`, box.width >= 40 && box.height >= 40, `${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  await page.close();
}

console.log("\n=== CHAT: live turn through the OG composer on v1.1's brain ===");
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(BASE + "/og/chat/matrix-thread", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const composer = await page.$("textarea, input[type=text]");
  check("OG composer present", !!composer);
  if (composer) {
    const before = ((await page.textContent("body")) || "").length;
    // Assert that a reply ARRIVED, not that LÉLU parroted a phrase — she is
    // conversational, and demanding a verbatim echo tests her compliance
    // rather than the runtime join.
    const probe = "Say hello in five words.";
    await composer.fill(probe);
    await page.keyboard.press("Enter");
    // The signal is text standing AFTER the echoed prompt, not body growth:
    // the empty-state line ("Speak. I'm listening from the horizon.") is
    // longer than a short reply, so a working turn can shrink the page.
    let answered = false, reply = "";
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1500);
      const t = ((await page.textContent("body")) || "").replace(/\s+/g, " ");
      if (!t.includes(probe)) continue;
      reply = t.split(probe).pop().replace(/send\s*$/i, "").trim();
      // "gathering light…" is the in-flight placeholder. Accepting it would
      // prove a request started, not that a turn completed.
      if (/gathering light|^\s*$/i.test(reply)) continue;
      if (reply.length > 5) { answered = true; break; }
    }
    check("OG chat receives a real answer", answered, `LÉLU: "${reply.slice(0, 60)}"`);
    // persistence across a reload, with no Supabase (local snapshot path)
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const after = ((await page.textContent("body")) || "");
    check("conversation survives reload without Supabase", after.includes("Say hello in five words"));
  }
  await page.close();
}

const pass = results.filter(r => r.ok).length;
console.log(`\n================  ${pass}/${results.length} PASSED  ================`);
for (const r of results.filter(r => !r.ok)) console.log(`  FAILED: ${r.name} ${r.note}`);
await browser.close();
