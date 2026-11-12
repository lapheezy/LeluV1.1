/**
 * ==========================================================
 * LÉLU — RUNTIME READINESS
 *
 * ONE answer to one question, for the whole application:
 *
 *     is this subsystem actually working right now?
 *
 * It exists because "loaded" and "working" were the same
 * invisible thing. The chat panel could be mounted while
 * cognition had no provider, a service could be imported while
 * its health check failed, and the only place that difference
 * lived was a console line nobody reads.
 *
 * DESIGN RULES (each one is a boundary, not a style choice):
 *
 *  1. This is a REPORTING layer. It schedules nothing, starts
 *     nothing and owns no subsystem. Bootstrap, LeluRuntime,
 *     the render manager and the services keep every decision
 *     they already make; they only say what happened here.
 *
 *  2. A claim is not a confirmation. `claim()` means "the code
 *     for this arrived"; it can never produce READY. Only
 *     `confirm()` does, and callers confirm against real state
 *     (a provider actually answered, a file was actually
 *     written). This is the difference the mission asks for
 *     between an initialised provider and a successful
 *     response.
 *
 *  3. Failures are isolated. A failing subsystem is marked
 *     FAILED; the subsystems that depend on it become DEGRADED
 *     with the reason, and everything else is untouched. No
 *     throw escapes `confirm`/`fail` — a broken subsystem must
 *     not be able to take the shell down by reporting itself.
 *
 *  4. Idempotent. Marking twice is marking once; listeners are
 *     a set; installing the bootstrap bridge twice installs it
 *     once. Concurrent callers cannot create duplicate state
 *     because there is one registry instance and one snapshot
 *     object per identity change.
 * ==========================================================
 */

export type ReadinessState =
  | "NOT_INITIALIZED"
  | "INITIALIZING"
  | "READY"
  | "DEGRADED"
  | "FAILED"
  | "SUSPENDED"
  | "RECOVERING";

export type SubsystemId =
  | "shell"
  | "cosmos"
  | "chat"
  | "cognition"
  | "memory"
  | "tools"
  | "voice"
  | "agents"
  | "workspace"
  | "network";

/**
 * What "ready" MEANS for each subsystem, in one sentence. The dashboard shows
 * these verbatim, so a reader is never asked to trust a green dot.
 */
export const READY_MEANS: Record<SubsystemId, string> = {
  shell: "The application mounted and the React root is rendering.",
  cosmos: "The visual environment is mounted and painting.",
  chat: "The composer is present and accepts input.",
  cognition: "A provider answered a real request.",
  memory: "A real read and write completed.",
  tools: "A tool was actually invoked.",
  voice: "Input and output were verified.",
  agents: "Orchestration produced a real result.",
  workspace: "A real file operation succeeded.",
  network: "A request to the model broker succeeded.",
};

/**
 * Explicit dependencies. A failure propagates DOWN this graph as DEGRADED —
 * never as FAILED, because a dependent did not itself fail, it is blocked.
 */
export const DEPENDS_ON: Record<SubsystemId, readonly SubsystemId[]> = {
  shell: [],
  cosmos: ["shell"],
  chat: ["shell"],
  network: ["shell"],
  cognition: ["network"],
  memory: ["shell"],
  tools: ["cognition"],
  agents: ["cognition"],
  voice: ["shell"],
  workspace: ["shell"],
};

export interface SubsystemReadiness {
  id: SubsystemId;
  state: ReadinessState;
  /** Human-readable evidence, or the real reason it is not ready. */
  detail: string;
  /** When the state last changed (epoch ms). */
  since: number;
  /** How long the current state has lasted, filled by the snapshot. */
  durationMs: number;
  /** Last time a caller confirmed real functionality. */
  lastVerified: number | null;
}

export interface ReadinessSnapshot {
  /** Identity-stable: a new object only when something actually changed. */
  subsystems: readonly SubsystemReadiness[];
  /** True only when every REQUIRED subsystem is READY. Optional ones don't gate. */
  operational: boolean;
  /** Epoch ms of the snapshot. */
  at: number;
}

/** Subsystems whose absence means LÉLU is not operational. */
export const REQUIRED_FOR_OPERATIONAL: readonly SubsystemId[] = [
  "shell",
  "cosmos",
  "chat",
  "cognition",
];

export type ReadinessListener = (snapshot: ReadinessSnapshot) => void;

const ALL: readonly SubsystemId[] = [
  "shell",
  "cosmos",
  "chat",
  "cognition",
  "memory",
  "tools",
  "voice",
  "agents",
  "workspace",
  "network",
];

interface MutableEntry {
  state: ReadinessState;
  detail: string;
  since: number;
  lastVerified: number | null;
}

class ReadinessRegistry {
  private entries = new Map<SubsystemId, MutableEntry>();
  private listeners = new Set<ReadinessListener>();
  private snapshot: ReadinessSnapshot;

  constructor() {
    const now = Date.now();
    for (const id of ALL) {
      this.entries.set(id, {
        state: "NOT_INITIALIZED",
        detail: "Nothing has reported yet.",
        since: now,
        lastVerified: null,
      });
    }
    this.snapshot = this.build(now);
  }

  /** Current snapshot. Identity-stable between changes. */
  get(): ReadinessSnapshot {
    return this.snapshot;
  }

