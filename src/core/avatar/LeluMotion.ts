/**
 * ==========================================================
 * LÉLU — MOTION (her captured animations, chosen from her state)
 *
 * Her approved Forge animation slots (Meshy motion on her own rig,
 * one clip per slot, named by slot) on one mixer:
 *
 *   loops     idle · idle_1 · idle_3 (+ idle_look_around, hand_on_hip
 *             now and then) · listen · talk_open / talk_right /
 *             talk_hip / talk_passionate (rotating while she speaks)
 *   gestures  wave · wave_big · bow · agree · shrug · heart · cheer ·
 *             happy_jump · dance_cherish · dance_love · walk ·
 *             turn_left · turn_right · sit_idle · sit_to_stand
 *
 * Her state picks the loop; a gesture plays once over it and blends
 * back. Clips are made to play in place (the hips keep their height
 * and lose their travel), so a walk in a small companion view does not
 * carry her out of it; the world presence moves her itself.
 *
 * Face and head offsets (AvatarBehaviour) still apply on top.
 * ==========================================================
 */

import * as THREE from "three";
import type { BehaviourMode } from "./AvatarBehaviour";

export type LeluGesture =
  | "wave"
  | "wave_big"
  | "bow"
  | "agree"
  | "shrug"
  | "heart"
  | "cheer"
  | "happy_jump"
  | "dance_cherish"
  | "dance_love"
  | "walk"
  | "turn_left"
  | "turn_right"
  | "sit_idle"
  | "sit_to_stand"
  | "hand_on_hip"
  | "idle_look_around"
  | "sit_down"
  | "sit_thumbs_up"
  | "strut";

/** Standing, seated (on her sofa), or on the move. */
export type Posture = "standing" | "sitting" | "walking";

const LOOPS: Record<BehaviourMode, string[]> = {
  idle: ["idle", "idle_1", "idle_3"],
  listening: ["listen", "idle_1"],
  speaking: ["talk_open", "talk_right", "talk_hip", "talk_passionate"],
  thinking: ["idle_3", "idle_1"],
  acting: ["idle_1", "idle"],
};

/** Seated: her clips for each state while she is on the sofa. */
const SEATED_LOOPS: Record<BehaviourMode, string[]> = {
  idle: ["sit_idle", "sit_arms_crossed", "sit_cross_legged"],
  listening: ["sit_idle"],
  speaking: ["sit_talk"],
  thinking: ["sit_arms_crossed", "sit_idle"],
  acting: ["sit_idle"],
};

const WALK_LOOPS = ["strut", "walk"];

/** Gestures that are made seated; any other gesture needs her to stand first. */
export const SEATED_GESTURES = new Set(["sit_thumbs_up", "sit_talk", "sit_idle", "sit_arms_crossed", "sit_cross_legged", "sit_to_stand"]);

/** Now and then while idle, instead of the next idle loop. */
const IDLE_FLOURISHES = ["idle_look_around", "hand_on_hip"];

const FADE = 0.35;

export default class LeluMotion {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private mode: BehaviourMode = "idle";
  private stance: Posture = "standing";
  private current: THREE.AnimationAction | null = null;
  private gesture: { action: THREE.AnimationAction; done?: () => void } | null = null;
  private loopEndsAt = 0;
  private time = 0;
  private turn = 0;

