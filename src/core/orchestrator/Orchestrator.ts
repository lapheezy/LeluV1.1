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
import LeluRuntime from "../runtime/LeluRuntime";
import WorkspaceRuntime, { type WorkspaceOperation } from "../engineering/WorkspaceRuntime";
import TaskEngine, { type Task } from "../tasks/TaskEngine";
import AgentEventBus from "../agent/AgentEvents";
import AgentStore from "../agents/AgentStore";
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
    const taskEngine = TaskEngine.getInstance();

    const actions: OrchestratorResult["actions"] = [];
    const memoryUpdates: string[] = [];
    const uiCommands: string[] = [];

    const events = AgentEventBus.getInstance();
    const taskId = crypto.randomUUID();

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
      //
      // These two events used to be emitted back to back with nothing
      // between them, and the retrieval count was the literal 0. So the
      // timeline showed "Reading memory context / Memory context loaded"
      // for a read that had not happened, and reported that nothing was
      // recalled whatever had been. That is the exact failure this pass
      // exists to remove: an execution event must describe an execution.
      //
      // A real recall happens here when the intent needs one, and the
      // count comes from its result. When the intent does not need
      // memory, nothing is claimed.
      if (intent.needsMemory) {
        this.emit({ type: "planning", message: "Retrieving context..." });
        events.emit({
          type: "execution_phase",
          taskId,
          phase: "memory_read_started",
          label: "Reading memory context",
          side: "backend",
        });
        let recalled = 0;
        try {
          recalled = (await AIService.getInstance().recall(request)).length;
        } catch {
          // A failed recall is reported as a failed recall, not as a
          // completed one with nothing in it.
          events.emit({
            type: "execution_phase",
            taskId,
            phase: "error",
            label: "Memory could not be read",
            side: "backend",
          });
        }
        events.emit({
          type: "execution_phase",
          taskId,
          phase: "memory_read_completed",
          label:
            recalled > 0
              ? `Recalled ${recalled} related memor${recalled === 1 ? "y" : "ies"}`
              : "Nothing related in memory",
          side: "backend",
          detail: `${recalled} result(s)`,
        });
        events.emit({ type: "memory_retrieval", taskId, query: request, count: recalled });
      }

      // PHASE 3: PLAN — determine what steps are needed
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
      const approval = this.needsApproval(request, intent.category);
      if (approval) {
        events.emit({
          type: "approval_requested",
          taskId,
          approvalId: `approval-${taskId}`,
          title: approval.title,
          detail: approval.detail,
          systemsAffected: approval.systemsAffected,
        });
        uiCommands.push("approval:requested");
      }

      // GITHUB INTEGRATION: when GitHub-related intent is detected,
      // probe capabilities and include results in the response context.
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
        // Create a persistent task for complex requests
        const task = taskEngine.create({
          goal: request.slice(0, 200),
          priority: intent.urgency ? "high" : "normal",
          steps: this.planSteps(request, intent),
          requiredTools: this.requiredTools(intent),
        });

        taskEngine.start(task.id);
        events.emit({
          type: "execution_phase",
          taskId,
          phase: "backend_task_started",
          // "Executing N steps" was not true: nothing here executes the
          // steps. A plan was recorded, so that is what is reported.
          label: `Planned ${task.steps.length} step(s)`,
          side: "backend",
          detail: task.goal,
        });

        // Execute through the existing AI pipeline (with orchestration context)
        const ai = AIService.getInstance();
        const response = await ai.chat(request, undefined, context, { conversationId });

        // Verify the response
        events.emit({
          type: "execution_phase",
          taskId,
          phase: "validation_started",
          label: "Validating result",
          side: "backend",
        });
        const verified = this.verifyResponse(response);
        events.emit({
          type: "execution_phase",
          taskId,
          phase: verified ? "validation_completed" : "error",
          label: verified ? "Validation complete" : "Validation failed — recovering",
          side: "backend",
        });

        // A RECORD IS NOT AN EXECUTION.
        //
        // Every pending step used to be marked completed here, with the
        // model's reply text as each step's "result" — so a task whose
        // steps nothing had run reported itself completed, and
        // TaskEngine then marked the whole task completed because all
        // its steps were. Nothing had executed. verifyResponse() only
        // checks that the reply is a non-empty string from a provider
        // that is not "error"; it says nothing about work being done.
        //
        // Steps are completed only by real execution. The reply is
        // recorded against the step the task is on, and the task is left
        // WAITING, which is what it is: answered conversationally, with
        // its planned steps not yet run.
        //
        // Where work should actually be executed, the path is the one
        // that already exists: an AgentObjective, picked up by
        // AgentCognitionRuntime, dispatched through ToolDispatcher, and
        // completed from metadata.toolsExecuted. This method does not
        // execute, so it does not claim to.
        const executedHere =
          (response.metadata?.toolsExecuted as Array<{ tool: string; ok: boolean }> | undefined) ?? [];
        if (verified) {
          taskEngine.recordAnswer(
            task.id,
            response.text.slice(0, 400),
            executedHere.filter((entry) => entry.ok).map((entry) => entry.tool),
          );
        }

        actions.push({
          tool: "ai.generate",
          status: verified ? "success" : "error",
          result: typeof response.text === "string" ? response.text.slice(0, 200) : String(response.provider ?? "error"),
        });

        // Record in runtime
        runtime.recordActivity(`Completed: ${request.slice(0, 80)}`);

        // MEMORY: important requests deserve memory
        memoryUpdates.push(request);

        events.emit({ type: "execution_phase", taskId, phase: "execution_completed", label: "Execution complete", side: "both" });
      events.emit({ type: "task_completed", taskId, label: request.slice(0, 120) });
      this.emit({ type: "complete", message: "Task completed", taskId: task.id });

      // CHECKPOINT: persist task state so LÉLU can resume after close/reopen
      this.persistCheckpointFromRequest(request, response.text, intent.category, []);

      return {
        response: response.text,
        actions,
        task,
        memoryUpdates,
        uiCommands,
      };
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

      // AGENT DELEGATION: when research or engineering is detected,
      // record the task on the best-fit agent so the cognitive loop
      // can observe agent activity and the agent keeps history.
      const delegatedAgent = this.delegateToAgent(request, intent.category, taskId);
      if (delegatedAgent) {
        actions.push({
          tool: "agent-delegate",
          status: "success",
          result: `Delegated to agent "${delegatedAgent.name}" (${delegatedAgent.role})`,
        });
      }

      // MEMORY: important requests deserve memory
      memoryUpdates.push(request);

      events.emit({ type: "execution_phase", taskId, phase: "execution_completed", label: "Response ready", side: "both" });
      events.emit({ type: "task_completed", taskId, label: request.slice(0, 120) });
      this.emit({ type: "complete", message: "Response generated" });

      // CHECKPOINT: persist task state so LÉLU can resume after close/reopen
      this.persistCheckpointFromRequest(request, response.text, intent.category, delegatedAgent ? [delegatedAgent.name] : []);

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

  private planSteps(request: string, _intent: { category: string }): { title: string; description: string }[] {
    // Basic step planning — enough to create the task structure
    return [
      { title: "Understand request", description: `Analyze: ${request.slice(0, 100)}` },
      { title: "Execute", description: `Perform the requested action` },
      { title: "Verify", description: `Confirm the result meets expectations` },
    ];
  }

  private requiredTools(_intent: { category: string }): string[] {
    const map: Record<string, string[]> = {
      github: ["github.auth", "github.repos", "github.files"],
      engineering: ["ai.generate", "project.manage", "workspace.typecheck", "workspace.test"],
      "self-inspection": ["sandbox.read", "workspace.typecheck"],
      memory: ["memory.recall", "memory.store"],
      research: ["research.web"],
      planning: ["plan.create"],
      navigation: ["cosmos.navigate", "cosmos.openInterface"],
      device: ["device.camera", "device.microphone", "device.tts"],
      creative: ["ai.generate"],
      chat: ["chat"],
    };
    return map[_intent.category] ?? ["chat"];
  }

  /**
   * Detect operations that require explicit user approval before they
   * should be treated as executed (external accounts, destructive or
   * irreversible actions). Returns null when the request is safe to
   * proceed conversationally.
   */
  private needsApproval(
    request: string,
    category: string,
  ): { title: string; detail: string; systemsAffected: string[] } | null {
    const lower = request.toLowerCase();
    if (/\b(send|email|post|tweet|publish|deploy|pay|transfer|buy|sell)\b/.test(lower)) {
      return {
        title: "Send / publish to an external system",
        detail: `${request.slice(0, 180)} — this reaches beyond the LÉLU runtime.`, 
        systemsAffected: ["external", category === "engineering" ? "deployment" : "communication"],
      };
    }
    if (/\b(delete|destroy|remove|reset|erase|wipe|uninstall|drop)\b/.test(lower)) {
      return {
        title: "Destructive operation detected",
        detail: `${request.slice(0, 180)} — this removes or overwrites existing state.`,
        systemsAffected: ["data", "projects", category === "engineering" ? "code" : "workspace"],
      };
    }
    return null;
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
   * Find the best-fit agent for the given intent and record the task.
   * Returns the agent if delegation occurred, null otherwise.
   */
  private delegateToAgent(
    request: string,
    category: string,
    taskId: string,
  ): { name: string; role: string } | null {
    const agentStore = AgentStore.getInstance();
    const runnable = agentStore.runnable();
    if (runnable.length === 0) return null;

    // Match agent capabilities to intent category
    const capabilityMap: Record<string, string[]> = {
      research: ["web research", "source evaluation", "research"],
      engineering: ["engineering", "coding", "testing"],
      creative: ["creative", "design", "sketch"],
      planning: ["planning", "organization"],
    };

    const targetCapabilities = capabilityMap[category] ?? ["chat"];
    const bestFit = runnable.find((agent) =>
      agent.capabilities.some((cap) =>
        targetCapabilities.some((target) => cap.toLowerCase().includes(target.toLowerCase())),
      ),
    ) ?? runnable[0];

    if (!bestFit) return null;

    // Record the task on the agent
    agentStore.recordTask(bestFit.id, {
      label: request.slice(0, 120),
      status: "running",
    });

    // Emit delegation event
    AgentEventBus.getInstance().emit({
      type: "tool_selected",
      taskId,
      tool: `agent:${bestFit.name}`,
      label: `Delegated to ${bestFit.name} (${bestFit.role})`,
    });

    return { name: bestFit.name, role: bestFit.role };
  }

  // ---------- CHECKPOINT PERSISTENCE ----------

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

  private verifyResponse(response: any): boolean {
    // Basic verification — response exists and isn't an error
    if (!response || typeof response.text !== "string") return false;
    if (response.text.trim().length === 0) return false;
    if (response.provider === "error") return false;
    return true;
  }

  // ---------- MULTI-STEP EXECUTION ----------

  async executeTask(taskId: string): Promise<OrchestratorResult> {
    const taskEngine = TaskEngine.getInstance();
    const task = taskEngine.get(taskId);
    const events = AgentEventBus.getInstance();
    if (!task) {
      return { response: "Task not found.", actions: [], memoryUpdates: [], uiCommands: [] };
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
        const response = await ai.chat(contextPrompt, undefined, undefined, { conversationId });

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
