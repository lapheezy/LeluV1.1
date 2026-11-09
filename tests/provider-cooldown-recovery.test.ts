/**
 * ==========================================================
 * LÉLU — COOLDOWN RECOVERY (HALF-OPEN)
 *
 * CATEGORY: unit. The real AIProviderRegistry with stand-in providers,
 * because what is being tested is a state transition — "every rung is
 * cooling down" — that live testing made expensive to arrange.
 *
 * Why this exists: measured live, one turn ran a real
 * `environment_compose` and every following turn answered with the
 * offline notice within three seconds, while the broker was returning
 * 200s for the same credentials. Each provider that had failed once sat
 * in a cooldown, `available()` returned an empty chain, and
 * ProviderResolver read that as "all providers are unreachable".
 *
 * The rule these tests pin: a cooldown may delay a provider, but a
 * stale cooldown must not make the chain claim that nothing works. The
 * recovery is bounded — one probe per provider per gap — so it cannot
 * become a retry loop.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import AIProviderRegistry from "../src/core/AIProviderRegistry";
import type AIProvider from "../src/providers/AIProvider";

/** A provider whose only interesting behaviour is whether it says it is usable. */
function fakeProvider(
  name: string,
  priority: number,
  options: { available?: boolean | (() => boolean | Promise<boolean>) } = {},
): AIProvider {
  const available = options.available ?? true;
  return {
    name,
    priority,
    enabled: true,
    timeout: 1000,
    requiresApiKey: true,
    capabilities: ["text"],
    initialize: async () => {},
    isAvailable: async () => (typeof available === "function" ? await available() : available),
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async () => {
      throw new Error("not used in this test");
    },
  } as unknown as AIProvider;
}

test("a chain where every provider is cooling down still gets one real attempt", async () => {
  const registry = new AIProviderRegistry();
  const a = fakeProvider("A", 1);
  const b = fakeProvider("B", 2);
  registry.registerMany([a, b]);

  registry.markFailure("A", "429 rate limit exceeded");
  registry.markFailure("B", "429 rate limit exceeded");

  const available = await registry.available();

  assert.equal(available.length, 1, "the empty chain half-opens instead of reporting nothing");
  assert.ok(
    ["A", "B"].includes(available[0].name),
    "the probe is a real registered provider, not a fabricated one",
  );
});

test("recovery is bounded: the same provider is not probed twice inside the gap", async () => {
  const registry = new AIProviderRegistry();
  registry.registerMany([fakeProvider("A", 1)]);
  registry.markFailure("A", "429 rate limit exceeded");

  assert.equal((await registry.available()).length, 1, "first call probes");
  assert.equal((await registry.available()).length, 0, "second immediate call does not retry");
});

test("a healthy provider means no probe is needed and no cooled provider is admitted", async () => {
  const registry = new AIProviderRegistry();
  registry.registerMany([fakeProvider("A", 1), fakeProvider("B", 2)]);
  registry.markFailure("A", "429 rate limit exceeded");

  const available = await registry.available();

  assert.deepEqual(available.map((p) => p.name), ["B"], "only the healthy rung is used");
});

test("a successful turn clears the quarantine and restores the provider", async () => {
  const registry = new AIProviderRegistry();
  registry.registerMany([fakeProvider("A", 1)]);
  registry.markFailure("A", "quota exceeded");

  assert.equal(registry.isInCooldown("A"), true, "the failure is recorded");

  registry.markSuccess("A");

  assert.equal(registry.isInCooldown("A"), false, "success clears it");
  assert.deepEqual(
    (await registry.available()).map((p) => p.name),
    ["A"],
    "and the provider is usable again without waiting out the cooldown",
  );
});

test("a probe whose availability check throws is recorded, not swallowed", async () => {
  const registry = new AIProviderRegistry();
  registry.registerMany([
    fakeProvider("A", 1, {
      available: () => {
        throw new Error("econnrefused: provider host unreachable");
      },
    }),
  ]);
  registry.markFailure("A", "429 rate limit exceeded");

  const available = await registry.available();

  assert.equal(available.length, 0, "an unreachable provider is not admitted");
  assert.equal(registry.failure("A")?.kind, "network", "the reason is classified and stored");
});
