/**
 * ==========================================================
 * LÉLU — BACKGROUND TIMERS
 *
 * A repeating background job should never be the reason a process
 * refuses to end.
 *
 * Measured: one 60-second housekeeping interval — ProjectScheduler's, started
 * implicitly the first time anything called AIService.getInstance() — kept
 * twelve test files alive after their last assertion. Their results were
 * unobtainable not because anything was slow or waiting on a network, but
 * because Node had a referenced timer and would not exit.
 *
 * In Node a timer handle can be `unref`ed: it still fires on schedule while
 * the process is alive, but it stops being a reason to STAY alive. Browsers
 * have no such concept and no such problem — a page has no "exit" — so the
 * call is guarded and is simply a no-op there.
 *
 * This is not a way of hiding a leak. Every caller still gets a real stop(),
 * and owners are still expected to call it; unref only removes the one
 * consequence that cannot be justified, which is a maintenance tick holding
 * a process open forever.
 * ==========================================================
 */

export interface BackgroundTimer {
  /** Stop the timer. Safe to call more than once. */
  stop: () => void;
  /** Is it still scheduled? */
  readonly active: boolean;
}

type TimerHandle = ReturnType<typeof setInterval>;

/** Detach a timer from the process's "keep running" count, where supported. */
function detach(handle: TimerHandle): void {
  const candidate = handle as unknown as { unref?: () => void };
  if (typeof candidate?.unref === "function") candidate.unref();
}

/**
 * A repeating background job that will not keep the process alive.
 *
 * Use this for housekeeping — schedulers, polls, heartbeats. Do NOT use it
 * for work whose completion something is waiting on: an unref'd timer will
 * not hold the process open until it fires.
 */
export function backgroundInterval(fn: () => void, intervalMs: number): BackgroundTimer {
  let handle: TimerHandle | null = setInterval(fn, intervalMs);
  detach(handle);
  return {
    stop() {
      if (handle === null) return;
      clearInterval(handle);
      handle = null;
    },
    get active() {
      return handle !== null;
    },
  };
}

/** The same, for a one-shot delay. */
export function backgroundTimeout(fn: () => void, delayMs: number): BackgroundTimer {
  let handle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    handle = null;
    fn();
  }, delayMs);
  detach(handle as unknown as TimerHandle);
  return {
    stop() {
      if (handle === null) return;
      clearTimeout(handle);
      handle = null;
    },
    get active() {
      return handle !== null;
    },
  };
}

/**
 * Race `work` against a deadline, rejecting with `message` if the deadline
 * wins.
 *
 * The whole point is the `finally`. The losing half of a bare
 * `Promise.race([work, new Promise((_, reject) => setTimeout(...))])` does
 * not stop when the other half settles: once the work answers first, that
 * timer stays pending for its full delay, and Node counts a pending timer
 * as a reason to keep the process alive. Measured: one cognition research
 * cycle left three 6-second timers behind this way and the test process
 * never exited after its last assertion.
 *
 * Clearing it is also the honest behaviour at runtime — a provider that
 * already answered has no deadline left to miss.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}
