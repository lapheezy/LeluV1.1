/**
 * Mission 10 — a real multi-turn spoken conversation, paced like a person.
 *
 *   node scripts/verify-voice-conversation.cjs <utteranceDir> <outDir>
 *
 * <utteranceDir> holds u01.mp3…uNN.mp3 (real speech) and lines.json.
 *
 * The microphone is virtual, the audio is real: getUserMedia is answered
 * with a MediaStream fed by Web Audio, and each recorded question is
 * played into it WHEN A PERSON WOULD SPEAK — after LÉLU has answered and is
 * listening again, or (for the interruption) while she is speaking. Every
 * stage after the microphone is LÉLU's own: VoiceEngine's recorder and
 * voice-activity detection, ElevenLabs STT, AIService.chat (existing
 * cognition, memory, tools, the configured provider chain), ElevenLabs TTS
 * and real audio playback. One turn is TYPED in the composer with the real
 * keyboard, to show voice and text share one conversation.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [dir, outDir] = process.argv.slice(2);
const lines = JSON.parse(fs.readFileSync(path.join(dir, "lines.json"), "utf8"));
const BARGE_IN_AT = Number(process.env.LELU_BARGE_IN_AT ?? 12); // 1-based: spoken while she speaks
const TYPED_AFTER = Number(process.env.LELU_TYPED_AFTER ?? 15); // a typed turn after this one
const TYPED = "(typed) Quick check by text: what's my favorite color again? One word.";

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  await ctx.route(/\/__mic\/u\d+\.mp3$/, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ status: 200, contentType: "audio/mpeg", body: fs.readFileSync(path.join(dir, name)) });
  });
  // The virtual microphone: real decoded speech into a real MediaStream.
  await ctx.addInitScript(() => {
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let micCtx = null;
    let dest = null;
    const ensure = () => {
      if (!micCtx) {
        micCtx = new AudioContext({ sampleRate: 48000 });
        dest = micCtx.createMediaStreamDestination();
        // A faint noise floor, like a real room, so the VAD has something to learn.
        const noise = micCtx.createBufferSource();
        const buf = micCtx.createBuffer(1, 48000, 48000);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * 0.002;
        noise.buffer = buf; noise.loop = true; noise.connect(dest); noise.start();
      }
      return dest;
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && constraints.audio && !constraints.video) {
        const out = ensure();
        await micCtx.resume();
        return new MediaStream(out.stream.getAudioTracks().map((t) => t.clone()));
      }
      return realGUM(constraints);
    };
    window.__leluSay = async (url) => {
      ensure();
      await micCtx.resume();
      const data = await (await fetch(url)).arrayBuffer();
      const audio = await micCtx.decodeAudioData(data);
      const src = micCtx.createBufferSource();
      src.buffer = audio;
      src.connect(dest);
      const startedAt = Date.now();
      src.start();
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
  page.on("console", (m) => { if (/VoiceEngine|budget|timed out|ProviderResolver.*(fail|budget|Not trying)/i.test(m.text())) ev("console", { text: m.text().slice(0, 220) }); });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "attached", timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...(g?.querySelectorAll("button") ?? [])].find((b) => /Continue/.test(b.innerText))?.click(); });
  await page.waitForTimeout(3500);
  await page.evaluate(async () => { const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts"); Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "verify", initiatedBy: "lelu" }); });
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
    const e = VoiceEngine.getInstance();
    window.__leluVoice = { phase: "idle", turns: [], speakingSince: 0, audioStops: [] };
    e.onStateChange((s) => { window.__leluVoice.phase = s.phase; if (s.phase === "speaking") window.__leluVoice.speakingSince = Date.now(); window.__leluEvent("phase", { phase: s.phase, error: s.error }); });
    e.onUtterance((u) => window.__leluEvent("utterance", { text: String(u).slice(0, 200), at: Date.now() }));
    e.onTurn((turn) => {
      const v = window.__leluVoice;
      const i = v.turns.findIndex((x) => x.id === turn.id);
      const rec = { id: turn.id, user: turn.user, response: turn.response, at: Date.now() };
      if (i >= 0) v.turns[i] = { ...v.turns[i], ...rec, respondedAt: turn.response ? Date.now() : v.turns[i].respondedAt }; else v.turns.push({ ...rec, startedAt: Date.now() });
      window.__leluEvent("turn", { user: turn.user, response: turn.response ? String(turn.response).slice(0, 240) : null });
    });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) {
      this.addEventListener("playing", () => window.__leluEvent("her-audio", { state: "playing" }), { once: true });
      this.addEventListener("pause", () => window.__leluEvent("her-audio", { state: this.ended ? "ended" : "paused" }), { once: true });
      return play.apply(this, a);
    };
    await e.toggle();
  });
  ev("voice-on", {});
  // The engine tries the browser recognizer first and moves to its own
  // recorder when that cannot capture (a few seconds). A person would see
  // the listening indicator settle; wait the same way before speaking.
  await page.waitForTimeout(Number(process.env.LELU_SETTLE_MS ?? 8000));

  const state = () => page.evaluate(() => ({ phase: window.__leluVoice.phase, turns: window.__leluVoice.turns.length, pending: window.__leluVoice.turns.some((t) => !t.response) }));
  const waitReady = async (maxMs) => {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      const s = await state();
      if (s.phase === "listening" && !s.pending) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };

  if (process.env.LELU_MIC_PROBE) {
    ev("mic-probe", await page.evaluate(async (u) => {
      const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
      const stream = VoiceEngine.getInstance().mediaStream;
      if (!stream) return { stream: false };
      const ctx = new AudioContext(); await ctx.resume();
      const an = ctx.createAnalyser(); ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      const timer = setInterval(() => { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }, 50);
      await window.__leluSay(u);
      clearInterval(timer);
      return { stream: true, tracks: stream.getAudioTracks().map((t) => ({ state: t.readyState, muted: t.muted, enabled: t.enabled, label: t.label })), peakWhileSpeaking: Math.round(peak * 1000) / 1000 };
    }, `${BASE}__mic/u01.mp3`));
  }

  const turns = [];
  // Written after every turn, so a later failure never loses earlier turns.
  const checkpoint = async () => {
    const live = await page.evaluate(() => ({ turns: window.__leluVoice.turns, ledger: (JSON.parse(localStorage.getItem("lelu.usage.v1") || "{}").events ?? []).map((x) => ({ kind: x.kind, source: x.source, op: x.operation, ok: x.ok, model: x.model, in: x.inputTokens, out: x.outputTokens, results: x.results, cost: x.costKind, usd: x.costUsd, ms: x.latencyMs, error: x.error })) })).catch(() => ({}));
    fs.writeFileSync(path.join(outDir, "voice-conversation.partial.json"), JSON.stringify({ at: new Date().toISOString(), spoken: turns, events, ...live }, null, 1) + "\n");
  };
  for (let i = 1; i <= lines.length; i += 1) {
    const file = `u${String(i).padStart(2, "0")}.mp3`;
    let mode = "after-reply";
    if (i === BARGE_IN_AT) {
      // Interrupt: wait until she has been speaking for ~2 s.
      mode = "barge-in";
      const until = Date.now() + 150000;
      while (Date.now() < until) {
        const sp = await page.evaluate(() => (window.__leluVoice.phase === "speaking" ? Date.now() - window.__leluVoice.speakingSince : 0));
        if (sp > 2000) break;
        await page.waitForTimeout(250);
      }
    } else {
      const ready = await waitReady(180000);
      if (!ready) ev("not-ready", { before: i });
      await page.waitForTimeout(800);
    }
    const heardBefore = events.filter((e) => e.kind === "utterance").length;
    let said = await page.evaluate((u) => window.__leluSay(u), `${BASE}__mic/${file}`);
    ev("user-said", { n: i, mode, text: lines[i - 1], seconds: Math.round(said.seconds * 10) / 10 });
    // Like a person who was not heard: if no transcript arrives, say it once more.
    let repeated = false;
    const heard = async (ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (events.filter((e) => e.kind === "utterance").length > heardBefore) return true;
        await page.waitForTimeout(300);
      }
      return false;
    };
    if (!(await heard(15000)) && mode !== "barge-in") {
      repeated = true;
      said = await page.evaluate((u) => window.__leluSay(u), `${BASE}__mic/${file}`);
      ev("user-repeated", { n: i });
    }
    const wasHeard = await heard(15000);
    turns.push({ n: i, mode, text: lines[i - 1], spokeAt: said.startedAt - t0, endedAt: said.endedAt - t0, repeated, heard: wasHeard });
    await checkpoint();

    if (i === TYPED_AFTER) {
      await waitReady(180000);
      try {
        // A real click: if anything covers the composer, that is a finding.
        await page.click("[data-lelu-composer] textarea", { timeout: 8000 });
        await page.keyboard.type(TYPED, { delay: 15 });
        await page.keyboard.press("Enter");
        ev("user-typed", { text: TYPED });
      } catch (error) {
        const cover = await page.evaluate(() => {
          const t = document.querySelector("[data-lelu-composer] textarea");
          if (!t) return "no composer";
          const r = t.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return top ? `${top.tagName}${top.getAttribute("data-spatial-nav") !== null ? "[data-spatial-nav]" : ""}.${String(top.className).slice(0, 40)}` : "nothing";
        });
        await page.screenshot({ path: path.join(outDir, "typed-turn-blocked.png") });
        ev("user-typed-blocked", { reason: String(error).split("\n")[0].slice(0, 160), coveredBy: cover });
      }
      await page.waitForTimeout(3000);
    }
    await checkpoint();
  }
  await waitReady(180000);
  await page.waitForTimeout(4000);

  const final = await page.evaluate(async () => {
    const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
    const { default: MultiChatStore } = await import("/src/core/multichat/MultiChatStore.ts");
    const e = VoiceEngine.getInstance();
    const M = MultiChatStore.getInstance();
    const conv = M.get?.(M.getActiveId()) ?? null;
    const transcript = (conv?.messages ?? []).map((m) => ({ role: m.role, text: String(m.text).slice(0, 300) }));
    const ledger = (JSON.parse(localStorage.getItem("lelu.usage.v1") || "{}").events ?? []).map((x) => ({ kind: x.kind, source: x.source, op: x.operation, ok: x.ok, model: x.model, in: x.inputTokens, out: x.outputTokens, results: x.results, cost: x.costKind, usd: x.costUsd, ms: x.latencyMs, error: x.error }));
    const out = { bargeIns: e.getBargeInCount(), turns: window.__leluVoice.turns, transcript, ledger };
    if (e.getState().active) await e.toggle();
    return out;
  });
  await page.screenshot({ path: path.join(outDir, "conversation-final.png") });
  fs.writeFileSync(path.join(outDir, "voice-conversation.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, spoken: turns, typed: TYPED, events, ...final }, null, 1) + "\n");
  console.log(JSON.stringify({ spoken: turns.length, voiceTurns: final.turns.length, bargeIns: final.bargeIns, transcriptMessages: final.transcript.length }));
  await browser.close();
})();
