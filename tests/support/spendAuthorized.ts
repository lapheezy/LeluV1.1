/**
 * For suites that test HOW a paid path behaves once it is allowed (headers,
 * rate limits, rotation, streaming): install a policy holding an explicit
 * authorization for every paid service — the state the user's own words
 * create — in an isolated temp directory. The zero-spend default itself is
 * tested in tests/spend-policy.test.ts.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSpendPolicy, setSpendPolicyForTests } from "../../plugins/spendPolicy";

export function authorizePaidForTests(services = ["anthropic", "openrouter", "fireworks", "mistral", "gemini", "elevenlabs", "meshy"]) {
  const policy = createSpendPolicy({ stateDir: mkdtempSync(path.join(tmpdir(), "lelu-spend-test-")), read: () => undefined });
  for (const service of services) policy.authorize({ service, maxRequests: 500, ttlMs: 24 * 3600_000, consent: "test: the user authorized paid use for this suite" });
  setSpendPolicyForTests(policy);
  return policy;
}
