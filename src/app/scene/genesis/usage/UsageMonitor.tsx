/**
 * ==========================================================
 * LÉLU — USAGE & CONVERSATIONS MONITOR (WP19.2 – 19.8)
 *
 * The owner's operational picture and controls. Everything shown is read
 * from the authorities (ConversationRegistry, UsageLedger rollups,
 * ResourcePolicy, UsageBudgetGate); every control writes the same runtime
 * settings the gate and AgentRunner enforce, then shows the value read back.
 * Unavailable measurements say so; tokens are provider-reported only.
 * ==========================================================
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ConversationRegistry, { type ConversationStatus, type ConversationType } from "../../../../core/observability/ConversationRegistry";
import ResourcePolicy, { LIMITS, type NumericControl } from "../../../../core/observability/ResourcePolicy";
import UsageLedger, { BACKGROUND_BUDGET_SOURCE } from "../../../../core/observability/UsageLedger";
import { alerts, byAgent, byModel, conversationRanges, exportCsv, exportJson, recordSample, series, systemRanges, UNAVAILABLE, type Point, type Range, type Resolution } from "../../../../core/observability/UsageAnalytics";
import { apply, interpret, report, type Plan } from "../../../../core/observability/ResourceCommands";
import AgentStore from "../../../../core/agents/AgentStore";
import AgentDialogue from "../../../../core/agents/AgentDialogue";
import { UsageView } from "./usageView";
import "./usage.css";

/* Reference palette, dark steps (dataviz references/palette.md). */
const BLUE = "#338ced";
const SEQ = ["#cce3fd", "#9dc8f7", "#6aabf1", "#338ced", "#2370cd", "#1757ac"];
const STATUS: Record<ConversationStatus, { color: string; icon: string }> = {
  active: { color: "#0aac23", icon: "●" },
  idle: { color: "#94a3b8", icon: "○" },
  paused: { color: "#fbb315", icon: "❚❚" },
  completed: { color: "#338ced", icon: "✓" },
  failed: { color: "#dc3c3d", icon: "✕" },
  terminated: { color: "#f18a59", icon: "■" },
};
const TYPES: ConversationType[] = ["user-chat", "voice", "agent-task", "agent-direct", "agent-group", "self-dialogue", "tool", "browser", "background", "unattributed"];

function useTick(): number {
  const [n, set] = useState(0);
  useEffect(() => {
    const bump = () => set((x) => x + 1);
    const offs = [ConversationRegistry.getInstance().subscribe(bump), UsageLedger.getInstance().subscribe(bump), ResourcePolicy.getInstance().subscribe(bump), AgentStore.getInstance().subscribe(bump)];
    // While the monitor is open, gauges are sampled (measured) every 15 s for display.
    void recordSample().then(bump);
    const t = setInterval(() => void recordSample().then(bump), 15_000);
    return () => {
      offs.forEach((o) => o());
      clearInterval(t);
    };
  }, []);
  return n;
}

