/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS COGNITIVE TRACE PANEL
 *
 * Makes LÉLU's actual per-turn cognition inspectable in the UI.
 *
 * Every value rendered here is read live from the REAL runtime:
 *
 *   CognitiveTrace  → the ordered per-turn evidence chain recorded
 *                     by the real pipeline (Brain.recall,
 *                     MemoryBridge.enrich, AIRuntime.process,
 *                     ProviderResolver, MemoryBridge.learn)
 *   UIStateStore    → the live UI world model (active panel, open
 *                     panels, last action LÉLU took)
 *   AgentEventBus   → real tool/agent execution events
 *   AIService       → the real provider fallback-chain health
 *
 * There is NO mock, demo, or placeholder state in this file. When
 * nothing has happened yet it says so plainly rather than showing
 * invented activity — an empty trace is a truthful trace.
 *
 * It also adds no new state architecture: it subscribes to the
 * existing stores/bus and re-reads them.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import LeluRuntime, { type RuntimeSnapshot } from "../../../core/runtime/LeluRuntime";
import GenesisWindowFrame from "./GenesisWindowFrame";
import CognitiveTrace, {
  type CognitiveStage,
  type CognitiveTurn,
} from "../../../core/cognition/CognitiveTrace";
import UIStateStore, { type UIStateSnapshot } from "../../../core/cognition/UIStateStore";
import AgentEventBus, { type AgentEvent } from "../../../core/agent/AgentEvents";
import AIService from "../../../core/AIService";
import type { ProviderHealthReport } from "../../../core/model/ProviderHealth";

/** Stage → colour, grouped by what kind of cognitive work it is. */
const STAGE_COLOR: Record<CognitiveStage, string> = {
  INPUT: "rgba(148, 163, 184, 0.9)",
  MEMORY_RETRIEVAL: "rgba(129, 199, 255, 0.95)",
  SELF_CONTEXT: "rgba(167, 139, 250, 0.95)",
  USER_CONTEXT: "rgba(167, 139, 250, 0.8)",
  TASK_CONTEXT: "rgba(167, 139, 250, 0.66)",
  CONTEXT_INJECTION: "rgba(94, 234, 212, 0.95)",
  MODEL_ROUTE: "rgba(250, 204, 21, 0.9)",
  PROVIDER_ATTEMPT: "rgba(250, 204, 21, 0.75)",
  PROVIDER_FALLBACK: "rgba(251, 146, 60, 0.95)",
  TOOL_CALL: "rgba(244, 114, 182, 0.9)",
  RESULT: "rgba(74, 222, 128, 0.9)",
  RESPONSE: "rgba(74, 222, 128, 0.95)",
  MEMORY_WRITE: "rgba(129, 199, 255, 0.8)",
};

const SECTION: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 16,
  padding: 12,
  marginBottom: 12,
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.68,
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: "0.16em",
};

const EMPTY: React.CSSProperties = { fontSize: 12, opacity: 0.55, lineHeight: 1.5 };

