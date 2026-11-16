/**
 * Why is the sign-in gate's text invisible? Dumps the computed style chain of
 * the gate, its paragraph and its submit button, plus textContent vs innerText.
 *
 * Usage: node artifacts/mission-chat-universe-1/gate-style-probe.mjs [base]
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);

const info = await page.evaluate(() => {
  const gate = document.querySelector("[data-lelu-signin-gate]");
  if (!gate) return { gate: false };
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      color: cs.color,
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily.slice(0, 60),
      opacity: cs.opacity,
      visibility: cs.visibility,
      display: cs.display,
      filter: cs.filter,
      transform: cs.transform,
      textFill: cs.webkitTextFillColor,
      textShadow: cs.textShadow,
      background: cs.backgroundColor,
      zIndex: cs.zIndex,
      mixBlend: cs.mixBlendMode,
      isolation: cs.isolation,
      clipPath: cs.clipPath,
      maskImage: (cs.maskImage || "").slice(0, 60),
    };
  };
  const p = gate.querySelector("p");
  const btn = gate.querySelector('button[type="submit"]');
  const input = gate.querySelector('input[type="email"]');
  const chain = [];
  for (let el = gate; el && chain.length < 8; el = el.parentElement) {
    chain.push(pick(el));
  }
  return {
    gate: true,
    textContent: (gate.textContent || "").slice(0, 200),
    innerText: (gate.innerText || "").slice(0, 200),
    gateStyle: pick(gate),
    p: pick(p),
    pText: p?.textContent ?? null,
    button: pick(btn),
    buttonText: btn?.textContent ?? null,
    input: pick(input),
    ancestorChain: chain,
    fontsStatus: document.fonts?.status ?? null,
    rootOpacity: getComputedStyle(document.getElementById("root")).opacity,
  };
});

await page.screenshot({ path: join(SHOTS, "gate-style-390x844.png") });
writeFileSync(join(HERE, "gate-style-probe.json"), `${JSON.stringify(info, null, 2)}\n`);
console.log(JSON.stringify(info, null, 2));
await browser.close();
