/**
 * Mission 10.3 — voice reliability: six scenarios, each in a fresh page,
 * each spoken into a virtual microphone (real decoded speech → MediaStream →
 * LÉLU's own recorder → ElevenLabs Scribe), answered by the enabled provider.
 *
 *   node scripts/verify-voice-reliability.cjs <clipDir> <outDir> [scenario,...]
 *
 * clipDir holds u01.mp3… and lines.json (the 20-turn run's clips, reused —
 * no new synthesis). Failures are INJECTED only at the network edge with
 * Playwright routes, never inside the app:
 *   first-sentence     the very first utterance is transcribed, answered, and played by ElevenLabs
 *   provider-timeout   /api/model/** never answers → the resolver's own budget fires;
 *                      must NOT read as a user Stop, must NOT be spoken as an answer
 *   network-failure    /api/model/** aborted (internet disconnected)
 *   transcription      /api/voice/stt → 500
 *   playback           /api/voice/tts → 500
 *   user-cancellation  speak over her long reply → playback and generation stop,
 *                      and the next turn runs normally
 * After every injected failure the route is removed and one more turn is
 * spoken: recovery means a normal answer, in the same conversation.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [clipDir, outDir, only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const lines = JSON.parse(fs.readFileSync(path.join(clipDir, "lines.json"), "utf8"));
const clip = (n) => `u${String(n).padStart(2, "0")}.mp3`;

async function openVoicePage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  await ctx.route(/\/__mic\/u\d+\.mp3$/, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ status: 200, contentType: "audio/mpeg", body: fs.readFileSync(path.join(clipDir, name)) });
  });
  await ctx.addInitScript(() => {
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let micCtx = null; let dest = null;
    const ensure = () => {
      if (!micCtx) {
        micCtx = new AudioContext({ sampleRate: 48000 });
        dest = micCtx.createMediaStreamDestination();
        const noise = micCtx.createBufferSource();
        const buf = micCtx.createBuffer(1, 48000, 48000);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * 0.002;
        noise.buffer = buf; noise.loop = true; noise.connect(dest); noise.start();
      }
      return dest;
    };
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (c && c.audio && !c.video) { const out = ensure(); await micCtx.resume(); return new MediaStream(out.stream.getAudioTracks().map((t) => t.clone())); }
      return realGUM(c);
    };
    window.__leluSay = async (url) => {
      ensure(); await micCtx.resume();
      const audio = await micCtx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const src = micCtx.createBufferSource(); src.buffer = audio; src.connect(dest);
      const startedAt = Date.now(); src.start();
      await new Promise((r) => { src.onended = r; });
      return { startedAt, endedAt: Date.now(), seconds: audio.duration };
    };
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const events = [];
  const ev = (kind, detail) => events.push({ t: Date.now() - t0, kind, ...detail });
  await page.exposeFunction("__leluEvent", (kind, detail) => ev(kind, detail));
  page.on("pageerror", (e) => ev("pageerror", { text: String(e).slice(0, 200) }));
  page.on("request", (r) => { const u = r.url(); if (/\/api\/voice\/(tts|stt)|\/api\/model\//.test(u)) ev("req", { url: new URL(u).pathname }); });
  page.on("response", (r) => { const u = r.url(); if (/\/api\/voice\/(tts|stt)/.test(u)) ev("res", { url: new URL(u).pathname, status: r.status() }); });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "attached", timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...(g?.querySelectorAll("button") ?? [])].find((b) => /Continue/.test(b.innerText))?.click(); });
  await page.waitForTimeout(3500);
  await page.evaluate(async () => { const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts"); Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "verify", initiatedBy: "lelu" }); });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
    const e = VoiceEngine.getInstance();
    window.__leluVoice = { phase: "idle", turns: [], speakingSince: 0, failures: [] };
    e.onStateChange((s) => {
      window.__leluVoice.phase = s.phase;
      if (s.phase === "speaking") window.__leluVoice.speakingSince = Date.now();
      if (s.turnFailure && window.__leluVoice.failures[window.__leluVoice.failures.length - 1]?.at !== s.turnFailure.at) {
        window.__leluVoice.failures.push(s.turnFailure);
        window.__leluEvent("failure", { failure: s.turnFailure });
      }
      window.__leluEvent("phase", { phase: s.phase, error: s.error, errorKind: s.errorKind });
    });
    e.onUtterance((u) => window.__leluEvent("utterance", { text: String(u).slice(0, 200), at: Date.now() }));
    e.onTurn((turn) => {
      const v = window.__leluVoice;
      const i = v.turns.findIndex((x) => x.id === turn.id);
      const rec = { id: turn.id, user: turn.user, response: turn.response, failure: turn.failure ?? null, at: Date.now() };
      if (i >= 0) v.turns[i] = { ...v.turns[i], ...rec, respondedAt: turn.response ? Date.now() : v.turns[i].respondedAt }; else v.turns.push({ ...rec, startedAt: Date.now() });
      window.__leluEvent("turn", { user: turn.user, response: turn.response ? String(turn.response).slice(0, 240) : null, failure: turn.failure ?? null });
    });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) {
      this.addEventListener("playing", () => window.__leluEvent("her-audio", { state: "playing" }), { once: true });
      this.addEventListener("pause", () => window.__leluEvent("her-audio", { state: this.ended ? "ended" : "paused" }), { once: true });
      return play.apply(this, a);
    };
    await e.toggle();
  });
  await page.waitForTimeout(Number(process.env.LELU_SETTLE_MS ?? 5000));
  return { ctx, page, events, t0 };
}

const voice = (page) => page.evaluate(() => ({ phase: window.__leluVoice.phase, turns: window.__leluVoice.turns, failures: window.__leluVoice.failures }));

async function waitFor(page, pred, maxMs) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const v = await voice(page);
    if (pred(v)) return v;
    await page.waitForTimeout(500);
  }
  return null;
}

/** Speak line n; wait for its turn to settle (answer or failure) and for her to stop speaking. */
async function say(page, events, n, { maxMs = 200_000, expectHeard = true } = {}) {
  const before = (await voice(page)).turns.length;
  const utterancesBefore = events.filter((e) => e.kind === "utterance").length;
  const said = await page.evaluate((u) => window.__leluSay(u), `${BASE}__mic/${clip(n)}`);
  let heardAt = null;
  const t = Date.now();
  while (Date.now() - t < 20000) {
    const u = events.filter((e) => e.kind === "utterance");
    if (u.length > utterancesBefore) { heardAt = u[u.length - 1]; break; }
    await page.waitForTimeout(250);
  }
  if (!heardAt && !expectHeard) return { said, heard: null, turn: null };
  const settled = await waitFor(page, (v) => v.turns.length > before && v.turns[v.turns.length - 1].response !== null && v.phase !== "speaking" && v.phase !== "processing", maxMs);
  const v = settled ?? (await voice(page));
  const turn = v.turns.length > before ? v.turns[v.turns.length - 1] : null;
  return {
    line: lines[n - 1],
    heard: heardAt?.text ?? null,
    sttLatencyMs: heardAt ? heardAt.at - said.endedAt : null,
    replyLatencyMs: turn?.respondedAt ? turn.respondedAt - said.endedAt : null,
    response: turn?.response ? String(turn.response).slice(0, 400) : null,
    failure: turn?.failure ?? null,
    settled: Boolean(settled),
  };
}

