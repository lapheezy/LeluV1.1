/**
 * LÉLU — PROVIDER KEY RING
 *
 * Four configured credentials must mean four usable slots, rotation that
 * skips a cooling key, and health that never reports a secret. These are
 * pure-in-memory checks with an injected clock.
 */
import assert from "node:assert/strict";
import test from "node:test";
import ProviderKeyRing from "../src/core/model/ProviderKeyRing";

const four = ["a".repeat(24), "b".repeat(24), "c".repeat(24), "d".repeat(24)].map(
  (key, index) => ({ label: `GROQ_API_KEY_${index + 1}`, key }),
);

test("four configured keys are four slots and rotate in order", () => {
  const ring = new ProviderKeyRing("groq", four);
  assert.equal(ring.size(), 4);
  assert.equal(ring.readyCount(), 4);
  const order = [ring.next()?.label, ring.next()?.label, ring.next()?.label, ring.next()?.label];
  assert.deepEqual(order, ["GROQ_API_KEY_1", "GROQ_API_KEY_2", "GROQ_API_KEY_3", "GROQ_API_KEY_4"]);
  assert.equal(ring.next()?.label, "GROQ_API_KEY_1", "rotation wraps");
});

test("a refused credential cools and the next request spends a different key", () => {
  const ring = new ProviderKeyRing("groq", four);
  const first = ring.next();
  ring.markFailure(first!.label, "Groq failed 401: Invalid API Key");
  assert.equal(ring.readyCount(), 3);
  assert.equal(ring.next()?.label, "GROQ_API_KEY_2");
  const health = ring.health();
  assert.equal(health[0].state, "cooling");
  assert.equal(health[0].lastFailureKind, "credential-refused");
  assert.ok(health[0].cooldownMsRemaining > 0);
});

test("a spent quota cools for the same fifteen minutes as a refused key", () => {
  const ring = new ProviderKeyRing("groq", four);
  ring.markFailure("GROQ_API_KEY_1", "429 rate limit exceeded: tokens per day");
  const [health] = ring.health();
  assert.equal(health.lastFailureKind, "quota-exhausted");
  assert.ok(health.cooldownMsRemaining >= 14 * 60_000, `got ${health.cooldownMsRemaining}`);
});

test("a transient failure cools briefly, not for a quarter of an hour", () => {
  const ring = new ProviderKeyRing("groq", four);
  ring.markFailure("GROQ_API_KEY_1", "Groq network error: fetch failed");
  const [health] = ring.health();
  assert.equal(health.lastFailureKind, "network");
  assert.ok(health.cooldownMsRemaining <= 30_000);
});

test("a credential refused three times is retired instead of retried forever", () => {
  const ring = new ProviderKeyRing("groq", four);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    ring.markFailure("GROQ_API_KEY_1", "Groq failed 401: Invalid API Key");
  }
  assert.equal(ring.health()[0].state, "retired");
  // It is never handed out again, even though its cooldown is what a refresh
  // would clear.
  const handedOut = Array.from({ length: 8 }, () => ring.next()?.label);
  assert.equal(handedOut.includes("GROQ_API_KEY_1"), false);
});

test("a success clears the slot's failure history", () => {
  const ring = new ProviderKeyRing("groq", four);
  ring.markFailure("GROQ_API_KEY_1", "Groq failed 500: upstream");
  ring.markSuccess("GROQ_API_KEY_1");
  const [health] = ring.health();
  assert.equal(health.state, "ready");
  assert.equal(health.failures, 0);
  assert.equal(health.successes, 1);
});

test("health never contains a credential", () => {
  const ring = new ProviderKeyRing("groq", four);
  ring.next();
  const serialized = JSON.stringify(ring.health());
  for (const credential of four) {
    assert.equal(serialized.includes(credential.key), false, `${credential.label} leaked`);
  }
});

test("when every slot is cooling the ring says so instead of reusing one", () => {
  const single = new ProviderKeyRing("groq", [four[0]]);
  assert.ok(single.next());
  single.markFailure("GROQ_API_KEY_1", "401 unauthorized");
  assert.equal(single.next(), null);
  assert.equal(single.readyCount(), 0);
});

test("a cooldown expires on the clock it was measured with", () => {
  let now = 1_000_000;
  const ring = new ProviderKeyRing("groq", four, () => now);
  ring.markFailure("GROQ_API_KEY_1", "401 unauthorized");
  assert.equal(ring.readyCount(), 3);
  now += 16 * 60_000;
  assert.equal(ring.readyCount(), 4, "a fixed key must come back without a reload");
});
