/**
 * ==========================================================
 * LÉLU
 * TOOL DISPATCHER — real execution behind native tool calls
 *
 * When a model emits a native tool_use, THIS is what runs. Every
 * executor here reaches an existing LÉLU subsystem — the research
 * resolver, the Brain's memory, the project store, the work queue,
 * the sandbox, the workspace runtime. Nothing here simulates work.
 *
 * Two invariants hold the honesty line:
 *
 *   1. This table is the ONLY source of advertisable tools. A tool
 *      with no entry here is never offered to a model, so a model can
 *      never be induced to call something that cannot run and then
 *      narrate a result it never got.
 *   2. A failed tool returns ok:false and the real error text. It is
 *      handed back to the model AS a failure rather than dropped —
 *      dropping it is what lets a model quietly invent the outcome.
 *
 * Execution is reported on the EXISTING AgentEventBus, with the same
 * tool_selected / tool_started / tool_result events the router already
 * emits, so the activity timeline and MemoryBridge's provenance check
 * (which backs a claimed action with a real tool_result) work here
 * without changes.
 * ==========================================================
 */

import type { ToolCall } from "../../providers/AIProvider";
import type RouterContext from "../router/RouterContext";
import AgentEventBus from "../agent/AgentEvents";
import AutonomyGate from "../cognition/AutonomyGate";
import ToolRegistry, { type RiskLevel } from "./ToolRegistry";

export interface ToolExecutionResult {
  ok: boolean;
  /** Human/model-readable outcome. Real content, or the real error. */
  content: string;
  /** Structured payload when the tool has one. */
  data?: unknown;
}

interface ToolExecutor {
  /** Registry id, e.g. "research.web". */
  id: string;
  /** JSON Schema for the arguments the model must supply. */
  parameters: Record<string, unknown>;
  run: (
    args: Record<string, unknown>,
    context: RouterContext | undefined,
  ) => Promise<ToolExecutionResult>;
  /**
   * Set when the executor's own subsystem already emits the
   * tool_selected / tool_started / tool_result trio. The dispatcher
   * then stays quiet on the success path so one execution produces one
   * row in the activity timeline rather than a nested pair.
   */
  emitsOwnEvents?: boolean;
}

/** Read a string argument without trusting the model's typing. */
function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function stringList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Model-facing tool names cannot contain dots: Anthropic and the
 * OpenAI-shaped providers both constrain them to [a-zA-Z0-9_-]. The
 * registry uses dotted ids, so the two forms are mapped rather than
 * one of them being renamed.
 */
export function toolNameForModel(registryId: string): string {
  return registryId.replace(/\./g, "_");
}

export function registryIdForToolName(name: string): string {
  return name.replace(/_/g, ".");
}

/* ------------------------------------------------------------------ *
 * THE EXECUTORS
 * ------------------------------------------------------------------ */

