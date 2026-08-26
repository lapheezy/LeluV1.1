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
import ProactiveCore from "./proactive/ProactiveCore";
import PromptInjectionGuard from "./security/PromptInjectionGuard";
import ExecutiveBoard, { type BoardConsultation } from "./executive/ExecutiveBoard";
import HealthIntelligence from "./caretaker/HealthIntelligence";
import { buildCognitiveContext, formatCognitiveContext } from "./cognition/CognitiveContext";
import SupabasePersistence from "./persistence/SupabasePersistence";
import { markPerf } from "./perf/StartupTelemetry";

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
  /** Progressive assistant output during generation — same id as the final message. */
  private readonly streamListeners = new Set<(event: { id: string; text: string }) => void>();
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

  /** Live token-stream updates while LÉLU is generating. */
  public subscribeStream(listener: (event: { id: string; text: string }) => void): () => void {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
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
      try {
        listener(event);
      } catch (error) {
        console.error("[AIService] action listener threw (contained)", error);
      }
    }

    return event.id;
  }

  private emitCognition(cognition: CognitionEvent): void {
    for (const listener of this.cognitionListeners) {
      try {
        listener(cognition);
      } catch (error) {
        console.error("[AIService] cognition listener threw (contained)", error);
      }
    }
  }

  private emitMessage(message: AIMessageEvent): void {
    for (const listener of this.messageListeners) {
      try {
        listener(message);
      } catch (error) {
        console.error("[AIService] message listener threw (contained)", error);
      }
    }
  }

  private emitStream(id: string, text: string): void {
    for (const listener of this.streamListeners) {
      try {
        listener({ id, text });
      } catch (error) {
        console.error("[AIService] stream listener threw (contained)", error);
      }
    }
  }

  private emitThinking(value: boolean): void {
    for (const listener of this.thinkingListeners) {
      try {
        listener(value);
      } catch (error) {
        console.error("[AIService] thinking listener threw (contained)", error);
      }
    }
  }

  private emitSpeaking(value: boolean): void {
    for (const listener of this.speakingListeners) {
      try {
        listener(value);
      } catch (error) {
        console.error("[AIService] speaking listener threw (contained)", error);
      }
    }
  }

  private emitListening(value: boolean): void {
    for (const listener of this.listeningListeners) {
      try {
        listener(value);
      } catch (error) {
        console.error("[AIService] listening listener threw (contained)", error);
      }
    }
  }

  private emitNotification(notification: { title: string; description?: string }): void {
    for (const listener of this.notificationListeners) {
      try {
        listener(notification);
      } catch (error) {
        console.error("[AIService] notification listener threw (contained)", error);
      }
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Provider or memory initialization must never take the whole
    // application down (white-screen protection). The three INDEPENDENT
    // core subsystems now initialize in PARALLEL — none of them needs
    // another's result — so first-message latency drops to the slowest,
    // not the sum. Failures report through the notification channel
    // instead of throwing; chat degrades gracefully per-request.
    const [runtimeResult, userResult, brainResult] = await Promise.allSettled([
      this.runtime.initialize(),
      this.user.initialize(),
      // Brain (memory + identity seed) guards its own init; re-run so a
      // direct AIService.initialize always seeds.
      this.runtime.brain.initialize(),
    ]);

    if (runtimeResult.status === "rejected") {
      this.emitNotification({
        title: "Lélu runtime warning",
        description:
          runtimeResult.reason instanceof Error
            ? runtimeResult.reason.message
            : String(runtimeResult.reason),
      });
    }
    if (userResult.status === "rejected") {
      this.emitNotification({
        title: "Lélu profile warning",
        description:
          userResult.reason instanceof Error
            ? userResult.reason.message
            : String(userResult.reason),
      });
    }
    if (brainResult.status === "rejected") {
      this.emitNotification({
        title: "Lélu memory warning",
        description:
          brainResult.reason instanceof Error
            ? brainResult.reason.message
            : String(brainResult.reason),
      });
    }

    // Supabase is an OPTIONAL persistence/realtime layer beneath the
    // existing local-first stores. It must never delay chat readiness:
    // auth, hydration, and sync run in the BACKGROUND, failures are
    // contained, and cognition remains fully usable offline.
    void (async () => {
      try {
        const persistence = SupabasePersistence.getInstance();
        await persistence.initialize(this.runtime.brain, this.user);
        if (persistence.isConnected()) {
          persistence.attachRuntime();
          const health = await this.getProviderHealth();
          void persistence.persistApiHealth(health as Array<Record<string, unknown>>);
        }
      } catch (error) {
        console.warn("[AIService] Supabase persistence initialization degraded", error);
      }
    })();

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

    // Real measurement: chat's cognition/provider/memory stack is usable.
    markPerf("PROVIDER_READY");
  }

  public async chat(
    prompt: string,
    media?: MediaAttachment[],
    context?: string,
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

    const taskId = String(Date.now());

    // Feed the proactive layer on every genuine user message: session
    // continuity, pattern learning, and interruption detection. This is
    // the ONE interaction path — no second brain or memory is involved.
    const proactive = ProactiveCore.getInstance();
    try {
      proactive.recordInteraction(message);
    } catch (error) {
      console.error("[AIService] Proactive record failed (contained)", error);
    }

    // Resolve one live proactive question before routing the turn. This is
    // deliberately narrow: direct preference/decision language resolves a
    // pending question, while a new question or command remains independent.
    const pendingQuestion = proactive.getActiveQuestion();
    if (pendingQuestion && this.looksLikeProactiveAnswer(message, pendingQuestion.question)) {
      proactive.resolveQuestion(pendingQuestion.id, message);
      if (pendingQuestion.category === "NEWS") {
        proactive.learnNewsPreferences(message);
        void SupabasePersistence.getInstance().persistNewsPreferences(proactive.getNewsPreferences());
      }
      if (pendingQuestion.rememberAnswer) {
        try {
          await this.memory.learn(
            `Proactive question: ${pendingQuestion.question}`,
            `User answer: ${message}`,
            taskId,
          );
        } catch (error) {
          console.error("[AIService] Proactive answer learning failed (contained)", error);
        }
      }
    }

    // Defensive boundary (M.S. Ma'at): the user's own text is treated as
    // data too. Detect instruction-override attempts so LÉLU never silently
    // accepts "ignore your instructions" content, and redact secrets before
    // they can leak into logs/notifications. This never blocks conversation.
    const injection = PromptInjectionGuard.getInstance().analyze(message);
    if (injection.isInstructionOverride) {
      console.warn("[AIService] instruction-override pattern detected (contained)", injection.patterns);
    }

    const actionId = this.emitAction("learn", `Processing ${message}`, "running");
    const agentEvents = AgentEventBus.getInstance();
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
      // Executive consultation: when the user addresses one of the five
      // executives (M.S. Ma'at / Architect / Engineering / Agent Forge),
      // fold that executive's real guidance into the request context.
      const boardContext = this.resolveExecutiveConsult(message);
      const caretakerContext = this.resolveCaretakerConsult(message);

      // Inject the live cognitive context so LÉLU's model actually
      // "sees" her runtime state (self-model, projects, agents,
      // capabilities, UI) as part of the conversation context.
      let cognitiveContextText = "";
      try {
        const snapshot = buildCognitiveContext();
        cognitiveContextText = formatCognitiveContext(snapshot);
      } catch (error) {
        console.error("[AIService] Cognitive context build failed (contained)", error);
      }

      const effectiveContext = [context?.trim(), cognitiveContextText, boardContext, caretakerContext]
        .filter((part): part is string => Boolean(part && part.length > 0))
        .join("\n\n");

      const streamId = crypto.randomUUID();

      const request: AIRequest = {
        messages: [{ role: "user", content: message }],
        prompt: message,
        ...(effectiveContext ? { context: effectiveContext } : {}),
        ...(media && media.length > 0 ? { media } : {}),
        timestamp: Number(taskId),
        // True streaming: the provider pushes accumulated text as it
        // arrives and the UI renders it in place under `streamId`.
        onDelta: (text) => this.emitStream(streamId, text),
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
        id: streamId,
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
      const errorText = PromptInjectionGuard.getInstance().redactSecrets(
        error instanceof Error ? error.message : String(error),
      );

      this.emitNotification({
        title: "Lélu Error",
        description: errorText,
      });

      return {
        text: errorText || "Unknown AI error.",
        provider: "error",
        model: "error",
        processingTime: 0,
        metadata: {
          intent: "error",
          success: false,
          error: errorText || "Unknown AI error.",
        },
      };
    } finally {
      this.emitThinking(false);
      this.emitSpeaking(false);
      this.emitListening(false);
    }
  }

  /**
   * Keep proactive answers on the ordinary chat path without stealing new
   * questions, commands, or unrelated requests from the user.
   */
  private looksLikeProactiveAnswer(message: string, questionText: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (normalized.length < 2 || normalized.endsWith("?")) {
      return false;
    }
    if (/^(what|why|how|when|where|who|can you|could you|would you|please|search|find|show|tell me|run|start|create|build|fix|pause|resume|stop)\b/.test(normalized)) {
      return false;
    }
    if (/\b(i want|i prefer|i like|i love|focus on|prioritize|track|watch|work on|remember|do not|don't|yes|no|the priority|use)\b/.test(normalized)) {
      return true;
    }
    // Short topic lists are common answers to the news-preference prompt.
    if (/\b(news|technology|tech|ai|science|markets|politics|gaming|local|business|world)\b/.test(normalized) && normalized.length < 180) {
      return true;
    }
    // A pending blocking decision accepts a concise directive even when it
    // does not use a first-person phrase.
    return questionText.length > 0 && normalized.length < 240 && !/[.!?]$/.test(normalized);
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
      ...(() => {
        const parts: string[] = [];
        if (projectContext?.trim()) parts.push(projectContext.trim());
        try {
          parts.push(formatCognitiveContext(buildCognitiveContext()));
        } catch { /* contained */ }
        return parts.length > 0 ? { context: parts.join("\n\n") } : {};
      })(),
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
   * Consult the Executive Board when the user addresses an executive.
   * Returns the executive's grounded guidance as a context string, or
   * an empty string for ordinary conversation. No second brain — the
   * board maps directly to the existing runtime systems.
   */
  private resolveExecutiveConsult(message: string): string {
    const lower = message.toLowerCase();
    const board = ExecutiveBoard.getInstance();

    if (/\b(ma.?at|sentinel|security|protect|vulnerab|permission)\b/.test(lower)) {
      return this.formatConsult(board.consult("maat", message));
    }
    if (/\b(architect|architecture|dependency|coherence)\b/.test(lower)) {
      return this.formatConsult(board.consult("architect", message));
    }
    if (
      /\b(engineering|engineer|build|implement|integration|deploy)\b/.test(lower) &&
      /\b(system|architecture|api|infrastructure|pipeline|workspace)\b/.test(lower)
    ) {
      return this.formatConsult(board.consult("engineering", message));
    }
    if (/\b(agent forge|forge|create an? agent|new agent|specialist|swarm)\b/.test(lower)) {
      return this.formatConsult(board.consult("forge", message));
    }
    return "";
  }

  private formatConsult(consultation: BoardConsultation): string {
    return `[${consultation.executiveName} engaged — autonomy L${consultation.securityLevel}] ${consultation.guidance}`;
  }

  /**
   * Engage Caretaker's health/bioengineering intelligence when a request
   * is health- or biology-related. Adds evidence grading, safety framing,
   * the bioengineering workflow and biosecurity redirects as context —
   * never a second brain, never a clinical claim.
   */
  private resolveCaretakerConsult(message: string): string {
    const health = HealthIntelligence.getInstance();
    const consultation = health.consult(message);
    const hasHealthData = health.assessHealthData(message).isHealthData;
    const engaged = consultation.domain !== "general" || hasHealthData;
    if (!engaged) {
      return "";
    }

    const parts = [
      `[Caretaker — ${consultation.domainLabel} · evidence grade: ${consultation.evidenceGrade}]`,
      consultation.framing,
    ];
    if (consultation.workflow) {
      parts.push(`Workflow: ${consultation.workflow.join(" → ")}`);
    }
    if (consultation.safetyNote) {
      parts.push(`⚠ ${consultation.safetyNote}`);
    }
    return parts.join("\n");
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
   * Expose the knowledge-provider registry so cognition and the
   * cognitive loop can invoke providers directly (research, health
   * checks, capability validation). The SAME registry the chat
   * pipeline uses — no duplicate provider system.
   */
  public getKnowledgeProviderRegistry(): import("./ProviderRegistry").default {
    return this.runtime.core.getKnowledgeProviders();
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
   * Local-first model/hardware routing snapshot (hardware tier,
   * offline mode, model catalog, degraded state) for the Settings
   * panel. Never contains credentials.
   */
  public modelSystemStatus() {
    return this.runtime.modelSystemStatus();
  }

  /** Persist and apply the explicit LOCAL / OFFLINE mode switch. */
  public setOfflineMode(enabled: boolean): void {
    this.runtime.setOfflineMode(enabled);
  }

  public isOfflineMode(): boolean {
    return this.runtime.isOfflineMode();
  }

  /**
   * Full live local runtime status — hardware, backends, all 13
   * capabilities, job queue, and offline mode — probed from the
   * actual companion runtimes. Same source the settings panel
   * renders; never fakes availability.
   */
  public async localRuntimeStatus() {
    return await this.runtime.localRuntimeStatus();
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
