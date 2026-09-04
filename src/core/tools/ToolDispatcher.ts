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
import EngineeringAuthorization from "../engineering/EngineeringAuthorization";

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

/**
 * Which dependencies ResearchResolver needs but this context lacks.
 *
 * Returns the missing NAMES rather than a boolean so the refusal can
 * say precisely what was absent — a silent or vague failure here is
 * indistinguishable from an empty search result, and those are
 * different claims about the world.
 */
export function missingResearchDependencies(
  context: RouterContext | undefined,
): string[] {
  if (!context) return ["provider registry", "memory brain"];
  const missing: string[] = [];
  const candidate = context as unknown as Record<string, unknown>;
  const knowledge = candidate.knowledgeProviders as { search?: unknown } | undefined;
  if (!knowledge || typeof knowledge !== "object") {
    missing.push("provider registry");
  }
  if (!candidate.brain || typeof candidate.brain !== "object") {
    missing.push("memory brain");
  }
  return missing;
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
      // context.brain, both owned by AIRuntime. A hand-built context
      // missing either makes every search throw, and the throw reads
      // downstream as "searched, found nothing" — retrieval that looks
      // like it ran, which is the exact failure this work exists to
      // remove. The dependencies are therefore checked BY NAME rather
      // than trusting that a context object was passed at all.
      const missing = missingResearchDependencies(context);
      if (missing.length > 0) {
        return {
          ok: false,
          content:
            `No search was performed: research.web requires the router's ` +
            `${missing.join(" and ")} and was called without ${missing.length > 1 ? "them" : "it"}. ` +
            `This is a failure to search, NOT a search that returned no results.`,
        };
      }

      // Reuse the resolver the router already uses, so retrieval
      // behaviour (provider order, shared deadline, memory stand-aside)
      // is identical whether research is reached by intent detection or
      // by a model calling the tool directly.
      const { default: ResearchResolver } = await import("../router/ResearchResolver");

      // Narrowed by the dependency check above.
      const routerContext = context as RouterContext;
      const resolver = new ResearchResolver();
      const result = await resolver.execute({
        ...routerContext,
        request: {
          ...routerContext.request,
          prompt: query,
          messages: [{ role: "user", content: query }],
        },
        // A model that explicitly called research.web is asking for
        // retrieval, so the resolver's memory stand-aside must not
        // short-circuit it.
        recalledMemories: [],
        // This search IS a model tool call, so its events say so. A
        // router prefetch is labelled separately and must never be
        // reported as the model having invoked a tool.
        toolInvoked: true,
        // Declare the intent instead of letting it be re-detected.
        //
        // ResearchResolver only retrieves when the intent is search/news
        // or the prompt looks time-sensitive; anything else returns
        // instantly with no results. Those guards exist to stop ORDINARY
        // CONVERSATION triggering retrieval — but a model that issued a
        // research.web tool call has already made that decision, and it
        // should not be second-guessed by re-running intent detection on
        // the bare query. A search term like "tardigrade cryptobiosis"
        // classifies as neither, so every such call came back in three
        // milliseconds having searched nothing, and was then reported to
        // the model as a search that found nothing.
        //
        // `intent` is the resolver's own supported input for this; the
        // router sets it the same way.
        intent: "search",
      } as unknown as RouterContext);


      if (result.results.length === 0) {
        // "Declined to search" and "searched, found nothing" are
        // different claims about the world and must never collapse into
        // one message. The resolver reports `attempted` only once it has
        // actually called providers, so its absence on an empty result
        // means nothing was ever contacted.
        //
        // The order matters: `attempted` is also absent on the SUCCESS
        // path, so this can only be read after results are known empty.
        if (!result.attempted) {
          return {
            ok: false,
            content:
              `No search ran for "${query}": the research resolver declined the request ` +
              `before contacting any provider. This is NOT a search that returned no results.`,
          };
        }

        // Name the providers and their failures, so the model reports a
        // real empty search rather than a vague one.
        const detail = result.attempted
          .map((entry) => `${entry.provider}${entry.error ? ` (${entry.error})` : ""}`)
          .join(", ");
        return {
          ok: false,
          content:
            `Searched for "${query}" and the knowledge providers returned no usable ` +
            `results. This was a real retrieval attempt that came back empty. ` +
            `Providers tried: ${detail || "(none reported)"}.`,
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

  /* ---------------- isolated project copies ---------------- */

  {
    id: "project.copy",
    parameters: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Optional id for the copy. One is generated when omitted.",
        },
      },
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const requested = str(args, "workspace");
      const result = await EngineeringWorkspace.getInstance().createCopy(requested || undefined);
      if (!result.ok) return { ok: false, content: `No copy was created: ${result.error}` };
      return {
        ok: true,
        content:
          `Copied the project into sandbox workspace "${result.workspace.id}" — ` +
          `${result.workspace.fileCount} real file(s) on disk. Edits here never touch the real project.`,
        data: result.workspace,
      };
    },
  },

  {
    id: "project.list",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "The sandbox workspace id." },
        path: { type: "string", description: "Directory to list, relative to the copy. Use '.' for the root." },
      },
      required: ["workspace"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      if (!workspace) return { ok: false, content: "project.list requires a workspace id." };
      const result = await EngineeringWorkspace.getInstance().listDir(workspace, str(args, "path") || ".");
      if (!result.ok) return { ok: false, content: result.error };
      if (result.entries.length === 0) return { ok: true, content: "(empty directory)" };
      const lines = result.entries.map(
        (entry) => `${entry.type === "dir" ? "[dir] " : "      "}${entry.path}${entry.size !== undefined ? ` (${entry.size}b)` : ""}`,
      );
      return { ok: true, content: lines.join("\n"), data: { count: result.entries.length } };
    },
  },

  {
    id: "project.read",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "The sandbox workspace id." },
        path: { type: "string", description: "File path relative to the copy." },
      },
      required: ["workspace", "path"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      const path = str(args, "path");
      if (!workspace || !path) return { ok: false, content: "project.read requires workspace and path." };
      const result = await EngineeringWorkspace.getInstance().readFile(workspace, path);
      if (!result.ok) return { ok: false, content: result.error };
      const content = result.content;
      // Large files are truncated rather than silently dropped, and the
      // truncation is stated so nothing is mistaken for the whole file.
      const MAX = 60_000;
      return {
        ok: true,
        content:
          content.length > MAX
            ? `${content.slice(0, MAX)}\n…[truncated at ${MAX} characters of ${content.length}]`
            : content,
      };
    },
  },

  {
    id: "project.write",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "The sandbox workspace id." },
        path: { type: "string", description: "File path relative to the copy." },
        content: { type: "string", description: "The COMPLETE new contents of the file." },
      },
      required: ["workspace", "path", "content"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      const path = str(args, "path");
      const content = typeof args.content === "string" ? args.content : "";
      if (!workspace || !path) return { ok: false, content: "project.write requires workspace and path." };
      const result = await EngineeringWorkspace.getInstance().writeFile(workspace, path, content);
      if (!result.ok) return { ok: false, content: result.error };
      return { ok: true, content: `Wrote ${content.length} character(s) to "${path}" in workspace "${workspace}".` };
    },
  },

  {
    id: "project.delete",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "The sandbox workspace id." },
        path: { type: "string", description: "File path relative to the copy." },
      },
      required: ["workspace", "path"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      const path = str(args, "path");
      if (!workspace || !path) return { ok: false, content: "project.delete requires workspace and path." };
      const result = await EngineeringWorkspace.getInstance().deleteFile(workspace, path);
      return result.ok
        ? { ok: true, content: `Deleted "${path}" from workspace "${workspace}".` }
        : { ok: false, content: result.error };
    },
  },

  {
    id: "project.validate",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "The sandbox workspace id." },
        operation: {
          type: "string",
          enum: ["typecheck", "test", "build", "inspect"],
          description: "Which validation to run inside the copy.",
        },
      },
      required: ["workspace", "operation"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      const operation = str(args, "operation");
      if (!workspace) return { ok: false, content: "project.validate requires a workspace id." };
      if (!["typecheck", "test", "build", "inspect"].includes(operation)) {
        return { ok: false, content: `Unknown validation "${operation}". Use typecheck, test, build or inspect.` };
      }
      const result = await EngineeringWorkspace.getInstance().validate(
        workspace,
        operation as "typecheck" | "test" | "build" | "inspect",
      );
      if (!("exitCode" in result)) return { ok: false, content: result.error };
      return {
        ok: result.ok,
        content:
          `${operation} exited ${result.exitCode} after ${result.durationMs}ms ` +
          `(${result.ok ? "PASSED" : "FAILED"}).\n\n${result.output || "(no output)"}`,
        data: { exitCode: result.exitCode, ok: result.ok },
      };
    },
  },

  {
    id: "project.diff",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "The sandbox workspace id." },
        includePatch: {
          type: "boolean",
          description: "Include the actual changed lines, not just a summary. Defaults to true.",
        },
      },
      required: ["workspace"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      if (!workspace) return { ok: false, content: "project.diff requires a workspace id." };
      // Default ON: a summary of counts is not a diff, and a model asked
      // to show its work would otherwise have to restate what it BELIEVED
      // it wrote instead of what is actually on disk.
      const includePatch = args.includePatch !== false;
      const changes = await EngineeringWorkspace.getInstance().diff(workspace, includePatch);
      if (changes.length === 0) {
        return { ok: true, content: "The copy is identical to the real project — nothing has changed." };
      }
      const lines = changes.map((change) => {
        const header = `${change.status.toUpperCase()} ${change.path} (+${change.addedLines}/-${change.removedLines} lines)`;
        return change.patch ? `${header}\n${change.patch}` : header;
      });
      return { ok: true, content: lines.join("\n\n"), data: { count: changes.length } };
    },
  },

  {
    id: "project.apply",
    parameters: {
      type: "object",
      properties: { workspace: { type: "string", description: "The sandbox workspace id." } },
      required: ["workspace"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      if (!workspace) return { ok: false, content: "project.apply requires a workspace id." };
      const result = await EngineeringWorkspace.getInstance().apply(workspace);
      if (!result.ok) return { ok: false, content: result.error };
      return {
        ok: true,
        content:
          `Applied ${result.applied.length} file(s) to the real project, authorized by ` +
          `${result.authorizedBy}: ${result.applied.join(", ")}`,
        data: { applied: result.applied },
      };
    },
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
  if (!AutonomyGate.getInstance().can(riskToAutonomy(definition.riskLevel))) return false;

  // Changing the REAL project needs a human authorization, not a
  // permission level.
  //
  // Because the offered tool set is derived from this predicate, a model
  // without an authorization is never even shown project.apply — it
  // cannot request what it cannot see. The dispatcher and the workspace
  // service both re-check before writing, so a grant that lapses between
  // being offered and being used still stops the write.
  if (id === "project.apply") {
    return authorizedWorkspaceExists();
  }

  return true;
}

/** The accurate reason a tool was refused. */
function refusalReason(id: string): string {
  const definition = ToolRegistry.getInstance().get(id);
  if (!definition) return `There is no tool named "${id}", so nothing was executed.`;
  if (!definition.available) {
    return `"${id}" is not available in this runtime, so it was not run.`;
  }
  // project.apply is checked first: its preflight already reports the
  // autonomy shortfall AND the missing session, so the generic autonomy
  // message would hide the more specific, more actionable one.
  if (id === "project.apply" && !authorizedWorkspaceExists()) {
    let detail = "";
    try {
      detail = ` ${EngineeringAuthorization.getInstance().preflight().reason}`;
    } catch {
      detail = "";
    }
    return (
      `"${id}" was NOT run: applying changes to the real project requires an explicit ` +
      `authorization from the signed-in user, and none is currently held.${detail} ` +
      `The sandbox copy is unchanged and nothing was written to the real project.`
    );
  }
  if (!AutonomyGate.getInstance().can(riskToAutonomy(definition.riskLevel))) {
    return `"${id}" is not permitted at the current autonomy level, so it was not run.`;
  }
  return `"${id}" is not permitted right now, so it was not run.`;
}

/** Does any workspace currently carry a live human authorization? */
function authorizedWorkspaceExists(): boolean {
  try {
    return EngineeringAuthorization.getInstance().authorizedWorkspaces().length > 0;
  } catch {
    // No session, no Supabase, no grant — all of which mean "not
    // authorized", never "assume yes".
    return false;
  }
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
    // Say WHY, accurately.
    //
    // A single "not permitted at the current autonomy level" message
    // blamed the autonomy level even when the real obstacle was a
    // missing session or a missing authorization — a true refusal with
    // a false reason, which sends the user to fix the wrong thing.
    const result = { ok: false, content: refusalReason(id) };
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
