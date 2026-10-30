/**
 * ==========================================================
 * LÉLU — ONE LIVING STATE FOR EVERY PLACE SHE APPEARS
 *
 * The companion overlay, the Avatar panel and the Cosmos scene all draw
 * the SAME moment of her: one blink, one glance, one word on her lips.
 * This is that moment. Every surface asks frame(now) and renders the
 * AnimationParams it gets back; nothing here draws.
 *
 * What drives her:
 *  - her mouth: her real speech. VoiceEngine's utterance start (with the
 *    text she is saying), word boundaries (re-synchronising to the word
 *    actually being spoken) and end. Each letter becomes a mouth shape
 *    (viseme) — open vowels open, m/b/p close, o/u round, e/i spread.
 *    Without speech her mouth stays at rest: it never moves for show.
 *  - her expression: what she is doing (LeluActivity — listening,
 *    thinking, searching, speaking, completed, error…).
 *  - blinking, breathing, micro-movement of head and body, idle gaze,
 *    earrings that swing with her head: continuous, never looped stills.
 *  - her gaze: toward the pointer when you are near, else per activity.
 * ==========================================================
 */

import type { LeluActivity } from "../../app/scene/genesis/avatar/leluActivity";
import VoiceEngine, { type SpeechActivity } from "../voice/VoiceEngine";

export interface AnimationParams {
  /** Head tilt (radians), nod/turn offsets (-1..1), face turn (-1..1). */
  roll: number;
  headX: number;
  headY: number;
  yaw: number;
  /** Body sway (-1..1) and breath (0..1). */
  sway: number;
  breath: number;
  /** Eyelids: 0 open, 1 closed. */
  blinkL: number;
  blinkR: number;
  /** Where her irises look (-1..1). */
  gazeX: number;
  gazeY: number;
  /** Brows (-1 lowered … 1 raised), mouth open (0..1), wide (-1 round … 1 spread), smile (-1..1). */
  brow: number;
  open: number;
  wide: number;
  smile: number;
  /** Earring swing angles (radians). */
  earL: number;
  earR: number;
  /** Speaking right now (her voice is playing). */
  speaking: boolean;
}

export const REST_PARAMS: AnimationParams = {
  roll: 0, headX: 0, headY: 0, yaw: 0, sway: 0, breath: 0.5, blinkL: 0, blinkR: 0,
  gazeX: 0, gazeY: 0, brow: 0, open: 0, wide: 0, smile: 0.1, earL: 0, earR: 0, speaking: false,
};

/* ------------------------------- speech -------------------------------- */

export interface Viseme {
  open: number;
  wide: number;
}

const REST: Viseme = { open: 0, wide: 0 };

/** The mouth shape a letter makes. */
export function visemeFor(char: string): Viseme {
  const c = char.toLowerCase();
  if ("aàáâä".includes(c)) return { open: 0.85, wide: 0.25 };
  if ("eéèêë".includes(c)) return { open: 0.45, wide: 0.6 };
  if ("iíìîïy".includes(c)) return { open: 0.3, wide: 0.8 };
  if ("oóòôö".includes(c)) return { open: 0.65, wide: -0.6 };
  if ("uúùûü".includes(c)) return { open: 0.35, wide: -0.85 };
  if ("mbp".includes(c)) return { open: 0, wide: 0 };
  if ("fv".includes(c)) return { open: 0.12, wide: 0.25 };
  if (c === "w") return { open: 0.2, wide: -0.75 };
  if (/[a-zß]/.test(c) || /\p{L}/u.test(c)) return { open: 0.22, wide: 0.15 };
  return REST; // spaces and punctuation: lips meet between words
}

export interface SpeechTimeline {
  text: string;
  /** Start time (s, from the utterance start) of each character. */
  starts: number[];
  duration: number;
}

/** Natural speech at rate 1 is about 14 characters a second. */
export const CHARS_PER_SECOND = 14;

