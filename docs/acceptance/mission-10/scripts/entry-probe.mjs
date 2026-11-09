import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:3013";
const profile = "docs/acceptance/mission-7-2/.profile/state.json";
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext(fs.existsSync(profile) ? { storageState: profile } : {});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);

const cosmos = page.locator("button.lch-cosmos").first();
if (await cosmos.count().catch(() => 0)) { await cosmos.click().catch(() => {}); await page.waitForTimeout(1500); }

const convo = page.locator('button:has-text("Conversation")').first();
if (await convo.count().catch(() => 0)) { await convo.click().catch(() => {}); await page.waitForTimeout(3000); }

const report = await page.evaluate(() => ({
  textareas: [...document.querySelectorAll("textarea")].map((el) => ({
    placeholder: el.getAttribute("placeholder"),
    visible: !!(el.offsetWidth || el.offsetHeight),
    disabled: el.disabled,
  })),
  editables: [...document.querySelectorAll('[contenteditable="true"]')].map((el) => ({
    cls: el.className?.toString().slice(0, 60),
    visible: !!(el.offsetWidth || el.offsetHeight),
  })),
  inputs: [...document.querySelectorAll("input")].map((el) => el.getAttribute("placeholder")).filter(Boolean).slice(0, 10),
  buttons: [...document.querySelectorAll("button")].map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 28)).filter(Boolean).slice(0, 45),
  gate: !!document.querySelector("[data-lelu-signin-gate]"),
}));
console.log(JSON.stringify(report, null, 1));
fs.writeFileSync("docs/acceptance/mission-10/entry-probe.json", JSON.stringify(report, null, 2));
await page.screenshot({ path: "docs/acceptance/mission-10/shots/entry-probe.png" });
await browser.close();
