/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS EXECUTION TIMELINE
 *
 * The canonical live-execution view INSIDE the chat surface.
 * Subscribes to the SAME AgentEventBus the workspace layer
 * reads — one event stream, one truth. Every row is a real
 * agent phase (command received → parse → project resolve →
 * memory read → provider connect → backend task → frontend
 * update → render → validation → complete/error), rendered
 * as "LÉLU is doing this", never as a developer console.
 *
 * Progressive disclosure:
 *   Collapsed  — "LÉLU is researching · 8 operations"
 *   Expanded   — every operation with status + side badge
 *
 * Approvals: when LÉLU reaches an operation that needs user
 * consent, an inline card appears with Approve / Reject /
 * Modify and writes the decision back through the same bus.
 *
 * Bounded: tasks and per-task events are capped; older work
 * falls off the visible log so long executions stay smooth.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AgentEventBus, {
  type AgentEvent,
  type ExecutionSide,
} from "../../../core/agent/AgentEvents";
import { genesisTheme } from "./GenesisTheme";

/* --------------------------- bounded store --------------------------- */

const MAX_TASKS = 4;
const MAX_EVENTS_PER_TASK = 24;

interface TimelineTask {
  id: string;
  label: string;
  events: AgentEvent[];
  latest: AgentEvent;
}

/* --------------------------- human labels --------------------------- */

/** Human "LÉLU is doing X" line for one event. */
export function executionEventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "execution_phase":
      return event.label;
    case "task_started":
      return event.label.slice(0, 64);
    case "task_planning":
      return "Planning the approach";
    case "tool_selected":
    case "tool_started":
      return `${humanTool(event.tool)}`;
    case "tool_progress":
      return `${humanTool(event.tool)} — ${Math.round(event.progress * 100)}%`;
    case "tool_result": {
      // The event already carries `status` and the actual `results`.
      // Ignoring both and always saying "returned a result" rendered a
      // failed, empty retrieval as a success in the activity row — the
      // UI asserting an outcome the event did not contain.
      const count = Array.isArray(event.results) ? event.results.length : 0;
      if (event.status === "error") return `${humanTool(event.tool)} failed to return a result`;
      if (event.status === "blocked") return `${humanTool(event.tool)} was blocked`;
      if (count === 0) return `${humanTool(event.tool)} returned no results`;
      return `${humanTool(event.tool)} returned ${count} result${count === 1 ? "" : "s"}`;
    }
    case "tool_failed":
      return `${humanTool(event.tool)} failed — recovering`;
    case "file_opened":
      return `Opened ${event.path}`;
    case "file_changed":
      return `Updated ${event.path}`;
    case "browser_opened":
    case "browser_navigation":
      return `Browsing ${event.url.replace(/^https?:\/\//, "").slice(0, 48)}`;
    case "memory_retrieval":
      return `Recalled ${event.count} related ${event.count === 1 ? "memory" : "memories"}`;
    case "memory_update":
      return `Saved to ${event.category} memory`;
    case "provider_selected":
      // Selection is not proof the provider completed the work — say
      // what actually happened at this point in the sequence.
      return `Routing to ${event.provider}`;
    case "provider_status":
      return `${event.provider}: ${event.status}`;
    case "diagram_created":
      return `Built diagram: ${event.label}`;
    case "visual_created":
      return `Created visual: ${event.label}`;
    case "ui_prototype_created":
      return `Built prototype: ${event.label}`;
    case "creative_artifact":
      return `Rendered: ${event.label}`;
    case "workspace_open":
      return "Opened the workspace";
    case "workspace_focus":
      return `Focusing view: ${event.view}`;
    case "task_completed":
      return event.label.slice(0, 64);
    case "task_failed":
      return `Failed: ${event.label.slice(0, 48)}`;
    case "cognitive_sync":
      return `Synced ${event.source}`;
    case "approval_requested":
      return event.title;
    case "approval_resolved":
      return `You ${event.decision} this request`;
    case "spatial_event":
      return event.label;
    case "visual_state_changed":
      // A VIEW change, not work performed. Named plainly so it can never
      // read as cognition.
      return `View switched to ${event.state}`;
    case "core_transform":
      return "Core appearance changed";
    default:
      // Never fall back to `event.type`. That printed the raw internal
      // identifier as if it were LÉLU's activity — the collapsed summary
      // rendered literally "LÉLU is visual_state_changed · 8 operations",
      // which asserts a cognitive act that never happened. An unlabelled
      // event is an unlabelled event.
      return "Internal event";
  }
}

