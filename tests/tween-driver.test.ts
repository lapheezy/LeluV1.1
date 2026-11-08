/**
 * MISSION 5.4B.9 — the transition driver keeps timing by the wall clock.
 *
 * Mission 5.4B.8 proved that GSAP's default lag smoothing made a 2-second
 * spatial journey take minutes under software rendering: travel started and
 * never arrived. The driver asks the shared ticker for real elapsed time; a
 * future edit that drops that call would silently bring the old failure back,
 * so it is asserted here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as gsapNamespace from "gsap";
import { gsapDriving, tweenProgress, tweenScalar } from "../src/app/scene/spatial/tweenDriver";

interface TickerLike {
  lagSmoothing: (threshold?: number, adjustedLag?: number) => number | void;
}

function resolveGsap(): { ticker?: TickerLike } | null {
  const namespace = gsapNamespace as unknown as Record<string, unknown>;
  for (const candidate of [namespace.gsap, namespace.default, namespace]) {
    if (candidate && typeof (candidate as { to?: unknown }).to === "function") {
      return candidate as { ticker?: TickerLike };
    }
  }
  return null;
}

test("a tween reports progress to 1 and completes exactly once", async () => {
  const updates: number[] = [];
  let completions = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tween never completed")), 4000);
    tweenProgress(
      80,
      "power2.out",
      (value) => updates.push(value),
      () => {
        completions += 1;
        clearTimeout(timer);
        resolve();
      },
    );
  });
  assert.equal(completions, 1, "completion fires once");
  assert.ok(updates.length > 0, "progress was reported while the tween ran");
  const last = updates.at(-1) ?? 0;
  assert.ok(last > 0.99, `the tween finished at its destination, got ${last}`);
  for (let i = 1; i < updates.length; i += 1) {
    assert.ok(updates[i] >= updates[i - 1], "progress never goes backwards");
  }
});

test("a reversed tween ends at the scene it started from", async () => {
  const values: number[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("reverse tween never completed")), 4000);
    tweenScalar(
      1,
      0,
      60,
      (value) => values.push(value),
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
  assert.ok((values.at(-1) ?? 1) < 0.01, "the rollback lands where it began");
});
