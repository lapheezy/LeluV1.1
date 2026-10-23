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
 *   personality  DailyRecord evidence → DailyReflection → LeluIdentity
 *                (PersonalityGuard gates status); staged proposals
 *                go to LeluIdentity's sandbox queue
 *   journal      DailyRecord
 *   self-model   SelfModel (limitations / discoveries)
 *   environment  SourceAccess + ToolRegistry.refreshAvailability
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
import SelfModel from "../cognition/SelfModel";
import type { CatalogTool, CuriosityCategory, ObservedFailure, TraitTendency } from "./Curiosity";

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
  /**
   * Record ONE unit of developmental evidence. By default it goes into the
   * day's record for DailyReflection, which is what turns evidence into a
   * trait change under PersonalityGuard — never straight into identity.
   */
  addTraitEvidence(traitId: string, observation: string, unitId?: string): void;
  stageTraitEvidence(traitId: string, observation: string, description: string): string;
  journal(field: DailyRecordField, text: string): void;
  /** Re-probe the environment the registry's availability is computed from (one bounded probe). */
  refreshCapabilities?(): Promise<void>;
  toolParameters?(toolId: string): { required: string[]; properties: string[] } | undefined;
  onToolSuccess?(listener: (success: { tool: string; taskId: string; at: number }) => void): () => void;
  traitTendencies?(): TraitTendency[];
  syncSelfModel?(limitations: string[], discoveries: string[]): void;
  /**
   * One bounded call through the EXISTING provider chain (AIService.reason).
   * Null when no provider answered. The engine treats the reply as a
   * proposal and validates it against the evidence before using it.
   */
  reason?(prompt: string, system: string): Promise<string | null>;
  /** Hash of the tool's executor code and implementation file, from the live tree or the build snapshot. */
  sourceFingerprint?(tool: string, executionRoute?: string): Promise<string | undefined>;
}

/** FNV-1a, 32-bit — a change detector, not a security hash. */
export function fingerprintText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The block of ToolDispatcher.ts that implements one tool — so an edit to ANOTHER tool is not a change to this one. */
export function executorBlock(dispatcherSource: string, tool: string): string | null {
  const start = dispatcherSource.indexOf(`id: "${tool}"`);
  if (start < 0) return null;
  const next = dispatcherSource.indexOf('\n  {\n    id: "', start + 1);
  const end = next > 0 ? next : dispatcherSource.indexOf("\n];", start);
  return dispatcherSource.slice(start, end > 0 ? end : undefined);
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
  source: typeof import("../selfdev/SourceAccess").default;
}

/** Curiosity-owned self-model lines carry this prefix so each sync replaces only its own. */
export const SELF_MODEL_PREFIX = "Tool ";

const sourcePathCache = new Map<string, string | null>();

/** Find `<Class>.ts` in the snapshot, else in the live tree (one directory listing per folder, cached). */
async function resolveSourcePath(access: import("../selfdev/SourceAccess").default, className: string): Promise<string | null> {
  if (sourcePathCache.has(className)) return sourcePathCache.get(className) ?? null;
  const file = `${className}.ts`;
  let found = access.snapshotPaths().find((path) => path.endsWith(`/${file}`)) ?? null;
  if (!found) {
    for (const root of ["src/core", "src/brain", "src/providers"]) {
      const top = await access.list(root).catch(() => null);
      const entries = top?.entries ?? [];
      const direct = entries.find((entry) => entry.type === "file" && entry.name === file);
      if (direct) {
        found = direct.path;
        break;
      }
      for (const dir of entries.filter((entry) => entry.type === "dir")) {
        const inner = await access.list(dir.path).catch(() => null);
        const hit = inner?.entries?.find((entry) => entry.type === "file" && entry.name === file);
        if (hit) {
          found = hit.path;
          break;
        }
      }
      if (found) break;
    }
  }
  sourcePathCache.set(className, found ? found.replace(/^\/+/, "") : null);
  return sourcePathCache.get(className) ?? null;
}

