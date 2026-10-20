/**
 * ==========================================================
 * LÉLU — BACKGROUND LIFECYCLES
 *
 * CATEGORY: integration (one child process) + unit.
 *
 * The property being pinned: nothing LÉLU starts in the
 * background is a reason for a process to refuse to end.
 *
 * This is not a style preference. Measured, before the repair:
 * `npx tsx --test tests/cognition-chat-integration.test.ts`
 * printed every one of its results and then sat there forever.
 * Four owners were responsible —
 *
 *   · ProjectScheduler's 60s housekeeping interval,
 *   · ExecutiveRuntime's 10s self-state interval,
 *   · the losing half of the knowledge-provider
 *     `Promise.race`, whose 6s rejection timer stayed pending
 *     after the provider had already answered (three of them
 *     from a single research pass),
 *   · and the continuous cognition heartbeat — CognitiveLoop's
 *     interval and SelfStudyEngine's self-rescheduling timeout —
 *     which held tests/live-state-integration.test.ts open and
 *     with it every one of the 34 files queued behind it.
 *
 * The cost was not only a hung test. A result you cannot read
 * is a result you cannot act on, so twelve files' worth of
 * real coverage was invisible, and the tempting fixes —
 * --test-force-exit, or a longer timeout — would have hidden
 * the defect rather than removed it.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withDeadline, backgroundInterval } from "../src/core/runtime/BackgroundTimer";

const FIXTURE = fileURLToPath(new URL("./support/boot-and-exit.fixture.ts", import.meta.url));

/**
 * The real assertion, and the only honest one: boot LÉLU in a child
 * process and see whether it ends by itself.
 *
 * The budget is deliberately tight. The fixture's own work takes about
 * three seconds; a leaked handle does not make it slow, it makes it
 * never finish, so the gap between pass and fail here is the whole
 * runtime, not a few hundred milliseconds. Raising this number would
 * not fix a regression, it would only postpone noticing one.
 */
const EXIT_BUDGET_MS = 45_000;

test("booting the runtime and running cognition leaves a process able to exit", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", FIXTURE], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  child.stdout.on("data", (chunk) => { out += String(chunk); });
  child.stderr.on("data", (chunk) => { out += String(chunk); });

  const outcome = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, timedOut: true });
    }, EXIT_BUDGET_MS);
    child.on("exit", (code) => {
      clearTimeout(killer);
      resolve({ code, timedOut: false });
    });
  });

  // Did the work actually run? A process that exits because it crashed
  // on line one would otherwise pass this test.
  assert.match(
    out,
    /BOOT_AND_EXIT_RESEARCH tool=knowledge-providers/,
    `the fixture never ran its research pass, so the provider deadline was ` +
      `never exercised; output was:\n${out.slice(-2000)}`,
  );
  assert.match(
    out,
    /BOOT_AND_EXIT_REACHED_END/,
    `the fixture did not finish its work; output was:\n${out.slice(-2000)}`,
  );
  assert.equal(
    outcome.timedOut,
    false,
    "the child process booted LÉLU, finished its work, and then never exited — " +
      "something started in the background is still holding the event loop open. " +
      "Run it under scripts/find-leaked-handles.mjs to see which owner.",
  );
  assert.equal(outcome.code, 0, `child exited with ${outcome.code}; output was:\n${out.slice(-2000)}`);
});

test("withDeadline clears the losing timer when the work wins", async () => {
  const before = pendingTimeouts();
  const value = await withDeadline(Promise.resolve("answered"), 30_000, "should not fire");
  assert.equal(value, "answered");
  // A 30-second timer still pending here would be both pointless and,
  // for a process trying to exit, fatal.
  assert.equal(
    pendingTimeouts(),
    before,
    "withDeadline resolved but left its deadline timer pending",
  );
});

test("withDeadline rejects with its own message when the deadline wins, and still cleans up", async () => {
  const before = pendingTimeouts();
  await assert.rejects(
    withDeadline(new Promise((resolve) => setTimeout(resolve, 5_000).unref?.()), 10, "provider timed out"),
    /provider timed out/,
  );
  assert.equal(pendingTimeouts(), before, "withDeadline rejected but left a timer pending");
});

test("a background interval fires but is not a reason to stay alive", async () => {
  const before = pendingTimeouts();
  let ticks = 0;
  const timer = backgroundInterval(() => { ticks += 1; }, 5);

  // It must really run — unref must not be a quiet way of disabling work.
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(ticks > 0, "a background interval that never fires is not a background interval");

  // And it must not be counted among the handles keeping us here.
  assert.equal(
    pendingTimeouts(),
    before,
    "backgroundInterval left a referenced handle behind",
  );

  assert.equal(timer.active, true);
  timer.stop();
  assert.equal(timer.active, false);
  const settled = ticks;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(ticks, settled, "stop() did not stop the interval");
});

/**
 * How many timers Node currently counts as a reason to keep running.
 *
 * getActiveResourcesInfo() lists only REFERENCED handles, which is
 * exactly the question: an unref'd timer is absent from it, a leaked one
 * is present. The `setTimeout` this test's own await is sitting in would
 * be counted too, so every assertion compares against a baseline taken
 * in the same position rather than against zero.
 */
function pendingTimeouts(): number {
  const info = (process as unknown as { getActiveResourcesInfo?: () => string[] })
    .getActiveResourcesInfo?.() ?? [];
  return info.filter((name) => name === "Timeout").length;
}
