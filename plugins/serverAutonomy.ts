/**
 * ==========================================================
 * LÉLU — SERVER-AUTHORITATIVE AUTONOMY
 *
 * The autonomy level used to live only in the browser
 * (AutonomyGate → localStorage), so the server that changes the
 * real project never knew it: a page could claim any level.
 *
 * Here the level is stored by the SERVER, per verified Supabase
 * user id, so it is the same on every device and survives
 * reloads. The engineering runtime checks it at execution time
 * (workspace:request-apply / apply). The browser only displays it.
 *
 * Who may change it:
 *   • lowering — the verified user, with confirm:true;
 *   • raising  — the verified user, with confirm:true AND their
 *     password re-verified by Supabase on the server. Code running
 *     in the page (LÉLU's own runtime included) holds the session
 *     token but never the password, so it cannot raise the level
 *     it acts under.
 *
 * Writes are serialised (one at a time, in order), so concurrent
 * requests cannot interleave a read-modify-write. Every change is
 * appended to an audit trail with who, from, to and when.
 * ==========================================================
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MIN_LEVEL = 0;
export const MAX_LEVEL = 5;
/** A user with no stored level starts here (the same default the page shows). */
export const DEFAULT_SERVER_LEVEL = 3;
/** Changing the real project (workspace:request-apply / apply). */
export const SERVER_APPLY_LEVEL = 4;

export interface AutonomyRecord {
  level: number;
  updatedAt: number;
  updatedBy: string;
}

export interface AutonomyAuditEntry {
  userId: string;
  by: string;
  from: number;
  to: number;
  at: number;
}

interface StoreFile {
  users: Record<string, AutonomyRecord>;
  audit: AutonomyAuditEntry[];
}

export type ChangeDecision =
  | { ok: true; record: AutonomyRecord }
  | { ok: false; status: number; reason: string };

export interface ServerAutonomyStore {
  get(userId: string): AutonomyRecord;
  /**
   * Change a user's level. `passwordVerified` must come from a real
   * server-side re-verification; it is required only to RAISE.
   */
  change(input: {
    userId: string;
    by: string;
    level: unknown;
    confirm: unknown;
    passwordVerified: boolean;
  }): Promise<ChangeDecision>;
  audit(userId: string): AutonomyAuditEntry[];
}

export function defaultAutonomyFile(root = process.cwd()): string {
  return process.env.LELU_AUTONOMY_FILE?.trim() || path.join(root, ".lelu-runtime", "autonomy.json");
}

export function createServerAutonomyStore(
  file: string = defaultAutonomyFile(),
  now: () => number = () => Date.now(),
): ServerAutonomyStore {
  let queue: Promise<unknown> = Promise.resolve();

  const read = (): StoreFile => {
    if (!existsSync(file)) return { users: {}, audit: [] };
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoreFile>;
      return { users: parsed.users ?? {}, audit: parsed.audit ?? [] };
    } catch {
      // An unreadable store must not grant anything: fall back to defaults.
      return { users: {}, audit: [] };
    }
  };
  const write = (data: StoreFile): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 });
  };
  const recordOf = (data: StoreFile, userId: string): AutonomyRecord =>
    data.users[userId] ?? { level: DEFAULT_SERVER_LEVEL, updatedAt: 0, updatedBy: "default" };

  return {
    get: (userId) => recordOf(read(), userId),
    audit: (userId) => read().audit.filter((entry) => entry.userId === userId),
    change(input) {
      const run = async (): Promise<ChangeDecision> => {
        if (input.confirm !== true) {
          return { ok: false, status: 400, reason: "Changing autonomy requires confirm:true." };
        }
        const level = Number(input.level);
        if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
          return { ok: false, status: 400, reason: `Autonomy level must be an integer from ${MIN_LEVEL} to ${MAX_LEVEL}.` };
        }
        const data = read();
        const current = recordOf(data, input.userId);
        if (level > current.level && !input.passwordVerified) {
          return {
            ok: false,
            status: 403,
            reason:
              `Raising autonomy from L${current.level} to L${level} requires re-entering your password. ` +
              "Lowering it does not.",
          };
        }
        const record: AutonomyRecord = { level, updatedAt: now(), updatedBy: input.by };
        data.users[input.userId] = record;
        data.audit.push({ userId: input.userId, by: input.by, from: current.level, to: level, at: record.updatedAt });
        data.audit = data.audit.slice(-500);
        write(data);
        return { ok: true, record };
      };
      // Serialise: each change reads the state the previous one wrote.
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
