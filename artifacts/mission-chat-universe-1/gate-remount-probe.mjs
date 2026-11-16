/**
 * Is the sign-in gate stable while a person types into it?
 *
 * Marks the live input node, waits, and sees whether the SAME node is still
 * there (React kept it) or a new one replaced it (a remount wiped the value).
 * Also reports whether any page text is laid out at all.
 *
 * Usage: node artifacts/mission-chat-universe-1/gate-remount-probe.mjs [base]
 */

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const probe = await page.evaluate(async () => {
  const gate = document.querySelector("[data-lelu-signin-gate]");
  if (!gate) return { gate: false };
  const input = gate.querySelector('input[type="email"]');
  input.__mark = "kept";
  input.focus();
  const before = document.activeElement === input;
  input.value = "typed-by-test";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  const again = document.querySelector("[data-lelu-signin-gate] input[type=email]");
  const anyText = [...document.querySelectorAll("body *")]
    .filter((el) => el.children.length === 0 && (el.textContent || "").trim().length > 3)
    .slice(0, 5)
    .map((el) => ({ tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 40), rendered: el.getClientRects().length > 0 }));
  return {
    gate: true,
    sameNode: again === input,
    markSurvived: again?.__mark === "kept",
    valueAfter: again?.value ?? null,
    focusKept: document.activeElement === again,
    focusBefore: before,
    sampleText: anyText,
    gateInnerText: (document.querySelector("[data-lelu-signin-gate]")?.innerText || "").slice(0, 80),
  };
});

writeFileSync(join(HERE, "gate-remount-probe.json"), `${JSON.stringify(probe, null, 2)}\n`);
console.log(JSON.stringify(probe, null, 2));
await browser.close();
