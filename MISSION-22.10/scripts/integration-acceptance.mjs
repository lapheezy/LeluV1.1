/**
 * M22.9 persistent voice runtime — end-to-end session acceptance.
 *
 * Drives the REAL application (bun server.ts → built app) in a real Chromium:
 * real Groq Whisper transcription through the server relay, the real
 * AIService/chat runtime and its configured model provider, the real local
 * Piper speaker. The MICROPHONE IS SIMULATED: Chromium's
 * `--use-file-for-fake-audio-capture` plays a WAV of the user's lines
 * (build-session-mic.py) into getUserMedia. There is no physical microphone
 * or speaker in this container; nothing here establishes that one works.
 *
 * M22.10: copied from MISSION-22.9/persistent-runtime/scripts/session-acceptance.mjs and
 * extended with: mobile hidden-Cosmos frame check, a permission-denial run, a
 * visibility-transition run, and full reply text for the contamination check.
 *
 * Runs (argv[2]):
 *   desktop   1440×900: the 17-step conversation, barge-in ×2, typed handoff,
 *             session end + microphone cleanup.
 *   mobile    iPhone-13 emulation (touch, 390×844): tap the composer mic,
 *             one voice turn, controls in viewport, end + cleanup.
 *   recovery  playback failure (TTS 500) → text kept, session keeps listening;
 *             microphone track ends → re-acquired; STT network abort → next
 *             utterance still processed; 10 start/stop cycles → no leaks.
 *
 * Every number written is read from the page's own events or the engine's
 * diagnostics (window.__leluVoice); nothing is estimated.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "MISSION-22.10");
const MODE = process.argv[2] || "desktop";
const URL = process.env.LELU_URL || "http://127.0.0.1:4180/";
const MIC_WAV = process.env.LELU_MIC_WAV || join(ROOT, ".piper/session-mic.wav");
const PLAN = JSON.parse(readFileSync(join(OUT, "logs", "mic-plan.json"), "utf8"));
mkdirSync(join(OUT, "logs"), { recursive: true });
mkdirSync(join(OUT, "screenshots"), { recursive: true });

const browser = await chromium.launch({
  ...(process.env.LELU_CHROMIUM ? { executablePath: process.env.LELU_CHROMIUM } : {}),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    ...(MODE === "denial" ? [] : ["--use-fake-ui-for-media-stream"]),
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${MIC_WAV}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const contextOptions = MODE === "mobile"
  ? { ...devices["iPhone 13"], permissions: ["microphone"] }
  : MODE === "denial"
    ? { viewport: { width: 1440, height: 900 } }
    : { viewport: { width: 1440, height: 900 }, permissions: ["microphone"] };
// Playwright's iPhone profile is WebKit-flavoured; we run it on Chromium for
// the fake microphone, so the user agent is iOS but the engine is Blink.
const context = await browser.newContext(contextOptions);
const page = await context.newPage();

const t = () => Date.now();
const events = [];
const note = (kind, data = {}) => {
  const entry = { t: t(), kind, ...data };
  events.push(entry);
  console.log(`[${MODE}] ${kind}`, JSON.stringify(data).slice(0, 220));
  return entry;
};
const consoleLines = [];
page.on("console", (message) => {
  const text = message.text();
  if (/VoiceEngine|microphone|barge|transcri|AIService|provider/i.test(text)) consoleLines.push({ t: t(), level: message.type(), text: text.slice(0, 400) });
});
page.on("pageerror", (error) => note("pageerror", { message: error.message.slice(0, 300) }));
const apiRequests = [];
page.on("request", (request) => {
  const url = request.url();
  if (url.includes("/api/")) apiRequests.push({ t: t(), method: request.method(), path: new globalThis.URL(url).pathname });
});

await page.addInitScript(() => {
  window.__m229 = { stt: [], tts: [], media: [], streams: [], gum: [] };
  const rec = window.__m229;
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const request = args[0];
    const url = typeof request === "string" ? request : request?.url || String(request);
    const init = args[1] || {};
    const started = Date.now();
    const isStt = url.includes("/audio/transcriptions") || url.includes("/api/voice/stt");
    const isTts = url.includes("/api/voice/tts");
    let ttsText = null;
    if (isTts && typeof init.body === "string") {
      try { ttsText = JSON.parse(init.body).text; } catch { /* not JSON */ }
    }
    let response;
    try {
      response = await originalFetch(...args);
    } catch (error) {
      if (isStt) rec.stt.push({ t: started, done: Date.now(), ok: false, error: String(error?.message || error) });
      if (isTts) rec.tts.push({ t: started, done: Date.now(), ok: false, text: ttsText, error: String(error?.message || error) });
      throw error;
    }
    if (isStt) {
      let text = null;
      try { text = (await response.clone().json())?.text ?? null; } catch { /* not JSON */ }
      rec.stt.push({ t: started, done: Date.now(), ok: response.ok, status: response.status, text });
    }
    if (isTts) {
      rec.tts.push({ t: started, done: Date.now(), ok: response.ok, status: response.status, text: ttsText, provider: response.headers.get("x-lelu-voice-provider"), streaming: response.headers.get("x-lelu-streaming") });
    }
    return response;
  };

  const originalGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const started = Date.now();
    const stream = await originalGum(constraints);
    rec.gum.push({ t: started, done: Date.now() });
    rec.streams.push(stream);
    return stream;
  };
  window.__m229Tracks = () => rec.streams.map((stream) => stream.getTracks().map((track) => track.readyState));
  /** Simulate the platform ending the microphone (device lost / revoked). */
  window.__m229EndMic = () => {
    const stream = rec.streams.at(-1);
    const track = stream?.getAudioTracks()[0];
    if (!track) return false;
    track.stop(); // the real capture stops…
    track.dispatchEvent(new Event("ended")); // …and the page hears what a lost device fires
    return true;
  };

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    const originalCreate = Ctx.prototype.createBufferSource;
    Ctx.prototype.createBufferSource = function (...args) {
      const source = originalCreate.apply(this, args);
      const originalStart = source.start.bind(source);
      source.start = (...rest) => {
        rec.media.push({ t: Date.now(), event: "play", src: "pcm" });
        source.addEventListener("ended", () => rec.media.push({ t: Date.now(), event: "ended", src: "pcm" }));
        return originalStart(...rest);
      };
      const originalStop = source.stop.bind(source);
      source.stop = (...rest) => {
        rec.media.push({ t: Date.now(), event: "stop", src: "pcm" });
        return originalStop(...rest);
      };
      return source;
    };
  }
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    rec.media.push({ t: Date.now(), event: "play", src: "element" });
    this.addEventListener("playing", () => rec.media.push({ t: Date.now(), event: "playing", src: "element" }), { once: true });
    this.addEventListener("ended", () => rec.media.push({ t: Date.now(), event: "ended", src: "element" }), { once: true });
    this.addEventListener("pause", () => rec.media.push({ t: Date.now(), event: this.ended ? "pause-at-end" : "pause", src: "element" }), { once: true });
    return originalPlay.apply(this, args);
  };
});

