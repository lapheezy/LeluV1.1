/**
 * ==========================================================
 * LÉLU — THE ACTION QUEUE (pure)
 *
 * What LÉLU is doing now, what she already did in this turn, and
 * what she has announced she is about to do — in that order,
 * as a story the user can read at a glance.
 *
 * Every node comes from a REAL AgentEventBus event:
 *
 *   tool_selected   → a queued step (the runtime announced it)
 *   tool_started    → that step is running
 *   tool_result     → completed, with its real result
 *   browser_*       → the browser step, as it is opened, moved
 *                     and read
 *   file and phase  → real file, sandbox, validation work
 *   cognition       → the question that stops the queue on
 *                     "Needs you", and the answer that resumes it
 *   task_completed  → every running step settles
 *
 * There is no timer in this file and no invented step. Nothing
 * appears in the queue because it would look good: a node exists
 * because an event said so, and its status is the event's. A
 * percentage is shown only when a `tool_progress` event carried
 * one.
 *
 * The queue is pure data with pure transitions, so the same
 * reducer feeds the chat, the gallery preview and the tests.
 * ==========================================================
 */

import type { AgentEvent, ExecutionPhase } from "../agent/AgentEvents";

/** The kind of work a step is — what icon and colour it gets. */
export type ActionKind =
  | "think"
  | "search"
  | "browse"
  | "file"
  | "code"
  | "sandbox"
  | "tool"
  | "voice"
  | "media"
  | "agent"
  | "ask"
  | "provider"
  | "result";

export type ActionStatus =
  /** Announced by the runtime, not started. */
  | "queued"
  /** Happening right now. */
  | "running"
  /** Blocked on something outside LÉLU (an approval). */
  | "waiting"
  /** Blocked on the user — this is the LÉLU Ask. */
  | "asking"
  | "paused"
  | "completed"
  | "failed"
  /** A failed step is being tried again. */
  | "retrying"
  | "cancelled";

/** The glyph each status shows in the compact row. */
export const ACTION_GLYPH: Record<ActionStatus, string> = {
  queued: "○",
  running: "●",
  waiting: "⏸",
  asking: "?",
  paused: "❙❙",
  completed: "✓",
  failed: "✕",
  retrying: "↻",
  cancelled: "⊘",
};

export interface QueueAction {
  id: string;
  kind: ActionKind;
  /** What the step is, in plain words, from the event that created it. */
  label: string;
  status: ActionStatus;
  /** The tool that produced this step, for pairing open → result. */
  tool?: string;
  /** Real detail from the event: a result excerpt, a page title, an error. */
  detail?: string;
  url?: string;
  /** How many results the step actually returned. */
  count?: number;
  /** Only ever a number an event carried — never an estimate. */
  progress?: number;
  startedAt?: number;
  finishedAt?: number;
}

export type QueueStatus =
  | "idle"
  | "running"
  | "waiting"
  | "asking"
  | "done"
  | "failed"
  | "cancelled";

export interface ActionQueue {
  conversationId: string;
  taskId: string;
  status: QueueStatus;
  actions: QueueAction[];
  /** Steps dropped from the head once the queue grew past its bound. */
  consumed: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
}

/** Enough to tell the story of a turn without holding an unbounded log. */
export const MAX_QUEUE_ACTIONS = 14;
/** How many nodes the compact row shows. */
export const QUEUE_TRAIL = 6;

const DONE: ReadonlySet<ActionStatus> = new Set<ActionStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function emptyQueue(conversationId: string, taskId: string, now = Date.now()): ActionQueue {
  return {
    conversationId,
    taskId,
    status: "running",
    actions: [],
    consumed: 0,
    startedAt: now,
    updatedAt: now,
  };
}

/** Is this queue telling the user about work in progress? */
export function isQueueLive(queue: ActionQueue): boolean {
  return queue.status === "running" || queue.status === "asking" || queue.status === "waiting";
}

