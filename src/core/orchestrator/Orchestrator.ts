/**
 * ==========================================================
 * LÉLU ORCHESTRATOR — The agency layer
 *
 *   USER REQUEST
 *     ↓ OBSERVE
 *     ↓ UNDERSTAND
 *     ↓ RETRIEVE CONTEXT
 *     ↓ PLAN
 *     ↓ SELECT TOOLS
 *     ↓ EXECUTE
 *     ↓ OBSERVE RESULT
 *     ↓ VERIFY
 *     ↓ UPDATE MEMORY
 *     ↓ UPDATE SELF STATE
 *     ↓ UPDATE UI/COSMOS
 *     ↓ RESPOND
 *
 * Supports multi-step tasks, verification, fallback, and
 * checkpoint-based resume.
 * ==========================================================
 */

import AIService from "../AIService";
import { bindTask } from "../multichat/TurnOwnership";
import LeluRuntime from "../runtime/LeluRuntime";
import WorkspaceRuntime, { type WorkspaceOperation } from "../engineering/WorkspaceRuntime";
import TaskEngine, { type Task } from "../tasks/TaskEngine";
import AgentEventBus from "../agent/AgentEvents";
import TaskExecutor from "../agentic/TaskExecutor";
import { createTask, planTask } from "../agentic/TaskPlanner";
import ProjectStore from "../projects/ProjectStore";
import GitHubIntegration from "../engineering/GitHubIntegration";

// ---------- TYPES ----------

export interface OrchestratorContext {
  userRequest: string;
  conversationHistory: string[];
  currentLocation: { galaxy: string; system: string; interface: string };
  availableTools: string[];
  riskTolerance: number; // 0-4 max risk level for auto-execution
}

export interface OrchestratorResult {
  response: string;
  actions: Array<{
    tool: string;
    status: "success" | "error" | "skipped" | "needs-permission";
    result?: string;
    error?: string;
  }>;
  task?: Task;
  memoryUpdates: string[];
  uiCommands: string[];
}

type OrchestratorListener = (event: {
  type: "planning" | "executing" | "verifying" | "complete" | "error";
  message: string;
  taskId?: string;
}) => void;

// ---------- ORCHESTRATOR ----------

export default class Orchestrator {
  private static instance: Orchestrator | null = null;
  private listeners = new Set<OrchestratorListener>();
  /** Per-conversation serialization. Different conversations can process concurrently;
   * the same conversation serializes so its turns stay in order. */
  private readonly executingByConv = new Map<string, boolean>();

  private constructor() {}

  static getInstance(): Orchestrator {
    if (!Orchestrator.instance) {
      Orchestrator.instance = new Orchestrator();
    }
    return Orchestrator.instance;
  }

  // ---------- MAIN ENTRY POINT ----------

