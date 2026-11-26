/**
 * Voice finalization — end-to-end acceptance through the REAL app.
 *
 *   node scripts/verify-voice-finalization.cjs --out <dir> --label <name> [options]
 *
 * What is real: the built app served by server.ts, the page's own microphone
 * button ([data-lelu-voice-toggle]), getUserMedia → VoiceEngine's recorder and
 * VAD, the server-brokered transcriber, AIService.chat (her runtime and
 * provider chain), /api/voice/tts → the configured speech worker (VoxCPM2),
 * and the page's own player.
 *
 * What is NOT a person: this container has no microphone, so Chromium's
 * capture device reads `--mic <wav>` (a test speaker synthesised with
 * espeak-ng). The page cannot tell the difference — it calls getUserMedia
 * and records a MediaStream — but the report labels it "injected audio,
 * not a physical microphone". Nothing in the page is mocked or stubbed: the
 * init script below only OBSERVES (track states, media element events).
 *
 * Options
 *   --mic <wav>          capture file (omit with --no-device)
 *   --user-data <dir>    persistent profile: a second run is a browser reload
 *   --mobile             iPhone 13 emulation (labelled emulation, not a phone)
 *   --type <text>        send a typed message first and wait for her reply
 *   --voice              click the microphone and wait for one spoken turn
 *   --interrupt <ms>     tap STOP <ms> after her voice becomes audible
 *   --deny               microphone permission denied
 *   --no-device          no capture device at all
 *   --wait <s>           longest wait for a turn (default 300)
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require("playwright");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:4173/";
const out = path.resolve(opt("out", "voice-run"));
const label = opt("label", "run");
const waitMs = Number(opt("wait", "300")) * 1000;
fs.mkdirSync(path.join(out, "audio"), { recursive: true });

(async () => {
  const args = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"];
  if (flag("deny")) args.push("--deny-permission-prompts", "--use-fake-device-for-media-stream");
  else if (!flag("no-device")) {
    args.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
    if (opt("mic")) args.push(`--use-file-for-fake-audio-capture=${path.resolve(opt("mic"))}`);
  }
  const contextOptions = flag("mobile")
    ? { ...devices["iPhone 13"] }
    : { viewport: { width: 1440, height: 900 } };
  if (!flag("deny") && !flag("no-device")) contextOptions.permissions = ["microphone"];
  // The project pins its own Playwright; use the machine's Chromium when present.
  const executablePath = process.env.PW_CHROMIUM ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const launch = { args, ...(executablePath ? { executablePath } : {}) };
  const userData = opt("user-data");
  const context = userData
    ? await chromium.launchPersistentContext(path.resolve(userData), { headless: true, ...launch, ...contextOptions })
    : await (await chromium.launch(launch)).newContext(contextOptions);
  const page = context.pages()[0] ?? (await context.newPage());
  globalThis.__page = page;

  const t0 = Date.now();
  const timeline = [];
  const log = (kind, detail = {}) => {
    const entry = { t: Date.now() - t0, kind, ...detail };
    timeline.push(entry);
    if (process.env.VERBOSE) console.log(JSON.stringify(entry));
  };
  page.on("pageerror", (error) => log("pageerror", { text: String(error).slice(0, 300) }));
  page.on("console", (message) => {
    if (message.type() === "error" || /VoiceEngine|transcri|tts/i.test(message.text())) log("console", { level: message.type(), text: message.text().slice(0, 300) });
  });

  const started = new Map();
  let ttsIndex = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (/\/api\/(voice|model|ai)\//.test(url)) {
      started.set(request, Date.now());
      log("request", { method: request.method(), url: url.replace(BASE, "/").slice(0, 100) });
    }
  });
  const finish = async (request, failed) => {
    if (!started.has(request)) return;
    const url = request.url().replace(BASE, "/");
    const ms = Date.now() - started.get(request);
    started.delete(request);
    if (failed) {
      log("request-failed", { url: url.slice(0, 100), ms, error: request.failure()?.errorText });
      return;
    }
    const response = await request.response();
    const headers = response ? response.headers() : {};
    const picked = Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith("x-lelu-") || name === "content-type"));
    const entry = { url: url.slice(0, 100), status: response?.status(), ms, headers: picked };
    if (/\/api\/voice\/tts/.test(url) && response?.ok()) {
      try {
        const body = await response.body();
        const ext = /wav/.test(headers["content-type"] ?? "") ? "wav" : /l16/.test(headers["content-type"] ?? "") ? "pcm" : "bin";
        const file = path.join(out, "audio", `${label}-tts-${String(++ttsIndex).padStart(2, "0")}.${ext}`);
        fs.writeFileSync(file, body);
        entry.saved = path.relative(out, file);
        entry.bytes = body.length;
      } catch (error) {
        entry.saveError = String(error).slice(0, 120);
      }
    }
    log("response", entry);
  };
  page.on("requestfinished", (request) => void finish(request, false));
  page.on("requestfailed", (request) => void finish(request, true));

  // Observation only: nothing here changes what the page does.
  await page.addInitScript(() => {
    window.__acc = { tracks: [], media: [] };
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = async (constraints) => {
        const at = Date.now();
        try {
          const stream = await original(constraints);
          for (const track of stream.getTracks()) window.__acc.tracks.push({ at, kind: track.kind, label: track.label, track });
          return stream;
        } catch (error) {
          window.__acc.tracks.push({ at, error: `${error.name}: ${error.message}` });
          throw error;
        }
      };
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const element = this;
      const note = (event) => window.__acc.media.push({ t: Date.now(), event });
      note("play()");
      element.addEventListener("playing", () => note("playing"), { once: true });
      element.addEventListener("ended", () => note("ended"), { once: true });
      element.addEventListener("pause", () => note("pause"), { once: true });
      return play.apply(this, args);
    };
  });

  const shot = async (name) => {
    const file = path.join(out, `${label}-${name}.png`);
    await page.screenshot({ path: file }).catch(() => {});
    log("screenshot", { file: path.basename(file) });
  };
  const voice = () => page.evaluate(() => window.__leluVoice ?? null);
  const messages = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-lelu-universe-thread] .lcu-msg")].map((node) => ({
        role: node.getAttribute("data-role"),
        text: (node.innerText || "").trim().slice(0, 400),
      })),
    );
  const tracks = () =>
    page.evaluate(() => (window.__acc?.tracks ?? []).map((entry) => (entry.track ? { kind: entry.kind, label: entry.label, readyState: entry.track.readyState } : entry)));
  const media = () => page.evaluate(() => window.__acc?.media ?? []);

  // Phase watcher: every change of the engine's real phase, as it happens.
  let lastPhase = null;
  const watcher = setInterval(async () => {
    try {
      const state = await voice();
      const key = state ? `${state.phase}|${state.active}` : "none";
      if (key !== lastPhase) {
        lastPhase = key;
        log("phase", { phase: state?.phase ?? null, active: state?.active ?? null, ttsStage: state?.diagnostics?.ttsStage ?? null });
      }
    } catch {}
  }, 200);

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // As a person would: open Chat, then the conversation (its window has the
  // thread, the composer and the microphone).
  await page.getByRole("button", { name: "Chat", exact: true }).first().waitFor({ timeout: 90_000 });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(2500);
    // After a reload the open chat window is restored instead of the Universe composer.
    if ((await page.locator(".lcu-composer, [data-lelu-universe-thread]").count()) > 0) break;
    await page.getByRole("button", { name: "Chat", exact: true }).first().click().catch(() => {});
    log("chat-tap", { attempt });
  }
  await page.waitForSelector(".lcu-composer, [data-lelu-universe-thread]", { timeout: 60_000 });
  if ((await page.locator("[data-lelu-universe-thread]").count()) === 0) {
    // The person's own chat (the app also files an "Engineering" chat of its own).
    const cards = page.locator("button.lcu-card:not(.lcu-card-new)");
    await cards.first().waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    const labels = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    const index = Math.max(0, labels.findIndex((name) => name && !/^Open Engineering/.test(name)));
    log("open-chat", { card: labels[index], cards: labels });
    await cards.nth(index).click();
  }
  await page.waitForSelector("[data-lelu-universe-thread]", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot("01-loaded");
  log("messages-at-load", { messages: await messages() });

  const typed = opt("type");
  if (typed) {
    const before = (await messages()).filter((m) => m.role === "assistant").length;
    const box = page.locator("textarea[aria-label^='Message']").last();
    await box.click();
    await box.fill(typed);
    log("typed", { text: typed });
    await box.press("Enter");
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const list = await messages();
      const streaming = await page.evaluate(() => document.querySelector("[data-lelu-universe-thread]")?.getAttribute("data-streaming"));
      if (list.filter((m) => m.role === "assistant").length > before && streaming === "false") break;
      await page.waitForTimeout(500);
    }
    log("typed-reply", { messages: (await messages()).slice(-2) });
    await shot("02-typed-reply");
  }

  if (flag("voice") || flag("deny") || flag("no-device")) {
    const clickAt = Date.now();
    await page.locator("[data-lelu-voice-toggle]").last().click();
    log("mic-clicked");
    await page.waitForTimeout(1500);
    await shot("03-mic-on");
    const state0 = await voice();
    log("after-click", { phase: state0?.phase, active: state0?.active, error: await page.evaluate(() => document.querySelector("[data-lelu-voice-error]")?.textContent ?? null), tracks: await tracks() });

    if (flag("deny") || flag("no-device")) {
      await shot("04-error");
    } else {
      const deadline = Date.now() + waitMs;
      let audibleAt = null;
      let interrupted = false;
      let shotSpeaking = false;
      let shotThinking = false;
      const interruptMs = opt("interrupt") === null ? null : Number(opt("interrupt"));
      while (Date.now() < deadline) {
        const state = await voice();
        const playing = (await media()).some((m) => m.event === "playing");
        if (state?.phase === "processing" && !shotThinking) {
          shotThinking = true;
          await shot("05-processing");
        }
        if (playing && !audibleAt) {
          audibleAt = Date.now();
          log("audible", { sinceClickMs: audibleAt - clickAt });
        }
        if (state?.phase === "speaking" && !shotSpeaking) {
          shotSpeaking = true;
          await shot("06-speaking");
        }
        if (interruptMs !== null && audibleAt && !interrupted && Date.now() - audibleAt >= interruptMs) {
          interrupted = true;
          const stop = page.locator("[data-lelu-voice-stop-speaking]");
          const via = (await stop.count()) > 0 ? "stop-speaking-button" : "voice-toggle";
          const tapAt = Date.now();
          if (via === "stop-speaking-button") await stop.first().click();
          else await page.locator("[data-lelu-voice-toggle]").last().click();
          log("interrupt-tap", { via, afterAudibleMs: tapAt - audibleAt });
          await page.waitForTimeout(300);
          const after = await voice();
          log("after-interrupt", { phase: after?.phase, active: after?.active, ttsStage: after?.diagnostics?.ttsStage });
          await shot("07-interrupted");
          // Nothing may start playing after the tap.
          const mediaBefore = (await media()).length;
          await page.waitForTimeout(15_000);
          const later = (await media()).slice(mediaBefore).filter((m) => m.event === "playing");
          log("post-interrupt-playback", { newPlayingEvents: later.length });
          break;
        }
        const turns = state?.turns ?? [];
        const done = turns.some((turn) => turn.outcome) && audibleAt && state?.phase !== "speaking" && state?.diagnostics?.ttsStage !== "playing";
        if (done && interruptMs === null) break;
        await page.waitForTimeout(250);
      }
      await shot("08-after-turn");
    }

    // End the session through the same button and confirm the microphone is released.
    const before = await voice();
    if (before?.active) {
      await page.locator("[data-lelu-voice-toggle]").last().click();
      log("mic-stopped");
      await page.waitForTimeout(1500);
    }
    log("tracks-after-stop", { tracks: await tracks(), phase: (await voice())?.phase });
  }

  clearInterval(watcher);
  const final = await voice();
  const result = {
    label,
    base: BASE,
    input: flag("no-device") ? "no capture device" : flag("deny") ? "permission denied" : opt("mic") ? `injected audio file (not a physical microphone): ${path.basename(opt("mic"))}` : "none",
    viewport: flag("mobile") ? "iPhone 13 emulation (Chromium), not a physical phone" : "desktop 1440x900",
    messages: await messages(),
    voice: final ? { phase: final.phase, active: final.active, diagnostics: final.diagnostics, turnLatency: final.turnLatency, turns: final.turns } : null,
    media: await media(),
    tracks: await tracks(),
    timeline,
  };
  fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label, messages: result.messages.slice(-4), turns: result.voice?.turns, tracks: result.tracks }, null, 2));
  await context.close();
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    if (globalThis.__page) await globalThis.__page.screenshot({ path: path.join(out, `${label}-error.png`) });
  } catch {}
  process.exit(1);
});
