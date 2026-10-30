/**
 * ==========================================================
 * LÉLUVERSE — RIGID-BODY PHYSICS
 *
 * A real simulation for objects in an environment, not an
 * animation: semi-implicit Euler integration under gravity,
 * with impulses for
 *
 *   floor           y = floorY, restitution + Coulomb friction
 *   circular wall   |xz − centre| ≤ radius − r (the room)
 *   body ↔ body     bounding-sphere contact, mass-weighted
 *                   impulse and positional correction
 *
 * Every body is treated as its bounding sphere for contact
 * (a box of size s uses radius s/2). Bodies at rest go to
 * sleep so a settled scene costs nothing and can be saved.
 * Fixed 1/120 s substeps keep it stable at any frame rate.
 * ==========================================================
 */

export interface Body {
  id: string;
  position: [number, number, number];
  velocity: [number, number, number];
  radius: number;
  mass: number;
  /** 0 = no bounce, 1 = perfectly elastic. */
  restitution: number;
  /** Coulomb friction coefficient against the floor. */
  friction: number;
  /** Static bodies collide but never move. */
  dynamic: boolean;
  sleeping?: boolean;
}

export interface WorldBounds {
  floorY: number;
  centre: [number, number];
  radius: number;
  gravity: number;
}

const STEP = 1 / 120;
const SLEEP_SPEED = 0.02;

export class PhysicsWorld {
  readonly bodies: Body[];
  private readonly bounds: WorldBounds;
  private carry = 0;
  private stillFor = new Map<string, number>();

  constructor(bodies: Body[], bounds: WorldBounds) {
    this.bodies = bodies;
    this.bounds = bounds;
  }

  /** Advance by dt seconds in fixed substeps. Returns true while anything is awake. */
  step(dt: number): boolean {
    this.carry += Math.min(dt, 0.25);
    while (this.carry >= STEP) {
      this.substep(STEP);
      this.carry -= STEP;
    }
    return this.bodies.some((b) => b.dynamic && !b.sleeping);
  }

  /** Total kinetic + potential energy of the dynamic bodies (for verification). */
  energy(): number {
    return this.bodies
      .filter((b) => b.dynamic)
      .reduce((e, b) => e + 0.5 * b.mass * (b.velocity[0] ** 2 + b.velocity[1] ** 2 + b.velocity[2] ** 2) + b.mass * this.bounds.gravity * (b.position[1] - this.bounds.floorY), 0);
  }

  wake(id: string, velocity?: [number, number, number]): void {
    const b = this.bodies.find((x) => x.id === id);
    if (!b) return;
    b.sleeping = false;
    this.stillFor.delete(id);
    if (velocity) b.velocity = [...velocity];
  }

  private substep(h: number): void {
    const { floorY, centre, radius, gravity } = this.bounds;
    for (const b of this.bodies) {
      if (!b.dynamic || b.sleeping) continue;
      b.velocity[1] -= gravity * h;
      for (let i = 0; i < 3; i++) b.position[i] += b.velocity[i] * h;

      // Floor.
      const bottom = b.position[1] - b.radius;
      if (bottom < floorY) {
        b.position[1] = floorY + b.radius;
        if (b.velocity[1] < 0) {
          const vn = -b.velocity[1];
          b.velocity[1] = vn * b.restitution < 0.15 ? 0 : vn * b.restitution;
          // Friction impulse proportional to the normal impulse, capped at stopping.
          const vt = Math.hypot(b.velocity[0], b.velocity[2]);
          if (vt > 0) {
            const drop = Math.min(vt, b.friction * vn * (1 + b.restitution) + b.friction * gravity * h);
            b.velocity[0] *= (vt - drop) / vt;
            b.velocity[2] *= (vt - drop) / vt;
          }
        } else if (b.velocity[1] === 0) {
          // Resting contact: rolling/sliding friction.
          const vt = Math.hypot(b.velocity[0], b.velocity[2]);
          if (vt > 0) {
            const drop = Math.min(vt, b.friction * gravity * h);
            b.velocity[0] *= (vt - drop) / vt;
            b.velocity[2] *= (vt - drop) / vt;
          }
        }
      }

      // Circular wall.
      const dx = b.position[0] - centre[0];
      const dz = b.position[2] - centre[1];
      const dist = Math.hypot(dx, dz);
      const limit = radius - b.radius;
      if (dist > limit && dist > 0) {
        const nx = dx / dist;
        const nz = dz / dist;
        b.position[0] = centre[0] + nx * limit;
        b.position[2] = centre[1] + nz * limit;
        const vn = b.velocity[0] * nx + b.velocity[2] * nz;
        if (vn > 0) {
          b.velocity[0] -= (1 + b.restitution) * vn * nx;
          b.velocity[2] -= (1 + b.restitution) * vn * nz;
        }
      }
    }

    // Body ↔ body.
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i];
        const c = this.bodies[j];
        if (!a.dynamic && !c.dynamic) continue;
        const d = [c.position[0] - a.position[0], c.position[1] - a.position[1], c.position[2] - a.position[2]];
        const dist = Math.hypot(d[0], d[1], d[2]);
        const overlap = a.radius + c.radius - dist;
        if (overlap <= 0 || dist === 0) continue;
        const n = d.map((v) => v / dist);
        const invA = a.dynamic ? 1 / a.mass : 0;
        const invC = c.dynamic ? 1 / c.mass : 0;
        const invSum = invA + invC;
        // Push apart in proportion to inverse mass.
        for (let k = 0; k < 3; k++) {
          a.position[k] -= n[k] * overlap * (invA / invSum);
          c.position[k] += n[k] * overlap * (invC / invSum);
        }
        const rel = (c.velocity[0] - a.velocity[0]) * n[0] + (c.velocity[1] - a.velocity[1]) * n[1] + (c.velocity[2] - a.velocity[2]) * n[2];
        if (rel >= 0) continue;
        const e = Math.min(a.restitution, c.restitution);
        const impulse = (-(1 + e) * rel) / invSum;
        for (let k = 0; k < 3; k++) {
          a.velocity[k] -= impulse * invA * n[k];
          c.velocity[k] += impulse * invC * n[k];
        }
        if (a.dynamic) a.sleeping = false;
        if (c.dynamic) c.sleeping = false;
      }
    }

    // Sleep after half a second of near-stillness on the floor.
    for (const b of this.bodies) {
      if (!b.dynamic || b.sleeping) continue;
      const speed = Math.hypot(b.velocity[0], b.velocity[1], b.velocity[2]);
      const grounded = b.position[1] - b.radius <= floorY + 1e-3;
      const still = (this.stillFor.get(b.id) ?? 0) + (speed < SLEEP_SPEED && grounded ? h : -Infinity);
      if (still >= 0.5) {
        b.sleeping = true;
        b.velocity = [0, 0, 0];
      }
      this.stillFor.set(b.id, Math.max(0, still));
    }
  }
}
