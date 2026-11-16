/**
 * LÉLU — Mission remote-sync authorization gate.
 *
 * CATEGORY: unit. The gate is closed by default and can only open when every
 * independent authorization and implementation condition is true.
 */

import assert from "node:assert/strict";
import test from "node:test";

import MissionSyncGate, { evaluateMissionSync } from "../src/core/projects/MissionSyncGate";

const OPEN = {
  authenticatedSession: true,
  identityKnown: true,
  accountAuthorized: true,
  userAuthorizedMissionStorage: true,
  schemaVerified: true,
  rlsVerified: true,
  adapterRegistered: true,
  ownerAttributable: true,
} as const;

test("the mission sync gate is closed by default for every missing requirement", () => {
  const gate = MissionSyncGate.getInstance();
  gate.reset();
  const decision = gate.evaluate();
  assert.equal(decision.eligible, false);
  assert.equal(gate.available(), false);
  assert.equal(decision.blockers.length, 8);
  assert.ok(decision.blockers.some((reason) => /authenticated Supabase session/.test(reason)));
  assert.ok(decision.blockers.some((reason) => /no mission sync adapter/.test(reason)));
});

test("all conditions together may open the gate, but a reset closes it again", () => {
  const gate = MissionSyncGate.getInstance();
  gate.setRequirements(OPEN);
  assert.deepEqual(gate.evaluate(), { eligible: true, blockers: [] });
  assert.equal(gate.available(), true);

  gate.reset();
  assert.equal(gate.available(), false);
  assert.equal(gate.requirementsSnapshot().authenticatedSession, false);
});

test("missing explicit user authorization keeps the gate closed", () => {
  const decision = evaluateMissionSync({ ...OPEN, userAuthorizedMissionStorage: false });
  assert.equal(decision.eligible, false);
  assert.ok(decision.blockers.some((reason) => /user has not authorized/.test(reason)));
});

test("a registered adapter without a verified owner or RLS still cannot run", () => {
  const decision = evaluateMissionSync({
    ...OPEN,
    adapterRegistered: true,
    ownerAttributable: false,
    rlsVerified: false,
  });
  assert.equal(decision.eligible, false);
  assert.ok(decision.blockers.some((reason) => /row-level security/.test(reason)));
  assert.ok(decision.blockers.some((reason) => /attributed to the authenticated owner/.test(reason)));
});
