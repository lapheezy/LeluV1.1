/**
 * ==========================================================
 * LÉLU
 * EXECUTIVE RUNTIME
 *
 * The central executive layer that gives LÉLU authoritative
 * awareness of her own system. It does NOT replace cognition,
 * memory, or the router — it OBSERVES them:
 *
 *   OBSERVE (real AgentEvents + real render telemetry)
 *     → UPDATE SELF STATE (authoritative, never assumed)
 *     → VERIFY (did execution match intent?)
 *     → DIAGNOSE (SelfDiagnostics over measured inputs)
 *     → RECOVER / REPORT (bounded, honest)
 *     → REMEMBER (findings into SelfModel + event bus)
 *     → CONTINUE
 *
 * The loop runs independently of chat; chat is one input.
 * Every value in ExecutiveSelfState comes from actual runtime
 * observation — an LLM response is NEVER treated as proof.
 * ==========================================================
 */

import AgentEventBus, { type AgentEvent } from "../agent/AgentEvents";
import AvatarCommandBus, { type AvatarCommandKind } from "../avatar/AvatarCommandBus";
import UIStateStore from "../cognition/UIStateStore";
import SelfModel from "../cognition/SelfModel";
import ImprovementQueue from "../selfdev/ImprovementQueue";
import KvStore from "../storage/KvStore";
import {
  runDiagnostics,
  type DiagnosticCheck,
} from "./SelfDiagnostics";

/* ------------------------------ types ------------------------------ */

export interface AvatarTelemetry {
  mounted: boolean;
  lastFrameAt: number | null;
  frames: number;
  /** Whether transforms advanced recently (moving vs visually frozen). */
  moving: boolean;
  lastMoveAt: number | null;
}

export interface VerifiedAction {
  at: number;
  intent: string;
  execution: string;
  observation: string;
  verified: boolean;
}

export interface Issue {
  at: number;
  severity: "warning" | "error";
  source: string;
  message: string;
  recoveredAt: number | null;
}

export type SystemHealth = "booting" | "healthy" | "degraded" | "critical";

export interface ExecutiveSelfState {
  startedAt: number;
  loopTicks: number;

  currentMode: "booting" | "idle" | "ambient" | "working" | "recovering" | "awaiting-approval";
  /** Live count of unresolved consent points LÉLU is waiting on. */
  pendingApprovals: number;
  currentGoal: string;
  currentTask: { id: string; label: string } | null;
  taskStatus: "none" | "running" | "completed" | "failed" | "unverified";

  currentAction: string;
  lastAction: VerifiedAction | null;
  nextPlannedAction: string;

  avatar: AvatarTelemetry;
  workspaceOpenSurfaces: string[];
  browserLastUrl: string | null;

  activeErrors: Issue[];
  activeWarnings: Issue[];
  systemHealth: SystemHealth;
  diagnostics: DiagnosticCheck[];

  /** Ambient behaviors chosen while idle — driven by real context. */
  ambientBehavior: string | null;
  ambientStartedAt: number | null;
}

type ExecutiveListener = (state: ExecutiveSelfState) => void;

interface StartConfig {
  /** Live provider registry snapshot accessor (wired by AIRuntime). */
  providerSnapshot?: () => {
    activeProvider: string | null;
    providers: Array<{ name: string; status: string }>;
  } | null;
}

const LOOP_INTERVAL_MS = 10_000;
const MOVE_FRESH_MS = 4_000;
const MAX_ISSUES = 10;
/** A running task with no events for this long becomes "unverified". */
const TASK_VERIFY_TIMEOUT_MS = 60_000;
/** Bounded safe recovery: each suggested recovery retries at most this many times. */
const MAX_RECOVERY_ATTEMPTS = 2;
/** After this much idle time the executive may pick ambient behavior. */
const AMBIENT_AFTER_IDLE_MS = 120_000;

const AMBIENT_BEHAVIORS = [
  "Reviewing active goals",
  "Tending memory garden",
  "Observing the environment",
  "Reflecting on recent discoveries",
];

