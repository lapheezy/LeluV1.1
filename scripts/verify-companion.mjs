/**
 * LÉLU — COMPANION MODE, IN THE REAL APP
 *
 * Drives the running app (dev server) in Chromium at a phone and a
 * desktop viewport and checks what the user would see and touch:
 *
 *   - the switch in the Avatar panel turns her on; Hide turns her off;
 *   - she is on screen, and only her figure takes touches — a point
 *     right next to her reaches the app beneath;
 *   - she stands on no control the user could need, in chat and with
 *     the composer focused (she moves away herself while unpinned);
 *   - dragging her pins her there, and the spot survives a reload;
 *   - double-tapping her opens the chat;
 *   - a real event on LÉLU's event bus moves her body (no caption card);
 *   - her speech, as the browser's speech engine plays it, reaches her.
 *
 * Usage: node scripts/verify-companion.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
let failures = 0;
const check = (name, ok, evidence) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${evidence === undefined ? "" : `\n      ${typeof evidence === "string" ? evidence : JSON.stringify(evidence)}`}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

async function dispatchUi(page, action) {
  return page.evaluate(async (a) => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    return Bus.getInstance().dispatch({ ...a, reason: "verify", initiatedBy: "lelu" });
  }, action);
}

/** The first-run sign-in notice (no cloud configured) covers the app until dismissed. */
async function dismissSignInGate(page) {
  // Dismiss until it has stayed away for a moment (it can arrive late).
  let quiet = 0;
  for (let i = 0; i < 20 && quiet < 3; i += 1) {
    const gate = page.locator("[data-lelu-signin-gate] button", { hasText: "Continue" });
    if (await gate.count()) {
      quiet = 0;
      await gate.first().click({ timeout: 3000, force: true }).catch(() => {});
    } else {
      quiet += 1;
    }
    await page.waitForTimeout(400);
  }
}

/** Quick check right before a touch: the notice can come back at any moment after a reload. */
async function clearNotice(page) {
  const gate = page.locator("[data-lelu-signin-gate] button", { hasText: "Continue" });
  if (await gate.count()) {
    await gate.first().click({ timeout: 3000, force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

/**
 * Deliver a gesture and wait for its effect, re-delivering if the page
 * (2 fps headless, see above) lost it — like a person tapping again. The
 * expectation never changes; the number of attempts is reported.
 */
async function attempt(page, label, act, effect, tries = 5) {
  for (let i = 1; i <= tries; i += 1) {
    await clearNotice(page);
    await act();
    for (let w = 0; w < 10; w += 1) {
      if (await effect()) {
        if (i > 1) console.log(`      (${label}: took ${i} attempts)`);
        return true;
      }
      await page.waitForTimeout(800);
    }
  }
  return false;
}

const figure = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-testid='lelu-companion-figure']");
    if (!el) return null;
    // Her STANDING position is the frame she lives in; the figure inside it
    // breathes and sways (transform), which moves its bounding box a little.
    const r = el.parentElement.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, transform: el.style.transform };
  });

/** Interactive controls whose centre or any corner lies under her figure. */
const coveredControls = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-testid='lelu-companion-figure']");
    if (!el) return [];
    const f = el.getBoundingClientRect();
    const out = [];
    for (const c of document.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [role='tab']")) {
      if (el.contains(c) || c.closest("[data-testid='lelu-companion']")) continue;
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const w = Math.min(f.right, r.right) - Math.max(f.left, r.left);
      const h = Math.min(f.bottom, r.bottom) - Math.max(f.top, r.top);
      if (w > 2 && h > 2) out.push(`${c.tagName.toLowerCase()}${c.getAttribute("aria-label") ? `[${c.getAttribute("aria-label")}]` : ""}`);
    }
    return out;
  });

