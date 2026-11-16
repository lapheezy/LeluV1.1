/**
 * ==========================================================
 * LÉLU — RELATIONSHIP AUTHORIZATION (OpenFGA shape)
 *
 * CATEGORY: unit. The device chain the spec asks for:
 *   Owner → Device → Authorized Session → Granted Capabilities
 *
 * What is proven here:
 *   • a session may use only the capabilities it was granted;
 *   • the grant expires on its own, with no job to run;
 *   • revoking the session stops it immediately;
 *   • organization membership implies project membership;
 *   • everything else must be stated — nothing else is implied.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import RelationshipStore from "../src/core/security/authz/RelationshipStore";

function store(): RelationshipStore {
  const instance = RelationshipStore.getInstance();
  instance.resetForTests();
  return instance;
}

const OWNER = "user:owner-1";

test("the device chain grants exactly the capabilities it names", () => {
  const relationships = store();
  relationships.grantDeviceSession({
    ownerUserId: "owner-1",
    deviceId: "phone",
    sessionId: "session-a",
    capabilities: ["camera", "microphone"],
    ttlMs: 60_000,
  });

  assert.equal(relationships.sessionMay("session-a", "phone", "camera").allowed, true);
  assert.equal(relationships.sessionMay("session-a", "phone", "microphone").allowed, true);

  const files = relationships.sessionMay("session-a", "phone", "files");
  assert.equal(files.allowed, false);
  assert.match(files.reason, /does not include capability "files"/);
});

test("a grant for one device is not a grant for another", () => {
  const relationships = store();
  relationships.grantDeviceSession({
    ownerUserId: "owner-1",
    deviceId: "phone",
    sessionId: "session-a",
    capabilities: ["camera"],
    ttlMs: 60_000,
  });
  const other = relationships.sessionMay("session-a", "laptop", "camera");
  assert.equal(other.allowed, false);
  assert.match(other.reason, /no live granted relationship/i);
});

test("an expired session grant stops working with no maintenance job", () => {
  const relationships = store();
  const grant = relationships.grantDeviceSession({
    ownerUserId: "owner-1",
    deviceId: "phone",
    sessionId: "session-a",
    capabilities: ["camera"],
    ttlMs: 50,
  });
  assert.equal(relationships.sessionMay("session-a", "phone", "camera").allowed, true);

  // Evaluate as if the clock had moved past the grant.
  const later = grant.expiresAt + 1;
  assert.equal(relationships.sessionMay("session-a", "phone", "camera").allowed, true, "still live now");
  assert.equal(relationships.check({ user: "session:session-a", relation: "granted", object: "device:phone" }, later).allowed, false);
});

test("revoking a session removes its authority immediately", () => {
  const relationships = store();
  relationships.grantDeviceSession({
    ownerUserId: "owner-1",
    deviceId: "phone",
    sessionId: "session-a",
    capabilities: ["camera"],
    ttlMs: 60_000,
  });
  const removed = relationships.revokeSession("session-a");
  assert.ok(removed > 0);
  assert.equal(relationships.sessionMay("session-a", "phone", "camera").allowed, false);
});

test("organization membership implies project membership, and nothing else", () => {
  const relationships = store();
  relationships.grant({ user: OWNER, relation: "owner", object: "organization:acme" });
  relationships.grant({ user: "organization:acme", relation: "owner", object: "project:apollo" });
  relationships.grant({ user: "user:member-1", relation: "member", object: "organization:acme" });

  const member = relationships.check({ user: "user:member-1", relation: "member", object: "project:apollo" });
  assert.equal(member.allowed, true);
  assert.match(member.reason, /owns project:apollo/);

  const outsider = relationships.check({ user: "user:someone", relation: "member", object: "project:apollo" });
  assert.equal(outsider.allowed, false);

  // Membership is not edit rights.
  const edit = relationships.check({ user: "user:member-1", relation: "editor", object: "project:apollo" });
  assert.equal(edit.allowed, false, "member must not be silently promoted to editor");
});

test("a direct relationship beats an implied one, and is reported as the source", () => {
  const relationships = store();
  relationships.grant({ user: "user:x", relation: "editor", object: "workspace:w1" });
  const check = relationships.check({ user: "user:x", relation: "editor", object: "workspace:w1" });
  assert.equal(check.allowed, true);
  assert.equal(check.via?.relation, "editor");
});

test("listObjects returns only live relationships of the requested type", () => {
  const relationships = store();
  relationships.grant({ user: "user:x", relation: "member", object: "workspace:w1" });
  relationships.grant({ user: "user:x", relation: "member", object: "project:p1", ttlMs: 1 });
  const workspaces = relationships.listObjects("user:x", "member", "workspace");
  assert.deepEqual(workspaces, ["workspace:w1"]);
});
