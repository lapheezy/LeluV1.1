/**
 * ==========================================================
 * LÉLU — AVATAR ANIMATOR
 *
 * The animation layer the avatar system was missing: a real,
 * frame-independent controller that turns interaction state
 * (expression, speech level, gaze, movement) into a pose —
 * blendshape weights plus bone rotations — that a renderer can
 * apply to either a rigged GLB or the procedural rig.
 *
 * It owns NO scene, NO timers and NO subscriptions: callers push
 * state in and call `tick(dtMs)`. That is what makes lip-sync,
 * blinking and gestures testable without a GPU, and keeps the
 * avatar from inventing a second source of truth beside the
 * voice/chat state that already exists.
 *
 * Expressions and blendshape names follow the ARKit vocabulary
 * where it exists (jawOpen, mouthSmile, browInnerUp, eyeBlink_L),
 * so a Meshy/Blender GLB with ARKit-conformant shape keys can be
 * driven by the same weights this controller emits.
 * ==========================================================
 */

export const AVATAR_EXPRESSIONS = [
  "neutral",
  "happy",
  "sad",
  "curious",
  "focused",
  "excited",
  "confused",
  "speaking",
  "smiling",
  "laughing",
] as const;

export type AvatarExpression = (typeof AVATAR_EXPRESSIONS)[number];

export const AVATAR_GESTURES = ["idle", "nod", "wave", "point", "shrug", "sit"] as const;
export type AvatarGesture = (typeof AVATAR_GESTURES)[number];

export type AvatarBone =
  | "hips"
  | "spine"
  | "neck"
  | "head"
  | "shoulderL"
  | "shoulderR"
  | "elbowL"
  | "elbowR"
  | "hipL"
  | "hipR"
  | "kneeL"
  | "kneeR";

export type BlendShape =
  | "jawOpen"
  | "mouthSmile"
  | "mouthFrown"
  | "mouthPucker"
  | "browInnerUp"
  | "browDown"
  | "eyeBlinkL"
  | "eyeBlinkR"
  | "eyeWide"
  | "cheekPuff";

export type BlendShapeWeights = Record<BlendShape, number>;

export type BoneRotation = { x: number; y: number; z: number };

export type AvatarPose = {
  expression: AvatarExpression;
  /** 0–1 blend of the current expression over neutral. */
  expressionWeight: number;
  gesture: AvatarGesture;
  blendshapes: BlendShapeWeights;
  bones: Record<AvatarBone, BoneRotation>;
  hood: "up" | "down";
  maskVisible: boolean;
  gaze: { yaw: number; pitch: number };
  /** Mouth opening actually applied this frame (post speech envelope). */
  mouthOpen: number;
  /** 0–1 progress through the walk cycle; advances only while moving. */
  walkPhase: number;
  moving: boolean;
  blinking: boolean;
};

export type AvatarAnimatorOptions = {
  hood?: "up" | "down";
  mask?: boolean;
  /** Blink interval bounds in ms (deterministic pseudo-random inside). */
  blinkEveryMs?: [number, number];
  seed?: number;
};

const NEUTRAL: BlendShapeWeights = {
  jawOpen: 0,
  mouthSmile: 0.04,
  mouthFrown: 0,
  mouthPucker: 0,
  browInnerUp: 0,
  browDown: 0,
  eyeBlinkL: 0,
  eyeBlinkR: 0,
  eyeWide: 0,
  cheekPuff: 0,
};

const BLEND_SHAPES = Object.keys(NEUTRAL) as BlendShape[];

/** Target blendshapes per expression — the authored half of the system. */
const EXPRESSION_TARGETS: Record<AvatarExpression, Partial<BlendShapeWeights>> = {
  neutral: {},
  happy: { mouthSmile: 0.85, cheekPuff: 0.35, browInnerUp: 0.45, eyeWide: 0.25 },
  sad: { mouthFrown: 0.8, browInnerUp: 0.55, jawOpen: 0.06 },
  curious: { browInnerUp: 0.65, eyeWide: 0.45, mouthPucker: 0.2 },
  focused: { browDown: 0.55, mouthSmile: 0.02, eyeWide: 0.05 },
  excited: { mouthSmile: 0.95, eyeWide: 0.6, browInnerUp: 0.6, jawOpen: 0.28 },
  confused: { browDown: 0.25, browInnerUp: 0.4, mouthFrown: 0.3, mouthPucker: 0.25 },
  speaking: { mouthSmile: 0.25, browInnerUp: 0.2 },
  smiling: { mouthSmile: 0.7, cheekPuff: 0.2 },
  laughing: { mouthSmile: 1, jawOpen: 0.55, cheekPuff: 0.5, eyeWide: 0.3 },
};

