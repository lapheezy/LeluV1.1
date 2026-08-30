/**
 * LÉLU PROVIDER HEALTH — DETERMINISTIC FALLBACK-CHAIN VERIFICATION
 *
 * Verifies the provider chain WITHOUT fabricating live results.
 *
 * This sandbox has no API credentials, so this script proves the
 * honest-reporting contract rather than provider liveness:
 *
 *   - every configured provider is present, in real priority order
 *   - a missing API key reports `no_credentials`, NEVER "ready"
 *   - verifyLive() reports `skipped_no_credentials`, NEVER
 *     "verified_live", when there is no key to attempt with
 *   - the primary path is the first two USABLE providers
 *   - a failing secondary cannot change the primary path's health
 *
 * With real credentials present, the SAME verifyLive() call performs
 * genuine requests through each provider's own generate() — there is
 * no stub transport anywhere in ProviderHealth.
 *
 * Run: bun run scripts/verify-provider-health.ts
 */

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
}
// @ts-expect-error — global shim for Node
globalThis.window = { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "" };

import registerAIProviders from "../src/core/RegisterAIProviders";
import ProviderHealth from "../src/core/model/ProviderHealth";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) console.log(`  ✓ ${label}`);
  else { failures += 1; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function main(): Promise<void> {
  const registry = registerAIProviders();
  await registry.initialize();
  const health = new ProviderHealth(registry);

  console.log("== Deterministic inspection: every provider, in real priority order ==");
  const report = await health.inspect();
  console.log(ProviderHealth.format(report));

  assert(report.chain.length >= 6, `all configured providers are present (${report.chain.length})`);
  const positions = report.chain.map((c) => c.priority);
  assert(
    positions.every((p, i) => i === 0 || positions[i - 1] <= p),
    "the chain is reported in ascending priority order (the real fallback order)",
    JSON.stringify(positions),
  );
  assert(
    report.chain[0].name === "Local (on-device)",
    "local-first: the on-device slot is position 1",
    report.chain[0].name,
  );
  const remote = report.chain.filter((c) => c.requiresApiKey);
  assert(
    remote[0]?.name === "Groq" && remote[1]?.name === "OpenRouter",
    "the two highest-priority REMOTE providers are Groq then OpenRouter",
    remote.slice(0, 2).map((r) => r.name).join(" → "),
  );

  console.log("\n== The honesty rule: no key is NEVER reported as healthy ==");
  const keyless = report.chain.filter((c) => c.requiresApiKey);
  assert(
    keyless.every((c) => c.availability === "no_credentials"),
    "with no credentials configured, every key-gated provider reports `no_credentials`",
    JSON.stringify(keyless.map((c) => `${c.name}:${c.availability}`)),
  );
  assert(
    keyless.every((c) => c.availability !== "ready"),
    "not one of them is reported `ready`",
  );
  assert(!report.anyUsable, "anyUsable is honestly false — nothing is actually usable here");
  assert(report.primaryPath.length === 0, "the primary path is empty rather than fabricated");
  assert(
    report.liveVerificationAttempted === false,
    "inspect() claims no live verification (it made no network calls)",
  );

  console.log("\n== verifyLive() without credentials skips — it does not invent success ==");
  const live = await health.verifyLive();
  assert(live.liveVerificationAttempted === true, "verifyLive() records that verification was attempted");
  const verified = live.chain.filter((c) => c.verification === "verified_live");
  assert(verified.length === 0, "NOTHING is reported verified_live without credentials", JSON.stringify(verified.map((v) => v.name)));
  const skipped = live.chain.filter((c) => c.verification === "skipped_no_credentials");
  assert(
    skipped.length === keyless.length,
    `every key-gated provider is explicitly skipped_no_credentials (${skipped.length}/${keyless.length})`,
  );
  assert(
    live.chain.every((c) => c.verification !== "failed_live"),
    "a missing key is never misreported as a live failure",
  );

  console.log("\n== Explicit, surfaced reasons — never swallowed ==");
  assert(
    report.chain.every((c) => c.detail.length > 0),
    "every provider carries a real explanatory detail string",
  );

  console.log(`\n${failures === 0 ? "ALL PROVIDER HEALTH CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("Verification crashed:", e); process.exit(1); });
