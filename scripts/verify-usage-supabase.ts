/**
 * LIVE verification of Phase 9 against a real Supabase project: RLS
 * isolation with two real users, concurrent reservations from two devices,
 * failure/release, unknown usage, duplicate-safe sync, cross-device budgets
 * and history, budget reset semantics, and offline behaviour.
 *
 *   LELU_VERIFY_SUPABASE_URL=https://<ref>.supabase.co \
 *   LELU_VERIFY_SUPABASE_KEY=<publishable key> \
 *   LELU_VERIFY_USERS=/path/to/users.json \        # {a:{email,password},b:{...}} — never committed
 *   npx tsx scripts/verify-usage-supabase.ts <out.json>
 *
 * Every check runs through the same code the app uses (SupabaseUsageRemote,
 * UsageSync, UsageBudgetGate) with the user's own session; nothing uses a
 * service key, so every result is what RLS actually allows.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import UsageLedger from "../src/core/observability/UsageLedger.ts";
import UsageBudgetGate, { BudgetExhaustedError } from "../src/core/observability/UsageBudgetGate.ts";
import UsageSync, { SupabaseUsageRemote, type UsageChannel } from "../src/core/observability/UsageSync.ts";

const url = process.env.LELU_VERIFY_SUPABASE_URL!;
const key = process.env.LELU_VERIFY_SUPABASE_KEY!;
const users = JSON.parse(readFileSync(process.env.LELU_VERIFY_USERS!, "utf8")) as Record<"a" | "b", { email: string; password: string }>;
const run = `v${Date.now().toString(36)}`;
const results: Array<{ check: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

async function signIn(who: "a" | "b"): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword(users[who]);
  if (error || !data.user) throw new Error(`sign-in ${who}: ${error?.message}`);
  return { client, userId: data.user.id };
}

const rid = (label: string) => `${run}-${label}-${Math.random().toString(36).slice(2, 8)}`;
const record = (userId: string, id: string, extra: Record<string, unknown> = {}) => ({
  user_id: userId, id, kind: "ai", source: `${run}-rls`, ok: true, cost_kind: "unknown", occurred_at: new Date().toISOString(), ...extra,
});

const phoneA = await signIn("a");
const laptopA = await signIn("a"); // a second, independent session of the same user
const B = await signIn("b");
const anon = createClient(url, key, { auth: { persistSession: false } });
check("two real users signed in (and a second device for A)", phoneA.userId !== B.userId && phoneA.userId === laptopA.userId, `A=${phoneA.userId.slice(0, 8)}… B=${B.userId.slice(0, 8)}…`);

/* ---------------- RLS isolation ---------------- */
{
  const idA = rid("rlsA");
  const ins = await phoneA.client.from("usage_records").insert(record(phoneA.userId, idA, { input_tokens: 11, output_tokens: 4 }));
  check("A inserts its own record", !ins.error, ins.error?.message ?? "inserted");

  const seenByB = await B.client.from("usage_records").select("id").eq("id", idA);
  check("B cannot read A's record", !seenByB.error && seenByB.data?.length === 0, `B saw ${seenByB.data?.length ?? "error"} row(s)`);

  const forged = await B.client.from("usage_records").insert(record(phoneA.userId, rid("forged")));
  check("B cannot insert a record as A", Boolean(forged.error), forged.error?.message ?? "INSERT WAS ACCEPTED");

  const upd = await phoneA.client.from("usage_records").update({ input_tokens: 0 }).eq("id", idA).select("id");
  const del = await phoneA.client.from("usage_records").delete().eq("id", idA).select("id");
  const still = await phoneA.client.from("usage_records").select("input_tokens").eq("id", idA).single();
  check("A cannot rewrite or delete its own record (append-only)", still.data?.input_tokens === 11 && (upd.data?.length ?? 0) === 0 && (del.data?.length ?? 0) === 0,
    `update affected ${upd.data?.length ?? upd.error?.message}, delete affected ${del.data?.length ?? del.error?.message}, input_tokens still ${still.data?.input_tokens}`);

  const anonRead = await anon.from("usage_records").select("id").limit(5);
  check("signed-out (anon) callers read nothing", (anonRead.data?.length ?? 0) === 0, anonRead.error ? `refused: ${anonRead.error.message}` : `${anonRead.data?.length} rows`);

  const anonIns = await anon.from("usage_records").insert(record(phoneA.userId, rid("anon")));
  check("signed-out (anon) callers write nothing", Boolean(anonIns.error), anonIns.error?.message ?? "INSERT WAS ACCEPTED");

  await phoneA.client.from("usage_budgets").upsert({ user_id: phoneA.userId, kind: "ai", source: `${run}-rls`, daily_requests: 9 });
  const bBudgets = await B.client.from("usage_budgets").select("source").eq("source", `${run}-rls`);
  check("B cannot read A's budgets", (bBudgets.data?.length ?? 0) === 0, `${bBudgets.data?.length ?? bBudgets.error?.message} row(s)`);

  const resA = await phoneA.client.from("usage_reservations").insert({ user_id: phoneA.userId, id: rid("resA"), kind: "ai", source: `${run}-rls` }).select("id").single();
  const bDel = await B.client.from("usage_reservations").delete().eq("id", resA.data?.id ?? "").select("id");
  const bFake = await B.client.from("usage_reservations").insert({ user_id: phoneA.userId, id: rid("resB"), kind: "ai", source: `${run}-rls` });
  check("B cannot remove or forge A's reservations", (bDel.data?.length ?? 0) === 0 && Boolean(bFake.error), `delete affected ${bDel.data?.length}, forge: ${bFake.error?.message ?? "ACCEPTED"}`);
  await phoneA.client.from("usage_reservations").delete().eq("id", resA.data?.id ?? "");

  const bDaily = await B.client.from("usage_daily").select("source").eq("source", `${run}-rls`);
  check("the aggregation view honours RLS for B", (bDaily.data?.length ?? 0) === 0, `${bDaily.data?.length ?? bDaily.error?.message} row(s)`);
}