/** The step the orb sits on: the one actually running, or the last one. */
export function activeAction(queue: ActionQueue): QueueAction | null {
  for (let index = queue.actions.length - 1; index >= 0; index -= 1) {
    const action = queue.actions[index];
    if (!DONE.has(action.status)) return action;
  }
  return queue.actions.at(-1) ?? null;
}

/** Which conversation's step a tool belongs to — a queue is per turn. */
function actionKindForTool(tool: string): ActionKind {
  if (/^browser/.test(tool)) return "browse";
  if (/^(research|web|search)/.test(tool)) return "search";
  if (/^(sandbox|exec|run|terminal|shell)/.test(tool)) return "sandbox";
  if (/^(github|git\.|code|edit|write|patch)/.test(tool)) return "code";
  if (/^(file|fs\.)/.test(tool)) return "file";
  if (/^(voice|speech|tts)/.test(tool)) return "voice";
  if (/^(media|image|video|audio)/.test(tool)) return "media";
  if (/^agent:/.test(tool)) return "agent";
  if (/^(ask|question)/.test(tool)) return "ask";
  return "tool";
}

/** Phases that are real steps of their own, not repeats of a tool call. */
const PHASE_LABEL: Partial<Record<ExecutionPhase, { kind: ActionKind; label: string }>> = {
  backend_task_started: { kind: "sandbox", label: "Running the work" },
  frontend_update_started: { kind: "code", label: "Updating the interface" },
  render_started: { kind: "media", label: "Rendering" },
  validation_started: { kind: "sandbox", label: "Checking the result" },
  media_generated: { kind: "media", label: "Made the media" },
};

/** Which phase closes which step. */
const PHASE_END: Partial<Record<ExecutionPhase, ExecutionPhase>> = {
  backend_task_completed: "backend_task_started",
  frontend_update_completed: "frontend_update_started",
  render_completed: "render_started",
  validation_completed: "validation_started",
};