const EXECUTORS: ToolExecutor[] = [
  {
    id: "research.web",
    // ResearchResolver emits its own execution events.
    emitsOwnEvents: true,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query. Be specific — this runs against real knowledge providers.",
        },
      },
      required: ["query"],
    },
    run: async (args, context) => {
      const query = str(args, "query");
      if (!query) {
        return { ok: false, content: "research.web requires a non-empty query." };
      }

      // The REAL router context is required, not a synthetic one.
      //
      // ResearchResolver reads context.knowledgeProviders and
      // context.brain, which are owned by AIRuntime. A hand-built
      // context missing them makes every search throw and report "no
      // results" — retrieval that looks like it ran and found nothing,
      // which is the exact failure mode this work exists to remove.
      if (!context) {
        return {
          ok: false,
          content:
            "research.web needs the router's provider registry and was called without it, " +
            "so no search was performed.",
        };
      }

      // Reuse the resolver the router already uses, so retrieval
      // behaviour (provider order, shared deadline, memory stand-aside)
      // is identical whether research is reached by intent detection or
      // by a model calling the tool directly.
      const { default: ResearchResolver } = await import("../router/ResearchResolver");

      const resolver = new ResearchResolver();
      const result = await resolver.execute({
        ...context,
        request: {
          ...context.request,
          prompt: query,
          messages: [{ role: "user", content: query }],
        },
        // A model that explicitly called research.web is asking for
        // retrieval, so the resolver's memory stand-aside must not
        // short-circuit it.
        recalledMemories: [],
        intent: undefined,
      } as unknown as RouterContext);

      if (result.results.length === 0) {
        return {
          ok: false,
          content:
            `Searched for "${query}" and the knowledge providers returned no usable ` +
            `results. This was a real retrieval attempt that came back empty.`,
        };
      }

      const lines = result.results.slice(0, 8).map((item, index) => {
        const content = (item.content ?? "").replace(/\s+/g, " ").trim();
        const excerpt = content.length > 300 ? `${content.slice(0, 297)}…` : content;
        return `${index + 1}. ${item.title}${excerpt ? ` — ${excerpt}` : ""}${
          item.source ? ` (source: ${item.source})` : ""
        }${item.url ? `\n   ${item.url}` : ""}`;
      });

      return {
        ok: true,
        content: lines.join("\n\n"),
        data: { count: result.results.length, results: result.results.slice(0, 8) },
      };
    },
  },

  {
    id: "memory.recall",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search your long-term memory for.",
        },
      },
      required: ["query"],
    },
    run: async (args) => {
      const query = str(args, "query");
      if (!query) {
        return { ok: false, content: "memory.recall requires a non-empty query." };
      }
      const { default: AIService } = await import("../AIService");
      const records = await AIService.getInstance().recall(query);
      if (records.length === 0) {
        return { ok: false, content: `No stored memory matches "${query}".` };
      }
      const lines = records.slice(0, 8).map(
        (record, index) =>
          `${index + 1}. [confidence ${record.confidence.toFixed(2)}] ${record.prompt} → ${record.response}`,
      );
      return { ok: true, content: lines.join("\n"), data: { count: records.length } };
    },
  },

  {
    id: "memory.store",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "The durable fact or learning to remember.",
        },
        kind: {
          type: "string",
          enum: ["knowledge", "system"],
          description:
            "'knowledge' for something learned about the world, 'system' for something learned about yourself.",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Retrieval keywords.",
        },
      },
      required: ["summary"],
    },
    run: async (args) => {
      const summary = str(args, "summary");
      if (!summary) {
        return { ok: false, content: "memory.store requires a non-empty summary." };
      }
      const kind = str(args, "kind") === "system" ? "system" : "knowledge";
      const keywords = stringList(args, "keywords");
      const { default: AIService } = await import("../AIService");
      const stored = await AIService.getInstance().consolidate(kind, summary, keywords);
      return stored
        ? { ok: true, content: `Stored to long-term ${kind} memory.` }
        : { ok: false, content: "The memory system rejected the write; nothing was stored." };
    },
  },

  {
    id: "project.manage",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "set_objective"],
          description: "What to do with projects.",
        },
        name: { type: "string", description: "Project name, for 'create'." },
        projectId: { type: "string", description: "Project id, for 'set_objective'." },
        objective: { type: "string", description: "The objective to set." },
      },
      required: ["action"],
    },
    run: async (args) => {
      const { default: ProjectStore } = await import("../projects/ProjectStore");
      const store = ProjectStore.getInstance();
      const action = str(args, "action") || "list";

      if (action === "create") {
        const name = str(args, "name");
        if (!name) return { ok: false, content: "Creating a project requires a name." };
        const project = store.create({ name, description: "" });
        const objective = str(args, "objective");
        if (objective) store.update(project.id, { objective });
        return { ok: true, content: `Created project "${name}" (${project.id}).`, data: project };
      }

      if (action === "set_objective") {
        const projectId = str(args, "projectId");
        const objective = str(args, "objective");
        if (!projectId || !objective) {
          return { ok: false, content: "set_objective requires both projectId and objective." };
        }
        const updated = store.update(projectId, { objective });
        return updated
          ? { ok: true, content: `Set the objective of "${updated.name}".` }
          : { ok: false, content: `No project with id ${projectId}.` };
      }

      const projects = store.list();
      if (projects.length === 0) return { ok: true, content: "There are no projects." };
      const lines = projects.map(
        (project) =>
          `- ${project.name} (${project.id}) — ${project.status}, ${project.items.length} item(s)` +
          `${project.objective ? `, objective: ${project.objective}` : ""}`,
      );
      return { ok: true, content: lines.join("\n"), data: { count: projects.length } };
    },
  },

  {
    id: "sandbox.read",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Sandbox file path. Omit to list every file.",
        },
      },
    },
    run: async (args) => {
      const { default: SandboxFS } = await import("../engineering/SandboxFS");
      const fs = SandboxFS.getInstance();
      const path = str(args, "path");
      if (!path) {
        const paths = fs.filePaths();
        return paths.length === 0
          ? { ok: true, content: "The sandbox is empty." }
          : { ok: true, content: paths.join("\n"), data: { count: paths.length } };
      }
      const content = fs.read(path);
      return content === null
        ? { ok: false, content: `No sandbox file at "${path}".` }
        : { ok: true, content };
    },
  },

  {
    id: "sandbox.write",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Sandbox file path." },
        content: { type: "string", description: "Full file content." },
      },
      required: ["path", "content"],
    },
    run: async (args) => {
      const path = str(args, "path");
      const content = str(args, "content");
      if (!path) return { ok: false, content: "sandbox.write requires a path." };
      const { default: SandboxFS } = await import("../engineering/SandboxFS");
      const result = SandboxFS.getInstance().write(path, content);
      return result.ok
        ? { ok: true, content: `Wrote ${content.length} character(s) to "${path}".` }
        : { ok: false, content: result.error ?? `Could not write "${path}".` };
    },
  },

  {
    id: "workspace.typecheck",
    parameters: { type: "object", properties: {} },
    run: async () => runWorkspace("typecheck"),
  },

  {
    id: "workspace.test",
    parameters: { type: "object", properties: {} },
    run: async () => runWorkspace("test"),
  },

  {
    id: "workspace.build",
    parameters: { type: "object", properties: {} },
    run: async () => runWorkspace("build"),
  },
];

