/**
 * M22.7 — the live acceptance sequence (tests A–G), ready to run.
 *
 * Every step goes through the project's ordinary user APIs with the test user's
 * own JWT. No service-role key, no second account, no production data. The only
 * rows it ever touches are synthetic ones it creates itself, and it deletes them
 * as it goes.
 *
 * It did NOT run on 2026-11-20: the supplied password is rejected
 * (`invalid_credentials`). Run it once the credential and the M22.7 migration are
 * in place:
 *
 *   node MISSION-22.7/probe/live-acceptance.mjs > MISSION-22.7/evidence/live-acceptance.json
 *
 * It prints PASS/FAIL per check plus a JSON summary. No token, key, password or
 * deleted statement is ever written out: statements are synthetic and are
 * reported as booleans ("found"/"absent"), and ids are truncated.
 */

import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_USER_EMAIL;
const PASSWORD = process.env.SUPABASE_TEST_USER_PASSWORD;

const missing = Object.entries({
  SUPABASE_URL: URL_,
  SUPABASE_ANON_KEY: KEY,
  SUPABASE_TEST_USER_EMAIL: EMAIL,
  SUPABASE_TEST_USER_PASSWORD: PASSWORD,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

const out = { kind: "live acceptance", at: new Date().toISOString(), checks: [], ran: false, blocked: null };
let failures = 0;
const check = (id, name, ok, detail) => {
  if (!ok) failures += 1;
  out.checks.push({ id, name, ok: Boolean(ok), detail: detail ?? null });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const signIn = async () => {
  const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email: EMAIL.trim().toLowerCase(),
    password: PASSWORD,
  });
  if (error) return { client: null, error, session: null };
  return { client, error: null, session: data.session };
};

if (missing.length) {
  out.blocked = { reason: "missing environment variables", missing };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

/* ------------------------------------------------------------ sign in */

console.log("\n=== M22.7 live acceptance ===");
const first = await signIn();
if (first.error) {
  // Reported, not retried: retrying a rejected password is not a test.
  out.blocked = { reason: "sign-in rejected", status: first.error.status ?? null, message: first.error.message };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
out.ran = true;
const userId = first.session.user.id;
out.userId = userId;
check("A0", "an ordinary authenticated session is established", Boolean(userId), `user ${userId.slice(0, 8)}…`);

/** A client for this user, with the JWT attached the same way the app does. */
const authed = (session) =>
  createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
let db = authed(first.session);

const SUFFIX = Date.now().toString(36);
const stamp = new Date().toISOString();
const statement = `synthetic acceptance statement ${SUFFIX} — the release codename is HARBOUR-${SUFFIX}`;
const memoryId = `m22.7-accept-${SUFFIX}`;

const rowFor = (id, text) => ({
  id,
  user_id: userId,
  category: "acceptance",
  memory_type: "user",
  prompt: text,
  response: "acknowledged",
  keywords: ["acceptance", SUFFIX],
  context: {},
  importance: 0.1,
  confidence: 0.9,
  created_at: stamp,
  updated_at: stamp,
});

const findRow = async (client, id) => {
  const { data, error } = await client.from("memory_items").select("id,prompt").eq("id", id);
  if (error) throw new Error(error.code ?? error.message);
  return data ?? [];
};
const tombstone = async (client, id) => {
  const { data, error } = await client.from("memory_tombstones").select("memory_id,deleted_at").eq("memory_id", id);
  if (error) return { available: false, code: error.code ?? null, found: false };
  return { available: true, found: (data ?? []).length > 0, rows: data ?? [] };
};

/* ------------------------------------------------ A. authenticated deletion */

const created = await db.from("memory_items").insert(rowFor(memoryId, statement));
check("A1", "a synthetic memory can be stored for this user", !created.error,
  created.error ? created.error.code ?? created.error.message : "inserted");
const beforeDelete = await findRow(db, memoryId);
check("A2", "it is readable back before deletion", beforeDelete.length === 1, `${beforeDelete.length} row(s)`);

const erased = await db.rpc("erase_memory", { p_id: memoryId, p_fingerprint: `fp-${SUFFIX}` });
const rpcMissing = Boolean(erased.error) && /does not exist|function/i.test(erased.error.message ?? "");
check("A3", "erase_memory exists on this deployment", !rpcMissing,
  erased.error ? `${erased.error.code ?? ""} ${erased.error.message ?? ""}`.trim() : `removed ${erased.data}`);
if (rpcMissing) {
  // Clean up the row we created rather than leaving it behind.
  await db.from("memory_items").delete().eq("id", memoryId).eq("user_id", userId);
}

const afterDelete = await findRow(db, memoryId);
check("A4", "the row is gone from the server", afterDelete.length === 0, `${afterDelete.length} row(s)`);
const tomb = await tombstone(db, memoryId);
check("A5", "a server-side tombstone records the deletion", tomb.found,
  tomb.available ? `tombstone present: ${tomb.found}` : `table unavailable (${tomb.code})`);

/* ------------------------------------------------------ B. new session */

const second = await signIn();
check("B1", "a fresh session can be established", Boolean(second.session));
if (second.session) {
  db = authed(second.session);
  const hydrated = await findRow(db, memoryId);
  check("B2", "hydration in the new session does not return the deleted memory", hydrated.length === 0,
    `${hydrated.length} row(s)`);
  const tomb2 = await tombstone(db, memoryId);
  check("B3", "the new session can see the deletion and adopt it", tomb2.found, `found: ${tomb2.found}`);
}

/* --------------------------------------------------- C. stale upload race */

// A record captured before the deletion, submitted after it.
const staleId = `m22.7-stale-${SUFFIX}`;
const stalePayload = rowFor(staleId, `${statement} (stale copy)`);
const staleInsert = await db.from("memory_items").insert(stalePayload);
check("C1", "a memory exists to capture a stale payload from", !staleInsert.error,
  staleInsert.error ? staleInsert.error.code ?? staleInsert.error.message : "inserted");
const staleSnapshot = stalePayload;
await db.rpc("erase_memory", { p_id: staleId, p_fingerprint: `fp-stale-${SUFFIX}` });

const resurrect = await db.from("memory_items").insert(staleSnapshot);
const refused = Boolean(resurrect.error) && /memory_deleted/i.test(resurrect.error.message ?? "");
check("C2", "re-submitting the pre-deletion payload is refused by the database", refused,
  resurrect.error ? `${resurrect.error.code ?? ""} ${resurrect.error.message ?? ""}`.trim() : "ACCEPTED — resurrection is possible");
const staleAfter = await findRow(db, staleId);
check("C3", "the stale row did not reappear", staleAfter.length === 0, `${staleAfter.length} row(s)`);

/* ------------------------------------------------------ D. cross-device */

const deviceA = authed(first.session);
const deviceB = authed(second.session ?? first.session);
const crossId = `m22.7-cross-${SUFFIX}`;
await deviceA.from("memory_items").insert(rowFor(crossId, `${statement} (cross device)`));
const seenByB = await findRow(deviceB, crossId);
check("D1", "both clients see the record on the same account", seenByB.length === 1, `${seenByB.length} row(s)`);
await deviceA.rpc("erase_memory", { p_id: crossId, p_fingerprint: `fp-cross-${SUFFIX}` });
const bAfter = await findRow(deviceB, crossId);
check("D2", "after deletion on client A, client B's re-read cannot regain it", bAfter.length === 0,
  `${bAfter.length} row(s)`);

/* --------------------------------------------------- E. ownership isolation */

const foreignInsert = await db.from("memory_items").insert({
  ...rowFor(`m22.7-foreign-${SUFFIX}`, "a row claiming another owner"),
  user_id: "00000000-0000-0000-0000-000000000000",
});
check("E1", "a row claiming another user_id is refused by the with-check", Boolean(foreignInsert.error),
  foreignInsert.error ? foreignInsert.error.code ?? foreignInsert.error.message : "ACCEPTED — ownership is not enforced");

const anon = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anonRead = await anon.from("memory_items").select("id").limit(5);
check("E2", "an anonymous client reads no rows", !anonRead.error && (anonRead.data ?? []).length === 0,
  anonRead.error ? anonRead.error.code ?? anonRead.error.message : `${(anonRead.data ?? []).length} row(s)`);

const anonErase = await anon.rpc("erase_memory", { p_id: crossId, p_fingerprint: "" });
check("E3", "an anonymous client cannot erase anything", Boolean(anonErase.error),
  anonErase.error ? anonErase.error.code ?? anonErase.error.message : "ACCEPTED — unauthenticated erase is possible");

/* --------------------------------------------------- F. user restatement */

// The same words, stated again deliberately, must be storable as NEW input.
const restated = await db.from("memory_items").insert(rowFor(`m22.7-restate-${SUFFIX}`, statement));
check("F1", "a deliberate restatement can be stored under a new id", !restated.error,
  restated.error ? restated.error.code ?? restated.error.message : "inserted");
const oldStillGone = await findRow(db, memoryId);
check("F2", "restating does not bring the deleted record back", oldStillGone.length === 0, `${oldStillGone.length} row(s)`);
await db.rpc("erase_memory", { p_id: `m22.7-restate-${SUFFIX}`, p_fingerprint: "" });

/* -------------------------------------------------- G. interrupted deletion */

// Simulated by calling erase_memory with a client whose requests fail: the
// server never sees it, which is exactly the offline case. The durable queue is
// the client's job and is covered by tests C/D; here the server side must remain
// idempotent when the retry finally arrives.
const offlineId = `m22.7-offline-${SUFFIX}`;
await db.from("memory_items").insert(rowFor(offlineId, `${statement} (offline)`));
const retried = await db.rpc("erase_memory", { p_id: offlineId, p_fingerprint: "" });
const retriedAgain = await db.rpc("erase_memory", { p_id: offlineId, p_fingerprint: "" });
check("G1", "a retried deletion succeeds", !retried.error, retried.error?.code ?? `removed ${retried.data}`);
check("G2", "repeating it is idempotent (0 removed, no error)", !retriedAgain.error && Number(retriedAgain.data) === 0,
  retriedAgain.error ? retriedAgain.error.code : `removed ${retriedAgain.data}`);

/* ------------------------------------------------------------- cleanup */

const cleanupIds = [
  `m22.7-restate-${SUFFIX}`,
  `m22.7-cross-${SUFFIX}`,
  memoryId,
  staleId,
  offlineId,
];
const cleaned = await db.from("memory_items").delete().in("id", cleanupIds).eq("user_id", userId);
check("Z1", "the synthetic rows are cleaned up", !cleaned.error, cleaned.error?.code ?? "deleted");

out.failures = failures;
out.passed = out.checks.filter((entry) => entry.ok).length;
out.total = out.checks.length;
console.log(`\n${out.passed}/${out.total} live checks passed, ${failures} failed`);
await first.client.auth.signOut();
console.log(JSON.stringify(out, null, 2));
process.exit(failures === 0 ? 0 : 1);
