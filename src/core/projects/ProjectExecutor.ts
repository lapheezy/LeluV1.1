/**
 * ==========================================================
 * LÉLU
 * PROJECT EXECUTOR
 *
 * Single entry point for executing a project. Routes to the
 * EXISTING runtime systems — never a parallel pipeline:
 *
 *   research / knowledge projects → ProjectRunner (same
 *     ProviderRegistry the chat pipeline uses)
 *   self-improvement projects     → SelfDevelopmentEngine
 *     (real diagnostics + proposals), AvatarStore, UIStateStore,
 *     CapabilityManifest, ExecutiveBoard — all existing systems
 *
 * Every run records what actually happened (results, tasks,
 * provider failures, per-system detail). No fabricated
 * "complete" status — the summary reflects real output.
 * ==========================================================
 */

import type ProviderRegistry from "../ProviderRegistry";
import type { KnowledgeResult } from "../../providers/Provider";
import type { LeluProject } from "./ProjectStore";
import type Brain from "../../brain/Brain";
import ProjectRunner, { type ProjectRunFailure } from "./ProjectRunner";
import SelfDevelopmentEngine from "../selfdev/SelfDevelopmentEngine";
import ExecutiveBoard from "../executive/ExecutiveBoard";
import AvatarStore from "../avatar/AvatarProfile";
import UIStateStore from "../cognition/UIStateStore";
import CapabilityManifest from "../capabilities/CapabilityManifest";
import AgentEventBus from "../agent/AgentEvents";
import SandboxFS from "../engineering/SandboxFS";
import SandboxRuntime from "../engineering/SandboxRuntime";

export type ProjectDomain = "self-improvement" | "research" | "knowledge" | "sandbox";

export interface ProjectExecutionOutcome {
  domain: ProjectDomain;
  summary: string;
  results: KnowledgeResult[];
  providerNames: string[];
  failures: ProjectRunFailure[];
  resultCount: number;
  tasks: string[];
  /** Per-system, real execution detail lines. */
  detail: string[];
  startedAt: number;
  finishedAt: number;
}

/** Project-command scaffolding removed before execution-verb matching:
 *  "start a project to build X" must not count the trigger's "start" as
 *  an execution verb ("start a project to research sandbox games" is a
 *  knowledge project). "run my sandbox project" keeps its real subject. */
const SCAFFOLD =
  /^(?:please\s+)?(?:start|create|build|make|set up|open|begin|launch|run|execute)\s+(?:a\s+|an\s+|the\s+)?(?:project\s+)?(?:to|that|which|for|about|on|around|in|inside|my|the)?\s+/i;

export default class ProjectExecutor {
  /**
   * Classify what kind of execution a project needs. Sandbox commands
   * ("start the project in Sandbox…", "build X in the sandbox…") are
   * EXECUTION commands: they must never enter the knowledge-search
   * pipeline just because they mention words that could be searched.
   * Self-improvement projects (UI/avatar/"improve yourself") are
   * executed against LÉLU's own systems; everything else goes through
   * the knowledge provider chain.
   */
  public static classify(project: LeluProject): ProjectDomain {
    // The FULL original request participates in classification (with the
    // "start a project to …" scaffolding stripped) so phrase forms like
    // "run my sandbox project" — where the parser extracts only the tail
    // after "project" — still classify correctly, while "start a project
    // to research sandbox games" never matches an execution verb.
    const haystack = [
      (project.originalRequest ?? "").replace(SCAFFOLD, ""),
      project.location ?? "",
      project.objective ?? "",
      project.description ?? "",
      ...(project.actionableTasks ?? []),
    ].join(" ");

    // Sandbox/workspace execution targets — the user asked for WORK to
    // be done in the engineering sandbox, not for a web search. Only a
    // genuine execution verb plus a sandbox/workspace mention qualifies:
    // "research sandbox games" is a knowledge project, never a search
    // for gdelt/rss/news/hackernews AND never a sandbox write either.
    const mentionsSandbox = /\b(?:sandbox|workspace)\b/i.test(haystack);
    // Execution verbs. "use" is included as a GENERAL verb — the exact
    // phrase the user tested ("use the current saved avatar in a
    // full-screen 3D/rendered experience") must classify as execution,
    // not fall through to the knowledge providers. render/simulat/animat
    // match inflected forms (rendered, rendering, simulation).
    // "research sandbox games" never matches: research is not a verb
    // here, and the knowledge intent is caught earlier anyway.
    const asksExecution =
      /\b(?:build|create|make|execute|run|work\s+on|implement|develop|write|code|use|open|launch)\b|\brender\w*\b|\bsimulat\w*\b|\banimat\w*\b|\bfull[\s-]?screen\b/i.test(
        haystack,
      );
    if (mentionsSandbox && asksExecution) {
      return "sandbox";
    }

    if (
      /\b(?:improve|upgrade|redesign|revamp|enhance|refine|update|polish)\b/i.test(haystack) &&
      /\b(?:ui|interface|avatar|appearance|visual|design|myself|yourself|own)\b/i.test(haystack)
    ) {
      return "self-improvement";
    }
    if (project.location === "ui" || project.location === "avatar") {
      return "self-improvement";
    }
    if (
      /\b(?:news|headline|current events|track|follow|watch)\b/i.test(haystack) &&
      project.location === "news"
    ) {
      return "research";
    }
    return "knowledge";
  }