async function runWorkspace(
  operation: "typecheck" | "test" | "build",
): Promise<ToolExecutionResult> {
  const { default: WorkspaceRuntime } = await import("../engineering/WorkspaceRuntime");
  const runtime = WorkspaceRuntime.getInstance();
  if (!runtime.allowed(operation)) {
    return {
      ok: false,
      content:
        `Running ${operation} needs autonomy level ${runtime.requiredLevel(operation)}; ` +
        `the current level is lower, so it was not run.`,
    };
  }
  const result = await runtime.run(operation);
  if (!result.available) {
    return { ok: false, content: `No development runtime is reachable, so ${operation} did not run.` };
  }
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return {
    ok: result.ok,
    content:
      `${operation} exited ${result.exitCode} in ${result.durationMs}ms.` +
      (output ? `\n\n${output.slice(0, 4000)}` : ""),
    data: { exitCode: result.exitCode, ok: result.ok },
  };
}

/* ------------------------------------------------------------------ *
 * DISPATCH
 * ------------------------------------------------------------------ */

const BY_ID = new Map(EXECUTORS.map((executor) => [executor.id, executor]));

/** Registry ids that have a real executor behind them. */
export function executableToolIds(): string[] {
  return [...BY_ID.keys()];
}

export function executorParameters(id: string): Record<string, unknown> | undefined {
  return BY_ID.get(id)?.parameters;
}

/**
 * Is this tool permitted to run right now?
 *
 * Risk level comes from the registry — the same numbers the rest of
 * LÉLU gates on — and is checked against the live AutonomyGate. A tool
 * above the current level is never offered and never dispatched.
 */
export function toolPermitted(id: string): boolean {
  const definition = ToolRegistry.getInstance().get(id);
  if (!definition || !definition.available) return false;
  return AutonomyGate.getInstance().can(riskToAutonomy(definition.riskLevel));
}

/** Map registry risk (0-4) onto the autonomy levels the gate uses. */
function riskToAutonomy(risk: RiskLevel): number {
  return risk <= 1 ? 1 : risk === 2 ? 2 : risk === 3 ? 3 : 4;
}

/**
 * Execute one model-issued tool call for real.
 *
 * Never throws: an executor that fails returns ok:false carrying the
 * real error, because the model must be told the truth about what
 * happened rather than left to fill the silence.
 */
export async function dispatchToolCall(
  call: ToolCall,
  taskId: string,
  context?: RouterContext,
): Promise<ToolExecutionResult> {
  const events = AgentEventBus.getInstance();
  const id = registryIdForToolName(call.name);
  const executor = BY_ID.get(id);

  if (!executor) {
    return {
      ok: false,
      content: `There is no tool named "${call.name}", so nothing was executed.`,
    };
  }

  if (!toolPermitted(id)) {
    const result = {
      ok: false,
      content: `"${id}" is not permitted at the current autonomy level, so it was not run.`,
    };
    events.emit({
      type: "tool_result",
      taskId,
      tool: id,
      result: result.content,
      results: [],
      status: "error",
    });
    return result;
  }

  if (!executor.emitsOwnEvents) {
    events.emit({ type: "tool_selected", taskId, tool: id, label: `Using ${id}` });
    events.emit({ type: "tool_started", taskId, tool: id, label: `Running ${id}` });
  }

  try {
    const result = await executor.run(call.arguments ?? {}, context);
    if (!executor.emitsOwnEvents) {
      events.emit({
        type: "tool_result",
        taskId,
        tool: id,
        result: result.content.slice(0, 2000),
        results: [],
        status: result.ok ? "complete" : "error",
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    events.emit({
      type: "tool_result",
      taskId,
      tool: id,
      result: `Tool execution failed: ${message}`,
      results: [],
      status: "error",
    });
    return { ok: false, content: `"${id}" failed: ${message}` };
  }
}
