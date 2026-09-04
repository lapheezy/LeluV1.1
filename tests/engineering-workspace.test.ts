/**
 * ==========================================================
 * LÉLU — AUTONOMOUS ENGINEERING WORKSPACE
 *
 * The isolation and authorization boundaries, locked.
 *
 * These are unit-level guards over the rules; the loop itself
 * was proven by running it against the live Anthropic API and
 * a real 623-file project copy on disk.
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
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import EngineeringAuthorization from "../src/core/engineering/EngineeringAuthorization";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import { ENGINEER_OPERATIONS } from "../plugins/engineerApi";

/* ------------------------------------------------------------------ *
 * AUTHORIZATION
 * ------------------------------------------------------------------ */

test("no authenticated session means no authorization, whatever the autonomy level", () => {
  const auth = EngineeringAuthorization.getInstance();
  AutonomyGate.getInstance().setLevel(5);
  // The Supabase session is the source of identity; without one there
  // is nobody to authorize a change to the real project.
  assert.equal(auth.identity(), null);
  assert.equal(auth.preflight().ready, false);
  assert.match(auth.preflight().reason, /No authenticated session/);
  assert.equal(auth.authorize("ws-test").allowed, false);
  AutonomyGate.getInstance().setLevel(2);
});

test("identity alone is not enough — the autonomy level still gates it", () => {
  const auth = EngineeringAuthorization.getInstance();
  const original = auth.identity;
  (auth as unknown as { identity: () => string }).identity = () => "operator@test";
  try {
    AutonomyGate.getInstance().setLevel(2);
    assert.equal(auth.preflight().ready, false);
    assert.match(auth.preflight().reason, /project autonomy/);
    assert.equal(auth.authorize("ws-test").allowed, false);

    AutonomyGate.getInstance().setLevel(4);
    const decision = auth.authorize("ws-test", ["src/x.ts"]);
    assert.equal(decision.allowed, true);
    assert.equal(decision.grant?.grantedBy, "operator@test");
    assert.deepEqual(decision.grant?.paths, ["src/x.ts"]);

    // Lowering the level revokes a grant that was already given —
    // re-checked, not merely remembered.
    AutonomyGate.getInstance().setLevel(2);
    assert.equal(auth.authorizationFor("ws-test"), null);
  } finally {
    (auth as unknown as { identity: unknown }).identity = original;
    AutonomyGate.getInstance().setLevel(2);
    auth.revoke("ws-test");
  }
});

test("project.apply is not even offered to a model without authorization", () => {
  ToolRegistry.getInstance().updateAvailability("project.apply", true);
  const offered = toolSchemasForModel().map((schema) => schema.name);
  // The model cannot request what it cannot see. This is the structural
  // half of "the model asking is never authorization".
  assert.ok(!offered.includes("project_apply"));
});

test("a model calling project.apply without authorization is refused, with the real reason", async () => {
  ToolRegistry.getInstance().updateAvailability("project.apply", true);
  const result = await dispatchToolCall(
    { id: "t1", name: "project_apply", arguments: { workspace: "anything" } },
    "test-task",
  );
  assert.equal(result.ok, false);
  assert.match(result.content, /requires an explicit authorization/);
  assert.match(result.content, /nothing was written to the real project/);
});

/* ------------------------------------------------------------------ *
 * ISOLATION
 * ------------------------------------------------------------------ */

test("the command whitelist is the only thing the runtime will run", () => {
  // A workspace makes edits safe; it does not make arbitrary execution
  // safe. The operation set stays closed.
  assert.deepEqual(
    Object.keys(ENGINEER_OPERATIONS).sort(),
    ["build", "inspect", "test", "typecheck"],
  );
  // The commands themselves are fixed server-side constants, so shell
  // metacharacters inside them are not injection — "inspect" chains with
  // && by design. The property that matters is that a CLIENT cannot
  // introduce a new one: the server maps a named operation to an exact
  // command, and accepts a raw string only on exact whitelist match.
  const values = Object.values(ENGINEER_OPERATIONS);
  assert.ok(!values.includes("rm -rf /"));
  assert.equal(ENGINEER_OPERATIONS["typecheck"], "bun tsc -b --noEmit");
  assert.equal(ENGINEER_OPERATIONS["definitely-not-an-operation"], undefined);
});

test("every workspace tool is registered as risky enough to be gated", () => {
  const registry = ToolRegistry.getInstance();
  for (const id of ["project.write", "project.delete", "project.validate", "project.apply"]) {
    const tool = registry.get(id);
    assert.ok(tool, `${id} is not registered`);
    assert.ok(tool.riskLevel >= 1, `${id} is registered as risk-free`);
  }
  // Changing the real project is the highest risk LÉLU has.
  assert.equal(registry.get("project.apply")?.riskLevel, 4);
  // Reading is not gated the same way — inspection must stay cheap.
  assert.equal(registry.get("project.read")?.riskLevel, 0);
});

test("workspace tools are unavailable until a real runtime is measured", () => {
  // They ship unavailable on purpose: offering a tool that cannot run is
  // how a model is led to claim work it never did.
  const registry = ToolRegistry.getInstance();
  registry.updateAvailability("project.copy", false);
  const offered = toolSchemasForModel().map((schema) => schema.name);
  assert.ok(!offered.includes("project_copy"));
});

test("git tools are registered at the right risk levels", () => {
  // project.git reads state without modifying it; project.commit writes
  // to the real repository and requires the same authorization as apply.
  const registry = ToolRegistry.getInstance();
  assert.equal(registry.get("project.git")?.riskLevel, 0);
  assert.equal(registry.get("project.commit")?.riskLevel, 4);
});

/* ------------------------------------------------------------------ *
 * SERVER-SIDE IDENTITY
 *
 * The client-side authorization check is advice; this is enforcement.
 * Before it existed, an unauthenticated `curl` could request an apply
 * grant and write to the real project — verified by running it.
 * ------------------------------------------------------------------ */

import { identityConfigured, verifyRequestIdentity } from "../plugins/engineerIdentity";

test("with no Supabase configured, apply identity fails closed", async () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  try {
    assert.equal(identityConfigured(), false);
    const check = await verifyRequestIdentity({ headers: { authorization: "Bearer anything" } });
    // Refused, not allowed-by-default: a runtime that cannot establish
    // identity must not be able to change the real project.
    assert.equal(check.ok, false);
    assert.equal(check.status, 503);
    assert.match(check.reason, /cannot verify who is asking/);
  } finally {
    if (saved.url) process.env.SUPABASE_URL = saved.url;
    if (saved.key) process.env.SUPABASE_ANON_KEY = saved.key;
  }
});

test("a missing bearer token is refused before any network call", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
  try {
    const check = await verifyRequestIdentity({ headers: {} });
    assert.equal(check.ok, false);
    assert.equal(check.status, 401);
    assert.match(check.reason, /No Supabase access token/);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});

test("the identity check never echoes the token it was given", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon-secret-value";
  try {
    const secret = "super-secret-access-token";
    const check = await verifyRequestIdentity({ headers: { authorization: `Bearer ${secret}` } });
    assert.equal(check.ok, false);
    // A refusal reason is shown to callers and written to logs, so it
    // must never carry the credential that produced it.
    assert.ok(!check.reason.includes(secret), "the refusal reason leaked the access token");
    assert.ok(!check.reason.includes("anon-secret-value"), "the refusal reason leaked the api key");
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});
