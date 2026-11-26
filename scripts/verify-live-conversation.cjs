/**
 * LÉLU live conversation — session acceptance through the REAL built app.
 *
 *   node scripts/verify-live-conversation.cjs --mic <scenario.wav> --out <dir> --label <name> [options]
 *
 * One voice session, many turns: the harness taps the page's own microphone
 * button ONCE ([data-lelu-voice-toggle]) and then only watches. The capture
 * file (scripts/live-conversation-mic.cjs) holds the whole conversation —
 * questions, silences, noise, interruptions — and Chromium plays it into
 * getUserMedia once (%noloop) from the moment the page opens the device.
 *
 * Real: the built app served by server.ts (Groq + Cerebras only), the page's
 * VoiceEngine (VAD, recorder, transcription broker, barge-in), AIService.chat,
 * /api/voice/tts → VoxCPM2, the page's player, the Chat Universe thread.
 * Not a person: the capture file is a synthetic test speaker; playback is
 * proven by the browser's media events, not by an ear. The init script only
 * OBSERVES (tracks, media element events).
 *
 * Options
 *   --mobile                 iPhone 13 emulation (not a physical phone)
 *   --duration <s>           how long the session runs after the tap (default: scenario length + 60)
 *   --type-at <s>|<text>     type a message into the composer at <s> (session stays on)
 *   --offline <a>-<b>        browser network off between <a> and <b> seconds
 *   --kill-worker-at <s>     kill the VoxCPM2 worker at <s> (failure test)
 *   --restart-worker-at <s>  start the VoxCPM2 worker again at <s>
 *   --end-track-at <s>       end the microphone track at <s> (simulated device loss)
 *   --deny | --no-device     permission refused / no capture device
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");
const { chromium, devices } = require("playwright");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:4173/";
const out = path.resolve(opt("out", "live-run"));
const label = opt("label", "run");
fs.mkdirSync(path.join(out, "audio"), { recursive: true });
const mic = opt("mic") ? path.resolve(opt("mic")) : null;
const scenario = mic && fs.existsSync(`${mic}.json`) ? JSON.parse(fs.readFileSync(`${mic}.json`, "utf8")) : null;
const duration = Number(opt("duration", scenario ? Math.ceil(scenario.totalSeconds + 60) : 120)) * 1000;

/* ---------------------- CPU and memory, from /proc ---------------------- */
const TICK = 100; // USER_HZ on Linux
function procStat(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const rss = Number(fs.readFileSync(`/proc/${pid}/statm`, "utf8").split(" ")[1]) * 4096;
    return { ticks: Number(fields[11]) + Number(fields[12]), rss, ppid: Number(fields[1]) };
  } catch {
    return null;
  }
}
function tree(root) {
  const all = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(Number);
  const parent = new Map(all.map((pid) => [pid, procStat(pid)?.ppid]));
  const set = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const pid of all) if (!set.has(pid) && set.has(parent.get(pid))) (set.add(pid), (grew = true));
  }
  return [...set];
}
const pgrep = (pattern) => {
  try {
    return execSync(`pgrep -f ${JSON.stringify(pattern)}`).toString().trim().split("\n").map(Number).filter(Boolean);
  } catch {
    return [];
  }
};