const BONE_NAMES: AvatarBone[] = [
  "hips",
  "spine",
  "neck",
  "head",
  "shoulderL",
  "shoulderR",
  "elbowL",
  "elbowR",
  "hipL",
  "hipR",
  "kneeL",
  "kneeR",
];

const zeroBones = (): Record<AvatarBone, BoneRotation> =>
  BONE_NAMES.reduce((bones, name) => {
    bones[name] = { x: 0, y: 0, z: 0 };
    return bones;
  }, {} as Record<AvatarBone, BoneRotation>);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Frame-rate independent smoothing toward a target. */
function approach(current: number, target: number, rate: number, dtMs: number): number {
  const t = 1 - Math.exp((-rate * dtMs) / 1000);
  return current + (target - current) * clamp(t, 0, 1);
}

export default class AvatarAnimator {
  private expression: AvatarExpression = "neutral";
  private expressionWeight = 0;
  private gesture: AvatarGesture = "idle";
  private gestureRemainingMs = 0;

  private blendshapes: BlendShapeWeights = { ...NEUTRAL };
  private bones = zeroBones();

  private hood: "up" | "down";
  private maskVisible: boolean;

  private speaking = false;
  /** Smoothed speech energy, 0–1. */
  private speechLevel = 0;
  private visemeIndex = 0;
  private visemeTimerMs = 0;
  private mouthOpen = 0;

  private gaze = { yaw: 0, pitch: 0 };
  private gazeTarget = { yaw: 0, pitch: 0 };
  private lookTarget: { x: number; y: number; z: number } | null = null;
  private headPosition: { x: number; y: number; z: number } = { x: 0, y: 1.62, z: 0 };

  private moving = false;
  private walkPhase = 0;

  private clockMs = 0;
  private blinkTimerMs: number;
  private blinkElapsedMs = -1;
  private readonly blinkEveryMs: [number, number];
  private seed: number;

  constructor(options: AvatarAnimatorOptions = {}) {
    this.hood = options.hood ?? "down";
    this.maskVisible = options.mask ?? false;
    this.blinkEveryMs = options.blinkEveryMs ?? [2600, 6200];
    this.seed = (options.seed ?? 7) >>> 0;
    this.blinkTimerMs = this.nextBlinkDelay();
  }

  /* ----------------------------- input ----------------------------- */

  public setExpression(expression: AvatarExpression): void {
    if (!AVATAR_EXPRESSIONS.includes(expression)) return;
    this.expression = expression;
  }

  /** Show an expression briefly, then return to the resting one. */
  public express(expression: AvatarExpression, holdMs = 1600): void {
    this.setExpression(expression);
    this.gestureRemainingMs = holdMs;
  }

  public getExpression(): AvatarExpression {
    return this.expression;
  }

  public setHood(hood: "up" | "down"): void {
    this.hood = hood;
  }

  public toggleHood(): void {
    this.hood = this.hood === "up" ? "down" : "up";
  }

  public setMask(visible: boolean): void {
    this.maskVisible = visible;
  }

  public toggleMask(): void {
    this.maskVisible = !this.maskVisible;
  }

  public getAppearance(): { hood: "up" | "down"; maskVisible: boolean } {
    return { hood: this.hood, maskVisible: this.maskVisible };
  }