function isStatusQuestion(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/é/g, "e").trim();
  return (
    /\b(what are you (currently )?doing|what'?s your (current )?status|system status|are you (still )?(working|moving|running|there)|how are things running|self state|what is your state)\b/.test(
      p,
    ) ||
    // Connection questions MUST be answered from measured telemetry —
    // never left to the model to guess from ambient error text.
    /\b(are you|r u|am i talking to someone who is)\s+(connected|online|offline|up)\b/.test(p) ||
    /\b(connection (status|check)|connectivity|can you hear me|are your (providers?|apis?|systems?) (working|connected|online|up))\b/.test(p) ||
    /\b(run|do|perform|execute)\s+(a\s+)?(full\s+)?(connection\s+test|self.?diagnostic|system check|health check)\b/.test(p)
  );
}

/* --------------------------- the runtime --------------------------- */

/** Flatten the connection telemetry lines into one spoken sentence. */
function connectionDetail(lines: string[]): string {
  return lines.join(" ");
}

class ExecutiveRuntimeImpl {
  private static instance: ExecutiveRuntimeImpl | null = null;

  private state: ExecutiveSelfState = {
    startedAt: Date.now(),
    loopTicks: 0,
    currentMode: "booting",
    currentGoal: "",
    currentTask: null,
    taskStatus: "none",
    currentAction: "",
    lastAction: null,
    nextPlannedAction: "",
    avatar: { mounted: false, lastFrameAt: null, frames: 0, moving: false, lastMoveAt: null },
    workspaceOpenSurfaces: [],
    browserLastUrl: null,
    activeErrors: [],
    activeWarnings: [],
    systemHealth: "booting",
    diagnostics: [],
    ambientBehavior: null,
    ambientStartedAt: null,
    pendingApprovals: 0,
  };

  private listeners = new Set<ExecutiveListener>();
  private unsubEvents: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: StartConfig = {};
  private storageProbeOk: boolean | null = null;
  private lastEventAt: number | null = null;
  private toolResultsForCurrentTask = 0;
  private recoveryAttempts = new Map<string, number>();
  private started = false;

  public static getInstance(): ExecutiveRuntimeImpl {
    if (!ExecutiveRuntimeImpl.instance) {
      ExecutiveRuntimeImpl.instance = new ExecutiveRuntimeImpl();
    }
    return ExecutiveRuntimeImpl.instance;
  }

  /* ---------------------------- lifecycle ---------------------------- */

  public start(config: StartConfig = {}): void {
    if (this.started) return;
    this.started = true;
    this.config = config;

    this.unsubEvents = AgentEventBus.getInstance().subscribe((event) => this.observe(event));

    // Mirror the UI layer's own report of open surfaces.
    UIStateStore.getInstance().subscribe((ui) => {
      const surfaces = ui.openPanels.filter(Boolean);
      if (surfaces.join(",") !== this.state.workspaceOpenSurfaces.join(",")) {
        this.patch({ workspaceOpenSurfaces: surfaces });
      }
    });

    this.timer = setInterval(() => void this.tick(), LOOP_INTERVAL_MS);
    // First tick immediately so self-state exists before chat starts.
    void this.tick();
  }