  constructor(
    root: THREE.Object3D,
    clips: THREE.AnimationClip[],
    private readonly random: () => number = Math.random,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) {
      if (!clip.name || this.actions.has(clip.name)) continue;
      const action = this.mixer.clipAction(inPlace(clip));
      this.actions.set(clip.name, action);
    }
    this.mixer.addEventListener("finished", (event) => {
      const finished = (event as unknown as { action: THREE.AnimationAction }).action;
      if (this.gesture?.action === finished) {
        const done = this.gesture.done;
        this.gesture = null;
        this.toLoop(true);
        done?.();
      }
    });
  }

  /** True when her captured animation library is present (not just a base layer). */
  get hasLibrary(): boolean {
    return LOOPS.idle.some((name) => this.actions.has(name));
  }

  get names(): string[] {
    return [...this.actions.keys()];
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  get posture(): Posture {
    return this.stance;
  }

  /** She has what sitting down, staying seated and getting up take. */
  get canSit(): boolean {
    return ["sit_down", "sit_idle", "sit_to_stand"].every((name) => this.actions.has(name));
  }

  get canWalk(): boolean {
    return WALK_LOOPS.some((name) => this.actions.has(name));
  }

  /** Sit down (onto her sofa). False when she cannot from here. */
  sit(done?: () => void): boolean {
    if (this.stance !== "standing" || !this.canSit) return false;
    this.stance = "sitting";
    this.play("sit_down", done);
    return true;
  }

  /** Get up. The posture changes once she is on her feet. */
  stand(done?: () => void): boolean {
    if (this.stance !== "sitting") return false;
    this.play("sit_to_stand", () => {
      this.stance = "standing";
      this.toLoop(true);
      done?.();
    });
    return true;
  }

  /** Start or stop walking (the body is moved by its owner; the clip plays in place). */
  walk(on: boolean): boolean {
    if (on) {
      if (this.stance === "sitting" || !this.canWalk) return false;
      this.stance = "walking";
    } else if (this.stance === "walking") {
      this.stance = "standing";
    } else return false;
    if (!this.gesture) this.toLoop(true);
    return true;
  }

  /** What is playing now (for telemetry and tests). */
  get playing(): string | null {
    return (this.gesture?.action ?? this.current)?.getClip().name ?? null;
  }

  setMode(mode: BehaviourMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (!this.gesture) this.toLoop(true);
  }

  /** Play one gesture over her current state. Returns its length in seconds, or 0 when she has no such clip. */
  play(name: string, done?: () => void): number {
    const action = this.actions.get(name);
    if (!action) return 0;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(1);
    action.play();
    const from = this.gesture?.action ?? this.current;
    if (from && from !== action) from.crossFadeTo(action, FADE, false);
    this.gesture = { action, done };
    return action.getClip().duration;
  }

  update(delta: number): void {
    this.time += delta;
    if (!this.gesture && (!this.current || this.time >= this.loopEndsAt)) this.toLoop(false);
    this.mixer.update(delta);
  }

  stop(): void {
    this.mixer.stopAllAction();
  }

  /** Into the loop for her state; a variant each time a loop runs its course. */
  private toLoop(stateChanged: boolean): void {
    if (!this.hasLibrary && !this.current) {
      // No library: whatever clip the model carries, looped (previous behaviour).
      const first = [...this.actions.values()][0];
      if (first) {
        first.play();
        this.current = first;
        this.loopEndsAt = Number.POSITIVE_INFINITY;
      }
      return;
    }
    if (!this.hasLibrary) return;
    const table = this.stance === "sitting" ? SEATED_LOOPS[this.mode] : this.stance === "walking" ? WALK_LOOPS : LOOPS[this.mode];
    const options = table.filter((name) => this.actions.has(name));
    // A new state starts with its primary clip; variants follow as it continues.
    if (stateChanged) this.turn = 0;
    let pick = options[this.turn % Math.max(1, options.length)];
    this.turn += 1;
    if (!stateChanged && this.stance === "standing" && this.mode === "idle" && this.random() < 0.25) {
      const flourish = IDLE_FLOURISHES.filter((name) => this.actions.has(name));
      if (flourish.length) pick = flourish[Math.floor(this.random() * flourish.length)];
    }
    const action = pick ? this.actions.get(pick) : undefined;
    if (!action) return;
    const clip = action.getClip();
    // Talking clips rotate every cycle; idles hold for a couple of cycles.
    const cycles = this.mode === "speaking" ? 1 : this.stance === "sitting" ? 4 : 2;
    this.loopEndsAt = this.stance === "walking" ? Number.POSITIVE_INFINITY : this.time + Math.max(2, clip.duration * cycles);
    if (action === this.current && action.isRunning()) return;
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.setEffectiveWeight(1);
    action.play();
    const from = this.current;
    if (from && from !== action) from.crossFadeTo(action, FADE, false);
    this.current = action;
  }
}

/**
 * The same clip, playing in place: the hips keep their vertical motion
 * (a bow, a jump, sitting) and lose their horizontal travel.
 */
function inPlace(clip: THREE.AnimationClip): THREE.AnimationClip {
  const copy = clip.clone();
  for (const track of copy.tracks) {
    if (!/hips\.position$/i.test(track.name) || track.getValueSize() !== 3) continue;
    const values = track.values;
    const x0 = values[0];
    const z0 = values[2];
    for (let i = 0; i < values.length; i += 3) {
      values[i] = x0;
      values[i + 2] = z0;
    }
  }
  return copy;
}
