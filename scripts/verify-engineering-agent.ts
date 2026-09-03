/**
 * ==========================================================
 * LÉLU — REMOTE ENGINEERING AGENT PROOF
 * ==========================================================
 *
 * The minimal end-to-end proof required before this capability
 * is expanded:
 *
 *   LÉLU cognition creates an engineering task
 *     -> engineering agent receives it
 *     -> an Anthropic session starts
 *     -> a disposable clone of the repo is created at a SHA
 *     -> Claude inspects the repository
 *     -> Claude makes ONE controlled change
 *     -> Claude runs a check
 *     -> a structured result returns to LÉLU
 *     -> the local working tree is untouched
 *
 * The last line is verified, not assumed: this records the
 * local git state before and after and compares them.
 *
 * Run: bun run scripts/verify-engineering-agent.ts
 *
 * Without credentials this still runs and reports exactly which
 * boundary stopped it, because "unverified" and "broken" are
 * different answers and must not be conflated.
 * ==========================================================
 */

import { execSync } from "node:child_process";
import AnthropicEngineeringAgent from "../src/core/engineering/AnthropicEngineeringAgent";
import AgentEventBus, { type AgentEvent } from "../src/core/agent/AgentEvents";
import ToolRegistry from "../src/core/tools/ToolRegistry";

function git(command: string): string {
  return execSync(`git ${command}`, { encoding: "utf8" }).trim();
}

/** Fingerprint of the local tree — proves the run never touched it. */
function localState(): { head: string; dirty: string } {
  return { head: git("rev-parse HEAD"), dirty: git("status --porcelain") };
}

async function main(): Promise<void> {
  console.log("==========================================");
  console.log("LÉLU REMOTE ENGINEERING AGENT — PROOF RUN");
  console.log("==========================================");

  const agent = AnthropicEngineeringAgent.getInstance();

  /* ---- 1. the capability must not lie about being available ---- */

  const availability = agent.availability();
  const declared = ToolRegistry.getInstance().get("engineering.remote");

  console.log(`\ncapability declared in ToolRegistry : ${declared ? "yes" : "NO"}`);
  console.log(`executionRoute                      : ${declared?.executionRoute ?? "—"}`);
  console.log(`credentials present                 : ${availability.available}`);
  if (!availability.available) console.log(`reason                              : ${availability.reason}`);

  /* ---- 2. real events only ---- */

  const observed: AgentEvent[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => observed.push(event));

  /* ---- 3. the local tree, before ---- */

  const before = localState();
  console.log(`\nlocal HEAD before                   : ${before.head.slice(0, 12)}`);
  console.log(`local uncommitted files before      : ${before.dirty.split("\n").filter(Boolean).length}`);

  /* ---- 4. cognition's task ---- */

  const repository = git("remote get-url origin").replace(/\.git$/, "");
  const task = {
    // Deliberately tiny and self-verifying: the point of the proof is the
    // PIPELINE, not the sophistication of the change.
    objective:
      "Add a single-line comment at the top of README.md noting the repository was " +
      "inspected by LÉLU's engineering agent, then run `bunx tsc --noEmit` and report " +
      "its real output. Do not change any source file.",
    repository,
    baseCommit: before.head,
    constraints: [
      "Touch README.md only.",
      "Do not commit, push, or open a pull request.",
      "Report the real output of the typecheck, including failures.",
    ],
    researchAllowed: false,
    budgetUsd: 2,
    timeoutMs: 10 * 60_000,
  };

  console.log(`\nobjective                           : ${task.objective.slice(0, 68)}…`);
  console.log(`repository                          : ${task.repository}`);
  console.log(`base commit (pinned)                : ${task.baseCommit.slice(0, 12)}`);

  /* ---- 5. run ---- */

  console.log("\n--- executing ---");
  const result = await agent.execute(task);
  unsubscribe?.();

  /* ---- 6. what actually happened ---- */

  console.log(`\nstatus                              : ${result.status}`);
  if (result.unavailableReason) console.log(`did not start                       : ${result.unavailableReason}`);
  if (result.error) console.log(`error                               : ${result.error}`);
  if (result.sessionId) console.log(`session                             : ${result.sessionId}`);
  if (result.traceUrl) console.log(`trace                               : ${result.traceUrl}`);
  console.log(`real session events observed        : ${result.eventCount}`);
  console.log(`files the agent actually changed    : ${result.filesChanged.join(", ") || "(none)"}`);
  console.log(`commands it actually ran            : ${result.commandsRun.length}`);
  result.commandsRun.slice(0, 6).forEach((c) => console.log(`   $ ${c.slice(0, 84)}`));
  console.log(`diff produced                       : ${result.diff ? `${result.diff.split("\n").length} lines` : "none"}`);
  if (result.summary) console.log(`\nagent summary:\n${result.summary.slice(0, 700)}`);

  /* ---- 7. THE SAFETY CLAIM, VERIFIED ---- */

  const after = localState();
  const untouched = before.head === after.head && before.dirty === after.dirty;
  console.log("\n--- isolation ---");
  console.log(`local HEAD after                    : ${after.head.slice(0, 12)}`);
  console.log(`local working tree unchanged        : ${untouched}`);

  /* ---- 8. telemetry corresponds to real execution ---- */

  const engineeringEvents = observed.filter(
    (e) => "tool" in e && (e as { tool?: string }).tool === "engineering",
  );
  console.log(`\nLÉLU events emitted for this task    : ${observed.length}`);
  console.log(`  engineering tool events            : ${engineeringEvents.length}`);
  console.log(`  file_changed events                : ${observed.filter((e) => e.type === "file_changed").length}`);
  console.log(
    `  terminal task event                : ${
      observed.find((e) => e.type === "task_completed" || e.type === "task_failed")?.type ?? "NONE"
    }`,
  );

  console.log("\n------------------------------------------");
  if (!availability.available) {
    console.log("RESULT: UNVERIFIED — the pipeline did not run.");
    console.log(`Boundary: ${availability.reason}`);
    console.log("This is a missing credential, not a broken pipeline. Supply the");
    console.log("credential and re-run to get a real PASS/FAIL.");
  } else if (result.ok && untouched) {
    console.log("RESULT: PASS — real sandbox run, structured result, local tree untouched.");
  } else {
    console.log("RESULT: FAIL — see status/error above.");
  }
  console.log("==========================================");

  // A missing credential is not a test failure.
  process.exit(!availability.available ? 0 : result.ok && untouched ? 0 : 1);
}

main().catch((error) => {
  console.error("Proof run crashed:", error);
  process.exit(1);
});
