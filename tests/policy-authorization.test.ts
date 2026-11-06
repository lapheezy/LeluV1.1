/**
 * ==========================================================
 * LÉLU — AUTHORIZATION POLICY
 *
 * CATEGORY: unit. The eight action classes, the autonomy
 * floor for each, the two subject kinds that may never widen
 * their own authority, cross-user isolation, production and
 * approval gates.
 *
 * Each case names the RULE that must fire, so a policy change
 * that accidentally allows something fails here with the reason.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_MIN_AUTONOMY,
  ACTION_RISK,
  APPROVAL_REQUIRED,
  evaluatePolicy,
  toRegoInput,
  type PolicyInput,
} from "../src/core/security/policy";

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    subject: { kind: "user", userId: "user-1", agentId: null, sessionId: "session-1" },
    action: "READ",
    resource: { kind: "file", id: "file:src/App.tsx", ownerId: "user-1" },
    context: { autonomyLevel: 5, environment: "sandbox" },
    ...overrides,
  };
}

test("every action class has an autonomy floor and a risk level", () => {
  for (const action of Object.keys(ACTION_MIN_AUTONOMY)) {
    assert.equal(typeof ACTION_MIN_AUTONOMY[action as keyof typeof ACTION_MIN_AUTONOMY], "number");
    assert.ok(ACTION_RISK[action as keyof typeof ACTION_RISK]);
  }
  assert.deepEqual(
    [...APPROVAL_REQUIRED].sort(),
    ["ADMINISTER", "DELETE", "DEPLOY", "INSTALL"],
    "these four always need a human decision",
  );
});

test("READ at autonomy 0 is permitted", () => {
  const decision = evaluatePolicy(input({ action: "READ", context: { autonomyLevel: 0, environment: "sandbox" } }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresApproval, false);
});

test("WRITE below autonomy 2 is refused and names the required level", () => {
  const decision = evaluatePolicy(input({ action: "WRITE", context: { autonomyLevel: 1, environment: "sandbox" } }));
  assert.equal(decision.allowed, false);
  assert.ok(decision.rules.includes("deny_autonomy"));
  assert.match(decision.reason, /autonomy level 2/);
});

test("an anonymous subject is refused whatever the autonomy level", () => {
  const decision = evaluatePolicy(
    input({
      subject: { kind: "user", userId: null, agentId: null, sessionId: null },
      action: "READ",
    }),
  );
  assert.equal(decision.allowed, false);
  assert.ok(decision.rules.includes("deny_no_identity"));
});

test("an agent may never elevate its own privileges", () => {
  const decision = evaluatePolicy(
    input({
      subject: { kind: "agent", userId: null, agentId: "agent-9", sessionId: "session-1" },
      action: "READ",
      context: { autonomyLevel: 5, environment: "sandbox", agentSelfElevation: true },
    }),
  );
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.rules, ["deny_self_elevation"]);
});

test("an agent may not ADMINISTER or DEPLOY on the user's behalf", () => {
  const admin = evaluatePolicy(
    input({
      subject: { kind: "agent", userId: null, agentId: "agent-9", sessionId: "s" },
      action: "ADMINISTER",
      context: { autonomyLevel: 5, environment: "sandbox", approvalValid: true },
    }),
  );
  assert.equal(admin.allowed, false);
  assert.ok(admin.rules.includes("deny_agent_action"));

  const deploy = evaluatePolicy(
    input({
      subject: { kind: "agent", userId: null, agentId: "agent-9", sessionId: "s" },
      action: "DEPLOY",
      context: { autonomyLevel: 5, environment: "sandbox", approvalValid: true },
    }),
  );
  assert.equal(deploy.allowed, false);
});

test("a device subject may only READ or ACCESS_EXTERNAL_DEVICE", () => {
  const write = evaluatePolicy(
    input({
      subject: { kind: "device", userId: null, agentId: null, sessionId: "s" },
      action: "WRITE",
      context: { autonomyLevel: 5, environment: "sandbox" },
    }),
  );
  assert.equal(write.allowed, false);
  assert.ok(write.rules.includes("deny_device_action"));
});

test("cross-user writes are refused; the owner can do them", () => {
  const other = evaluatePolicy(
    input({ action: "WRITE", resource: { kind: "file", id: "file:theirs.ts", ownerId: "user-2" } }),
  );
  assert.equal(other.allowed, false);
  assert.ok(other.rules.includes("deny_cross_user"));

  const own = evaluatePolicy(
    input({ action: "WRITE", resource: { kind: "file", id: "file:mine.ts", ownerId: "user-1" } }),
  );
  assert.equal(own.allowed, true);
});

test("INSTALL, DELETE and ADMINISTER need a live approval; an id alone is not one", () => {
  const withoutApproval = evaluatePolicy(input({ action: "DELETE", resource: { kind: "file", id: "file:a" } }));
  assert.equal(withoutApproval.allowed, false);
  assert.equal(withoutApproval.requiresApproval, true);
  assert.ok(withoutApproval.rules.includes("deny_missing_approval"));

  const withApproval = evaluatePolicy(
    input({
      action: "DELETE",
      resource: { kind: "file", id: "file:a" },
      context: { autonomyLevel: 5, environment: "sandbox", approvalId: "approval-1", approvalValid: true },
    }),
  );
  assert.equal(withApproval.allowed, true);
  assert.equal(withApproval.requiresApproval, true);
});

test("production needs autonomy 5, and DEPLOY needs an approval on top", () => {
  const low = evaluatePolicy(input({ action: "READ", context: { autonomyLevel: 4, environment: "production" } }));
  assert.equal(low.allowed, false);
  assert.ok(low.rules.includes("deny_production_autonomy"));

  const deploy = evaluatePolicy(input({ action: "DEPLOY", context: { autonomyLevel: 5, environment: "production" } }));
  assert.equal(deploy.allowed, false);
  assert.ok(deploy.rules.includes("deny_deploy_approval"));

  const approved = evaluatePolicy(
    input({
      action: "DEPLOY",
      context: { autonomyLevel: 5, environment: "production", approvalId: "a", approvalValid: true },
    }),
  );
  assert.equal(approved.allowed, true);
});

test("device access without a relationship is refused even at autonomy 5", () => {
  const decision = evaluatePolicy(
    input({
      action: "ACCESS_EXTERNAL_DEVICE",
      resource: { kind: "device", id: "device:phone" },
      context: { autonomyLevel: 5, environment: "sandbox" },
    }),
  );
  assert.equal(decision.allowed, false);
  assert.ok(decision.rules.includes("deny_device_relationship"));
});

test("the Rego input document is the one shape both engines see", () => {
  const document = toRegoInput(input({ action: "WRITE" })) as Record<string, Record<string, unknown>>;
  assert.equal(document.action, "WRITE");
  assert.equal(document.subject.user_id, "user-1");
  assert.equal(document.resource.owner_id, "user-1");
  assert.equal(document.context.autonomy_level, 5);
  assert.equal(document.context.approval_valid, false);
});
