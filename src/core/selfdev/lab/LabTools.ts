/**
 * ==========================================================
 * LÉLU — LABORATORY CHAT TOOLS
 *
 * The engineering laboratory, reachable from the conversation.
 *
 * Every tool here is a read or a bounded action over the SAME
 * engine the interface uses; none of them invents a result. When
 * the runtime is not serving the laboratory (a static build, a
 * closed dev server) the tool returns ok:false with the reason,
 * because an empty answer would look like a repository with no
 * findings.
 *
 * They join the one dispatch table (ToolDispatcher's BY_ID) and
 * the one registry, so the gate, the activity timeline and the
 * execution ledger treat them like every other tool. No second
 * chat system, no second store.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../../tools/ToolRegistry";
import type { ToolExecutionResult } from "../../tools/ToolDispatcher";
import LabClient, { type LabDiff, type LabDiscovery, type LabExperiment } from "./LabClient";
import { syncLaboratoryIntoJournal } from "./LabJournalBridge";

const ok = (content: string, data?: Record<string, unknown>): ToolExecutionResult => ({ ok: true, content, data });
const bad = (content: string): ToolExecutionResult => ({ ok: false, content });

const str = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === "string" ? (args[key] as string).trim() : "";

function lab(): LabClient {
  return LabClient.getInstance();
}

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function findingLines(discovery: LabDiscovery): string[] {
  if (discovery.findings.length === 0) return ["  (no findings — this inspection is clean)"];
  return discovery.findings.map(
    (finding) => `  • [${finding.severity}] ${finding.id} — ${finding.title}${finding.files.length ? `\n      files: ${finding.files.slice(0, 3).join(", ")}` : ""}`,
  );
}

function diffText(diff: LabDiff): string {
  if (diff.files.length === 0) return "(no change against the experiment baseline)";
  return diff.files
    .map((file) => {
      const header = `### ${file.path}  (${file.status}, +${file.addedLines} / −${file.removedLines})`;
      const body = file.patch
        .split("\n")
        .filter((line) => !line.startsWith("index ") && !line.startsWith("diff --git"))
        .slice(0, 220)
        .join("\n");
      return `${header}\n\`\`\`diff\n${body.trim()}\n\`\`\``;
    })
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* executors                                                           */
/* ------------------------------------------------------------------ */

interface LabExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

const NO_ARGS = { type: "object", properties: {} };
const EXPERIMENT_ARG = {
  type: "object",
  properties: {
    experiment: { type: "string", description: "Experiment id, e.g. exp-engineer-ops. Omit to use the most recent one." },
  },
};

async function resolveExperiment(named: string): Promise<LabExperiment | null> {
  const { experiments } = await lab().listExperiments();
  if (named) return experiments.find((entry) => entry.id === named) ?? null;
  return experiments[experiments.length - 1] ?? null;
}

