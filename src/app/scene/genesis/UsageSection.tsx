/**
 * Usage & budgets — the Settings view of UsageLedger, UsageSync and
 * UsageBudgetGate.
 *
 * Shows what LÉLU actually consumed: AI calls and the tokens their
 * providers REPORTED, and knowledge-source calls with failures and
 * rate limits. A call whose provider reported no tokens is counted as
 * a call with tokens unavailable; cost is shown only where a provider
 * reported one, and every other call is counted as "cost unknown".
 *
 * Signed in, the totals come from the account (public.usage_daily),
 * so every device shows the same numbers; signed out, from this
 * browser. Budgets are checked before every call (UsageBudgetGate).
 */
import { useEffect, useMemo, useState } from "react";
import UsageLedger, { ALL_SOURCES, type UsageBudget, type UsageKind, type UsageTotals } from "../../../core/observability/UsageLedger";
import UsageSync from "../../../core/observability/UsageSync";

type Period = "session" | "day" | "week" | "month";
type Row = { kind: UsageKind; source: string; totals: UsageTotals };
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "session", label: "Session" },
  { id: "day", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "month", label: "Month" },
];
const FIELDS: Array<[keyof UsageBudget, string]> = [
  ["dailyCalls", "requests/day"], ["monthlyCalls", "requests/month"],
  ["dailyTokens", "tokens/day"], ["monthlyTokens", "tokens/month"],
  ["dailyCostUsd", "reported $/day"], ["monthlyCostUsd", "reported $/month"],
];

const heading = { fontSize: 10.5, textTransform: "uppercase" as const, letterSpacing: "0.14em", opacity: 0.6, margin: "12px 0 8px" };
const tile = { flex: "1 1 130px", minWidth: 0, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" };
const inputStyle = { flex: "1 1 140px", minWidth: 0, padding: "6px 8px", borderRadius: 8, background: "rgba(0,0,0,0.3)", color: "inherit", border: "1px solid rgba(255,255,255,0.14)", fontSize: 16 } as const;
const buttonStyle = { padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(125,211,252,0.4)", background: "rgba(125,211,252,0.12)", color: "inherit", cursor: "pointer", fontSize: 12 } as const;
const fmt = (n: number) => n.toLocaleString();

const zero = (): UsageTotals => ({
  calls: 0, ok: 0, failed: 0, rateLimited: 0, tokenReportedCalls: 0, inputTokens: 0, outputTokens: 0,
  cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: 0, unknownCostCalls: 0, totalLatencyMs: 0,
});

function sumKind(rows: Row[], kind: UsageKind): UsageTotals {
  const out = zero();
  for (const r of rows) {
    if (r.kind !== kind) continue;
    for (const f of Object.keys(out) as Array<keyof UsageTotals>) out[f] += r.totals[f];
  }
  return out;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {note ? <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 2 }}>{note}</div> : null}
    </div>
  );
}

function costLabel(t: UsageTotals): { value: string; note: string } {
  const reported = t.calls - t.unknownCostCalls;
  return {
    value: reported > 0 ? `$${t.reportedCostUsd.toFixed(4)}` : "Unknown",
    note: t.unknownCostCalls > 0 ? `${fmt(t.unknownCostCalls)} call(s) with no reported cost` : "all calls reported a cost",
  };
}

