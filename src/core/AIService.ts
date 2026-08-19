/**
 * ==========================================================
 * LÉLU
 * AI SERVICE
 *
 * Final cognition learning loop
 *
 * Connects:
 * - AI Runtime
 * - Memory
 * - User profile
 * - Genesis actions
 * - Cognition updates
 * ==========================================================
 */

import AIRuntime from "./AIRuntime";
import MemoryBridge from "./MemoryBridge";
import UserManager from "./user/UserManager";
import AgentEventBus from "./agent/AgentEvents";
import {
  registerAllNativeCapabilities,
  NativeCapabilityRegistry,
  type CapabilityStatus,
  type CapabilityResult,
} from "./native";
import type { AIRequest, AIResponse, MediaAttachment } from "../providers/AIProvider";
import type { ReasoningResult } from "./reasoning/ReasoningEngine";
import type { Plan } from "./planning/PlanningEngine";
import type { LeluAgent } from "./agents/AgentTypes";
import { agentSystemPrompt } from "./agents/AgentTypes";
import AgentStore from "./agents/AgentStore";
import AgentRunner from "./agents/AgentRunner";

export interface AIActionEvent {
  id: string;
  type: "browse" | "search" | "build" | "learn" | "create";
  label: string;
  status: "running" | "complete" | "error";
  timestamp: number;
}

export interface CognitionEvent {
  agents: unknown[];
  workspaces: unknown[];
  nodes: unknown[];
  reasoning?: ReasoningResult | null;
  plan?: Plan | null;
}

export interface AIMessageEvent {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  provider?: string;
  confidence?: number;
  reasoning?: ReasoningResult | null;
  plan?: Plan | null;
}

export default class AIService {
  private static instance: AIService | null = null;

  private readonly runtime: AIRuntime;
  private readonly user: UserManager;
  private readonly memory: MemoryBridge;

  private readonly actionListeners = new Set<(event: AIActionEvent) => void>();
  private readonly cognitionListeners = new Set<(state: CognitionEvent) => void>();
  private readonly messageListeners = new Set<(message: AIMessageEvent) => void>();
  private readonly thinkingListeners = new Set<(value: boolean) => void>();
  private readonly speakingListeners = new Set<(value: boolean) => void>();
  private readonly listeningListeners = new Set<(value: boolean) => void>();
  private readonly notificationListeners = new Set<(notification: { title: string; description?: string }) => void>();

  private initialized = false;

  /** Device/native capability registry — same singleton the ToolResolver uses. */
  private readonly native = NativeCapabilityRegistry.getInstance();

  private constructor() {
    this.runtime = new AIRuntime();
    this.user = new UserManager();
    this.memory = new MemoryBridge(this.runtime.brain, this.user);
  }