const ttsRequestsBetween = (events, from, to) => events.filter((e) => e.kind === "req" && /\/api\/voice\/tts/.test(e.url) && e.t >= from && e.t <= to).length;

const SCENARIOS = {
  async "first-sentence"(page, events, t0) {
    const start = Date.now() - t0;
    const r = await say(page, events, 2);
    const end = Date.now() - t0;
    const audio = events.filter((e) => e.kind === "her-audio" && e.t >= start && e.t <= end).map((e) => e.state);
    const tts = events.filter((e) => e.kind === "res" && /tts/.test(e.url) && e.t >= start).map((e) => e.status);
    return { ...r, herAudio: audio, ttsStatuses: tts, pass: Boolean(r.heard && /peru/i.test(r.heard) && r.response && !r.failure && audio.includes("playing") && tts.includes(200)) };
  },
  async "provider-timeout"(page, events, t0) {
    await page.route(/\/api\/model\//, () => { /* never answers: the resolver's own budget must fire */ });
    const start = Date.now() - t0;
    const r = await say(page, events, 4, { maxMs: 240_000 });
    const end = Date.now() - t0;
    await page.unroute(/\/api\/model\//);
    const spokenTts = ttsRequestsBetween(events, start + 1, end);
    const recovery = await say(page, events, 5);
    return {
      failed: r, ttsRequestsDuringFailure: spokenTts, recovery,
      notTreatedAsStop: !/^Stopped/.test(r.response ?? "") && r.failure?.kind !== "user-cancellation",
      pass: r.failure?.kind === "provider-timeout" && spokenTts === 0 && !/^Stopped/.test(r.response ?? "") && Boolean(recovery.response) && !recovery.failure,
    };
  },
  async "network-failure"(page, events, t0) {
    await page.route(/\/api\/model\//, (route) => route.abort("internetdisconnected"));
    const start = Date.now() - t0;
    const r = await say(page, events, 7, { maxMs: 120_000 });
    const end = Date.now() - t0;
    await page.unroute(/\/api\/model\//);
    const recovery = await say(page, events, 8);
    return { failed: r, ttsRequestsDuringFailure: ttsRequestsBetween(events, start + 1, end), recovery, pass: r.failure?.kind === "network-failure" && ttsRequestsBetween(events, start + 1, end) === 0 && Boolean(recovery.response) && !recovery.failure };
  },
  async transcription(page, events) {
    // Both transcription engines fail: ElevenLabs Scribe and the Whisper fallback.
    await page.route(/\/api\/voice\/stt|audio\/transcriptions/, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "injected transcription failure" }) }));
    const before = (await voice(page)).failures.length;
    await page.evaluate((u) => window.__leluSay(u), `${BASE}__mic/${clip(13)}`);
    const v = await waitFor(page, (x) => x.failures.length > before, 40_000);
    await page.unroute(/\/api\/voice\/stt|audio\/transcriptions/);
    const failure = v ? v.failures[v.failures.length - 1] : null;
    await page.waitForTimeout(1500);
    const recovery = await say(page, events, 13);
    return { failure, recovery, pass: failure?.kind === "transcription-failure" && Boolean(recovery.heard) && Boolean(recovery.response) };
  },
  async playback(page, events) {
    await page.route(/\/api\/voice\/tts/, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "injected playback failure" }) }));
    const before = (await voice(page)).failures.length;
    const r = await say(page, events, 14);
    await page.unroute(/\/api\/voice\/tts/);
    const v = await voice(page);
    const failure = v.failures.slice(before).find((f) => f.kind === "playback-failure") ?? null;
    return { ...r, failure, pass: Boolean(r.response) && failure?.kind === "playback-failure" && !/couldn't process/i.test(r.response ?? "") };
  },
  async "user-cancellation"(page, events, t0) {
    // A long answer, then speak over her once she has been speaking ~2 s.
    const said = page.evaluate((u) => window.__leluSay(u), `${BASE}__mic/${clip(11)}`);
    await said;
    const speaking = await waitFor(page, (v) => v.phase === "speaking", 200_000);
    if (!speaking) return { pass: false, reason: "she never started speaking the long answer" };
    await page.waitForTimeout(2000);
    const cutAt = Date.now() - t0;
    const r = await say(page, events, 12);
    const pausedAfterCut = events.some((e) => e.kind === "her-audio" && e.state === "paused" && e.t >= cutAt);
    const v = await voice(page);
    const cancelled = v.failures.find((f) => f.kind === "user-cancellation") ?? null;
    const next = await say(page, events, 16);
    return { interruption: r, playbackStopped: pausedAfterCut, cancellationRecorded: cancelled, nextTurn: next, pass: pausedAfterCut && Boolean(r.response) && !r.failure && Boolean(next.response) && !next.failure };
  },
};

