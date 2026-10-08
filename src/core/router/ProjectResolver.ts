/**
 * ==========================================================
 * LÉLU
 * PROJECT RESOLVER
 *
 * Routes project commands through the existing runtime.
 * Uses the SAME ProviderRegistry as the rest of the system.
 * No duplicate research or project execution systems.
 *
 * Supported commands:
 *   create — "start a project to ..."
 *   run    — "run my X project"
 *   pause  — "pause my X project"
 *   resume — "resume my X project"
 *   add    — "add X to my Y project"
 *   results — "what did my X project find"
 *   delete — "delete my X project"
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { ProviderResult } from "./RouterResults";
import ProjectStore, { type LeluProject } from "../projects/ProjectStore";
import ProjectExecutor, { type ProjectExecutionOutcome } from "../projects/ProjectExecutor";
import ProjectRequestParser from "../projects/ProjectRequestParser";
import ProjectInterpreter, {
  containsUnresolvedReference,
  type ProjectDecision,
} from "../projects/ProjectInterpreter";
import type { KnowledgeResult } from "../../providers/Provider";

export default class ProjectResolver {
  private readonly store = ProjectStore.getInstance();

  public async execute(context: RouterContext): Promise<ProviderResult> {
    const prompt = context.request.prompt ?? "";
    const text = prompt.toLowerCase();
    const intent = context.intent;
    const startedAt = context.started;

    if (intent !== "project") {
      return { handled: false };
    }

    // Sandbox execution commands that never literally say "project"
    // ("start through the sandbox…", "use the sandbox to…", "render
    // it in the sandbox…") are still project executions — create an
    // ad-hoc sandbox project and execute it immediately. This must
    // run before the create checks so the IntentDetector's sandbox
    // classification always lands on real execution, never on the
    // knowledge/search fallback.
    if (
      /\b(?:sandbox|workspace)\b/.test(text) &&
      /\b(?:start|build|create|make|execute|run|work\s+on|use|open|launch|render|simulat|animat|full\s?screen|update|upgrade|improve)\b/.test(text)
    ) {
      return this.handleCreate(context, text, prompt);
    }

    if (
      this.matchesAny(text, [
        "start a project", "create a project", "new project",
        "build a project", "make a project", "set up a project",
      ]) ||
      /^(?:please\s+)?(?:start|create|build|make|set up)\b.*\bproject\b/i.test(text)
    ) {
      return this.handleCreate(context, text, prompt);
    }

    if (this.matchesAny(text, ["run my", "run the", "run project", "execute project"]) && text.includes("project")) {
      return this.handleRun(context, text);
    }

    if (
      this.matchesAny(text, ["pause my", "pause the", "pause project", "stop my", "stop project"]) &&
      text.includes("project")
    ) {
      return this.handlePause(text, startedAt);
    }

    if (
      this.matchesAny(text, ["resume my", "resume the", "resume project"]) &&
      text.includes("project")
    ) {
      return this.handleResume(text, startedAt);
    }

    if (this.matchesAny(text, ["add to my", "add to the"]) && text.includes("project")) {
      return this.handleAdd(context, text);
    }

    if (this.matchesAny(text, ["what did my", "what did the"]) && text.includes("project")) {
      return this.handleResults(text, startedAt);
    }

    if (
      this.matchesAny(text, ["delete my", "delete the", "delete project", "remove my", "remove project"]) &&
      text.includes("project")
    ) {
      return this.handleDelete(text, startedAt);
    }

    // Everything else the detector routed here is project WORK stated
    // conversationally. It has no magic keyword to match on, so there is
    // nothing to parse — hand it to cognition, which reads the real
    // conversation and decides (including "none", which falls straight
    // back to ordinary chat).
    return this.handleCreate(context, text, prompt);
  }

  /* ---- CREATE / MODIFY ----
     Cognition interprets first. The regex parser is a FALLBACK, used
     only when no provider can be reached — never as the authority. */
  private async handleCreate(
    context: RouterContext,
    text: string,
    prompt: string,
  ): Promise<ProviderResult> {
    const decision = await new ProjectInterpreter().interpret(
      prompt,
      context.brain.getConversation().modelMessages(),
      this.store.list().filter((project) => project.status !== "archived"),
    );

    if (decision) {
      context.logger.info("ProjectResolver", "Cognitive interpretation of project request", {
        action: decision.action,
        projectId: decision.projectId,
        resolvedReferences: decision.resolvedReferences,
        reasoning: decision.reasoning,
      });

      // A reference she cannot ground is a question, not a guess. This
      // is what stops "that metal" becoming a project named
      // "...Collection in".
      if (decision.action === "clarify" && decision.question) {
        return this.respond(decision.question, context.started, {
          projectClarification: true,
          resolvedReferences: decision.resolvedReferences,
        });
      }

      // SYSTEM-SIDE GUARD. Never persist a reference that was not
      // actually resolved, whatever the model returned. "Use that metal"
      // with nothing to bind to must produce a question, not a project
      // whose material is the literal string "that metal".
      const ungrounded = this.findUnresolved(decision);
      if (ungrounded) {
        context.logger.info("ProjectResolver", "Refused to persist an unresolved reference", {
          ungrounded,
          action: decision.action,
        });
        return this.respond(
          `You said "${ungrounded}" — I don't have anything in our conversation that tells me what that refers to. What should it be?`,
          context.started,
          { projectClarification: true, unresolvedReference: ungrounded },
        );
      }

      if (decision.action === "update" && decision.projectId) {
        return this.applyUpdate(context, decision);
      }

      if (decision.action === "create") {
        return this.applyCreate(context, text, prompt, decision);
      }

      // "none" — this was not really a project instruction. Let the
      // ordinary conversational path answer it.
      return { handled: false };
    }

    // No provider reachable: fall back to the parser, and say so rather
    // than presenting a keyword fragment as understanding.
    return this.createFromParser(context, text, prompt);
  }

  /**
   * The first still-ungrounded reference in a decision, or null.
   * Checked across every field that would be written to project state.
   */
  private findUnresolved(decision: ProjectDecision): string | null {
    if (containsUnresolvedReference(decision.name)) return decision.name ?? null;
    for (const value of Object.values(decision.attributes ?? {})) {
      if (containsUnresolvedReference(value)) return value;
    }
    for (const [key, value] of Object.entries(decision.resolvedReferences ?? {})) {
      // A "resolution" that just echoes the reference resolved nothing.
      if (value.trim().toLowerCase() === key.trim().toLowerCase()) return key;
      if (containsUnresolvedReference(value)) return value;
    }
    return null;
  }

  /** Apply a model-resolved change to an EXISTING project. */
  private async applyUpdate(
    context: RouterContext,
    decision: ProjectDecision,
  ): Promise<ProviderResult> {
    const existing = this.store.get(decision.projectId as string);
    if (!existing) {
      return { handled: false };
    }

    const mergedTasks = [
      ...(existing.actionableTasks ?? []),
      ...(decision.tasks ?? []),
    ].filter((task, index, all) => all.indexOf(task) === index).slice(0, 20);

    const attributeText = decision.attributes
      ? Object.entries(decision.attributes).map(([key, value]) => `${key}: ${value}`).join("; ")
      : "";

    this.store.update(existing.id, {
      ...(decision.name ? { name: decision.name } : {}),
      ...(decision.objective ? { objective: decision.objective, description: decision.objective } : {}),
      actionableTasks: mergedTasks,
      // Resolved attributes are the project's known facts, so the next
      // turn's context carries "material: platinum" rather than "that metal".
      context: [existing.context, attributeText].filter(Boolean).join("; ").slice(0, 600),
    });

    const updated = this.store.get(existing.id) as LeluProject;
    const changes = [
      decision.name && decision.name !== existing.name ? `renamed to **${decision.name}**` : "",
      decision.objective ? "objective updated" : "",
      decision.tasks?.length ? `${decision.tasks.length} task(s) added` : "",
      attributeText ? `noted ${attributeText}` : "",
    ].filter(Boolean);

    const resolved = decision.resolvedReferences
      ? Object.entries(decision.resolvedReferences).map(([k, v]) => `"${k}" → ${v}`).join(", ")
      : "";

    // "Start working on it" must actually start work, not just record a
    // task saying so. Execution runs through the SAME ProjectExecutor
    // the explicit "run my X project" command uses, and its result is
    // persisted onto the project.
    const execution = decision.execute ? await this.runProject(context, updated) : "";

    return this.respond(
      `Updated **${updated.name}**${changes.length ? `: ${changes.join(", ")}` : ""}.` +
        (resolved ? `\n\n(Resolved ${resolved}.)` : "") +
        (mergedTasks.length ? `\n\nTasks:\n${mergedTasks.map((t) => `• ${t}`).join("\n")}` : "") +
        (execution ? `\n\nExecution:\n${execution}` : ""),
      context.started,
      {
        projectUpdate: true,
        projectId: updated.id,
        resolvedReferences: decision.resolvedReferences,
        tasks: mergedTasks,
        executed: Boolean(decision.execute),
      },
    );
  }

  /** Run a project through the existing executor and persist the result. */
  private async runProject(context: RouterContext, project: LeluProject): Promise<string> {
    try {
      const outcome = await new ProjectExecutor().execute(
        project,
        context.knowledgeProviders,
        context.brain,
      );
      this.attachRunToCognition(context, outcome, project.queries ?? [project.objective || project.name]);
      this.persistExecution(project.id, outcome);
      return outcome.summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error("ProjectResolver", "Project execution failed.", {
        project: project.name,
        reason: message,
      });
      return `Execution failed: ${message}`;
    }
  }

  /** Create a project from the model's resolved interpretation. */
  private async applyCreate(
    context: RouterContext,
    text: string,
    prompt: string,
    decision: ProjectDecision,
  ): Promise<ProviderResult> {
    const name = decision.name ?? "New project";
    const objective = decision.objective ?? prompt.trim();
    const frequency = this.extractFrequency(text);

    const project = this.store.create({ name, description: objective });
    const attributeText = decision.attributes
      ? Object.entries(decision.attributes).map(([key, value]) => `${key}: ${value}`).join("; ")
      : "";

    this.store.update(project.id, {
      queries: [objective],
      originalRequest: prompt.trim(),
      objective,
      context: attributeText,
      actionableTasks: decision.tasks ?? [],
      priority: "P1",
      location: new ProjectRequestParser().parse(prompt).location,
      executionPlan: [],
    });

    if (frequency) {
      this.store.setSchedule(project.id, frequency);
    }

    const resolved = decision.resolvedReferences
      ? Object.entries(decision.resolvedReferences).map(([k, v]) => `"${k}" → ${v}`).join(", ")
      : "";

    const created = this.store.get(project.id) as LeluProject;
    const execution = decision.execute ? await this.runProject(context, created) : "";

    return this.respond(
      `Project created: **${name}**\nObjective: ${objective}` +
        (attributeText ? `\nKnown: ${attributeText}` : "") +
        (decision.tasks?.length ? `\n\nTasks:\n${decision.tasks.map((t) => `• ${t}`).join("\n")}` : "") +
        (resolved ? `\n\n(Resolved ${resolved}.)` : "") +
        (execution ? `\n\nExecution:\n${execution}` : ""),
      context.started,
      {
        projectCreated: true,
        executed: Boolean(decision.execute),
        projectId: project.id,
        resolvedReferences: decision.resolvedReferences,
        tasks: decision.tasks ?? [],
      },
    );
  }

  /* ---- PARSER FALLBACK (no provider reachable) ---- */
  private async createFromParser(
    context: RouterContext,
    text: string,
    prompt: string,
  ): Promise<ProviderResult> {
    // Parse the FULL instruction into structured fields. The complete
    // user request is preserved verbatim — never truncated to a title.
    const parsed = new ProjectRequestParser().parse(prompt);
    const topic = parsed.objective || parsed.name;
    const frequency = this.extractFrequency(text);

    const project = this.store.create({
      name: parsed.name,
      description: parsed.objective,
    });
    this.store.update(project.id, {
      queries: [topic],
      originalRequest: parsed.originalRequest,
      objective: parsed.objective,
      context: parsed.context,
      actionableTasks: parsed.actionableTasks,
      priority: parsed.priority,
      location: parsed.location,
      executionPlan: parsed.executionPlan,
    });

    if (frequency) {
      this.store.setSchedule(project.id, frequency);
    }

    // Re-read the project so the executor classifies against the real
    // structured fields (objective/location/tasks), not the create stub.
    const executable = this.store.get(project.id) ?? project;

    // Real execution through the existing runtime: self-improvement
    // projects run diagnostics/avatar/UI/capability inspection;
    // research/knowledge projects run the connected providers.
    let runDigest = "";
    try {
      const outcome = await new ProjectExecutor().execute(executable, context.knowledgeProviders, context.brain);
      this.attachRunToCognition(context, outcome, project.queries ?? [topic]);
      this.persistExecution(project.id, outcome);
      runDigest = outcome.summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error("ProjectResolver", "Unexpected project execution failure.", {
        project: parsed.name,
        reason: message,
      });
      runDigest = `[${parsed.name}] First run failed: ${message}. The project was created and will retry on schedule.`;
    }

    const scheduleText = frequency
      ? `\nSchedule: ${frequency} (next run scheduled automatically)`
      : "";
    // Explicitly marked: this title came from text parsing, not from
    // understanding, because no provider was reachable to interpret it.
    const responseText = `Project created: **${parsed.name}**\nObjective: ${parsed.objective}${scheduleText}\n\nExecution:\n${runDigest}\n\n_(No AI provider was reachable, so this was organised by text parsing. Tell me the real title or what it refers to and I'll correct it.)_`;

    return this.respond(responseText, context.started, {
      projectExecution: true,
      projectId: project.id,
      location: parsed.location,
      priority: parsed.priority,
      tasks: parsed.actionableTasks,
    });
  }

  /* ---- RUN ---- */
  private async handleRun(
    context: RouterContext,
    text: string,
  ): Promise<ProviderResult> {
    const project = this.findProjectFromText(text);
    if (!project) {
      return this.respond(
        "I couldn't find a project matching that name. Try saying \"start a project...\" to create one.",
        context.started,
      );
    }

    let runDigest: string;
    try {
      const outcome = await new ProjectExecutor().execute(project, context.knowledgeProviders, context.brain);
      this.attachRunToCognition(context, outcome, project.queries ?? [project.objective || project.description || project.name]);
      this.persistExecution(project.id, outcome);
      runDigest = outcome.summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error("ProjectResolver", "Unexpected project run failure.", {
        project: project.name,
        reason: message,
      });
      runDigest = `[${project.name}] Run failed: ${message}`;
    }

    return this.respond(runDigest, context.started, {
      projectExecution: true,
      projectId: project.id,
    });
  }

  /** Persist real execution artifacts: run output item + tasks as items. */
  private persistExecution(projectId: string, outcome: ProjectExecutionOutcome): void {
    this.store.recordRun(projectId, outcome.summary, outcome.resultCount);

    // Attach the actionable tasks that were actually executed/derived.
    const existingTitles = new Set(
      (this.store.get(projectId)?.items ?? [])
        .filter((item) => item.kind === "task")
        .map((item) => item.title.toLowerCase()),
    );
    for (const task of outcome.tasks.slice(0, 8)) {
      if (existingTitles.has(task.toLowerCase())) continue;
      this.store.addItem(projectId, { kind: "task", title: task });
    }
  }

  /**
   * Put the real execution output into the same request context used by
   * cognition. Project commands are handled locally, so without this
   * bridge the results would only be formatted text and the cognitive
   * loop could not inspect what actually happened.
   */
  private attachRunToCognition(
    context: RouterContext,
    run: ProjectExecutionOutcome,
    queries: string[],
  ): void {
    context.researchResults = run.results;
    const resultDigest = run.results.slice(0, 6).map((result: KnowledgeResult, index: number) =>
      `${index + 1}. ${result.title}${result.content ? ` — ${result.content.slice(0, 180)}` : ""}${result.url ? ` (${result.url})` : ""}`,
    ).join("\n");
    const failures = run.failures.length > 0
      ? `\nProvider failures (fallbacks attempted): ${run.failures.map((failure) => `${failure.provider}: ${failure.error}`).join("; ")}`
      : "";
    const detail = run.detail.length > 0
      ? `\nExecution detail:\n${run.detail.slice(0, 12).map((line) => `- ${line}`).join("\n")}`
      : "";
    const tasks = run.tasks.length > 0
      ? `\nTasks:\n${run.tasks.slice(0, 8).map((task) => `- ${task}`).join("\n")}`
      : "";

    context.request.context = [
      context.request.context,
      `## PROJECT EXECUTION — ${run.finishedAt - run.startedAt}ms (${run.domain})\nQueries: ${queries.join(", ")}\nProviders with results: ${run.providerNames.join(", ") || "none"}\nResults retrieved: ${run.resultCount}\n${resultDigest || run.summary}${tasks}${detail}${failures}`,
    ].filter((value): value is string => Boolean(value && value.trim())).join("\n\n");

    context.logger.info("ProjectResolver", "Project executed and results entered cognition.", {
      domain: run.domain,
      providerNames: run.providerNames,
      resultCount: run.resultCount,
      failureCount: run.failures.length,
      taskCount: run.tasks.length,
      latencyMs: run.finishedAt - run.startedAt,
    });
  }

  /* ---- PAUSE ---- */
  private handlePause(text: string, startedAt: number): Promise<ProviderResult> {
    const project = this.findProjectFromText(text);
    if (!project) {
      return this.respond("I couldn't find a project matching that name.", startedAt);
    }
    if (project.status === "paused") {
      return this.respond(`"${project.name}" is already paused.`, startedAt);
    }
    this.store.pause(project.id);
    return this.respond(
      `Project "${project.name}" has been paused. It will no longer run on its schedule until resumed.`,
      startedAt,
    );
  }

  /* ---- RESUME ---- */
  private handleResume(text: string, startedAt: number): Promise<ProviderResult> {
    const project = this.findProjectFromText(text);
    if (!project) {
      return this.respond("I couldn't find a project matching that name.", startedAt);
    }
    if (project.status === "active") {
      return this.respond(`"${project.name}" is already active.`, startedAt);
    }
    this.store.resume(project.id);
    return this.respond(
      `Project "${project.name}" has been resumed and will run on its schedule.`,
      startedAt,
    );
  }

  /* ---- ADD ---- */
  private handleAdd(
    context: RouterContext,
    text: string,
  ): Promise<ProviderResult> {
    const project = this.findProjectFromText(text);
    if (!project) {
      return this.respond("I couldn't find a project matching that name.", context.started);
    }
    const newTopic = this.extractAfter(text, [
      "add ",
      "add to my project ",
      "add to the project ",
    ]);
    if (!newTopic) {
      return this.respond("What would you like to add to the project?", context.started);
    }
    const queries = [...(project.queries ?? []), newTopic];
    this.store.update(project.id, { queries });
    return this.respond(
      `Added "${newTopic}" to "${project.name}". The project will now track: ${queries.join(", ")}`,
      context.started,
    );
  }

  /* ---- RESULTS ---- */
  private handleResults(text: string, startedAt: number): Promise<ProviderResult> {
    const project = this.findProjectFromText(text);
    if (!project) {
      return this.respond("I couldn't find a project matching that name.", startedAt);
    }
    const latest = this.store.latestRun(project.id);
    if (!latest) {
      return this.respond(
        `"${project.name}" has no run results yet. Say "run my ${project.name} project" to execute it.`,
        startedAt,
      );
    }
    const content = [
      `## Latest results for "${project.name}"`,
      `*${latest.title}*`,
      "",
      latest.text ?? "No details recorded.",
      latest.ref ? `\nSources: ${latest.ref}` : "",
    ].join("\n");
    return this.respond(content, startedAt);
  }

  /* ---- DELETE / ARCHIVE ---- */
  private handleDelete(text: string, startedAt: number): Promise<ProviderResult> {
    const project = this.findProjectFromText(text);
    if (!project) {
      return this.respond("I couldn't find a project matching that name.", startedAt);
    }
    this.store.archive(project.id);
    return this.respond(
      `Project "${project.name}" has been archived. It will no longer appear in active projects.`,
      startedAt,
    );
  }

  /* ---- HELPERS ---- */

  private findProjectFromText(text: string): LeluProject | undefined {
    const nameMatch = text.match(
      /(?:run|pause|resume|stop|delete|archive|add|what did)\s+(?:my|the)\s+(.+?)\s+project/,
    );
    if (nameMatch?.[1]) {
      return this.store.findByName(nameMatch[1].trim());
    }
    const broad = text.match(/(?:my|the)\s+(.+?)\s+project/);
    if (broad?.[1]) {
      return this.store.findByName(broad[1].trim());
    }

    // "run project" is a useful shorthand for the most recently updated
    // active project; named commands above still take precedence.
    if (/^(?:run|execute)\s+(?:the\s+)?project\b/.test(text)) {
      return this.store.list().find((candidate) => candidate.status === "active");
    }
    return undefined;
  }

  private extractFrequency(
    text: string,
  ): "hourly" | "daily" | "weekly" | undefined {
    if (/\b(hourly|every hour|each hour)\b/.test(text)) return "hourly";
    if (/\b(daily|every day|each day|once a day)\b/.test(text)) return "daily";
    if (/\b(weekly|every week|each week)\b/.test(text)) return "weekly";
    return undefined;
  }

  private extractAfter(text: string, markers: string[]): string {
    for (const marker of markers) {
      const idx = text.indexOf(marker);
      if (idx !== -1) {
        return text.slice(idx + marker.length).trim();
      }
    }
    return "";
  }

  private matchesAny(text: string, phrases: string[]): boolean {
    return phrases.some((p) => text.includes(p));
  }

  private respond(
    text: string,
    startedAt: number,
    metadata?: Record<string, unknown>,
  ): Promise<ProviderResult> {
    return Promise.resolve({
      handled: true,
      response: {
        text,
        provider: "project",
        model: "knowledge",
        processingTime: Date.now() - startedAt,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}
