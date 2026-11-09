/**
 * MISSION 5.4B.9 — the driver must disable GSAP's lag smoothing.
 *
 * Mission 5.4B.8's root cause: GSAP clamps each tick to ~33 ms, so at ~3 fps a
 * two-second spatial journey advanced ~11 % of wall clock and never arrived.
 * This test spies on the shared ticker and asserts the driver asked for real
 * elapsed time when it loaded.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as gsapNamespace from "gsap";

interface TickerLike {
  lagSmoothing: (threshold?: number, adjustedLag?: number) => unknown;
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

const gsap = resolveGsap();
const calls: Array<number | undefined> = [];
if (gsap?.ticker) {
  const original = gsap.ticker.lagSmoothing.bind(gsap.ticker);
  gsap.ticker.lagSmoothing = (threshold?: number, adjustedLag?: number) => {
    calls.push(threshold);
    return original(threshold, adjustedLag);
  };
}

test("the transition driver turns lag smoothing off when it loads", async () => {
  if (!gsap?.ticker) {
    assert.ok(true, "GSAP has no ticker in this environment");
    return;
  }
  await import("../src/app/scene/spatial/tweenDriver");
  assert.ok(calls.length > 0, "the driver configured the shared ticker");
  assert.equal(calls[0], 0, "lag smoothing is disabled so travel follows the wall clock");
});
