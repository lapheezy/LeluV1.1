/**
 * Phase 9: per-user usage persistence and AI budget enforcement.
 *
 * OFFLINE tests. The account side is a fake that implements the same
 * contract as the SQL functions (reserve_usage / settle_usage /
 * release_usage, usage_records keyed by (user_id, id)). The SQL itself,
 * RLS and real concurrency are verified against Postgres by
 * scripts/verify-usage-supabase.ts and recorded in
 * docs/api-ecosystem/PHASE_9_USAGE_PERSISTENCE.md.
 */
import assert from "node:assert/strict";
import test from "node:test";

import UsageLedger, { legacyEventId, type UsageEvent } from "../src/core/observability/UsageLedger";
import UsageBudgetGate, { BudgetExhaustedError, budgetNotice, type UsageRemote } from "../src/core/observability/UsageBudgetGate";
import UsageSync, { evaluateAccountBudgets, toRow, type UsageBackend } from "../src/core/observability/UsageSync";
import ProviderResolver from "../src/core/router/ProviderResolver";
import ExecutionLogger from "../src/core/ExecutionLogger";

const T0 = Date.parse("2026-11-07T10:00:00Z");
const memoryStorage = () => {
  const store = new Map<string, string>();
  return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), store };
};

/* ---------- a fake account that keeps the SQL contract ---------- */

class FakeAccount {
  records = new Map<string, Map<string, Record<string, unknown>>>(); // user → id → row
  reservations = new Map<string, Map<string, { kind: string; source: string }>>();
  budgets = new Map<string, Record<string, unknown>[]>();
  online = true;
  latencyMs = 0;

  private rows(user: string) {
    if (!this.records.has(user)) this.records.set(user, new Map());
    return this.records.get(user)!;
  }
  private held(user: string) {
    if (!this.reservations.has(user)) this.reservations.set(user, new Map());
    return this.reservations.get(user)!;
  }

  remote(user: string): UsageRemote {
    const wait = () => new Promise((r) => setTimeout(r, this.latencyMs));
    return {
      reserve: async ({ id, kind, source }) => {
        await wait();
        if (!this.online) throw new Error("fetch failed");
        // Atomic (single JS turn) — the role the advisory lock plays in SQL.
        const held = this.held(user);
        if (held.has(id)) return { allowed: true };
        for (const b of this.budgets.get(user) ?? []) {
          if (b.kind !== kind || (b.source !== source && b.source !== "*")) continue;
          const used = [...this.rows(user).values()].filter((r) => r.kind === kind && (b.source === "*" || r.source === source)).length;
          const inFlight = [...held.values()].filter((r) => r.kind === kind && (b.source === "*" || r.source === source)).length;
          if (b.daily_requests !== undefined && used + inFlight + 1 > Number(b.daily_requests)) {
            return { allowed: false, reason: `${b.source === "*" ? "all ai providers" : source}: daily request budget reached (${used} used + ${inFlight} in flight of ${b.daily_requests}).` };
          }
        }
        held.set(id, { kind, source });
        return { allowed: true, warnings: [] };
      },
      settle: async (id, event) => {
        await wait();
        if (!this.online) throw new Error("fetch failed");
        if (!this.rows(user).has(id)) this.rows(user).set(id, toRow(event, user));
        this.held(user).delete(id);
      },
      release: async (id) => {
        await wait();
        this.held(user).delete(id);
      },
    };
  }