const LAB_EXECUTOR_LIST: LabExecutor[] = [
  {
    id: "lab.repository",
    parameters: NO_ARGS,
    async run() {
      const status = await lab().status(true);
      const repo = status.repository;
      const tree = await lab().tree("");
      const scheduler = (status as unknown as { scheduler?: Record<string, unknown> }).scheduler ?? null;
      const lines = [
        `Repository: ${repo.fullName || repo.remote} on ${repo.branch}`,
        `HEAD: ${repo.head.shortSha} — ${repo.head.subject} (${repo.head.author}, ${repo.head.date})`,
        `Working tree: ${repo.dirty} uncommitted path(s)${repo.dirty ? ` — ${repo.dirtyFiles.slice(0, 6).join(", ")}` : ""}`,
        `Branches: ${repo.branches} · GitHub: ${status.github.reachable ? `reachable, ${status.github.heads} remote heads` : `UNREACHABLE — ${status.github.error ?? "no detail"}`}`,
        `Ahead ${repo.ahead} / behind ${repo.behind} origin`,
        `Top level: ${tree.entries.slice(0, 12).map((entry) => `${entry.name}${entry.type === "dir" ? "/" : ""}`).join(" ")}`,
        status.sync ? `Last sync: ${ago(status.sync.at)} at ${status.sync.commit.slice(0, 7)}, ${status.sync.newCommits} new commit(s)` : "No sync recorded yet.",
        scheduler
          ? `Scheduler: ${scheduler.running ? `running (pid ${scheduler.pid})` : "not running"} · ${scheduler.cycles ?? 0} cycle(s)${scheduler.lastCycleAt ? ` · last ${ago(Number(scheduler.lastCycleAt))}` : ""}${scheduler.nextAt ? ` · next in ${Math.round((Number(scheduler.nextAt) - Date.now()) / 60000)}m` : ""}`
          : "Scheduler: unknown (this runtime did not report it).",
        `Boundaries: pushes=${String((status.boundaries as Record<string, unknown>).pushes)} merges=${String((status.boundaries as Record<string, unknown>).merges)} deploy=${String((status.boundaries as Record<string, unknown>).productionDeploy)}`,
      ];
      return ok(lines.join("\n"), { repository: repo, github: status.github, scheduler });
    },
  },

  {
    id: "lab.discoveries",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["latest", "unresolved", "all"],
          description: "latest = the most recent inspection; unresolved = open findings across history; all = every recorded discovery.",
        },
      },
    },
    async run(args) {
      const scope = str(args, "scope") || "latest";
      const { discoveries } = await lab().discoveries();
      if (discoveries.length === 0) {
        return ok("No discovery has been recorded yet. Run the scheduler or press Inspect to create the first one.");
      }
      if (scope === "latest") {
        const latest = discoveries[0];
        const lines = [
          `Discovery ${latest.id} — ${ago(latest.at)} at ${latest.commit.slice(0, 7)} on ${latest.branch}`,
          `Status: ${latest.status}${latest.previous ? ` (repeats ${latest.previous})` : ""} · priority ${latest.priority.score}/100 (${latest.priority.severity})`,
          `Recommendation: ${latest.recommendedAction}`,
          `Findings (${latest.findings.length}):`,
          ...findingLines(latest),
        ];
        if (latest.research.length > 0) {
          lines.push(`Research: ${latest.research.map((note) => `${note.question} → ${note.conclusion.slice(0, 160)}`).join(" | ")}`);
        }
        const rationale = (latest as unknown as { rationale?: Record<string, unknown> }).rationale;
        if (rationale) {
          lines.push(
            `Why it matters: ${String(rationale.whyItMatters)}`,
            `Smallest correction: ${String(rationale.smallestCorrection)}`,
            `Success measured by: ${String(rationale.successMeasure)}`,
          );
        }
        return ok(lines.join("\n"), { discovery: latest });
      }
      if (scope === "unresolved") {
        const open = discoveries.filter((entry) => entry.status !== "resolved");
        const findings = open.flatMap((entry) =>
          entry.findings
            .filter((finding) => finding.severity !== "info")
            .map((finding) => `  • [${finding.severity}] ${finding.id} — ${finding.title} (seen ${ago(entry.at)})`),
        );
        return ok(
          [`Unresolved findings across ${open.length} discovery run(s):`, ...(findings.length ? findings : ["  (none)"]), `Resolved: ${discoveries.filter((entry) => entry.status === "resolved").length}`].join("\n"),
          { unresolved: open },
        );
      }
      return ok(
        discoveries
          .map((entry) => `${entry.id} ${ago(entry.at)} · ${entry.findings.length} finding(s) · priority ${entry.priority.score} · ${entry.status} · ${entry.commit.slice(0, 7)}`)
          .join("\n"),
        { discoveries },
      );
    },
  },

  {
    id: "lab.diff",
    parameters: EXPERIMENT_ARG,
    async run(args) {
      const experiment = await resolveExperiment(str(args, "experiment"));
      if (!experiment) return bad("No experiment exists. Create one in the laboratory before asking for a diff.");
      const { diff } = await lab().experimentDiff(experiment.id);
      const header = [
        `Experiment ${experiment.id} (${experiment.branch})`,
        `Baseline ${experiment.baselineCommit?.slice(0, 7) ?? experiment.baseCommit.slice(0, 7)} → ${diff.head.slice(0, 7)}`,
        experiment.commit ? `Committed: ${experiment.commit.sha.slice(0, 7)} — ${experiment.commit.message}` : "Not committed yet",
        diff.stat || "(no change)",
      ].join("\n");
      return ok(`${header}\n\n${diffText(diff)}`, { experiment, diff });
    },
  },

  {
    id: "lab.verification",
    parameters: {
      type: "object",
      properties: {
        experiment: { type: "string", description: "Experiment id; omit for the most recent." },
        command: {
          type: "string",
          enum: ["typecheck", "syntax", "tests", "build"],
          description: "Which declared check to run. Omit to report the recorded history instead of running anything.",
        },
      },
    },
    async run(args) {
      const experiment = await resolveExperiment(str(args, "experiment"));
      if (!experiment) return bad("No experiment exists, so there is nothing to verify.");
      const command = str(args, "command");
      if (!command) {
        const history = (experiment.verifications ?? []).slice(-6);
        const status = (experiment as unknown as { status?: string }).status ?? "open";
        return ok(
          [
            `Experiment ${experiment.id} — status ${status}`,
            experiment.commit ? `Commit: ${experiment.commit.sha.slice(0, 7)}` : "No commit yet",
            history.length === 0
              ? "No check has run in this experiment yet."
              : ["Recorded checks (newest last):", ...history.map((run) => `  • ${run.command}: exit ${run.status} in ${Math.round(run.durationMs / 1000)}s — ${run.ok ? "passed" : "FAILED"} (${ago(run.at)})`)].join("\n"),
          ].join("\n"),
          { experiment },
        );
      }
      const result = await lab().runCommand(experiment.id, command);
      const tail = (result.stdout || result.stderr || "").trim().split("\n").slice(-14).join("\n");
      const verdict = result.ok ? "PASSED" : "FAILED";
      /*
       * A failed check must be a failed tool call. Returning ok:true with the
       * word FAILED inside the text is how a red build gets described as green:
       * the caller reads the envelope, not the prose.
       */
      const content = [
        `${result.label} on ${experiment.id}: ${verdict}`,
        `exit ${result.status} · ${Math.round(result.durationMs / 1000)}s`,
        tail ? `\`\`\`\n${tail}\n\`\`\`` : "(no output)",
      ].join("\n");
      return result.ok ? ok(content, { result }) : bad(content);
    },
  },

  {
    id: "lab.experiment",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "conclude"], description: "list = show experiments; create = open an isolated worktree; conclude = mark verified or abandoned." },
        id: { type: "string", description: "Experiment id (create: optional name; conclude: required)." },
        discoveryId: { type: "string", description: "The discovery this experiment addresses." },
        reason: { type: "string", description: "Why this change is being made — recorded with the experiment." },
        status: { type: "string", enum: ["verified", "abandoned"], description: "For conclude." },
        note: { type: "string", description: "For conclude: what the evidence showed." },
      },
    },
    async run(args) {
      const action = str(args, "action") || "list";
      if (action === "list") {
        const { experiments } = await lab().listExperiments();
        if (experiments.length === 0) return ok("No experiments yet. The laboratory creates them as isolated git worktrees.");
        return ok(
          experiments
            .map(
              (experiment) =>
                `• ${experiment.id} (${experiment.branch}) — base ${experiment.baseCommit.slice(0, 7)}, ${(experiment as unknown as { status?: string }).status ?? "open"}${experiment.commit ? `, commit ${experiment.commit.sha.slice(0, 7)}` : ""}${experiment.preview ? `, preview :${experiment.preview.port}` : ""}`,
            )
            .join("\n"),
          { experiments },
        );
      }
      if (action === "create") {
        const response = await lab().createExperiment({
          ...(str(args, "id") ? { id: str(args, "id") } : {}),
          ...(str(args, "discoveryId") ? { discoveryId: str(args, "discoveryId") } : {}),
          ...(str(args, "reason") ? { reason: str(args, "reason") } : {}),
        });
        return ok(
          `Opened ${response.experiment.id} on branch ${response.experiment.branch}.\nBaseline ${response.experiment.baselineCommit?.slice(0, 7)} from ${response.experiment.baseCommit.slice(0, 7)}.\nIt is isolated: the canonical tree is untouched.`,
          { experiment: response.experiment },
        );
      }
      const experiment = await resolveExperiment(str(args, "id"));
      if (!experiment) return bad(`No experiment ${JSON.stringify(str(args, "id"))} exists.`);
      const status = str(args, "status") === "abandoned" ? "abandoned" : "verified";
      const response = await lab().concludeExperiment(experiment.id, status, str(args, "note"));
      return ok(`${experiment.id} concluded as ${status}.${str(args, "note") ? `\nNote: ${str(args, "note")}` : ""}`, { experiment: response.experiment });
    },
  },

  {
    id: "lab.preview",
    parameters: {
      type: "object",
      properties: {
        experiment: { type: "string", description: "Experiment id; omit for the most recent." },
        action: { type: "string", enum: ["status", "start", "stop"], description: "Default: status." },
      },
    },
    async run(args) {
      const experiment = await resolveExperiment(str(args, "experiment"));
      if (!experiment) return bad("No experiment exists, so there is no preview to open.");
      const action = str(args, "action") || "status";
      if (action === "status") {
        return ok(
          experiment.preview
            ? `Preview for ${experiment.id} is running on port ${experiment.preview.port} (pid ${experiment.preview.pid}), started ${ago(experiment.preview.startedAt)}.\n${experiment.preview.url}`
            : `No preview is running for ${experiment.id}.`,
          { preview: experiment.preview },
        );
      }
      if (action === "stop") {
        await lab().stopPreview(experiment.id);
        return ok(`Stopped the preview for ${experiment.id}.`);
      }
      const { preview } = await lab().startPreview(experiment.id);
      return ok(
        `Experimental preview of ${experiment.branch} is live on port ${preview.port} (pid ${preview.pid}).\n${preview.url}\nThis is the experiment's own working copy, not the canonical app.`,
        { preview },
      );
    },
  },

  {
    id: "lab.file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository-relative path, e.g. src/core/selfdev/SelfAwareness.ts" },
        mode: { type: "string", enum: ["read", "genealogy"], description: "read shows the file; genealogy shows where it came from." },
        limit: { type: "number", description: "Max lines to show when reading (default 80)." },
      },
    },
    async run(args) {
      const target = str(args, "path");
      if (!target) return bad("A path is required.");
      if (str(args, "mode") === "genealogy") {
        const { genealogy } = await lab().genealogy(target);
        if (!genealogy.exists) return bad(`${target} does not exist in this tree.`);
        return ok(
          [
            `${target} — ${genealogy.lineCount} lines`,
            genealogy.origin
              ? `Origin: ${genealogy.origin.commit} by ${genealogy.origin.author} on ${genealogy.origin.date.slice(0, 10)} — ${genealogy.origin.subject}`
              : "No commit history: this file is new in the working tree.",
            `Last change: ${genealogy.lastChange ? `${genealogy.lastChange.commit} by ${genealogy.lastChange.author} (${genealogy.lastChange.date.slice(0, 10)})` : "none"}`,
            `Contributors: ${genealogy.contributors.map((entry) => `${entry.author} (${entry.commits})`).join(", ") || "none"}`,
            `On branches: ${genealogy.branches.join(", ") || "none"}`,
          ].join("\n"),
          { genealogy },
        );
      }
      const file = await lab().file(target);
      const limit = Math.min(Math.max(Number(args.limit ?? 80) || 80, 10), 400);
      const lines = file.content.split("\n");
      const shown = lines.slice(0, limit).join("\n");
      return ok(
        `${file.path} — ${file.lines} lines, ${file.bytes} bytes${file.lines > limit ? ` (showing ${limit})` : ""}\n\`\`\`\n${shown}\n\`\`\``,
        { path: file.path, lines: file.lines },
      );
    },
  },

  {
    id: "lab.history",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["journal", "commits", "timeline"], description: "journal = laboratory activity; commits = git log; timeline = both, merged by time." },
        limit: { type: "number", description: "How many entries (default 20)." },
      },
    },
    async run(args) {
      const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 3), 60);
      const source = str(args, "source") || "timeline";
      const journal = source === "commits" ? null : await lab().journal();
      const commits = source === "journal" ? null : await lab().commits(limit);
      if (source === "journal" && journal) {
        return ok(
          journal.entries.slice(0, limit).map((entry) => `${new Date(entry.at).toISOString().slice(0, 16)} ${String(entry.kind)}${entry.id ? ` ${String(entry.id)}` : ""}`).join("\n") || "The journal is empty.",
          { entries: journal.entries.slice(0, limit) },
        );
      }
      if (source === "commits" && commits) {
        return ok(
          commits.commits.map((commit) => `${commit.short} ${commit.date.slice(0, 10)} ${commit.author} — ${commit.subject}`).join("\n"),
          { commits: commits.commits },
        );
      }
      const merged: Array<{ at: number; label: string }> = [
        ...(journal?.entries ?? []).map((entry) => ({
          at: entry.at,
          label: `lab  ${String(entry.kind)}${entry.id ? ` ${String(entry.id)}` : ""}${entry.path ? ` ${String(entry.path)}` : ""}`,
        })),
        ...(commits?.commits ?? []).map((commit) => ({
          at: Date.parse(commit.date) || 0,
          label: `git  ${commit.short} ${commit.subject}`,
        })),
      ].sort((a, b) => b.at - a.at).slice(0, limit);
      return ok(
        merged.length === 0
          ? "No history yet."
          : merged.map((entry) => `${new Date(entry.at).toISOString().slice(0, 16)}  ${entry.label}`).join("\n"),
        { timeline: merged.map((entry) => entry.label) },
      );
    },
  },
];

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