/* ---------------- concurrency: two devices, one account ---------------- */
{
  const source = `${run}-concurrency`;
  await phoneA.client.from("usage_budgets").upsert({ user_id: phoneA.userId, kind: "ai", source, daily_requests: 4 });
  const phone = new SupabaseUsageRemote(phoneA as UsageChannel);
  const laptop = new SupabaseUsageRemote(laptopA as UsageChannel);
  const ids = Array.from({ length: 10 }, (_, i) => rid(`c${i}`));
  const verdicts = await Promise.all(ids.map((id, i) => (i % 2 ? phone : laptop).reserve({ id, kind: "ai", source, reserveTokens: 0 })));
  const admitted = ids.filter((_, i) => verdicts[i].allowed);
  check("10 simultaneous reservations from 2 devices never exceed a cap of 4", admitted.length <= 4,
    `${admitted.length} admitted, ${10 - admitted.length} refused (e.g. "${verdicts.find((v) => !v.allowed)?.reason}")`);
  const leftover = await phoneA.client.from("usage_reservations").select("id").eq("source", source);
  check("refused reservations were withdrawn", leftover.data?.length === admitted.length, `${leftover.data?.length} live reservation(s) = ${admitted.length} admitted`);
  for (const id of admitted) {
    await phone.settle(id, { id, userId: phoneA.userId, at: Date.now(), kind: "ai", source, ok: true, inputTokens: 10, outputTokens: 2, cachedInputTokens: null, reasoningTokens: null, costUsd: null, costKind: "unknown" });
  }
  const after = await phoneA.client.from("usage_reservations").select("id").eq("source", source);
  const recs = await phoneA.client.from("usage_records").select("id").eq("source", source);
  check("each admitted call settled into exactly one record, reservation released", after.data?.length === 0 && recs.data?.length === admitted.length, `${recs.data?.length} record(s), ${after.data?.length} reservation(s) left`);
  // fill to the cap sequentially, then the next is refused
  for (let i = admitted.length; i < 4; i += 1) {
    const id = rid(`fill${i}`);
    const v = await phone.reserve({ id, kind: "ai", source, reserveTokens: 0 });
    if (v.allowed) await phone.settle(id, { id, userId: phoneA.userId, at: Date.now(), kind: "ai", source, ok: true, inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null, costUsd: null, costKind: "unknown" });
  }
  const over = await laptop.reserve({ id: rid("over"), kind: "ai", source, reserveTokens: 0 });
  check("at the cap, the next call from the other device is refused before dispatch", !over.allowed, over.reason ?? "ALLOWED");
}