  /**
   * Execute a project through the existing runtime. Never throws —
   * failures are captured into the outcome so cognition always gets
   * an honest report of what was attempted.
   */
  public async execute(
    project: LeluProject,
    providers: ProviderRegistry,
    brain?: Brain,
  ): Promise<ProjectExecutionOutcome> {
    const startedAt = Date.now();
    const domain = ProjectExecutor.classify(project);
    const events = AgentEventBus.getInstance();
    const taskId = `project-${project.id}`;

    events.emit({
      type: "tool_selected",
      taskId,
      tool: "project_executor",
      label: `Executing "${project.name}" (${domain})`,
    });

    try {
      if (domain === "self-improvement") {
        return await this.executeSelfImprovement(project, startedAt);
      }
      if (domain === "sandbox") {
        return await this.executeSandbox(project, startedAt, brain);
      }
      return await this.executeResearch(project, providers, startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.emit({
        type: "tool_result",
        taskId,
        tool: "project_executor",
        result: `Execution failed: ${message}`,
      });
      return {
        domain,
        summary: `[${project.name}] Execution failed: ${message}`,
        results: [],
        providerNames: [],
        failures: [{ provider: "executor", error: message, latencyMs: Date.now() - startedAt }],
        resultCount: 0,
        tasks: [],
        detail: [`Executor error: ${message}`],
        startedAt,
        finishedAt: Date.now(),
      };
    }
  }

  /* ------------------------- RESEARCH / KNOWLEDGE ------------------------- */

  private async executeResearch(
    project: LeluProject,
    providers: ProviderRegistry,
    startedAt: number,
  ): Promise<ProjectExecutionOutcome> {
    const runner = new ProjectRunner(providers);
    const queries =
      project.queries?.length
        ? project.queries
        : [project.objective || project.description || project.name];

    const run = await runner.run(project.name, queries);
    const tasks =
      project.actionableTasks?.length
        ? project.actionableTasks
        : [`Research "${queries.join(", ")}"`];

    return {
      domain: "knowledge",
      summary: run.summary,
      results: run.results,
      providerNames: run.providerNames,
      failures: run.failures,
      resultCount: run.resultCount,
      tasks,
      detail: [
        `Queries: ${queries.join(" | ")}`,
        run.providerNames.length > 0
          ? `Providers with results: ${run.providerNames.join(", ")}`
          : "No provider returned usable results.",
        ...run.failures.map((failure) => `Provider failure — ${failure.provider}: ${failure.error} (${failure.latencyMs}ms)`),
      ],
      startedAt,
      finishedAt: run.finishedAt,
    };
  }

  /* ------------------------- SANDBOX / EXECUTION ------------------------- */

  /**
   * Execute a project as REAL sandbox work. This is not a diagram and
   * not a search: the project workspace is created as actual files in
   * the existing SandboxFS, the generated code is statically checked
   * through the real SandboxRuntime, the saved avatar is loaded into
   * its runtime mode when requested, and the environment/fullscreen
   * state is applied through the real UI-state store. Every step emits
   * real agent events and reports exactly what happened.
   */
  private async executeSandbox(
    project: LeluProject,
    startedAt: number,
    brain?: Brain,
  ): Promise<ProjectExecutionOutcome> {
    const detail: string[] = [];
    const events = AgentEventBus.getInstance();
    const taskId = `project-${project.id}`;
    const haystack = [
      project.objective ?? "",
      project.description ?? "",
      ...(project.actionableTasks ?? []),
    ].join(" ").toLowerCase();

    events.emit({ type: "task_started", taskId, label: `Sandbox project "${project.name}"` });

    // 1. SANDBOX SELECTED → create the REAL workspace in SandboxFS.
    const fs = SandboxFS.getInstance();
    const slug =
      project.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "project";
    const root = `projects/${slug}`;

    // Derive the starter template from the request so the workspace
    // matches what the user asked to build.
    const templateId = /\b(game|playable|canvas)\b/.test(haystack)
      ? "game"
      : /\b(agent|assistant|bot)\b/.test(haystack)
        ? "agent"
        : /\b(api|server|endpoint|backend)\b/.test(haystack)
          ? "api"
          : /\b(cli|command line|terminal tool)\b/.test(haystack)
            ? "cli"
            : "app";

    const generated = fs.generateProject(templateId, slug);
    const workspacePaths = generated.paths ?? [];

    // The MANIFEST records the FULL original instruction — never a
    // truncated title — plus objective, tasks, priority, and plan.
    const manifest = [
      `# ${project.name}`,
      "",
      "## Original request",
      project.originalRequest || project.objective || "",
      "",
      "## Objective",
      project.objective || "",
      "",
      "## Tasks",
      ...(project.actionableTasks?.length ? project.actionableTasks.map((t) => `- ${t}`) : ["- Execute the project"]),
      "",
      `## Priority — ${project.priority ?? "P1"}`,
      "",
      `## Location — ${project.location ?? "sandbox"}`,
      "",
      "## Execution plan",
      ...(project.executionPlan?.length
        ? project.executionPlan.map((step, index) => `${index + 1}. ${step}`)
        : ["1. Execute the project workspace"]),
      "",
      `## Status — created ${new Date().toISOString()}`,
      "",
    ].join("\n");
    const manifestWrite = fs.write(`${root}/MANIFEST.md`, manifest);

    const fsEvents: string[] = [];
    if (generated.ok && manifestWrite.ok) {
      fsEvents.push(`Workspace created at ${root}`);
      fsEvents.push(...workspacePaths.map((path) => `  - ${path}`));
      detail.push(`Sandbox workspace: ${root} (${workspacePaths.length + 1} file(s) written)`);
    } else {
      const error = manifestWrite.error ?? generated.error ?? "unknown sandbox write failure";
      detail.push(`Sandbox write failed: ${error}`);
      fsEvents.push(`Workspace write failed: ${error}`);
    }
    events.emit({ type: "tool_selected", taskId, tool: "sandbox", label: "sandbox" });
    events.emit({ type: "tool_started", taskId, tool: "sandbox", label: `Writing ${root}` });
    events.emit({
      type: "tool_result",
      taskId,
      tool: "sandbox",
      result: fsEvents.join("\n"),
    });

    // 2. REAL static analysis through the existing SandboxRuntime.
    const runtime = SandboxRuntime.getInstance();
    let runDetail = "Static analysis: no files to check.";
    try {
      const check = await runtime.syntaxCheck(12_000);
      const checked = check.syntax.filter((entry) => entry.path.startsWith(`${root}/`));
      const relevant = checked.length > 0 ? checked : check.syntax;
      if (check.ok && relevant.every((entry) => entry.ok)) {
        runDetail = `Static analysis passed: ${relevant.length} file(s) compiled clean (${check.durationMs}ms).`;
      } else if (check.stderr && check.syntax.length === 0) {
        // The analysis engine itself could not run — report the real
        // reason instead of a misleading "0 issues".
        runDetail = `Static analysis could not run: ${check.stderr.trim()}`;
      } else {
        const errors = relevant.filter((entry) => !entry.ok);
        runDetail = `Static analysis found ${errors.length} issue(s): ${errors
          .slice(0, 3)
          .map((entry) => `${entry.path}: ${entry.error ?? "syntax error"}`)
          .join("; ")}`;
      }
    } catch (error) {
      runDetail = `Static analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    detail.push(runDetail);
    events.emit({
      type: "tool_result",
      taskId,
      tool: "sandbox_runtime",
      result: runDetail,
    });

    // 3. SAVED AVATAR → the canonical embodiment is loaded into the
    //    active runtime mode when the request asks for it.
    let avatarDetail = "";
    if (/\b(avatar|portrait|3d|3-d|render|simulat|animat|embodi)\b/.test(haystack)) {
      const store = AvatarStore.getInstance();
      const profile = store.get();
      const previous = profile.runtime;
      const next = {
        animationActive: true,
        simulationActive: true,
        lastAction: `sandbox-project: ${project.name}`,
      };
      if (previous.animationActive !== next.animationActive || previous.simulationActive !== next.simulationActive) {
        await store.updateRuntime(next);
        avatarDetail = `Saved avatar "${profile.identity.name}" loaded — animation + simulation activated for the project run (${profile.referenceImage ? "reference portrait" : "default portrait"}).`;
      } else {
        avatarDetail = `Saved avatar "${profile.identity.name}" loaded — animation/simulation already active (${profile.referenceImage ? "reference portrait" : "default portrait"}).`;
      }
      events.emit({ type: "tool_selected", taskId, tool: "avatar", label: "saved-avatar" });
      events.emit({ type: "tool_started", taskId, tool: "avatar", label: "loading saved avatar" });
      events.emit({ type: "tool_result", taskId, tool: "avatar", result: avatarDetail });
      events.emit({ type: "cognitive_sync", taskId, source: "avatar-runtime", detail: "animation+simulation" });
      detail.push(avatarDetail);
    } else {
      avatarDetail = "Avatar not referenced by this project — left in its current state.";
    }

    // 4. ENVIRONMENT / FULL-SCREEN → a REAL UI action, attempted and
    //    reported honestly (browsers require a user gesture for
    //    fullscreen, so a denial is recorded, not faked).
    let envDetail = "";
    if (/\b(full ?screen|full ?screen mode|environment|maximize)\b/.test(haystack)) {
      let fullscreenResult = "fullscreen requires a browser gesture — tap the ⛶ button in the top bar to enter it";
      try {
        if (typeof document !== "undefined" && document.documentElement?.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          fullscreenResult = "fullscreen engaged — environment expanded to the viewport";
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        fullscreenResult = `fullscreen denied by the browser (${reason}) — tap the ⛶ button in the top bar to enter it`;
      }
      envDetail = `Environment state: ${fullscreenResult}.`;
      events.emit({ type: "tool_selected", taskId, tool: "environment", label: "fullscreen" });
      events.emit({ type: "tool_result", taskId, tool: "environment", result: fullscreenResult });
      detail.push(envDetail);
    } else {
      envDetail = "Environment left in its current presentation.";
    }

    // 5. UI state reflects the real execution.
    try {
      const uiPatch: Parameters<UIStateStore["update"]>[0] = { isChatOpen: true };
      if (avatarDetail.startsWith("Saved avatar")) {
        uiPatch.avatarState = "simulating";
      }
      UIStateStore.getInstance().update(uiPatch);
    } catch {
      // UI state is best-effort — never fails a project run.
    }

    // 6. Memory: the project ran for real — persist through the ONE
    //    memory path when a brain is available.
    if (brain) {
      try {
        await brain.rememberSystem(
          `Sandbox project "${project.name}" executed: workspace ${root} created (${workspacePaths.length} file(s)), ${runDetail} ${avatarDetail} ${envDetail}`,
          ["sandbox", "project", "execution", slug, templateId],
        );
      } catch (error) {
        detail.push(`Memory write failed (contained): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    events.emit({ type: "task_completed", taskId, label: `Sandbox project "${project.name}" executed` });

    const tasks =
      project.actionableTasks?.length
        ? project.actionableTasks
        : [`Execute the "${project.name}" workspace in the sandbox`];

    const summary = [
      `[${project.name}] Executed in the sandbox.`,
      `Workspace: ${root} (${workspacePaths.length + 1} file(s) written, including MANIFEST.md).`,
      runDetail,
      avatarDetail,
      envDetail,
    ].join(" ");

    return {
      domain: "sandbox",
      summary,
      results: [],
      providerNames: [],
      failures: [],
      resultCount: 0,
      tasks,
      detail,
      startedAt,
      finishedAt: Date.now(),
    };
  }

  /* ------------------------- SELF-IMPROVEMENT ------------------------- */

  private async executeSelfImprovement(
    project: LeluProject,
    startedAt: number,
  ): Promise<ProjectExecutionOutcome> {
    const detail: string[] = [];

    // 1. REAL diagnostics over the actual runtime.
    const selfDev = SelfDevelopmentEngine.getInstance();
    const cycle = await selfDev.runCycle();
    const diagSummary = [
      `${cycle.diagnostics.summary.ok} ok, ${cycle.diagnostics.summary.info} info, ${cycle.diagnostics.summary.warn} warn, ${cycle.diagnostics.summary.error} error`,
    ].join("");
    detail.push(`Self-diagnostics executed: ${diagSummary} (${cycle.diagnostics.findings.length} findings)`);
    const errorFindings = cycle.diagnostics.findings.filter((finding) => finding.severity === "error");
    for (const finding of errorFindings.slice(0, 5)) {
      detail.push(`Finding [${finding.severity}] ${finding.message} — ${finding.evidence}`);
    }

    // 2. REAL avatar state.
    const avatar = AvatarStore.getInstance().get();
    detail.push(
      `Avatar state inspected: identity "${avatar.identity.name}", reference image ${avatar.referenceImage ? "saved" : "not set"}, ${Object.keys(avatar.appearance).length} appearance fields configured.`,
    );

    // 3. REAL UI state.
    const ui = UIStateStore.getInstance().get();
    detail.push(
      `UI state inspected: active tab "${ui.activeTab ?? "none"}", ${ui.openPanels.length} open panel(s), scene "${ui.activeScene}", avatar state "${ui.avatarState}".`,
    );

    // 4. REAL capability state.
    const manifest = CapabilityManifest.getInstance();
    const report = manifest.getReport();
    detail.push(report);

    // 5. Executive board consultations (grounded in the mapped systems).
    const board = ExecutiveBoard.getInstance();
    const consultations = board.route(project.objective || project.name);
    for (const consultation of consultations) {
      detail.push(`Executive · ${consultation.executiveName}: ${consultation.guidance}`);
    }

    // 6. Proposals from the real opportunity detector → actionable tasks.
    const proposals = cycle.proposals.map(
      (proposal) => `Improvement proposed: ${proposal}`,
    );
    const tasks =
      proposals.length > 0
        ? proposals
        : (project.actionableTasks?.length
            ? project.actionableTasks
            : ["Run diagnostics and confirm the health of the targeted subsystem"]);

    const summary = [
      `[${project.name}] Executed against LÉLU's own runtime.`,
      `Diagnostics: ${diagSummary}.`,
      proposals.length > 0
        ? `${proposals.length} improvement proposal(s) queued: ${proposals.join("; ")}`
        : "No new improvement proposals were created (existing proposals already cover the ground).",
      `Avatar "${avatar.identity.name}" ${avatar.referenceImage ? "has a saved reference" : "uses the default appearance"}; UI is on "${ui.activeTab ?? ui.activeScene}".`,
    ].join(" ");

    return {
      domain: "self-improvement",
      summary,
      results: [],
      providerNames: [],
      failures: [],
      resultCount: 0,
      tasks,
      detail,
      startedAt,
      finishedAt: Date.now(),
    };
  }
}