  async process(
    request: string,
    _conversationHistory: string[] = [],
    context?: string,
    conversationId?: string,
  ): Promise<OrchestratorResult> {
    // Serialized PER CONVERSATION, not globally. Different conversations
    // can process concurrently; within one conversation turns stay in
    // order. A canned "I'm busy" drops the message — wait instead.
    const convKey = conversationId ?? "__global__";
    if (this.executingByConv.get(convKey)) {
      const deadline = Date.now() + 30_000;
      while (this.executingByConv.get(convKey) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (this.executingByConv.get(convKey)) {
        // The previous request is wedged — release so this turn is not lost.
        console.warn("[Orchestrator] Previous request exceeded its window — taking over so the message is not lost.");
        this.executingByConv.delete(convKey);
      }
    }

    this.executingByConv.set(convKey, true);
    console.info("[Orchestrator] Processing request:", request.slice(0, 100));
    const runtime = LeluRuntime.getInstance();
    const actions: OrchestratorResult["actions"] = [];
    const memoryUpdates: string[] = [];
    const uiCommands: string[] = [];

    const events = AgentEventBus.getInstance();
    const taskId = crypto.randomUUID();
    // This request's events belong to the conversation it came from.
    if (conversationId) bindTask(taskId, conversationId);

    try {
      // PHASE 0: COMMAND RECEIVED — the canonical stream starts here,
      // before anything else, so chat shows the command immediately.
      events.emit({ type: "task_started", taskId, label: request.slice(0, 120) });
      events.emit({
        type: "execution_phase",
        taskId,
        phase: "command_received",
        label: "Command received",
        side: "both",
        detail: request.slice(0, 160),
      });

      // PHASE 1: OBSERVE — understand what the user wants
      this.emit({ type: "planning", message: "Observing..." });
      events.emit({
        type: "execution_phase",
        taskId,
        phase: "command_parsed",
        label: "Parsing request",
        side: "backend",
        detail: this.detectCategory(request.toLowerCase()),
      });
      const intent = this.classifyIntent(request);

      // PHASE 2: RETRIEVE CONTEXT — what does LÉLU already know?
      // Memory is read by the chat/planning call itself (MemoryBridge),
      // which emits its own retrieval events. Phases announcing a memory
      // read that this method never performed were removed.
      this.emit({ type: "planning", message: "Planning approach..." });
      // "Project identified" was claimed here for any planning or
      // engineering request, and nothing in this method resolves a
      // project — so the timeline announced a resolution that had not
      // happened. What DID happen is that the request was classified, so
      // that is what is reported.
      events.emit({
        type: "execution_phase",
        taskId,
        phase: "project_resolved",
        label: `Approach planned — ${intent.category}`,
        side: "backend",
        detail: `category: ${intent.category}`,
      });

      // SAFETY BOUNDARY: operations that affect external systems,
      // destructive actions, or irreversible changes surface a REAL
      // approval request through the canonical bus (the chat timeline
      // renders the Approve/Reject/Modify card). The request still
      // streams conversationally — consent is a surfaced decision, not
      // a hidden blocker.
      // Approval is per ACTION, enforced where the action runs: a plan's
      // sensitive step stops at the ApprovalGate until the user decides.
      // (A request-level approval event that nothing waited for was removed.)
      if (intent.category === "github") {
        const gh = GitHubIntegration.getInstance();
        try {
          const ghStatus = await gh.getStatus();
          if (ghStatus.configured) {
            actions.push({
              tool: "github.auth",
              status: "success",
              result: `Authenticated as ${ghStatus.user?.login ?? "unknown"}`,
            });
          } else {
            actions.push({
              tool: "github.auth",
              status: "error",
              error: ghStatus.error ?? "GitHub not configured",
            });
          }
        } catch {
          actions.push({ tool: "github.auth", status: "error", error: "GitHub probe failed" });
        }
      }

      // For simple requests, delegate to the existing chat pipeline
      // For complex multi-step requests, create a task
      const needsMultiStep = this.isMultiStepRequest(request);
      if (needsMultiStep) {
        const planned = await this.planAndExecute(request, context, taskId);
        if (planned) {
          runtime.recordActivity(`Task ${planned.task?.status ?? "run"}: ${request.slice(0, 80)}`);
          memoryUpdates.push(request);
          this.persistCheckpointFromRequest(request, planned.response, intent.category, []);
          return { ...planned, memoryUpdates, uiCommands, actions: [...actions, ...planned.actions] };
        }
        // No executable plan: answer as a normal turn. The model still has
        // the native tools there, including task.start and agent.delegate.
      }

      // Simple request — direct pipeline
      // Engineering verification uses the existing guarded workspace
      // runtime; it never pretends that an AI response executed code.
      const engineeringOperation = this.engineeringOperation(request, intent.category);
      if (engineeringOperation) {
        const workspace = WorkspaceRuntime.getInstance();
        events.emit({ type: "tool_selected", taskId, tool: "engineering", label: engineeringOperation });
        events.emit({ type: "tool_started", taskId, tool: "engineering", label: engineeringOperation });
        const result = await workspace.run(engineeringOperation);
        events.emit({
          type: "tool_result",
          taskId,
          tool: "engineering",
          result: result.ok ? `${engineeringOperation} completed` : `${engineeringOperation} failed: ${result.stderr.slice(0, 180)}`,
        });
      }

      const ai = AIService.getInstance();
      events.emit({
        type: "execution_phase",
        taskId,
        phase: "provider_connect_started",
        label: "Connecting to AI provider",
        side: "backend",
      });
      const response = await ai.chat(request, undefined, context, { conversationId });

      const ok = response.provider !== "error" && typeof response.text === "string" && response.text.length > 0;
      events.emit({
        type: "execution_phase",
        taskId,
        phase: ok ? "provider_connected" : "provider_failed",
        label: ok ? `Connected — ${response.provider}` : `Provider unavailable (${response.provider})`,
        side: "backend",
        detail: ok ? response.provider : "falling back through provider chain",
      });

      actions.push({
        tool: "ai.generate",
        status: ok ? "success" : "error",
        result: typeof response.text === "string" ? response.text.slice(0, 200) : String(response.provider),
      });

      runtime.recordActivity(`Responded to: ${request.slice(0, 80)}`);

      // MEMORY: important requests deserve memory
      memoryUpdates.push(request);

      events.emit({ type: "execution_phase", taskId, phase: "execution_completed", label: "Response ready", side: "both" });
      events.emit({ type: "task_completed", taskId, label: request.slice(0, 120) });
      this.emit({ type: "complete", message: "Response generated" });

      // CHECKPOINT: persist task state so LÉLU can resume after close/reopen
      this.persistCheckpointFromRequest(request, response.text, intent.category, []);

      return {
        response: response.text,
        actions,
        memoryUpdates,
        uiCommands,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actions.push({
        tool: "orchestrator",
        status: "error",
        error: message,
      });

      runtime.recordActivity(`Error processing: ${message}`);
      events.emit({
        type: "execution_phase",
        taskId,
        phase: "error",
        label: `Failed — ${message.slice(0, 120)}`,
        side: "backend",
        detail: message,
      });
      events.emit({ type: "task_failed", taskId, label: request.slice(0, 120), error: message });
      this.emit({ type: "error", message });

      return {
        response: `I encountered an error: ${message}`,
        actions,
        memoryUpdates,
        uiCommands,
      };
    } finally {
      this.executingByConv.delete(convKey);
    }
  }

  // ---------- INTENT CLASSIFICATION ----------

  private classifyIntent(request: string): {
    category: string;
    urgency: boolean;
    multiStep: boolean;
    needsUI: boolean;
    needsMemory: boolean;
  } {
    const lower = request.toLowerCase();

    return {
      category: this.detectCategory(lower),
      urgency: /\b(urgent|asap|now|immediately|quickly)\b/.test(lower),
      multiStep: this.isMultiStepRequest(lower),
      needsUI: /\b(open|show|navigate|go to|display|look at)\b/.test(lower),
      needsMemory: /\b(remember|recall|what do you know|forgot|memory)\b/.test(lower),
    };
  }

  private detectCategory(lower: string): string {
    if (/\b(github|repository|repo|branch|commit|pull request|merge|clone)\b/.test(lower)) return "github";
    if (/\b(code|debug|fix|build|deploy|engineering|bug|error|inspect|audit|test)\b/.test(lower)) return "engineering";
    if (/\b(remember|memory|recall|forgot)\b/.test(lower)) return "memory";
    if (/\b(search|find|look up|research|who is|what is)\b/.test(lower)) return "research";
    if (/\b(plan|organize|schedule|task|project)\b/.test(lower)) return "planning";
    if (/\b(who are you|what can you do|your name|identity)\b/.test(lower)) return "identity";
    if (/\b(navigate|go to|open|show|cosmos|galaxy)\b/.test(lower)) return "navigation";
    if (/\b(photo|camera|record|speak|voice)\b/.test(lower)) return "device";
    if (/\b(create|draw|sketch|design|make)\b/.test(lower)) return "creative";
    if (/\b(your|yourself|own|capabilities|tools|what can)\b/.test(lower) && /\b(codebase|project|architecture|system)\b/.test(lower)) return "self-inspection";
    return "chat";
  }

  private isMultiStepRequest(request: string, _intent?: { category: string }): boolean {
    const textIndicators = [
      /\b(and then|after that|next|also|while you'?re at it)\b/,
      /\b(first|second|third|finally|step \d)\b/,
      /\b(prepare|set up|get ready|organize)\b.*\b(for|to)\b/,
      /\b(analyze|review|audit|inspect|check)\b/,
    ];
    return request.length > 200 || textIndicators.some((pattern) => pattern.test(request));
  }

  private engineeringOperation(request: string, category: string): WorkspaceOperation | null {
    if (category !== "engineering") return null;
    const lower = request.toLowerCase();
    if (/\b(test|tests|testing)\b/.test(lower)) return "test";
    if (/\b(build|compile)\b/.test(lower)) return "build";
    if (/\b(inspect|audit|review|analy[sz]e)\b/.test(lower)) return "inspect";
    if (/\b(typecheck|type-check|types)\b/.test(lower)) return "typecheck";
    return null;
  }

  // ---------- AGENT DELEGATION ----------

  /**
   * Persist a project checkpoint so LÉLU can resume work after close/reopen.
   * Looks for or creates a project related to the request category.
   */
  private persistCheckpointFromRequest(
    request: string,
    responseText: string,
    category: string,
    _agentNames: string[],
  ): void {
    try {
      const projectStore = ProjectStore.getInstance();
      const projects = projectStore.list().filter((p) => p.status !== "archived");

      // Find or create a project for this category
      const categoryProjectMap: Record<string, string> = {
        research: "Research",
        engineering: "Engineering",
        creative: "Creative Work",
        planning: "Planning",
      };
      const projectName = categoryProjectMap[category] ?? "General";

      let project = projects.find((p) => p.name === projectName);
      if (!project) {
        project = projectStore.create({ name: projectName, description: `Auto-created for ${category} tasks` });
      }

      // Persist the checkpoint
      projectStore.checkpoint(project.id, {
        status: "active",
        summary: request.slice(0, 200),
        completed: [responseText.slice(0, 100)],
        pending: [],
        blockers: [],
        nextAction: null,
      });
    } catch {
      // Checkpoint persistence is best-effort — never break the orchestrator
    }
  }

  // ---------- MULTI-STEP EXECUTION ----------

  async executeTask(taskId: string): Promise<OrchestratorResult> {
    const taskEngine = TaskEngine.getInstance();
    const task = taskEngine.get(taskId);
    const events = AgentEventBus.getInstance();
    if (!task) {
      return { response: "Task not found.", actions: [], memoryUpdates: [], uiCommands: [] };
    }

    // An executable task (steps with actions) is resumed by the executor,
    // from the first step that did not finish.
    if (task.steps.some((step) => step.action)) {
      const executor = TaskExecutor.getInstance();
      const resumed = await executor.resume(taskId);
      return {
        response: resumed ? executor.report(resumed) : "Task not found.",
        actions: this.stepActions(resumed),
        ...(resumed ? { task: resumed } : {}),
        memoryUpdates: [],
        uiCommands: [],
      };
    }
    events.emit({ type: "execution_phase", taskId, phase: "backend_task_started", label: "Resuming task execution", side: "backend" });

    const actions: OrchestratorResult["actions"] = [];
    const memoryUpdates: string[] = [];
    const uiCommands: string[] = [];

    // Resume from checkpoint if available
    if (task.checkpoint) {
      LeluRuntime.getInstance().recordActivity(`Resuming task from step ${task.checkpoint.stepIndex}`);
    }

    taskEngine.start(task.id);

    // Execute each step
    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i];
      if (step.status === "completed" || step.status === "skipped") continue;

      this.emit({ type: "executing", message: `Step ${i + 1}: ${step.title}`, taskId });
      events.emit({
        type: "execution_phase",
        taskId,
        phase: "backend_task_progress",
        label: `Step ${i + 1}/${task.steps.length}: ${step.title}`,
        side: "backend",
      });

      try {
        // Execute step through the AI pipeline
        const ai = AIService.getInstance();
        const contextPrompt = `[Task: ${task.goal}] Step: ${step.title} — ${step.description}`;
        // Use taskId as the conversationId so each task gets its own
        // AbortController and serialization queue — isolating tasks from
        // user chats and from each other.
        const response = await ai.chat(contextPrompt, undefined, undefined, { conversationId: taskId });

        // THE SAME RULE AS THE PATH ABOVE: a reply is not an execution.
        //
        // This loop asked the model about each step and completed the
        // step if the answer was a non-empty string from a provider that
        // was not "error" — so every step of every multi-step task
        // completed on text alone, and TaskEngine then completed the
        // task because all its steps had. Nothing ran.
        //
        // A step is completed only by evidence: tools that really
        // executed, which the provider reports in
        // metadata.toolsExecuted after ToolDispatcher ran them. Without
        // that, the answer is recorded and the step stays pending, which
        // is the truth about it.
        const executed =
          (response.metadata?.toolsExecuted as Array<{ tool: string; ok: boolean }> | undefined) ?? [];
        const ran = executed.filter((entry) => entry.ok).map((entry) => entry.tool);
        const answered =
          response.provider !== "error" &&
          typeof response.text === "string" &&
          response.text.trim().length > 0;

        if (answered && ran.length > 0) {
          taskEngine.completeStep(
            task.id,
            step.id,
            `${response.text.slice(0, 200)}\n\n[executed: ${ran.join(", ")}]`,
          );
          actions.push({ tool: ran[0], status: "success", result: response.text.slice(0, 100) });
        } else if (answered) {
          taskEngine.recordAnswer(task.id, response.text.slice(0, 400));
          actions.push({ tool: "ai.generate", status: "success", result: response.text.slice(0, 100) });
          // Not a failure, and not progress either: the step still needs
          // doing. Stopping here rather than walking the rest of the
          // plan, because asking the model about step 3 when step 2 was
          // never carried out produces a plan about imaginary state.
          break;
        } else {
          taskEngine.failStep(task.id, step.id, "No valid response");
          actions.push({ tool: "ai.generate", status: "error", error: "No valid response" });
          break; // Stop on failure
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        taskEngine.failStep(task.id, step.id, msg);
        actions.push({ tool: "ai.generate", status: "error", error: msg });
        events.emit({ type: "execution_phase", taskId, phase: "retry", label: `Retrying after: ${msg.slice(0, 80)}`, side: "backend" });
        break;
      }
    }

    const updatedTask = taskEngine.get(taskId);
    const done = updatedTask && (updatedTask.status === "completed" || updatedTask.status === "failed");
    events.emit({
      type: "execution_phase",
      taskId,
      phase: done ? "execution_completed" : "backend_task_progress",
      label: done ? "Task execution complete" : "Task still running",
      side: "both",
    });
    if (done) {
      events.emit({ type: "task_completed", taskId, label: task.goal.slice(0, 120) });
    }
    return {
      response: updatedTask?.result ?? updatedTask?.error ?? "Task execution complete.",
      actions,
      task: updatedTask,
      memoryUpdates,
      uiCommands,
    };
  }

  // ---------- PLANNED EXECUTION ----------

  /**
   * Plan the request with the model, validate the plan against live
   * capabilities, and execute it through the TaskExecutor. Returns null
   * when no executable plan could be made, so the caller answers as a
   * normal turn instead of inventing a task.
   */
  private async planAndExecute(
    request: string,
    context: string | undefined,
    taskId: string,
  ): Promise<Pick<OrchestratorResult, "response" | "actions" | "task"> | null> {
    const events = AgentEventBus.getInstance();
    this.emit({ type: "planning", message: "Planning steps..." });
    const plan = await planTask(request, context ? { context } : {});
    if (!plan.ok || !plan.validation) {
      events.emit({
        type: "execution_phase",
        taskId,
        phase: "backend_task_progress",
        label: "No executable plan — answering directly",
        side: "backend",
        detail: plan.reason,
      });
      return null;
    }

    const task = createTask(request.slice(0, 200), plan.validation, "orchestrator");
    this.emit({ type: "executing", message: `Executing ${task.steps.length} steps`, taskId: task.id });
    const executor = TaskExecutor.getInstance();
    const finished = (await executor.run(task.id)) ?? task;
    this.emit({
      type: finished.status === "completed" ? "complete" : finished.status === "waiting" ? "executing" : "error",
      message: finished.status,
      taskId: task.id,
    });

    // The answer is the last step that produced content for the user (an
    // agent or reasoning step); the verified step report follows it.
    const answerStep = [...finished.steps]
      .reverse()
      .find((step) => step.status === "completed" && step.action && step.action.kind !== "tool");
    const report = executor.report(finished);
    const response =
      finished.status === "completed" && answerStep?.output ? `${answerStep.output}\n\n—\n${report}` : report;
    return { response, actions: this.stepActions(finished), task: finished };
  }

  /** The real per-step outcomes, in the OrchestratorResult action shape. */
  private stepActions(task: Task | undefined): OrchestratorResult["actions"] {
    if (!task) return [];
    return task.steps
      .filter((step) => step.action)
      .map((step) => ({
        tool:
          step.action!.kind === "tool" ? step.action!.tool : step.action!.kind === "agent" ? `agent:${step.action!.agent}` : "reason",
        status:
          step.status === "completed"
            ? ("success" as const)
            : step.approvalId && step.status === "pending"
              ? ("needs-permission" as const)
              : step.status === "skipped" || step.status === "pending"
                ? ("skipped" as const)
                : ("error" as const),
        ...(step.result ? { result: step.result } : {}),
        ...(step.error ? { error: step.error } : {}),
      }));
  }

  // ---------- SUBSCRIPTION ----------

  subscribe(listener: OrchestratorListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: Parameters<OrchestratorListener>[0]): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* swallow */ }
    }
  }
}