/* ---------------- gate end-to-end: failure, release, unknown, reported cost ---------------- */
{
  const source = `${run}-gate`;
  const ledger = new UsageLedger(() => Date.now(), null);
  ledger.setUser(phoneA.userId);
  const gate = new UsageBudgetGate(ledger);
  gate.setRemote(() => new SupabaseUsageRemote(phoneA as UsageChannel));
  const failed = await gate.reserve("ai", source);
  await gate.settle(failed, { ok: false, error: "provider 503", latencyMs: 40 });
  const released = await gate.reserve("ai", source);
  await gate.release(released);
  const unknown = await gate.reserve("ai", source);
  await gate.settle(unknown, { ok: true, model: "m-1", latencyMs: 30 });
  const priced = await gate.reserve("ai", source);
  await gate.settle(priced, { ok: true, model: "m-1", usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.00042 } });
  const rows = (await phoneA.client.from("usage_records").select("id, ok, error, input_tokens, output_tokens, cost_usd, cost_kind").eq("source", source)).data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  check("a failed provider call is stored as a failed request", byId.get(failed.id)?.ok === false && byId.get(failed.id)?.error === "provider 503", JSON.stringify(byId.get(failed.id)));
  check("a released reservation leaves no record", !byId.has(released.id), `${rows.length} record(s) for 4 reservations`);
  check("unreported tokens and cost are stored as NULL / unknown, not 0", byId.get(unknown.id)?.input_tokens === null && byId.get(unknown.id)?.cost_usd === null && byId.get(unknown.id)?.cost_kind === "unknown", JSON.stringify(byId.get(unknown.id)));
  check("provider-reported tokens and cost are stored exactly", byId.get(priced.id)?.input_tokens === 120 && Number(byId.get(priced.id)?.cost_usd) === 0.00042 && byId.get(priced.id)?.cost_kind === "reported", JSON.stringify(byId.get(priced.id)));
  check("account-checked reservations", [failed, unknown, priced].every((r) => r.accountChecked), "accountChecked = true for all");
}