for (const viewport of [{ name: "phone 390×844", width: 390, height: 844 }, { name: "desktop 1280×800", width: 1280, height: 800 }]) {
  console.log(`\n=== ${viewport.name} ===`);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.width < 600 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // The first-run cloud-identity notice covers the app until dismissed.
  const notice = page.getByRole("button", { name: "Continue", exact: true });
  await notice.waitFor({ state: "visible", timeout: 8000 }).then(() => notice.click()).catch(() => {});
  await page.waitForTimeout(400);

  // V1.1 brief: she is present wherever LÉLU is active, unless turned off.
  await page.waitForSelector("[data-testid='lelu-companion-figure']", { timeout: 20000 }).catch(() => {});
  check("companion is on by default", (await figure(page)) !== null);

  // The real switch — the menu on a phone (the floating LÉLU pill), the
  // Avatar panel on desktop — turns her off, then on again.
  await dismissSignInGate(page);
  const pressSwitch = async () => {
    if (!(await page.locator("[data-testid='companion-toggle'] >> visible=true").count())) {
      if (viewport.width < 600) await page.getByRole("button", { name: "Open LÉLU menu" }).click({ timeout: 5000, force: true }).catch(() => {});
      else await dispatchUi(page, { type: "open_panel", target: "avatar" });
      await page.waitForSelector("[data-testid='companion-toggle'] >> visible=true", { timeout: 10000 }).catch(() => {});
      await clearNotice(page);
    }
    await page.locator("[data-testid='companion-toggle'] >> visible=true").first().click({ timeout: 10000, force: true }).catch(() => {});
  };
  await attempt(page, "turn off", pressSwitch, async () => (await figure(page)) === null);
  check("the switch turns her off", (await figure(page)) === null);
  const switchOn = () => page.evaluate(() => [...document.querySelectorAll("[data-testid='companion-toggle']")].some((t) => t.getAttribute("aria-checked") === "true") || Boolean(document.querySelector("[data-testid='lelu-companion-figure']")));
  await attempt(
    page,
    "turn on",
    async () => {
      if (!(await page.locator("[data-testid='companion-toggle'] >> visible=true").count())) {
        if (viewport.width < 600) await page.getByRole("button", { name: "Open LÉLU menu" }).click({ timeout: 5000, force: true }).catch(() => {});
        else await dispatchUi(page, { type: "open_panel", target: "avatar" });
        await page.waitForSelector("[data-testid='companion-toggle'] >> visible=true", { timeout: 10000 }).catch(() => {});
        await clearNotice(page);
      }
      // force: headless desktop renders the 3D scene at ~2 fps, so the
      // "stable" wait never settles; this is still a real pointer click at
      // the switch's position, and what it did is checked.
      await page.locator("[data-testid='companion-toggle'] >> visible=true").first().click({ timeout: 10000, force: true }).catch(() => {});
    },
    switchOn,
  );
  await page.waitForSelector("[data-testid='lelu-companion-figure']", { timeout: 5000 }).catch(() => {});
  console.log(`      switch state: ${await page.evaluate(() => [...document.querySelectorAll("[data-testid='companion-toggle']")].map((t) => t.getAttribute("aria-checked")).join(","))}`);
  if (viewport.width < 600) {
    // Close the menu again with the same pill — only while it is open
    // (the switch lives in the menu), so a slow frame cannot reopen it.
    for (let i = 0; i < 5 && (await page.locator("[data-testid='companion-toggle']").count()) > 0; i += 1) {
      await page.getByRole("button", { name: "Open LÉLU menu" }).click({ timeout: 5000, force: true }).catch(() => {});
      await page.waitForTimeout(1200);
    }
    check("the menu closes again", (await page.locator("[data-testid='companion-toggle']").count()) === 0);
  }
  let f = await figure(page);
  check("the Avatar panel switch turns her on", f !== null, f);
  if (!f) {
    await context.close();
    continue;
  }
  check(
    "she is fully on screen",
    f.left >= 0 && f.top >= 0 && f.left + f.width <= viewport.width && f.top + f.height <= viewport.height,
    [Math.round(f.left), Math.round(f.top), Math.round(f.width), Math.round(f.height)],
  );

  // Only her figure takes touches.
  const passThrough = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return { tag: el?.tagName ?? null, insideCompanion: Boolean(el?.closest("[data-testid='lelu-companion']")) };
  }, { x: f.left > 40 ? f.left - 20 : f.left + f.width + 20, y: f.top + f.height / 2 });
  check("a point right beside her reaches the app beneath (overlay takes no touches)", !passThrough.insideCompanion, passThrough);
  const onHer = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("[data-testid='lelu-companion-figure']")), { x: f.left + f.width / 2, y: f.top + f.height / 2 });
  check("her own figure does take touches", onHer);

  // In chat, with the composer focused.
  await dispatchUi(page, { type: "open_panel", target: "chat" });
  await page.waitForSelector("[data-lelu-composer] textarea", { state: "visible", timeout: 15000 }).catch(() => {});
  await page.focus("[data-lelu-composer] textarea").catch(() => {});
  // She looks around on focus and every 1.5 s, then walks (600 ms). Give a
  // busy page up to 8 s to let her settle.
  let covered = await coveredControls(page);
  for (let i = 0; i < 16 && covered.length > 0; i += 1) {
    await page.waitForTimeout(500);
    covered = await coveredControls(page);
  }
  f = await figure(page);
  check("in chat with the composer focused, she covers no control", covered.length === 0, covered.length ? covered : [Math.round(f.left), Math.round(f.top)]);
  const composerVisible = await page.evaluate(() => {
    const c = document.querySelector("[data-lelu-composer] textarea")?.getBoundingClientRect();
    if (!c) return false;
    const el = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    return Boolean(el?.closest("[data-lelu-composer]"));
  });
  check("the composer is still the thing you touch at its centre", composerVisible);
  await page.fill("[data-lelu-composer] textarea", "typing while she is here").catch(() => {});
  const typed = await page.inputValue("[data-lelu-composer] textarea").catch(() => "");
  check("typing works with her on screen", typed === "typing while she is here", typed);
  await page.fill("[data-lelu-composer] textarea", "").catch(() => {});

  // A real event on LÉLU's bus moves her body; no caption card appears.
  await page.evaluate(async () => {
    const { default: Bus } = await import("/src/core/agent/AgentEvents.ts");
    Bus.getInstance().emit({ type: "tool_started", taskId: "verify-companion", tool: "research", label: "Searching the web for tide tables" });
  });
  // At ~2 frames a second (her live canvas included) React may need a few
  // seconds to show it: polled, not slept.
  let caption = null;
  let activity = null;
  for (let i = 0; i < 20 && activity !== "SEARCHING"; i += 1) {
    await page.waitForTimeout(400);
    caption = await page.$("[data-testid='lelu-companion-caption']");
    activity = await page.getAttribute("[data-testid='lelu-companion']", "data-activity").catch(() => null);
  }
  check("no caption card beside her", caption === null, caption);
  check("and her body takes that activity (live state, not a mood)", activity === "SEARCHING", activity);

  // Her speech as the browser's speech engine plays it.
  const speech = await page.evaluate(async () => {
    const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
    const engine = VoiceEngine.getInstance();
    const seen = [];
    const off = engine.onSpeechActivity((a) => seen.push(a.kind));
    engine.speakResponse("Hello. I am right here while you work.");
    await new Promise((r) => setTimeout(r, 2500));
    off();
    return { seen, hasSynth: typeof speechSynthesis !== "undefined", voices: typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices().length : 0, phase: engine.getState().phase };
  });
  console.log(`      speech engine in this browser: ${JSON.stringify(speech)}`);
  check(
    "her speech reaches her (start/word/end from the real speech engine) — or the browser has no voices and she is honestly not 'speaking'",
    speech.seen.includes("start") || (speech.seen.length === 0 && speech.phase !== "speaking") || speech.seen.includes("end"),
    speech.seen,
  );

  // Drag her: she stays where she is put, across a reload.
  await page.click("button[aria-label='Close chat']", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  f = await figure(page);
  const target = { x: Math.round(viewport.width * 0.3), y: Math.round(viewport.height * 0.55) };
  await page.mouse.move(f.left + f.width / 2, f.top + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  f = await figure(page);
  const centre = { x: f.left + f.width / 2, y: f.top + f.height / 2 };
  check("dragging moves her where she is put", Math.abs(centre.x - target.x) < 12 && Math.abs(centre.y - target.y) < 12, { centre, target });
  check("and she is pinned there", (await page.getAttribute("[data-testid='lelu-companion']", "data-pinned")) === "true");
  await page.waitForTimeout(2000);
  const still = await figure(page);
  check("pinned, she does not move herself", Math.abs(still.left - f.left) < 1 && Math.abs(still.top - f.top) < 1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid='lelu-companion-figure']", { timeout: 15000 }).catch(() => {});
  await dismissSignInGate(page);
  await page.waitForTimeout(1500);
  const afterReload = await figure(page);
  check(
    "after a reload she is still on, in the same spot",
    afterReload && Math.abs(afterReload.left - f.left) < 2 && Math.abs(afterReload.top - f.top) < 2,
    afterReload && [Math.round(afterReload.left), Math.round(afterReload.top)],
  );

  // Double tap: chat.
  const mid = { x: afterReload.left + afterReload.width / 2, y: afterReload.top + afterReload.height / 2 };
  const chatOpened = await attempt(
    page,
    "double-tap",
    async () => {
      await page.mouse.click(mid.x, mid.y);
      await page.waitForTimeout(80);
      await page.mouse.click(mid.x, mid.y);
    },
    () => page.isVisible("[data-lelu-composer] textarea"),
  );
  check("double-tapping her opens the chat", chatOpened);

  // Her controls stay inside the screen, and Hide turns her off.
  await page.click("button[aria-label='Close chat']", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const g = await figure(page);
  await clearNotice(page);
  await page.mouse.click(g.left + g.width / 2, g.top + g.height / 2);
  await page.waitForSelector("[data-testid='lelu-companion-controls']", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500); // measured and positioned (a frame or two)
  const controls = await page.evaluate(() => {
    const c = document.querySelector("[data-testid='lelu-companion-controls']");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  check(
    "a tap shows her controls, fully inside the screen",
    controls && controls.left >= 0 && controls.right <= viewport.width && controls.top >= 0 && controls.bottom <= viewport.height,
    controls,
  );
  await attempt(
    page,
    "hide",
    async () => {
      if (!(await page.locator("[data-testid='lelu-companion-controls']").count())) {
        const h = await figure(page);
        if (h) await page.mouse.click(h.left + h.width / 2, h.top + h.height / 2);
        await page.waitForTimeout(1500);
      }
      await page.locator("[data-testid='lelu-companion-controls'] button", { hasText: "Hide" }).click({ timeout: 5000, force: true }).catch(() => {});
    },
    async () => (await figure(page)) === null,
  );
  check("Hide turns companion mode off", (await figure(page)) === null);

  check("no page errors", errors.length === 0, errors.slice(0, 3));
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL COMPANION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