const LAB_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: "lab.repository",
    name: "Inspect the repository",
    description:
      "Report the authorized repository's identity, branch, HEAD, remote reachability, worktrees and the scheduler's state.",
    category: "SELF_DEVELOPMENT",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "local · self-development laboratory (git)",
    verificationMethod: "The repository state is read from git in this runtime; unreachable remotes are reported as such.",
  },
  {
    id: "lab.discoveries",
    name: "Report discoveries",
    description:
      "Show the latest self-discovery, the unresolved findings across all inspections, or every recorded discovery with its priority.",
    category: "SELF_DEVELOPMENT",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "local · .lelu-lab/state/discoveries.json",
    verificationMethod: "Reads the discoveries the engine recorded; never generates a finding on the spot.",
  },
  {
    id: "lab.diff",
    name: "Show the exact diff",
    description:
      "Show an experiment's baseline-to-current diff: files, line counts and the exact patch. This is the change as a reviewer sees it.",
    category: "SELF_DEVELOPMENT",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "local · git diff against the experiment baseline",
    verificationMethod: "The patch comes from git diff; a committed change stays visible because the comparison is against the baseline.",
  },
  {
    id: "lab.verification",
    name: "Run or report verification",
    description:
      "Run a declared check (typecheck, syntax, tests, build) inside an experiment and report the exit code, duration and log tail, or report the recorded history.",
    category: "SELF_DEVELOPMENT",
    permissions: ["READ", "EXECUTE"],
    riskLevel: 1,
    available: true,
    executionRoute: "local · declared command in the experiment worktree",
    verificationMethod: "Exit code and duration are the command's own; a non-zero exit is reported as FAILED, never as a pass.",
  },
  {
    id: "lab.experiment",
    name: "Manage experiments",
    description:
      "List experiments with their ancestry, open a new isolated worktree from the current HEAD, or conclude one as verified or abandoned.",
    category: "SELF_DEVELOPMENT",
    permissions: ["READ", "WRITE"],
    riskLevel: 1,
    available: true,
    executionRoute: "local · git worktree under .lelu-lab/experiments",
    verificationMethod: "A worktree either exists in `git worktree list` or the call fails; the canonical tree is never written.",
  },
  {
    id: "lab.preview",
    name: "Control the experimental preview",
    description: "Report, start or stop the development server of an experiment — the experiment's own working copy, on its own port.",
    category: "SELF_DEVELOPMENT",
    permissions: ["READ", "EXECUTE"],
    riskLevel: 1,
    available: true,
    executionRoute: "local · vite in the experiment worktree",
    verificationMethod: "The start call only succeeds once the port answers over HTTP; a failure returns the log.",
  },
  {
    id: "lab.file",
    name: "Read code or its genealogy",
    description:
      "Show a repository file with its real contents, or its genealogy: origin commit, last change, contributors and branches.",
    category: "SELF_DEVELOPMENT",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "local · project filesystem and git log --follow",
    verificationMethod: "Contents are read from disk; genealogy is git log --follow for that path.",
  },
  {
    id: "lab.history",
    name: "Show development history",
    description:
      "Show the laboratory journal, the git commit log, or both combined into one timeline of what was discovered, changed, verified and committed.",
    category: "SELF_DEVELOPMENT",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "local · journal.jsonl + git log",
    verificationMethod: "Both sources are read as they are; an empty journal is reported as empty rather than filled in.",
  },
];