  /** The PostgREST slice UsageSync uses, scoped to one user the way RLS scopes it. */
  client(user: string): UsageBackend {
    const ok = <T>(data: T) => Promise.resolve({ data, error: null });
    const fail = () => Promise.resolve({ data: null, error: { message: "fetch failed" } });
    return {
      rpc: (fn: string, args: Record<string, unknown>) => {
        const remote = this.remote(user);
        const run = async () => {
          if (fn === "reserve_usage") return remote.reserve({ id: String(args.p_id), kind: args.p_kind as "ai", source: String(args.p_source), reserveTokens: Number(args.p_reserve_tokens) });
          const row = args.p_record as Record<string, unknown> | undefined;
          if (fn === "settle_usage") {
            if (!this.online) throw new Error("fetch failed");
            if (!this.rows(user).has(String(args.p_reservation_id))) this.rows(user).set(String(args.p_reservation_id), { ...row, user_id: user });
            this.held(user).delete(String(args.p_reservation_id));
            return null;
          }
          await remote.release(String(args.p_reservation_id));
          return null;
        };
        return run().then((data) => ({ data, error: null }), (e: Error) => ({ data: null, error: { message: e.message } }));
      },
      from: (table: string) => ({
        upsert: (rows: unknown) => {
          if (!this.online) return fail();
          if (table === "usage_records") {
            for (const row of rows as Array<Record<string, unknown>>) {
              if (row.user_id !== user) return Promise.resolve({ data: null, error: { message: "new row violates row-level security policy" } });
              if (!this.rows(user).has(String(row.id))) this.rows(user).set(String(row.id), row); // ON CONFLICT DO NOTHING
            }
          } else {
            const row = rows as Record<string, unknown>;
            const list = (this.budgets.get(user) ?? []).filter((b) => !(b.kind === row.kind && b.source === row.source));
            list.push(row);
            this.budgets.set(user, list);
          }
          return ok(null);
        },
        select: () => {
          const all = table === "usage_budgets" ? (this.budgets.get(user) ?? []) : [];
          const result = this.online ? ok(all) : fail();
          return Object.assign(result, { gte: () => (this.online ? ok([]) : fail()) }) as never;
        },
        delete: () => ({ eq: (_c: string, kind: string) => ({ eq: (_c2: string, source: string) => {
          this.budgets.set(user, (this.budgets.get(user) ?? []).filter((b) => !(b.kind === kind && b.source === source)));
          return ok(null);
        } }) }),
      }),
    };
  }
}

/* ---------- device budgets, concurrency, failure, reset ---------- */

test("concurrent calls on one device cannot overspend: a cap of 3 admits exactly 3 of 10 simultaneous reservations", async () => {
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  ledger.setBudget("ai", "Groq", { dailyCalls: 3 });
  const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () => gate.reserve("ai", "Groq")));
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 3);
  const refused = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
  assert.ok(refused.reason instanceof BudgetExhaustedError);
  assert.match(refused.reason.message, /3 in flight/);
});

test("an all-providers budget counts every provider's calls; a per-provider budget only its own", async () => {
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  ledger.setBudget("ai", "*", { dailyCalls: 2 });
  await gate.reserve("ai", "Groq");
  await gate.reserve("ai", "Cerebras");
  await assert.rejects(gate.reserve("ai", "Fireworks"), /all AI providers: daily calls budget reached/);
});

test("a failed provider call is still a request; a call stopped before sending gives its reservation back", async () => {
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  ledger.setBudget("ai", "Groq", { dailyCalls: 2 });
  const sent = await gate.reserve("ai", "Groq");
  await gate.settle(sent, { ok: false, error: "Groq 500" });
  const stopped = await gate.reserve("ai", "Groq");
  await gate.release(stopped);
  assert.equal(ledger.totals("day", "ai").calls, 1, "the released call recorded nothing");
  assert.equal(ledger.totals("day", "ai").failed, 1);
  assert.equal(gate.inFlightCount(), 0);
  await gate.reserve("ai", "Groq"); // the released unit is available again
  await assert.rejects(gate.reserve("ai", "Groq"), BudgetExhaustedError);
});

test("unknown tokens and cost stay unknown: a token cap counts reported tokens only, a spend cap reported cost only", async () => {
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  ledger.setBudget("ai", "Fireworks", { dailyTokens: 1000, dailyCostUsd: 0.01 });
  const r = await gate.reserve("ai", "Fireworks");
  const e = await gate.settle(r, { ok: true }); // provider reported nothing
  assert.equal(e.inputTokens, null);
  assert.equal(e.costKind, "unknown");
  assert.equal(e.costUsd, null);
  const decision = ledger.check("ai", "Fireworks");
  assert.equal(decision.allowed, true, "nothing reported, nothing estimated, nothing blocked");
  assert.match(decision.warning ?? "", /reported no cost — the spending cap counts reported cost only/);
  const r2 = await gate.reserve("ai", "Fireworks");
  await gate.settle(r2, { ok: true, usage: { prompt_tokens: 900, completion_tokens: 150, cost: 0.012 } });
  await assert.rejects(gate.reserve("ai", "Fireworks"), /daily tokens budget reached \(1050\/1000\)/);
});

