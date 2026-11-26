/**
 * The daily cycle has to work when nobody is looking at it.
 *
 * These tests run the scheduler's REAL cycle function against a throwaway git
 * repository: no network, no dev server, no browser. That is the property the
 * mission asks for, so it is the property that gets tested — a test of a copy
 * of the cycle would prove nothing about the scheduler.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  acquireLock,
  backoffMs,
  emptyHeartbeat,
  heartbeatStale,
  readHeartbeat,
  releaseLock,
  runCycle,
  withCycleLock,
  writeHeartbeat,
  DEFAULT_INTERVAL_MS,
  LOCK_FILE,
  MAX_BACKOFF_FACTOR,
  SCHEDULER_WAIT_SLICE_MS,
  waitSliceMs,
} from "../scripts/lab-scheduler.ts";
import { createLabEngine } from "../plugins/labEngine.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

let repo: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "lelu-sched-"));
  git(["init", "-q", "-b", "main"]);
  git(["-c", "user.name=Test", "-c", "user.email=test@lelu.invalid", "commit", "-q", "--allow-empty", "-m", "root"]);
  mkdirSync(path.join(repo, "src"), { recursive: true });
  // The laboratory's state directory is its own, not the user's work.
  writeFileSync(path.join(repo, ".gitignore"), ".lelu-lab/\n", "utf8");
  // A real unfinished marker, so the inspection has something to find.
  writeFileSync(path.join(repo, "src/thing.ts"), "export const thing = 1; // TODO finish this\n", "utf8");
  git(["add", "--all"]);
  git(["-c", "user.name=Test", "-c", "user.email=test@lelu.invalid", "commit", "-q", "-m", "add thing"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("the heartbeat is the scheduler's only claim of liveness", () => {
  test("an unwritten heartbeat reads as stopped, not as running", () => {
    const state = readHeartbeat(repo);
    assert.equal(state.running, false);
    assert.equal(state.pid, null);
    assert.equal(state.cycles, 0);
    assert.deepEqual(state, { ...emptyHeartbeat(), ...state });
  });

  test("writes merge instead of replacing what earlier cycles recorded", () => {
    writeHeartbeat(repo, { cycles: 3, lastDiscoveryId: "disc-1" });
    writeHeartbeat(repo, { cycles: 4 });
    const state = readHeartbeat(repo);
    assert.equal(state.cycles, 4);
    assert.equal(state.lastDiscoveryId, "disc-1");
    assert.ok(existsSync(path.join(repo, ".lelu-lab/state/scheduler.json")));
  });

  test("backoff grows and is capped, so a broken remote cannot spin", () => {
    assert.equal(backoffMs(DEFAULT_INTERVAL_MS, 0), DEFAULT_INTERVAL_MS);
    assert.equal(backoffMs(DEFAULT_INTERVAL_MS, 1), DEFAULT_INTERVAL_MS);
    assert.equal(backoffMs(DEFAULT_INTERVAL_MS, 2), DEFAULT_INTERVAL_MS * 2);
    assert.equal(backoffMs(DEFAULT_INTERVAL_MS, 3), DEFAULT_INTERVAL_MS * 4);
    assert.equal(backoffMs(DEFAULT_INTERVAL_MS, 9), DEFAULT_INTERVAL_MS * MAX_BACKOFF_FACTOR);
  });
});

describe("one scheduler instance, and no overlapping cycles", () => {
  test("a second instance is refused while the first holds the lock", () => {
    const first = acquireLock(repo);
    assert.equal(first.ok, true);
    const second = acquireLock(repo);
    // Same process, so the pid is alive: this is the duplicate-start case.
    assert.equal(second.ok, false, "a second start must not be allowed to run concurrently");
    assert.match(second.reason ?? "", /already held by pid/);
    releaseLock(repo);
  });

  test("the lock is released by its owner and can be taken again", () => {
    assert.equal(acquireLock(repo).ok, true);
    releaseLock(repo);
    assert.equal(acquireLock(repo).ok, true, "after a clean stop the next start must succeed");
    releaseLock(repo);
  });

  test("a lock left behind by a dead process is taken over, not waited on", () => {
    // A crash leaves the file. The process table is what decides, not the file.
    const staleLock = path.join(repo, LOCK_FILE);
    mkdirSync(path.dirname(staleLock), { recursive: true });
    writeFileSync(staleLock, JSON.stringify({ pid: 2_147_483_600, at: Date.now() - 60_000 }), "utf8");
    const taken = acquireLock(repo);
    assert.equal(taken.ok, true, "a stale lock must not require a human to delete a file");
    releaseLock(repo);
  });

  test("a cycle is not started while another cycle is running", async () => {
    let ran = 0;
    const held = await withCycleLock(repo, async () => {
      // While this cycle holds the lock, a second attempt must refuse.
      const inner = await withCycleLock(repo, async () => {
        ran += 1;
        return "inner";
      });
      assert.equal(inner.ran, false, "a nested/parallel cycle must be refused");
      assert.match(inner.reason ?? "", /already running/);
      return "outer";
    });
    assert.equal(held.ran, true);
    assert.equal(held.value, "outer");
    assert.equal(ran, 0);
    // And the lock is gone afterwards, so the next cycle can run.
    const next = await withCycleLock(repo, async () => "next");
    assert.equal(next.ran, true);
  });

  test("a heartbeat that cannot be believed is reported as stale", () => {
    const now = Date.now();
    assert.equal(heartbeatStale({ ...emptyHeartbeat(), running: false }, now).stale, false, "stopped is not stale, it is stopped");

    const dead = heartbeatStale({ ...emptyHeartbeat(), running: true, pid: 2_147_483_600, lastCycleAt: now }, now);
    assert.equal(dead.stale, true, "a running heartbeat whose pid is gone is a lie");
    assert.match(dead.reason ?? "", /not running/);

    const old = heartbeatStale(
      { ...emptyHeartbeat(), running: true, pid: process.pid, lastCycleAt: now - DEFAULT_INTERVAL_MS * 3 },
      now,
    );
    assert.equal(old.stale, true, "a live pid with no recent cycle is stale too");

    const fresh = heartbeatStale({ ...emptyHeartbeat(), running: true, pid: process.pid, lastCycleAt: now - 60_000 }, now);
    assert.equal(fresh.stale, false);
  });
});

describe("a cycle runs with no browser and no dev server", () => {
  test("records a discovery, a journal entry and a heartbeat", async () => {
    const lines: string[] = [];
    const result = await runCycle(repo, { log: (line) => lines.push(line) });

    assert.equal(result.ok, true, result.error);
    assert.ok(result.discoveryId, "a cycle must name the discovery it produced");
    assert.ok(result.findings >= 1, "the TODO marker should be reported");

    const discoveries = JSON.parse(readFileSync(path.join(repo, ".lelu-lab/state/discoveries.json"), "utf8"));
    assert.equal(discoveries.length, 1);
    assert.equal(discoveries[0].id, result.discoveryId);
    assert.ok(
      discoveries[0].findings.some((finding: { id: string }) => finding.id === "unfinished-markers"),
      "the inspection should find the marker it was given",
    );

    const journal = readFileSync(path.join(repo, ".lelu-lab/state/journal.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(journal.some((entry: { kind: string }) => entry.kind === "scheduler-cycle"));

    const heartbeat = readHeartbeat(repo);
    assert.equal(heartbeat.ok, true);
    assert.equal(heartbeat.cycles, 1);
    assert.equal(heartbeat.lastDiscoveryId, result.discoveryId);
    assert.equal(heartbeat.failures, 0);
    assert.ok(heartbeat.nextAt && heartbeat.nextAt > Date.now(), "the next run must be scheduled forward");
  });

  test("the same tree twice is recognised, not rediscovered", async () => {
    const first = await runCycle(repo, { log: () => {} });
    const second = await runCycle(repo, { log: () => {} });
    assert.equal(second.ok, true);
    assert.notEqual(second.discoveryId, first.discoveryId, "each run is its own record");

    const discoveries = JSON.parse(readFileSync(path.join(repo, ".lelu-lab/state/discoveries.json"), "utf8"));
    assert.equal(discoveries.length, 2);
    assert.equal(
      discoveries[0].fingerprint,
      discoveries[1].fingerprint,
      "an unchanged tree has the same fingerprint — that is how the repeat is recognised",
    );
    // Newest first: the repeat names what it repeats.
    assert.equal(discoveries[0].status, "already-known");
    assert.equal(discoveries[0].previous, discoveries[1].id);
  });

  test("a cycle that cannot reach its remote says so instead of inventing success", async () => {
    const result = await runCycle(repo, { log: () => {} });
    assert.equal(result.ok, true, "the inspection itself still ran");
    const sync = JSON.parse(readFileSync(path.join(repo, ".lelu-lab/state/sync.json"), "utf8"));
    assert.equal(sync.ok, false, "this fixture has no origin, so connectivity must be false");
    assert.ok(sync.error, "an unreachable remote must carry its error");
  });

  test("fixing the finding makes the next inspection stop reporting it", async () => {
    const before = await runCycle(repo, { log: () => {} });
    assert.ok(before.findings >= 1);

    writeFileSync(path.join(repo, "src/thing.ts"), "export const thing = 1;\n", "utf8");
    git(["add", "--all"]);
    git(["-c", "user.name=Test", "-c", "user.email=test@lelu.invalid", "commit", "-q", "-m", "finish thing"]);

    const after = await runCycle(repo, { log: () => {} });
    const engine = createLabEngine(repo);
    const discoveries = engine.discoveries();
    const previous = discoveries.find((entry) => entry.id === before.discoveryId);
    assert.ok(previous, "the earlier discovery is still in the record");
    assert.equal(
      previous?.findings.some((finding) => finding.id === "unfinished-markers"),
      true,
      "the earlier discovery keeps what it found — history is not rewritten",
    );
    assert.equal(after.ok, true);
  });
});

describe("the scheduler cannot publish anything", () => {
  const source = readFileSync(path.join(ROOT, "scripts/lab-scheduler.ts"), "utf8");
  const engine = readFileSync(path.join(ROOT, "plugins/labEngine.ts"), "utf8");

  test("no push, merge, deploy or reset exists in the laboratory's git calls", () => {
    // The check is on what would EXECUTE, not on words in a comment: the
    // scheduler's own docs say it never pushes, and that sentence must not
    // read as a command.
    const gitCalls = [...engine.matchAll(/git\(\[([^\]]*)\]/g)].map((match) => match[1]);
    assert.ok(gitCalls.length >= 10, `expected the engine's git calls, parsed ${gitCalls.length}`);
    const forbidden = ["push", "merge", "reset", "rebase", "cherry-pick", "update-ref"];
    const offenders = gitCalls.filter((args) => forbidden.some((command) => args.includes(`"${command}"`)));
    assert.deepEqual(offenders, [], `these commands must not exist: ${offenders.join(" | ")}`);
  });

  test("the scheduler process does not run git or a shell itself", () => {
    assert.equal(/from "node:child_process"/.test(source), false, "the scheduler reaches git only through the engine");
    assert.equal(/\bexecFile\(|\bspawn\(/.test(source), false, "no process spawning in the cycle");
  });

  test("the scheduler runs the engine instead of its own copy of discovery", () => {
    assert.match(source, /import \{ createLabEngine, LAB_STATE_DIR \} from "\.\.\/plugins\/labEngine\.ts"/);
    assert.equal(
      /function inspect\(/.test(source),
      false,
      "a second inspection implementation is the duplication the mission forbids",
    );
    assert.match(engine, /export function createLabEngine/);
  });

  test("a failed cycle is recorded with its error and backs off", () => {
    assert.match(source, /kind: "scheduler-failure"/);
    assert.match(source, /backoffMs\(heartbeat\.intervalMs, failures\)/);
  });

  test("the daemon re-derives its schedule instead of sleeping one long interval", () => {
    /*
     * MEASURED (Mission 44.3): the running daemon was 39 minutes past its own
     * recorded nextAt with no cycle and no error, while `stale` read false
     * (its rule is 12 h). A single 6 h setTimeout is swallowed by a suspended
     * VM or a clock jump; the daemon must wake, look at the clock, and run.
     */
    const hour = 60 * 60_000;
    assert.equal(waitSliceMs(0, hour * 6), 0);
    assert.equal(waitSliceMs(hour, 0), SCHEDULER_WAIT_SLICE_MS, "a long wait is spliced");
    assert.equal(waitSliceMs(30_000, 0), 30_000, "a short wait is taken whole");
    assert.equal(waitSliceMs(hour, hour), 0, "a due cycle waits for nothing");
    assert.match(source, /await waitUntil\(Date\.now\(\) \+ delay\)/, "the cycle sleep goes through waitUntil");
  });
});