const fmt = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "—" : `${Math.round(v * 100) / 100}${unit}`);
const when = (t: number | null) => (t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const agentName = (id: string) => AgentStore.getInstance().get(id.replace(/^agent:/, ""))?.name ?? id.replace(/^agent:/, "");

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------- charts */

function Columns({ points, read, label, color = BLUE, unit = "" }: { points: Point[]; read: (p: Point) => number | null; label: string; color?: string; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 150;
  const vals = points.map(read);
  const max = Math.max(1, ...vals.map((v) => v ?? 0));
  const bw = points.length ? (W - 40) / points.length : 0;
  const ticks = [0, max / 2, max];
  return (
    <figure className="um-chart" data-chart={label} data-points={points.length}>
      <figcaption>{label}</figcaption>
      {points.length === 0 ? (
        <p className="um-empty">No measurements in this range yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={34} x2={W} y1={H - (t / max) * (H - 10)} y2={H - (t / max) * (H - 10)} className="um-grid" />
              <text x={30} y={H - (t / max) * (H - 10) + 4} textAnchor="end" className="um-axis">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const v = vals[i];
            const h = v === null ? 0 : Math.max(v > 0 ? 2 : 0, (v / max) * (H - 10));
            const x = 38 + i * bw;
            return (
              <g key={p.key} onMouseEnter={() => setHover(i)}>
                <rect x={x} y={0} width={bw} height={H} fill="transparent" />
                {v === null ? (
                  <text x={x + bw / 2} y={H - 4} textAnchor="middle" className="um-na">n/a</text>
                ) : (
                  <rect x={x + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} rx={Math.min(4, bw / 3)} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />
                )}
              </g>
            );
          })}
          <text x={38} y={H + 16} className="um-axis">{points[0]?.key}</text>
          <text x={W} y={H + 16} textAnchor="end" className="um-axis">{points.at(-1)?.key}</text>
          {hover !== null ? (
            <g pointerEvents="none">
              <line x1={38 + hover * bw + bw / 2} x2={38 + hover * bw + bw / 2} y1={0} y2={H} className="um-cross" />
            </g>
          ) : null}
        </svg>
      )}
      {hover !== null && points[hover] ? (
        <div className="um-tip" data-tip>
          <b>{points[hover].key}</b> {label}: {vals[hover] === null ? "not reported" : `${vals[hover]}${unit}`} · {points[hover].calls} calls · {points[hover].failed} failed
        </div>
      ) : null}
    </figure>
  );
}

