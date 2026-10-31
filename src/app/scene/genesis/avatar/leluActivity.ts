/**
 * ==========================================================
 * LÉLU — WHAT SHE IS DOING, FOR EVERY BODY SHE HAS
 *
 * One reading of LÉLU's real activity, shared by every presentation of
 * her: the Gen V2 3D presence and the companion overlay. It reads the
 * real agent event bus and the live Genesis dialogue state — never a
 * mood the UI decides on its own. Moved here unchanged from
 * LeluV2Presence so the lightweight companion does not have to pull in
 * three.js to know whether she is thinking.
 * ==========================================================
 */

import { useEffect, useRef, useState } from "react";
import AgentEventBus, { type AgentEvent } from "../../../../core/agent/AgentEvents";
import type { AvatarPresenceMode } from "../../../../core/creative/Procedural3DPipeline";
import { useGenesis } from "../GenesisCore";

/* ------------------------ activity → presence ------------------------- */

export type LeluActivity =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "PRESENTING"
  | "SEARCHING"
  | "BROWSING"
  | "WORKING"
  | "BUILDING"
  | "RENDERING"
  | "EXPLORING"
  | "COMPLETED"
  | "ERROR";

export const ACTIVITY_ACCENT: Record<LeluActivity, string> = {
  IDLE: "#4ade80",
  LISTENING: "#38bdf8",
  THINKING: "#a78bfa",
  SPEAKING: "#f0abfc",
  PRESENTING: "#c4b5fd",
  SEARCHING: "#22d3ee",
  BROWSING: "#7dd3fc",
  WORKING: "#fbbf24",
  BUILDING: "#fb923c",
  RENDERING: "#e879f9",
  EXPLORING: "#34d399",
  COMPLETED: "#4ade80",
  ERROR: "#f87171",
};

export function modeForActivity(activity: LeluActivity): AvatarPresenceMode {
  switch (activity) {
    case "LISTENING":
      return "listening";
    case "PRESENTING":
      return "speaking";
    case "THINKING":
    case "SEARCHING":
    case "BROWSING":
    case "WORKING":
    case "BUILDING":
    case "RENDERING":
    case "EXPLORING":
      return "thinking";
    case "SPEAKING":
      return "speaking";
    default:
      return "idle";
  }
}

export function activityFromAgentEvent(event: AgentEvent): LeluActivity | null {
  switch (event.type) {
    case "tool_started":
      if (event.tool === "creative") {
        const label = (event.label ?? "").toLowerCase();
        if (label.includes("3d") || label.includes("render")) return "RENDERING";
        if (label.includes("video")) return "EXPLORING";
        return "BUILDING";
      }
      if (event.tool === "avatar") return "PRESENTING";
      if (event.tool === "research") return "SEARCHING";
      if (event.tool === "engineering" || event.tool === "sandbox") return "WORKING";
      if (event.tool === "browser") return "BROWSING";
      return "WORKING";
    case "browser_opened":
      return "BROWSING";
    case "tool_progress":
      return "WORKING";
    case "task_completed":
      return "COMPLETED";
    case "task_failed":
      return "ERROR";
    default:
      return null;
  }
}

/** Work she is doing with a tool: shown until the tool reports back. */
const TOOL_ACTIVITIES: ReadonlySet<LeluActivity> = new Set([
  "SEARCHING", "BROWSING", "WORKING", "BUILDING", "RENDERING", "EXPLORING", "PRESENTING",
]);

/** How long tool work is believed without any further event from it. */
const TOOL_ACTIVITY_STALE_MS = 45_000;

/**
 * Which reading wins, in order:
 *   speaking (her voice is the most visible thing she does)
 *   → a completed/failed beat (a few seconds)
 *   → live tool work (searching, browsing, working…)
 *   → thinking → listening → idle.
 *
 * Tool work used to be overwritten by the next dialogue update: with the
 * chat open (dialogue "listening") or during the turn itself ("processing"),
 * a running search showed as LISTENING/THINKING — the presence contradicted
 * what she was actually doing.
 */
export function deriveActivity(input: {
  speaking: boolean;
  thinking: boolean;
  listening: boolean;
  tool: LeluActivity | null;
  beat: "COMPLETED" | "ERROR" | null;
}): LeluActivity {
  if (input.speaking) return "SPEAKING";
  if (input.beat) return input.beat;
  if (input.tool) return input.tool;
  if (input.thinking) return "THINKING";
  if (input.listening) return "LISTENING";
  return "IDLE";
}

/** Reads the REAL agent event bus and derives LÉLU's current activity. */
export function useLeluActivity(): LeluActivity {
  const genesis = useGenesis();
  const [tool, setTool] = useState<{ activity: LeluActivity; at: number; taskId: string } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const [beat, setBeat] = useState<"COMPLETED" | "ERROR" | null>(null);

  useEffect(() => {
    const unsub = AgentEventBus.getInstance().subscribe((event) => {
      const next = activityFromAgentEvent(event);
      const taskId = "taskId" in event && typeof event.taskId === "string" ? event.taskId : "";
      // Only the work being shown can end it. Background cognition finishes
      // its own tasks all the time; one of those completing must not wipe a
      // search that is still running, nor flash "completed" over it.
      const current = toolRef.current;
      const sameWork = !current || !taskId || current.taskId === taskId;
      if (next === "COMPLETED" || next === "ERROR") {
        if (!sameWork) return;
        setTool(null);
        setBeat(next);
        return;
      }
      if (next && TOOL_ACTIVITIES.has(next)) {
        // tool_progress maps to WORKING; it must not overwrite a more
        // specific reading (SEARCHING, BROWSING…) of the same tool.
        setTool((existing) =>
          event.type === "tool_progress" && existing ? { ...existing, at: Date.now() } : { activity: next, at: Date.now(), taskId },
        );
        return;
      }
      if (
        sameWork &&
        (event.type === "tool_result" ||
          event.type === "tool_failed" ||
          event.type === "agent_completed" ||
          event.type === "agent_failed")
      ) {
        setTool(null);
      }
    });
    return unsub;
  }, []);

  // A completed/error state is a beat, not a stuck state.
  useEffect(() => {
    if (!beat) return;
    const timer = setTimeout(() => setBeat(null), 4200);
    return () => clearTimeout(timer);
  }, [beat]);

  // Tool work nobody reports back on is not believed forever.
  useEffect(() => {
    if (!tool) return;
    const timer = setTimeout(() => setTool(null), Math.max(0, tool.at + TOOL_ACTIVITY_STALE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [tool]);

  const g = genesis.state;
  return deriveActivity({
    speaking: Boolean(g.speaking) || g.dialogue === "responding" || g.dialogue === "complete",
    thinking: Boolean(g.thinking) || g.dialogue === "processing",
    listening: Boolean(g.listening) || g.dialogue === "listening",
    tool: tool?.activity ?? null,
    beat,
  });
}
