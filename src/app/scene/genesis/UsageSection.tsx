/**
 * Usage & budgets — the Settings view of UsageLedger.
 *
 * Shows what LÉLU actually consumed: AI calls and the tokens their
 * providers REPORTED, and knowledge-source calls with failures and
 * rate limits. A call whose provider reported no tokens is counted as
 * a call with tokens unavailable; cost is shown only where a provider
 * reported one, and every other call is counted as "cost unknown".
 *
 * Budgets set here are hard daily call caps on a knowledge source,
 * enforced by ResearchResolver before the call.
 */
import { useEffect, useMemo, useState } from "react";
import UsageLedger, { type UsageTotals } from "../../../core/observability/UsageLedger";

type Period = "session" | "day" | "week" | "month";
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "session", label: "Session" },
  { id: "day", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "month", label: "Month" },
];

const heading = { fontSize: 10.5, textTransform: "uppercase" as const, letterSpacing: "0.14em", opacity: 0.6, margin: "12px 0 8px" };
const tile = { flex: "1 1 130px", minWidth: 0, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" };
const fmt = (n: number) => n.toLocaleString();

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
  const [period, setPeriod] = useState<Period>("day");
  const [, setVersion] = useState(0);
  const [budgetSource, setBudgetSource] = useState("");
  const [budgetCalls, setBudgetCalls] = useState("");

  useEffect(() => ledger.subscribe(() => setVersion((v) => v + 1)), [ledger]);

  const rows = ledger.summary(period);
  const ai = ledger.totals(period, "ai");
  const api = ledger.totals(period, "api");
  const budgets = ledger.budgetsSnapshot();
  const apiSources = [...new Set([...rows.filter((r) => r.kind === "api").map((r) => r.source), ...Object.keys(budgets).filter((k) => k.startsWith("api:")).map((k) => k.slice(4))])].sort();
  const cost = costLabel(ai);

  function saveBudget() {
    const cap = Number(budgetCalls);
    if (!budgetSource) return;
    ledger.setBudget("api", budgetSource, Number.isFinite(cap) && cap > 0 ? { dailyCalls: Math.floor(cap) } : null);
    setBudgetCalls("");
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

      <div style={heading}>Daily call budget for a source</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <select
          aria-label="Source"
          value={budgetSource}
          onChange={(e) => setBudgetSource(e.target.value)}
          style={{ flex: "1 1 140px", minWidth: 0, padding: "6px 8px", borderRadius: 8, background: "rgba(0,0,0,0.3)", color: "inherit", border: "1px solid rgba(255,255,255,0.14)", fontSize: 16 }}
        >
          <option value="">{apiSources.length ? "Choose a source…" : "No sources used yet"}</option>
          {apiSources.map((s) => (
            <option key={s} value={s}>{s}{budgets[`api:${s}`]?.dailyCalls ? ` (cap ${budgets[`api:${s}`].dailyCalls}/day)` : ""}</option>
          ))}
        </select>
        <input
          aria-label="Daily call cap"
          inputMode="numeric"
          placeholder="calls/day (empty = no cap)"
          value={budgetCalls}
          onChange={(e) => setBudgetCalls(e.target.value.replace(/[^0-9]/g, ""))}
          style={{ flex: "1 1 120px", minWidth: 0, padding: "6px 8px", borderRadius: 8, background: "rgba(0,0,0,0.3)", color: "inherit", border: "1px solid rgba(255,255,255,0.14)", fontSize: 16 }}
        />
        <button
          type="button"
          onClick={saveBudget}
          disabled={!budgetSource}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(125,211,252,0.4)", background: "rgba(125,211,252,0.12)", color: "inherit", cursor: budgetSource ? "pointer" : "default", fontSize: 12 }}
        >
          {budgetCalls ? "Set cap" : "Clear cap"}
        </button>
      </div>
      <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 6 }}>
        A cap is a hard stop: once reached, LÉLU does not call that source again today and says so. It never switches to a paid source in its place.
      </div>
    </div>
  );
}