async function run() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const results = {};
  const names = only ? only.split(",") : Object.keys(SCENARIOS);
  for (const name of names) {
    const { ctx, page, events, t0 } = await openVoicePage(browser);
    let r;
    try { r = await SCENARIOS[name](page, events, t0); } catch (error) { r = { pass: false, error: String(error).slice(0, 300) }; }
    // History: every turn of this scenario is in the conversation.
    r.history = await page.evaluate(async () => {
      const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
      return (M.getActive()?.messages ?? []).map((m) => ({ role: m.role, text: String(m.text ?? "").slice(0, 160) }));
    }).catch(() => null);
    r.events = events.filter((e) => e.kind !== "phase");
    await page.screenshot({ path: path.join(outDir, `${name}.png`) }).catch(() => {});
    results[name] = r;
    fs.writeFileSync(path.join(outDir, "voice-reliability.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, results }, null, 1) + "\n");
    console.log(JSON.stringify({ scenario: name, pass: r.pass, summary: { heard: r.heard ?? r.failed?.heard ?? r.interruption?.heard, failure: r.failure ?? r.failed?.failure, response: String(r.response ?? r.failed?.response ?? r.interruption?.response ?? "").slice(0, 120) } }));
    await ctx.close();
  }
  await browser.close();
  process.exitCode = Object.values(results).every((r) => r.pass) ? 0 : 1;
}
run();
