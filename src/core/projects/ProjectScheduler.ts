/**
 * ==========================================================
 * LÉLU
 * PROJECT SCHEDULER
 *
 * Autonomous scheduler that runs due projects on their
 * configured schedule. NOT a React component — runs at
 * the core level so projects execute independently of
 * the UI.
 *
 * Uses the SAME ProviderRegistry as the rest of the runtime
 * (injected via start(), not duplicated).
 * ==========================================================
 */

import type ProviderRegistry from "../ProviderRegistry";
import ProjectStore from "./ProjectStore";
import ProjectExecutor from "./ProjectExecutor";
import AgentEventBus from "../agent/AgentEvents";

const CHECK_INTERVAL_MS = 60_000; // every 60 seconds

export default class ProjectScheduler {
  private static instance: ProjectScheduler | null = null;

  private interval: ReturnType<typeof setInterval> | null = null;
  private providers: ProviderRegistry | null = null;
  private running = false;

  private constructor() {}

  public static getInstance(): ProjectScheduler {
    if (!ProjectScheduler.instance) {
      ProjectScheduler.instance = new ProjectScheduler();
    }
    return ProjectScheduler.instance;
  }

  /**
   * Start the scheduler. Accepts the same ProviderRegistry
   * the runtime already uses — no duplicate provider system.
   */
  public start(providers: ProviderRegistry): void {
    if (this.interval !== null) return; // already running

    this.providers = providers;
    this.interval = setInterval(() => this.tick(), CHECK_INTERVAL_MS);

    console.log("[Lélu ProjectScheduler] Started — checking every 60s");
  }

  public stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running || !this.providers) return;
    this.running = true;

    try {
      const store = ProjectStore.getInstance();
      const due = store.dueProjects(Date.now());

      for (const project of due) {
        try {
          await this.runProject(project);
        } catch (error) {
          console.error(
            `[ProjectScheduler] Failed to run "${project.name}":`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async runProject(
    project: import("./ProjectStore").LeluProject,
  ): Promise<void> {
    const events = AgentEventBus.getInstance();
    const store = ProjectStore.getInstance();

    events.emit({
      type: "tool_selected",
      taskId: `scheduler-${project.id}`,
      tool: "project_scheduler",
      label: `Autonomous run: "${project.name}"`,
    });

    const run = await new ProjectExecutor().execute(project, this.providers!);

    store.recordRun(project.id, run.summary, run.resultCount);

    events.emit({
      type: "tool_result",
      taskId: `scheduler-${project.id}`,
      tool: "project_scheduler",
      result: `"${project.name}" autonomous run complete (${run.domain}) — ${run.resultCount} result(s)`,
    });

    console.log(
      `[ProjectScheduler] "${project.name}" run complete (${run.domain}) — ${run.resultCount} result(s)`,
    );
  }
}
