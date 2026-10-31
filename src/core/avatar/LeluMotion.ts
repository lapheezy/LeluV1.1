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
  | "idle_look_around";

const LOOPS: Record<BehaviourMode, string[]> = {
  idle: ["idle", "idle_1", "idle_3"],
  listening: ["listen", "idle_1"],
  speaking: ["talk_open", "talk_right", "talk_hip", "talk_passionate"],
  thinking: ["idle_3", "idle_1"],
  acting: ["idle_1", "idle"],
};

/** Now and then while idle, instead of the next idle loop. */
const IDLE_FLOURISHES = ["idle_look_around", "hand_on_hip"];

const FADE = 0.35;

export default class LeluMotion {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private mode: BehaviourMode = "idle";
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
    const options = LOOPS[this.mode].filter((name) => this.actions.has(name));
    // A new state starts with its primary clip; variants follow as it continues.
    if (stateChanged) this.turn = 0;
    let pick = options[this.turn % Math.max(1, options.length)];
    this.turn += 1;
    if (!stateChanged && this.mode === "idle" && this.random() < 0.25) {
      const flourish = IDLE_FLOURISHES.filter((name) => this.actions.has(name));
      if (flourish.length) pick = flourish[Math.floor(this.random() * flourish.length)];
    }
    const action = pick ? this.actions.get(pick) : undefined;
    if (!action) return;
    const clip = action.getClip();
    // Talking clips rotate every cycle; idles hold for a couple of cycles.
    const cycles = this.mode === "speaking" ? 1 : 2;
    this.loopEndsAt = this.time + Math.max(2, clip.duration * cycles);
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
