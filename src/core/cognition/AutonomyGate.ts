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
const DEFAULT_LEVEL = 2;

export default class AutonomyGate {
  private static instance: AutonomyGate | null = null;
  private level: number;

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
    return this.level;
  }

  public setLevel(level: number): void {
    const clamped = Math.max(0, Math.min(5, Math.round(level)));
    this.level = clamped;
    try {
      KvStore.getInstance().set(KEY, { level: clamped });
    } catch {
      // best-effort
    }
  }

  /** Is the configured level sufficient for `required`? */
  public can(required: number): boolean {
    return this.level >= required;
  }

  public describe(required: number): string {
    const level = AUTONOMY_LEVELS.find((item) => item.level === required);
    return level ? `${level.label} (L${required}) — ${level.description}` : `Level ${required}`;
  }

  public levelInfo(level: number): AutonomyLevel {
    return AUTONOMY_LEVELS.find((item) => item.level === level) ?? AUTONOMY_LEVELS[0];
  }
}