test("a reported spend reaching the cap stops the next call", async () => {
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  ledger.setBudget("ai", "OpenRouter", { monthlyCostUsd: 0.05 });
  const r = await gate.reserve("ai", "OpenRouter");
  await gate.settle(r, { ok: true, usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.05 } });
  await assert.rejects(gate.reserve("ai", "OpenRouter"), /monthly reported spend \(\$\) budget reached \(0\.0500\/0\.05\)/);
});

test("budgets reset: a daily cap reopens the next day, a monthly cap the next month", async () => {
  let t = T0;
  const ledger = new UsageLedger(() => t, null);
  const gate = new UsageBudgetGate(ledger);
  ledger.setBudget("ai", "Groq", { dailyCalls: 1, monthlyCalls: 2 });
  await gate.settle(await gate.reserve("ai", "Groq"), { ok: true });
  await assert.rejects(gate.reserve("ai", "Groq"), /daily calls/);
  t += 86_400_000;
  await gate.settle(await gate.reserve("ai", "Groq"), { ok: true });
  t += 86_400_000;
  await assert.rejects(gate.reserve("ai", "Groq"), /monthly calls budget reached \(2\/2\)/);
  t = Date.parse("2026-12-01T00:00:01Z");
  await gate.reserve("ai", "Groq");
});

/* ---------- account side: cross-device, offline ---------- */

test("two devices of one user share the account budget: 10 simultaneous calls across both admit exactly the cap", async () => {
  const account = new FakeAccount();
  account.latencyMs = 3;
  account.budgets.set("user-a", [{ kind: "ai", source: "Groq", daily_requests: 4 }]);
  const phone = new UsageBudgetGate(new UsageLedger(() => T0, null));
  const laptop = new UsageBudgetGate(new UsageLedger(() => T0, null));
  phone.setRemote(() => account.remote("user-a"));
  laptop.setRemote(() => account.remote("user-a"));
  const outcomes = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => (i % 2 ? phone : laptop).reserve("ai", "Groq")));
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 4);
  const refused = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
  assert.equal((refused.reason as BudgetExhaustedError).scope, "account");
  assert.match(budgetNotice(refused.reason), /your account budget \(all devices\).*instead of switching to another provider/);
});

test("offline: the device budget still applies, the reservation says the account was not checked, and the record syncs later without duplicating", async () => {
  const account = new FakeAccount();
  const storage = memoryStorage();
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  const sync = new UsageSync(ledger, gate, storage);
  sync.start(() => ({ client: account.client("user-a"), userId: "user-a" }), undefined, (c) => account.remote(c.userId));
  await sync.refresh();
  account.online = false;
  const r = await gate.reserve("ai", "Groq");
  assert.equal(r.accountChecked, false);
  assert.match(r.warnings.join(" "), /offline/);
  await gate.settle(r, { ok: true, usage: { prompt_tokens: 12, completion_tokens: 3 } });
  await sync.flush();
  assert.equal(sync.getStatus().lastError, "fetch failed");
  assert.equal(account.records.get("user-a")?.size ?? 0, 0);
  account.online = true;
  await sync.flush();
  await sync.flush();
  assert.equal(account.records.get("user-a")?.size, 1, "synced once, then nothing left to sync");
  assert.equal(account.records.get("user-a")?.get(r.id)?.input_tokens, 12);
});

test("an online call is settled on the account by its reservation id, and the later sync of the same event writes no second row", async () => {
  const account = new FakeAccount();
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  const sync = new UsageSync(ledger, gate, memoryStorage());
  sync.start(() => ({ client: account.client("user-a"), userId: "user-a" }), undefined, (c) => account.remote(c.userId));
  await sync.refresh();
  const r = await gate.reserve("ai", "Groq");
  assert.equal(r.accountChecked, true);
  await gate.settle(r, { ok: true, usage: { input_tokens: 5, output_tokens: 2 } });
  await sync.flush();
  assert.equal(account.records.get("user-a")?.size, 1);
  assert.equal(account.reservations.get("user-a")?.size, 0, "the reservation was swapped for the record");
});

/* ---------- users and isolation ---------- */