export function buildSpeechTimeline(text: string, charsPerSecond = CHARS_PER_SECOND): SpeechTimeline {
  const starts: number[] = [];
  let t = 0;
  for (const char of text) {
    starts.push(t);
    // Pauses are longer at punctuation.
    t += (/[.!?]/.test(char) ? 4 : /[,;:]/.test(char) ? 2.2 : 1) / charsPerSecond;
  }
  return { text, starts, duration: t };
}

/** Index of the character being said at `t` seconds into the utterance. */
export function charAt(timeline: SpeechTimeline, t: number): number {
  const { starts } = timeline;
  if (t < 0 || t >= timeline.duration || starts.length === 0) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function visemeAt(timeline: SpeechTimeline | null, t: number): Viseme {
  if (!timeline) return REST;
  const index = charAt(timeline, t);
  if (index < 0) return REST;
  return visemeFor([...timeline.text][index] ?? " ");
}

/* ----------------------------- expressions ----------------------------- */

export interface Expression {
  brow: number;
  smile: number;
  gazeX: number;
  gazeY: number;
  roll: number;
  /** How much the idle gaze wanders (0 = fixed on its target). */
  wander: number;
  /** Body movement energy. */
  energy: number;
}

/** How each thing she does shows on her face and body. */
export function expressionFor(activity: LeluActivity): Expression {
  switch (activity) {
    case "LISTENING":
      return { brow: 0.35, smile: 0.22, gazeX: 0, gazeY: 0, roll: 0.06, wander: 0.15, energy: 0.8 };
    case "THINKING":
      return { brow: 0.45, smile: 0, gazeX: -0.55, gazeY: -0.7, roll: -0.05, wander: 0.25, energy: 0.6 };
    case "SPEAKING":
      return { brow: 0.15, smile: 0.25, gazeX: 0, gazeY: 0, roll: 0.02, wander: 0.1, energy: 1.2 };
    case "PRESENTING":
      return { brow: 0.3, smile: 0.4, gazeX: 0, gazeY: 0, roll: 0.03, wander: 0.15, energy: 1 };
    case "SEARCHING":
    case "BROWSING":
    case "WORKING":
    case "BUILDING":
    case "RENDERING":
    case "EXPLORING":
      return { brow: -0.15, smile: 0.05, gazeX: 0.35, gazeY: 0.45, roll: -0.03, wander: 0.2, energy: 0.7 };
    case "COMPLETED":
      return { brow: 0.3, smile: 0.6, gazeX: 0, gazeY: 0, roll: 0.05, wander: 0.1, energy: 1.1 };
    case "ERROR":
      return { brow: -0.45, smile: -0.25, gazeX: 0.1, gazeY: 0.2, roll: -0.04, wander: 0.1, energy: 0.6 };
    default:
      return { brow: 0, smile: 0.12, gazeX: 0, gazeY: 0, roll: 0, wander: 0.6, energy: 0.7 };
  }
}

/** Eyelid closure over a blink of `durationS`, at `t` seconds into it. */
export function blinkAmount(t: number, durationS = 0.16): number {
  if (t < 0 || t > durationS) return 0;
  const closing = durationS * 0.4;
  return t < closing ? t / closing : 1 - (t - closing) / (durationS - closing);
}

/* ------------------------------ the driver ----------------------------- */

const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

export default class LeluAnimation {
  private static instance: LeluAnimation | null = null;

  public static getInstance(): LeluAnimation {
    if (!LeluAnimation.instance) LeluAnimation.instance = new LeluAnimation();
    return LeluAnimation.instance;
  }

  private params: AnimationParams = { ...REST_PARAMS };
  private lastNow = 0;
  private activity: LeluActivity = "IDLE";
  private pointer: { x: number; y: number; at: number } | null = null;

  private speaking = false;
  private timeline: SpeechTimeline | null = null;
  private timelineStart = 0;
  private wordKick = 0;

  private nextBlink = 0;
  private blinkStart = -1;
  private doubleBlink = false;
  private wanderTarget = { x: 0, y: 0, until: 0 };
  private ear = { l: 0, r: 0, vl: 0, vr: 0, lastRoll: 0, lastSway: 0 };
  private subscribers = 0;
  private unsubscribe: (() => void) | null = null;

  /** A surface starts showing her: listen to her voice and the pointer. */
  public attach(): () => void {
    this.subscribers += 1;
    if (this.subscribers === 1 && typeof window !== "undefined") {
      const offSpeech = VoiceEngine.getInstance().onSpeechActivity((speech) => this.onSpeech(speech));
      const onPointer = (event: PointerEvent) => {
        this.pointer = { x: event.clientX, y: event.clientY, at: performance.now() };
      };
      window.addEventListener("pointermove", onPointer, { passive: true });
      this.unsubscribe = () => {
        offSpeech();
        window.removeEventListener("pointermove", onPointer);
      };
    }
    return () => {
      this.subscribers = Math.max(0, this.subscribers - 1);
      if (this.subscribers === 0) {
        this.unsubscribe?.();
        this.unsubscribe = null;
      }
    };
  }

  public setActivity(activity: LeluActivity): void {
    this.activity = activity;
  }

  public getActivity(): LeluActivity {
    return this.activity;
  }

  /** Where the pointer is (viewport px), for a surface to aim her gaze; null if idle for 4 s. */
  public getPointer(now = performance.now()): { x: number; y: number } | null {
    return this.pointer && now - this.pointer.at < 4000 ? this.pointer : null;
  }

  /** Her voice: utterance start (text), word boundary (re-sync), end. */
  public onSpeech(speech: SpeechActivity, now = performance.now()): void {
    if (speech.kind === "start") {
      this.speaking = true;
      this.timeline = speech.text ? buildSpeechTimeline(speech.text) : null;
      this.timelineStart = now;
      return;
    }
    if (speech.kind === "word") {
      this.speaking = true;
      if (!this.timeline || this.timeline.text !== speech.text) {
        this.timeline = buildSpeechTimeline(speech.text);
      }
      const index = Math.max(0, Math.min(this.timeline.starts.length - 1, speech.charIndex ?? 0));
      // The word being said now is this one: align the timeline to it.
      this.timelineStart = now - (this.timeline.starts[index] ?? 0) * 1000;
      this.wordKick = 1;
      return;
    }
    if (!speech.speaking) {
      this.speaking = false;
      this.timeline = null;
    }
  }

  public isSpeaking(): boolean {
    return this.speaking;
  }

  /** The mouth shape for right now. */
  public currentViseme(now = performance.now()): Viseme {
    if (!this.speaking) return REST;
    const t = (now - this.timelineStart) / 1000;
    if (this.timeline && t < this.timeline.duration) return visemeAt(this.timeline, t);
    // Still speaking past the estimate (a slow voice, no word events):
    // keep forming syllables until her voice actually stops.
    const syllable = Math.sin(t * 2 * Math.PI * 3.2) * 0.5 + 0.5;
    return { open: 0.15 + syllable * 0.45, wide: Math.sin(t * 5.1) * 0.4 };
  }

  /** This moment of her. Idempotent within a frame: every surface sees the same. */
  public frame(now = performance.now()): AnimationParams {
    if (Math.abs(now - this.lastNow) < 4) return this.params;
    const dt = this.lastNow ? Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000)) : 1 / 60;
    this.lastNow = now;
    const t = now / 1000;
    const p = { ...this.params };
    const expression = expressionFor(this.speaking ? "SPEAKING" : this.activity);

    // Blinks: every 2–6 s, sometimes twice; while speaking a little more often.
    if (this.nextBlink === 0) this.nextBlink = t + 1.5 + Math.random() * 3;
    if (t >= this.nextBlink && this.blinkStart < 0) {
      this.blinkStart = t;
      this.doubleBlink = Math.random() < 0.18;
    }
    let blink = 0;
    if (this.blinkStart >= 0) {
      const since = t - this.blinkStart;
      blink = blinkAmount(since) || (this.doubleBlink ? blinkAmount(since - 0.24) : 0);
      if (since > (this.doubleBlink ? 0.42 : 0.18)) {
        this.blinkStart = -1;
        this.nextBlink = t + (this.speaking ? 1.6 : 2) + Math.random() * 4;
      }
    }
    // Thinking: eyes half-lidded now and then.
    const lidded = this.activity === "THINKING" ? 0.18 + Math.max(0, Math.sin(t * 0.9)) * 0.12 : 0;
    p.blinkL = Math.max(blink, lidded);
    p.blinkR = Math.max(blink * 0.97, lidded);

    // Gaze: her target, plus wandering when she is not attending to anything.
    if (t > this.wanderTarget.until) {
      this.wanderTarget = { x: (Math.random() * 2 - 1) * 0.8, y: (Math.random() * 2 - 1) * 0.45, until: t + 1.2 + Math.random() * 3 };
    }
    const gx = expression.gazeX + this.wanderTarget.x * expression.wander;
    const gy = expression.gazeY + this.wanderTarget.y * expression.wander;
    // Saccades: fast.
    p.gazeX = approach(p.gazeX, gx, 18, dt);
    p.gazeY = approach(p.gazeY, gy, 18, dt);

    // Mouth: her speech, smoothed the way lips move.
    const viseme = this.currentViseme(now);
    p.open = approach(p.open, viseme.open, 22, dt);
    p.wide = approach(p.wide, this.speaking ? viseme.wide : 0, 16, dt);
    p.speaking = this.speaking;

    // Expression.
    this.wordKick *= Math.exp(-dt * 6);
    p.brow = approach(p.brow, expression.brow + this.wordKick * 0.25, 4, dt);
    p.smile = approach(p.smile, expression.smile, 3, dt);

    // Head: a living, never-repeating drift, nods on words, tilt per activity.
    const e = expression.energy;
    const drift = (a: number, b: number, c: number) => Math.sin(t * a) * 0.6 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.1;
    p.roll = approach(p.roll, expression.roll + drift(0.31, 0.53, 1.37) * 0.035 * e, 3, dt);
    p.headX = approach(p.headX, drift(0.23, 0.41, 0.97) * 0.35 * e + expression.gazeX * 0.25, 3, dt);
    p.headY = approach(p.headY, drift(0.37, 0.61, 1.13) * 0.25 * e + this.wordKick * 0.45 + expression.gazeY * 0.2, 6, dt);
    p.yaw = approach(p.yaw, p.gazeX * 0.45 + drift(0.19, 0.29, 0.71) * 0.25 * e, 3, dt);

    // Body: breathing (faster while speaking), weight shifting.
    const breathRate = this.speaking ? 0.32 : 0.24;
    p.breath = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * breathRate);
    p.sway = approach(p.sway, drift(0.17, 0.27, 0.43) * e, 2, dt);

    // Earrings: a damped pendulum pushed by her head and body moving.
    const ear = this.ear;
    const push = (p.roll - ear.lastRoll) * 60 + (p.sway - ear.lastSway) * 4;
    ear.lastRoll = p.roll;
    ear.lastSway = p.sway;
    const spring = (angle: number, velocity: number) => {
      const accel = -38 * angle - 3.2 * velocity - push * 2.2;
      const v = velocity + accel * dt;
      return [angle + v * dt, v] as const;
    };
    [ear.l, ear.vl] = spring(ear.l, ear.vl);
    [ear.r, ear.vr] = spring(ear.r, ear.vr);
    p.earL = Math.max(-0.35, Math.min(0.35, ear.l - p.roll * 0.6));
    p.earR = Math.max(-0.35, Math.min(0.35, ear.r - p.roll * 0.6));

    this.params = p;
    return p;
  }

  /** Test-only. */
  public static resetForTests(): void {
    LeluAnimation.instance = null;
  }
}
