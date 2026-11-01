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
 * ==========================================================
 */

export interface TurnResult {
  spoke: boolean;
  ms: number;
  peak: number;
  threshold: number;
  silenceMs: number;
}

const PROCESSOR = `
class LeluTurnDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.t = 0; this.sum = 0; this.n = 0; this.floor = []; this.threshold = 0.015;
    this.speech = 0; this.silence = 0; this.spoke = false; this.peak = 0; this.done = false;
    this.window = Math.round(sampleRate * 0.05);
    this.port.onmessage = (e) => { if (e.data === "stop") this.finish(); };
  }
  finish() {
    if (this.done) return;
    this.done = true;
    this.port.postMessage({ spoke: this.spoke, ms: this.t, peak: this.peak, threshold: this.threshold, silenceMs: this.silence });
  }
  process(inputs) {
    if (this.done) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) this.sum += channel[i] * channel[i];
    this.n += channel.length;
    if (this.n >= this.window) {
      this.step(Math.sqrt(this.sum / this.n), (this.n / sampleRate) * 1000);
      this.sum = 0; this.n = 0;
    }
    return true;
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
      if (this.speech >= 150) this.spoke = true;
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
): Promise<TurnResult | null> {
  if (typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet) return null;
  try {
    if (!loaded.has(ctx)) {
      const url = URL.createObjectURL(new Blob([PROCESSOR], { type: "application/javascript" }));
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
      node.port.onmessage = (event: MessageEvent<TurnResult>) => {
        clearInterval(poll);
        try {
          source.disconnect(node);
          node.disconnect();
          mute.disconnect();
        } catch {
          // already disconnected
        }
        resolve(event.data);
      };
    });
  } catch (error) {
    console.info("[VoiceEngine] audio-thread turn detection unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