test("multiple users on one browser: each user's events go only to that user; signed-out events stay on the device", async () => {
  const account = new FakeAccount();
  const storage = memoryStorage();
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  const sync = new UsageSync(ledger, gate, storage);
  let who: string | null = null;
  sync.start(() => (who ? { client: account.client(who), userId: who } : null), undefined, (c) => account.remote(c.userId));

  await sync.refresh();
  ledger.record({ kind: "ai", source: "Groq", ok: true }); // signed out
  who = "user-a";
  await sync.refresh();
  ledger.record({ kind: "ai", source: "Groq", ok: true });
  ledger.record({ kind: "api", source: "wikipedia", ok: true });
  await sync.flush();
  who = "user-b";
  await sync.refresh();
  ledger.record({ kind: "ai", source: "Cerebras", ok: true });
  await sync.flush();

  assert.equal(account.records.get("user-a")?.size, 2);
  assert.equal(account.records.get("user-b")?.size, 1, "B received none of A's or the anonymous events");
  assert.deepEqual([...account.records.get("user-b")!.values()].map((r) => r.source), ["Cerebras"]);
  for (const [user, rows] of account.records) for (const row of rows.values()) assert.equal(row.user_id, user);
});

test("budgets follow the user across devices: saved on one, enforced on another", async () => {
  const account = new FakeAccount();
  const deviceA = new UsageLedger(() => T0, null);
  const syncA = new UsageSync(deviceA, new UsageBudgetGate(deviceA), memoryStorage());
  syncA.start(() => ({ client: account.client("user-a"), userId: "user-a" }), undefined, (c) => account.remote(c.userId));
  await syncA.saveBudget("ai", "Groq", { dailyCalls: 1 });

  const deviceB = new UsageLedger(() => T0, null);
  const gateB = new UsageBudgetGate(deviceB);
  const syncB = new UsageSync(deviceB, gateB, memoryStorage());
  syncB.start(() => ({ client: account.client("user-a"), userId: "user-a" }), undefined, (c) => account.remote(c.userId));
  await syncB.refresh();
  assert.deepEqual(deviceB.budgetsSnapshot()["ai:Groq"], { dailyCalls: 1 });
  await gateB.settle(await gateB.reserve("ai", "Groq"), { ok: true });
  await assert.rejects(gateB.reserve("ai", "Groq"), BudgetExhaustedError);
});

/* ---------- refresh / legacy records ---------- */

test("browser refresh: events keep their ids, events recorded before ids existed get stable ids, nothing re-syncs twice", async () => {
  const storage = memoryStorage();
  const legacy = { at: T0 - 1000, kind: "ai", source: "Groq", ok: true, inputTokens: 3, outputTokens: 1, cachedInputTokens: null, reasoningTokens: null, costUsd: null, costKind: "unknown" };
  storage.setItem("lelu.usage.v1", JSON.stringify({ daily: {}, budgets: {}, events: [legacy] }));
  const first = new UsageLedger(() => T0, storage);
  const second = new UsageLedger(() => T0, storage);
  assert.equal(first.allEvents()[0].id, second.allEvents()[0].id);
  assert.equal(first.allEvents()[0].id, legacyEventId(legacy as unknown as UsageEvent));
  assert.equal(first.allEvents()[0].userId, null, "a legacy event belongs to no user and is not synced to anyone");
  first.record({ kind: "api", source: "rss", ok: true });
  const reloaded = new UsageLedger(() => T0, storage);
  assert.equal(reloaded.allEvents().at(-1)?.id, first.allEvents().at(-1)?.id);
});

/* ---------- the chat path ---------- */

function spy(name: string, requiresApiKey = false) {
  const calls: unknown[] = [];
  return {
    calls,
    provider: {
      name, priority: 1, enabled: true, timeout: 10000, requiresApiKey, capabilities: ["chat"] as const,
      initialize: async () => {}, isAvailable: async () => true,
      health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
      canHandle: () => true,
      generate: async (request: unknown) => {
        calls.push(request);
        return { text: `answer from ${name}`, provider: name, model: `${name}-1`, processingTime: 1, metadata: { usage: { prompt_tokens: 20, completion_tokens: 4 } } };
      },
    },
  };
}

function chat(providers: unknown[]) {
  return {
    request: { prompt: "hello", messages: [], timestamp: Date.now() },
    started: Date.now(),
    logger: new ExecutionLogger(),
    aiProviders: {
      available: async () => providers, names: () => providers.map((p) => (p as { name: string }).name),
      markFailure: () => {}, markSuccess: () => {}, all: () => providers, get: () => providers[0],
    },
  } as never;
}

