/**
 * LÉLU — END-TO-END MICROPHONE TEST (M23 WP02)
 *
 * Drives the real chat microphone button (VoiceToggle) in Chromium against a
 * running LÉLU server (server.ts or vite), on a desktop or iPhone-13-sized
 * viewport:
 *   granted   — a fake microphone plays a recorded sentence; checks the button
 *               state, that audio is POSTed to /api/model/groq/audio/transcriptions
 *               with no credential from the page, the transcript in the chat,
 *               and stop.
 *   denied    — getUserMedia rejects NotAllowedError (the user said no).
 *   nodevice  — getUserMedia rejects NotFoundError (no microphone).
 * The browser recognizer is removed so the path that sends audio to the
 * server is the one exercised (the Safari/Firefox path).
 *
 * NOT a physical-device test: Chromium emulating an iPhone is not Safari.
 *
 *   node scripts/e2e/mic-e2e.cjs <desktop|iphone> <granted|denied|nodevice>
 *   env: LELU_URL (default http://localhost:4173), SHOTS (screenshot dir)
 * Needs ffmpeg (to build the padded fake-microphone WAV).
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const [, , device = 'desktop', scenario = 'granted'] = process.argv;
const BASE = process.env.LELU_URL || 'http://localhost:4173';
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'lelu-mic-'));
fs.mkdirSync(SHOTS, { recursive: true });
// 1.5 s silence + a recorded sentence + 6 s silence (so turn detection ends the utterance).
const wav = path.join(os.tmpdir(), 'lelu-mic-input.wav');
if (!fs.existsSync(wav)) {
  const speech = path.resolve(__dirname, '../../MISSION-22.7/audio/reply-01.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-t', '1.5', '-i', 'anullsrc=r=48000:cl=mono', '-i', speech, '-f', 'lavfi', '-t', '6', '-i', 'anullsrc=r=48000:cl=mono',
    '-filter_complex', '[1:a]aresample=48000,aformat=channel_layouts=mono[s];[0:a][s][2:a]concat=n=3:v=0:a=1', '-c:a', 'pcm_s16le', wav]);
}
(async () => {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'];
  // A project-pinned Playwright may not match the browsers installed on the
  // machine: use CHROMIUM_PATH, or a preinstalled Chromium when one exists.
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const b = await chromium.launch({ args, ...(executablePath ? { executablePath } : {}) });
  const opts = device === 'iphone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } };
  const ctx = await b.newContext(opts);
  if (scenario === 'granted') await ctx.grantPermissions(['microphone'], { origin: BASE });
  const p = await ctx.newPage();
  if (scenario === 'denied' || scenario === 'nodevice') {
    const name = scenario === 'denied' ? 'NotAllowedError' : 'NotFoundError';
    await p.addInitScript((n) => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException(n === 'NotAllowedError' ? 'Permission denied' : 'Requested device not found', n)); }, name);
  }
  // Measure the audio actually posted: the size of each file part in the FormData.
  await p.addInitScript(() => {
    const real = window.fetch; window.__leluAudioBytes = [];
    window.fetch = function (input, init) {
      const url = String(input && input.url ? input.url : input);
      if (url.includes('audio/transcriptions') && init && init.body instanceof FormData) {
        for (const [k, v] of init.body.entries()) if (v instanceof Blob) window.__leluAudioBytes.push({ field: k, bytes: v.size, type: v.type });
      }
      return real.apply(this, arguments);
    };
  });
  await p.addInitScript(() => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined }); } catch {} });
  const log = (...a) => console.log(`[${device}/${scenario} +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
  const t0 = Date.now();
  p.on('console', (m) => { const t = m.text(); if (/VoiceEngine|voice|Whisper|transcri/i.test(t)) log('console:', t.slice(0, 160)); });
  const transcriptions = [];
  p.on('response', async (r) => {
    if (r.url().includes('/audio/transcriptions')) {
      const req = r.request(); const body = await r.text().catch(() => '');
      const sentAuth = Object.keys(req.headers()).filter((h) => /authorization|api-key/i.test(h));
      const audioBytes = await p.evaluate(() => window.__leluAudioBytes || []).catch(() => []);
      transcriptions.push({ status: r.status(), audioFileBytes: audioBytes, sentAuthHeaders: sentAuth, body });
      log('TRANSCRIPTION', r.status(), 'audio file bytes (in page)', JSON.stringify(transcriptions.at(-1).audioFileBytes), 'auth headers from page:', sentAuth.length, body.slice(0, 160));
    }
  });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(7000);
  await p.getByRole('button', { name: 'Chat', exact: true }).first().click();
  await p.waitForTimeout(3000);
  const mic = p.locator('[data-lelu-voice-toggle]').first();
  await mic.waitFor({ state: 'visible', timeout: 15000 });
  const read = async () => ({ pressed: await mic.getAttribute('aria-pressed'), phase: await mic.getAttribute('data-lelu-voice-phase'), capture: await mic.getAttribute('data-lelu-voice-capture'), label: await mic.getAttribute('aria-label') });
  log('before', JSON.stringify(await read()));
  await p.screenshot({ path: `${SHOTS}/mic-${device}-${scenario}-0-idle.png` });
  await mic.click();
  await p.waitForTimeout(2500);
  log('after start', JSON.stringify(await read()));
  await p.screenshot({ path: `${SHOTS}/mic-${device}-${scenario}-1-recording.png` });
  if (scenario === 'denied' || scenario === 'nodevice') {
    await p.waitForTimeout(2000);
    const text = await p.evaluate(() => document.body.innerText);
    const m = text.split('\n').filter((l) => /microphone|permission|mic/i.test(l)).slice(0, 5);
    log('visible error lines:', JSON.stringify(m));
    const alert = await p.$eval('[data-lelu-voice-error]', (e) => { const r = e.getBoundingClientRect(); const c = document.elementFromPoint(r.x + 12, r.y + r.height / 2); return { text: e.innerText, kind: e.getAttribute('data-lelu-voice-error'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inViewport: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, onTop: e.contains(c) }; }).catch(() => null);
    log('MIC ALERT', JSON.stringify(alert));
    await p.screenshot({ path: `${SHOTS}/mic-${device}-${scenario}-2-error.png` });
  } else {
    for (let i = 0; i < 40 && transcriptions.length === 0; i++) await p.waitForTimeout(1000);
    await p.waitForTimeout(4000);
    const text = await p.evaluate(() => document.body.innerText);
    log('state', JSON.stringify(await read()));
    await p.screenshot({ path: `${SHOTS}/mic-${device}-${scenario}-2-transcribed.png` });
    await mic.click();
    await p.waitForTimeout(1500);
    log('after stop', JSON.stringify(await read()));
    await p.screenshot({ path: `${SHOTS}/mic-${device}-${scenario}-3-stopped.png` });
    const t = transcriptions.find((x) => x.status === 200);
    let said = ''; try { said = t ? (JSON.parse(t.body).text || '').trim() : ''; } catch {}
    log('transcript in chat:', said ? text.includes(said.slice(0, 25)) : 'n/a', JSON.stringify(said.slice(0, 80)));
  }
  console.log('SHOTS', SHOTS);
  console.log('RESULT', JSON.stringify({ device, scenario, transcriptions: transcriptions.map((x) => ({ ...x, body: x.body.slice(0, 160) })) }));
  await b.close();
})();
