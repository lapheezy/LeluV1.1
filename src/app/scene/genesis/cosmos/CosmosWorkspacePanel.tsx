/**
 * ==========================================================
 * LÉLUVERSE — COSMOS WORKSPACE PANEL
 *
 * The room you are in, the places you can go, the things
 * sitting in the room, the work that is still running, and
 * what LÉLU has done to the workspace — all from the real
 * stores, none of it invented.
 *
 * Every control here calls WorkspaceAPI, the same door LÉLU's
 * own calls use, so the GREEN / YELLOW / RED rules apply to
 * the human too. The "LÉLU asks" button is the honest picture
 * of a yellow action: it does not act, it waits.
 * ==========================================================
 */

import { useCallback, useEffect, useState } from "react";
import CosmosNavigation, { type NavigationState } from "../../../../core/cosmos/CosmosNavigation";
import SpatialObjects, { type SpatialObject } from "../../../../core/cosmos/SpatialObjects";
import TaskEngine, { type Task } from "../../../../core/tasks/TaskEngine";
import WorkspaceAPI, { type WorkspaceJournalEntry, type WorkspaceResult } from "../../../../core/workspace/WorkspaceAPI";
import WorkspaceEngine from "../../../../core/workspace/WorkspaceEngine";
import { classifyCosmosAction } from "../../../../core/cosmos/CosmosAutonomy";

const BOUNDARY_COLOR: Record<string, string> = {
  green: "#34d399",
  yellow: "#fbbf24",
  red: "#f87171",
};

const ease = { border: "1px solid rgba(148,163,184,0.18)", borderRadius: 8 } as const;

function pill(color: string): React.CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: color,
    boxShadow: `0 0 6px ${color}`,
    flexShrink: 0,
  };
}

