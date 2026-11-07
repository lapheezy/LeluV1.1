/**
 * ==========================================================
 * LÉLU — SHELL COMMAND SAFETY
 *
 * `/api/engineer/execute` runs an operation from a fixed
 * whitelist, but the command string is assembled from the
 * request (an operation's command plus validated file names)
 * and then handed to `spawn(..., { shell: true })`. Semgrep
 * reports that as `spawn-shell-true`, correctly: with a shell,
 * a single metacharacter in any interpolated value turns a test
 * command into an arbitrary command.
 *
 * This module is the missing check. It does not replace the
 * whitelist or the AdapterRegistry — it closes the gap between
 * "the operation name was allowed" and "the string handed to
 * bash is the string that was allowed".
 *
 * Rules:
 *   • an empty command, or one over 512 characters, is refused;
 *   • any shell metacharacter (`; & | ` $ < > ( ) { } [ ]` and
 *     newlines) is refused — the whitelisted operations need
 *     none of them;
 *   • the reason names the offending character class, never a
 *     credential or a full request body.
 *
 * Refusing is the safe direction: a command that cannot be
 * proven to be one whitelisted operation does not run.
 * ==========================================================
 */

export const MAX_COMMAND_LENGTH = 512;

/**
 * Characters that let one command become several, redirect output,
 * or expand into something other than its literal text.
 */
const SHELL_METACHARACTERS = /[;&|`$<>\n\r(){}[\]]/;

export class UnsafeCommandError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Command refused: ${reason}`);
    this.name = "UnsafeCommandError";
    this.reason = reason;
  }
}

/**
 * Throws `UnsafeCommandError` unless the command is a single,
 * literal, metacharacter-free command line.
 */
export function assertSafeShellCommand(command: string): void {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new UnsafeCommandError("the command is empty.");
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new UnsafeCommandError(
      `the command is longer than ${MAX_COMMAND_LENGTH} characters, so it cannot be one whitelisted operation.`,
    );
  }
  const match = SHELL_METACHARACTERS.exec(command);
  if (match) {
    const shown = match[0] === "\n" || match[0] === "\r" ? "a newline" : `"${match[0]}"`;
    throw new UnsafeCommandError(
      `it contains the shell metacharacter ${shown}. Operations run without a shell expansion of request data.`,
    );
  }
}

/** Non-throwing form, for callers that report rather than throw. */
export function isSafeShellCommand(command: string): boolean {
  try {
    assertSafeShellCommand(command);
    return true;
  } catch {
    return false;
  }
}
