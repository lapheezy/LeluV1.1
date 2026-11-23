/**
 * M16.3 WP06 — reproduce the skeleton chat state with real instrumentation.
 *
 * Reads the chat's own DOM (message rows and their text), console and page
 * errors, and every failed or 4xx/5xx network response, so the cause is
 * observed rather than guessed from a screenshot.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "artifacts/m16-3/wp06";
mkdirSync(OUT, { recursive: true });
const ORIGIN = process.env.LELU_ORIGIN ?? "http://127.0.0.1:3003";
const SAID = process.env.LELU_SAY ?? "build a chair";

const report = { origin: ORIGIN, said: SAID, console: [], errors: [], network: [], chat: null };
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (message) => {
  const text = message.text();
  if (/error|fail|warn|router|direct|tool|provider/i.test(text)) report.console.push(`${message.type()}: ${text.slice(0, 300)}`);
});
page.on("pageerror", (error) => report.errors.push(String(error).slice(0, 500)));
page.on("response", async (response) => {
  if (response.status() >= 400) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 300);
    } catch {
      /* body not readable */
    }
    report.network.push({ status: response.status(), url: response.url().slice(0, 160), body });
  }
});
page.on("requestfailed", (request) => report.network.push({ failed: request.failure()?.errorText, url: request.url().slice(0, 160) }));

const composer = () => page.locator('textarea[placeholder^="Message LÉLU"]').first();

try {
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const openers = ['button:has-text("Continue without an account")', 'button[aria-label*="Summon the chat" i]', 'button[aria-label*="open chat" i]', 'button:text-is("Chat")', 'button:has-text("Chat")'];
  for (let attempt = 0; attempt < 12 && !(await composer().count()); attempt += 1) {
    for (const selector of openers) {
      const element = page.locator(selector).first();
      if (!(await element.count().catch(() => 0))) continue;
      await element.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1500);
      if (await composer().count()) break;
    }
    if (!(await composer().count())) await page.waitForTimeout(1000);
  }
  report.composerFound = await composer().count() > 0;

  const before = Date.now();
  await composer().focus();
  // One insertion event, not per-key: a controlled textarea can drop characters
  // typed fast, and a dropped character changes the sentence that is compiled.
  await page.keyboard.insertText(SAID);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);

  /* What the chat window actually holds, row by row. */
  report.chat = await page.evaluate(() => {
    const window = document.querySelector('[data-lelu-window^="chat:"]');
    if (!window) return { found: false };
    const rows = [...window.querySelectorAll("*")]
      .filter((element) => element.children.length === 0)
      .slice(0, 40)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        cls: (element.className ?? "").toString().slice(0, 80),
        text: (element.textContent ?? "").slice(0, 160),
        color: getComputedStyle(element).color,
        opacity: getComputedStyle(element).opacity,
      }));
    const pulsing = window.querySelectorAll('[class*="pulse"], [class*="skeleton"], [class*="animate"]').length;
    return {
      found: true,
      windowText: (window.textContent ?? "").slice(0, 1200),
      rows,
      pulsing,
      bubbles: window.querySelectorAll('[class*="rounded"]').length,
      html: window.innerHTML.length,
      htmlHead: window.innerHTML.slice(0, 2500),
    };
  });

  report.firstPaintMs = Date.now() - before;
  await page.waitForTimeout(9000);
  report.chatAfter = await page.evaluate(() => {
    const window = document.querySelector('[data-lelu-window^="chat:"]');
    return window ? { windowText: (window.textContent ?? "").slice(0, 1200) } : null;
  });
  await page.screenshot({ path: `${OUT}/probe-chat.png` });

  /* The provider path, if it ran at all. */
  report.providerCalls = report.console.filter((line) => /ProviderResolver|OpenRouter|429|Groq|GitHub Models/i.test(line)).slice(-8);
} catch (error) {
  report.fatal = error instanceof Error ? error.message : String(error);
} finally {
  writeFileSync(`${OUT}/probe-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2).slice(0, 4000));
