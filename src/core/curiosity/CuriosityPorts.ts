/**
 * ==========================================================
 * LÉLU — CURIOSITY PORTS
 *
 * Every effect the Curiosity Engine has goes through exactly
 * one existing LÉLU system. There is no second tool path,
 * memory, question channel or objective store:
 *
 *   tools        ToolDispatcher.dispatchToolCall (registry →
 *                toolPermitted → AutonomyGate → authorization
 *                → real executor → AgentEventBus)
 *   memory       AIService.consolidate → Brain
 *   host         ProactiveCore.enqueueQuestion / question changes
 *   objectives   WorkQueue REVIEW (a proposal; Heru approves)
 *   personality  LeluIdentity (PersonalityGuard gates status)
 *   journal      DailyRecord
 *
 * The heavy modules (dispatcher, registry, AIService) are
 * loaded lazily in prepare() so this layer never joins a
 * load-order cycle with AIService, which imports the engine.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import WorkQueue from "../cognition/WorkQueue";
import DailyRecord, { type DailyRecordField } from "../identity/DailyRecord";
import LeluIdentity from "../identity/LeluIdentity";
import ProactiveCore, {
  type ProactiveQuestionCategory,
  type ProactiveQuestionPriority,
} from "../proactive/ProactiveCore";
import type { CatalogTool, CuriosityCategory, ObservedFailure } from "./Curiosity";

export interface DispatchResult {
  ok: boolean;
  content: string;
  data?: unknown;
}

export interface HostQuestionInput {
  key: string;
  question: string;
  category: CuriosityCategory;
  reason: string;
  tier: number;
  evidence: string;
  conversationId?: string;
  objectiveId?: string;
}

export interface HostQuestionChange {
  key: string;
  proactiveId: string;
  status: "pending" | "resolved" | "dismissed";
  lifecycleState?: string;
  response?: string;
}

export interface CuriosityPorts {
  now(): number;
  /** Load lazy dependencies. Must be awaited before catalog/permitted/dispatch. */
  prepare(): Promise<void>;
  userTurnActive(): boolean;
  catalog(): CatalogTool[];
  permitted(toolId: string): boolean;
  dispatch(toolId: string, args: Record<string, unknown>, taskId: string): Promise<DispatchResult>;
  consolidate(layer: "knowledge" | "system", summary: string, keywords: string[]): Promise<boolean>;
  hostEnabled(): boolean;
  /** Is a DIFFERENT question already waiting on Heru? */
  hostBusy(ownKey?: string): boolean;
  askHost(input: HostQuestionInput): string | null;
  onHostChange(listener: (change: HostQuestionChange) => void): () => void;
  onToolFailure(listener: (failure: ObservedFailure) => void): () => void;
  proposeObjective(title: string, detail: string): { id: string; created: boolean };
  sandboxMode(): boolean;
  traitStatus(traitId: string): string | undefined;
  addTraitEvidence(traitId: string, observation: string): void;
  stageTraitEvidence(traitId: string, observation: string, description: string): string;
  journal(field: DailyRecordField, text: string): void;
}

const CATEGORY_MAP: Record<CuriosityCategory, ProactiveQuestionCategory> = {
  self: "PERSONALITY",
  host: "GOALS",
  project: "PROJECT",
  technical: "API/TOOLING",
  world: "GOALS",
  creative: "GOALS",
  strategic: "GOALS",
  capability: "SELF_IMPROVEMENT",
};

function priorityForTier(tier: number): ProactiveQuestionPriority {
  if (tier <= 1) return "P0";
  if (tier <= 4) return "P1";
  if (tier <= 5) return "P2";
  if (tier <= 6) return "P3";
  return "P4";
}

interface Loaded {
  registry: typeof import("../tools/ToolRegistry").default;
  dispatcher: typeof import("../tools/ToolDispatcher");
  ai: typeof import("../AIService").default;
}