/* ---------------- sync, duplicates, cross-device budgets and history ---------------- */
{
  const source = `${run}-sync`;
  const phoneLedger = new UsageLedger(() => Date.now(), null);
  const phoneGate = new UsageBudgetGate(phoneLedger);
  const phoneSync = new UsageSync(phoneLedger, phoneGate, memory());
  phoneSync.start(() => phoneA as UsageChannel);
  await phoneSync.refresh();
  for (let i = 0; i < 3; i += 1) phoneLedger.record({ kind: "api", source, ok: true, results: i, latencyMs: 100 + i });
  await phoneSync.flush();
  await phoneSync.flush();
  const settled = await phoneGate.reserve("ai", `${source}-ai`);
  await phoneGate.settle(settled, { ok: true, usage: { input_tokens: 7, output_tokens: 3 } });
  await phoneSync.flush(); // the same event again, now via the bulk sync
  const apiRows = await phoneA.client.from("usage_records").select("id").eq("source", source);
  const aiRows = await phoneA.client.from("usage_records").select("id").eq("source", `${source}-ai`);
  check("sync is duplicate-safe (3 events flushed twice → 3 rows; settled + synced event → 1 row)", apiRows.data?.length === 3 && aiRows.data?.length === 1, `${apiRows.data?.length} + ${aiRows.data?.length}`);

  await phoneSync.saveBudget("ai", `${source}-ai`, { dailyCalls: 1, monthlyTokens: 5000 });
  const laptopLedger = new UsageLedger(() => Date.now(), null);
  const laptopGate = new UsageBudgetGate(laptopLedger);
  const laptopSync = new UsageSync(laptopLedger, laptopGate, memory());
  laptopSync.start(() => laptopA as UsageChannel);
  await laptopSync.refresh();
  check("a budget saved on one device is loaded on another", laptopLedger.budgetsSnapshot()[`ai:${source}-ai`]?.dailyCalls === 1, JSON.stringify(laptopLedger.budgetsSnapshot()[`ai:${source}-ai`]));
  let refused = "";
  try {
    await laptopGate.reserve("ai", `${source}-ai`);
  } catch (e) {
    refused = e instanceof BudgetExhaustedError ? `${e.scope}: ${e.message}` : String(e);
  }
  check("…and enforced there against usage recorded on the first device", refused.startsWith("account:"), refused || "NOT REFUSED");
  const history = await laptopSync.accountSummary("day");
  const row = history?.find((r) => r.source === source);
  check("history recorded on one device is visible on the other (usage_daily)", row?.totals.calls === 3, `calls=${row?.totals.calls}, latency total=${row?.totals.totalLatencyMs}`);
  const bHistory = await B.client.from("usage_daily").select("source").like("source", `${run}%`);
  check("…and invisible to the other user", (bHistory.data?.length ?? 0) === 0, `${bHistory.data?.length} row(s)`);
}

/* ---------------- reset semantics and offline ---------------- */
{
  const source = `${run}-reset`;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  await phoneA.client.from("usage_records").insert(record(phoneA.userId, rid("y"), { source, occurred_at: yesterday }));
  await phoneA.client.from("usage_budgets").upsert({ user_id: phoneA.userId, kind: "ai", source, daily_requests: 1, monthly_requests: 1 });
  const remote = new SupabaseUsageRemote(phoneA as UsageChannel);
  const sameMonth = new Date(yesterday).getUTCMonth() === new Date().getUTCMonth();
  const v = await remote.reserve({ id: rid("r"), kind: "ai", source, reserveTokens: 0 });
  check(
    "yesterday's call does not count against today's cap; it does against the month",
    sameMonth ? !v.allowed && /monthly request/.test(v.reason ?? "") : v.allowed,
    v.allowed ? "allowed (yesterday was last month)" : (v.reason ?? ""),
  );
  await phoneA.client.from("usage_budgets").update({ monthly_requests: null }).eq("source", source);
  const v2 = await remote.reserve({ id: rid("r2"), kind: "ai", source, reserveTokens: 0 });
  check("with only a daily cap, a new day starts with the full allowance", v2.allowed, v2.allowed ? "allowed" : (v2.reason ?? ""));

  const offlineLedger = new UsageLedger(() => Date.now(), null);
  const offlineGate = new UsageBudgetGate(offlineLedger);
  const unreachable = createClient("http://127.0.0.1:9", key, { auth: { persistSession: false } });
  offlineGate.setRemote(() => new SupabaseUsageRemote({ client: unreachable, userId: phoneA.userId }));
  const free = await offlineGate.reserve("ai", `${source}-uncapped`);
  await offlineGate.settle(free, { ok: true });
  offlineLedger.setBudget("ai", source, { dailyCalls: 5 });
  let stopped = "";
  try { await offlineGate.reserve("ai", source); } catch (e) { stopped = (e as Error).message; }
  check("offline: an uncapped call goes out flagged; a capped call is refused because the account cannot confirm it",
    !free.accountChecked && /could not be reached to confirm/.test(stopped), `uncapped accountChecked=${free.accountChecked}; capped: ${stopped}`);
}

const report = { project: new URL(url).hostname.split(".")[0], run, ranAt: new Date().toISOString(), passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
console.log(`\n${report.passed} passed, ${report.failed} failed`);
process.exitCode = report.failed ? 1 : 0;