function RankBars({ rows, label }: { rows: Array<{ name: string; value: number }>; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="um-chart" data-chart={label}>
      <figcaption>{label}</figcaption>
      {rows.length === 0 ? <p className="um-empty">Nothing recorded yet.</p> : null}
      <div className="um-rank">
        {rows.slice(0, 10).map((r) => (
          <div key={r.name} className="um-rank-row" title={`${r.name}: ${r.value}`}>
            <span className="um-rank-name">{r.name}</span>
            <span className="um-rank-bar">
              <i style={{ width: `${(r.value / max) * 100}%`, background: BLUE }} />
            </span>
            <span className="um-rank-val">{r.value}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function Heatmap({ hours }: { hours: Point[] }) {
  const days = [...new Set(hours.map((p) => p.key.slice(0, 10)))].slice(-14);
  const max = Math.max(1, ...hours.map((p) => p.calls));
  const at = new Map(hours.map((p) => [p.key, p]));
  const [tip, setTip] = useState<string | null>(null);
  return (
    <figure className="um-chart" data-chart="heatmap">
      <figcaption>Model calls by hour of day (UTC), last {days.length} day(s)</figcaption>
      {days.length === 0 ? <p className="um-empty">No hourly data yet.</p> : null}
      <div className="um-heat" onMouseLeave={() => setTip(null)}>
        {days.map((d) => (
          <div key={d} className="um-heat-row">
            <span>{d.slice(5)}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const p = at.get(`${d}T${String(h).padStart(2, "0")}`);
              const v = p?.calls ?? 0;
              const step = v === 0 ? -1 : Math.min(SEQ.length - 1, Math.floor((v / max) * (SEQ.length - 1)));
              return <i key={h} style={{ background: step < 0 ? "#1c2033" : SEQ[step] }} onMouseEnter={() => setTip(`${d} ${String(h).padStart(2, "0")}:00 — ${v} calls${p ? `, ${p.failed} failed` : ""}`)} />;
            })}
          </div>
        ))}
      </div>
      {tip ? <div className="um-tip">{tip}</div> : null}
    </figure>
  );
}

function Ranges({ rows, title }: { rows: Range[]; title: string }) {
  return (
    <table className="um-table um-ranges" data-ranges={title}>
      <caption>{title}</caption>
      <thead>
        <tr>
          <th>Measure</th>
          <th>Lowest</th>
          <th>Highest</th>
          <th>Average</th>
          <th>Current</th>
          <th>Peak</th>
          <th>Capacity</th>
          <th>Used</th>
          <th>Trend</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.metric} data-availability={r.availability}>
            <td>{r.metric}</td>
            {r.availability === "unavailable" ? (
              <td colSpan={8} className="um-na">not measured in this range</td>
            ) : (
              <>
                <td title={r.lowestAt ?? ""}>{fmt(r.lowest)}</td>
                <td title={r.highestAt ?? ""}>{fmt(r.highest)}</td>
                <td>{fmt(r.average)}</td>
                <td>{fmt(r.current)}</td>
                <td title={r.highestAt ?? ""}>{fmt(r.peak)}</td>
                <td>{r.capacity === null ? "no limit" : r.capacity}</td>
                <td>{r.pctUsed === null ? "—" : `${r.pctUsed}%`}</td>
                <td>{r.trend}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------------------------------------------------- conversation detail */

function Detail({ id }: { id: string }) {
  const reg = ConversationRegistry.getInstance();
  const r = reg.get(id);
  const chain = reg.chain(id);
  const policy = ResourcePolicy.getInstance();
  const dialogue = r && (r.type === "agent-direct" || r.type === "agent-group" || r.type === "self-dialogue") ? AgentDialogue.getInstance().history(id) : [];
  if (!r) return <p className="um-empty">That conversation is not in the registry.</p>;
  const control = policy.workloadState(id);
  const act = (state: "paused" | "terminated" | "throttled" | "resume") => {
    policy.control(id, state, { reason: "set in the monitor", minGapMs: 15_000 });
    reg.setStatus(id, state === "resume" ? "idle" : state === "throttled" ? r.status : state);
  };
  return (
    <section className="um-detail" data-um-detail={id}>
      <h3>
        <span style={{ color: STATUS[r.status].color }}>{STATUS[r.status].icon}</span> {r.title}
      </h3>
      <p className="um-meta">
        {r.type} · started by {r.initiator} · {r.status}
        {control ? ` · control: ${control.state}${control.minGapMs ? ` (1 call / ${control.minGapMs / 1000}s)` : ""}` : ""}
      </p>
      <div className="um-actions">
        <button type="button" data-act="pause" onClick={() => act("paused")}>Pause</button>
        <button type="button" data-act="resume" onClick={() => act("resume")}>Resume</button>
        <button type="button" data-act="throttle" onClick={() => act("throttled")}>Throttle</button>
        <button type="button" data-act="terminate" className="um-danger" onClick={() => act("terminated")}>Terminate</button>
      </div>
      <dl className="um-facts">
        <div><dt>Id</dt><dd>{r.id}</dd></div>
        <div><dt>Parent</dt><dd>{r.parentId ?? "—"}</dd></div>
        <div><dt>Participants</dt><dd>{r.participants.map(agentName).join(", ") || "—"}</dd></div>
        <div><dt>Started · last · ended</dt><dd>{when(r.startedAt)} · {when(r.lastActivityAt)} · {when(r.endedAt)}</dd></div>
        <div><dt>Messages in / out</dt><dd>{r.messagesIn} / {r.messagesOut}</dd></div>
        <div><dt>Model calls</dt><dd>{r.modelCalls} ({r.failedCalls} failed, {r.rateLimited} rate-limited, {r.retries} retries)</dd></div>
        <div><dt>Tokens</dt><dd>{r.tokenReportedCalls ? `${r.inputTokens} in · ${r.outputTokens} out · ${r.cachedInputTokens} cached · ${r.reasoningTokens} reasoning (reported by provider on ${r.tokenReportedCalls}/${r.modelCalls} calls)` : "not reported by the provider"}</dd></div>
        <div><dt>Latency</dt><dd>{r.latency.n ? `min ${r.latency.min} · avg ${Math.round(r.latency.sum / r.latency.n)} · max ${r.latency.max} ms` : "—"}</dd></div>
        <div><dt>Providers / models</dt><dd>{Object.entries(r.providers).map(([k, v]) => `${k} ×${v}`).join(", ") || "—"} · {Object.entries(r.models).map(([k, v]) => `${k} ×${v}`).join(", ") || "—"}</dd></div>
        <div><dt>Tools</dt><dd>{r.toolCalls ? Object.entries(r.tools).map(([k, v]) => `${k} ×${v}`).join(", ") : "none"}</dd></div>
        <div><dt>Linked tasks</dt><dd>{r.tasks.join(", ") || "—"}</dd></div>
        <div><dt>Errors</dt><dd>{r.errors.length ? r.errors.map((e) => `${when(e.at)}: ${e.message}`).join(" | ") : "none"}</dd></div>
      </dl>
      {dialogue.length ? (
        <>
          <h4>Transcript (read back from the agents' own task records)</h4>
          <ol className="um-transcript">
            {dialogue.map((t) => (
              <li key={t.turn} data-turn-state={t.state}>
                <b>{t.agentName}</b>
                {t.role ? ` · ${t.role}` : ""} <small>[{t.state}{t.provider ? ` · ${t.provider}/${t.model}` : ""}]</small>
                <p>{t.text ?? t.error ?? ""}</p>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <h4>Chain of activity ({chain.length})</h4>
      <ul className="um-chain">
        {chain.map((c) => (
          <li key={c.id} data-on={c.id === id ? "true" : "false"}>
            <button type="button" onClick={() => UsageView.focus(c.id)}>
              {c.parentId ? "↳ " : ""}
              {c.title} <small>({c.type}, {c.modelCalls} calls)</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------- monitor */

export default function UsageMonitor() {
  const tick = useTick();
  const view = useSyncExternalStore(UsageView.subscribe, UsageView.get);
  const [tab, setTab] = useState<"overview" | "conversations" | "analytics" | "controls">("overview");
  const [res, setRes] = useState<Resolution>("minute");
  const [span, setSpan] = useState(6);
  const [f, setF] = useState<{ type: string; status: string; agent: string; provider: string; text: string; minCalls: number; from: string }>({ type: "", status: "", agent: "", provider: "", text: "", minCalls: 0, from: "" });
  const [cmd, setCmd] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const reg = ConversationRegistry.getInstance();
  const policy = ResourcePolicy.getInstance().get();
  const ledger = UsageLedger.getInstance();
  const from = Date.now() - span * 3_600_000;
  const pts = useMemo(() => series(res, { from }), [res, span, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const hours = useMemo(() => series("hour", { from: Date.now() - 14 * 86_400_000 }), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = reg.list();
  const filtered = reg.list({
    ...(f.type ? { type: [f.type as ConversationType] } : {}),
    ...(f.status ? { status: [f.status as ConversationStatus] } : {}),
    ...(f.agent ? { participant: `agent:${f.agent}` } : {}),
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.text ? { text: f.text } : {}),
    ...(f.minCalls ? { minCalls: f.minCalls } : {}),
    ...(f.from ? { from: Date.parse(f.from) } : {}),
  });
  const providers = [...new Set(all.flatMap((r) => Object.keys(r.providers)))];
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const todayPts = series("hour", { from: today });
  const callsToday = todayPts.reduce((s, p) => s + p.calls, 0);
  const tokReported = todayPts.some((p) => p.inputTokens !== null);
  const tokensToday = todayPts.reduce((s, p) => s + (p.inputTokens ?? 0) + (p.outputTokens ?? 0), 0);
  const currentAlerts = alerts();
  const agents = AgentStore.getInstance().list();

  const runCmd = () => {
    const p = interpret(cmd, { conversationId: view.focus ?? undefined });
    setPlan(p);
    setResult(p.unsupported ? `Not changed: ${p.unsupported}` : p.report ? report(p) : null);
  };
  const applyPlan = () => {
    if (!plan) return;
    const r = apply(plan, "user");
    setResult([...r.applied.map((a) => `✓ ${a}`), ...r.failed.map((x) => `✗ ${x}`)].join("\n"));
    setPlan(null);
  };

  return (
    <div className="um" data-usage-monitor data-lelu-covers-screen="" role="region" aria-label="Usage and conversations">
      <header className="um-top">
        <strong>Usage &amp; Conversations</strong>
        <nav className="um-tabs" aria-label="Monitor sections">
          {(["overview", "conversations", "analytics", "controls"] as const).map((t) => (
            <button key={t} type="button" data-tab={t} data-on={tab === t ? "true" : "false"} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        {policy.emergencyStop ? <span className="um-stop-badge" data-emergency>■ EMERGENCY STOP</span> : null}
        <button type="button" onClick={() => download(`lelu-usage-${new Date().toISOString().slice(0, 16)}.json`, exportJson(), "application/json")} data-export="json">Export JSON</button>
        <button type="button" onClick={() => download(`lelu-conversations-${new Date().toISOString().slice(0, 16)}.csv`, exportCsv(), "text/csv")} data-export="csv">Export CSV</button>
        <button type="button" data-close-usage onClick={() => UsageView.close()} aria-label="Close the monitor">✕ Close</button>
      </header>

      <form
        className="um-cmd"
        onSubmit={(e) => {
          e.preventDefault();
          runCmd();
        }}
      >
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="Tell LÉLU, e.g. “limit each agent to two concurrent tasks” or “show the five highest-consuming conversations today”" aria-label="Resource instruction" />
        <button type="submit" data-cmd-run>Plan</button>
      </form>
      {plan && !plan.unsupported && !plan.report ? (
        <div className="um-plan" data-plan data-consequential={plan.consequential ? "true" : "false"}>
          <b>{plan.consequential ? "Needs your approval" : "Planned change"}</b>
          <ul>{plan.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
          <button type="button" data-cmd-apply onClick={applyPlan}>Apply</button>
          <button type="button" onClick={() => setPlan(null)}>Cancel</button>
        </div>
      ) : null}
      {result ? <pre className="um-result" data-cmd-result>{result}</pre> : null}

      <div className="um-body">
        <main className="um-main">
          {tab === "overview" ? (
            <>
              <div className="um-tiles">
                <div className="um-tile" data-tile="active"><span>Active conversations</span><b>{reg.activeCount()}</b><small>of {all.length} registered</small></div>
                <div className="um-tile" data-tile="calls"><span>Model calls today</span><b>{callsToday}</b><small>{todayPts.reduce((s, p) => s + p.failed, 0)} failed</small></div>
                <div className="um-tile" data-tile="tokens"><span>Tokens today</span><b>{tokReported ? tokensToday.toLocaleString() : "—"}</b><small>{tokReported ? "reported by providers" : "no provider reported tokens"}</small></div>
                <div className="um-tile" data-tile="inflight"><span>Calls in flight</span><b>{pts.at(-1)?.gauges.inFlightCalls?.last ?? 0}</b><small>{policy.maxConcurrentCalls ? `limit ${policy.maxConcurrentCalls}` : "no limit"}</small></div>
                <div className="um-tile" data-tile="background"><span>Background today</span><b>{ledger.backgroundCallsToday()}/{ledger.backgroundDailyCap()}</b><small>{ledger.backgroundPaused() ? "paused" : "running"}</small></div>
                <div className="um-tile" data-tile="alerts"><span>Alerts</span><b>{currentAlerts.length}</b><small>{currentAlerts[0]?.title ?? "none"}</small></div>
              </div>
              <div className="um-range-bar">
                {(["minute", "hour", "day", "week", "month"] as const).map((r) => (
                  <button key={r} type="button" data-res={r} data-on={res === r ? "true" : "false"} onClick={() => setRes(r)}>{r}</button>
                ))}
                <select value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label="Range">
                  <option value={1}>last hour</option>
                  <option value={6}>last 6 hours</option>
                  <option value={24}>last 24 hours</option>
                  <option value={168}>last 7 days</option>
                  <option value={720}>last 30 days</option>
                  <option value={2880}>last 120 days</option>
                </select>
              </div>
              <Columns points={pts} read={(p) => p.calls} label={`Model calls per ${res}`} />
              <Columns points={pts} read={(p) => (p.inputTokens === null ? null : p.inputTokens + (p.outputTokens ?? 0))} label={`Reported tokens per ${res}`} color="#2370cd" />
              <Columns points={pts} read={(p) => p.avgLatencyMs} label={`Average latency per ${res} (ms)`} color="#6aabf1" unit=" ms" />
              <section className="um-alerts" data-alerts={currentAlerts.length}>
                <h3>Alerts &amp; recommendations</h3>
                {currentAlerts.length === 0 ? <p className="um-empty">No alert: nothing unusual in the last hour.</p> : null}
                {currentAlerts.map((a) => (
                  <article key={a.id} data-severity={a.severity}>
                    <b>{a.severity === "critical" ? "✕" : a.severity === "warning" ? "▲" : "ℹ"} {a.title}</b> — {a.detail}
                    <p>→ {a.recommendation}</p>
                  </article>
                ))}
              </section>
            </>
          ) : null}

          {tab === "conversations" ? (
            <>
              <div className="um-filters" aria-label="Filters">
                <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Type"><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">All statuses</option>{Object.keys(STATUS).map((s) => <option key={s} value={s}>{s}</option>)}</select>
                <select value={f.agent} onChange={(e) => setF({ ...f, agent: e.target.value })} aria-label="Agent"><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} aria-label="Provider"><option value="">All providers</option>{providers.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Since" />
                <input type="number" min={0} value={f.minCalls} onChange={(e) => setF({ ...f, minCalls: Number(e.target.value) })} aria-label="Minimum model calls" title="Minimum model calls" />
                <input value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Search" aria-label="Search conversations" />
              </div>
              <table className="um-table" data-conversations={filtered.length}>
                <thead><tr><th>Status</th><th>Conversation</th><th>Type</th><th>Started by</th><th>Participants</th><th>Calls</th><th>Tokens (reported)</th><th>Tools</th><th>Last activity</th></tr></thead>
                <tbody>
                  {filtered.slice(0, 300).map((r) => (
                    <tr key={r.id} data-conv={r.id} data-type={r.type} data-on={view.focus === r.id ? "true" : "false"} onClick={() => UsageView.focus(r.id)}>
                      <td><span style={{ color: STATUS[r.status].color }}>{STATUS[r.status].icon}</span> {r.status}</td>
                      <td>{r.parentId ? "↳ " : ""}{r.title}</td>
                      <td>{r.type}</td>
                      <td>{r.initiator}</td>
                      <td>{r.participants.map(agentName).join(", ")}</td>
                      <td>{r.modelCalls}</td>
                      <td>{r.tokenReportedCalls ? r.inputTokens + r.outputTokens : "—"}</td>
                      <td>{r.toolCalls}</td>
                      <td>{when(r.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Ranges rows={conversationRanges(filtered)} title="Per-conversation range (filtered set)" />
            </>
          ) : null}

          {tab === "analytics" ? (
            <>
              <Heatmap hours={hours} />
              <div className="um-two">
                <RankBars label="Model calls per agent (range)" rows={byAgent(pts).map((r) => ({ name: agentName(r.agentId), value: r.calls }))} />
                <RankBars label="Model calls per provider:model (range)" rows={byModel(pts).map((r) => ({ name: r.model, value: r.calls }))} />
              </div>
              <RankBars label="Tool calls per tool (all conversations)" rows={Object.entries(all.reduce<Record<string, number>>((m, r) => { for (const [k, v] of Object.entries(r.tools)) m[k] = (m[k] ?? 0) + v; return m; }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)} />
              <RankBars label="Highest-consuming conversations (model calls)" rows={[...all].sort((a, b) => b.modelCalls - a.modelCalls).slice(0, 10).map((r) => ({ name: r.title.slice(0, 48), value: r.modelCalls }))} />
              <Ranges rows={systemRanges(res, { from })} title={`System ranges per ${res}, ${span >= 24 ? `${span / 24} day(s)` : `${span} h`}`} />
              <section className="um-unavailable" data-unavailable>
                <h3>Not measurable in this runtime</h3>
                <ul>{UNAVAILABLE.map((u) => <li key={u.metric}><b>{u.metric}</b>: {u.why}</li>)}</ul>
              </section>
            </>
          ) : null}

          {tab === "controls" ? (
            <section className="um-controls" data-controls>
              <div className="um-emergency">
                <button type="button" className={policy.emergencyStop ? "" : "um-danger"} data-emergency-toggle onClick={() => ResourcePolicy.getInstance().emergencyStop(!policy.emergencyStop, "set in the monitor")}>
                  {policy.emergencyStop ? "Release emergency stop" : "■ Emergency stop"}
                </button>
                <small>{policy.emergencyStop ? `On since ${when(policy.emergencyStop.at)} — every model call is refused at the gate.` : "Stops every model call (chat, agents, background) at the gate."}</small>
              </div>
              {(Object.keys(LIMITS) as NumericControl[]).map((k) => {
                const lim = LIMITS[k];
                const v = policy[k];
                return (
                  <label key={k} className="um-limit" data-limit={k} data-value={v ?? "none"}>
                    <span>{lim.label}</span>
                    <input type="checkbox" checked={v !== null} onChange={(e) => ResourcePolicy.getInstance().setLimit(k, e.target.checked ? lim.min : null)} aria-label={`${lim.label}: limit on`} />
                    <input type="range" min={lim.min} max={lim.max} step={lim.step} value={v ?? lim.min} disabled={v === null} onChange={(e) => ResourcePolicy.getInstance().setLimit(k, Number(e.target.value))} aria-label={lim.label} />
                    <input type="number" min={lim.min} max={lim.max} step={lim.step} value={v ?? ""} disabled={v === null} onChange={(e) => ResourcePolicy.getInstance().setLimit(k, Number(e.target.value))} aria-label={`${lim.label} value`} />
                    <small>{v === null ? "no limit" : `${v} ${lim.unit}`} · range {lim.min}–{lim.max}</small>
                  </label>
                );
              })}
              <label className="um-limit" data-limit="background">
                <span>Background model calls per day</span>
                <input type="number" min={0} max={10000} value={ledger.backgroundDailyCap()} onChange={(e) => ledger.setBudget("ai", BACKGROUND_BUDGET_SOURCE, { ...(ledger.budgetsSnapshot()[`ai:${BACKGROUND_BUDGET_SOURCE}`] ?? {}), dailyCalls: Math.max(0, Number(e.target.value)) })} aria-label="Background daily cap" />
                <button type="button" data-bg-pause onClick={() => (ledger.backgroundPaused() ? ledger.pauseBackground(0, "resumed by the owner") : ledger.pauseBackground(Date.now() + 86_400_000, "paused by the owner"))}>
                  {ledger.backgroundPaused() ? "Resume background" : "Pause background 24 h"}
                </button>
                <small>{ledger.backgroundCallsToday()} used today{ledger.backgroundPaused() ? ` · paused until ${when(ledger.backgroundPaused()!.until)}` : ""}</small>
              </label>
              <h3>Per agent</h3>
              <table className="um-table" data-agent-controls>
                <thead><tr><th>Agent</th><th>Running</th><th>Max tasks</th><th>Calls / hour</th><th>State</th></tr></thead>
                <tbody>
                  {agents.map((a) => {
                    const c = policy.agents[a.id] ?? {};
                    return (
                      <tr key={a.id} data-agent={a.id}>
                        <td>{a.name}</td>
                        <td>{a.tasks.filter((t) => t.status === "running").length}</td>
                        <td><input type="number" min={1} max={16} value={c.maxTasks ?? ""} placeholder="—" onChange={(e) => ResourcePolicy.getInstance().setAgent(a.id, { maxTasks: e.target.value ? Number(e.target.value) : null })} aria-label={`${a.name} max tasks`} /></td>
                        <td><input type="number" min={1} max={2000} value={c.hourlyCalls ?? ""} placeholder="—" onChange={(e) => ResourcePolicy.getInstance().setAgent(a.id, { hourlyCalls: e.target.value ? Number(e.target.value) : null })} aria-label={`${a.name} calls per hour`} /></td>
                        <td><button type="button" data-agent-pause={a.id} onClick={() => ResourcePolicy.getInstance().setAgent(a.id, { paused: !c.paused })}>{c.paused ? "❚❚ paused — resume" : "running — pause"}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <h3>Change log</h3>
              <ol className="um-log" data-change-log={policy.changes.length}>
                {[...policy.changes].reverse().slice(0, 30).map((c, i) => (
                  <li key={i}>{when(c.at)} · <b>{c.by}</b> · {c.what}: {c.before} → {c.after}</li>
                ))}
              </ol>
            </section>
          ) : null}
        </main>
        <aside className="um-side">{view.focus ? <Detail id={view.focus} /> : <p className="um-empty">Select a conversation to inspect its usage, transcript, chain of activity and controls.</p>}</aside>
      </div>
    </div>
  );
}
