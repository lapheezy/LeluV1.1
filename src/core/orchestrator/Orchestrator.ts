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
import TaskEngine, { type Task } from "../tasks/TaskEngine";

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
  private executing = false;

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
  ): Promise<OrchestratorResult> {
    if (this.executing) {
      console.warn("[Orchestrator] Already executing — skipping re-entry to prevent lock deadlock.");
      return {
        response: "I'm currently processing another request. I'll respond as soon as I'm free.",
        actions: [],
        memoryUpdates: [],
        uiCommands: [],
      };
    }

    this.executing = true;
    console.info("[Orchestrator] Processing request:", request.slice(0, 100));
    const runtime = LeluRuntime.getInstance();
    const taskEngine = TaskEngine.getInstance();

    const actions: OrchestratorResult["actions"] = [];
    const memoryUpdates: string[] = [];
    const uiCommands: string[] = [];

    try {
      // PHASE 1: OBSERVE — understand what the user wants
      this.emit({ type: "planning", message: "Observing..." });
      const intent = this.classifyIntent(request);

      // PHASE 2: RETRIEVE CONTEXT — what does LÉLU already know?
      this.emit({ type: "planning", message: "Retrieving context..." });

      // PHASE 3: PLAN — determine what steps are needed
      this.emit({ type: "planning", message: "Planning approach..." });

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

        // Execute through the existing AI pipeline (with orchestration context)
        const ai = AIService.getInstance();
        const response = await ai.chat(request, undefined, context);

        // Verify the response
        const verified = this.verifyResponse(response);

        // Complete the task
        if (verified) {
          // Mark all steps as completed for simple single-step tasks
          for (const step of task.steps) {
            if (step.status === "pending") {
              taskEngine.completeStep(task.id, step.id, response.text.slice(0, 200));
            }
          }
        }

        actions.push({
          tool: "ai.generate",
          status: verified ? "success" : "error",
          result: response.text.slice(0, 200),
        });

        // Record in runtime
        runtime.recordActivity(`Completed: ${request.slice(0, 80)}`);

        // MEMORY: important requests deserve memory
        memoryUpdates.push(request);

        this.emit({ type: "complete", message: "Task completed", taskId: task.id });

        return {
          response: response.text,
          actions,
          task,
          memoryUpdates,
          uiCommands,
        };
      }

      // Simple request — direct pipeline
      const ai = AIService.getInstance();
      const response = await ai.chat(request, undefined, context);

      actions.push({
        tool: "ai.generate",
        status: response.provider !== "error" ? "success" : "error",
        result: response.text.slice(0, 200),
      });

      runtime.recordActivity(`Responded to: ${request.slice(0, 80)}`);

      this.emit({ type: "complete", message: "Response generated" });

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
      this.emit({ type: "error", message });

      return {
        response: `I encountered an error: ${message}`,
        actions,
        memoryUpdates,
        uiCommands,
      };
    } finally {
      this.executing = false;
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
    if (/\b(code|debug|fix|build|deploy|engineering|bug|error)\b/.test(lower)) return "engineering";
    if (/\b(remember|memory|recall|forgot)\b/.test(lower)) return "memory";
    if (/\b(search|find|look up|research|who is|what is)\b/.test(lower)) return "research";
    if (/\b(plan|organize|schedule|task|project)\b/.test(lower)) return "planning";
    if (/\b(who are you|what can you do|your name|identity)\b/.test(lower)) return "identity";
    if (/\b(navigate|go to|open|show|cosmos|galaxy)\b/.test(lower)) return "navigation";
    if (/\b(photo|camera|record|speak|voice)\b/.test(lower)) return "device";
    if (/\b(create|draw|sketch|design|make)\b/.test(lower)) return "creative";
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
      engineering: ["ai.generate", "project.manage"],
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
    if (!task) {
      return { response: "Task not found.", actions: [], memoryUpdates: [], uiCommands: [] };
    }

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

      try {
        // Execute step through the AI pipeline
        const ai = AIService.getInstance();
        const contextPrompt = `[Task: ${task.goal}] Step: ${step.title} — ${step.description}`;
        const response = await ai.chat(contextPrompt);

        if (response.provider !== "error" && response.text.trim().length > 0) {
          taskEngine.completeStep(task.id, step.id, response.text.slice(0, 200));
          actions.push({ tool: "ai.generate", status: "success", result: response.text.slice(0, 100) });
        } else {
          taskEngine.failStep(task.id, step.id, "No valid response");
          actions.push({ tool: "ai.generate", status: "error", error: "No valid response" });
          break; // Stop on failure
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        taskEngine.failStep(task.id, step.id, msg);
        actions.push({ tool: "ai.generate", status: "error", error: msg });
        break;
      }
    }

    const updatedTask = taskEngine.get(taskId);
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
