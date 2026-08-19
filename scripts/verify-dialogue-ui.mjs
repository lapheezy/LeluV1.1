import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: "/home/daytona/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
});
const page = await browser.newPage();
const logs = [];
page.on("pageerror", (e) => logs.push({ type: "pageerror", message: e.message }));
page.on("console", (msg) => {
  if (msg.type() === "error") logs.push({ type: "console", message: msg.text() });
});

await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3000);

// 1. No visible chat container/frame/bubbles before interacting
const frameCount = await page.locator(".genesis-window-frame").count();
const visibleChatText = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("body *"));
  const visible = all.filter(
    (el) =>
      el.children.length === 0 &&
      el.textContent &&
      el.textContent.includes("Speak with Lélu") === false,
  );
  return visible
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
    })
    .map((el) => (el.textContent ?? "").trim().slice(0, 40))
    .filter((t) => /Start a conversation|Assistant status|Send pulse|Lélu interface|messages preserved/i.test(t))
    .slice(0, 5);
});

// 2. Click the Genesis Core (screen center of the canvas)
await page.mouse.click(innerWidth / 2, innerHeight / 2);
await page.waitForTimeout(700);

// 3. Invisible input focused?
const focusState = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return null;
  const style = getComputedStyle(el);
  return {
    tag: el.tagName,
    aria: el.getAttribute("aria-label"),
    opacity: style.opacity,
    width: el.offsetWidth,
    height: el.offsetHeight,
  };
});

// 4. Type a message and watch the live echo appear in the scene
await page.keyboard.type("hello lelu", { delay: 30 });
await page.waitForTimeout(400);
const echoText = await page.evaluate(() => {
  const layer = document.querySelector("[data-lelu-dialogue-scroll]");
  return layer ? layer.textContent : null;
});

// 5. Escape exits dialogue mode
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const dialogueActiveAfterEscape = await page.evaluate(
  () => document.querySelector("[data-lelu-dialogue-scroll]") !== null,
);

await page.screenshot({ path: "dialogue-verify.png", fullPage: true });

console.log("FRAME_COUNT", frameCount);
console.log("LEGACY_CHAT_TEXT", JSON.stringify(visibleChatText));
console.log("FOCUS_STATE", JSON.stringify(focusState));
console.log("ECHO_AFTER_TYPING", JSON.stringify(echoText));
console.log("DIALOGUE_ACTIVE_AFTER_ESCAPE", dialogueActiveAfterEscape);
console.log("LOGS", JSON.stringify(logs));

await browser.close();
