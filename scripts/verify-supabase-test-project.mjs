/**
 * LÉLU — real authentication, RLS and persistence checks against the
 * ISOLATED test project (never production).
 *
 *   node scripts/verify-supabase-test-project.mjs   (reads .lelu-runtime/test-supabase.env)
 *
 * Prints one line per check and a JSON summary. Never prints passwords or
 * tokens. Refuses to run unless the URL is the lelu-v11-test project.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "ugshflwlyakipeduifkd";
const env = Object.fromEntries(
  readFileSync(new URL("../.lelu-runtime/test-supabase.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const URL_ = env.LELU_TEST_SUPABASE_URL;
const KEY = env.LELU_TEST_SUPABASE_PUBLISHABLE_KEY;
if (!URL_?.includes(TEST_REF)) throw new Error(`refusing to run: ${URL_} is not the ${TEST_REF} test project`);

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const memoryStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), _m: m }; };
const client = (storage = memoryStore()) => ({ sb: createClient(URL_, KEY, { auth: { storage, persistSession: true, autoRefreshToken: false } }), storage });
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
const rowId = `audit-${Date.now()}`;

// 1–3: sign-in and session for both identities.
const admin = client();
const user = client();
const a = await admin.sb.auth.signInWithPassword({ email: env.LELU_TEST_ADMIN_EMAIL, password: env.LELU_TEST_ADMIN_PASSWORD });
check("admin signs in", !a.error && Boolean(a.data.session), a.error?.message ?? "");
const u = await user.sb.auth.signInWithPassword({ email: env.LELU_TEST_USER_EMAIL, password: env.LELU_TEST_USER_PASSWORD });
check("standard user signs in", !u.error && Boolean(u.data.session), u.error?.message ?? "");
const wrong = await client().sb.auth.signInWithPassword({ email: env.LELU_TEST_USER_EMAIL, password: "not-the-password" });
check("wrong password is refused", Boolean(wrong.error), wrong.error?.message ?? "signed in!");
const adminId = a.data.user.id, userId = u.data.user.id;
const ac = claims(a.data.session.access_token), uc = claims(u.data.session.access_token);
check("roles come from app_metadata in the JWT", ac.app_metadata?.lelu_role === "admin" && uc.app_metadata?.lelu_role === "user", `admin=${ac.app_metadata?.lelu_role} user=${uc.app_metadata?.lelu_role}`);
check("the session has an expiry", typeof uc.exp === "number" && uc.exp > Date.now() / 1000, `expires in ${Math.round(uc.exp - Date.now() / 1000)} s`);

// 4: refresh.
const before = u.data.session.access_token;
const r = await user.sb.auth.refreshSession();
check("session refresh issues a new token", !r.error && r.data.session?.access_token && r.data.session.access_token !== before, r.error?.message ?? "");

// 5: standard user writes and reads its own row.
const ins = await user.sb.from("conversations").insert({ id: rowId, user_id: userId, title: "RLS audit conversation" }).select();
check("user writes its own conversation", !ins.error && ins.data?.length === 1, ins.error?.message ?? "");
const own = await user.sb.from("conversations").select("id,title").eq("id", rowId);
check("user reads it back", own.data?.length === 1 && own.data[0].title === "RLS audit conversation", own.error?.message ?? "");

// 6: "reload": a new client restored from the stored session only.
const reloaded = client(user.storage);
const restored = await reloaded.sb.auth.getSession();
check("session restores from storage after a reload", restored.data.session?.user.id === userId);
const afterReload = await reloaded.sb.from("conversations").select("id").eq("id", rowId);
check("the row is there after the reload", afterReload.data?.length === 1, afterReload.error?.message ?? "");

// 7: a brand-new sign-in (new session) still sees it — it is persisted, not cached.
const fresh = client();
await fresh.sb.auth.signInWithPassword({ email: env.LELU_TEST_USER_EMAIL, password: env.LELU_TEST_USER_PASSWORD });
const afterNew = await fresh.sb.from("conversations").select("id").eq("id", rowId);
check("the row persists into a new session", afterNew.data?.length === 1, afterNew.error?.message ?? "");

// 8: isolation — the admin is an ordinary row owner in the database.
const adminRead = await admin.sb.from("conversations").select("id").eq("id", rowId);
check("admin cannot read the user's row (RLS)", !adminRead.error && adminRead.data.length === 0, `${adminRead.data?.length ?? "error"} rows`);
const adminForge = await admin.sb.from("conversations").insert({ id: `${rowId}-forged`, user_id: userId, title: "forged" });
check("admin cannot write a row as the user (WITH CHECK)", Boolean(adminForge.error), adminForge.error?.code ?? "inserted!");
const adminUpdate = await admin.sb.from("conversations").update({ title: "hijacked" }).eq("id", rowId).select();
check("admin cannot change the user's row", !adminUpdate.error && adminUpdate.data.length === 0, `${adminUpdate.data?.length ?? "error"} rows changed`);
const adminDelete = await admin.sb.from("conversations").delete().eq("id", rowId).select();
check("admin cannot delete the user's row", !adminDelete.error && adminDelete.data.length === 0, `${adminDelete.data?.length ?? "error"} rows deleted`);
const steal = await user.sb.from("conversations").update({ user_id: adminId }).eq("id", rowId).select();
check("user cannot hand its row to another user", Boolean(steal.error) || steal.data?.length === 0, steal.error?.code ?? `${steal.data?.length} rows`);
const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
const anonRead = await anon.from("conversations").select("id");
check("anonymous client reads nothing", !anonRead.error ? anonRead.data.length === 0 : true, anonRead.error?.code ?? `${anonRead.data.length} rows`);
const anonWrite = await anon.from("conversations").insert({ id: `${rowId}-anon`, user_id: userId, title: "anon" });
check("anonymous client cannot write", Boolean(anonWrite.error), anonWrite.error?.code ?? "inserted!");

// 9: privilege escalation through user_metadata does not change the role.
const esc = await user.sb.auth.updateUser({ data: { lelu_role: "admin" } });
const escClaims = claims((await user.sb.auth.refreshSession()).data.session.access_token);
check("a user cannot make itself admin", !esc.error && escClaims.app_metadata?.lelu_role === "user", `app_metadata.lelu_role=${escClaims.app_metadata?.lelu_role} (user_metadata may say ${escClaims.user_metadata?.lelu_role})`);

// 10: a tampered token is rejected by the server.
const good = (await user.sb.auth.getSession()).data.session.access_token;
const parts = good.split(".");
const forgedPayload = Buffer.from(JSON.stringify({ ...claims(good), app_metadata: { lelu_role: "admin" } })).toString("base64url");
const tampered = createClient(URL_, KEY, { global: { headers: { Authorization: `Bearer ${parts[0]}.${forgedPayload}.${parts[2]}` } }, auth: { persistSession: false } });
const tamperedRead = await tampered.from("conversations").select("id");
check("a forged admin token is rejected", Boolean(tamperedRead.error), tamperedRead.error?.code ?? `${tamperedRead.data?.length} rows`);
const tamperedUser = await anon.auth.getUser(`${parts[0]}.${forgedPayload}.${parts[2]}`);
check("the auth server refuses the forged token", Boolean(tamperedUser.error), tamperedUser.error?.message ?? "accepted!");

// 11: sign-out revokes the refresh token.
const beforeOut = (await fresh.sb.auth.getSession()).data.session;
await fresh.sb.auth.signOut();
const reuse = await client().sb.auth.refreshSession({ refresh_token: beforeOut.refresh_token });
check("after sign-out the refresh token no longer works", Boolean(reuse.error), reuse.error?.message ?? "refreshed!");

// Clean up the row this run created.
const del = await user.sb.from("conversations").delete().eq("id", rowId).select();
check("user deletes its own test row", !del.error && del.data.length === 1);

const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ project: TEST_REF, checks: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
