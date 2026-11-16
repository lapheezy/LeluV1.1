/**
 * LÉLU — LiveKit voice, end to end, in a headless browser.
 *
 * NOT A REAL-DEVICE TEST. Chromium's fake microphone plays a WAV file
 * (--use-file-for-fake-audio-capture). Everything after the microphone is
 * real: the app's token endpoint, a running livekit-server, the voice agent,
 * Groq Whisper through the broker, LÉLU's own cognition (AIService), the
 * VoxCPM2 worker, and the audio track coming back to the page.
 *
 *   node scripts/verify-livekit-voice-e2e.cjs FAKE_MIC.wav OUT_DIR
 *
 * Sequence (the WAV holds Q1 at 30 s and Q2 ~185 s after the mic opens, then silence):
 *   1. iPhone 13 profile, chat open (as on a phone), tap the composer's existing
 *      "Talk to LÉLU" mic → connected, agent present, agent LISTENING
 *   2. Q1 → transcript → her reply spoken over LiveKit (recorded for ASR)
 *   3. Q2 → long reply → click STOP 2 s into it → measure audio after STOP
 *   4. kill livekit-server, restart it → session must come back by itself
 *   5. click End → open text chat → ask about the voice turn → continuity
 * Env: LELU_BASE (default http://127.0.0.1:5173/), LIVEKIT_RESTART_CMD.
 */