export function createDefaultPorts(): CuriosityPorts {
  let loaded: Loaded | null = null;

  return {
    now: () => Date.now(),

    async prepare() {
      if (loaded) return;
      const [registry, dispatcher, ai] = await Promise.all([
        import("../tools/ToolRegistry"),
        import("../tools/ToolDispatcher"),
        import("../AIService"),
      ]);
      loaded = { registry: registry.default, dispatcher, ai: ai.default };
    },

    userTurnActive: () => (loaded ? loaded.ai.getInstance().isUserTurnActive() : false),

    catalog() {
      if (!loaded) return [];
      const executable = new Set(loaded.dispatcher.executableToolIds());
      return loaded.registry.getInstance().all().map((tool) => ({
        id: tool.id,
        available: tool.available,
        riskLevel: tool.riskLevel,
        permissions: [...tool.permissions],
        executable: executable.has(tool.id),
        dependency: tool.dependency,
        executionRoute: tool.executionRoute,
      }));
    },

    permitted: (toolId) => (loaded ? loaded.dispatcher.toolPermitted(toolId) : false),

    async dispatch(toolId, args, taskId) {
      if (!loaded) return { ok: false, content: "Curiosity ports were not prepared; nothing was executed." };
      const { dispatchToolCall, toolNameForModel } = loaded.dispatcher;
      // No RouterContext: a curiosity investigation runs outside any
      // conversation turn, and the dispatcher reports honestly when a
      // tool needs one.
      return dispatchToolCall({ id: taskId, name: toolNameForModel(toolId), arguments: args }, taskId);
    },

    async consolidate(layer, summary, keywords) {
      if (!loaded) return false;
      return loaded.ai.getInstance().consolidate(layer, summary, keywords);
    },

    hostEnabled: () => ProactiveCore.getInstance().shouldAskQuestions(),

    hostBusy(ownKey) {
      const active = ProactiveCore.getInstance().getActiveQuestion();
      return Boolean(active && active.key !== ownKey);
    },

    askHost(input) {
      const question = ProactiveCore.getInstance().enqueueQuestion({
        key: input.key,
        question: input.question,
        category: CATEGORY_MAP[input.category],
        reason: input.reason,
        priority: priorityForTier(input.tier),
        conversationId: input.conversationId,
        objectiveId: input.objectiveId,
        blocksExecution: false,
        // The engine classifies and stores the answer itself — once.
        rememberAnswer: false,
        evidence: input.evidence,
      });
      return question.id;
    },

    onHostChange(listener) {
      return ProactiveCore.getInstance().subscribeQuestionChanges((question) => {
        listener({
          key: question.key,
          proactiveId: question.id,
          status: question.status,
          lifecycleState: question.lifecycle?.state,
          response: question.userResponse,
        });
      });
    },

    onToolFailure(listener) {
      return AgentEventBus.getInstance().subscribe((event) => {
        if (event.type === "tool_result" && event.status === "error") {
          listener({ tool: event.tool, taskId: event.taskId, message: event.result ?? "", at: Date.now() });
        } else if (event.type === "tool_failed") {
          listener({ tool: event.tool, taskId: event.taskId, message: event.error ?? "", at: Date.now() });
        }
      });
    },

    proposeObjective(title, detail) {
      const queue = WorkQueue.getInstance();
      const existing = queue.list().find((item) => item.status === "open" && item.title === title);
      if (existing) return { id: existing.id, created: false };
      const item = queue.add({ category: "REVIEW", title, detail, autonomy: 2 });
      return { id: item.id, created: true };
    },

    sandboxMode: () => LeluIdentity.getInstance().getState().sandboxMode,
    traitStatus: (traitId) => LeluIdentity.getInstance().getTrait(traitId)?.status,
    addTraitEvidence: (traitId, observation) => LeluIdentity.getInstance().addTraitObservation(traitId, observation, false),
    stageTraitEvidence(traitId, observation, description) {
      return LeluIdentity.getInstance().stageSandboxChange({
        kind: "trait-update",
        description,
        proposedAt: Date.now(),
        evidence: observation,
        payload: { traitId, isContrarian: false },
      });
    },

    journal: (field, text) => DailyRecord.getInstance().appendToday(field, text),
  };
}