  /** One subsystem, or undefined for an unknown id. */
  stateOf(id: SubsystemId): ReadinessState {
    return this.entries.get(id)?.state ?? "NOT_INITIALIZED";
  }

  /** Is this subsystem READY right now? The only safe way to gate on readiness. */
  isReady(id: SubsystemId): boolean {
    return this.stateOf(id) === "READY";
  }

  /**
   * "The code for this arrived." Never READY — an import is not functionality.
   * Used by lazy boundaries, so the dashboard can tell "not asked for yet" from
   * "asked for and still loading".
   */
  claim(id: SubsystemId, detail = "Module loaded; functionality not verified."): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    // A claim must never downgrade a confirmed subsystem.
    if (entry.state === "READY") return;
    this.set(id, "INITIALIZING", detail);
  }

  /** Start-of-work marker. Same honesty rule as claim(), different wording. */
  begin(id: SubsystemId, detail = "Initializing…"): void {
    const entry = this.entries.get(id);
    if (!entry || entry.state === "READY") return;
    this.set(id, "INITIALIZING", detail);
  }

  /**
   * Real functionality was observed. `evidence` should say WHAT was observed —
   * "provider answered in 412 ms", "wrote 1.2 KB and read it back" — because a
   * READY with no evidence is exactly the false status this exists to prevent.
   */
  confirm(id: SubsystemId, evidence: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (!evidence || !evidence.trim()) {
      // A confirmation with no evidence is not a confirmation.
      this.set(id, "DEGRADED", "Reported ready without evidence.");
      return;
    }
    entry.lastVerified = Date.now();
    this.set(id, "READY", evidence);
  }

  /** Working, but not fully. Keeps the reason visible. */
  degrade(id: SubsystemId, reason: string): void {
    this.set(id, "DEGRADED", reason || "Degraded.");
  }

  /**
   * This subsystem failed. Dependents become DEGRADED with the reason rather
   * than being marked FAILED themselves — and nothing else changes.
   */
  fail(id: SubsystemId, reason: string): void {
    this.set(id, "FAILED", reason || "Failed.");
    this.propagate(id, reason || "Failed.");
  }

  /** Deliberately not running (tab hidden, backgrounded, shut down). */
  suspend(id: SubsystemId, reason = "Suspended."): void {
    this.set(id, "SUSPENDED", reason);
  }

  /** Coming back from a failure or a suspension. */
  recover(id: SubsystemId, detail = "Recovering…"): void {
    this.set(id, "RECOVERING", detail);
  }

  subscribe(fn: ReadinessListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Reset to the pre-start state. Used when the runtime is torn down so a
   * second mount does not inherit a READY claim it never re-verified.
   */
  reset(reason = "Runtime stopped."): void {
    for (const id of ALL) {
      this.set(id, "NOT_INITIALIZED", reason);
    }
  }

  // -- internals ----------------------------------------------------------

  private set(id: SubsystemId, state: ReadinessState, detail: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.state === state && entry.detail === detail) return; // idempotent
    entry.state = state;
    entry.detail = detail;
    entry.since = Date.now();
    this.publish();
  }

  private propagate(from: SubsystemId, reason: string): void {
    for (const id of ALL) {
      if (!DEPENDS_ON[id].includes(from)) continue;
      const entry = this.entries.get(id);
      if (!entry || entry.state === "FAILED") continue;
      entry.state = "DEGRADED";
      entry.detail = `Blocked: ${from} failed (${reason}).`;
      entry.since = Date.now();
    }
    this.publish();
  }

  private build(at: number): ReadinessSnapshot {
    const subsystems = ALL.map((id) => {
      const entry = this.entries.get(id)!;
      return {
        id,
        state: entry.state,
        detail: entry.detail,
        since: entry.since,
        durationMs: at - entry.since,
        lastVerified: entry.lastVerified,
      };
    });
    return {
      subsystems,
      operational: REQUIRED_FOR_OPERATIONAL.every(
        (id) => this.entries.get(id)?.state === "READY",
      ),
      at,
    };
  }

  private publish(): void {
    const at = Date.now();
    this.snapshot = this.build(at);
    for (const fn of this.listeners) {
      try {
        fn(this.snapshot);
      } catch {
        // A broken listener must not stop the others or the subsystem that
        // reported. Reporting is the one thing that must never throw.
      }
    }
  }
}

let registry: ReadinessRegistry | null = null;

/** The one registry. Concurrent callers share it — no duplicate state. */
export function readiness(): ReadinessRegistry {
  if (!registry) registry = new ReadinessRegistry();
  return registry;
}

/**
 * Publish the snapshot on `window.__leluReadiness` so the state can be READ
 * from a real browser (support, acceptance scripts) without a build flag.
 * It exposes state names and evidence strings only — no keys, no user data.
 */
function publishToWindow(snapshot: ReadinessSnapshot): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __leluReadiness?: ReadinessSnapshot }).__leluReadiness = snapshot;
}

/** Keep the window mirror current. Idempotent per registry instance. */
let mirrorAttached = false;
export function exposeReadinessOnWindow(): void {
  if (mirrorAttached || typeof window === "undefined") return;
  mirrorAttached = true;
  const r = readiness();
  publishToWindow(r.get());
  r.subscribe(publishToWindow);
}
