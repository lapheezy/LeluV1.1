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

import {
  describe as describeState,
  EMPTY_MISSION_SYNC_SUMMARY,
  type PersistenceSnapshot,
} from "../src/core/persistence/PersistenceState";

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

test("connected means the cloud-backed stores agree, not that every domain is synchronized", () => {
  const snapshot = describeState("connected");
  assert.equal(snapshot.mode, "connected");
  assert.equal(snapshot.cloud, true);
  assert.equal(snapshot.identified, true);
  assert.equal(snapshot.actionable, false);
  assert.equal(snapshot.domains.cloud.remote, "connected");
  assert.equal(snapshot.domains.cloud.synchronized, false, "connection is not proof of completed reconciliation");
  assert.equal(snapshot.domains.missionLedger.synchronized, false);
  assert.equal(snapshot.domains.missionLedger.remote, "local-only");
  assert.doesNotMatch(
    snapshot.detail,
    /local and cloud state are in sync/i,
    "the old wording falsely promised MissionLedger sync",
  );
});

test("a successful unrelated cloud connection cannot mark MissionLedger synchronized", () => {
  const snapshot = describeState("connected", true, {
    ...EMPTY_MISSION_SYNC_SUMMARY,
    total: 2,
    synchronized: 2,
  });
  assert.equal(snapshot.mode, "connected");
  assert.equal(snapshot.domains.missionLedger.synchronized, false);
  assert.equal(snapshot.domains.missionLedger.remote, "local-only");
  assert.match(snapshot.domains.missionLedger.detail, /not remotely synchronized/i);
});

test("mission records stay visibly local when there is no authenticated session", () => {
  const snapshot = describeState("signed_out", true, {
    ...EMPTY_MISSION_SYNC_SUMMARY,
    total: 1,
    local: 1,
  });
  assert.equal(snapshot.domains.missionLedger.remote, "signed-out");
  assert.equal(snapshot.domains.missionLedger.synchronized, false);
  assert.match(snapshot.detail, /mission records remain local-only/i);
});

test("mission sync can only be reported when the gate is open and every record is synchronized", () => {
  const allSynchronized = { ...EMPTY_MISSION_SYNC_SUMMARY, total: 2, synchronized: 2 };
  const withoutGate = describeState("connected", true, allSynchronized, false);
  assert.equal(withoutGate.domains.missionLedger.synchronized, false);

  const withGate = describeState("connected", true, allSynchronized, true);
  assert.equal(withGate.domains.missionLedger.synchronized, true);
  assert.equal(withGate.domains.missionLedger.remote, "synchronized");

  const onePending = describeState(
    "connected",
    true,
    { ...EMPTY_MISSION_SYNC_SUMMARY, total: 2, local: 1, queued: 1 },
    true,
  );
  assert.equal(onePending.domains.missionLedger.synchronized, false);
  assert.equal(onePending.domains.missionLedger.remote, "queued");
});

test("offline still says what happens to mission records without promising a future sync", () => {
  const snapshot = describeState("connected", false, { ...EMPTY_MISSION_SYNC_SUMMARY, total: 1, local: 1 });
  assert.equal(snapshot.mode, "offline");
  assert.equal(snapshot.domains.missionLedger.remote, "offline");
  assert.equal(snapshot.domains.missionLedger.synchronized, false);
  assert.match(snapshot.detail, /mission records remain local-only/i);
});

test("every snapshot carries both persistence domains", () => {
  for (const status of ["disabled", "connecting", "connected", "signed_out", "degraded"] as const) {
    const snapshot: PersistenceSnapshot = describeState(status);
    assert.equal(snapshot.domains.cloud.local, true);
    assert.equal(snapshot.domains.missionLedger.local, true);
    assert.ok(snapshot.domains.missionLedger.detail.length > 10);
  }
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