/**
 * Does this event represent WORK LÉLU ACTUALLY DID?
 *
 * The activity line and the operation count must be built from these
 * only. Rendering state (`visual_state_changed`, `core_transform`,
 * `workspace_*`) is the UI describing itself; counting it as an
 * "operation" inflates the number and lets a view switch present itself
 * as cognition. A user reading "8 operations" should be able to point at
 * eight things LÉLU did.
 */
export function isExecutionEvent(event: AgentEvent): boolean {
  switch (event.type) {
    case "visual_state_changed":
    case "core_transform":
    case "workspace_open":
    case "workspace_focus":
    case "workspace_minimize":
    case "spatial_event":
      return false;
    default:
      return true;
  }
}

function humanTool(tool: string): string {
  return tool
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* --------------------------- side badges --------------------------- */

function eventSide(event: AgentEvent): ExecutionSide | "both" | "unknown" {
  switch (event.type) {
    case "execution_phase":
      return event.side ?? "unknown";
    case "provider_selected":
    case "provider_status":
    case "memory_retrieval":
    case "memory_update":
    case "task_planning":
    case "tool_selected":
    case "tool_started":
    case "tool_progress":
    case "tool_result":
    case "tool_failed":
    case "file_opened":
    case "file_changed":
    case "browser_opened":
    case "browser_navigation":
    case "browser_result":
    case "task_started":
    case "task_completed":
    case "task_failed":
    case "cognitive_sync":
      return "backend";
    case "diagram_created":
    case "visual_created":
    case "ui_prototype_created":
    case "creative_artifact":
    case "workspace_open":
    case "workspace_focus":
    case "workspace_minimize":
      return "frontend";
    case "spatial_event":
      return event.side ?? "unknown";
    default:
      return "unknown";
  }
}

function sideColor(side: ExecutionSide | "both" | "unknown"): string {
  switch (side) {
    case "backend":
      return "#67e8f9";
    case "frontend":
      return "#d4a94e";
    case "both":
      return "#a78bfa";
    default:
      return "rgba(148, 163, 184, 0.8)";
  }
}

function sideLabel(side: ExecutionSide | "both" | "unknown"): string {
  switch (side) {
    case "backend":
      return "BACKEND";
    case "frontend":
      return "FRONTEND";
    case "both":
      return "BOTH";
    default:
      return "";
  }
}

function eventGlyph(event: AgentEvent): string {
  switch (event.type) {
    case "execution_phase":
      switch (event.phase) {
        case "error":
          return "✕";
        case "retry":
          return "↻";
        case "render_started":
        case "render_completed":
          return "◍";
        case "provider_fallback":
          return "⌁";
        case "validation_started":
        case "validation_completed":
          return "✓";
        case "execution_completed":
          return "✓";
        default:
          return "→";
      }
    case "task_started":
      return "▶";
    case "tool_failed":
    case "task_failed":
      return "✕";
    case "tool_progress":
      return "◌";
    case "tool_result":
      return "✓";
    case "provider_selected":
      return "⌁";
    case "memory_retrieval":
      return "◐";
    case "memory_update":
      return "✎";
    case "browser_opened":
    case "browser_navigation":
    case "browser_result":
      return "◫";
    case "file_opened":
    case "file_changed":
      return "▤";
    case "creative_artifact":
    case "visual_created":
      return "◍";
    case "diagram_created":
      return "◱";
    case "approval_requested":
      return "◷";
    case "spatial_event":
      return "◈";
    default:
      return "•";
  }
}

function eventFailed(event: AgentEvent): boolean {
  return (
    event.type === "tool_failed" ||
    event.type === "task_failed" ||
    (event.type === "execution_phase" &&
      (event.phase === "error" || event.phase === "provider_failed")) ||
    (event.type === "spatial_event" && event.label.toLowerCase().includes("failed"))
  );
}

/* --------------------------- approvals --------------------------- */

interface PendingApproval {
  approvalId: string;
  taskId: string;
  title: string;
  detail: string;
  systemsAffected?: string[];
}

/* --------------------------- component --------------------------- */

export default function GenesisExecutionTimeline() {
  const [tasks, setTasks] = useState<TimelineTask[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const approvalsRef = useRef<PendingApproval[]>([]);
  approvalsRef.current = approvals;

  // Subscribe once to the CANONICAL stream — the same bus the workspace
  // layer reads. Replay the recent history on mount so execution state
  // survives a chat re-render (no lost work when a panel remounts).
  useEffect(() => {
    const bus = AgentEventBus.getInstance();
    const initial = bus.recent(40).filter((event) => event.type !== "creative_artifact");

    setTasks((current) => mergeTasks(current, initial));
    for (const event of initial) {
      if (event.type === "approval_requested") {
        setApprovals((current) => [
          ...current.filter((a) => a.approvalId !== event.approvalId),
          {
            approvalId: event.approvalId,
            taskId: event.taskId,
            title: event.title,
            detail: event.detail,
            systemsAffected: event.systemsAffected,
          },
        ]);
      }
    }

    return bus.subscribe((event) => {
      // Creative artifacts render as images in the exchange itself —
      // they do not need a row in the execution stream.
      if (event.type === "creative_artifact" || event.type === "core_transform") {
        return;
      }
      if (event.type === "approval_requested") {
        setApprovals((current) => [
          ...current.filter((a) => a.approvalId !== event.approvalId),
          {
            approvalId: event.approvalId,
            taskId: event.taskId,
            title: event.title,
            detail: event.detail,
            systemsAffected: event.systemsAffected,
          },
        ]);
      }
      if (event.type === "approval_resolved") {
        setApprovals((current) =>
          current.filter((a) => a.approvalId !== event.approvalId),
        );
        return;
      }
      setTasks((current) => mergeTasks(current, [event]));
    });
  }, []);

  const resolveApproval = useCallback(
    (approval: PendingApproval, decision: "approved" | "rejected" | "modified") => {
      AgentEventBus.getInstance().emit({
        type: "approval_resolved",
        taskId: approval.taskId,
        approvalId: approval.approvalId,
        decision,
      });
      setApprovals((current) =>
        current.filter((a) => a.approvalId !== approval.approvalId),
      );
    },
    [],
  );

  const toggle = useCallback((taskId: string) => {
    setExpanded((current) => ({ ...current, [taskId]: !current[taskId] }));
  }, []);

  const collapsedSummary = useMemo(() => {
    if (tasks.length === 0) return "";

    // Count only real work. Previously this summed EVERY event, so a
    // handful of view changes inflated the count and the line claimed
    // operations LÉLU had not performed.
    const opCount = tasks.reduce(
      (sum, task) => sum + task.events.filter(isExecutionEvent).length,
      0,
    );
    const suffix = `${opCount} ${opCount === 1 ? "operation" : "operations"}`;

    const latest = tasks[0].latest;
    if (latest.type === "task_completed") return `LÉLU finished · ${suffix}`;
    if (latest.type === "task_failed") return `LÉLU hit a problem · ${suffix}`;

    // Take the verb from the most recent REAL action. A view switch is
    // not something LÉLU is doing, and letting it supply the verb is how
    // "LÉLU is visual_state_changed" reached the screen.
    const lastRealAction = tasks[0].events.filter(isExecutionEvent).at(-1);
    if (!lastRealAction) {
      // Nothing but rendering state so far — say so rather than inventing
      // an activity for her.
      return opCount === 0 ? "LÉLU is idle" : `LÉLU is working · ${suffix}`;
    }

    const verb = executionEventLabel(lastRealAction);
    // "Routing to OpenRouter" → "LÉLU is routing to OpenRouter".
    const lowered = verb.charAt(0).toLowerCase() + verb.slice(1);
    return `LÉLU is ${lowered} · ${suffix}`;
  }, [tasks]);

  if (tasks.length === 0 && approvals.length === 0) {
    return null;
  }

  return (
    <div
      data-lelu-execution-timeline
      style={{
        flexShrink: 0,
        borderTop: "1px solid rgba(103,232,249,0.12)",
        background: "rgba(6, 14, 32, 0.72)",
        maxHeight: expanded[taskIdOrAny(tasks)] ? "42vh" : undefined,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Pending approvals — inline decision cards, always visible above
          the timeline so a consent point is never buried. */}
      {approvals.map((approval) => (
        <div
          key={approval.approvalId}
          style={{
            margin: "8px 12px 0",
            padding: "10px 12px",
            borderRadius: genesisTheme.radius.md,
            border: "1px solid rgba(212, 169, 78, 0.45)",
            background: "linear-gradient(135deg, rgba(212,169,78,0.10), rgba(8,16,38,0.6))",
            boxShadow: "0 0 24px rgba(212,169,78,0.12)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#d4a94e" }}>◷</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#fde68a" }}>
              LÉLU needs your approval
            </span>
          </div>
          <div style={{ fontSize: 13, color: "rgba(241,245,249,0.95)", marginTop: 6, fontWeight: 600 }}>
            {approval.title}
          </div>
          <div style={{ fontSize: 12, color: "rgba(226,232,240,0.72)", marginTop: 3, lineHeight: 1.5 }}>
            {approval.detail}
          </div>
          {approval.systemsAffected && approval.systemsAffected.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
              {approval.systemsAffected.map((system) => (
                <span
                  key={system}
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "rgba(212,169,78,0.9)",
                    border: "1px solid rgba(212,169,78,0.3)",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  {system}
                </span>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => resolveApproval(approval, "approved")}
              style={approvalButton("#34d399", "rgba(52,211,153,0.12)")}
            >
              ✓ Approve
            </button>
            <button
              type="button"
              onClick={() => resolveApproval(approval, "rejected")}
              style={approvalButton("#f87171", "rgba(248,113,113,0.10)")}
            >
              ✕ Reject
            </button>
            <button
              type="button"
              onClick={() => resolveApproval(approval, "modified")}
              style={approvalButton("#fbbf24", "rgba(251,191,36,0.10)")}
            >
              ✎ Modify
            </button>
          </div>
        </div>
      ))}

      {/* Collapsed header — one human line, click to expand. */}
      <button
        type="button"
        onClick={() => {
          if (tasks.length > 0) toggle(tasks[0].id);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 14px",
          border: "none",
          background: "transparent",
          color: "rgba(203, 228, 255, 0.85)",
          cursor: "pointer",
          fontSize: 11.5,
          textAlign: "left",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: "#67e8f9",
            boxShadow: "0 0 8px #67e8f9",
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {collapsedSummary}
        </span>
        <span style={{ fontSize: 10, color: "rgba(148,163,184,0.7)", flexShrink: 0 }}>
          {expanded[tasks[0].id] ? "▾ collapse" : "▸ expand"}
        </span>
      </button>

      {/* Expanded detail — every operation for the top task. */}
      {expanded[tasks[0].id] ? (
        <div
          style={{
            overflowY: "auto",
            maxHeight: "32vh",
            padding: "0 12px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(148,163,184,0.35) transparent",
          }}
        >
          {tasks.slice(0, MAX_TASKS).map((task) => (
            <div key={task.id} style={{ marginBottom: 4 }}>
              {tasks.length > 1 ? (
                <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148,163,184,0.6)", margin: "6px 2px 4px" }}>
                  {task.label.slice(0, 60)}
                </div>
              ) : null}
              {task.events.slice(0, MAX_EVENTS_PER_TASK).map((event, index) => {
                const side = eventSide(event);
                const failed = eventFailed(event);
                return (
                  <div
                    key={`${event.type}-${index}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 6px",
                      borderRadius: 8,
                      background: index % 2 === 0 ? "rgba(148,163,184,0.04)" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        textAlign: "center",
                        fontSize: 10.5,
                        color: failed ? "#f87171" : "#67e8f9",
                        flexShrink: 0,
                      }}
                    >
                      {eventGlyph(event)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11.5,
                        color: failed ? "rgba(248,113,113,0.95)" : "rgba(228,244,255,0.88)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={event.type}
                    >
                      {executionEventLabel(event)}
                    </span>
                    {side !== "unknown" ? (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 8.5,
                          letterSpacing: "0.08em",
                          color: sideColor(side),
                          border: `1px solid ${sideColor(side)}40`,
                          borderRadius: 999,
                          padding: "1px 6px",
                          opacity: 0.9,
                        }}
                      >
                        {sideLabel(side)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------- helpers --------------------------- */

function taskIdOrAny(tasks: TimelineTask[]): string {
  return tasks.length > 0 ? tasks[0].id : "";
}

function approvalButton(color: string, background: string): React.CSSProperties {
  return {
    border: `1px solid ${color}55`,
    background,
    color,
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 999,
    padding: "5px 12px",
    cursor: "pointer",
  };
}

/**
 * Merge incoming events into the bounded per-task log. Events arrive
 * newest-first from the subscription; we keep each task's own newest
 * events (they arrive in order), cap per-task depth, and cap task count.
 * The most recently active task bubbles to the front (most relevant).
 */
function mergeTasks(current: TimelineTask[], incoming: AgentEvent[]): TimelineTask[] {
  const tasks = new Map<string, TimelineTask>();
  for (const task of current) {
    tasks.set(task.id, task);
  }
  for (const event of incoming) {
    const existing = tasks.get(event.taskId);
    if (existing) {
      const events = [event, ...existing.events].slice(0, MAX_EVENTS_PER_TASK);
      tasks.set(event.taskId, { ...existing, events, latest: event });
      // Bump the just-updated task to the front.
      const bumped = tasks.get(event.taskId)!;
      tasks.delete(event.taskId);
      tasks.set(event.taskId, bumped);
    } else {
      const task: TimelineTask = {
        id: event.taskId,
        label: event.type === "task_started" ? event.label : executionEventLabel(event),
        events: [event],
        latest: event,
      };
      // New task — most recent, place at the front.
      const fresh = new Map<string, TimelineTask>([[event.taskId, task], ...tasks]);
      tasks.clear();
      for (const [id, value] of fresh) {
        tasks.set(id, value);
      }
    }
  }
  return [...tasks.values()].slice(0, MAX_TASKS);
}