export default function CosmosWorkspacePanel({ onClose }: { onClose: () => void }) {
  const nav = CosmosNavigation.getInstance();
  const objects = SpatialObjects.getInstance();
  const api = WorkspaceAPI.getInstance();
  const engine = WorkspaceEngine.getInstance();

  const [state, setState] = useState<NavigationState>(() => nav.getState());
  const [, setPlaced] = useState<SpatialObject[]>(() => objects.list());
  const [tasks, setTasks] = useState<Task[]>(() => TaskEngine.getInstance().list());
  const [journal, setJournal] = useState<WorkspaceJournalEntry[]>(() => api.journalEntries());
  const [roomLabel, setRoomLabel] = useState("");
  const [notice, setNotice] = useState<string>("");

  useEffect(() => {
    const unsubNav = nav.subscribe(setState);
    const unsubObjects = objects.subscribe(setPlaced);
    const unsubTasks = TaskEngine.getInstance().subscribe(setTasks);
    const unsubJournal = api.onApplied((entry) => setJournal((current) => [...current, entry].slice(-20)));
    return () => {
      unsubNav();
      unsubObjects();
      unsubTasks();
      unsubJournal();
    };
  }, [nav, objects, api]);

  const act = useCallback((result: WorkspaceResult) => {
    setNotice(
      result.requiresApproval
        ? `⏳ ${result.message}${result.approvalId ? ` · ${result.approvalId.slice(0, 14)}…` : ""}`
        : `${result.ok ? "✓" : "✕"} ${result.message}`,
    );
    setJournal(api.journalEntries());
    setState(nav.getState());
    setPlaced(objects.list());
  }, [api, nav, objects]);

  const path = nav.pathTo(state.currentId);
  const rooms = state.nodes.filter((node) => node.level === "room");
  const openTasks = tasks.filter((task) => task.status === "running" || task.status === "paused" || task.status === "waiting");
  const here = objects.inRoom(state.currentId);

  return (
    <div
      data-lelu-cosmos-workspace="ready"
      style={{
        position: "fixed",
        right: 16,
        bottom: 96,
        width: "min(392px, calc(100vw - 24px))",
        maxHeight: "min(64vh, 520px)",
        display: "flex",
        flexDirection: "column",
        background: "rgba(6,14,32,0.94)",
        border: "1px solid rgba(125,211,252,0.24)",
        borderRadius: 14,
        boxShadow: "0 18px 60px rgba(2,6,23,0.6)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        color: "#dbeafe",
        fontFamily: "system-ui, sans-serif",
        zIndex: 34,
        pointerEvents: "auto",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid rgba(148,163,184,0.14)" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>✦ Workspace</span>
        <span style={{ flex: 1, fontSize: 9, opacity: 0.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path.map((node) => node.label).join(" › ")}
        </span>
        <button type="button" title="Close" aria-label="Close workspace panel" onClick={onClose} style={{ ...ease, background: "rgba(255,255,255,0.05)", color: "#cbd5e1", cursor: "pointer", width: 24, height: 22, fontSize: 11 }}>
          ✕
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Rooms */}
        <section>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, marginBottom: 5 }}>Rooms</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {path.slice(-3).map((node) => (
              <button
                key={`bread-${node.id}`}
                type="button"
                onClick={() => act(api.execute({ action: "navigate", actor: "user", roomId: node.id }))}
                style={{ ...ease, background: "rgba(103,232,249,0.10)", color: "#a5f3fc", cursor: "pointer", padding: "3px 8px", fontSize: 10 }}
              >
                {node.label}
              </button>
            ))}
            {rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                data-lelu-room={room.id}
                title={`${room.visits} visit${room.visits === 1 ? "" : "s"} · ${room.origin}`}
                onClick={() => act(api.execute({ action: "navigate", actor: "user", roomId: room.id }))}
                style={{
                  ...ease,
                  background: state.currentId === room.id ? "rgba(52,211,153,0.16)" : "rgba(255,255,255,0.04)",
                  color: state.currentId === room.id ? "#a7f3d0" : "#cbd5e1",
                  cursor: "pointer",
                  padding: "3px 8px",
                  fontSize: 10,
                }}
              >
                ⬡ {room.label}
              </button>
            ))}
            {rooms.length === 0 ? <span style={{ fontSize: 10, opacity: 0.45 }}>No rooms yet — the core is where you are.</span> : null}
          </div>

          <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
            <input
              value={roomLabel}
              onChange={(event) => setRoomLabel(event.target.value)}
              placeholder="a new room"
              aria-label="New room name"
              style={{ flex: 1, minWidth: 0, ...ease, background: "rgba(2,6,23,0.6)", color: "#e2e8f0", padding: "4px 8px", fontSize: 10, fontFamily: "inherit" }}
            />
            <button
              type="button"
              data-lelu-create-room
              onClick={() => {
                const result = api.execute({ action: "create-room", actor: "user", room: { label: roomLabel } });
                act(result);
                if (result.ok) setRoomLabel("");
              }}
              style={{ ...ease, background: "rgba(52,211,153,0.14)", color: "#a7f3d0", cursor: "pointer", padding: "4px 8px", fontSize: 10 }}
            >
              + Room
            </button>
            <button
              type="button"
              data-lelu-lelu-room
              title="Ask as LÉLU: a yellow action waits for your approval"
              onClick={() => act(api.execute({ action: "create-room", actor: "lelu", room: { label: roomLabel || "LÉLU's observatory" } }))}
              style={{ ...ease, background: "rgba(251,191,36,0.12)", color: "#fde68a", cursor: "pointer", padding: "4px 8px", fontSize: 10 }}
            >
              LÉLU asks
            </button>
          </div>
        </section>

        {/* Windows */}
        <section>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, marginBottom: 5 }}>Windows</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {(["auto", "grid", "split", "stack"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-lelu-layout={mode}
                onClick={() => act(api.execute({ action: "arrange-windows", actor: "user", layout: mode }))}
                style={{
                  ...ease,
                  background: engine.getState().layout === mode ? "rgba(129,140,248,0.2)" : "rgba(255,255,255,0.04)",
                  color: "#c7d2fe",
                  cursor: "pointer",
                  padding: "3px 8px",
                  fontSize: 10,
                }}
              >
                {mode}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setNotice(`✓ ${api.restore().message}`)}
              style={{ ...ease, background: "rgba(103,232,249,0.1)", color: "#a5f3fc", cursor: "pointer", padding: "3px 8px", fontSize: 10 }}
            >
              restore
            </button>
          </div>
        </section>

        {/* Objects in this room */}
        <section>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, marginBottom: 5 }}>
            In this room · {here.length}
          </div>
          {here.length === 0 ? (
            <span style={{ fontSize: 10, opacity: 0.45 }}>Nothing placed here. Objects appear when a real record is dropped in.</span>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {here.map((object) => (
                <li key={object.id} data-lelu-spatial-object={object.link.kind} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
                  <span style={pill("#67e8f9")} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {object.title}
                  </span>
                  <span style={{ opacity: 0.45, fontSize: 9 }}>{object.link.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Background tasks */}
        <section>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, marginBottom: 5 }}>
            Running · {openTasks.length}
          </div>
          {openTasks.length === 0 ? (
            <span style={{ fontSize: 10, opacity: 0.45 }}>No background task is running.</span>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
              {openTasks.slice(0, 4).map((task) => (
                <li key={task.id} data-lelu-task={task.status} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
                  <span style={pill(BOUNDARY_COLOR[task.status === "failed" ? "red" : "yellow"])} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.goal}</span>
                  <span style={{ opacity: 0.5, fontSize: 9 }}>{task.status}</span>
                  <button
                    type="button"
                    onClick={() =>
                      act(api.execute({ action: task.status === "paused" ? "resume-task" : "pause-task", actor: "user", taskId: task.id }))
                    }
                    style={{ ...ease, background: "rgba(255,255,255,0.05)", color: "#cbd5e1", cursor: "pointer", padding: "2px 6px", fontSize: 9 }}
                  >
                    {task.status === "paused" ? "▶" : "❚❚"}
                  </button>
                  <button
                    type="button"
                    onClick={() => act(api.execute({ action: "cancel-task", actor: "user", taskId: task.id }))}
                    style={{ ...ease, background: "rgba(248,113,113,0.12)", color: "#fca5a5", cursor: "pointer", padding: "2px 6px", fontSize: 9 }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {openTasks.length === 0 ? null : <span style={{ fontSize: 9, opacity: 0.4 }}>Progress comes from TaskEngine's own records.</span>}
        </section>

        {/* Activity */}
        <section>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, marginBottom: 5 }}>Activity</div>
          {journal.length === 0 ? (
            <span style={{ fontSize: 10, opacity: 0.45 }}>Nothing yet.</span>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              {journal.slice(-6).reverse().map((entry) => (
                <li key={entry.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, opacity: entry.ok ? 0.85 : 0.6 }}>
                  <span style={pill(BOUNDARY_COLOR[entry.boundary])} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.message}</span>
                  <span style={{ opacity: 0.4 }}>{entry.actor}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div style={{ borderTop: "1px solid rgba(148,163,184,0.14)", padding: "6px 12px", display: "flex", gap: 10, alignItems: "center", fontSize: 8.5 }}>
        {(["green", "yellow", "red"] as const).map((boundary) => (
          <span key={boundary} style={{ display: "inline-flex", alignItems: "center", gap: 4, opacity: 0.8 }} title={classifyCosmosAction("navigate", "lelu").reason}>
            <span style={pill(BOUNDARY_COLOR[boundary])} />
            {boundary}
          </span>
        ))}
        <span data-lelu-workspace-notice style={{ flex: 1, textAlign: "right", opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {notice}
        </span>
      </div>
    </div>
  );
}