export default function UsageSection() {
  const ledger = useMemo(() => UsageLedger.getInstance(), []);
  const sync = useMemo(() => UsageSync.getInstance(), []);
  const [period, setPeriod] = useState<Period>("day");
  const [, setVersion] = useState(0);
  const [budgetKind, setBudgetKind] = useState<UsageKind>("ai");
  const [budgetSource, setBudgetSource] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [account, setAccount] = useState<Row[] | null>(null);

  useEffect(() => ledger.subscribe(() => setVersion((v) => v + 1)), [ledger]);
  useEffect(() => sync.subscribe(() => setVersion((v) => v + 1)), [sync]);
  const syncStatus = sync.getStatus();

  // Signed in: totals come from the account (every device), not this browser.
  useEffect(() => {
    let live = true;
    if (!syncStatus.signedIn || period === "session") {
      setAccount(null);
      return;
    }
    sync.accountSummary(period).then((r) => { if (live) setAccount(r); }).catch(() => { if (live) setAccount(null); });
    return () => { live = false; };
  }, [sync, period, syncStatus.signedIn, syncStatus.lastSyncAt]);

  const rows: Row[] = account ?? ledger.summary(period);
  const ai = sumKind(rows, "ai");
  const api = sumKind(rows, "api");
  const budgets = ledger.budgetsSnapshot();
  const cost = costLabel(ai);
  const sources = [ALL_SOURCES, ...new Set([
    ...rows.filter((r) => r.kind === budgetKind).map((r) => r.source),
    ...Object.keys(budgets).filter((k) => k.startsWith(`${budgetKind}:`)).map((k) => k.slice(budgetKind.length + 1)),
  ])].filter((s, i, all) => all.indexOf(s) === i);

  function chooseSource(kind: UsageKind, source: string) {
    setBudgetKind(kind);
    setBudgetSource(source);
    const existing = budgets[`${kind}:${source}`] ?? {};
    setFields(Object.fromEntries(FIELDS.map(([f]) => [f, existing[f] !== undefined ? String(existing[f]) : ""])));
  }

  async function saveBudget() {
    if (!budgetSource) return;
    const budget: UsageBudget = {};
    for (const [f] of FIELDS) {
      const value = Number(fields[f]);
      if (fields[f] && Number.isFinite(value) && value > 0) budget[f] = f.endsWith("Usd") ? value : Math.floor(value);
    }
    setSaveError(null);
    try {
      await sync.saveBudget(budgetKind, budgetSource, Object.keys(budget).length ? budget : null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
    setVersion((v) => v + 1);
  }

  return (
    <div data-testid="usage-section" style={{ margin: "12px 0 4px" }}>
      <div style={{ ...heading, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>Usage &amp; budgets</span>
        <span role="tablist" style={{ display: "flex", gap: 4, opacity: 1 }}>
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              onClick={() => setPeriod(p.id)}
              style={{
                fontSize: 10.5, padding: "3px 8px", borderRadius: 999, cursor: "pointer", letterSpacing: "0.06em",
                border: "1px solid rgba(255,255,255,0.14)", color: "inherit",
                background: period === p.id ? "rgba(125,211,252,0.18)" : "transparent",
              }}
            >
              {p.label}
            </button>
          ))}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Tile label="AI calls" value={fmt(ai.calls)} note={`${fmt(ai.failed)} failed · ${fmt(ai.rateLimited)} rate-limited`} />
        <Tile
          label="AI tokens (reported)"
          value={`${fmt(ai.inputTokens)} in · ${fmt(ai.outputTokens)} out`}
          note={ai.calls === ai.tokenReportedCalls ? `${fmt(ai.cachedInputTokens)} cached input` : `${fmt(ai.calls - ai.tokenReportedCalls)} call(s) reported no tokens`}
        />
        <Tile label="AI cost" value={cost.value} note={cost.note} />
        <Tile label="Source calls" value={fmt(api.calls)} note={`${fmt(api.failed)} failed · ${fmt(api.rateLimited)} rate-limited`} />
      </div>

      <div style={heading}>By provider and source</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>Nothing recorded for this period yet.</div>
      ) : (
        <div role="table" style={{ display: "grid", gap: 4 }}>
          {rows.slice(0, 20).map((row) => {
            const decision = ledger.check(row.kind, row.source);
            const t = row.totals;
            return (
              <div
                role="row"
                key={`${row.kind}:${row.source}`}
                style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "2px 10px", fontSize: 12, padding: "6px 8px", borderRadius: 8, background: "rgba(255,255,255,0.03)" }}
              >
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  <span style={{ fontSize: 9.5, opacity: 0.55, marginRight: 6, textTransform: "uppercase" }}>{row.kind === "ai" ? "model" : "source"}</span>
                  {row.source}
                </span>
                <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
                  {fmt(t.calls)} call(s) · {fmt(t.failed)} failed
                  {row.kind === "ai" ? ` · ${t.tokenReportedCalls ? `${fmt(t.inputTokens + t.outputTokens)} tok` : "tokens n/a"}` : ""}
                  {t.calls ? ` · ${Math.round(t.totalLatencyMs / t.calls)} ms avg` : ""}
                </span>
                {decision.warning ? (
                  <span style={{ width: "100%", fontSize: 11, color: decision.allowed ? "#fbbf24" : "#f87171" }}>
                    {decision.allowed ? decision.warning : decision.reason}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div style={heading}>Budgets</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <select aria-label="Budget applies to" value={budgetKind} onChange={(e) => chooseSource(e.target.value as UsageKind, "")} style={inputStyle}>
          <option value="ai">AI providers</option>
          <option value="api">Knowledge sources</option>
        </select>
        <select aria-label="Provider or source" value={budgetSource} onChange={(e) => chooseSource(budgetKind, e.target.value)} style={inputStyle}>
          <option value="">Choose…</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s === ALL_SOURCES ? `All ${budgetKind === "ai" ? "AI providers" : "sources"}` : s}
              {budgets[`${budgetKind}:${s}`] ? " (capped)" : ""}
            </option>
          ))}
        </select>
      </div>
      {budgetSource ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 6, marginTop: 6 }}>
          {FIELDS.map(([f, label]) => (
            <input
              key={f}
              aria-label={label}
              inputMode={f.endsWith("Usd") ? "decimal" : "numeric"}
              placeholder={`${label} (none)`}
              value={fields[f] ?? ""}
              onChange={(e) => setFields((prev) => ({ ...prev, [f]: e.target.value.replace(f.endsWith("Usd") ? /[^0-9.]/g : /[^0-9]/g, "") }))}
              style={{ ...inputStyle, flex: undefined }}
            />
          ))}
          <button type="button" onClick={() => void saveBudget()} style={buttonStyle}>
            {FIELDS.some(([f]) => fields[f]) ? "Save budget" : "Clear budget"}
          </button>
        </div>
      ) : null}
      {saveError ? <div style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>Not saved to your account: {saveError}</div> : null}
      <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 6 }}>
        Budgets are checked before every call, counting calls already in flight. When one is reached, LÉLU stops and says so in chat — it never switches to another provider in its place. Spending caps count reported cost only; a provider that reports no cost cannot be held to one, so give it a request or token cap.
      </div>
      <div data-testid="usage-sync-status" style={{ fontSize: 10.5, opacity: 0.6, marginTop: 6 }}>
        {syncStatus.signedIn
          ? syncStatus.lastError
            ? `Account sync paused: ${syncStatus.lastError}. Usage is kept on this device and retried.`
            : `Synced to your account${syncStatus.lastSyncAt ? ` · ${new Date(syncStatus.lastSyncAt).toLocaleTimeString()}` : ""}${syncStatus.pending ? ` · ${syncStatus.pending} pending` : ""} · totals above are across your devices`
          : "Not signed in: usage and budgets are kept on this device only."}
      </div>
    </div>
  );
}
