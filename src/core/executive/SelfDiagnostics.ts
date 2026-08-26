/**
 * ==========================================================
 * LÉLU
 * SELF DIAGNOSTICS
 *
 * Periodic health evaluation over REAL runtime inputs. Every
 * check receives its data from live subsystems (ExecutiveRuntime
 * observations, avatar render telemetry, provider registry
 * snapshots, storage probes) — nothing here is hard-coded or
 * simulated. A check reports what the application actually is,
 * never what it should be.
 *
 * Consumers: the ExecutiveRuntime loop (detect → diagnose →
 * recover/report) and the developer diagnostics panel.
 * ==========================================================
 */

export interface DiagnosticCheck {
  /** Stable check id, e.g. "renderer.running". */
  id: string;
  /** Human-facing subsystem name. */
  subsystem: string;
  status: "ok" | "warning" | "error" | "unknown";
  /** Observed facts — must quote real measured values. */
  detail: string;
  /** When safe, what the executive should attempt next. */
  suggestedRecovery?: string;
}

export interface DiagnosticsInput {
  /** ms since the avatar reported a rendered frame (null = never). */
  msSinceLastAvatarFrame: number | null;
  /** Whether an avatar presence is currently mounted. */
  avatarMounted: boolean;
  /** Whether frames have been advancing (movement/animation). */
  avatarFramesAdvancing: boolean;
  /** ms since the last agent event reached consumers (null = none yet). */
  msSinceLastAgentEvent: number | null;
  /** Whether an agent task is believed to be running right now. */
  taskRunning: boolean;
  /** Provider registry snapshot (name/status), or null if unavailable. */
  providers: Array<{ name: string; status: string }> | null;
  /** Active provider that generated the last response, or null. */
  activeProvider: string | null;
  /** Result of a real storage write+read probe. */
  storageProbeOk: boolean | null;
  /** Open panels reported by the UI layer. */
  uiOpenPanels: string[];
}

const AVATAR_STALE_MS = 5_000;
const EVENT_STALE_MS = 45_000;

/**
 * Run every check against the given live inputs.
 * Pure: no timers, no globals — trivially testable.
 */
export function runDiagnostics(input: DiagnosticsInput): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];

  // 1. Renderer / animation liveness
  if (!input.avatarMounted) {
    checks.push({
      id: "avatar.mounted",
      subsystem: "3D Avatar",
      status: "ok",
      detail: "No 3D presence mounted (Gen V2 not open) — not an error.",
    });
  } else if (input.msSinceLastAvatarFrame === null) {
    checks.push({
      id: "renderer.frames",
      subsystem: "3D Avatar",
      status: "error",
      detail: "Presence mounted but no frame has ever been reported — renderer loop is not feeding telemetry.",
      suggestedRecovery: "Verify the WebGL canvas is rendering; report mount state.",
    });
  } else if (input.msSinceLastAvatarFrame > AVATAR_STALE_MS) {
    checks.push({
      id: "renderer.frames",
      subsystem: "3D Avatar",
      status: "error",
      detail: `No frame update for ${Math.round(input.msSinceLastAvatarFrame / 1000)}s — render loop stalled.`,
      suggestedRecovery: "Flag renderer stalled; verify on next observed frame.",
    });
  } else {
    checks.push({
      id: "renderer.frames",
      subsystem: "3D Avatar",
      status: "ok",
      detail: `Render loop alive — last frame ${Math.round(input.msSinceLastAvatarFrame)}ms ago.`,
    });
  }

  // 2. Animation actually playing vs static
  if (input.avatarMounted && input.msSinceLastAvatarFrame !== null && input.msSinceLastAvatarFrame <= AVATAR_STALE_MS) {
    checks.push({
      id: "animation.playing",
      subsystem: "Animation",
      status: input.avatarFramesAdvancing ? "ok" : "warning",
      detail: input.avatarFramesAdvancing
        ? "Transform updates advancing between frames."
        : "Frames render but transforms are static — presence is visually frozen.",
      ...(input.avatarFramesAdvancing ? {} : { suggestedRecovery: "Presence controller should re-select a mode." }),
    });
  }

  // 3. Agent event flow
  if (input.taskRunning && input.msSinceLastAgentEvent !== null && input.msSinceLastAgentEvent > EVENT_STALE_MS) {
    checks.push({
      id: "agent.events",
      subsystem: "Agent Events",
      status: "warning",
      detail: `A task is marked running but no event arrived for ${Math.round(input.msSinceLastAgentEvent / 1000)}s.`,
      suggestedRecovery: "Mark the task unverified; do not claim progress.",
    });
  } else {
    checks.push({
      id: "agent.events",
      subsystem: "Agent Events",
      status: "ok",
      detail:
        input.msSinceLastAgentEvent === null
          ? "No events yet this session (idle)."
          : `Event stream healthy — last event ${Math.round(input.msSinceLastAgentEvent / 1000)}s ago.`,
    });
  }

  // 4. Provider chain reality
  if (input.providers === null) {
    checks.push({
      id: "providers.snapshot",
      subsystem: "API Providers",
      status: "unknown",
      detail: "Provider registry not reachable from the executive loop.",
    });
  } else {
    const usable = input.providers.filter((p) => p.status === "ready" || p.status === "ok" || p.status === "available");
    const failing = input.providers.filter((p) => p.status === "failed" || p.status === "timeout");
    checks.push({
      id: "providers.snapshot",
      subsystem: "API Providers",
      status: usable.length > 0 ? "ok" : failing.length > 0 ? "warning" : "unknown",
      detail:
        usable.length > 0
          ? `${usable.length}/${input.providers.length} providers ready${input.activeProvider ? ` · last response via “${input.activeProvider}”` : ""}.`
          : failing.length > 0
            ? `No provider ready — ${failing.length} failed/timed out. Fallback/offline mode is the honest state.`
            : `${input.providers.length} providers registered, none confirmed ready yet.`,
    });
  }

  // 5. Memory persistence probe (a real write+read happened)
  if (input.storageProbeOk === null) {
    checks.push({
      id: "memory.persist",
      subsystem: "Memory",
      status: "unknown",
      detail: "Persistence probe has not run yet.",
    });
  } else if (!input.storageProbeOk) {
    checks.push({
      id: "memory.persist",
      subsystem: "Memory",
      status: "error",
      detail: "Storage write+read probe FAILED — new memories may not persist.",
      suggestedRecovery: "Warn cognition; retry probe next cycle.",
    });
  } else {
    checks.push({
      id: "memory.persist",
      subsystem: "Memory",
      status: "ok",
      detail: "Storage write+read round-trip succeeded.",
    });
  }

  // 6. UI divergence — workspace receiving what runtime emits is checked
  //    by the caller comparing events to panel opens; here we simply
  //    surface what the UI layer self-reports.
  checks.push({
    id: "ui.state",
    subsystem: "UI State",
    status: "ok",
    detail:
      input.uiOpenPanels.length > 0
        ? `Open surfaces: ${input.uiOpenPanels.join(", ")}.`
        : "No surfaces open (chat/environment only).",
  });

  return checks;
}
