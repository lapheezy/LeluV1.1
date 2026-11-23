/**
 * M22.7 — live probe of the lelu-v11-test project.
 *
 * Answers only questions that need the real project: does an ordinary
 * authenticated sign-in work, which tables exist, and does RLS actually hide
 * rows from a client with no session? Nothing here creates or deletes an
 * account, and no token, key or password is printed.
 *
 * Usage: node MISSION-22.7/probe/live-probe.mjs
 * Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TEST_USER_EMAIL,
 * SUPABASE_TEST_USER_PASSWORD in the environment. Writes JSON to stdout;
 * redirect it into evidence.
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

if (missing.length) {
  console.log(JSON.stringify({ ran: false, missing }, null, 2));
  process.exit(0);
}

const out = {
  ran: true,
  at: new Date().toISOString(),
  project: new URL(URL_).host,
  keyKind: KEY.startsWith("sb_") ? "publishable" : KEY.split(".").length === 3 ? "jwt" : "unknown",
  signIn: null,
  tables: {},
  rls: {},
  anonAccess: {},
};

const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/* ---------------------------------------------------------------- sign-in */

const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
  email: EMAIL.trim().toLowerCase(),
  password: PASSWORD,
});

if (signInError) {
  out.signIn = { ok: false, error: signInError.message, status: signInError.status ?? null };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const session = signIn?.session;
const user = signIn?.user;
out.signIn = {
  ok: Boolean(session),
  status: 200,
  // Non-secret identifiers only.
  userId: user?.id ?? null,
  userIdShape: /^[0-9a-f-]{36}$/.test(user?.id ?? "") ? "uuid" : "unexpected",
  emailConfirmed: Boolean(user?.email_confirmed_at),
  role: user?.role ?? null,
  tokenKind: session?.access_token?.startsWith("eyJ") ? "jwt" : "unknown",
  expiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  refreshTokenPresent: Boolean(session?.refresh_token),
};

const authed = createClient(URL_, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${session.access_token}` } },
});

/* ------------------------------------------------- plain-text content scan */

// Does the account hold content at all, and which tables answer?
const CANDIDATES = [
  "memory_items",
  "legacy_memories",
  "memory_tombstones",
  "memory_deletions",
  "knowledge_items",
  "cognitive_events",
  "user_preferences",
  "projects",
  "conversations",
  "messages",
  "ui_state",
  "agents",
  "usage_records",
];

for (const table of CANDIDATES) {
  const { count, error } = await authed
    .from(table)
    .select("*", { count: "exact", head: true });
  out.tables[table] = error
    ? { exists: false, code: error.code ?? null, message: (error.message ?? "").slice(0, 120) }
    : { exists: true, rows: count ?? null };
}

/* -------------------------------------------------------------- RLS checks */

// 1. Every row this session can see must belong to this user.
for (const table of ["memory_items", "projects", "conversations", "knowledge_items"]) {
  if (!out.tables[table]?.exists) continue;
  const { data, error } = await authed.from(table).select("user_id").limit(500);
  if (error) {
    out.rls[table] = { readable: false, error: (error.message ?? "").slice(0, 120) };
    continue;
  }
  const foreign = (data ?? []).filter((row) => row.user_id && row.user_id !== user.id).length;
  out.rls[table] = { readable: true, rowsRead: data?.length ?? 0, foreignRowsVisible: foreign };
}

// 2. Without a session the same query must return nothing. A client with the
//    publishable key but no Authorization header is exactly "anonymous".
const anon = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
for (const table of ["memory_items", "legacy_memories", "projects", "memory_tombstones"]) {
  if (!out.tables[table]?.exists) continue;
  const { data, error } = await anon.from(table).select("id").limit(5);
  out.anonAccess[table] = error
    ? { rows: null, error: (error.message ?? "").slice(0, 120), code: error.code ?? null }
    : { rows: data?.length ?? 0 };
}

// 3. A write with no session must be refused, not silently accepted.
{
  const probe = `anon-probe-${Date.now()}`;
  const { error } = await anon.from("memory_items").insert({
    id: probe,
    user_id: user.id,
    category: "probe",
    prompt: "probe",
    response: "probe",
  });
  out.anonAccess.insertAsAnon = error
    ? { refused: true, code: error.code ?? null, message: (error.message ?? "").slice(0, 120) }
    : { refused: false };
}

// 4. A write forging another user's id must be refused by the with-check.
{
  const { error } = await authed.from("memory_items").insert({
    id: `forge-probe-${Date.now()}`,
    user_id: "00000000-0000-0000-0000-000000000000",
    category: "probe",
    prompt: "probe",
    response: "probe",
  });
  out.rls.forgedUserId = error
    ? { refused: true, code: error.code ?? null, message: (error.message ?? "").slice(0, 120) }
    : { refused: false };
}

await client.auth.signOut();
console.log(JSON.stringify(out, null, 2));