test("chat: a spent budget answers with a notice inside the chat and does NOT fall through to the next (possibly paid) provider", async () => {
  const ledger = UsageLedger.getInstance();
  const free = spy("FreeTier");
  const paid = spy("PaidProvider", true);
  ledger.setBudget("ai", "FreeTier", { dailyCalls: 1 });
  try {
    const first = await new ProviderResolver().execute(chat([free.provider, paid.provider]));
    assert.equal(first.response?.text, "answer from FreeTier");
    const second = await new ProviderResolver().execute(chat([free.provider, paid.provider]));
    assert.equal(free.calls.length, 1, "the capped provider was not called again");
    assert.equal(paid.calls.length, 0, "no silent switch to another provider");
    assert.equal(second.response?.provider, "budget");
    assert.match(second.response?.text ?? "", /I didn't send this to FreeTier: FreeTier: daily calls budget reached \(1\/1\)/);
    assert.match(second.response?.text ?? "", /Settings → Usage & budgets/);
    const recorded = ledger.recent(5).filter((e) => e.source === "FreeTier");
    assert.equal(recorded.length, 1, "the refused call recorded nothing");
    assert.equal(recorded[0].inputTokens, 20, "the provider-reported tokens were kept");
  } finally {
    ledger.setBudget("ai", "FreeTier", null);
  }
});

test("chat continuity: with no budget set, a turn runs exactly as before and is metered", async () => {
  const p = spy("Unbudgeted");
  const before = UsageLedger.getInstance().totals("session", "ai").calls;
  const result = await new ProviderResolver().execute(chat([p.provider]));
  assert.equal(result.response?.text, "answer from Unbudgeted");
  assert.equal(UsageLedger.getInstance().totals("session", "ai").calls, before + 1);
  assert.equal(UsageBudgetGate.getInstance().inFlightCount(), 0, "no reservation left behind");
});

test("a provider failure is settled as a failed request and the chain falls back as before (no budget involved)", async () => {
  const broken = { ...spy("Broken").provider, generate: async () => { throw new Error("Broken 503"); } };
  const ok = spy("Healthy");
  const result = await new ProviderResolver().execute(chat([broken, ok.provider]));
  assert.equal(result.response?.text, "answer from Healthy");
  const failed = UsageLedger.getInstance().recent(10).find((e) => e.source === "Broken");
  assert.equal(failed?.ok, false);
  assert.equal(failed?.error, "Broken 503");
  assert.equal(UsageBudgetGate.getInstance().inFlightCount(), 0);
});


/* ---------- the account-side admission rule (pure) ---------- */

const budget = (over: Record<string, unknown>) => ({
  kind: "ai", source: "Groq", daily_requests: null, monthly_requests: null, daily_tokens: null,
  monthly_tokens: null, daily_cost_usd: null, monthly_cost_usd: null, ...over,
});
const dayRow = (over: Record<string, unknown>) => ({
  day: "2026-11-07", kind: "ai", source: "Groq", requests: 0, input_tokens: null, output_tokens: null,
  reported_cost_usd: null, unknown_cost_requests: 0, ...over,
});
const held = (id: string, source = "Groq") => ({ id, source, reserved_tokens: 0, created_at: "2026-11-07T10:00:00Z" });

test("account rule: used + reservations ranked ahead + this one must fit the cap", () => {
  const b = [budget({ daily_requests: 4 })];
  assert.equal(evaluateAccountBudgets("Groq", 0, b, [dayRow({ requests: 2 })], [held("a")], "2026-11-07").allowed, true, "2 + 1 + 1 = 4");
  const r = evaluateAccountBudgets("Groq", 0, b, [dayRow({ requests: 2 })], [held("a"), held("b")], "2026-11-07");
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "Groq: daily request budget reached (2 used + 2 in flight of 4).");
});