let registered = false;

/** Idempotent: importing this module twice must not double-register. */
export function registerLabTools(): void {
  if (registered) return;
  registered = true;
  const registry = ToolRegistry.getInstance();
  for (const definition of LAB_TOOL_DEFINITIONS) registry.register(definition);
}

registerLabTools();

/**
 * The laboratory's tools, with its own record carried into the journal.
 *
 * LabJournalBridge already knew how to import the laboratory's append-only
 * journal into the ONE DevelopmentJournal — deduped by title, and verified
 * only when a declared check really passed — but NOTHING called it, so a
 * conversation could inspect the repository and check an experiment while
 * the development journal stayed empty. The bridge is invoked here, at the
 * one place every laboratory tool already passes through, so no new
 * registry or memory store is introduced.
 *
 * Fire-and-forget on purpose: importing the journal must never delay or fail
 * the tool the user asked for. The lab journal is the source of truth and
 * the import is idempotent, so a missed pass is repaired by the next call.
 */
/**
 * WHERE a laboratory answer came from, and what it cannot support.
 *
 * Mission 44.2 measured the failure this prevents: asked to summarise the
 * journal, Lélu returned the real rows (experiment-commit, preview-started,
 * experiment-concluded) and then narrated them as "building four objects —
 * three zones, one hub, three links". The rows were true; the sentence was
 * invented from an earlier turn. A model cannot tell a recorded title from a
 * description unless the result says which it is holding.
 *
 * So every successful laboratory result now ends with its source and its
 * LIMITS, written by the tool, not by the model. This is provenance on the
 * existing result — not a second journal, not a second truth, and not a
 * filter that could hide a real failure (failures are returned untouched).
 */