function StageRow({ turn, index }: { turn: CognitiveTurn; index: number }) {
  const entry = turn.entries[index];
  const offset = entry.timestamp - turn.startedAt;
  const [open, setOpen] = useState(false);
  const hasData = Boolean(entry.data && Object.keys(entry.data).length > 0);

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        type="button"
        onClick={() => hasData && setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          color: "inherit",
          font: "inherit",
          cursor: hasData ? "pointer" : "default",
        }}
      >
        <span style={{ fontSize: 10, opacity: 0.45, minWidth: 46, fontVariantNumeric: "tabular-nums" }}>
          +{offset}ms
        </span>
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            color: STAGE_COLOR[entry.stage],
            minWidth: 132,
            flexShrink: 0,
          }}
        >
          {entry.stage}
        </span>
        <span style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.4 }}>{entry.detail}</span>
      </button>
      {open && hasData ? (
        <pre
          style={{
            margin: "4px 0 0 54px",
            padding: 8,
            fontSize: 10.5,
            lineHeight: 1.45,
            opacity: 0.75,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 8,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export default function GenesisCognitiveTracePanel({ onClose }: { onClose: () => void }) {
  const trace = CognitiveTrace.getInstance();

  // A version counter is enough to re-render: the trace is the store,
  // we just re-read it whenever it signals a change.
  const [, bump] = useState(0);
  useEffect(() => trace.subscribe(() => bump((v) => v + 1)), [trace]);

  const [ui, setUi] = useState<UIStateSnapshot>(() => UIStateStore.getInstance().get());
  useEffect(() => UIStateStore.getInstance().subscribe(setUi), []);

  const [events, setEvents] = useState<AgentEvent[]>(() => AgentEventBus.getInstance().recent(6));
  useEffect(
    () => AgentEventBus.getInstance().subscribe(() => setEvents(AgentEventBus.getInstance().recent(6))),
    [],
  );

  // The runtime's authoritative state. Subscribed, not recomputed here:
  // the panel must SHOW LÉLU's state, never invent a second version of it.
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  useEffect(() => {
    const instance = LeluRuntime.getInstance();
    void instance.getSnapshot().then(setRuntime);
    return instance.subscribe(setRuntime);
  }, []);

  const [health, setHealth] = useState<ProviderHealthReport | null>(null);
  const refreshHealth = useCallback(() => {
    // inspect() is deterministic and makes NO network calls.
    void AIService.getInstance()
      .providerHealth()
      .inspect()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  useEffect(refreshHealth, [refreshHealth]);

  // The in-flight turn if one is running, otherwise the last completed
  // one — so the panel is live during a turn and readable after it.
  const turn = trace.current() ?? trace.lastTurn();
  const history = trace.history();

  const phase = useMemo(() => {
    if (!turn) return "idle";
    if (turn.finishedAt === null) {
      return turn.entries[turn.entries.length - 1]?.stage ?? "starting";
    }
    return "complete";
  }, [turn]);

  const activeProvider = useMemo(() => {
    if (!turn) return null;
    const result = [...turn.entries].reverse().find((e) => e.stage === "RESULT" || e.stage === "RESPONSE");
    return (result?.data?.provider as string | undefined) ?? null;
  }, [turn]);

  const fallbacks = useMemo(
    () => (turn?.entries ?? []).filter((e) => e.stage === "PROVIDER_FALLBACK"),
    [turn],
  );

  return (
    <GenesisWindowFrame
      title={`Cognitive Trace · ${phase}`}
      onClose={onClose}
      width="min(94vw, 620px)"
      active={Boolean(turn && turn.finishedAt === null)}
      extraActions={
        <button
          type="button"
          onClick={() => {
            trace.clear();
            refreshHealth();
          }}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 999,
            color: "inherit",
            font: "inherit",
            fontSize: 11,
            padding: "4px 12px",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      }
    >
      {!trace.enabled ? (
        <div style={{ ...SECTION, ...EMPTY }}>
          Tracing is off in this build. It is enabled automatically in development
          builds; production turns carry no tracing overhead.
        </div>
      ) : null}

      {/* ============ RUNTIME STATE (authoritative) ============ */}
      <div style={SECTION}>
        <div style={LABEL}>Runtime</div>
        {runtime ? (
          <>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>Goal:</strong>{" "}
              {runtime.activeGoal ? runtime.activeGoal.description : "none active"}
            </div>
            {runtime.activeGoal ? (
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                <strong>Next action:</strong> {runtime.nextAction ?? "plan complete"}
                <span style={{ opacity: 0.55 }}>
                  {" "}
                  (step {runtime.activeGoal.currentStep + 1} of {runtime.activeGoal.steps.length})
                </span>
              </div>
            ) : null}
            {runtime.activeGoal?.blockedReason ? (
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "#ffb4a2" }}>
                <strong>Blocked:</strong> {runtime.activeGoal.blockedReason}
              </div>
            ) : null}
            {runtime.activeGoal && runtime.activeGoal.outcomes.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                <div style={{ ...LABEL, marginBottom: 4 }}>Verified outcomes</div>
                {runtime.activeGoal.outcomes.slice(-4).map((outcome, index) => (
                  <div
                    key={`${outcome.action}-${outcome.at}-${index}`}
                    style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.5 }}
                  >
                    {outcome.status === "verified" ? "✓" : outcome.status === "failed" ? "✗" : "–"}{" "}
                    {outcome.action}: {outcome.detail.slice(0, 90)}
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>Health:</strong> {runtime.health.overall} · cognition{" "}
              {runtime.health.cognition} · memory {runtime.health.memory} · providers{" "}
              {runtime.health.providers}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>Memories:</strong>{" "}
              {/* 0 with no measurement is "unknown", not "none" — the runtime
                  reports when it last really counted. */}
              {runtime.statsMeasuredAt === 0 ? "not measured yet" : runtime.memoryCount}
              {runtime.activeProvider ? ` · answering via ${runtime.activeProvider}` : ""}
            </div>
            {runtime.recentActivity.length > 0 ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ ...LABEL, marginBottom: 4 }}>Recent activity</div>
                {runtime.recentActivity.slice(0, 5).map((entry, index) => (
                  <div
                    key={`${entry}-${index}`}
                    style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.5 }}
                  >
                    {entry}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div style={EMPTY}>Runtime state loading…</div>
        )}
      </div>

      {/* ============ CURRENT TURN ============ */}
      <div style={SECTION}>
        <div style={LABEL}>Current turn</div>
        {turn ? (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.45, marginBottom: 4 }}>{turn.prompt}</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 10 }}>
              {turn.finishedAt
                ? `completed in ${turn.finishedAt - turn.startedAt}ms · ${turn.entries.length} stages`
                : `in flight · ${turn.entries.length} stages so far`}
              {activeProvider ? ` · answered by ${activeProvider}` : ""}
            </div>
            {turn.entries.map((_, index) => (
              <StageRow key={`${turn.taskId}-${index}`} turn={turn} index={index} />
            ))}
          </>
        ) : (
          <div style={EMPTY}>
            No turn traced yet — send LÉLU a message and the full cognition chain
            (recall → context injection → routing → provider → memory write) appears here.
          </div>
        )}
      </div>

      {/* ============ PROVIDER CHAIN ============ */}
      <div style={SECTION}>
        <div style={LABEL}>Provider fallback chain</div>
        {health ? (
          <>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
              {health.usableChain.length}/{health.chain.length} usable
              {health.primaryPath.length > 0 ? ` · primary: ${health.primaryPath.join(" → ")}` : " · no provider currently usable"}
            </div>
            {health.chain.map((entry) => (
              <div
                key={entry.name}
                style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, marginBottom: 4 }}
              >
                <span style={{ opacity: 0.45, minWidth: 18, fontSize: 10 }}>{entry.position}</span>
                <span style={{ minWidth: 128, flexShrink: 0 }}>{entry.name}</span>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    color:
                      entry.availability === "ready"
                        ? "rgba(74, 222, 128, 0.95)"
                        : entry.availability === "no_credentials"
                          ? "rgba(148, 163, 184, 0.85)"
                          : "rgba(251, 146, 60, 0.95)",
                    minWidth: 108,
                    flexShrink: 0,
                  }}
                >
                  {entry.availability}
                </span>
                <span style={{ opacity: 0.55, fontSize: 11, lineHeight: 1.35 }}>{entry.detail}</span>
              </div>
            ))}
            {fallbacks.length > 0 ? (
              <div style={{ marginTop: 8, fontSize: 11, color: "rgba(251, 146, 60, 0.95)" }}>
                {fallbacks.length} fallback transition(s) this turn:{" "}
                {fallbacks.map((f) => String(f.data?.failedProvider)).join(", ")}
              </div>
            ) : null}
          </>
        ) : (
          <div style={EMPTY}>Reading provider health…</div>
        )}
      </div>

      {/* ============ TOOL / AGENT ACTIVITY ============ */}
      <div style={SECTION}>
        <div style={LABEL}>Tool &amp; agent activity</div>
        {events.length > 0 ? (
          events.map((event, index) => (
            <div key={index} style={{ fontSize: 11.5, opacity: 0.8, marginBottom: 3 }}>
              <span style={{ color: "rgba(244, 114, 182, 0.9)" }}>{event.type}</span>
              {"tool" in event && event.tool ? <span style={{ opacity: 0.7 }}> · {event.tool}</span> : null}
              {"label" in event && event.label ? <span style={{ opacity: 0.6 }}> · {event.label}</span> : null}
            </div>
          ))
        ) : (
          <div style={EMPTY}>No tool or agent execution recorded yet.</div>
        )}
      </div>

      {/* ============ UI WORLD MODEL ============ */}
      <div style={SECTION}>
        <div style={LABEL}>UI world model</div>
        <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.6 }}>
          <div>Active panel: {ui.activeTab ?? "none"}</div>
          <div>Open panels: {ui.openPanels.length > 0 ? ui.openPanels.join(", ") : "none"}</div>
          <div>
            Last action LÉLU took:{" "}
            {ui.lastAction
              ? `${ui.lastAction.type}${ui.lastAction.target ? ` → ${ui.lastAction.target}` : ""} (${ui.lastAction.ok ? "ok" : "failed"})`
              : "none yet"}
          </div>
        </div>
      </div>

      {/* ============ RECENT TURNS ============ */}
      <div style={{ ...SECTION, marginBottom: 0 }}>
        <div style={LABEL}>Recent turns ({history.length})</div>
        {history.length > 0 ? (
          [...history]
            .reverse()
            .slice(0, 6)
            .map((past) => (
              <div key={past.taskId} style={{ fontSize: 11.5, opacity: 0.7, marginBottom: 3 }}>
                <span style={{ opacity: 0.5 }}>
                  {past.finishedAt ? `${past.finishedAt - past.startedAt}ms` : "—"}
                </span>{" "}
                · {past.entries.length} stages · {past.prompt.slice(0, 60)}
                {past.prompt.length > 60 ? "…" : ""}
              </div>
            ))
        ) : (
          <div style={EMPTY}>No completed turns yet.</div>
        )}
      </div>
    </GenesisWindowFrame>
  );
}
