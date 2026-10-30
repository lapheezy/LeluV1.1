/**
 * LÉLU — HER CHARACTER, CHECKED IN THE RUNNING APP
 *
 * Acceptance for the owner's avatar brief, against the real dev server:
 *   1. she is there (companion on), the character from the references;
 *   2. no box: around her silhouette the app shows through — measured by
 *      comparing the same screen region with her canvas shown and hidden;
 *   3. she moves: frames keep coming and her pixels change over time;
 *   4. face-only framing;
 *   5. embodied ↔ hologram;
 *   6. her voice moves her mouth: VoiceEngine.speakResponse() through a
 *      speechSynthesis stand-in that fires real start / word-boundary /
 *      end events (headless Chromium has no voices) — her mouth opens
 *      while she speaks and closes when she stops;
 *   7. the same her across Cosmos, chat, browser, memory and the Avatar
 *      panel (look switched in the panel changes every surface);
 *   8. phone and desktop; no page errors.
 *
 * Evidence (screenshots + results.json): docs/evidence/lelu-character/<stamp>/
 * Usage: node scripts/verify-lelu-character.mjs [baseUrl]
 */

import { chromium } from "playwright";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join("docs", "evidence", "lelu-character", stamp);
mkdirSync(OUT, { recursive: true });

/** A speech engine that behaves like one: start, a boundary per word, end. */
const FAKE_SPEECH = () => {
  window.__speechLog = [];
  const queue = [];
  let current = null;
  const ev = (type, utterance, extra = {}) => new SpeechSynthesisEvent(type, { utterance, charIndex: 0, ...extra });
  const next = () => {
    current = queue.shift() ?? null;
    if (!current) return;
    const u = current;
    setTimeout(() => {
      if (current !== u) return;
      u.dispatchEvent(ev("start", u));
      window.__speechLog.push("start");
      let t = 0;
      for (const m of u.text.matchAll(/\S+/g)) {
        setTimeout(() => current === u && u.dispatchEvent(ev("boundary", u, { charIndex: m.index, name: "word" })), t);
        t += 90 + m[0].length * 65;
      }
      setTimeout(() => {
        if (current !== u) return;
        current = null;
        u.dispatchEvent(ev("end", u, { charIndex: u.text.length }));
        window.__speechLog.push("end");
        next();
      }, t + 250);
    }, 30);
  };
  const synth = {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    getVoices: () => [],
    speak(u) { queue.push(u); if (!current) next(); },
    cancel() { queue.length = 0; if (current) { const u = current; current = null; u.dispatchEvent(ev("end", u)); } },
    pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
};

async function raw(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Per-pixel difference of two equal-size screenshots: fraction changed, and mean diff in border patches. */
async function compare(a, b) {
  const A = await raw(a);
  const B = await raw(b);
  const { width, height } = A;
  let changed = 0;
  const diffAt = (x, y) => {
    const i = (y * width + x) * 3;
    return (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])) / 3;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (diffAt(x, y) > 40) changed += 1;
  const patch = Math.max(4, Math.round(Math.min(width, height) * 0.12));
  const corners = [[0, 0], [width - patch, 0], [0, height - patch], [width - patch, height - patch]];
  const cornerMeans = corners.map(([x0, y0]) => {
    let sum = 0;
    for (let y = y0; y < y0 + patch; y += 1) for (let x = x0; x < x0 + patch; x += 1) sum += diffAt(x, y);
    return sum / (patch * patch);
  });
  return { changedFraction: changed / (width * height), cornerMeanDiff: Math.max(...cornerMeans) };
}

const results = [];
const record = (viewport, check, pass, detail) => {
  results.push({ viewport, check, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${viewport}] ${check} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};

async function run(name, viewport) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport, isMobile: name === "phone", hasTouch: name === "phone" });
  await context.addInitScript(FAKE_SPEECH);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  const shot = (file, options = {}) => page.screenshot({ path: path.join(OUT, `${name}-${file}.png`), timeout: 180_000, ...options });
  const dismiss = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")].find((x) => x.textContent.trim() === "Continue");
    if (b) b.click();
    return Boolean(b);
  });
  const open = (target) => page.evaluate(async (t) => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    return Bus.getInstance().dispatch({ type: "open_panel", target: t, reason: "avatar acceptance", initiatedBy: "user" }).ok;
  }, target);
  const companion = (attr) => page.locator("[data-testid=lelu-companion-character]").evaluate((c, a) => c.dataset[a] ?? null, attr).catch(() => null);
  const frames = async () => Number((await companion("frames")) ?? 0);
  const waitFor = async (predicate, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await predicate()) return true;
      await page.waitForTimeout(400);
    }
    return false;
  };

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 16; i += 1) { await dismiss(); await page.waitForTimeout(500); }

  // 1. she is there, by default
  const ready = await waitFor(async () => (await companion("ready")) === "true" && (await frames()) > 1, 30_000);
  record(name, "she is present on load (companion on by default), her character loaded", ready, { look: await companion("look"), framing: await companion("framing") });
  await dismiss();
  await shot("01-present");

  // 2. no box: everything but her hidden, the page painted flat green.
  // Whatever is not her in her rectangle must then be that green: a card,
  // frame or backdrop of hers would not be.
  const figure = page.locator("[data-testid=lelu-companion-figure]");
  const box = await figure.boundingBox();
  if (box) {
    const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.floor(box.width), height: Math.floor(box.height) };
    await page.addStyleTag({ content: `body * { visibility: hidden !important; } [data-testid=lelu-companion], [data-testid=lelu-companion] * { visibility: visible !important; } html, body { background: #00ff00 !important; } #lelu-isolate {}` });
    await page.waitForTimeout(1500);
    const isolated = await page.screenshot({ clip, timeout: 180_000 });
    writeFileSync(path.join(OUT, `${name}-02-isolated-on-green.png`), isolated);
    const iso = await raw(isolated);
    let green = 0;
    const isGreen = (i) => iso.data[i] < 60 && iso.data[i + 1] > 200 && iso.data[i + 2] < 60;
    for (let i = 0; i < iso.data.length; i += 3) if (isGreen(i)) green += 1;
    const cornerGreen = [[1, 1], [iso.width - 2, 1], [1, iso.height - 2], [iso.width - 2, iso.height - 2]]
      .every(([x, y]) => isGreen((y * iso.width + x) * 3));
    const greenFraction = green / (iso.width * iso.height);
    // Her silhouette (with its soft shadow) covers part of the rectangle;
    // the rest, corners included, is the page behind her.
    record(name, "no box around her: outside her silhouette the page behind shows", cornerGreen && greenFraction > 0.3 && greenFraction < 0.95, { greenFraction, cornerGreen });
    await page.evaluate(() => { for (const s of document.querySelectorAll("style")) if (s.textContent?.includes("#lelu-isolate")) s.remove(); });
    await page.waitForTimeout(800);

    // 3. she moves
    const f0 = await frames();
    const a = await page.screenshot({ clip, timeout: 180_000 });
    await page.waitForTimeout(2500);
    const b = await page.screenshot({ clip, timeout: 180_000 });
    const motion = await compare(a, b);
    const f1 = await frames();
    record(name, "she moves continuously (frames keep coming, her pixels change)", f1 > f0 && motion.changedFraction > 0.002, { framesReported: f1 - f0, changedFraction: motion.changedFraction });
  } else {
    record(name, "no box around her", false, "her figure has no box on screen");
  }

  // 4. face-only, 5. hologram — through her own controls
  // Her controls: tap her (pointer down/up), then press the button. At
  // ~2 frames a second a tap can be missed: tried up to five times.
  const control = async (label) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pressed = await page.evaluate((text) => {
        const button = [...document.querySelectorAll("[data-testid=lelu-companion-controls] button")].find((b) => b.textContent.trim() === text);
        if (button) button.click();
        return Boolean(button);
      }, label);
      if (pressed) return true;
      await figure.click({ force: true, noWaitAfter: true, timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
    return false;
  };
  await control("Face");
  const face = await waitFor(async () => (await companion("framing")) === "face", 10_000);
  await page.waitForTimeout(1500);
  await shot("04-face");
  record(name, "face-only presentation (head and shoulders)", face, { framing: await companion("framing") });

  await control("Hologram");
  const holo = await waitFor(async () => Number((await companion("holo")) ?? 0) > 0.9, 15_000);
  await shot("05-hologram");
  record(name, "embodied → hologram (same character, projected)", holo, { form: await companion("form"), holo: await companion("holo") });
  await control("Embodied");
  const embodied = await waitFor(async () => Number((await companion("holo")) ?? 1) < 0.1, 15_000);
  record(name, "hologram → embodied", embodied, { holo: await companion("holo") });

  // 6. her voice moves her mouth. Read two ways: the canvas's own report
  // (4×/s, only on frames it gets to draw), and an in-page sampler of the
  // shared animation state her canvas draws from — on a starved headless
  // phone the canvas may draw only a frame or two per second.
  await page.evaluate(async () => {
    const { default: Anim } = await import("/src/core/avatar/LeluAnimation.ts");
    const anim = Anim.getInstance();
    window.__mouthMax = 0;
    window.__sawSpeaking = false;
    const sample = () => {
      if (anim.isSpeaking()) {
        window.__sawSpeaking = true;
        window.__mouthMax = Math.max(window.__mouthMax, anim.frame(performance.now()).open);
      }
      window.__mouthTimer = setTimeout(sample, 40);
    };
    sample();
    const { default: Voice } = await import("/src/core/voice/VoiceEngine.ts");
    Voice.getInstance().speakResponse("Hello, I am LÉLU. I am speaking to you right now, and you can watch my mouth follow every word I say.");
  });
  let maxMouth = 0;
  let sawSpeaking = false;
  let mouthShot = false;
  const read = () => page.locator("[data-testid=lelu-companion-character]").evaluate((c) => ({ speaking: c.dataset.speaking === "true", mouth: Number(c.dataset.mouth ?? 0) })).catch(() => ({ speaking: false, mouth: 0 }));
  // At ~2 frames a second her ~8 s sentence takes longer to play out here.
  const speechUntil = Date.now() + 40_000;
  while (Date.now() < speechUntil) {
    const now = await read();
    sawSpeaking ||= now.speaking;
    maxMouth = Math.max(maxMouth, now.mouth);
    if (now.mouth > 0.3 && !mouthShot) {
      mouthShot = true;
      await shot("06-speaking");
    }
    if (sawSpeaking && !now.speaking) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2500);
  const restMouth = (await read()).mouth;
  const { sharedMax, sharedSaw } = await page.evaluate(() => {
    clearTimeout(window.__mouthTimer);
    return { sharedMax: window.__mouthMax, sharedSaw: window.__sawSpeaking };
  });
  maxMouth = Math.max(maxMouth, sharedMax);
  sawSpeaking ||= sharedSaw;
  const speechLog = await page.evaluate(() => (window.__speechLog ?? []).join(","));
  record(name, "her voice drives her mouth (opens while speaking, closes after)", sawSpeaking && maxMouth > 0.25 && restMouth < 0.05, { sawSpeaking, maxMouth, sharedStateMax: sharedMax, mouthAfter: restMouth, speechEngine: speechLog });
  await control("Full body");

  // 7. the same her across surfaces
  for (const target of ["chat", "browser", "memory", "cosmos"]) {
    const opened = await open(target);
    await page.waitForTimeout(2500);
    await dismiss();
    // Opening a panel can remount her canvas: give it time to be ready.
    const isReady = await waitFor(async () => (await companion("ready")) === "true", 15_000);
    const before = await frames();
    await page.waitForTimeout(2000);
    const after = await frames();
    await shot(`07-${target}`);
    record(name, `present and alive over ${target}`, opened && isReady && after > before, { opened, ready: isReady, framesReported: after - before });
  }

  await open("avatar");
  await page.waitForTimeout(4000);
  await dismiss();
  const panelReady = await waitFor(async () => (await page.locator("[data-testid=avatar-panel-character]").evaluate((c) => c.dataset.ready).catch(() => null)) === "true", 20_000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Earthy")?.click());
  const switched = await waitFor(async () =>
    (await page.locator("[data-testid=avatar-panel-character]").evaluate((c) => c.dataset.look).catch(() => null)) === "earthy" && (await companion("look")) === "earthy", 15_000);
  await page.waitForTimeout(3000);
  await shot("08-avatar-panel-earthy");
  record(name, "Avatar panel shows her live; a look chosen there changes every surface", panelReady && switched, { panelReady, switched });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Gothic lace")?.click());
  await page.waitForTimeout(2000);

  record(name, "no page errors", errors.length === 0, errors.slice(0, 5));
  await browser.close();
}

await run("phone", { width: 390, height: 844 });
await run("desktop", { width: 1280, height: 800 });
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed — evidence in ${OUT}`);
process.exit(failed.length ? 1 : 0);
