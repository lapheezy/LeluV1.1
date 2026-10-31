/**
 * ==========================================================
 * LÉLU — PERSISTENCE STATE
 *
 * CATEGORY: unit. Pure translation; no client, no network.
 *
 * Why this exists: Supabase was reachable only through the
 * settings panel, so cloud persistence read as an optional
 * feature rather than as the infrastructure the runtime sits
 * on. Anything that cared had to import SupabasePersistence
 * and interpret its internal status — `disabled`,
 * `signed_out`, `connecting` — which describes the CLIENT's
 * condition, not the data's.
 *
 * The distinction that matters most here: no configuration is
 * LOCAL, which is a normal mode of operation, not a fault.
 * Reporting it as an error is how a status indicator teaches
 * people to ignore it.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { describe as describeState } from "../src/core/persistence/PersistenceState";

test("no cloud configuration is local operation, not an error", () => {
  const snapshot = describeState("disabled");
  assert.equal(snapshot.mode, "local");
  assert.equal(snapshot.cloud, false);
  assert.equal(snapshot.actionable, false, "there is nothing for the user to fix");
  assert.doesNotMatch(snapshot.detail, /error|fail/i);
});

test("configured but signed out is the one state the user can fix", () => {
  const snapshot = describeState("signed_out");
  assert.equal(snapshot.mode, "local");
  assert.equal(snapshot.identified, false);
  assert.equal(snapshot.actionable, true);
  assert.match(snapshot.detail, /sign in/i);
});

test("connecting reads as syncing", () => {
  const snapshot = describeState("connecting");
  assert.equal(snapshot.mode, "syncing");
  assert.equal(snapshot.cloud, true);
});

test("connected means local and cloud agree", () => {
  const snapshot = describeState("connected");
  assert.equal(snapshot.mode, "connected");
  assert.equal(snapshot.cloud, true);
  assert.equal(snapshot.identified, true);
  assert.equal(snapshot.actionable, false);
});

test("degraded says local is authoritative, not that data is lost", () => {
  const snapshot = describeState("degraded");
  assert.equal(snapshot.mode, "degraded");
  assert.equal(snapshot.identified, true);
  assert.match(snapshot.detail, /local state is authoritative/i);
});

test("losing the network reads as offline, and local still works", () => {
  const snapshot = describeState("connected", false);
  assert.equal(snapshot.mode, "offline");
  assert.match(snapshot.detail, /kept on this device/i);
  assert.equal(snapshot.actionable, false, "a missing network is not a user error");
});

test("an unconfigured install offline is still just local", () => {
  // Offline must not override local-only: there is no cloud to be cut off
  // from, and "Offline" would imply something is missing that is not.
  const snapshot = describeState("disabled", false);
  assert.equal(snapshot.mode, "local");
});

test("every state has a label and a reason", () => {
  for (const status of ["disabled", "connecting", "connected", "signed_out", "degraded"] as const) {
    const snapshot = describeState(status);
    assert.ok(snapshot.label.length > 0, `${status} needs a label`);
    assert.ok(snapshot.detail.length > 10, `${status} needs a reason`);
    assert.ok(snapshot.updatedAt > 0);
  }
});

test("the five reported modes are exactly the documented set", () => {
  const modes = new Set(
    (["disabled", "connecting", "connected", "signed_out", "degraded"] as const).map(
      (status) => describeState(status).mode,
    ),
  );
  modes.add(describeState("connected", false).mode);
  assert.deepEqual(
    [...modes].sort(),
    ["connected", "degraded", "local", "offline", "syncing"],
  );
});

test("persistence is attached from the runtime, not from the settings panel", () => {
  const bridge = readFileSync("src/app/scene/genesis/ProactiveBridge.tsx", "utf8");
  assert.match(bridge, /PersistenceStateStore\.getInstance\(\)\.attach\(\)/);
});

test("there is still exactly one Supabase client in the app", () => {
  // The brief's hard constraint. A facade that opened its own client
  // would be the duplicate persistence layer it exists to avoid.
  const facade = readFileSync("src/core/persistence/PersistenceState.ts", "utf8");
  assert.ok(!facade.includes("createClient"), "the facade must not create a client");
  assert.match(facade, /SupabasePersistence/, "it reads the existing one");
});
