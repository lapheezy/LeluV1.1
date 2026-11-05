/**
 * ==========================================================
 * LÉLU — WHO MAY CHANGE WHAT (permission contract)
 *
 * CATEGORY: unit. Reads the real source tree.
 *
 * Master-integration requirement: LÉLU cannot raise her own autonomy,
 * and changing the real project is enforced by the SERVER, not only by
 * the page. These pin what is true today so a later change cannot quietly
 * break it.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** The only places a human sets the level, plus the self-test that probes clamping and restores it. */
const ALLOWED_AUTONOMY_WRITERS = new Set([
  "src/app/scene/genesis/GenesisCognitionPanel.tsx",
  "src/app/scene/genesis/GenesisSelfDevPanel.tsx",
  "src/core/selfdev/SelfTestRunner.ts",
]);

test("no tool, agent or runtime module can change the autonomy level", () => {
  const writers = walk("src")
    .filter((file) => /AutonomyGate[\s\S]{0,400}\.setLevel\(|gate\.setLevel\(/.test(readFileSync(file, "utf8")))
    .map((file) => file.split(path.sep).join("/"));
  const unexpected = writers.filter((file) => !ALLOWED_AUTONOMY_WRITERS.has(file));
  assert.deepEqual(unexpected, [], `autonomy may only be set from the owner's settings panels: ${unexpected.join(", ")}`);
  for (const file of walk("src/core/tools").concat(walk("src/core/agentic"))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\.setLevel\(/, `${file} is model-reachable and must not set autonomy`);
  }
});

test("the self-test restores the level it probes", () => {
  const source = readFileSync("src/core/selfdev/SelfTestRunner.ts", "utf8");
  const probe = source.slice(source.indexOf("gate.setLevel(99)") - 200, source.indexOf("gate.setLevel(99)") + 300);
  assert.match(probe, /gate\.setLevel\(before\)/);
});

test("the server, not the page, enforces identity and a single-use grant for changing the real project", () => {
  const api = readFileSync("plugins/engineerApi.ts", "utf8");
  for (const action of ["request-apply", "apply", "rollback-apply"]) {
    const start = api.indexOf(`if (action === "${action}")`);
    assert.ok(start > 0, `${action} handler exists`);
    const body = api.slice(start, start + 1400);
    assert.match(body, /verifyRequestIdentity\(req\)/, `${action} verifies identity on the server`);
  }
  const apply = api.slice(api.indexOf('if (action === "apply")'), api.indexOf('if (action === "apply")') + 1600);
  assert.match(apply, /payload\.confirm !== true/, "apply needs an explicit confirm");
  assert.match(apply, /consumeGrant\(/, "apply needs the single-use grant issued to the same identity");
  assert.match(api, /error:\s*\n?\s*"Writes require a workspace copy/, "direct writes to the live project are refused");
});
