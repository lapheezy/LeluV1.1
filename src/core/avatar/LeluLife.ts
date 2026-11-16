/**
 * ==========================================================
 * LÉLU — HER LIFE BETWEEN CONVERSATIONS
 *
 * What she does with her body when nothing is asked of her, decided
 * from her REAL state (the behaviour mode her activity gives), on top
 * of LeluMotion's clips:
 *
 *   - quiet for a while → she sits down on her sofa and settles in
 *     (seated idles: relaxed, arms crossed, cross-legged; her foot taps
 *     while she waits — LeluBody animates the tap);
 *   - spoken to while seated → she talks seated, she does not jump up;
 *   - seated a long while → she gets up, and sometimes struts off out of
 *     view, comes back after a bit — or at once when you talk to her;
 *   - asked to ("sit", "stand", "walk away", "come back") → she does.
 *
 * Pure state over time: no three.js scene, so it is testable. The owner
 * (LeluBody) applies the placement it returns to her body.
 * ==========================================================
 */

import type { BehaviourMode } from "./AvatarBehaviour";
import type LeluMotion from "./LeluMotion";

export interface BodyPlacement {
  /** Sideways offset, in her own heights (H). */
  x: number;
  /** Turn about her vertical axis (radians, 0 = facing you). */
  yaw: number;
  /** False while she has walked out of view. */
  visible: boolean;
}

export interface LifeOptions {
  /** Seconds of quiet before she sits down. */
  sitAfter: number;
  /** Seconds seated (and quiet) before she gets up. */
  standAfter: number;
  /** Chance that getting up turns into walking off. */
  walkChance: number;
  /** Seconds she stays out of view before strolling back. */
  awayFor: number;
  random: () => number;
}

const DEFAULTS: LifeOptions = { sitAfter: 35, standAfter: 150, walkChance: 0.5, awayFor: 25, random: Math.random };
/** Walking pace and how far "out of view" is, in her heights per second / heights. */
const SPEED = 0.42;
const OUT = 1.4;

type Walk = { phase: "out" | "away" | "in"; t: number; dir: 1 | -1 };

export default class LeluLife {
  private readonly opts: LifeOptions;
  private idleFor = 0;
  private seatedFor = 0;
  private walkState: Walk | null = null;
  private readonly place: BodyPlacement = { x: 0, yaw: 0, visible: true };

  constructor(
    private readonly motion: LeluMotion,
    options: Partial<LifeOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  get placement(): Readonly<BodyPlacement> {
    return this.place;
  }

  /** Out of view, or on her way out / back. */
  get walking(): boolean {
    return this.walkState !== null;
  }

  get away(): boolean {
    return this.walkState?.phase === "away";
  }

  update(mode: BehaviourMode, dt: number): Readonly<BodyPlacement> {
    const quiet = mode === "idle";
    this.idleFor = quiet ? this.idleFor + dt : 0;
    const w = this.walkState;
    let yawTarget = 0;

    if (w) {
      w.t += dt;
      if (w.phase === "out") {
        this.place.x += w.dir * SPEED * dt;
        yawTarget = (w.dir * Math.PI) / 2;
        if (Math.abs(this.place.x) >= OUT) {
          w.phase = "away";
          w.t = 0;
          this.place.visible = false;
          this.motion.walk(false);
        }
      } else if (w.phase === "away") {
        yawTarget = this.place.yaw;
        // Back after a while — or at once when she is needed.
        if (w.t >= this.opts.awayFor || !quiet) this.comeBack();
      } else {
        this.place.x -= w.dir * SPEED * dt;
        yawTarget = (-w.dir * Math.PI) / 2;
        if (Math.sign(this.place.x) !== w.dir || Math.abs(this.place.x) < 0.01) {
          this.place.x = 0;
          this.walkState = null;
          this.motion.walk(false);
          this.idleFor = 0;
        }
      }
    } else if (this.motion.posture === "standing") {
      if (quiet && this.idleFor >= this.opts.sitAfter && this.motion.sit()) this.seatedFor = 0;
    } else if (this.motion.posture === "sitting") {
      this.seatedFor = quiet ? this.seatedFor + dt : 0;
      if (this.seatedFor >= this.opts.standAfter) {
        this.seatedFor = Number.NEGATIVE_INFINITY; // once
        const walkOff = this.opts.random() < this.opts.walkChance;
        this.motion.stand(() => {
          this.idleFor = 0;
          if (walkOff) this.leave();
        });
      }
    }

    // Turning is eased, never snapped.
    this.place.yaw += (yawTarget - this.place.yaw) * Math.min(1, dt * 5);
    return this.place;
  }

  /** "sit" | "stand" | "leave" | "return" on request. True when she acts on it. */
  command(kind: "sit" | "stand" | "leave" | "return"): boolean {
    if (kind === "return") return this.comeBack();
    if (kind === "leave") {
      if (this.walkState) return false;
      if (this.motion.posture === "sitting") return this.motion.stand(() => this.leave());
      return this.leave();
    }
    if (this.walkState) this.comeBack();
    if (kind === "sit") {
      const sat = this.motion.sit();
      if (sat) this.seatedFor = 0;
      return sat;
    }
    return this.motion.stand(() => {
      this.idleFor = 0;
    });
  }

  private leave(): boolean {
    if (this.walkState || !this.motion.walk(true)) return false;
    this.walkState = { phase: "out", t: 0, dir: this.opts.random() < 0.5 ? 1 : -1 };
    return true;
  }

  private comeBack(): boolean {
    const w = this.walkState;
    if (!w || w.phase === "in") return false;
    if (w.phase === "away") this.place.x = w.dir * OUT;
    w.phase = "in";
    w.t = 0;
    this.place.visible = true;
    this.place.yaw = (-w.dir * Math.PI) / 2;
    this.motion.walk(true);
    return true;
  }
}