const PROVENANCE: Record<string, { source: string; limits: string }> = {
  "lab.repository": {
    source: "git status/HEAD read live in this runtime, plus the scheduler's recorded state",
    limits:
      "It reports the repository as it is now. It does not know what a commit changed, why it was made, or whether the work is correct.",
  },
  "lab.discoveries": {
    source: ".lelu-lab/state/discoveries.json — the findings the engine recorded",
    limits:
      "Only the recorded findings and their recorded severity. Nothing here shows an inspection that was never run.",
  },
  "lab.diff": {
    source: "git diff against the experiment's baseline commit",
    limits:
      "Changed lines only. It does not run the code, judge it, or describe intent beyond the patch itself.",
  },
  "lab.verification": {
    source: "the declared command's own exit code, duration and log tail",
    limits:
      "A non-zero exit is FAILED, never a pass, and a check that did not run is not evidence of anything.",
  },
  "lab.experiment": {
    source: "git worktree list and the laboratory's experiment records in this runtime",
    limits:
      "It reports worktrees, ancestry and status. It does not report what an experiment intends or what it will change.",
  },
  "lab.preview": {
    source: "the experiment's dev server and its HTTP response",
    limits:
      "A port that answers is not a passing build, and a preview is not a deployment.",
  },
  "lab.file": {
    source: "the file as read from disk, and git log --follow for its genealogy",
    limits:
      "Text and history only. The reason a line was written is not in the record unless the log says it.",
  },
  "lab.history": {
    source: ".lelu-lab/state/journal.jsonl rows and git log, shown verbatim",
    limits:
      "These are recorded kinds, ids, titles and timestamps. What an entry did, how many objects it built, quantities, intent and outcome are NOT in the record; if a detail is not on these lines, say the record does not contain it.",
  },
};

function withProvenance(executor: LabExecutor): LabExecutor {
  const entry = PROVENANCE[executor.id];
  if (!entry) return executor;
  return {
    ...executor,
    run: async (args) => {
      const result = await executor.run(args);
      // A failure already says what went wrong in its own words; adding a
      // provenance footer to it would only dilute the error.
      if (!result.ok) return result;
      const at = new Date().toISOString().slice(0, 16);
      return {
        ...result,
        content: `${result.content}\n\n—\nSOURCE: ${entry.source} · ${executor.id} · read ${at}Z\nLIMITS: ${entry.limits}`,
      };
    },
  };
}

function withJournalSync(executor: LabExecutor): LabExecutor {
  return {
    ...executor,
    run: async (args) => {
      const result = await executor.run(args);
      if (result.ok) {
        void syncLaboratoryIntoJournal().catch(() => undefined);
      }
      return result;
    },
  };
}

export const LAB_EXECUTORS: LabExecutor[] = LAB_EXECUTOR_LIST.map(withJournalSync).map(withProvenance);
export { PROVENANCE as LAB_PROVENANCE };
export { LAB_TOOL_DEFINITIONS };