/* ----------------------------- helpers ----------------------------- */

const voice = () => page.evaluate(() => {
  const v = window.__leluVoice;
  return v ? { phase: v.phase, active: v.active, diagnostics: v.diagnostics, turnLatency: v.turnLatency } : null;
});
const rec = () => page.evaluate(() => ({ stt: window.__m229.stt, tts: window.__m229.tts, media: window.__m229.media, gum: window.__m229.gum, tracks: window.__m229Tracks() }));
const conversation = () => page.evaluate(() => {
  // provider is recorded so an offline-composer answer can be told from a model answer.
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.includes("multichat.workspace")) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      const workspace = data?.value ?? data;
      const activeId = workspace.activeId;
      const active = (workspace.conversations || []).find((c) => c.id === activeId) || workspace.conversations?.[0];
      return { key, activeId, conversations: (workspace.conversations || []).length, messages: (active?.messages || []).map((m) => ({ role: m.role, text: String(m.text || "").slice(0, 4000), t: m.timestamp, provider: m.provider ?? null })) };
    } catch (error) {
      return { key, error: String(error) };
    }
  }
  return null;
});
const shot = async (name) => {
  const file = `${MODE}${process.env.LELU_RUN_LABEL ? `-${process.env.LELU_RUN_LABEL}` : ""}-${name}.png`;
  await page.screenshot({ path: join(OUT, "screenshots", file) });
  note("screenshot", { name: file });
};
const micButton = () => page.locator("[data-lelu-voice-toggle]:visible").first();
const sampler = [];
async function sampleFor(ms, until) {
  const end = t() + ms;
  while (t() < end) {
    const v = await voice();
    if (v) sampler.push({ t: t(), phase: v.phase, active: v.active, bargeIns: v.diagnostics.bargeIns, streamsOpen: v.diagnostics.micStreamsOpen, recoveries: v.diagnostics.captureRecoveries, turnId: v.turnLatency?.turnId ?? null, latency: v.turnLatency, turnFailure: null });
    if (until && (await until(v))) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function openChat() {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(9000);
  await shot("01-loaded");
  const press = async (locator) => { if (MODE === "mobile") await locator.tap(); else await locator.click(); };
  // No account: the local-only path the sign-in sheet offers.
  const guest = page.getByRole("button", { name: "Continue without an account" });
  if (await guest.count()) { await press(guest.first()); await page.waitForTimeout(1500); }
  const chatTile = page.getByRole("button", { name: /^Chat$/ });
  const opener = page.locator('button[aria-label*="open chat"]');
  if (await chatTile.count()) await press(chatTile.first());
  else if (await opener.count()) await press(opener.first());
  await page.waitForTimeout(2500);
  await micButton().waitFor({ state: "visible", timeout: 20_000 });
  await shot("02-chat-open");
}

async function pressMic(label) {
  const button = micButton();
  const box = await button.boundingBox();
  if (MODE === "mobile") await button.tap(); else await button.click();
  return note(label, { box, capture: await button.getAttribute("data-lelu-voice-capture") });
}

function perTurn(collected, sampled, micStartedAt) {
  const turns = new Map();
  for (const s of sampled) {
    if (s.latency?.turnId) turns.set(s.latency.turnId, s.latency);
  }
  return [...turns.values()].map((latency) => ({
    turnId: latency.turnId,
    transcriptAtS: +((latency.transcriptAt - micStartedAt) / 1000).toFixed(2),
    transcriptToFirstTextMs: latency.firstTextAt ? latency.firstTextAt - latency.transcriptAt : null,
    transcriptToFirstAudioMs: latency.firstAudioAt ? latency.firstAudioAt - latency.transcriptAt : null,
    transcriptToAudibleMs: latency.firstAudibleAt ? latency.firstAudibleAt - latency.transcriptAt : null,
    firstTextToAudibleMs: latency.firstAudibleAt && latency.firstTextAt ? latency.firstAudibleAt - latency.firstTextAt : null,
  }));
}

/* ------------------------------- runs ------------------------------- */

const result = { mode: MODE, ranAt: new Date().toISOString(), url: URL, simulatedMicrophone: true, physicalMicrophone: false, physicalSpeaker: false, plan: PLAN };

if (MODE === "desktop" || MODE === "mobile") {
  await openChat();
  const before = await conversation();
  result.conversationBefore = before;
  const micStart = await pressMic("voice-started");
  const micStartedAt = micStart.t;

  if (MODE === "mobile") {
    // One voice turn on the phone layout, then end.
    await sampleFor(25_000, async () => {
      const r = await rec();
      return r.tts.length > 0 && r.media.some((m) => m.event === "ended");
    });
    await shot("03-voice-turn");
    // Item 14: with the chat covering a phone screen the 3D world must not paint.
    const frames = () => page.evaluate(() => window.__leluRenderStats?.frames ?? null);
    const f0 = await frames();
    await page.waitForTimeout(5000);
    const f1 = await frames();
    result.hiddenCosmos = { framesBefore: f0, framesAfter5s: f1, paintedDuringChat: f0 === null || f1 === null ? null : f1 - f0, voiceActive: (await voice())?.active };
    const vp = page.viewportSize();
    const box = await micButton().boundingBox();
    result.layout = { viewport: vp, micButton: box, micInViewport: Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height), micTapTargetPx: box ? Math.min(box.width, box.height) : null };
    // What is on top of the mic button? (an overlay would intercept the tap)
    result.layout.topElementAtMic = await page.evaluate((b) => {
      if (!b) return null;
      const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return el ? { tag: el.tagName, isMicOrChild: Boolean(el.closest("[data-lelu-voice-toggle]")) } : null;
    }, box);
  } else {
    // Steps 3–13: four spoken lines, two of them over her speech.
    const lastLineEnd = PLAN.lines.at(-1).endS * 1000;
    await sampleFor(lastLineEnd + 4000, null);
    await shot("03-after-barge-ins");
    // Let the reply to the last line finish.
    await sampleFor(30_000, async (v) => v && v.phase === "listening" && (await rec()).tts.length > 0 && !(await page.evaluate(() => window.__leluVoice?.diagnostics?.audioPlaying)));
    await shot("04-voice-conversation");

    // Step 14–15: typed chat, same conversation.
    const composer = page.locator("textarea:visible").first();
    await composer.fill(process.env.LELU_TYPED || "Which city did I first ask you about, and what is my name?");
    const typedAt = note("typed-sent").t;
    await composer.press("Enter");
    await sampleFor(45_000, async () => {
      const c = await conversation();
      const last = c?.messages?.at(-1);
      return last?.role === "assistant" && last.t > typedAt;
    });
    await page.waitForTimeout(1500);
    await shot("05-typed-handoff");
    result.typedReply = (await conversation())?.messages?.at(-1) ?? null;
  }

  // Step 17: end the session, verify the microphone is released.
  const beforeEnd = await voice();
  await pressMic("voice-ended");
  await page.waitForTimeout(1500);
  const after = await voice();
  const collected = await rec();
  await shot("06-ended");
  result.session = {
    micStartedAt,
    getUserMediaCalls: collected.gum.length,
    tracksAfterEnd: collected.tracks,
    allTracksEnded: collected.tracks.flat().every((state) => state === "ended"),
    stateBeforeEnd: { phase: beforeEnd?.phase, active: beforeEnd?.active },
    stateAfterEnd: { phase: after?.phase, active: after?.active },
    diagnosticsAfterEnd: after?.diagnostics,
    micButtonCaptureAttr: await micButton().getAttribute("data-lelu-voice-capture"),
  };
  result.stt = collected.stt.map((s) => ({ ...s, atS: +((s.t - micStartedAt) / 1000).toFixed(2), doneS: +((s.done - micStartedAt) / 1000).toFixed(2), ms: s.done - s.t }));
  result.tts = collected.tts.map((s) => ({ ...s, atS: +((s.t - micStartedAt) / 1000).toFixed(2), ms: s.done - s.t }));
  result.media = collected.media.map((m) => ({ ...m, atS: +((m.t - micStartedAt) / 1000).toFixed(2) }));
  result.turns = perTurn(collected, sampler, micStartedAt);
  result.bargeIns = after?.diagnostics?.bargeIns ?? null;
  result.conversationAfter = await conversation();
  // Interruption timing: for each barge-in line, from the end of the user's
  // line to the first playback stop after it (whisper path: barge-in fires
  // when the line has been transcribed).
  // Engine-side truth: was she speaking when the user's line ENDED, and when
  // did the phase leave "speaking" after it (barge-in counted by the engine)?
  result.bargeInFromPhase = PLAN.lines.slice(1, 3).map((line) => {
    const lineStart = micStartedAt + line.startS * 1000;
    const lineEnd = micStartedAt + line.endS * 1000;
    const near = (time) => sampler.reduce((best, s) => (Math.abs(s.t - time) < Math.abs((best?.t ?? Infinity) - time) ? s : best), null);
    const atStart = near(lineStart);
    const atEnd = near(lineEnd);
    const left = sampler.find((s) => s.t > lineEnd && s.phase !== "speaking");
    const counted = sampler.find((s) => s.t > lineStart && s.bargeIns > (atStart?.bargeIns ?? 0));
    return {
      line: line.text,
      phaseAtLineStart: atStart?.phase,
      phaseAtLineEnd: atEnd?.phase,
      bargeInCountedAtS: counted ? +((counted.t - micStartedAt) / 1000).toFixed(2) : null,
      lineEndToBargeInMs: counted ? counted.t - lineEnd : null,
      speakingLeftAtS: left ? +((left.t - micStartedAt) / 1000).toFixed(2) : null,
    };
  });
  result.interruptions = PLAN.lines.slice(1, 3).map((line) => {
    const lineEnd = micStartedAt + line.endS * 1000;
    const lineStart = micStartedAt + line.startS * 1000;
    const playingAtStart = collected.media.filter((m) => m.event === "play" && m.t < lineStart).length > 0;
    const stop = collected.media.find((m) => (m.event === "stop" || m.event === "pause") && m.t >= lineStart);
    const transcript = collected.stt.find((s) => s.done >= lineEnd && s.text);
    return {
      line: line.text,
      lineStartS: line.startS,
      lineEndS: line.endS,
      herAudioStartedBeforeLine: playingAtStart,
      playbackStopAtS: stop ? +((stop.t - micStartedAt) / 1000).toFixed(2) : null,
      transcriptDoneS: transcript ? +((transcript.done - micStartedAt) / 1000).toFixed(2) : null,
      lineEndToStopMs: stop ? stop.t - lineEnd : null,
      transcriptToStopMs: stop && transcript ? stop.t - transcript.done : null,
    };
  });
}

if (MODE === "recovery") {
  await openChat();
  // 1) Playback failure: her speaker returns 500 for the first reply.
  let failTts = true;
  await page.route("**/api/voice/tts", (route) => (failTts ? route.fulfill({ status: 500, body: "simulated synthesis failure" }) : route.continue()));
  const start = await pressMic("voice-started");
  const micStartedAt = start.t;
  await sampleFor(30_000, async () => (await rec()).tts.some((x) => x.status === 500));
  await sampleFor(8000, async (v) => v?.phase === "listening");
  const afterTtsFail = await voice();
  const failureState = await page.evaluate(() => window.__leluVoice);
  result.playbackFailure = {
    ttsFailed: (await rec()).tts.filter((x) => x.status === 500).length,
    phaseAfter: afterTtsFail?.phase,
    activeAfter: afterTtsFail?.active,
    ttsStage: afterTtsFail?.diagnostics?.ttsStage,
    replyInConversation: (await conversation())?.messages?.filter((m) => m.role === "assistant").length ?? 0,
    at: failureState?.at,
  };
  await shot("03-playback-failure");
  failTts = false;

  // 2) Microphone track ends under the live session → re-acquired.
  const endedAt = note("mic-ended", { ok: await page.evaluate(() => window.__m229EndMic()) }).t;
  let recoveredAt = null;
  await sampleFor(10_000, async (v) => {
    if (v?.diagnostics?.captureRecoveries >= 1 && v.diagnostics.micStreamActive) {
      recoveredAt = t();
      return true;
    }
    return false;
  });
  const afterRecovery = await voice();
  result.micRecovery = {
    recovered: Boolean(recoveredAt),
    recoveryMs: recoveredAt ? recoveredAt - endedAt : null,
    captureLosses: afterRecovery?.diagnostics?.captureLosses,
    captureRecoveries: afterRecovery?.diagnostics?.captureRecoveries,
    streamsOpen: afterRecovery?.diagnostics?.micStreamsOpen,
    phase: afterRecovery?.phase,
    active: afterRecovery?.active,
  };
  // The fake device restarts its file on the new stream: line 1 is heard
  // again and must be transcribed and answered (and now spoken) on the new stream.
  const sttBefore = (await rec()).stt.length;
  const ttsBefore = (await rec()).tts.filter((x) => x.ok).length;
  let spokenAfterRecoveryAt = null;
  await sampleFor(40_000, async () => {
    const r = await rec();
    if (r.tts.filter((x) => x.ok).length > ttsBefore && r.media.some((m) => m.event === "play" && m.t > endedAt)) {
      spokenAfterRecoveryAt = t();
      return true;
    }
    return false;
  });
  result.micRecovery.utteranceAfterRecovery = (await rec()).stt.slice(sttBefore).map((s) => s.text);
  result.micRecovery.spokenAfterRecovery = Boolean(spokenAfterRecoveryAt);
  result.micRecovery.endedToSpokenMs = spokenAfterRecoveryAt ? spokenAfterRecoveryAt - endedAt : null;
  await shot("04-after-mic-recovery");

  // 3) Network failure of transcription: the next STT request is aborted.
  let abortStt = true;
  await page.route(/audio\/transcriptions|\/api\/voice\/stt/, (route) => {
    if (abortStt) {
      abortStt = false;
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  // Restart the stream so the fake file replays line 1 for the aborted request,
  // then line 2 for the request after it.
  await page.evaluate(() => window.__m229EndMic());
  const sttBeforeAbort = (await rec()).stt.length;
  await sampleFor(45_000, async () => {
    const r = await rec();
    const after = r.stt.slice(sttBeforeAbort);
    return after.some((s) => s.ok === false) && after.some((s) => s.ok && s.text);
  });
  const sttAfterAbort = (await rec()).stt.slice(sttBeforeAbort);
  const v3 = await voice();
  result.sttNetworkFailure = {
    aborted: sttAfterAbort.filter((s) => s.ok === false).length,
    laterTranscripts: sttAfterAbort.filter((s) => s.ok && s.text).map((s) => s.text),
    sessionStillActive: v3?.active,
    phase: v3?.phase,
  };
  await pressMic("voice-ended");
  await page.waitForTimeout(1500);

  // 4) 10 start/stop cycles: no stream, listener or context growth.
  const cycles = [];
  for (let i = 0; i < 10; i += 1) {
    await micButton().click();
    await sampleFor(4000, async (v) => v?.active && v?.diagnostics?.micStreamActive);
    await micButton().click();
    await page.waitForTimeout(400);
    const v = await voice();
    cycles.push({ i, active: v?.active, streamsOpen: v?.diagnostics?.micStreamsOpen, acquired: v?.diagnostics?.micStreamsAcquired, released: v?.diagnostics?.micStreamsReleased, lifecycleListeners: v?.diagnostics?.lifecycleListeners });
  }
  const tracks = (await rec()).tracks;
  const heap = await page.evaluate(() => (performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize } : null));
  result.cycles = { cycles, allTracksEnded: tracks.flat().every((s) => s === "ended"), totalStreams: tracks.length, heapAfter: heap };
  await shot("05-after-cycles");
  result.micStartedAt = micStartedAt;
}

if (MODE === "denial") {
  // No permission granted and no auto-accept UI: headless Chromium denies.
  await openChat();
  const before = await page.evaluate(() => window.__m229.gum.length);
  let gumCalls = 0;
  await page.exposeFunction("__noteGum", () => { gumCalls += 1; });
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { window.__noteGum(); return original(c); };
  });
  await pressMic("tap-1");
  await page.waitForTimeout(2500);
  const v1 = await page.evaluate(() => ({ voice: window.__leluVoice ? { active: window.__leluVoice.active, phase: window.__leluVoice.phase, permission: window.__leluVoice.diagnostics.micPermission } : null }));
  const afterTap1 = gumCalls;
  await shot("03-denied");
  result.denial = { getUserMediaCallsForOneTap: afterTap1, stateAfter: v1.voice, buttonCapture: await micButton().getAttribute("data-lelu-voice-capture"), streamsOpen: (await voice())?.diagnostics?.micStreamsOpen ?? 0, priorStreams: before };
}

if (MODE === "visibility") {
  await openChat();
  await pressMic("voice-started");
  await sampleFor(5000, async (v) => v?.active && v?.diagnostics?.micStreamActive);
  const setHidden = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  const gumBefore = (await rec()).gum.length;
  await setHidden(true);
  await page.evaluate(() => window.__m229EndMic());   // the OS takes the mic while hidden
  await page.waitForTimeout(3000);
  const hiddenState = await voice();
  const gumWhileHidden = (await rec()).gum.length - gumBefore;
  const buttonWhileHidden = await micButton().getAttribute("data-lelu-voice-capture");
  await shot("03-hidden-suspended");
  const visibleAt = t();
  await setHidden(false);
  let restoredAt = null;
  await sampleFor(8000, async (v) => { if (v?.diagnostics?.micStreamActive && v.phase === "listening") { restoredAt = t(); return true; } return false; });
  const after = await voice();
  result.visibility = {
    simulatedVisibilityEvent: true,
    whileHidden: { active: hiddenState?.active, phase: hiddenState?.phase, micStreamActive: hiddenState?.diagnostics?.micStreamActive, streamsOpen: hiddenState?.diagnostics?.micStreamsOpen, getUserMediaCalls: gumWhileHidden, button: buttonWhileHidden },
    afterVisible: { restored: Boolean(restoredAt), restoreMs: restoredAt ? restoredAt - visibleAt : null, phase: after?.phase, streamsOpen: after?.diagnostics?.micStreamsOpen, recoveries: after?.diagnostics?.captureRecoveries, button: await micButton().getAttribute("data-lelu-voice-capture") },
  };
  // pagehide releases the microphone and nothing turns it back on.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await page.waitForTimeout(800);
  const afterHide = await voice();
  const tracks = (await rec()).tracks;
  result.pagehide = { active: afterHide?.active, streamsOpen: afterHide?.diagnostics?.micStreamsOpen, allTracksEnded: tracks.flat().every((x) => x === "ended") };
  await shot("04-after-pagehide");
}

result.events = events;
result.apiRequests = apiRequests.filter((r) => !r.path.startsWith("/api/voice/tts")).slice(0, 400);
result.console = consoleLines.slice(-300);
result.samples = sampler.map((s) => ({ t: s.t, phase: s.phase, active: s.active, bargeIns: s.bargeIns, streamsOpen: s.streamsOpen }));
const label = process.env.LELU_RUN_LABEL ? `${MODE}-${process.env.LELU_RUN_LABEL}` : MODE;
writeFileSync(join(OUT, "logs", `e2e-${label}.json`), JSON.stringify(result, null, 2));
console.log(`[${MODE}] wrote logs/e2e-${label}.json`);
await browser.close();
