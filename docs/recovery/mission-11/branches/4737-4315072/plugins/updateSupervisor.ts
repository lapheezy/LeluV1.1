/**
 * ==========================================================
 * LÉLU — WHO RESTARTS THE STANDALONE RUNTIME
 *
 * The Vite dev server can restart itself: `server.restart()` closes and
 * re-creates it, which is what makes "applied" provable there. The
 * standalone runtime (`server.ts`, Node/Bun) owns no such control — it
 * is one process serving `dist/`. Refreshing a page while that process
 * still runs the old code would be exactly the cosmetic reload the
 * update pipeline exists to prevent.
 *
 * So the standalone runtime needs a SUPERVISOR: something outside the
 * process that brings it back when it exits. That is a real, common
 * deployment arrangement (systemd `Restart=always`, Docker
 * `--restart=unless-stopped`, pm2, a shell loop), and it is the only
 * honest way for a process to restart itself — by ending, and letting
 * its supervisor start the new version.
 *
 * The contract:
 *   LELU_UPDATE_SUPERVISOR=1   → apply is permitted; the process closes
 *                                its listener and exits with code 75
 *                                (EX_TEMPFAIL) after the HTTP response
 *                                has been sent.
 *   unset (the default)        → no restart hook; apply refuses with an
 *                                explicit message instead of pretending.
 *
 * Exit 75 rather than 0 is deliberate: a supervisor configured to
 * restart on failure will bring the process back, and a plain
 * `Restart=on-failure` still works. The client's health check — not the
 * exit — is what decides whether the update was applied, so a restart
 * that fails to come back is reported as a failed update rather than a
 * success.
 *
 * Pure and dependency-injected so it can be tested without a process.
 * ==========================================================
 */

/** EX_TEMPFAIL — "gone for a moment, come back and try again". */
export const SUPERVISOR_EXIT_CODE = 75;

export type EnvLike = Record<string, string | undefined>;

/** Is this process explicitly allowed to end itself for an update? */
export function supervisorEnabled(env: EnvLike): boolean {
  const flag = env.LELU_UPDATE_SUPERVISOR;
  if (!flag) return false;
  return ["1", "true", "yes", "on"].includes(flag.trim().toLowerCase());
}

/** The sentence the panel shows when apply is refused for this reason. */
export function describeSupervisor(enabled: boolean): string {
  return enabled
    ? `restart through the external supervisor (exit ${SUPERVISOR_EXIT_CODE})`
    : "this process has no supervisor to restart it (set LELU_UPDATE_SUPERVISOR=1 when running under systemd, Docker --restart, pm2 or a supervising shell loop)";
}

export interface SupervisedRestartInput {
  enabled: boolean;
  /** Stop accepting connections and let in-flight responses finish. */
  close: () => Promise<void>;
  /** End the process. Injected so tests never terminate the test runner. */
  exit: (code: number) => void;
  code?: number;
}

/**
 * Build the restart hook the update pipeline calls, or `null` when this
 * process genuinely cannot restart itself. `apply` treats `null` as a
 * hard refusal — which is the point: the pipeline may only claim an
 * update was applied when something can actually serve the new code.
 */
export function createSupervisedRestart(input: SupervisedRestartInput): (() => Promise<void>) | null {
  if (!input.enabled) return null;
  const code = input.code ?? SUPERVISOR_EXIT_CODE;
  return async () => {
    // Close first so the restart is a clean hand-off: the supervisor
    // starts the new version against a released port, not a busy one.
    // The exit happens even if closing throws — a socket that will not
    // drain must not be able to wedge the update in the old process
    // forever, and the client's health check still decides the outcome.
    try {
      await input.close();
    } finally {
      input.exit(code);
    }
  };
}
