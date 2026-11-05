/**
 * ==========================================================
 * LÉLU
 * AUTONOMY GATE — explicit, bounded autonomy levels
 *
 *   LEVEL 0 — Observe        inspect information only
 *   LEVEL 1 — Suggest        recommendations + plans
 *   LEVEL 2 — Sandbox        create/edit/test files in isolation
 *   LEVEL 3 — Execute        approved tasks
 *   LEVEL 4 — Project        autonomous work in authorized projects
 *   LEVEL 5 — Production     system changes, explicit authorization
 *
 * The gate never grants more than the configured level. The
 * cognitive loop runs at Observe/Suggest; the Engineering
 * workspace operates inside the sandbox (level 2); everything
 * above that stays a REVIEW item for the user.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export interface AutonomyLevel {
  level: number;
  label: string;
  description: string;
}

export const AUTONOMY_LEVELS: AutonomyLevel[] = [
  { level: 0, label: "Observe", description: "Can inspect information — no actions, no files, no changes." },
  { level: 1, label: "Suggest", description: "Can generate recommendations and plans for approval." },
  { level: 2, label: "Sandbox", description: "Can create, edit and test files inside the isolated sandbox." },
  { level: 3, label: "Execute approved", description: "Can perform tasks you have explicitly approved." },
  { level: 4, label: "Project autonomy", description: "Can continue work inside explicitly authorized project boundaries." },
  { level: 5, label: "Production", description: "System/production changes — requires explicit authorization and safety checks." },
];

const KEY = "lelu.autonomy.v1";
/**
 * L3, so the sandbox development loop can actually close.
 *
 * At L2 LÉLU could write to the sandbox and then not verify a line of
 * it: WorkspaceRuntime requires L3 for typecheck, test and build (see
 * REQUIRED_LEVEL there), so the loop ran
 * read → reason → write → ✖. Writing code you cannot compile or test is
 * not a safer autonomy level, it is a less honest one.
 *
 * L3 is NOT real-project authority, and raising this does not grant any.
 * project.apply and project.commit are gated by EngineeringAuthorization
 * — a human grant tied to a signed-in identity — which this level does
 * not touch and cannot satisfy. ToolDispatcher.toolPermitted() checks
 * both independently, and the dispatcher re-checks before writing.
 */
const DEFAULT_LEVEL = 3;

/** The server's record for the signed-in user (plugins/serverAutonomy.ts). */
export interface ServerAutonomyState {
  level: number;
  updatedAt: number;
  updatedBy: string;
  applyLevel: number;
}

type Listener = () => void;

export default class AutonomyGate {
  private static instance: AutonomyGate | null = null;
  private level: number;
  /**
   * Set once the SERVER has answered for a verified session. While set it
   * is authoritative: getLevel() returns it and local setLevel() is refused,
   * so browser state can never claim more than the server granted.
   */
  private server: ServerAutonomyState | null = null;
  private readonly listeners = new Set<Listener>();

  private constructor() {
    const stored = KvStore.getInstance().get<{ level: number }>(KEY);
    this.level = stored && Number.isInteger(stored.level) ? stored.level : DEFAULT_LEVEL;
  }

  public static getInstance(): AutonomyGate {
    if (!AutonomyGate.instance) {
      AutonomyGate.instance = new AutonomyGate();
    }
    return AutonomyGate.instance;
  }

  public getLevel(): number {
    return this.server ? this.server.level : this.level;
  }

  /** Where the level comes from: the server (signed in) or this browser. */
  public source(): "server" | "local" {
    return this.server ? "server" : "local";
  }

  public serverState(): ServerAutonomyState | null {
    return this.server;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* contained */ }
    }
  }

  /**
   * Ask the engineering runtime for the signed-in user's authoritative level.
   * `post` sends an identity-bearing request (EngineeringWorkspace.callRuntime
   * with the session token). Returns false — and keeps local mode — when
   * there is no runtime or no verified session.
   */
  public async syncFromServer(
    post: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ): Promise<boolean> {
    try {
      const data = await post({ action: "get" });
      if (data.ok === true && typeof data.level === "number") {
        this.server = {
          level: data.level,
          updatedAt: Number(data.updatedAt ?? 0),
          updatedBy: String(data.updatedBy ?? ""),
          applyLevel: Number(data.applyLevel ?? 4),
        };
        this.emit();
        return true;
      }
    } catch {
      /* no runtime / no session: local mode */
    }
    return false;
  }

  /**
   * Change the level on the SERVER. Raising needs the user's password, which
   * the server re-verifies with Supabase; the model's tools never call this
   * (tests/permission-contract.test.ts).
   */
  public async requestServerChange(
    post: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
    level: number,
    password?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const data = await post({ action: "set", level, confirm: true, ...(password ? { password } : {}) });
    if (data.ok === true && typeof data.level === "number") {
      this.server = {
        level: data.level,
        updatedAt: Number(data.updatedAt ?? Date.now()),
        updatedBy: String(data.updatedBy ?? ""),
        applyLevel: Number(data.applyLevel ?? 4),
      };
      this.emit();
      return { ok: true };
    }
    return { ok: false, error: String(data.error ?? "The server refused the change.") };
  }

  /** Change the BROWSER-LOCAL level. Refused while the server is authoritative. */
  public setLevel(level: number): void {
    if (this.server) return;
    const clamped = Math.max(0, Math.min(5, Math.round(level)));
    this.level = clamped;
    try {
      KvStore.getInstance().set(KEY, { level: clamped });
    } catch {
      // best-effort
    }
    this.emit();
  }

  /** Is the configured level sufficient for `required`? */
  public can(required: number): boolean {
    return this.getLevel() >= required;
  }

  public describe(required: number): string {
    const level = AUTONOMY_LEVELS.find((item) => item.level === required);
    return level ? `${level.label} (L${required}) — ${level.description}` : `Level ${required}`;
  }

  public levelInfo(level: number): AutonomyLevel {
    return AUTONOMY_LEVELS.find((item) => item.level === level) ?? AUTONOMY_LEVELS[0];
  }
}