let seq = 0;
function actionId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq.toString(36)}`;
}

function lastIndex(actions: QueueAction[], match: (action: QueueAction) => boolean): number {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    if (match(actions[index])) return index;
  }
  return -1;
}

function runningWithTool(actions: QueueAction[], tool: string): number {
  return lastIndex(actions, (action) => action.tool === tool && !DONE.has(action.status));
}

function patchAction(queue: ActionQueue, index: number, patch: Partial<QueueAction>, now: number): ActionQueue {
  if (index < 0) return queue;
  const actions = queue.actions.slice();
  actions[index] = { ...actions[index], ...patch };
  return { ...queue, actions, updatedAt: now };
}

/**
 * Thinking is over the moment there is real work to show.
 *
 * Otherwise two nodes claim to be running at once — the thought and the
 * step — and the compact row draws two orbs, which says LÉLU is in two
 * places at the same time. The thought is consumed by the work it
 * produced, exactly like the Pac-Man metaphor: the marker eats a node and
 * moves on to the next one.
 */
function closeThinking(queue: ActionQueue, now: number): ActionQueue {
  const index = lastIndex(queue.actions, (action) => action.kind === "think" && action.status === "running");
  return index >= 0 ? patchAction(queue, index, { status: "completed", finishedAt: now }, now) : queue;
}

/** Append a step, keeping the queue bounded from the head. */
function withAction(queue: ActionQueue, action: QueueAction, now: number): ActionQueue {
  // A real step ends the thinking that produced it; a thought never ends itself.
  const base = action.kind === "think" ? queue : closeThinking(queue, now);
  let actions = [...base.actions, action];
  let consumed = base.consumed;
  while (actions.length > MAX_QUEUE_ACTIONS) {
    const at = actions.findIndex((item) => DONE.has(item.status));
    // Only settled steps are dropped: a running step is never lost.
    if (at < 0) break;
    actions = [...actions.slice(0, at), ...actions.slice(at + 1)];
    consumed += 1;
  }
  return { ...base, actions, consumed, updatedAt: now };
}

function setStatus(queue: ActionQueue, status: QueueStatus, now: number): ActionQueue {
  if (queue.status === status) return queue;
  return {
    ...queue,
    status,
    updatedAt: now,
    finishedAt: status === "done" || status === "failed" || status === "cancelled" ? now : queue.finishedAt,
  };
}

/** Every still-open step settles when the turn ends. */
function settle(queue: ActionQueue, status: "completed" | "failed" | "cancelled", now: number): ActionQueue {
  const actions = queue.actions.map((action) =>
    DONE.has(action.status) ? action : { ...action, status, finishedAt: now },
  );
  return {
    ...queue,
    actions,
    status: status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "done",
    updatedAt: now,
    finishedAt: now,
  };
}

function host(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 60);
  }
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Fold one real event into the queue.
 *
 * Returns the same object when the event does not concern this queue,
 * and null when there is no queue yet and the event does not start one
 * (narration, a memory read, someone else's work).
 */
export function reduceQueue(
  queue: ActionQueue | null,
  event: AgentEvent,
  conversationId: string,
  now = Date.now(),
): ActionQueue | null {
  const start = (): ActionQueue => queue ?? emptyQueue(conversationId, event.taskId, now);
  const current = (): ActionQueue | null => queue;

  switch (event.type) {
    case "task_started":
      return withAction(start(), {
        id: actionId("think"),
        kind: "think",
        label: event.label?.trim() || "Thinking it through",
        status: "running",
        startedAt: now,
      }, now);

    case "task_planning": {
      const base = current();
      if (!base) return null;
      if (!event.plan?.trim()) return base;
      const think = lastIndex(base.actions, (action) => action.kind === "think");
      return think >= 0 ? patchAction(base, think, { detail: event.plan.trim().slice(0, 400) }, now) : base;
    }

    case "tool_selected": {
      const base = start();
      if (runningWithTool(base.actions, event.tool) >= 0) return base;
      return withAction(base, {
        id: actionId("step"),
        kind: actionKindForTool(event.tool),
        tool: event.tool,
        label: event.label?.trim() || event.tool,
        status: "queued",
      }, now);
    }

    case "tool_started": {
      const base = start();
      const queued = lastIndex(
        base.actions,
        (action) => action.tool === event.tool && !DONE.has(action.status),
      );
      if (queued >= 0) {
        return patchAction(base, queued, {
          status: "running",
          startedAt: now,
          label: event.label?.trim() || base.actions[queued].label,
        }, now);
      }
      return withAction(base, {
        id: actionId("step"),
        kind: actionKindForTool(event.tool),
        tool: event.tool,
        label: event.label?.trim() || `Running ${event.tool}`,
        status: "running",
        startedAt: now,
      }, now);
    }

    case "tool_progress": {
      const base = current();
      if (!base) return null;
      const index = runningWithTool(base.actions, event.tool);
      return patchAction(base, index, {
        // Only a number the event carried — never an estimate.
        progress: typeof event.progress === "number" && Number.isFinite(event.progress) ? event.progress : undefined,
        detail: event.note?.trim() ? event.note.trim().slice(0, 200) : base.actions[index]?.detail,
      }, now);
    }

    case "tool_result": {
      const base = current();
      if (!base) return null;
      const index = runningWithTool(base.actions, event.tool);
      const failed = event.status === "error" || event.status === "blocked";
      const detail = (event.result ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || undefined;
      const count = Array.isArray(event.results) ? event.results.length : undefined;
      if (index >= 0) {
        return patchAction(base, index, {
          status: failed ? "failed" : "completed",
          finishedAt: now,
          detail,
          count,
        }, now);
      }
      return withAction(base, {
        id: actionId("step"),
        kind: actionKindForTool(event.tool),
        tool: event.tool,
        label: event.query?.trim() ? `${event.tool}: ${event.query.trim().slice(0, 60)}` : `${event.tool} finished`,
        status: failed ? "failed" : "completed",
        detail,
        count,
        startedAt: now,
        finishedAt: now,
      }, now);
    }

    case "tool_failed": {
      const base = current();
      if (!base) return null;
      const index = runningWithTool(base.actions, event.tool);
      return patchAction(base, index >= 0 ? index : base.actions.length - 1, {
        status: "failed",
        finishedAt: now,
        detail: event.error?.slice(0, 200),
      }, now);
    }

    case "browser_opened":
    case "browser_navigation": {
      if (!isUrl(event.url)) return current();
      const base = start();
      const index = lastIndex(
        base.actions,
        (action) => action.kind === "browse" && !DONE.has(action.status),
      );
      if (index >= 0) {
        return patchAction(base, index, {
          url: event.url,
          label: `Opening ${host(event.url)}`,
          detail: undefined,
        }, now);
      }
      return withAction(base, {
        id: actionId("browse"),
        kind: "browse",
        label: `Opening ${host(event.url)}`,
        status: "running",
        url: event.url,
        startedAt: now,
      }, now);
    }

    case "browser_result": {
      if (!isUrl(event.url)) return current();
      const base = start();
      const index = lastIndex(
        base.actions,
        (action) => action.kind === "browse" && !DONE.has(action.status),
      );
      const patch: Partial<QueueAction> = {
        url: event.url,
        label:
          event.status === "read"
            ? `Read ${event.title?.trim() || host(event.url)}`
            : `Could not read ${host(event.url)}`,
        status: event.status === "read" ? "completed" : "failed",
        detail: (event.excerpt ?? event.error ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || undefined,
        finishedAt: now,
      };
      if (index >= 0) return patchAction(base, index, patch, now);
      return withAction(base, {
        id: actionId("browse"),
        kind: "browse",
        startedAt: now,
        ...patch,
        label: patch.label ?? `Read ${host(event.url)}`,
        status: patch.status ?? "completed",
      }, now);
    }

    case "file_opened":
    case "file_changed": {
      const base = start();
      return withAction(base, {
        id: actionId("file"),
        kind: event.type === "file_changed" ? "code" : "file",
        label: `${event.type === "file_changed" ? "Updated" : "Opened"} ${event.path}`,
        status: "completed",
        startedAt: now,
        finishedAt: now,
      }, now);
    }

    case "agent_started": {
      const base = start();
      return withAction(base, {
        id: actionId("agent"),
        kind: "agent",
        tool: `agent:${event.agent}`,
        label: `Asked ${event.agent}`,
        detail: event.objective.slice(0, 200),
        status: "running",
        startedAt: now,
      }, now);
    }

    case "agent_completed":
    case "agent_failed": {
      const base = current();
      if (!base) return null;
      const index = runningWithTool(base.actions, `agent:${event.agent}`);
      if (index < 0) return base;
      return patchAction(base, index, {
        status: event.type === "agent_completed" ? "completed" : "failed",
        finishedAt: now,
        detail:
          event.type === "agent_completed"
            ? event.resultPreview?.slice(0, 200) ?? base.actions[index].detail
            : event.error?.slice(0, 200),
      }, now);
    }

    case "execution_phase": {
      const phase = event.phase;
      const advance = PHASE_END[phase];
      if (advance) {
        const base = current();
        if (!base) return null;
        const index = lastIndex(base.actions, (action) => action.label === PHASE_LABEL[advance]?.label);
        return patchAction(base, index, { status: "completed", finishedAt: now }, now);
      }
      if (phase === "retry") {
        const base = current();
        if (!base) return null;
        const index = lastIndex(base.actions, (action) => action.status === "failed");
        return patchAction(base, index, { status: "retrying", finishedAt: undefined }, now);
      }
      if (phase === "provider_failed") {
        const base = start();
        return withAction(base, {
          id: actionId("provider"),
          kind: "provider",
          label: event.label?.trim() || "The model didn't answer",
          status: "failed",
          detail: event.detail?.slice(0, 200),
          startedAt: now,
          finishedAt: now,
        }, now);
      }
      const mapping = PHASE_LABEL[phase];
      if (!mapping) return current();
      const base = start();
      const existing = lastIndex(
        base.actions,
        (action) => action.label === mapping.label && !DONE.has(action.status),
      );
      if (existing >= 0) return base;
      return withAction(base, {
        id: actionId("phase"),
        kind: mapping.kind,
        label: event.label?.trim() || mapping.label,
        status: "running",
        startedAt: now,
      }, now);
    }

    case "approval_requested": {
      const base = start();
      return setStatus(
        withAction(base, {
          id: actionId("approval"),
          kind: "ask",
          label: event.title?.trim() || "Needs your approval",
          detail: event.detail?.slice(0, 200),
          status: "waiting",
          startedAt: now,
        }, now),
        "waiting",
        now,
      );
    }

    case "approval_resolved": {
      const base = current();
      if (!base) return null;
      const index = lastIndex(base.actions, (action) => action.kind === "ask" && !DONE.has(action.status));
      const next = patchAction(base, index, {
        status: event.decision === "rejected" ? "cancelled" : "completed",
        detail: event.decision,
        finishedAt: now,
      }, now);
      return setStatus(next, "running", now);
    }

    case "cognition": {
      if (event.stage === "question-asked") {
        const base = queue ?? emptyQueue(conversationId, event.taskId, now);
        const next = withAction(base, {
          id: actionId("ask"),
          kind: "ask",
          label: "Needs you",
          detail: event.detail?.slice(0, 200),
          status: "asking",
          startedAt: now,
        }, now);
        return setStatus(next, "asking", now);
      }
      if (event.stage === "question-answered") {
        const base = current();
        if (!base) return null;
        const index = lastIndex(base.actions, (action) => action.kind === "ask" && !DONE.has(action.status));
        const next = patchAction(base, index, { status: "completed", finishedAt: now }, now);
        return setStatus(next, "running", now);
      }
      return current();
    }

    case "task_completed":
      return queue ? settle(queue, "completed", now) : null;

    case "task_failed":
      return queue ? settle(queue, "failed", now) : null;

    default:
      // Narration, memory reads, spatial and visual events are not steps of
      // work: the chat's activity card already tells that part of the story.
      return current();
  }
}

export interface QueueView {
  status: QueueStatus;
  live: boolean;
  headline: string;
  active: QueueAction | null;
  activeLabel: string;
  /** The last QUEUE_TRAIL steps, oldest first. */
  trail: QueueAction[];
  completed: number;
  failed: number;
  consumed: number;
}

/** What the compact row and the gallery preview show. */
export function queueView(queue: ActionQueue): QueueView {
  const active = activeAction(queue);
  const completed = queue.actions.filter((action) => action.status === "completed").length;
  const failed = queue.actions.filter((action) => action.status === "failed").length;
  const headline =
    queue.status === "asking"
      ? "Waiting for you"
      : queue.status === "waiting"
        ? "Waiting"
        : queue.status === "running"
          ? "Working"
          : queue.status === "failed"
            ? "Failed"
            : queue.status === "cancelled"
              ? "Stopped"
              : queue.status === "done"
                ? "Done"
                : "Idle";
  return {
    status: queue.status,
    live: isQueueLive(queue),
    headline,
    active,
    activeLabel: active?.label ?? headline,
    trail: queue.actions.slice(-QUEUE_TRAIL),
    completed,
    failed,
    consumed: queue.consumed,
  };
}

/** "12s" / "1m 4s" — how long the active step has been running. */
export function elapsedLabel(step: QueueAction, now: number): string {
  if (!step.startedAt) return "";
  const end = step.finishedAt ?? now;
  const seconds = Math.max(0, Math.round((end - step.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** Human name for a kind, for the expanded list's labels. */
export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  think: "Thinking",
  search: "Search",
  browse: "Browser",
  file: "File",
  code: "Code",
  sandbox: "Run",
  tool: "Tool",
  voice: "Voice",
  media: "Media",
  agent: "Agent",
  ask: "Ask",
  provider: "Model",
  result: "Result",
};