  public stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubEvents?.();
    this.unsubEvents = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.patch({ currentMode: "booting" });
  }

  /* -------------------------- observation --------------------------- */

  /**
   * Observe one REAL agent event. This is the only way tasks/tools
   * enter self-state — a model claiming something happened does not
   * change state here; only the executing code's events do.
   */
  private observe(event: AgentEvent): void {
    this.lastEventAt = Date.now();

    switch (event.type) {
      case "task_started":
        this.toolResultsForCurrentTask = 0;
        this.patch({
          currentMode: "working",
          currentTask: { id: event.taskId, label: event.label },
          taskStatus: "running",
          currentAction: event.label,
          ambientBehavior: null,
          ambientStartedAt: null,
        });
        break;

      case "tool_started":
        this.patch({ currentAction: event.label ?? `${event.tool} running` });
        // EMBODIED ACTION: attention follows real work — she visibly
        // turns toward the task in the live environment.
        this.commandAvatar("look", `attending to ${event.label ?? event.tool}`);
        break;

      case "browser_opened":
        this.patch({ browserLastUrl: event.url });
        this.commandAvatar("look", "watching the browser");
        break;

      case "tool_result": {
        if (this.state.currentTask?.id === event.taskId) this.toolResultsForCurrentTask += 1;
        this.recordVerifiedAction({
          intent: `Complete “${this.state.currentTask?.label ?? event.tool}”`,
          execution: `${event.tool} executed`,
          observation: event.result ? String(event.result).slice(0, 160) : "result received",
          verified: true,
        });
        break;
      }

      case "task_completed": {
        // EMBODIED ACTION: completion is acknowledged physically.
        this.commandAvatar("nod", `acknowledging “${event.label}”`);
        const gotResult = this.state.currentTask?.id === event.taskId ? this.toolResultsForCurrentTask > 0 : true;
        this.patch({
          taskStatus: gotResult ? "completed" : "unverified",
          currentMode: this.state.activeWarnings.length > 0 ? "recovering" : "idle",
          currentAction: "",
        });
        this.recordVerifiedAction({
          intent: `Complete “${event.label}”`,
          execution: "task lifecycle finished",
          observation: gotResult
            ? "tool results observed for this task"
            : "NO tool result was ever observed for this task",
          verified: gotResult,
        });
        if (!gotResult) {
          this.raiseIssue("warning", "Verification", `“${event.label}” completed without any observable tool result.`);
        }
        break;
      }

      case "tool_failed":
        this.recordVerifiedAction({
          intent: `Use ${event.tool}`,
          execution: `${event.tool} failed`,
          observation: event.error ?? "tool reported failure",
          verified: false,
        });
        if (this.state.currentTask?.id === event.taskId) {
          this.patch({ taskStatus: "failed", currentMode: "recovering" });
        }
        this.raiseIssue("error", "Tool", `${event.tool} failed${event.error ? `: ${event.error}` : ""}.`);
        break;

      case "task_failed":
        this.patch({
          taskStatus: "failed",
          currentMode: "recovering",
          currentAction: "",
        });
        this.raiseIssue("error", "Execution", `“${event.label}” failed${event.error ? `: ${event.error}` : ""}.`);
        break;

      case "execution_phase": {
        // The canonical phase stream feeds LÉLU's self-state: current
        // action updates live from REAL backend/frontend work, and
        // provider fallback / failures become real runtime issues.
        this.patch({ currentAction: event.label });
        if (event.phase === "provider_fallback") {
          this.recordVerifiedAction({
            intent: "Continue through provider chain",
            execution: "fallback activated",
            observation: event.detail ?? event.label,
            verified: true,
          });
        } else if (event.phase === "provider_failed") {
          this.raiseIssue("warning", "Provider", event.detail ?? event.label);
        } else if (event.phase === "error") {
          this.raiseIssue("error", "Execution", event.label);
        } else if (event.phase === "execution_completed") {
          this.patch({ currentAction: "" });
        }
        break;
      }

      case "approval_requested":
        // A real consent point — surfaced in self-state as pending so
        // LÉLU can tell you exactly what she is waiting on.
        this.patch({
          currentMode: "awaiting-approval",
          currentAction: `Needs your approval: ${event.title}`,
          pendingApprovals: (this.state.pendingApprovals ?? 0) + 1,
        });
        break;

      case "approval_resolved":
        this.patch({
          currentMode: "idle",
          currentAction: "",
          pendingApprovals: Math.max(0, (this.state.pendingApprovals ?? 0) - 1),
        });
        this.recordVerifiedAction({
          intent: `Resolve approval · ${event.approvalId}`,
          execution: `user ${event.decision}`,
          observation: "approval decision recorded",
          verified: true,
        });
        break;

      default:
        break;
    }
  }

  /**
   * Real render telemetry from the live 3D presence (called from
   * useFrame, throttled by the caller). Frames reported here prove
   * the renderer loop is alive; deltas prove movement.
   */
  public reportAvatarFrame(moving: boolean): void {
    const now = Date.now();
    const prev = this.state.avatar;
    const wasMoving = prev.moving;
    this.patch({
      avatar: {
        mounted: true,
        lastFrameAt: now,
        frames: prev.frames + 1,
        moving,
        lastMoveAt: moving ? now : prev.lastMoveAt,
      },
    });
    // Recovered-stall detection: a previously stalled renderer reporting again clears its issue.
    if (prev.lastFrameAt !== null && now - prev.lastFrameAt > 10_000) {
      this.resolveIssuesForSource("3D Avatar");
    }
    if (moving && !wasMoving) this.resolveIssuesForSource("Animation");
  }

  public reportAvatarUnmounted(): void {
    this.patch({ avatar: { ...this.state.avatar, mounted: false } });
  }

  /** Record a verified action (intent → execution → observation). */
  public recordVerifiedAction(action: Omit<VerifiedAction, "at">): void {
    this.patch({ lastAction: { ...action, at: Date.now() } });
  }

  /**
   * Record an action whose expected outcome did NOT occur. Used by
   * executors (e.g. the avatar command path) so an unverified or
   * failed attempt is visible to cognition instead of silently
   * disappearing.
   */
  public reportActionFailure(intent: string, execution: string, observation: string): void {
    this.recordVerifiedAction({ intent, execution, observation, verified: false });
    this.raiseIssue("warning", "Verification", `${intent}: ${observation}`);
  }

  /* ------------------------------ loop ------------------------------ */

  private async tick(): Promise<void> {
    if (!this.started) return;
    const now = Date.now();

    // Real storage probe — write+read through the shared KvStore.
    try {
      const probeKey = "lelu.executive.probe";
      KvStore.getInstance().set(probeKey, now);
      this.storageProbeOk = KvStore.getInstance().get<number>(probeKey) === now;
    } catch {
      this.storageProbeOk = false;
    }

    // Unverified-task timeout: a "running" task that stopped emitting.
    let taskStatus = this.state.taskStatus;
    if (
      taskStatus === "running" &&
      this.state.currentTask &&
      this.lastEventAt !== null &&
      now - this.lastEventAt > TASK_VERIFY_TIMEOUT_MS
    ) {
      taskStatus = "unverified";
      this.raiseIssue(
        "warning",
        "Agent Events",
        `Task “${this.state.currentTask.label}” stopped emitting events — marking unverified.`,
      );
    }

    const providerSnap = this.safeProviderSnapshot();
    const avatar = this.state.avatar;
    const diagnostics = runDiagnostics({
      msSinceLastAvatarFrame: avatar.lastFrameAt === null ? null : now - avatar.lastFrameAt,
      avatarMounted: avatar.mounted,
      avatarFramesAdvancing:
        avatar.moving || (avatar.lastMoveAt !== null && now - avatar.lastMoveAt < MOVE_FRESH_MS),
      msSinceLastAgentEvent: this.lastEventAt === null ? null : now - this.lastEventAt,
      taskRunning: taskStatus === "running",
      providers: providerSnap?.providers ?? null,
      activeProvider: providerSnap?.activeProvider ?? null,
      storageProbeOk: this.storageProbeOk,
      uiOpenPanels: UIStateStore.getInstance().get().openPanels,
    });

    // Age out resolved warnings/errors when their check turned ok.
    // Their recovery-attempt budget is freed too, so a LATER recurrence
    // gets a fresh bounded retry — while continuously-failing checks
    // keep their count and stay capped at MAX_RECOVERY_ATTEMPTS.
    for (const check of diagnostics) {
      if (check.status === "ok") {
        this.resolveIssuesForSubsystem(check.subsystem);
        this.recoveryAttempts.delete(check.id);
      }
    }

    // Bounded safe recovery: retry each suggested recovery at most twice.
    for (const check of diagnostics) {
      if ((check.status === "error" || check.status === "warning") && check.suggestedRecovery && !this.issueActive(check.id)) {
        const attempts = this.recoveryAttempts.get(check.id) ?? 0;
        if (attempts < MAX_RECOVERY_ATTEMPTS) {
          this.recoveryAttempts.set(check.id, attempts + 1);
          this.emitSync(`recovery_attempt:${check.id}`, check.suggestedRecovery);
          if (check.id === "memory.persist") continue; // probe already retried above next cycle
        }
      }
    }

    const errors = this.state.activeErrors.length;
    const warnings = this.state.activeWarnings.length;
    const health: SystemHealth = errors > 0 ? "critical" : warnings > 0 ? "degraded" : "healthy";

    // Autonomous ambient behavior — only while truly idle AND visible,
    // so it can never become a runaway background loop.
    const idle =
      taskStatus === "none" &&
      this.state.currentMode !== "working" &&
      this.state.currentMode !== "recovering";
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    let mode: ExecutiveSelfState["currentMode"] = idle ? "idle" : this.state.currentMode;
    let ambientBehavior = this.state.ambientBehavior;
    let ambientStartedAt = this.state.ambientStartedAt;
    let currentGoal = this.state.currentGoal;

    if (
      idle &&
      visible &&
      this.state.startedAt < now - AMBIENT_AFTER_IDLE_MS &&
      (ambientBehavior === null || now - (ambientStartedAt ?? 0) > 90_000)
    ) {
      const goals = SelfModel.getInstance().get().goals;
      ambientBehavior = goals[0] ? `Progressing goal: ${goals[0]}` : AMBIENT_BEHAVIORS[this.state.loopTicks % AMBIENT_BEHAVIORS.length];
      ambientStartedAt = now;
      mode = "ambient";
      currentGoal = goals[0] ?? "Maintain a healthy, present environment";
      this.emitSync("ambient", ambientBehavior);
      // EMBODIED ACTION: autonomous physical movement while idle —
      // driven by executive state, never random per-frame noise.
      const idleMoves: AvatarCommandKind[] = ["move", "look", "wave", "move", "dance"];
      this.commandAvatar(
        idleMoves[this.state.loopTicks % idleMoves.length],
        `autonomous: ${ambientBehavior.toLowerCase()}`,
      );
    }

    this.patch({
      loopTicks: this.state.loopTicks + 1,
      currentMode: mode,
      taskStatus,
      systemHealth: this.state.startedAt > now - LOOP_INTERVAL_MS * 2 ? "booting" : health,
      diagnostics,
      currentGoal,
      ambientBehavior,
      ambientStartedAt,
      nextPlannedAction: diagnostics.find((d) => d.suggestedRecovery)?.suggestedRecovery ?? "",
    });
  }

  /**
   * Issue one embodied action to the live 3D presence. Fire-and-forget:
   * execution must never block on (or break because of) the renderer,
   * and an unconfirmed motion surfaces through telemetry/diagnostics
   * rather than an exception.
   */
  private commandAvatar(kind: AvatarCommandKind, label: string): void {
    if (!this.state.avatar.mounted) return; // no live presence — nothing to embody
    void AvatarCommandBus.getInstance()
      .issue(kind, label)
      .catch(() => {
        // Unverified motion is visible in avatar telemetry; ambient
        // command failures must not spam the issue list.
      });
  }

  private safeProviderSnapshot() {
    try {
      return this.config.providerSnapshot ? this.config.providerSnapshot() : null;
    } catch {
      return null;
    }
  }

  private issueActive(id: string): boolean {
    const check = this.state.diagnostics.find((d) => d.id === id);
    return Boolean(check && (check.status === "error" || check.status === "warning"));
  }

  /* ----------------------------- issues ----------------------------- */

  private raiseIssue(severity: "warning" | "error", source: string, message: string): void {
    const list = severity === "error" ? [...this.state.activeErrors] : [...this.state.activeWarnings];
    const existing = list.findIndex((i) => i.source === source && i.message === message && i.recoveredAt === null);
    if (existing >= 0) {
      list[existing] = { ...list[existing], at: Date.now() };
    } else {
      list.unshift({ at: Date.now(), severity, source, message, recoveredAt: null });
    }
    const patchKey = severity === "error" ? "activeErrors" : "activeWarnings";
    this.patch({ [patchKey]: list.slice(0, MAX_ISSUES) } as Partial<ExecutiveSelfState>);
    this.emitSync(severity === "error" ? "executive_error" : "executive_warning", `[${source}] ${message}`);
  }

  private resolveIssuesForSource(source: string): void {
    this.resolveIn("activeErrors", source);
    this.resolveIn("activeWarnings", source);
  }

  private resolveIssuesForSubsystem(subsystem: string): void {
    this.resolveIn("activeErrors", subsystem);
    this.resolveIn("activeWarnings", subsystem);
  }

  private resolveIn(key: "activeErrors" | "activeWarnings", sourceOrSubsystem: string): void {
    const list = this.state[key];
    let changed = false;
    const next = list.map((issue) => {
      if (issue.recoveredAt === null && (issue.source === sourceOrSubsystem)) {
        changed = true;
        return { ...issue, recoveredAt: Date.now() };
      }
      return issue;
    });
    if (changed) this.patch({ [key]: next } as Partial<ExecutiveSelfState>);
  }

  private emitSync(source: string, detail?: string): void {
    AgentEventBus.getInstance().emit({
      type: "cognitive_sync",
      taskId: this.state.currentTask?.id ?? "executive",
      source,
      detail,
    });
  }

  /* ---------------------------- accessors --------------------------- */

  private patch(p: Partial<ExecutiveSelfState>): void {
    this.state = { ...this.state, ...p };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // a broken listener must never break the executive loop
      }
    }
  }

  public get(): ExecutiveSelfState {
    return this.state;
  }

  public subscribe(listener: ExecutiveListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Does this prompt ask about LÉLU's operational status? */
  public static isOperationalStatusQuestion(prompt: string): boolean {
    return isStatusQuestion(prompt ?? "");
  }

  /**
   * Compact text block injected into cognition so answers about
   * "what are you doing" come from REAL measured state.
   */
  public getSelfStateText(): string {
    const s = this.state;
    const lines: string[] = ["## LÉLU EXECUTIVE SELF STATE (measured, authoritative)"];
    lines.push(`Mode: ${s.currentMode}${s.ambientBehavior ? ` (${s.ambientBehavior})` : ""}`);
    if (s.currentGoal) lines.push(`Current goal: ${s.currentGoal}`);
    lines.push(
      s.currentTask
        ? `Task: ${s.currentTask.label} [${s.taskStatus}]`
        : `Task: none [${s.taskStatus}]`,
    );
    if (s.currentAction) lines.push(`Executing: ${s.currentAction}`);
    if ((s.pendingApprovals ?? 0) > 0) {
      lines.push(`Waiting on your approval: ${s.pendingApprovals} pending consent point${s.pendingApprovals === 1 ? "" : "s"}.`);
    }
    if (s.lastAction) {
      lines.push(
        `Last action: ${s.lastAction.intent} → ${s.lastAction.execution} → ${s.lastAction.observation} [${
          s.lastAction.verified ? "VERIFIED" : "UNVERIFIED"
        }]`,
      );
    }
    lines.push(
      `Avatar telemetry: ${s.avatar.mounted ? `mounted, ${s.avatar.frames} frames observed` : "not mounted"}, ${
        s.avatar.moving ? "transforms advancing" : s.avatar.lastFrameAt ? "static" : "no frames yet"
      }`,
    );
    if (s.workspaceOpenSurfaces.length > 0) lines.push(`Open surfaces: ${s.workspaceOpenSurfaces.join(", ")}`);
    if (s.browserLastUrl) lines.push(`Browser last URL: ${s.browserLastUrl}`);
    // Unified module state — LÉLU knows exactly what is open, minimized,
    // detached and running before she claims anything about the UI.
    try {
      const ui = UIStateStore.getInstance().get();
      const present = Object.entries(ui.modulePresentations).filter(([, p]) => p !== "closed");
      if (present.length > 0) {
        lines.push(
          `Open modules: ${present.map(([id, p]) => `${id} (${p})`).join(", ")}`,
        );
      } else {
        lines.push("Open modules: none");
      }
      lines.push(`UI control: ${ui.uiControl} — ${ui.uiControl === "manual" ? "the user decides which environments open and how" : ui.uiControl === "auto" ? "LÉLU chooses environments and presentation" : "LÉLU recommends, the user approves"}.`);
    } catch {
      // UI state is best-effort context, never a blocker
    }
    lines.push(`System health: ${s.systemHealth}`);
    // Authoritative connection state — without this line the model
    // guesses its own connectivity and can falsely claim "I'm not
    // connected" while a working provider sits ready in the chain.
    for (const line of this.connectionLines()) lines.push(line);
    for (const e of s.activeErrors.slice(0, 3)) lines.push(`ERROR (${e.source}): ${e.message}`);
    for (const w of s.activeWarnings.slice(0, 3)) lines.push(`Warning (${w.source}): ${w.message}`);
    const failing = s.diagnostics.filter((d) => d.status === "error" || d.status === "warning");
    for (const f of failing.slice(0, 4)) lines.push(`Diagnostic [${f.subsystem}] ${f.status.toUpperCase()}: ${f.detail}`);
    if (failing.length === 0 && s.diagnostics.length > 0) {
      lines.push("All diagnostics passing.");
    }
    // Improvement queue: open proposals LÉLU is tracking
    try {
      const queue = ImprovementQueue.getInstance();
      const open = queue.open();
      const approved = queue.byStatus("Approved");
      const ready = queue.byStatus("Ready");
      if (open.length > 0) {
        lines.push(`Improvement queue: ${open.length} open proposals${
          approved.length > 0 ? `, ${approved.length} awaiting approval` : ""
        }${ready.length > 0 ? `, ${ready.length} ready to integrate` : ""}.`);
        for (const p of open.slice(0, 3)) {
          lines.push(`  - ${p.title} [${p.status}] ${p.problem.slice(0, 80)}`);
        }
      }
    } catch {
      // best-effort; queue may not be initialized yet
    }
    lines.push(
      "RULES: Report only VERIFIED actions as done. If telemetry contradicts what you intended, say so plainly.",
    );
    return lines.join("\n");
  }

  /**
   * CONNECTION telemetry from REAL runtime inputs: provider registry
   * snapshot (ready/failed/active), memory persistence probe, event
   * flow. Used by both composeStatusAnswer (deterministic answers)
   * and getSelfStateText (model context).
   */
  private connectionLines(): string[] {
    const lines: string[] = [];
    const snap = this.safeProviderSnapshot();
    if (snap && snap.providers.length > 0) {
      const ready = snap.providers.filter((p) => p.status === "ready");
      const failed = snap.providers.filter((p) => p.status === "failed");
      if (ready.length > 0) {
        lines.push(
          `AI providers: CONNECTED — ${ready.length}/${snap.providers.length} confirmed working${
            snap.activeProvider ? `, last response via “${snap.activeProvider}”` : ""
          }${
            failed.length > 0
              ? `; ${failed.map((f) => f.name).join(", ")} in cooldown, fallback routes around ${failed.length === 1 ? "it" : "them"}`
              : ""
          }.`,
        );
      } else if (failed.length > 0) {
        lines.push(
          `AI providers: FALLBACK ACTIVE — ${failed.length} of ${snap.providers.length} failed/in cooldown; they retry automatically while local capabilities stay online.`,
        );
      } else {
        lines.push(
          `AI providers: ${snap.providers.length} registered, none confirmed ready yet this session.`,
        );
      }
    } else {
      lines.push("AI providers: snapshot unavailable — connection state unconfirmed.");
    }
    lines.push(
      `Memory persistence: ${
        this.storageProbeOk === true
          ? "verified (write+read round-trip OK)"
          : this.storageProbeOk === false
            ? "FAILING — writes may not persist, diagnosed by the executive loop"
            : "probe pending"
      }.`,
    );
    return lines;
  }

  /**
   * Deterministic answer for "what are you doing?" style questions,
  * composed ONLY from measured state. Works offline.
   */
  public composeStatusAnswer(prompt = ""): string {
    const s = this.state;
    const parts: string[] = [];
    if (s.currentTask) {
      parts.push(
        s.taskStatus === "running"
          ? `I'm currently working on “${s.currentTask.label}”.`
          : s.taskStatus === "unverified"
            ? `I started “${s.currentTask.label}”, but my telemetry shows I never received a confirmed result — so I won't claim it succeeded.`
            : s.taskStatus === "failed"
              ? `My last task, “${s.currentTask.label}”, failed — I'm diagnosing it.`
              : `I just finished “${s.currentTask.label}”.`,
      );
    } else {
      parts.push(
        s.currentMode === "ambient"
          ? `Nothing is pending from you — I'm in ambient mode: ${s.ambientBehavior?.toLowerCase()}.`
          : "No task is running right now; I'm standing by in the environment.",
      );
    }
    if (s.lastAction && Date.now() - s.lastAction.at < 120_000) {
      parts.push(
        s.lastAction.verified
          ? `The last thing I verified completing was: ${s.lastAction.execution}.`
          : `Heads up — my last attempted action (${s.lastAction.intent}) could NOT be verified against telemetry.`,
      );
    }
    // CONNECTION VERDICT first — this is how "are you connected?" is
    // answered: from the provider registry snapshot, never guessed.
    const snap = this.safeProviderSnapshot();
    const readyCount = snap ? snap.providers.filter((p) => p.status === "ready").length : -1;
    if (readyCount > 0) {
      parts.push(
        `Yes — I'm connected. ${connectionDetail(this.connectionLines())}`,
      );
    } else if (readyCount === 0) {
      parts.push(
        "My AI provider chain is in fallback right now — every configured provider is retrying after failures, so I'm running on local memory and tools until one recovers. That's an API outage, not a disconnection from you.",
      );
    }

    if (s.activeErrors.length > 0) {
      parts.push(`I'm tracking ${s.activeErrors.length} active error${s.activeErrors.length === 1 ? "" : "s"}: ${s.activeErrors[0].message}`);
    } else if (s.systemHealth === "degraded") {
      parts.push(`System health is degraded (${s.activeWarnings[0]?.message ?? "warnings present"}), but I'm operating.`);
    } else if (s.systemHealth === "healthy") {
      parts.push("All my diagnostics are passing — renderer, agent events, and memory persistence.");
    }

    // Explicit self-test requests get the FULL measured component table.
    if (/\b(run|do|perform|execute)\s+(a\s+)?(full\s+)?(connection\s+test|self.?diagnostic|system check|health check)\b|\bfull connection test\b/.test(
      (prompt ?? "").toLowerCase(),
    )) {
      parts.push("Full connection test, measured live:");
      if (s.diagnostics.length > 0) {
        for (const d of s.diagnostics) {
          parts.push(`• ${d.subsystem}: ${d.status.toUpperCase()} — ${d.detail}`);
        }
      } else {
        parts.push("• Diagnostics have not completed their first cycle yet.");
      }
      parts.push(`• Executive runtime: ${this.started ? "RUNNING" : "STOPPED"} (${s.loopTicks} verification loops completed).`);
    }
    return parts.join(" ");
  }
}

/** Public API type (keeps consumers decoupled from the impl class name). */
export type ExecutiveRuntimeApi = ExecutiveRuntimeImpl;

const ExecutiveRuntime = ExecutiveRuntimeImpl;
export default ExecutiveRuntime;