test("account rule: yesterday counts for the month, not the day; '*' covers every source; other sources do not count against a per-source cap", () => {
  const rows = [dayRow({ day: "2026-11-06", requests: 5 }), dayRow({ source: "Cerebras", requests: 3 })];
  assert.equal(evaluateAccountBudgets("Groq", 0, [budget({ daily_requests: 1 })], rows, [], "2026-11-07").allowed, true);
  assert.equal(evaluateAccountBudgets("Groq", 0, [budget({ monthly_requests: 5 })], rows, [], "2026-11-07").allowed, false);
  const all = evaluateAccountBudgets("Groq", 0, [budget({ source: "*", daily_requests: 3 })], rows, [], "2026-11-07");
  assert.match(all.reason ?? "", /^all AI providers: daily request budget reached \(3 used/);
});

test("account rule: tokens are reported tokens plus declared reservations; cost is reported cost only, unknown never estimated", () => {
  const rows = [dayRow({ requests: 3, input_tokens: 900, output_tokens: 50, unknown_cost_requests: 3 })];
  assert.equal(evaluateAccountBudgets("Groq", 0, [budget({ daily_tokens: 1000 })], rows, [], "2026-11-07").allowed, true);
  assert.equal(evaluateAccountBudgets("Groq", 100, [budget({ daily_tokens: 1000 })], rows, [], "2026-11-07").allowed, false);
  const spend = evaluateAccountBudgets("Groq", 0, [budget({ monthly_cost_usd: "0.01" })], rows, [], "2026-11-07");
  assert.equal(spend.allowed, true, "3 calls of unknown cost are not guessed into a spend");
  assert.match(spend.warnings?.[0] ?? "", /3 call\(s\) this month reported no cost/);
  const reported = [dayRow({ requests: 1, reported_cost_usd: "0.0100", unknown_cost_requests: 0 })];
  assert.equal(evaluateAccountBudgets("Groq", 0, [budget({ monthly_cost_usd: "0.01" })], reported, [], "2026-11-07").allowed, false);
});

/* ---------- every billed path is gated (found live: a health probe ran past a spent budget) ---------- */

test("gatedGenerate: a refused call never reaches the provider and records nothing", async () => {
  const { gatedGenerate } = await import("../src/core/observability/UsageBudgetGate");
  const ledger = UsageLedger.getInstance();
  ledger.setBudget("ai", "ProbeTarget", { dailyCalls: 1 });
  let sent = 0;
  const provider = { name: "ProbeTarget", generate: async () => { sent += 1; return { text: "ok", model: "m", metadata: { usage: { prompt_tokens: 1, completion_tokens: 1 } } }; } };
  try {
    await gatedGenerate(provider, { prompt: "ping" }, "health-probe");
    await assert.rejects(gatedGenerate(provider, { prompt: "ping" }, "health-probe"), BudgetExhaustedError);
    assert.equal(sent, 1);
    const probes = ledger.recent(10).filter((e) => e.source === "ProbeTarget");
    assert.equal(probes.length, 1);
    assert.equal(probes[0].operation, "health-probe");
  } finally {
    ledger.setBudget("ai", "ProbeTarget", null);
  }
});

test("no code calls a model provider's generate() except through the budget gate", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      // The gate itself, and on-device inference (free, never billed).
      if (/UsageBudgetGate\.ts$|LocalRuntime\.ts$|LocalInferenceProvider\.ts$/.test(path)) continue;
      readFileSync(path, "utf8").split("\n").forEach((line, i) => {
        if (/\bprovider\.generate\(/.test(line)) offenders.push(`${path}:${i + 1}`);
      });
    }
  };
  walk("src");
  assert.deepEqual(offenders, [], "ungated provider.generate() call(s)");
});

test("a fresh signed-in device does not send until the account's budgets are loaded (found live)", async () => {
  const account = new FakeAccount();
  account.budgets.set("user-a", [{ kind: "ai", source: "*", daily_requests: 1 }]);
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  const sync = new UsageSync(ledger, gate, memoryStorage());
  sync.start(() => ({ client: account.client("user-a"), userId: "user-a" }), undefined, (c) => account.remote(c.userId));
  // No refresh() awaited: the first call races the budget load, as on a real cold start.
  const r = await gate.reserve("ai", "Groq");
  assert.deepEqual(ledger.budgetsSnapshot()["ai:*"], { dailyCalls: 1 }, "the account budget was loaded before the call was admitted");
  await gate.settle(r, { ok: true });
  await assert.rejects(gate.reserve("ai", "Cerebras"), /all AI providers/);
});

test("signed in but the account's budgets cannot be loaded: the call is refused, not sent blind", async () => {
  const account = new FakeAccount();
  account.online = false;
  const ledger = new UsageLedger(() => T0, null);
  const gate = new UsageBudgetGate(ledger);
  const sync = new UsageSync(ledger, gate, memoryStorage());
  sync.start(() => ({ client: account.client("user-a"), userId: "user-a" }), undefined, (c) => account.remote(c.userId));
  gate.setAccountReadiness(() => sync.accountReady(50));
  await assert.rejects(gate.reserve("ai", "Groq"), /budgets could not be loaded yet/);
  account.online = true;
  await gate.reserve("ai", "Groq");
});
