/**
 * ==========================================================
 * LÉLU — A TURN IS ROUTED ON KNOWN TOOL AVAILABILITY
 *
 * CATEGORY: unit. The real ToolRegistry; its runtime probe is replaced
 * with a counter so the test is about WHEN availability is computed.
 *
 * Measured before: the engineering tools read "unavailable" until the
 * runtime probe answered, ~22 s after page load. A self-improvement
 * request sent in that window was routed as if LÉLU had no project
 * tools — ProjectResolver answered with a toy scaffold, the model never
 * saw the turn.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => {},
    get length() { return Object.keys(store).length; },
    key: () => null,
  };
}

import ToolRegistry from "../src/core/tools/ToolRegistry";
import { readFileSync } from "node:fs";

test("availability is computed once for concurrent turns, reused while fresh, recomputed when stale", async () => {
  const registry = ToolRegistry.getInstance() as unknown as {
    computeAvailability: () => Promise<void>;
    ensureAvailability: (maxAgeMs?: number) => Promise<void>;
    refreshedAt: number;
  };
  let computed = 0;
  registry.computeAvailability = async () => {
    computed += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  registry.refreshedAt = 0;

  await Promise.all([registry.ensureAvailability(), registry.ensureAvailability(), registry.ensureAvailability()]);
  assert.equal(computed, 1, "three turns at once share one probe");

  await registry.ensureAvailability(60_000);
  assert.equal(computed, 1, "fresh: not recomputed");

  await new Promise((resolve) => setTimeout(resolve, 5));
  await registry.ensureAvailability(1);
  assert.equal(computed, 2, "stale: recomputed");
});

test("the router waits (bounded) for known availability before choosing a resolver", () => {
  const router = readFileSync("src/core/AIRouter.ts", "utf8");
  const route = router.slice(router.indexOf("public async route("));
  assert.match(route, /^public async route\(context: RouterContext\): Promise<AIResponse> \{\s*\/\/[^]*?await Promise\.race\(\[\s*ToolRegistry\.getInstance\(\)\.ensureAvailability\(\)/);
  assert.ok(route.indexOf("ensureAvailability") < route.indexOf("this.time.execute"), "before the first resolver runs");
});