  public static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }

    return AIService.instance;
  }

  public subscribeActions(listener: (event: AIActionEvent) => void): () => void {
    this.actionListeners.add(listener);
    return () => {
      this.actionListeners.delete(listener);
    };
  }

  public subscribeCognition(listener: (state: CognitionEvent) => void): () => void {
    this.cognitionListeners.add(listener);
    return () => {
      this.cognitionListeners.delete(listener);
    };
  }

  public subscribeMessages(listener: (message: AIMessageEvent) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  public subscribeThinking(listener: (value: boolean) => void): () => void {
    this.thinkingListeners.add(listener);
    return () => {
      this.thinkingListeners.delete(listener);
    };
  }

  public subscribeSpeaking(listener: (value: boolean) => void): () => void {
    this.speakingListeners.add(listener);
    return () => {
      this.speakingListeners.delete(listener);
    };
  }

  public subscribeListening(listener: (value: boolean) => void): () => void {
    this.listeningListeners.add(listener);
    return () => {
      this.listeningListeners.delete(listener);
    };
  }

  public subscribeNotifications(listener: (notification: { title: string; description?: string }) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  private emitAction(type: AIActionEvent["type"], label: string, status: AIActionEvent["status"]): string {
    const event: AIActionEvent = {
      id: crypto.randomUUID(),
      type,
      label,
      status,
      timestamp: Date.now(),
    };

    for (const listener of this.actionListeners) {
      listener(event);
    }

    return event.id;
  }

  private emitCognition(cognition: CognitionEvent): void {
    for (const listener of this.cognitionListeners) {
      listener(cognition);
    }
  }

  private emitMessage(message: AIMessageEvent): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private emitThinking(value: boolean): void {
    for (const listener of this.thinkingListeners) {
      listener(value);
    }
  }

  private emitSpeaking(value: boolean): void {
    for (const listener of this.speakingListeners) {
      listener(value);
    }
  }

  private emitListening(value: boolean): void {
    for (const listener of this.listeningListeners) {
      listener(value);
    }
  }

  private emitNotification(notification: { title: string; description?: string }): void {
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Provider or memory initialization must never take the whole
    // application down (white-screen protection). Every subsystem is
    // initialized independently and reports failure through the
    // notification channel instead of throwing; chat then degrades
    // gracefully per-request. LÉLU's identity and profile load from
    // local persistent storage regardless of provider availability.
    try {
      await this.runtime.initialize();
    } catch (error) {
      this.emitNotification({
        title: "Lélu runtime warning",
        description: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await this.user.initialize();
    } catch (error) {
      this.emitNotification({
        title: "Lélu profile warning",
        description: error instanceof Error ? error.message : String(error),
      });
    }

    // Brain (memory + identity seed) already guards its own init;
    // re-run here so a direct AIService.initialize always seeds.
    try {
      await this.runtime.brain.initialize();
    } catch (error) {
      this.emitNotification({
        title: "Lélu memory warning",
        description: error instanceof Error ? error.message : String(error),
      });
    }

    // Device capability registry: registers every web-real capability
    // (microphone, camera, share, clipboard, storage, …). Never throws —
    // the runtime must boot even if a capability fails to register.
    try {
      registerAllNativeCapabilities();
    } catch (error) {
      this.emitNotification({
        title: "Lélu device capabilities warning",
        description: error instanceof Error ? error.message : String(error),
      });
    }

    this.initialized = true;
  }

  public async chat(
    prompt: string,
    media?: MediaAttachment[],
  ): Promise<AIResponse> {
    const message = prompt.trim();

    if (!message) {
      this.emitThinking(false);
      return {
        text: "I need something to think about.",
        provider: "brain",
        model: "empty-input",
        processingTime: 0,
        metadata: {
          intent: "idle",
          success: true,
        },
      };
    }

    if (!this.initialized) {
      await this.initialize();
    }

    this.emitThinking(true);
    this.emitSpeaking(true);
    this.emitListening(true);

    const actionId = this.emitAction("learn", `Processing ${message}`, "running");
    const agentEvents = AgentEventBus.getInstance();
    const taskId = String(Date.now());
    agentEvents.emit({ type: "task_started", taskId, label: message });

    // LÉLU as orchestrator: when the message asks a configured agent to
    // do work, delegate through the ONE runtime instead of answering
    // herself. The agent's own instructions, provider preference and
    // memory permissions apply; the result still flows through the
    // normal message + memory consolidation path below.
    const delegation = this.resolveDelegation(message);
    if (delegation) {
      try {
        const result = await AgentRunner.getInstance().run(delegation.agent.id, delegation.task);
        const response: AIResponse =
          result.ok && result.response
            ? result.response
            : {
                text: result.error ?? `${delegation.agent.name} could not complete the task.`,
                provider: "agent",
                model: "delegation",
                processingTime: 0,
                metadata: { intent: "delegation", success: false },
              };
        await this.memory.learn(message, response.text, taskId);
        await this.runtime.brain.getConversation().update(message);
        this.emitAction("learn", `${delegation.agent.name} completed`, "complete");
        agentEvents.emit({ type: "task_completed", taskId, label: `${delegation.agent.name} delegated` });
        this.emitMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          text: response.text,
          timestamp: Date.now(),
          provider: response.provider,
          confidence: response.metadata?.confidence as number | undefined,
        });
        return {
          ...response,
          metadata: { ...(response.metadata ?? {}), delegated: delegation.agent.name },
        };
      } catch (error) {
        // delegation failed at the orchestration level — fall through to
        // the normal pipeline so LÉLU answers instead of erroring out.
        console.error("[AIService] Delegation failed, answering directly", error);
      }
    }

    try {
      const request: AIRequest = {
        messages: [{ role: "user", content: message }],
        prompt: message,
        ...(media && media.length > 0 ? { media } : {}),
        timestamp: Number(taskId),
      };

      // The request is about to run the existing planning + reasoning
      // stages — announce it so the workspace can show the task forming.
      agentEvents.emit({ type: "task_planning", taskId, plan: message.slice(0, 120) });

      const enriched = await this.memory.enrich(request);
      const response = await this.runtime.process(enriched);

      const reasoning = (response.metadata?.reasoning as ReasoningResult | undefined) ?? null;
      const plan = (response.metadata?.plan as Plan | undefined) ?? null;

      this.emitAction("learn", "Response generated", "complete");
      agentEvents.emit({ type: "task_completed", taskId, label: message });
      this.emitMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        text: response.text,
        timestamp: Date.now(),
        provider: response.provider,
        confidence: response.metadata?.confidence as number | undefined,
        reasoning,
        plan,
      });

      const responseSucceeded =
        response.provider !== "offline" &&
        response.metadata?.success !== false;

      // Memory consolidation ALWAYS runs — online or offline. An API
      // failure must never equal a memory failure: meaningful user
      // statements (name, preferences, projects, goals) are extracted
      // and persisted locally even when every provider is down, and
      // the user profile updates from the same consolidation path.
      await this.memory.learn(message, response.text, taskId);
      await this.runtime.brain.getConversation().update(message);

      const memories = await this.runtime.brain.recall(message);
      for (const memory of memories) {
        await this.user.learn(memory.category, memory.response);
      }

      const cognition = this.runtime.brain.cognitiveState();
      this.emitCognition({
        agents: cognition.agents,
        workspaces: cognition.workspaces,
        nodes: cognition.nodes,
        reasoning: cognition.reasoning,
        plan: cognition.plan,
      });

      if (responseSucceeded) {
        // Fold this request's Reasoning/Planning output into the live
        // cognitive state, so it's visible beyond the single response
        // object (Genesis's Reasoning/Planning panel reads it from here).
        this.runtime.brain.recordThinking(reasoning, plan);
      }

      return {
        ...response,
        metadata: {
          ...(response.metadata ?? {}),
          action: actionId,
          cognition: true,
          memory: true,
          profile: true,
        },
      };
    } catch (error) {
      this.emitAction("learn", "Response failed", "error");
      agentEvents.emit({
        type: "task_failed",
        taskId,
        label: message,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emitNotification({
        title: "Lélu Error",
        description: error instanceof Error ? error.message : String(error),
      });

      return {
        text: error instanceof Error ? error.message : "Unknown AI error.",
        provider: "error",
        model: "error",
        processingTime: 0,
        metadata: {
          intent: "error",
          success: false,
          error: error instanceof Error ? error.message : "Unknown AI error.",
        },
      };
    } finally {
      this.emitThinking(false);
      this.emitSpeaking(false);
      this.emitListening(false);
    }
  }

  /**
   * Delegate a task to a configured agent through the ONE runtime,
   * provider chain, and memory path.
   *
   * The agent's own instructions become the system prompt; its
   * preferred + fallback providers are honored by the ProviderResolver
   * (tried first, then the normal priority chain); memory consolidation
   * respects the agent's memory permission (never forced). This is the
   * orchestration primitive LÉLU uses to hand work to specialists —
   * chat, agents, and creative tools all share the same architecture.
   */
  public async delegate(
    agent: LeluAgent,
    task: string,
    projectContext?: string,
  ): Promise<AIResponse> {
    const message = task.trim();
    const events = AgentEventBus.getInstance();
    const taskId = String(Date.now());

    if (!message) {
      return {
        text: "The task is empty — give the agent something to do.",
        provider: "brain",
        model: "empty-input",
        processingTime: 0,
        metadata: { intent: "idle", success: true },
      };
    }

    if (!this.initialized) {
      await this.initialize();
    }

    events.emit({
      type: "task_started",
      taskId,
      label: `${agent.name}: ${message.slice(0, 90)}`,
    });

    const systemContent = agentSystemPrompt(agent);
    const request: AIRequest = {
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: message },
      ],
      prompt: message,
      timestamp: Number(taskId),
      ...(projectContext && projectContext.trim().length > 0 ? { context: projectContext.trim() } : {}),
      ...(agent.provider
        ? {
            preferredProviders: [agent.provider, agent.fallbackProvider].filter(
              (name): name is string => Boolean(name),
            ),
          }
        : {}),
    };

    try {
      const response = await this.runtime.process(request);

      // Memory consolidation honors the agent's memory permission.
      // A read-only agent never writes; a read-write agent learns the
      // same way the main dialogue does (through the ONE memory path).
      if (agent.permissions.canWriteMemory && agent.memoryAccess === "read-write") {
        await this.memory.learn(message, response.text, taskId);
      }

      // LÉLU always remembers that the agent worked, so cognition can
      // reference agent activity later — without persisting agent task
      // content when the agent is read-only.
      await this.runtime.brain.rememberSystem(
        `Agent "${agent.name}" (${agent.role || "specialist"}) completed a task: ${message.slice(0, 140)}.`,
        ["agent", agent.name.toLowerCase(), "task", "delegation"],
      );

      events.emit({ type: "task_completed", taskId, label: `${agent.name} finished` });

      return response;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      events.emit({
        type: "task_failed",
        taskId,
        label: `${agent.name} failed`,
        error: messageText,
      });
      return {
        text: messageText || "Agent execution failed.",
        provider: "error",
        model: "error",
        processingTime: 0,
        metadata: { intent: "error", success: false, error: messageText },
      };
    }
  }

  /**
   * Detect "delegate X to <agent>" style requests against the real
   * configured agents. Returns the matched agent and the extracted task,
   * or null when the message is a normal conversation.
   */
  private resolveDelegation(message: string): { agent: LeluAgent; task: string } | null {
    const patterns = [
      /^delegate\s+(.+?)\s+to\s+(.+)$/i,
      /^(?:ask|have|tell)\s+(?:the\s+)?(.+?)\s+(?:to|about)\s+(.+)$/i,
      /^use\s+(.+?)\s+for\s+(.+)$/i,
      /^send\s+(.+?)\s+to\s+(.+)$/i,
    ];
    const agents = AgentStore.getInstance().runnable();
    if (agents.length === 0) {
      return null;
    }
    for (const pattern of patterns) {
      const match = message.trim().match(pattern);
      if (!match) {
        continue;
      }
      const first = match[1].trim();
      const second = match[2].trim();
      // Try [agent, task] then [task, agent] — the sentence can phrase
      // either way ("delegate X to the designer" / "have the designer to X").
      const attempts: [string, string][] = [
        [first, second],
        [second, first],
      ];
      for (const [agentPart, taskPart] of attempts) {
        const clean = agentPart.toLowerCase().replace(/^(?:the\s+)?(?:agent\s+)?/, "");
        const agent = agents.find((item) => item.name.toLowerCase() === clean);
        if (agent && taskPart.length > 0) {
          return { agent, task: taskPart };
        }
      }
    }
    return null;
  }

  /**
   * Read-only snapshot of stored long-term memories, newest
   * first, for the Memory panel. Safe to poll — it never
   * mutates state and never throws.
   */
  public async getMemories(limit = 200): Promise<
    { id: string; category: string; prompt: string; response: string; confidence: number; timestamp: number }[]
  > {
    if (!this.initialized) {
      return [];
    }

    try {
      const patterns = await this.runtime.brain.recallAll();
      return patterns
        .slice()
        .sort((a: any, b: any) => (b.updatedAt ?? b.timestamp ?? 0) - (a.updatedAt ?? a.timestamp ?? 0))
        .slice(0, limit)
        .map((pattern: any) => ({
          id: pattern.id,
          category: pattern.category ?? "general",
          prompt: pattern.prompt ?? "",
          response: pattern.response ?? "",
          confidence: pattern.confidence ?? 0,
          timestamp: pattern.updatedAt ?? pattern.timestamp ?? Date.now(),
        }));
    } catch (error) {
      console.error("[AIService] Failed to read memories", error);
      return [];
    }
  }

  /**
   * Read-only snapshot of every registered AI provider and
   * knowledge/research provider, for the Providers panel.
   */
  public getProviders(): {
    ai: ReturnType<AIRuntime["aiProviderList"]>;
    knowledge: ReturnType<AIRuntime["knowledgeProviderList"]>;
  } {
    return {
      ai: this.runtime.aiProviderList(),
      knowledge: this.runtime.knowledgeProviderList(),
    };
  }

  public async getProviderHealth() {
    return await this.runtime.aiProviderHealthList();
  }

  /**
   * Combined, read-only API Status snapshot for the API Status
   * tab: live registry runtime state (active provider, per-provider
   * last success/failure/cooldown/usage) plus each provider's own
   * health report and the knowledge/research provider list.
   * Never contains credentials — only safe status diagnostics.
   */
  public async getApiStatus(): Promise<{
    activeProvider: string | null;
    runtime: ReturnType<AIRuntime["aiProviderRuntimeStatus"]>;
    health: Awaited<ReturnType<AIRuntime["aiProviderHealthList"]>>;
    knowledge: ReturnType<AIRuntime["knowledgeProviderList"]>;
  }> {
    let health: Awaited<ReturnType<AIRuntime["aiProviderHealthList"]>> = [];
    try {
      health = await this.runtime.aiProviderHealthList();
    } catch (error) {
      console.error("[AIService] Provider health check failed", error);
    }

    const runtime = this.runtime.aiProviderRuntimeStatus();

    return {
      activeProvider: runtime.activeProvider,
      runtime,
      health,
      knowledge: this.runtime.knowledgeProviderList(),
    };
  }

  /**
   * Read-only execution trace of the request pipeline, for the
   * Logs panel — one entry per stage per request.
   */
  public getExecutionLogs() {
    return this.runtime.executionLogs();
  }

  /**
   * Read-only snapshot of every registered device/native capability
   * and its REAL availability + permission state — the Device panel
   * and LÉLU's cognition both read from this same source. Never throws.
   */
  public async nativeCapabilities(): Promise<CapabilityStatus[]> {
    try {
      registerAllNativeCapabilities();
    } catch {
      // registration already happened or is failing — snapshot below
      // still returns what it can.
    }
    try {
      return await this.native.snapshot();
    } catch (error) {
      console.error("[AIService] Capability snapshot failed", error);
      return [];
    }
  }

  /**
   * Execute a device/native capability through its REAL path
   * (availability + permission gating). Emits the same agent events
   * the workspace renders, and consolidates a durable memory of the
   * action through the EXISTING memory path. Never fakes success.
   */
  public async runCapability(
    id: string,
    payload: Record<string, unknown> = {},
  ): Promise<CapabilityResult> {
    try {
      registerAllNativeCapabilities();
    } catch {
      // ignore — invoke below reports unknown capability honestly
    }

    const events = AgentEventBus.getInstance();
    const taskId = String(Date.now());
    events.emit({ type: "tool_selected", taskId, tool: "device", label: id });
    events.emit({ type: "tool_started", taskId, tool: "device", label: id });

    const result = await this.native.invoke(id, payload);

    events.emit({
      type: "tool_result",
      taskId,
      tool: "device",
      result: result.ok ? `${id} completed` : `${id} failed: ${result.error ?? "unknown error"}`,
    });

    // Remember the outcome through the ONE memory path so future
    // cognition knows what this device can and cannot do.
    try {
      if (result.ok) {
        await this.runtime.brain.rememberSystem(
          `Device capability "${id}" executed successfully${result.error ? `: ${result.error}` : ""}.`,
          ["device", "capability", id.split(".")[0] ?? id],
        );
      } else {
        await this.runtime.brain.rememberSystem(
          `Device capability "${id}" is unavailable: ${result.error ?? "unknown reason"}.`,
          ["device", "capability", "unavailable", id.split(".")[0] ?? id],
        );
      }
    } catch {
      // memory write must never fail a capability call
    }

    return result;
  }

  public ready(): boolean {
    return this.runtime.isReady();
  }

  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.runtime.shutdown();
    this.initialized = false;
  }
}