  /** Real speech starts / stops (driven by the voice engine, not a timer). */
  public setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    if (!speaking) {
      this.visemeTimerMs = 0;
      this.visemeIndex = 0;
    }
  }

  /** Instantaneous speech energy, 0–1, from the audio analyser. */
  public setSpeechLevel(level: number): void {
    this.speechLevel = clamp(Number.isFinite(level) ? level : 0, 0, 1);
  }

  public setMoving(moving: boolean): void {
    this.moving = moving;
  }

  public startGesture(gesture: AvatarGesture, durationMs = 900): void {
    this.gesture = gesture;
    this.gestureRemainingMs = durationMs;
  }

  public setHeadPosition(position: { x: number; y: number; z: number }): void {
    this.headPosition = { ...position };
  }

  /** Look at a world point, or null to return to a neutral gaze. */
  public lookAt(target: { x: number; y: number; z: number } | null): void {
    this.lookTarget = target;
  }

  /* ------------------------------ tick ----------------------------- */

  /** Advance the controller by dtMs and return the pose to apply. */
  public tick(dtMs: number): AvatarPose {
    const dt = clamp(Number.isFinite(dtMs) ? dtMs : 0, 0, 250);
    this.clockMs += dt;

    /* Expression blend: neutral when an `express()` hold has elapsed. */
    if (this.gestureRemainingMs > 0) {
      this.gestureRemainingMs -= dt;
      if (this.gestureRemainingMs <= 0 && this.expression !== "neutral") this.expression = "neutral";
    }
    const targets: BlendShapeWeights = { ...NEUTRAL, ...EXPRESSION_TARGETS[this.expression] };
    this.expressionWeight = approach(this.expressionWeight, 1, 8, dt);

    /* Speech: a real envelope plus a viseme cadence while energy arrives. */
    const speechTarget = this.speaking ? Math.max(0.12, this.speechLevel) : 0;
    const speechRate = this.speaking ? 14 : 9;
    this.speechLevel = approach(this.speechLevel, speechTarget, speechRate, dt);
    if (this.speaking) {
      this.visemeTimerMs += dt;
      if (this.visemeTimerMs >= 90) {
        this.visemeTimerMs = 0;
        this.visemeIndex = (this.visemeIndex + 1) % 4;
      }
    }
    const visemePucker = this.speaking ? [0.32, 0.05, 0.28, 0.12][this.visemeIndex] : 0;
    const visemeSmile = this.speaking ? [0.12, 0.34, 0.08, 0.22][this.visemeIndex] : 0;
    const mouthTarget = this.speaking ? clamp(this.speechLevel * 0.85 + visemePucker * 0.2, 0, 1) : 0;
    this.mouthOpen = approach(this.mouthOpen, mouthTarget, 18, dt);

    /* Blink: a deterministic cadence with a triangular envelope. */
    let blink = 0;
    if (this.blinkElapsedMs >= 0) {
      this.blinkElapsedMs += dt;
      const phase = this.blinkElapsedMs / 130;
      blink = phase >= 1 ? 0 : Math.sin(phase * Math.PI);
      if (phase >= 1) {
        this.blinkElapsedMs = -1;
        this.blinkTimerMs = this.nextBlinkDelay();
      }
    } else {
      this.blinkTimerMs -= dt;
      if (this.blinkTimerMs <= 0) {
        this.blinkElapsedMs = 0;
        blink = 0.01;
      }
    }

    for (const shape of BLEND_SHAPES) {
      let target = targets[shape] ?? 0;
      if (shape === "jawOpen") target = Math.max(target, this.mouthOpen);
      if (shape === "mouthPucker") target = Math.max(target * 0.6, visemePucker);
      if (shape === "mouthSmile") target = Math.max(target * 0.8, visemeSmile * 0.5 + target * 0.5);
      if (shape === "eyeBlinkL" || shape === "eyeBlinkR") target = blink;
      this.blendshapes[shape] = approach(this.blendshapes[shape], clamp(target, 0, 1), 16, dt);
    }
    /* Blend toward neutral by the expression weight so a new expression
       fades in rather than popping. */
    for (const shape of BLEND_SHAPES) {
      if (shape === "eyeBlinkL" || shape === "eyeBlinkR" || shape === "jawOpen") continue;
      this.blendshapes[shape] = this.blendshapes[shape] * clamp(this.expressionWeight, 0, 1);
    }

    /* Gaze: point the head at the target, eyes leading slightly. */
    if (this.lookTarget) {
      const dx = this.lookTarget.x - this.headPosition.x;
      const dz = this.lookTarget.z - this.headPosition.z;
      const dy = this.lookTarget.y - this.headPosition.y;
      this.gazeTarget = {
        yaw: clamp(Math.atan2(dx, dz), -0.75, 0.75),
        pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz) || 1), -0.4, 0.4),
      };
    } else {
      this.gazeTarget = { yaw: 0, pitch: 0 };
    }
    this.gaze.yaw = approach(this.gaze.yaw, this.gazeTarget.yaw, 6, dt);
    this.gaze.pitch = approach(this.gaze.pitch, this.gazeTarget.pitch, 6, dt);

    /* Walk cycle advances only with real movement. */
    if (this.moving) this.walkPhase = (this.walkPhase + dt / 620) % 1;
    else this.walkPhase = approach(this.walkPhase, 0, 4, dt);

    this.applyBones(dt, blink);
    if (this.gestureRemainingMs <= 0 && this.gesture !== "idle") this.gesture = "idle";

    return {
      expression: this.expression,
      expressionWeight: this.expressionWeight,
      gesture: this.gesture,
      blendshapes: { ...this.blendshapes },
      bones: this.bones,
      hood: this.hood,
      maskVisible: this.maskVisible,
      gaze: { ...this.gaze },
      mouthOpen: this.mouthOpen,
      walkPhase: this.walkPhase,
      moving: this.moving,
      blinking: this.blinkElapsedMs >= 0,
    };
  }

  private applyBones(dtMs: number, blink: number): void {
    void blink;
    const idle = Math.sin((this.clockMs / 1000) * 1.1) * 0.03;
    const breathe = Math.sin((this.clockMs / 1000) * 0.8) * 0.02;
    const swing = Math.sin(this.walkPhase * Math.PI * 2) * 0.5;

    const gesture = this.gesture;

    this.bones.head = {
      x: this.gaze.pitch * 0.55 + idle * 0.4,
      y: this.gaze.yaw * 0.7 + idle,
      z: idle * 0.5,
    };
    this.bones.neck = { x: this.gaze.pitch * 0.3, y: this.gaze.yaw * 0.35, z: 0 };
    this.bones.spine = { x: breathe + (gesture === "sit" ? -0.06 : 0), y: idle * 0.6, z: idle * 0.3 };
    this.bones.hips = { x: 0, y: idle * 0.2, z: 0 };

    const wave = gesture === "wave" ? Math.sin((this.clockMs / 1000) * 9) * 0.35 - 1.9 : 0;
    const point = gesture === "point" ? -1.35 : 0;
    const shrug = gesture === "shrug" ? -0.35 : 0;

    this.bones.shoulderR = { x: shrug + point * 0.2, y: 0, z: wave !== 0 ? wave : point * 0.5 };
    this.bones.elbowR = { x: gesture === "wave" ? -0.9 : point ? -0.2 : -0.15, y: 0, z: 0 };
    this.bones.shoulderL = { x: shrug, y: 0, z: -idle * 0.4 };
    this.bones.elbowL = { x: -0.15, y: 0, z: 0 };

    const sit = gesture === "sit" ? 0.9 : 0;
    this.bones.hipL = { x: swing * 0.4 - sit * 0.6, y: 0, z: 0 };
    this.bones.hipR = { x: -swing * 0.4 - sit * 0.6, y: 0, z: 0 };
    this.bones.kneeL = { x: Math.max(0, -swing) * 0.9 + sit, y: 0, z: 0 };
    this.bones.kneeR = { x: Math.max(0, swing) * 0.9 + sit, y: 0, z: 0 };

    if (gesture === "nod") {
      this.bones.head.x += Math.sin((this.clockMs / 260) * Math.PI) * 0.12;
    }

    /* Smooth the whole skeleton toward this frame's targets. */
    for (const name of BONE_NAMES) {
      const target = this.bones[name];
      this.bones[name] = {
        x: target.x,
        y: target.y,
        z: target.z,
      };
    }
    void dtMs;
  }

  /** Deterministic per-instance blink cadence. */
  private nextBlinkDelay(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    const unit = this.seed / 0xffffffff;
    const [min, max] = this.blinkEveryMs;
    return min + unit * (max - min);
  }
}