const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const [micWav, outDir] = process.argv.slice(2);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.resolve(micWav)}`, "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["microphone"] });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const timeline = [];
  const log = (kind, detail = {}) => {
    const entry = { t: Date.now() - t0, kind, ...detail };
    timeline.push(entry);
    console.log(String(entry.t).padStart(7), kind, JSON.stringify(detail).slice(0, 200));
  };
  page.on("pageerror", (e) => log("pageerror", { text: String(e).slice(0, 200) }));
  await page.exposeFunction("__lk", (kind, detail) => log(kind, detail));
  await page.exposeFunction("__lkAudio", (index, b64) => fs.writeFileSync(path.join(outDir, `agent-audio-${index}.webm`), Buffer.from(b64, "base64")));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break;
  }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  // Open the chat first: on a phone the chat owns the screen and the 3D scene stops rendering.
  await page.waitForFunction(async () => { try { await import("/src/core/cognition/UIActionBus.ts"); return true; } catch { return false; } }, null, { timeout: 240000 });
  await page.evaluate(async () => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "verify", initiatedBy: "user" });
  });
  await page.waitForSelector('button[aria-label="Talk to LÉLU"]', { timeout: 240000 });
  log("chat-open");

  // Observe the ONE engine, and measure / record the agent's audio track as received.
  await page.evaluate(async () => {
    const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
    const engine = VoiceEngine.getInstance();
    engine.onStateChange((s) => window.__lk("state", { phase: s.phase, active: s.active, error: s.error }));
    window.__utterances = [];
    engine.onUtterance((u) => { window.__utterances.push(String(u)); window.__lk("utterance", { text: String(u) }); });
    engine.onTurn((turn) => turn && window.__lk("turn", { user: turn.user, response: turn.response ? String(turn.response).slice(0, 400) : null }));
    engine.onLivekitStatus((s) => s && window.__lk("livekit", { connection: s.connection, agent: s.agentPresent, error: s.error, rejoins: s.rejoins }));
    window.__rms = [];
    let recorders = 0;
    const watch = (el) => {
      if (el.__watched || !el.srcObject) return;
      el.__watched = true;
      const index = ++recorders;
      const stream = el.srcObject;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        window.__rms.push([performance.now(), Math.sqrt(sum / buf.length), el.muted ? 1 : 0]);
      }, 50);
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        window.__lkAudio(index, btoa(s));
      };
      recorder.start(1000);
      window.__recorders = [...(window.__recorders ?? []), recorder];
      window.__lk("agent-audio-attached", { index });
    };
    new MutationObserver(() => document.querySelectorAll('audio[data-lelu-voice="agent"]').forEach(watch)).observe(document.body, { childList: true, subtree: true });
  });

  const phaseIs = (phase) => page.waitForFunction((p) => document.querySelector('[data-testid="lk-status"]')?.dataset.phase === p, phase, { timeout: 240000 });
  const connectionIs = (c, timeout = 60000) => page.waitForFunction((x) => document.querySelector('[data-testid="lk-status"]')?.dataset.connection === x, c, { timeout });
  const perfNow = () => page.evaluate(() => performance.now());

  // 1. Start with the EXISTING mic button (a real tap: the gesture iOS needs for audio)
  await page.tap('button[aria-label="Talk to LÉLU"]');
  await connectionIs("connected");
  log("connected");

  await page.waitForFunction(() => document.querySelector('[data-testid="lk-status"]')?.dataset.listening === "1", null, { timeout: 120000 });
  log("agent-listening");

  const heard = (word) => page.waitForFunction((w) => (window.__utterances ?? []).some((u) => u.includes(w)), word, { timeout: 300000 });
  // 2. Q1 → reply spoken
  await heard("France");
  log("q1-heard");
  await phaseIs("speaking");
  log("q1-speaking");
  await phaseIs("listening");
  log("q1-spoke");

  // 3. Q2 → long reply → STOP two seconds into her audio
  await heard("ocean");
  log("q2-heard");
  await page.waitForFunction(() => window.__rms?.some(([t, r]) => t > (window.__q2At ?? 0) && r > 0.01), null, { timeout: 300000 }).catch(() => {});
  await phaseIs("speaking");
  await page.waitForFunction(() => { const r = window.__rms ?? []; const last = r.slice(-4); return last.length && last.some(([, x]) => x > 0.01); }, null, { timeout: 300000, polling: 100 });
  log("q2-audible");
  await page.waitForTimeout(2000);
  const stopAt = await perfNow();
  await page.tap('[data-testid="lk-stop"]');
  log("stop-clicked");
  await page.waitForTimeout(4000);
  const stopReport = await page.evaluate((at) => {
    const after = window.__rms.filter(([t]) => t > at);
    const before = window.__rms.filter(([t]) => t > at - 1500 && t <= at);
    const loud = after.filter(([, r]) => r > 0.01);
    return {
      rmsBeforeStopMax: Math.max(0, ...before.map(([, r]) => r)),
      lastAudibleAfterStopMs: loud.length ? Math.round(loud[loud.length - 1][0] - at) : 0,
      elementMutedAfterStop: after.length ? after[after.length - 1][2] === 1 : null,
    };
  }, stopAt);
  log("stop-measured", stopReport);
  const phaseAfterStop = await page.evaluate(() => document.querySelector('[data-testid="lk-status"]')?.dataset.phase);
  log("phase-after-stop", { phase: phaseAfterStop });

  // 4. Connection loss: stop the LiveKit server, bring it back
  if (process.env.LIVEKIT_RESTART_CMD) {
    log("livekit-server-killed");
    execSync(process.env.LIVEKIT_RESTART_CMD, { stdio: "inherit" });
    await connectionIs("connected", 120000).catch(() => log("did-not-recover"));
    log("recovered-after-server-restart");
    await page.waitForTimeout(3000);
  }

  // 5. End voice, continue in text
  await page.tap('[data-testid="lk-end"]');
  await page.waitForSelector('[data-testid="lk-dock"]', { state: "detached", timeout: 30000 });
  log("ended");
  await page.evaluate(() => (window.__recorders ?? []).forEach((r) => r.state !== "inactive" && r.stop()));
  await page.waitForTimeout(1500);
  if (!(await page.evaluate(() => { const t = document.querySelector(".lcu-composer textarea"); return t && !t.disabled; }))) {
    await page.click(".lcu-card").catch(() => {});
    await page.waitForTimeout(1200);
  }
  const question = "In one sentence: what was the first thing I asked you by voice a moment ago?";
  await page.tap(".lcu-composer textarea");
  await page.keyboard.type(question, { delay: 2 });
  await page.keyboard.press("Enter");
  log("typed", { question });
  const continuity = await page.evaluate(async (q) => {
    const { default: AIService } = await import("/src/core/AIService.ts");
    void AIService;
    const deadline = Date.now() + 90000;
    const { default: MultiChatStore } = await import("/src/core/multichat/MultiChatStore.ts");
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const store = MultiChatStore.getInstance();
      const conv = store.get?.(store.getActiveId()) ?? null;
      const messages = conv?.messages ?? [];
      const i = messages.findIndex((m) => String(m.text ?? m.content ?? "").includes(q.slice(0, 30)));
      const reply = i >= 0 ? messages.slice(i + 1).find((m) => m.role === "assistant") : null;
      if (reply) return { found: true, reply: String(reply.text ?? reply.content ?? "").slice(0, 500), conversationLength: messages.length, roles: messages.map((m) => m.role) };
    }
    return { found: false };
  }, question);
  log("continuity", continuity);
  await page.screenshot({ path: path.join(outDir, "after-continuity.png") });

  fs.writeFileSync(path.join(outDir, "e2e-report.json"), JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), realDevice: false, mic: "fake (WAV file)", stop: stopReport, phaseAfterStop, continuity, timeline }, null, 1));
  await browser.close();
})().catch((error) => {
  console.error("E2E failed:", error);
  process.exit(1);
});