(async () => {
  const args = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"];
  // CPU note: this container has no GPU, so Chromium renders LÉLU's 3D scene
  // in software. Run the browser (and server) on cores 0-1 and VoxCPM2 alone on
  // cores 2-3 (LIVE_WORKER_CORES). Measured: with the browser on ONE core its
  // audio thread starved and whole utterances reached the page as silence;
  // sharing the worker's cores slowed VoxCPM2 ~8x; disabling WebGL instead
  // makes the app retry WebGLRenderer creation in a loop.
  if (flag("deny")) args.push("--deny-permission-prompts", "--use-fake-device-for-media-stream");
  else if (!flag("no-device")) {
    args.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
    if (mic) args.push(`--use-file-for-fake-audio-capture=${mic}%noloop`);
  }
  const contextOptions = flag("mobile") ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } };
  if (!flag("deny") && !flag("no-device")) contextOptions.permissions = ["microphone"];
  const executablePath = process.env.PW_CHROMIUM ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch({ args, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  globalThis.__page = page;

  let t0 = Date.now(); // reset to the microphone tap
  const timeline = [];
  const log = (kind, detail = {}) => {
    const entry = { t: +((Date.now() - t0) / 1000).toFixed(2), kind, ...detail };
    timeline.push(entry);
    if (process.env.VERBOSE) console.log(JSON.stringify(entry));
  };
  page.on("pageerror", (error) => log("pageerror", { text: String(error).slice(0, 300) }));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || /\[VoiceEngine\]/.test(text)) log("console", { level: message.type(), text: text.slice(0, 300) });
  });

  /* ------------------------------ network ------------------------------ */
  const started = new Map();
  let ttsIndex = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (/\/api\/(voice|model|ai)\//.test(url)) {
      started.set(request, Date.now());
      let text;
      if (/\/api\/voice\/tts/.test(url)) {
        try {
          text = JSON.parse(request.postData() ?? "{}").text;
        } catch {}
      }
      log("request", { url: url.replace(BASE, "/").slice(0, 90), ...(text ? { text } : {}) });
    }
  });
  const finish = async (request, failed) => {
    if (!started.has(request)) return;
    const url = request.url().replace(BASE, "/");
    const ms = Date.now() - started.get(request);
    started.delete(request);
    if (failed) return log("request-failed", { url: url.slice(0, 90), ms, error: request.failure()?.errorText });
    const response = await request.response();
    const headers = response ? response.headers() : {};
    const picked = Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith("x-lelu-") || name === "content-type"));
    const entry = { url: url.slice(0, 90), status: response?.status(), ms, headers: picked };
    if (/\/api\/voice\/tts/.test(url) && response?.ok()) {
      try {
        const body = await response.body();
        const file = path.join(out, "audio", `${label}-tts-${String(++ttsIndex).padStart(2, "0")}.wav`);
        fs.writeFileSync(file, body);
        entry.saved = path.relative(out, file);
      } catch (error) {
        entry.saveError = String(error).slice(0, 120);
      }
    }
    log("response", entry);
  };
  page.on("requestfinished", (request) => void finish(request, false));
  page.on("requestfailed", (request) => void finish(request, true));

  /* ------------------------- observation only ------------------------- */
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
    let n = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const element = this;
      if (!element.__lelu) {
        element.__lelu = ++n;
        const note = (event) => window.__acc.media.push({ t: Date.now(), id: element.__lelu, event, at: +element.currentTime.toFixed(2) });
        for (const event of ["playing", "pause", "ended", "error"]) element.addEventListener(event, () => note(event));
      }
      window.__acc.media.push({ t: Date.now(), id: element.__lelu, event: "play()", at: +element.currentTime.toFixed(2) });
      return play.apply(this, args);
    };
  });

  const shots = [];
  const shot = async (name) => {
    const file = path.join(out, `${label}-${name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 80 }).catch(() => {});
    shots.push(path.basename(file));
    log("screenshot", { file: path.basename(file) });
  };
  const voice = () => page.evaluate(() => window.__leluVoice ?? null);
  const messages = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-lelu-universe-thread] .lcu-msg")].map((node) => ({
        role: node.getAttribute("data-role"),
        text: (node.innerText || "").trim().slice(0, 600),
      })),
    );
  const status = () =>
    page.evaluate(() => {
      const node = document.querySelector("[data-lelu-voice-status]");
      const error = document.querySelector("[data-lelu-voice-error]");
      return { status: node?.getAttribute("data-lelu-voice-status") ?? null, label: node?.textContent ?? null, error: error?.textContent ?? null };
    });
  const tracks = () =>
    page.evaluate(() => (window.__acc?.tracks ?? []).map((entry) => (entry.track ? { at: entry.at, kind: entry.kind, readyState: entry.track.readyState } : entry)));
  const media = () => page.evaluate(() => window.__acc?.media ?? []);

  /* ------------------------------ open chat ------------------------------ */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Chat", exact: true }).first().waitFor({ timeout: 120_000 });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(2500);
    if ((await page.locator(".lcu-composer, [data-lelu-universe-thread]").count()) > 0) break;
    await page.getByRole("button", { name: "Chat", exact: true }).first().click().catch(() => {});
  }
  await page.waitForSelector(".lcu-composer, [data-lelu-universe-thread]", { timeout: 60_000 });
  if ((await page.locator("[data-lelu-universe-thread]").count()) === 0) {
    const cards = page.locator("button.lcu-card:not(.lcu-card-new)");
    await cards.first().waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    const labels = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    const index = Math.max(0, labels.findIndex((name) => name && !/^Open Engineering/.test(name)));
    await cards.nth(index).click();
  }
  await page.waitForSelector("[data-lelu-universe-thread]", { timeout: 30_000 });
  await page.waitForTimeout(2000);
  const atLoad = await messages();
  await shot("01-loaded");

  /* ------------------------- resource sampler ------------------------- */
  const browserPid = browser.process?.()?.pid ?? null;
  const samples = [];
  let previous = null;
  const sample = () => {
    const groups = {
      voxcpm2: pgrep("services/voxcpm/server.py --port 8788"),
      server: pgrep("run server.ts"),
      // Every process of the launched browser (Browser has no process handle).
      chromium: browserPid ? tree(browserPid) : pgrep("pw-browsers/chromium"),
    };
    const now = Date.now();
    const row = { t: +((now - t0) / 1000).toFixed(1) };
    const ticks = {};
    for (const [name, pids] of Object.entries(groups)) {
      let total = 0;
      let rss = 0;
      for (const pid of pids) {
        const s = procStat(pid);
        if (s) (total += s.ticks, (rss += s.rss));
      }
      ticks[name] = total;
      row[`${name}RssMiB`] = Math.round(rss / 1048576);
      if (previous) row[`${name}Cpu`] = Math.round(((total - (previous.ticks[name] ?? total)) / TICK / ((now - previous.at) / 1000)) * 100);
    }
    previous = { at: now, ticks };
    samples.push(row);
  };
  const sampler = setInterval(sample, 2000);

  /* ------------------------------ session ------------------------------ */
  const timers = [];
  const at = (seconds, fn) => timers.push(setTimeout(() => void fn().catch((e) => log("action-error", { error: String(e) })), seconds * 1000));

  t0 = Date.now();
  await page.locator("[data-lelu-voice-toggle]").last().click();
  log("mic-tapped", { note: "the only tap on the microphone this session" });
  if (scenario) log("scenario", scenario);

  const typeAt = opt("type-at");
  if (typeAt) {
    const [seconds, ...text] = typeAt.split("|");
    at(Number(seconds), async () => {
      const box = page.locator("textarea[aria-label^='Message']").last();
      await box.click();
      await box.fill(text.join("|"));
      await box.press("Enter");
      log("typed", { text: text.join("|"), sessionActive: (await voice())?.active });
    });
  }
  const offline = opt("offline");
  if (offline) {
    const [a, b] = offline.split("-").map(Number);
    at(a, async () => (await context.setOffline(true), log("network-off")));
    at(b, async () => (await context.setOffline(false), log("network-on")));
  }
  const killAt = opt("kill-worker-at");
  if (killAt) at(Number(killAt), async () => (execSync('pkill -9 -f "[s]ervices/voxcpm/server.py --port 8788" || true'), log("worker-killed")));
  const restartAt = opt("restart-worker-at");
  if (restartAt)
    at(Number(restartAt), async () => {
      const logFile = path.join(out, `${label}-worker-restart.log`);
      const cores = process.env.LIVE_WORKER_CORES ?? "2-3";
      const threads = process.env.LIVE_WORKER_THREADS ?? "2";
      const child = spawn("bash", ["-c", `OMP_NUM_THREADS=${threads} exec taskset -c ${cores} .venv-voxcpm/bin/python services/voxcpm/server.py --port 8788 --warmup > ${JSON.stringify(logFile)} 2>&1`], { detached: true, stdio: "ignore" });
      child.unref();
      log("worker-restarted", { log: path.basename(logFile) });
    });
  const endTrackAt = opt("end-track-at");
  if (endTrackAt)
    at(Number(endTrackAt), async () => {
      // Simulated device loss: Chromium's fake device cannot be unplugged, so
      // the live track is stopped and its "ended" event raised, which is what
      // the page receives when a real device disappears.
      const done = await page.evaluate(() => {
        const entry = (window.__acc?.tracks ?? []).filter((e) => e.track && e.track.readyState === "live").at(-1);
        if (!entry) return false;
        entry.track.stop();
        entry.track.dispatchEvent(new Event("ended"));
        return true;
      });
      log("track-ended-by-harness", { done });
    });

  // Watch: every message as it appears and grows, every phase and status.
  const seen = [];
  let lastKey = "";
  let shotHearing = false;
  let shotHeld = false;
  let shotSpeaking = 0;
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    const [state, list, st] = await Promise.all([voice(), messages(), status()]);
    const d = state?.diagnostics ?? {};
    const key = JSON.stringify([state?.phase, state?.active, d.ttsStage, d.audioPlaying, d.speechHeld, d.userSpeaking, st.status, st.error]);
    if (key !== lastKey) {
      lastKey = key;
      log("state", { phase: state?.phase, active: state?.active, ttsStage: d.ttsStage, audioPlaying: d.audioPlaying, held: d.speechHeld, userSpeaking: d.userSpeaking, status: st.status, label: st.label, error: st.error });
    }
    list.forEach((message, index) => {
      if (index < atLoad.length) return;
      const prior = seen[index];
      if (!prior) {
        seen[index] = { ...message, firstSeen: +((Date.now() - t0) / 1000).toFixed(2), final: message.text };
        log("message", { index, role: message.role, text: message.text.slice(0, 200) });
      } else if (prior.final !== message.text) {
        prior.final = message.text;
        prior.lastGrew = +((Date.now() - t0) / 1000).toFixed(2);
      }
    });
    if (st.status === "hearing" && !shotHearing) (shotHearing = true, await shot("02-hearing"));
    if (d.speechHeld && !shotHeld) (shotHeld = true, await shot("04-held-for-barge-in"));
    if (st.status === "speaking" && shotSpeaking < 3 && !timeline.some((e) => e.kind === "screenshot" && Date.now() - t0 - e.t * 1000 < 8000 && /speaking/.test(e.file))) {
      shotSpeaking += 1;
      await shot(`03-speaking-${shotSpeaking}`);
    }
    if (!state?.active && timeline.some((e) => e.kind === "mic-tapped") && Date.now() - t0 > 5000 && (flag("deny") || flag("no-device"))) break;
    await page.waitForTimeout(200);
  }
  timers.forEach(clearTimeout);
  await shot("05-before-end");

  // End the session with the same button, once, and check the mic is released.
  const before = await voice();
  if (before?.active) {
    await page.locator("[data-lelu-voice-toggle]").last().click();
    log("session-ended-by-tap");
    await page.waitForTimeout(800);
    await shot("06-ended");
    await page.waitForTimeout(1500);
  }
  clearInterval(sampler);
  const final = await voice();
  const finalMessages = (await messages()).slice(atLoad.length);
  const result = {
    label,
    base: BASE,
    input: flag("no-device") ? "no capture device" : flag("deny") ? "permission denied" : mic ? `injected audio file, synthetic test speaker (not a physical microphone): ${path.basename(mic)}` : "none",
    viewport: flag("mobile") ? "iPhone 13 emulation (Chromium), not a physical phone" : "desktop 1440x900",
    webgl: "enabled (software rendering, no GPU in this container)",
    microphoneTaps: 1,
    scenario,
    messages: finalMessages.map((m, i) => ({ ...m, firstSeen: seen[i]?.firstSeen ?? null, lastGrew: seen[i]?.lastGrew ?? null })),
    voice: final ? { phase: final.phase, active: final.active, diagnostics: final.diagnostics, turns: final.turns, turnLatency: final.turnLatency } : null,
    media: (await media()).map((m) => ({ ...m, t: +((m.t - t0) / 1000).toFixed(2) })),
    tracks: (await tracks()).map((tr) => ({ ...tr, at: tr.at ? +((tr.at - t0) / 1000).toFixed(2) : undefined })),
    resources: samples,
    screenshots: shots,
    timeline,
  };
  fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ label, messages: result.messages.map((m) => `${m.firstSeen}s ${m.role}: ${m.text.slice(0, 120)}`), turns: final?.turns?.map((t) => `${t.text?.slice?.(0, 50) ?? ""} → ${t.outcome}`), bargeIns: final?.diagnostics?.bargeIns, holds: final?.diagnostics?.holds, holdsResumed: final?.diagnostics?.holdsResumed, tracks: result.tracks }, null, 1));
  await browser.close();
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try {
    if (globalThis.__page) await globalThis.__page.screenshot({ path: path.join(out, `${label}-error.jpg`), type: "jpeg" });
  } catch {}
  process.exit(1);
});