export function createDefaultPorts(): CuriosityPorts {
  let loaded: Loaded | null = null;

  return {
    now: () => Date.now(),

    async prepare() {
      if (loaded) return;
      const [registry, dispatcher, ai, source] = await Promise.all([
        import("../tools/ToolRegistry"),
        import("../tools/ToolDispatcher"),
        import("../AIService"),
        import("../selfdev/SourceAccess"),
      ]);
      loaded = { registry: registry.default, dispatcher, ai: ai.default, source: source.default };
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
        category: tool.category,
        description: tool.description,
      }));
    },

    permitted: (toolId) => (loaded ? loaded.dispatcher.toolPermitted(toolId) : false),

    async dispatch(toolId, args, taskId) {
      if (!loaded) return { ok: false, content: "Curiosity ports were not prepared; nothing was executed." };
      const { dispatchToolCall, toolNameForModel } = loaded.dispatcher;
      // No RouterContext: a curiosity investigation runs outside any
      // conversation turn, and the dispatcher reports honestly when a
      // tool needs one.
      // The runtime's OWN router context (real brain, providers, logger),
      // so a tool that needs one — research — works outside a turn exactly
      // as it does inside one.
      const prompt = String(args.query ?? args.prompt ?? args.path ?? toolId);
      const context = loaded.ai.getInstance().toolContext(prompt) ?? undefined;
      return dispatchToolCall({ id: taskId, name: toolNameForModel(toolId), arguments: args }, taskId, context);
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
    addTraitEvidence: (traitId, observation, unitId) => {
      DailyRecord.getInstance().recordEvidence({ traitId, unitId: unitId ?? observation, source: "curiosity", observation, at: Date.now() });
    },
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

    async refreshCapabilities() {
      if (!loaded) return;
      // Forced: a failed probe is cached for a minute, and the point of this
      // call is to see whether the environment has changed since.
      await loaded.source.getInstance().status(true).catch(() => undefined);
      await loaded.registry.getInstance().refreshAvailability();
    },

    toolParameters(toolId) {
      if (!loaded) return undefined;
      const schema = loaded.dispatcher.executorParameters(toolId) as { required?: string[]; properties?: Record<string, unknown> } | undefined;
      if (!schema) return undefined;
      return { required: [...(schema.required ?? [])], properties: Object.keys(schema.properties ?? {}) };
    },

    onToolSuccess(listener) {
      return AgentEventBus.getInstance().subscribe((event) => {
        if (event.type === "tool_result" && (event.status === "complete" || event.status === undefined)) {
          listener({ tool: event.tool, taskId: event.taskId, at: Date.now() });
        }
      });
    },

    traitTendencies: () =>
      LeluIdentity.getInstance()
        .getState()
        .traits.filter((trait) => trait.status === "emerging" || trait.status === "established")
        .map((trait) => ({ traitId: trait.id, status: trait.status, confidence: trait.confidence })),

    async reason(prompt, system) {
      if (!loaded) return null;
      const response = await loaded.ai.getInstance().reason(prompt, { system, temperature: 0.1, maxTokens: 400 });
      const ok = response.metadata?.success !== false && response.provider !== "offline" && response.text.trim().length > 0;
      return ok ? response.text : null;
    },

    async sourceFingerprint(tool, executionRoute) {
      if (!loaded) return undefined;
      const access = loaded.source.getInstance();
      const dispatcher = await access.read("src/core/tools/ToolDispatcher.ts");
      if (!dispatcher.content) return undefined;
      const block = executorBlock(dispatcher.content, tool);
      if (!block) return undefined;
      const routeClass = (executionRoute ?? "").split(".")[0];
      let implementation = "";
      if (routeClass) {
        const path = await resolveSourcePath(access, routeClass);
        if (path) implementation = (await access.read(path)).content ?? "";
      }
      return `exec:${fingerprintText(block)}|impl:${implementation ? fingerprintText(implementation) : "-"}`;
    },

    syncSelfModel(limitations, discoveries) {
      const model = SelfModel.getInstance();
      const current = model.get();
      model.update({
        limitations: [...current.limitations.filter((line) => !line.startsWith(SELF_MODEL_PREFIX)), ...limitations].slice(0, 40),
      });
      for (const line of discoveries) model.recordDiscovery(line);
    },
  };
}
