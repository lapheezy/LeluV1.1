/**
 * ==========================================================
 * LÉLU — TURN DETECTION ON THE AUDIO THREAD
 *
 * The same rule as VoiceEngine's main-thread detector — noise floor
 * from the first 300 ms (capped, in case the person is already
 * talking), speech after 150 ms above it, the turn ends after 900 ms
 * below it (or below a fifth of the speaker's own peak, for automatic
 * gain control), 20 s cap, nothing said in 10 s → no turn — but
 * measured in AUDIO time inside an AudioWorklet.
 *
 * On the main thread the measurement rides on setInterval, and a busy
 * page (a 3D scene, a long reply rendering) delays those ticks by whole
 * seconds: turns were cut or ran past their end. The audio thread is
 * not delayed by the page, so the decision is right even when the page
 * hears about it late.
 *
 * Live conversation: the detector also reports the ONSET of speech (150 ms
 * of speech energy with at least one voiced 50 ms window), not only the end
 * of the turn, and how much of the turn was voiced (see TurnResult.voicedMs).
 * That is what lets her stop talking when the person starts, instead of
 * after they have finished and been transcribed.
 * ==========================================================
 */

export interface TurnResult {
  spoke: boolean;
  /**
   * Milliseconds of VOICED sound in the turn: periodic at a speaking pitch
   * (70–400 Hz) after pre-emphasis. Noise, a clatter, a cough or a fan has
   * none (measured: pink, brown, white noise and noise bursts 0 ms; real
   * speech at least 200 ms per 3 s). Whisper turns such sound into "Thank
   * you." or "."; a turn without voiced sound is not sent to it.
   */
  voicedMs: number;
  ms: number;
  peak: number;
  threshold: number;
  silenceMs: number;
}

/** The processor's source (exported so its rule can be tested off the audio thread). */
export const TURN_DETECTOR_SOURCE = `
class LeluTurnDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.t = 0; this.sum = 0; this.n = 0; this.floor = []; this.threshold = 0.015;
    this.speech = 0; this.silence = 0; this.spoke = false; this.peak = 0; this.done = false;
    this.window = Math.round(sampleRate * 0.05);
    // Voicing: decimate to ~12 kHz, pre-emphasise (whitens noise), and look for
    // a strong autocorrelation peak at a speaking pitch, per 50 ms.
    this.dec = Math.max(1, Math.round(sampleRate / 12000));
    this.vsr = sampleRate / this.dec;
    this.vwin = Math.round(this.vsr * 0.05);
    this.vbuf = new Float32Array(this.vwin); this.vn = 0; this.acc = 0; this.accN = 0; this.prev = 0;
    this.minLag = Math.round(this.vsr / 400); this.maxLag = Math.round(this.vsr / 70);
    this.voiced = 0; this.onsetSent = false;
    this.port.onmessage = (e) => { if (e.data === "stop") this.finish(); };
  }
  finish() {
    if (this.done) return;
    this.done = true;
    this.port.postMessage({ spoke: this.spoke, ms: this.t, peak: this.peak, threshold: this.threshold, silenceMs: this.silence, voicedMs: this.voiced });
  }
  process(inputs) {
    if (this.done) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i] * channel[i];
      this.acc += channel[i]; this.accN += 1;
      if (this.accN === this.dec) {
        const x = this.acc / this.dec; this.acc = 0; this.accN = 0;
        this.vbuf[this.vn++] = x - 0.95 * this.prev; this.prev = x;
        if (this.vn === this.vwin) { this.voicing(); this.vn = 0; }
      }
    }
    this.n += channel.length;
    if (this.n >= this.window) {
      this.step(Math.sqrt(this.sum / this.n), (this.n / sampleRate) * 1000);
      this.sum = 0; this.n = 0;
    }
    return true;
  }
  voicing() {
    if (this.t < 300) return;
    const b = this.vbuf, n = this.vwin;
    let e = 0;
    for (let i = 0; i < n; i++) e += b[i] * b[i];
    if (Math.sqrt(e / n) < 0.004) return;
    let best = 0;
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      let c = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + lag < n; i++) { const a = b[i], d = b[i + lag]; c += a * d; e1 += a * a; e2 += d * d; }
      const r = c / Math.sqrt(e1 * e2 + 1e-12);
      if (r > best) best = r;
    }
    if (best > 0.45) this.voiced += 50;
    // Onset = speech energy AND a voiced window: a clatter does not hold her.
    if (this.spoke && this.voiced >= 50 && !this.onsetSent) {
      this.onsetSent = true;
      this.port.postMessage({ onset: true, ms: this.t });
    }
  }
  step(level, dt) {
    this.t += dt;
    if (this.t < 300) { this.floor.push(level); return; }
    if (this.floor.length) {
      const sorted = this.floor.slice().sort((a, b) => a - b);
      this.threshold = Math.min(0.06, Math.max(0.012, sorted[Math.floor(sorted.length / 2)] * 2.5));
      this.floor = [];
    }
    const speaking = level > this.threshold && (!this.spoke || level > this.peak * 0.2);
    if (speaking) {
      this.speech += dt; this.silence = 0;
      if (this.speech >= 150 && !this.spoke) {
        this.spoke = true;
        if (this.voiced >= 50 && !this.onsetSent) {
          this.onsetSent = true;
          this.port.postMessage({ onset: true, ms: this.t });
        }
      }
      if (level > this.peak) this.peak = level;
    } else {
      this.silence += dt;
      if (!this.spoke) this.speech = 0;
    }
    if ((this.spoke && this.silence >= 900) || this.t >= 20000 || (!this.spoke && this.t >= 10000)) this.finish();
  }
}
registerProcessor("lelu-turn-detector", LeluTurnDetector);
`;

const loaded = new WeakSet<BaseAudioContext>();

/**
 * Wait for the end of one turn on the given stream source. Resolves null
 * when AudioWorklet is unavailable (the caller uses its main-thread
 * detector). `cancelled` is polled; when it turns true the turn ends now.
 */
export async function detectTurnOnAudioThread(
  ctx: AudioContext,
  source: AudioNode,
  cancelled: () => boolean,
  onOnset?: () => void,
): Promise<TurnResult | null> {
  if (typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet) return null;
  try {
    if (!loaded.has(ctx)) {
      const url = URL.createObjectURL(new Blob([TURN_DETECTOR_SOURCE], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      loaded.add(ctx);
    }
    const node = new AudioWorkletNode(ctx, "lelu-turn-detector", { numberOfInputs: 1, numberOfOutputs: 1 });
    // Pulled by the destination so it runs; silent, so nothing is heard.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute).connect(ctx.destination);
    return await new Promise<TurnResult>((resolve) => {
      const poll = setInterval(() => {
        if (cancelled()) node.port.postMessage("stop");
      }, 200);
      node.port.onmessage = (event: MessageEvent<TurnResult | { onset: true; ms: number }>) => {
        if ("onset" in event.data) {
          onOnset?.();
          return;
        }
        clearInterval(poll);
        try {
          source.disconnect(node);
          node.disconnect();
          mute.disconnect();
        } catch {
          // already disconnected
        }
        resolve(event.data as TurnResult);
      };
    });
  } catch (error) {
    console.info("[VoiceEngine] audio-thread turn detection unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
