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
import MultiChatStore, { tokenizeText, type ChatConversation } from "../multichat/MultiChatStore";
import { consentFor, findChat } from "../multichat/ChatConsent";
import { CHAT_SCOPED } from "../multichat/ContextProvenance";

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
/** Research focus → the knowledge-provider capabilities it selects. */
export const RESEARCH_FOCUS: Record<string, string[]> = {
  news: ["news", "current-events"],
  video: ["video", "youtube"],
  academic: ["academic", "research", "paper", "scientific"],
  encyclopedia: ["encyclopedia", "fact", "reference", "knowledge"],
  code: ["code", "github"],
  space: ["space", "astronomy"],
  tech: ["technology", "developer", "startups"],
  weather: ["weather"],
  location: ["geography", "location", "map", "place"],
};
const RESEARCH_FOCUS_IDS = Object.keys(RESEARCH_FOCUS);

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 60);
  }
}

/**
 * Pages already opened by browser.read, per task. A model that asks for
 * the same page again in one turn gets what it already has instead of a
 * second fetch and a second row of activity. Bounded.
 */
const pagesReadByTask = new Map<string, Map<string, ToolExecutionResult>>();

function rememberPage(taskId: string, url: string, result: ToolExecutionResult): void {
  let pages = pagesReadByTask.get(taskId);
  if (!pages) {
    pages = new Map();
    pagesReadByTask.set(taskId, pages);
    if (pagesReadByTask.size > 40) pagesReadByTask.delete(pagesReadByTask.keys().next().value as string);
  }
  pages.set(url, result);
}

/** A Google News article link is a script redirect: fetching it yields "Google News", never the article. */
function isNewsRedirect(url: string): boolean {
  return /^https?:\/\/news\.google\.com\/(rss\/)?articles\//i.test(url);
}

/** Below this much text a "read" page carried nothing to read (a redirect or script shell). */
const MIN_READABLE_CHARS = 200;

/** What a tool call is doing, in words — the activity line for it. */
export function describeToolCall(id: string, args: Record<string, unknown>): string {
  const pick = (key: string) => (typeof args[key] === "string" ? String(args[key]).trim() : "");
  switch (id) {
    case "research.web":
      return `Searching the web for “${pick("query").slice(0, 80)}”`;
    case "browser.read":
      return `Opening ${hostOf(pick("url"))}`;
    case "memory.recall":
      return `Checking memory for “${pick("query").slice(0, 60)}”`;
    case "memory.store":
      return "Saving to memory";
    case "chats.list":
      return "Looking through your other chats";
    case "chats.read":
      return `Reading the chat “${pick("chat").slice(0, 60)}”`;
    case "chats.link":
      return `Linking the chat “${pick("chat").slice(0, 60)}”`;
    case "chats.merge":
      return "Merging chats into a new chat";
    default: {
      const detail = pick("query") || pick("path") || pick("action") || pick("url");
      return detail ? `Running ${id} (${detail.slice(0, 60)})` : `Running ${id}`;
    }
  }
}

/** Everything the user said in this turn: the message, and what they added while it ran. */
function userWords(context: RouterContext | undefined): string {
  return [context?.request.prompt ?? "", ...(context?.request.steered ?? [])].join("\n");
}

/** The chat this turn belongs to (AIRequest.conversationId), if any. */
function currentChat(context: RouterContext | undefined): ChatConversation | undefined {
  const id = context?.request.conversationId;
  return id ? MultiChatStore.getInstance().get(id) : undefined;
}

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
        focus: {
          type: "string",
          enum: [...RESEARCH_FOCUS_IDS],
          description:
            "Which connected sources to use: news (NewsAPI, Guardian, GNews, NewsData, GDELT, RSS), " +
            "video (YouTube), academic (arXiv, OpenAlex, CrossRef), encyclopedia (Wikipedia, Wikidata), " +
            "code (GitHub), space (NASA), tech (Hacker News), weather, location. Omit to let LÉLU choose.",
        },
      },
      required: ["query"],
    },
    run: async (args, context) => {
      const query = str(args, "query");
      const focus = str(args, "focus");
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
        ...(RESEARCH_FOCUS[focus] ? { researchFocus: RESEARCH_FOCUS[focus] } : {}),
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
    id: "browser.read",
    // Emits the browser_* trio itself, so the chat can show the page.
    emitsOwnEvents: true,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The full web address to open and read (e.g. a source from research.web). " +
            "Returns the page title and its readable text. news.google.com article links are " +
            "redirects that cannot be read — search the headline instead.",
        },
      },
      required: ["url"],
    },
    run: async (args, context) => {
      const url = str(args, "url");
      if (!url) {
        return { ok: false, content: "browser.read needs a url; nothing was opened." };
      }
      const taskId = String(context?.request?.timestamp ?? Date.now());
      const already = pagesReadByTask.get(taskId)?.get(url);
      if (already) {
        return {
          ...already,
          content: `(You already opened this page in this turn — nothing new; do not open it again.)\n${already.content}`,
        };
      }
      const events = AgentEventBus.getInstance();
      const { default: BrowserTool } = await import("../browser/BrowserTool");
      events.emit({ type: "tool_selected", taskId, tool: "browser", label: `Opening ${hostOf(url)}` });
      events.emit({ type: "tool_started", taskId, tool: "browser", label: `Opening ${hostOf(url)}` });
      events.emit({ type: "browser_opened", taskId, url });

      const visited = await BrowserTool.visit(url);
      // A "read" with nothing in it is not a read. Reporting it as one
      // sent the model back to the same Google News redirect again and
      // again, each time told it had succeeded.
      const thin = visited.status === "read" && visited.text.trim().length < MIN_READABLE_CHARS;
      const page = thin
        ? {
            ...visited,
            status: "error" as const,
            error: isNewsRedirect(url) || isNewsRedirect(visited.url)
              ? "This is a Google News redirect link — it never contains the article. Search for the headline with research_web, or open the publisher's own URL"
              : `The page had almost no readable text (“${visited.text.trim().slice(0, 60)}”) — likely a redirect or a page built by scripts`,
          }
        : visited;
      events.emit({ type: "browser_navigation", taskId, url: page.url });
      events.emit({
        type: "browser_result",
        taskId,
        url: page.url,
        title: page.title,
        excerpt: page.excerpt.slice(0, 1200),
        status: page.status,
        error: page.error,
      });
      events.emit({
        type: "tool_result",
        taskId,
        tool: "browser",
        query: page.url,
        result: page.status === "read" ? `Read “${page.title || hostOf(page.url)}”` : page.error ?? `Could not read ${page.url}`,
        results:
          page.status === "read"
            ? [{ title: page.title || page.url, url: page.url, content: page.excerpt.slice(0, 600), source: hostOf(page.url) }]
            : [],
        status: page.status === "read" ? "complete" : page.status === "blocked" ? "blocked" : "error",
      });

      if (page.status !== "read") {
        // A structured failure the model can act on: what happened, and
        // what to do instead.
        const failed = {
          ok: false,
          content:
            `Could not read ${page.url}: ${page.error ?? page.status}. ` +
            `Nothing from this page is known. Try another source from research.web, or tell the user it could not be opened.`,
          data: { url: page.url, status: page.status },
        };
        rememberPage(taskId, url, failed);
        return failed;
      }
      const text = page.text.length > 6000 ? `${page.text.slice(0, 6000)}…` : page.text;
      const read = {
        ok: true,
        content: `Page: ${page.title || page.url}\nURL: ${page.url}\n\n${text}`,
        data: { url: page.url, title: page.title, status: page.status, length: page.text.length },
      };
      rememberPage(taskId, url, read);
      return read;
    },
  },

  /* ------------------------- other chats ------------------------- */
  // LÉLU can find, read, link and merge the user's other chats from
  // inside a conversation. WHETHER she may is decided by the user's own
  // words (multichat/ChatConsent) — she can raise a connection, the
  // user decides. Unauthorized chats are never read.

  {
    id: "browser.capture",
    emitsOwnEvents: true,
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["app", "preview", "url"],
          description: "'app' = your own running interface; 'preview' = a workspace copy you started with project_preview; 'url' = a public page.",
        },
        url: { type: "string", description: "For target 'url': the page address." },
        workspace: { type: "string", description: "For target 'preview': the workspace id." },
        viewport: { type: "string", enum: ["phone", "desktop"], description: "Screen size to render at (default desktop)." },
        panel: {
          type: "string",
          description: "For 'app'/'preview': a panel to open first, e.g. chat, avatar, browser, memory, projects, cosmos.",
        },
      },
      required: ["target"],
    },
    run: async (args, context) => {
      const target = str(args, "target") || "app";
      const viewport = str(args, "viewport") === "phone" ? "phone" : "desktop";
      const panel = str(args, "panel") || undefined;
      const body: Record<string, unknown> = { viewport, ...(panel ? { panel } : {}) };
      if (target === "url") {
        const url = str(args, "url");
        if (!url) return { ok: false, content: "browser.capture with target 'url' needs a url." };
        body.url = url;
      } else if (target === "preview") {
        const workspace = str(args, "workspace");
        if (!workspace) return { ok: false, content: "browser.capture with target 'preview' needs the workspace id." };
        body.preview = workspace;
      } else {
        body.app = true;
      }
      // The turn's own task id (as browser.read uses), so the capture's
      // events belong to the conversation that asked for it.
      const taskId = String(context?.request?.timestamp ?? Date.now());
      const label = target === "url" ? `Looking at ${hostOf(String(body.url))}` : `Looking at ${target === "preview" ? `workspace ${String(body.preview)}` : "my own interface"} (${viewport}${panel ? `, ${panel}` : ""})`;
      // Reported as "capture", not "browser": a capture is a screenshot shown
      // in the conversation. As "browser" it opened the in-app Browser window
      // over the chat on phones (measured in the self-improvement run).
      const events = AgentEventBus.getInstance();
      events.emit({ type: "tool_selected", taskId, tool: "capture", label });
      events.emit({ type: "tool_started", taskId, tool: "capture", label });
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const data = await EngineeringWorkspace.getInstance().callRuntime("/api/browser/capture", body);
      if (data.ok !== true) {
        const error = String(data.error ?? "The capture failed.");
        events.emit({ type: "tool_failed", taskId, tool: "capture", error });
        return { ok: false, content: `Nothing was captured: ${error}` };
      }
      const layout = (data.layout ?? {}) as { viewport?: number[]; controls?: number; findings?: Array<{ label: string; rect: number[]; problem: string; coveredBy?: string }>; text?: string };
      const findings = layout.findings ?? [];
      // The real screenshot goes where every produced image goes: into the
      // conversation and the shared workspace.
      if (typeof data.screenshot === "string") {
        events.emit({ type: "creative_artifact", taskId, image: data.screenshot, label });
      }
      events.emit({ type: "tool_result", taskId, tool: "capture", result: `${findings.length} layout finding(s)` });
      const lines = findings.map((f) => `- ${f.problem}: ${f.label} at [x ${f.rect[0]}, y ${f.rect[1]}, w ${f.rect[2]}, h ${f.rect[3]}]${f.coveredBy ? ` covered by ${f.coveredBy}` : ""}`);
      const errors = Array.isArray(data.pageErrors) && data.pageErrors.length ? `\nPage errors: ${(data.pageErrors as string[]).join(" | ")}` : "";
      return {
        ok: true,
        content:
          `Captured ${String(data.url)} at ${viewport} (${(layout.viewport ?? []).join("×")}), title "${String(data.title ?? "")}"` +
          `${data.panelOpened ? `, panel: ${String(data.panelOpened)}` : ""}. The screenshot is shown to the user.\n` +
          `Layout report — ${layout.controls ?? 0} visible controls measured; ${findings.length} problem(s):\n` +
          `${lines.length ? lines.join("\n") : "(none: every control is on screen and uncovered)"}${errors}\n\nVisible text (start):\n${String(layout.text ?? "").slice(0, 1200)}`,
        data: { findings, viewport, title: data.title, capturedAt: data.capturedAt },
      };
    },
  },

  {
    id: "project.search",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to find (case-insensitive), e.g. a component name, a style value, an aria-label." },
        workspace: { type: "string", description: "Search inside this workspace copy instead of the real project." },
        path: { type: "string", description: "Only under this folder, e.g. src/app." },
        regex: { type: "boolean", description: "Treat the query as a regular expression." },
      },
      required: ["query"],
    },
    run: async (args) => {
      const query = str(args, "query");
      if (!query) return { ok: false, content: "project.search needs a query." };
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const data = await EngineeringWorkspace.getInstance().callRuntime("/api/engineer/search", {
        query,
        ...(str(args, "workspace") ? { workspace: str(args, "workspace") } : {}),
        ...(str(args, "path") ? { path: str(args, "path") } : {}),
        ...(args.regex === true ? { regex: true } : {}),
      });
      if (data.ok !== true) return { ok: false, content: `Search failed: ${String(data.error ?? "unknown error")}` };
      const matches = (data.matches ?? []) as Array<{ path: string; line: number; text: string }>;
      if (matches.length === 0) return { ok: true, content: `No match for "${query}" (${String(data.filesScanned)} files scanned).` };
      return {
        ok: true,
        content: `${matches.length}${data.truncated ? "+" : ""} match(es) for "${query}":\n` + matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n"),
        data: { matches },
      };
    },
  },

  {
    id: "project.preview",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "The workspace copy to run." },
        action: { type: "string", enum: ["start", "stop", "status"], description: "Default start." },
      },
      required: ["workspace"],
    },
    run: async (args) => {
      const action = str(args, "action") || "start";
      const workspace = str(args, "workspace");
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const data = await EngineeringWorkspace.getInstance().callRuntime("/api/engineer/preview", { action, workspace });
      if (data.ok !== true) return { ok: false, content: `Preview ${action} failed: ${String(data.error ?? "unknown error")}${data.log ? `\n${String(data.log).slice(-800)}` : ""}` };
      if (action === "start") return { ok: true, content: `Workspace ${workspace} is running at ${String(data.url)} (loopback). Capture it with browser_capture target "preview".` };
      if (action === "stop") return { ok: true, content: data.stopped ? `Preview of ${workspace} stopped.` : `No preview of ${workspace} was running.` };
      return { ok: true, content: JSON.stringify(data.previews ?? []) };
    },
  },

  {
    id: "agent.delegate",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The work to hand off, stated fully enough for the agent to act on it." },
        agent: {
          type: "string",
          description: "Optional: the agent's name, when the user asked for a specific one. Omit to let SHAMAN choose.",
        },
      },
      required: ["objective"],
    },
    run: async (args) => {
      const objective = str(args, "objective");
      if (!objective) return { ok: false, content: "agent.delegate requires an objective." };
      const { default: Shaman } = await import("../agents/Shaman");
      const { default: AgentStore } = await import("../agents/AgentStore");
      const named = str(args, "agent").toLowerCase();
      let agentId: string | undefined;
      if (named) {
        const agent = AgentStore.getInstance()
          .list()
          .find((candidate) => candidate.name.toLowerCase() === named || candidate.name.toLowerCase().includes(named));
        if (!agent) return { ok: false, content: `There is no agent called "${str(args, "agent")}". Nothing was run.` };
        agentId = agent.id;
      }
      const result = await Shaman.getInstance().dispatch({ objective, agentId, delegatedBy: "lelu" });
      const route = result.route.ok
        ? `SHAMAN routed it to ${result.route.agentName} (${result.route.executive}): ${result.route.routeReason}.`
        : `SHAMAN could not route it: ${result.route.reason}`;
      if (!result.ok) {
        return { ok: false, content: `${route}\nNot completed: ${result.error ?? "the agent run failed"}. Task ${result.taskId}.` };
      }
      const text = result.response?.text ?? "";
      const failedProvider = result.response?.provider === "error" || result.response?.provider === "offline";
      return {
        ok: !failedProvider,
        content: `${route}\n${failedProvider ? "The agent reached no model provider" : "Result"} (task ${result.taskId}):\n${text.slice(0, 4000)}`,
        data: { taskId: result.taskId, route: result.route },
      };
    },
  },

  {
    id: "agent.status",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["running", "interrupted", "failed", "complete", "queued"], description: "Only tasks in this state." },
      },
    },
    run: async (args) => {
      const { default: AgentStore } = await import("../agents/AgentStore");
      const status = str(args, "status");
      const entries = AgentStore.getInstance()
        .delegations(status ? { status: status as never } : {})
        .slice(0, 15);
      if (entries.length === 0) return { ok: true, content: status ? `No ${status} agent tasks.` : "No agent tasks recorded yet." };
      const lines = entries.map(({ agentName, task }) => {
        const when = new Date(task.createdAt).toISOString().slice(0, 16).replace("T", " ");
        return (
          `- [${task.status}] ${agentName}${task.executive ? ` (${task.executive})` : ""}: "${task.label.slice(0, 80)}" — ${when}` +
          `${task.delegatedBy ? `, assigned by ${task.delegatedBy}` : ""}${task.routeReason ? `; routed: ${task.routeReason}` : ""}` +
          `${task.error ? `; error: ${task.error.slice(0, 120)}` : ""} (id ${task.id})`
        );
      });
      return { ok: true, content: lines.join("\n") };
    },
  },

  {
    id: "agent.resume",
    parameters: {
      type: "object",
      properties: { taskId: { type: "string", description: "The id of the interrupted or failed task (from agent_status)." } },
      required: ["taskId"],
    },
    run: async (args) => {
      const taskId = str(args, "taskId");
      const { default: AgentStore } = await import("../agents/AgentStore");
      const owner = AgentStore.getInstance()
        .list()
        .find((agent) => agent.tasks.some((task) => task.id === taskId));
      if (!owner) return { ok: false, content: `No agent task with id ${taskId}.` };
      const { default: Shaman } = await import("../agents/Shaman");
      const result = await Shaman.getInstance().resume(owner.id, taskId);
      const route = result.route.ok ? `${result.route.agentName} (${result.route.executive}): ${result.route.routeReason}` : result.route.reason;
      return result.ok
        ? { ok: true, content: `Resumed — ${route}. New task ${result.taskId}:\n${(result.response?.text ?? "").slice(0, 3000)}` }
        : { ok: false, content: `Not resumed: ${result.error}` };
    },
  },

  {
    id: "avatar.companion",
    parameters: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "true to appear as the companion over the app, false to hide. Omit to only change size.",
        },
        size: { type: "string", enum: ["small", "medium", "large"], description: "Your size as the companion." },
        chooseOwnSpot: {
          type: "boolean",
          description: "true to stop staying where the user dragged you and pick an out-of-the-way spot yourself.",
        },
      },
    },
    run: async (args) => {
      const { default: CompanionStore } = await import("../avatar/CompanionStore");
      const store = CompanionStore.getInstance();
      if (typeof args.enabled === "boolean") store.setEnabled(args.enabled);
      const size = str(args, "size");
      if (size === "small" || size === "medium" || size === "large") store.setSize(size);
      if (args.chooseOwnSpot === true) store.unpin();
      const state = store.get();
      return {
        ok: true,
        content: state.enabled
          ? `Companion mode is ON (${state.size}${state.pinned ? ", staying where the user placed you" : ", choosing your own out-of-the-way spot"}).`
          : "Companion mode is OFF.",
        data: state,
      };
    },
  },

  {
    id: "chats.list",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional words to rank the user's other chats by (matched against their titles).",
        },
      },
    },
    run: async (args, context) => {
      const current = currentChat(context);
      const others = MultiChatStore.getInstance().list().filter((conversation) => conversation.id !== current?.id);
      if (others.length === 0) return { ok: true, content: "The user has no other chats." };
      const qTokens = new Set(tokenizeText(str(args, "query")));
      const ranked = others
        .map((conversation) => ({
          conversation,
          score: tokenizeText(conversation.title).filter((token) => qTokens.has(token)).length,
        }))
        .sort((a, b) => b.score - a.score || b.conversation.updatedAt - a.conversation.updatedAt)
        .slice(0, 15);
      const lines = ranked.map(({ conversation }) => {
        const linked = current && (current.linkedIds.includes(conversation.id) || conversation.linkedIds.includes(current.id));
        return `- “${conversation.title}” — ${conversation.messages.length} messages${linked ? ", linked to this chat" : ""}`;
      });
      return {
        ok: true,
        content:
          `The user's other chats (titles only — their contents are not shown here):\n${lines.join("\n")}\n` +
          "Read one with chats_read only if the user brought it up or agrees; otherwise ask them.",
      };
    },
  },

  {
    id: "chats.read",
    parameters: {
      type: "object",
      properties: {
        chat: { type: "string", description: "The other chat's title (or part of it)." },
        query: { type: "string", description: "What to look for in it (optional)." },
      },
      required: ["chat"],
    },
    run: async (args, context) => {
      const current = currentChat(context);
      if (!current) return { ok: false, content: "This turn is not in a chat, so no other chat can be read." };
      const target = findChat(str(args, "chat"), MultiChatStore.getInstance().list(), current.id);
      if (!target) return { ok: false, content: `No other chat matches “${str(args, "chat")}”. Use chats_list to see the titles.` };
      const consent = consentFor({ prompt: userWords(context), current, target, action: "read" });
      if (!consent.ok) return { ok: false, content: consent.reason, data: { needsConsent: true, chat: target.title } };

      const qTokens = new Set(tokenizeText(str(args, "query") || (userWords(context))));
      const messages = target.messages.filter((message) => message.text.trim());
      const relevant = messages
        .map((message, index) => ({ message, index, overlap: tokenizeText(message.text).filter((t) => qTokens.has(t)).length }))
        .filter((item) => item.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 6)
        .sort((a, b) => a.index - b.index)
        .map((item) => item.message);
      const chosen = relevant.length > 0 ? relevant : messages.slice(-8);
      let budget = 3500;
      const lines: string[] = [];
      for (const message of chosen) {
        if (budget <= 0) break;
        const text = message.text.replace(/\s+/g, " ").trim().slice(0, Math.min(budget, 900));
        budget -= text.length;
        lines.push(`- ${message.role === "assistant" ? "LÉLU" : "User"}: ${text}`);
      }
      const taskId = String(context?.request.timestamp ?? Date.now());
      AgentEventBus.getInstance().emit({
        type: "cross_chat_reference",
        taskId,
        sources: [{ conversationId: target.id, title: target.title, authorization: consent.authorization ?? "asked" }],
        suggested: [],
      });
      return {
        ok: true,
        content:
          `From the chat “${target.title}” (${consent.reason}) — this is that chat's content, not this one's. ` +
          `When you use it, say it came from “${target.title}”.\n${lines.join("\n")}`,
        data: { chat: target.title, messages: chosen.length },
      };
    },
  },

  {
    id: "chats.link",
    parameters: {
      type: "object",
      properties: { chat: { type: "string", description: "The other chat's title (or part of it)." } },
      required: ["chat"],
    },
    run: async (args, context) => {
      const current = currentChat(context);
      if (!current) return { ok: false, content: "This turn is not in a chat, so nothing can be linked." };
      const store = MultiChatStore.getInstance();
      const target = findChat(str(args, "chat"), store.list(), current.id);
      if (!target) return { ok: false, content: `No other chat matches “${str(args, "chat")}”.` };
      const consent = consentFor({ prompt: userWords(context), current, target, action: "link" });
      if (!consent.ok) return { ok: false, content: consent.reason, data: { needsConsent: true, chat: target.title } };
      store.link(current.id, target.id);
      return {
        ok: true,
        content: `Linked “${target.title}” to this chat. Its research is available to this chat from now on (the user can unlink it from the tab menu).`,
      };
    },
  },

  {
    id: "chats.merge",
    parameters: {
      type: "object",
      properties: {
        chats: {
          type: "array",
          items: { type: "string" },
          description: "The other chats to merge, by title (or part of it). One or more.",
        },
        includeThisChat: {
          type: "boolean",
          description: "Include the current chat in the merge (default true).",
        },
        title: { type: "string", description: "A title for the merged chat (optional)." },
      },
      required: ["chats"],
    },
    run: async (args, context) => {
      const current = currentChat(context);
      if (!current) return { ok: false, content: "This turn is not in a chat, so nothing can be merged." };
      const store = MultiChatStore.getInstance();
      const names = stringList(args, "chats");
      const targets = names.map((name) => ({ name, chat: findChat(name, store.list(), current.id) }));
      const missing = targets.filter((item) => !item.chat).map((item) => `“${item.name}”`);
      if (missing.length > 0) return { ok: false, content: `No chat matches ${missing.join(", ")}. Use chats_list to see the titles.` };
      const chats = [...new Map(targets.map((item) => [item.chat!.id, item.chat!])).values()];
      const refused = chats
        .map((chat) => consentFor({ prompt: userWords(context), current, target: chat, action: "merge" }))
        .filter((result) => !result.ok);
      if (refused.length > 0) return { ok: false, content: refused.map((result) => result.reason).join(" "), data: { needsConsent: true } };
      const includeThis = args.includeThisChat !== false;
      const ids = [...(includeThis ? [current.id] : []), ...chats.map((chat) => chat.id)];
      if (ids.length < 2) return { ok: false, content: "A merge needs at least two chats." };
      // Created beside the conversation the user is reading, not instead of it.
      const merged = store.merge(ids, str(args, "title") || undefined, { activate: false });
      if (!merged) return { ok: false, content: "The chats could not be merged." };
      try {
        const { default: NotificationProvider } = await import("../notifications/NotificationProvider");
        NotificationProvider.getInstance().notify({
          type: "info",
          title: `Merged chat ready: “${merged.title}”`,
          body: `${merged.messages.length} messages, each labelled with the chat it came from. The originals are unchanged.`,
          conversationId: merged.id,
          tag: `merge:${merged.id}`,
          silent: true,
        });
      } catch {
        // the merge itself succeeded
      }
      const sources = ids.map((id) => `“${store.get(id)?.title ?? id}”`).join(", ");
      return {
        ok: true,
        content:
          `Created the merged chat “${merged.title}” from ${sources}: ${merged.messages.length} messages, each labelled with the chat it came from. ` +
          "The original chats are unchanged. It is in the user's Chats panel (and its notifications) — tell them where to find it.",
        data: { mergedId: merged.id, title: merged.title },
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
    run: async (args, context) => {
      const raw = str(args, "summary");
      if (!raw) {
        return { ok: false, content: "memory.store requires a non-empty summary." };
      }
      // "Remember this for this chat": the user scoped it. It is already in
      // this chat's history; making it long-term memory would hand it to
      // every other chat (measured: it did, unlabelled).
      if (CHAT_SCOPED.test(userWords(context))) {
        return {
          ok: true,
          content: "Not stored long-term: the user asked to keep this to this chat. It stays in this chat's history — no further action needed.",
        };
      }
      // What she stores from a chat says which chat it came from, so a
      // later recall in another chat can tell the user where it was learned.
      const chat = currentChat(context);
      const summary = chat && !/\(learned in the chat /.test(raw) ? `${raw} (learned in the chat “${chat.title}”)` : raw;
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
      // The content exactly as given — str() trims, which silently dropped
      // a file's trailing newline (measured: a read-back did not match).
      if (typeof args.content !== "string") {
        return { ok: false, content: `No content was supplied for "${path}", so nothing was written.` };
      }
      const content = args.content;
      if (!path) return { ok: false, content: "sandbox.write requires a path." };
      const { default: SandboxFS } = await import("../engineering/SandboxFS");
      const result = SandboxFS.getInstance().write(path, content);
      return result.ok
        ? { ok: true, content: `Wrote ${content.length} character(s) to "${path}".` }
        : { ok: false, content: result.error ?? `Could not write "${path}".` };
    },
  },

  {
    id: "sandbox.execute",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The sandbox file to run (for kind 'run')." },
        kind: {
          type: "string",
          enum: ["run", "test", "syntax"],
          description: "run an entry file, run the sandbox test files, or syntax-check every JS file. Defaults to run.",
        },
        timeoutMs: { type: "number", description: "Execution limit in ms (100–30000). Defaults to 8000." },
      },
    },
    run: async (args) => {
      const { default: SandboxRuntime } = await import("../engineering/SandboxRuntime");
      const kind = (["run", "test", "syntax"].includes(str(args, "kind")) ? str(args, "kind") : "run") as "run" | "test" | "syntax";
      const path = str(args, "path");
      if (kind === "run" && !path) return { ok: false, content: "sandbox.execute (run) requires the path of the file to run." };
      const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
      const runtime = SandboxRuntime.getInstance();
      // The worker's own verdict, reported as it came back: exit code,
      // timeout and both streams. Nothing here decides it "worked".
      const result =
        kind === "test" ? await runtime.test(timeoutMs)
        : kind === "syntax" ? await runtime.syntaxCheck(timeoutMs)
        : await runtime.runFile(path, timeoutMs);
      const verdict = result.timedOut
        ? "TIMED OUT — the worker was terminated"
        : result.ok ? "PASSED" : "FAILED";
      const streams =
        `stdout:\n${result.stdout.trim() || "(empty)"}\n\nstderr:\n${result.stderr.trim() || "(empty)"}`;
      return {
        ok: result.ok,
        content: `${kind}${path ? ` ${path}` : ""} exited ${result.exitCode} after ${result.durationMs}ms (${verdict}).\n\n${streams.slice(0, 6000)}`,
        data: { exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs, tests: result.tests },
      };
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
        startLine: { type: "number", description: "First line to read (1-based). Default 1." },
        endLine: {
          type: "number",
          description: "Last line to read. Default startLine + 249. Use project_search line numbers to read just the part you need.",
        },
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
      // A window of lines, not the whole file. Whole-file reads (up to 60k
      // characters each) were resent with every later round of the tool
      // loop; four of them exhausted the model providers mid-task in the
      // self-improvement run. Line numbers match project_search's.
      const lines = result.content.split("\n");
      const total = lines.length;
      const startLine = Math.max(1, Math.floor(Number(args.startLine) || 1));
      const endLine = Math.min(total, Math.max(startLine, Math.floor(Number(args.endLine) || startLine + 249)));
      const width = String(endLine).length;
      const body = lines
        .slice(startLine - 1, endLine)
        .map((line, index) => `${String(startLine + index).padStart(width, " ")}| ${line}`)
        .join("\n");
      const more = endLine < total ? `\n…lines ${endLine + 1}–${total} not shown (read them with startLine=${endLine + 1}).` : "";
      return {
        ok: true,
        content: `${path} — lines ${startLine}–${endLine} of ${total} (the "N| " prefixes are line numbers, not part of the file):\n${body}${more}`,
        data: { totalLines: total, startLine, endLine },
      };
    },
  },

  {
    id: "project.edit",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "The sandbox workspace id." },
        path: { type: "string", description: "File path relative to the copy." },
        find: {
          type: "string",
          description: "The exact text to replace, copied from the file WITHOUT the line-number prefixes. Must occur exactly once.",
        },
        replace: { type: "string", description: "The new text that takes its place." },
      },
      required: ["workspace", "path", "find", "replace"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      const path = str(args, "path");
      if (!workspace || !path) return { ok: false, content: "project.edit requires workspace and path." };
      if (typeof args.find !== "string" || !args.find || typeof args.replace !== "string") {
        return { ok: false, content: "project.edit needs the exact text to find and the replacement; nothing was changed." };
      }
      const find = args.find;
      const replace = args.replace;
      const workspaceService = EngineeringWorkspace.getInstance();
      const current = await workspaceService.readFile(workspace, path);
      if (!current.ok) return { ok: false, content: current.error };
      const count = current.content.split(find).length - 1;
      if (count !== 1) {
        return {
          ok: false,
          content:
            count === 0
              ? `The text to find does not occur in ${path}; nothing was changed. Copy it exactly from project_read (without the "N| " line-number prefixes).`
              : `The text to find occurs ${count} times in ${path}; nothing was changed. Include more surrounding lines so it is unique.`,
        };
      }
      const at = current.content.indexOf(find);
      const next = current.content.slice(0, at) + replace + current.content.slice(at + find.length);
      const written = await workspaceService.writeFile(workspace, path, next);
      if (!written.ok) return { ok: false, content: written.error };
      const line = current.content.slice(0, at).split("\n").length;
      return {
        ok: true,
        content: `Edited ${path} at line ${line}: replaced ${find.split("\n").length} line(s) with ${replace.split("\n").length}. The real project is untouched.`,
        data: { line },
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
        content: {
          type: "string",
          description:
            "The COMPLETE new contents of the file. This REPLACES the file, so include every " +
            "line you want to keep — anything omitted is deleted.",
        },
        allowShrink: {
          type: "boolean",
          description:
            "Confirm that removing a large part of an existing file is intended. Required when " +
            "the new content is substantially shorter than the current file.",
        },
      },
      required: ["workspace", "path", "content"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = str(args, "workspace");
      const path = str(args, "path");
      if (!workspace || !path) return { ok: false, content: "project.write requires workspace and path." };

      // A MISSING content argument is a truncated tool call, not an
      // instruction to empty the file.
      //
      // The model's tool_use block is JSON; when the response hits its
      // output limit the block is cut off and `content` arrives absent
      // or partial. Coercing that to "" wrote a zero-byte file over a
      // 202-line one and reported success — observed live, after which
      // the model retried the same call three times because the result
      // it was told about did not match what it had asked for. Refusing
      // is the only safe reading: deleting a file is project.delete.
      if (typeof args.content !== "string") {
        return {
          ok: false,
          content:
            `No content was supplied for "${path}", so nothing was written and the file is ` +
            `unchanged. This usually means the tool call was truncated because the file is large. ` +
            `Write it in smaller pieces, or use project.delete if removal was intended.`,
        };
      }
      const content = args.content;
      const service = EngineeringWorkspace.getInstance();

      // A WHOLE-FILE WRITE CAN DESTROY WHAT IT DOES NOT REPEAT.
      //
      // This tool replaces a file entirely, so a model asked to "append
      // a test" that emits only the new test silently deletes the rest.
      // Measured: a 192-line test file came back as 57 lines with nine
      // tests gone, and every downstream check passed — typecheck does
      // not care about deleted tests, so post-apply validation was green
      // on a destructive change.
      //
      // So a large shrink must be INTENDED, not incidental: the write is
      // refused unless the caller says so, and the refusal reports the
      // real sizes. This is a confirmation step, not a veto.
      const existing = await service.readFile(workspace, path);
      if (existing.ok) {
        const beforeLines = existing.content.split("\n").length;
        const afterLines = content.split("\n").length;
        const shrank = beforeLines - afterLines;
        if (beforeLines >= 20 && shrank > 0 && afterLines < beforeLines * 0.7 && args.allowShrink !== true) {
          return {
            ok: false,
            content:
              `Nothing was written: this would replace "${path}" (${beforeLines} lines) with ` +
              `${afterLines} lines, removing ${shrank}. project.write replaces the WHOLE file, so ` +
              `content you do not repeat is deleted. If you meant to edit part of it, re-send the ` +
              `complete file including the parts you are keeping. If the removal is intended, ` +
              `set allowShrink: true.`,
          };
        }
      }

      const result = await service.writeFile(workspace, path, content);
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
      const state = EngineeringWorkspace.getInstance().getState();
      const post = state.postApply
        ? `\n\nPost-apply validation of the REAL project: exit ${state.postApply.exitCode} ` +
          `(${state.postApply.ok ? "PASSED" : "FAILED"}).` +
          (state.postApply.ok ? "" : `\n${state.postApply.output.slice(0, 2000)}`)
        : "";
      return {
        // A failed post-apply check is a failed operation, even though
        // the files were written: reporting it as success is how a
        // broken project gets called done.
        ok: state.postApply ? state.postApply.ok : true,
        content:
          `Applied ${result.applied.length} file(s) to the real project, authorized by ` +
          `${result.authorizedBy}: ${result.applied.join(", ")}${post}`,
        data: { applied: result.applied, postApply: state.postApply },
      };
    },
  },

  /* ---------------- GitHub (through the server proxy) ---------------- */

  {
    id: "github.auth",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { default: GitHubIntegration } = await import("../engineering/GitHubIntegration");
      const status = await GitHubIntegration.getInstance().getStatus();
      return status.configured && status.user
        ? { ok: true, content: `GitHub is connected as ${status.user.login}.`, data: { login: status.user.login } }
        : { ok: false, content: `GitHub is not connected: ${status.error ?? "no token is configured on the server."}` };
    },
  },

  {
    id: "github.repos",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner. Omit both owner and repo to list accessible repositories." },
        repo: { type: "string", description: "Repository name." },
      },
    },
    run: async (args) => {
      const { default: GitHubIntegration } = await import("../engineering/GitHubIntegration");
      const github = GitHubIntegration.getInstance();
      const owner = str(args, "owner");
      const repo = str(args, "repo");
      if (owner && repo) {
        const result = await github.call<{ full_name: string; default_branch: string; private: boolean; permissions?: Record<string, boolean>; pushed_at?: string }>(`/repos/${owner}/${repo}`);
        if (!result.ok) return { ok: false, content: result.error ?? "GitHub request failed." };
        const data = result.data;
        return {
          ok: true,
          content:
            `${data.full_name} — default branch ${data.default_branch}, ${data.private ? "private" : "public"}` +
            `${data.permissions ? `, permissions: ${Object.entries(data.permissions).filter(([, v]) => v).map(([k]) => k).join(", ")}` : ""}` +
            `${data.pushed_at ? `, last push ${data.pushed_at}` : ""}.`,
          data,
        };
      }
      const result = await github.call<Array<{ full_name: string }>>("/user/repos?per_page=50&sort=pushed");
      if (!result.ok || !Array.isArray(result.data)) return { ok: false, content: result.error ?? "GitHub request failed." };
      return { ok: true, content: result.data.map((entry) => entry.full_name).join("\n") || "(no repositories)", data: { count: result.data.length } };
    },
  },

  {
    id: "github.files",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string", description: "File or directory path in the repository. '' for the root." },
        ref: { type: "string", description: "Branch, tag or commit sha. Defaults to the default branch." },
      },
      required: ["owner", "repo"],
    },
    run: async (args) => {
      const { default: GitHubIntegration } = await import("../engineering/GitHubIntegration");
      const owner = str(args, "owner");
      const repo = str(args, "repo");
      const path = str(args, "path").replace(/^\/+/, "");
      const ref = str(args, "ref");
      const result = await GitHubIntegration.getInstance().call<unknown>(
        `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
      );
      if (!result.ok) return { ok: false, content: result.error ?? "GitHub request failed." };
      if (Array.isArray(result.data)) {
        const entries = result.data as Array<{ path: string; type: string; size?: number }>;
        return { ok: true, content: entries.map((entry) => `${entry.type === "dir" ? "[dir] " : "      "}${entry.path}`).join("\n"), data: { count: entries.length } };
      }
      const file = result.data as { path?: string; sha?: string; content?: string; encoding?: string; size?: number };
      if (typeof file.content !== "string") return { ok: false, content: `"${path}" is not a readable file.` };
      const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), (char) => char.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      const MAX = 60_000;
      return {
        ok: true,
        content: text.length > MAX ? `${text.slice(0, MAX)}\n…[truncated at ${MAX} characters of ${text.length}]` : text,
        data: { path: file.path, sha: file.sha, size: file.size, ref: ref || "(default branch)" },
      };
    },
  },

  {
    id: "github.branches",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        action: { type: "string", enum: ["list", "create"], description: "Defaults to list." },
        name: { type: "string", description: "For create: the new branch name. Never the default branch." },
        from: { type: "string", description: "For create: the branch to start from. Defaults to the default branch." },
      },
      required: ["owner", "repo"],
    },
    run: async (args) => {
      const { default: GitHubIntegration } = await import("../engineering/GitHubIntegration");
      const github = GitHubIntegration.getInstance();
      const owner = str(args, "owner");
      const repo = str(args, "repo");
      if (str(args, "action") !== "create") {
        const result = await github.call<Array<{ name: string; commit: { sha: string } }>>(`/repos/${owner}/${repo}/branches?per_page=100`);
        if (!result.ok || !Array.isArray(result.data)) return { ok: false, content: result.error ?? "GitHub request failed." };
        return { ok: true, content: result.data.map((branch) => `${branch.name} ${branch.commit.sha.slice(0, 8)}`).join("\n"), data: { count: result.data.length } };
      }
      const refused = githubWriteRefusal();
      if (refused) return { ok: false, content: refused };
      const name = str(args, "name");
      if (!name) return { ok: false, content: "Creating a branch needs a name." };
      const repoInfo = await github.call<{ default_branch: string }>(`/repos/${owner}/${repo}`);
      if (!repoInfo.ok) return { ok: false, content: repoInfo.error ?? "GitHub request failed." };
      if (name === repoInfo.data.default_branch) return { ok: false, content: `"${name}" is the default branch; work happens on a new branch.` };
      const from = str(args, "from") || repoInfo.data.default_branch;
      const base = await github.call<{ commit: { sha: string } }>(`/repos/${owner}/${repo}/branches/${encodeURIComponent(from)}`);
      if (!base.ok) return { ok: false, content: base.error ?? `Could not read branch "${from}".` };
      const created = await github.call<{ ref: string; object: { sha: string } }>(`/repos/${owner}/${repo}/git/refs`, "POST", {
        ref: `refs/heads/${name}`,
        sha: base.data.commit.sha,
      });
      if (!created.ok) return { ok: false, content: `Branch "${name}" was NOT created: ${created.error}` };
      return { ok: true, content: `Created branch ${name} on GitHub at ${created.data.object.sha} (from ${from}).`, data: { branch: name, sha: created.data.object.sha } };
    },
  },

  {
    id: "github.commits",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        action: { type: "string", enum: ["list", "show", "commit"], description: "Defaults to list." },
        branch: { type: "string", description: "list: the branch to list. commit: the branch to commit to (never the default branch)." },
        sha: { type: "string", description: "show: the commit to read." },
        path: { type: "string", description: "commit: the file to create or replace." },
        content: { type: "string", description: "commit: the COMPLETE new file content." },
        message: { type: "string", description: "commit: the commit message." },
      },
      required: ["owner", "repo"],
    },
    run: async (args) => {
      const { default: GitHubIntegration } = await import("../engineering/GitHubIntegration");
      const github = GitHubIntegration.getInstance();
      const owner = str(args, "owner");
      const repo = str(args, "repo");
      const action = str(args, "action") || "list";
      if (action === "show") {
        const sha = str(args, "sha");
        const result = await github.call<{ sha: string; commit: { message: string; author: { name: string; date: string } }; files?: Array<{ filename: string; status: string; additions: number; deletions: number }> }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`);
        if (!result.ok) return { ok: false, content: result.error ?? "GitHub request failed." };
        const files = (result.data.files ?? []).map((file) => `${file.status} ${file.filename} (+${file.additions}/-${file.deletions})`).join("\n");
        return { ok: true, content: `${result.data.sha}\n${result.data.commit.message}\n\n${files}`, data: { sha: result.data.sha } };
      }
      if (action === "list") {
        const branch = str(args, "branch");
        const result = await github.call<Array<{ sha: string; commit: { message: string } }>>(`/repos/${owner}/${repo}/commits?per_page=10${branch ? `&sha=${encodeURIComponent(branch)}` : ""}`);
        if (!result.ok || !Array.isArray(result.data)) return { ok: false, content: result.error ?? "GitHub request failed." };
        return { ok: true, content: result.data.map((entry) => `${entry.sha.slice(0, 8)} ${entry.commit.message.split("\n")[0]}`).join("\n"), data: { count: result.data.length } };
      }
      const refused = githubWriteRefusal();
      if (refused) return { ok: false, content: refused };
      const branch = str(args, "branch");
      const path = str(args, "path").replace(/^\/+/, "");
      const message = str(args, "message");
      if (!branch || !path || !message || typeof args.content !== "string") {
        return { ok: false, content: "A GitHub commit needs branch, path, content and message; nothing was committed." };
      }
      const repoInfo = await github.call<{ default_branch: string }>(`/repos/${owner}/${repo}`);
      if (!repoInfo.ok) return { ok: false, content: repoInfo.error ?? "GitHub request failed." };
      if (branch === repoInfo.data.default_branch) {
        return { ok: false, content: `Nothing was committed: "${branch}" is the default branch. Commit to a working branch.` };
      }
      // Replacing a file needs its current blob sha on that branch.
      const existing = await github.call<{ sha?: string }>(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
      const put = await github.putFile(owner, repo, path, args.content, message, branch, existing.ok ? existing.data.sha : undefined);
      if (!put.ok || !put.data.commit?.sha) return { ok: false, content: `Nothing was committed: ${put.error ?? "GitHub returned no commit."}` };
      // Confirmed by GitHub, not by the write's own reply: read the commit back.
      const confirmed = await github.call<{ sha: string }>(`/repos/${owner}/${repo}/commits/${put.data.commit.sha}`);
      if (!confirmed.ok) {
        return { ok: false, content: `GitHub accepted the write but the commit ${put.data.commit.sha} could not be read back: ${confirmed.error}` };
      }
      return {
        ok: true,
        content: `Committed ${confirmed.data.sha} to ${owner}/${repo}@${branch}: ${path}. GitHub confirms the commit exists.`,
        data: { sha: confirmed.data.sha, branch, path },
      };
    },
  },

  {
    id: "github.prs",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        action: { type: "string", enum: ["list", "create"], description: "Defaults to list." },
        title: { type: "string" },
        head: { type: "string", description: "create: the branch with the changes." },
        base: { type: "string", description: "create: the branch to merge into." },
        body: { type: "string" },
      },
      required: ["owner", "repo"],
    },
    run: async (args) => {
      const { default: GitHubIntegration } = await import("../engineering/GitHubIntegration");
      const github = GitHubIntegration.getInstance();
      const owner = str(args, "owner");
      const repo = str(args, "repo");
      if (str(args, "action") !== "create") {
        const result = await github.call<Array<{ number: number; title: string; head: { ref: string } }>>(`/repos/${owner}/${repo}/pulls?state=open`);
        if (!result.ok || !Array.isArray(result.data)) return { ok: false, content: result.error ?? "GitHub request failed." };
        return { ok: true, content: result.data.map((pr) => `#${pr.number} ${pr.title} (${pr.head.ref})`).join("\n") || "(no open pull requests)", data: { count: result.data.length } };
      }
      const refused = githubWriteRefusal();
      if (refused) return { ok: false, content: refused };
      const title = str(args, "title");
      const head = str(args, "head");
      const base = str(args, "base");
      if (!title || !head || !base) return { ok: false, content: "A pull request needs title, head and base; none was opened." };
      const created = await github.call<{ number: number; html_url: string }>(`/repos/${owner}/${repo}/pulls`, "POST", { title, head, base, body: str(args, "body") });
      if (!created.ok) return { ok: false, content: `No pull request was opened: ${created.error}` };
      return { ok: true, content: `Opened pull request #${created.data.number}: ${created.data.html_url}`, data: created.data };
    },
  },

  {
    id: "system.config",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { configCapabilities, describeConfiguration } = await import(
        "../config/ConfigStatus"
      );
      const capabilities = configCapabilities();
      return {
        ok: true,
        content: describeConfiguration(),
        // Structured, and still nothing but names and booleans.
        data: {
          configured: capabilities.filter((entry) => entry.configured).map((entry) => entry.id),
          missing: Object.fromEntries(
            capabilities
              .filter((entry) => !entry.configured)
              .map((entry) => [entry.id, entry.missing]),
          ),
        },
      };
    },
  },

  /* ---------------- workflows ---------------- */

  {
    id: "workflow.list",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { default: AgentWorkflowBridge } = await import("../workflows/AgentWorkflowBridge");
      const offers = AgentWorkflowBridge.getInstance().discover();
      if (offers.length === 0) {
        return { ok: true, content: "No workflows are defined yet." };
      }
      const lines = offers.map((offer) => {
        const state = offer.runnable
          ? "runnable"
          : `BLOCKED — ${offer.blockers.join("; ")}`;
        return `- ${offer.name} (id ${offer.id}) — ${offer.stepCount} step(s), ${state}\n    ${offer.description}`;
      });
      return { ok: true, content: lines.join("\n"), data: { count: offers.length } };
    },
  },

  {
    id: "workflow.run",
    parameters: {
      type: "object",
      properties: {
        workflow: { type: "string", description: "The workflow's name or id." },
        reason: { type: "string", description: "Why you are running it, for the execution record." },
        inputs: {
          type: "object",
          description:
            "Values for the workflow's declared inputs, keyed by input name. Required inputs must " +
            "be supplied; if you do not have one, ask the user rather than guessing.",
        },
      },
      required: ["workflow"],
    },
    run: async (args, context) => {
      const [{ default: AgentWorkflowBridge, describeExecution }, { default: WorkflowEngine }] =
        await Promise.all([
          import("../workflows/AgentWorkflowBridge"),
          import("../workflows/WorkflowEngine"),
        ]);

      const identifier = str(args, "workflow");
      if (!identifier) return { ok: false, content: "workflow.run requires a workflow name or id." };

      const bridge = AgentWorkflowBridge.getInstance();
      const workflow = bridge.resolve(identifier);
      if (!workflow) {
        const known = bridge.discover().map((offer) => offer.name).join(", ") || "(none defined)";
        return {
          ok: false,
          content: `No workflow matches "${identifier}". Known workflows: ${known}.`,
        };
      }

      const supplied: Record<string, string> = {};
      if (args.inputs && typeof args.inputs === "object" && !Array.isArray(args.inputs)) {
        for (const [key, value] of Object.entries(args.inputs as Record<string, unknown>)) {
          supplied[key] = typeof value === "string" ? value : JSON.stringify(value);
        }
      }

      const execution = await WorkflowEngine.getInstance().run(
        workflow.id,
        {
          kind: "chat",
          taskId: String((context?.request as { timestamp?: number } | undefined)?.timestamp ?? ""),
          reason: str(args, "reason"),
        },
        supplied,
      );

      // The model receives the REAL step-by-step account, not a verdict.
      // A partial or failed run is reported as such, so it can decide
      // whether to retry, fall back, or stop.
      return {
        ok: execution.status === "succeeded",
        content: describeExecution(execution),
        data: {
          invocationId: execution.id,
          status: execution.status,
          steps: execution.steps.map((step) => ({
            id: step.stepId,
            status: step.status,
            tool: step.tool,
          })),
        },
      };
    },
  },

  {
    id: "workflow.author",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "A short, distinctive name for the workflow." },
        description: {
          type: "string",
          description: "What the workflow is for, so a future cycle can decide whether it fits.",
        },
        outputs: { type: "string", description: "What a successful run produces." },
        id: {
          type: "string",
          description:
            "Only when deliberately REPLACING an existing workflow: its id. Omit to create a new one.",
        },
        inputs: {
          type: "array",
          description: "Values a caller must supply, referenced in step arguments as {{input.<name>}}.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              required: { type: "boolean" },
            },
            required: ["name", "description"],
          },
        },
        steps: {
          type: "array",
          description:
            "The steps, in any order — dependencies decide execution order. Each step calls an " +
            "EXISTING tool; there is no field for code and none will be accepted.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short id, letters/digits/_/- only." },
              name: { type: "string", description: "What this step does, in plain words." },
              tool: {
                type: "string",
                description:
                  "An existing tool, named exactly as you would call it (e.g. project_manage) or " +
                  "by its registry id (project.manage). Both forms are accepted; a tool that does " +
                  "not exist is rejected and the error lists the ones that do.",
              },
              arguments: {
                type: "object",
                description:
                  "Arguments for the tool. A string may embed {{input.<name>}} or " +
                  "{{steps.<stepId>.output}}, where that step is one this step dependsOn.",
              },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description: "Step ids that must SUCCEED first. If one fails, this step is skipped.",
              },
              after: {
                type: "array",
                items: { type: "string" },
                description:
                  "Step ids that must merely have RUN first, whatever the outcome. Use this for a " +
                  "fallback: order it after the step it compensates for, and gate it with a " +
                  "condition on that step having failed.",
              },
              optional: { type: "boolean", description: "A failure here does not fail the run." },
              condition: {
                type: "object",
                description:
                  "BRANCH: run this step only if the condition holds over an earlier step it " +
                  "depends on. Otherwise it is skipped, and so is anything depending on it.",
                properties: {
                  step: { type: "string" },
                  operator: {
                    type: "string",
                    enum: ["succeeded", "failed", "contains", "not-contains", "equals", "empty", "not-empty"],
                  },
                  value: { type: "string" },
                },
                required: ["step", "operator"],
              },
              retry: {
                type: "object",
                description: "RETRY a transient failure with the same arguments.",
                properties: {
                  maxAttempts: { type: "number", description: "1 to 5, including the first attempt." },
                  when: { type: "string", description: "Only retry when the error text contains this." },
                },
                required: ["maxAttempts"],
              },
              loop: {
                type: "object",
                description:
                  "LOOP: repeat this step until the condition holds, up to maxIterations (1-10). " +
                  "Reference {{steps.<this step>.output}} in its own arguments to revise its work.",
                properties: {
                  until: {
                    type: "object",
                    properties: {
                      step: { type: "string" },
                      operator: {
                        type: "string",
                        enum: ["succeeded", "failed", "contains", "not-contains", "equals", "empty", "not-empty"],
                      },
                      value: { type: "string" },
                    },
                    required: ["operator"],
                  },
                  maxIterations: { type: "number" },
                },
                required: ["until", "maxIterations"],
              },
              onFailure: {
                type: "object",
                description:
                  "FAILURE PATH: fail (default), continue, stop the run, or escalate to a person.",
                properties: {
                  action: { type: "string", enum: ["fail", "continue", "stop", "escalate"] },
                  escalate: {
                    type: "string",
                    description: "For escalate: exactly what the person must decide.",
                  },
                },
                required: ["action"],
              },
              terminateWhen: {
                type: "object",
                description:
                  "TERMINATION: end the run early, successfully, when this holds after the step.",
                properties: {
                  step: { type: "string" },
                  operator: {
                    type: "string",
                    enum: ["succeeded", "failed", "contains", "not-contains", "equals", "empty", "not-empty"],
                  },
                  value: { type: "string" },
                },
                required: ["operator"],
              },
            },
            required: ["id", "name", "tool"],
          },
        },
      },
      required: ["name", "description", "outputs", "steps"],
    },
    run: async (args) => {
      const { authorWorkflow } = await import("../workflows/WorkflowAuthoring");
      const result = authorWorkflow(args as Record<string, unknown>);

      if (!result.ok || !result.workflow) {
        // A rejected draft returns every problem at once, so the next
        // attempt can fix all of them — and NOTHING was stored.
        return {
          ok: false,
          content:
            `The workflow was NOT created. ${result.errors.length} problem(s):\n` +
            result.errors.map((error) => `  • ${error}`).join("\n") +
            (result.warnings.length
              ? `\nAlso note:\n${result.warnings.map((warning) => `  • ${warning}`).join("\n")}`
              : ""),
          data: { errors: result.errors, warnings: result.warnings },
        };
      }

      const blocked = (result.preflight ?? []).filter((entry) => !entry.runnable);
      const { emitCognition } = await import("../agent/AgentEvents");
      emitCognition(
        "workflow-authored",
        `“${result.workflow.name}” (${result.workflow.steps.length} steps): ` +
          result.workflow.steps.map((step) => step.tool).join(" → "),
        {
          data: {
            workflowId: result.workflow.id,
            tools: result.workflow.steps.map((step) => step.tool),
            runnable: blocked.length === 0,
          },
        },
      );
      return {
        ok: true,
        content:
          `Workflow “${result.workflow.name}” saved (id ${result.workflow.id}) with ` +
          `${result.workflow.steps.length} step(s): ` +
          `${result.workflow.steps.map((step) => step.tool).join(" → ")}. ` +
          (blocked.length
            ? `NOT runnable right now — ${blocked.map((entry) => `${entry.stepId}: ${entry.reason}`).join("; ")}`
            : "Runnable now.") +
          (result.warnings.length
            ? `\nWarnings:\n${result.warnings.map((warning) => `  • ${warning}`).join("\n")}`
            : ""),
        data: {
          workflowId: result.workflow.id,
          runnable: blocked.length === 0,
          warnings: result.warnings,
        },
      };
    },
  },

  {
    id: "workflow.status",
    parameters: {
      type: "object",
      properties: {
        invocationId: {
          type: "string",
          description: "The invocation id from a previous run. Omit for the most recent execution.",
        },
      },
    },
    run: async (args) => {
      const [{ default: WorkflowStore }, { describeExecution }] = await Promise.all([
        import("../workflows/WorkflowStore"),
        import("../workflows/AgentWorkflowBridge"),
      ]);
      const store = WorkflowStore.getInstance();
      const wanted = str(args, "invocationId");
      const execution = wanted ? store.execution(wanted) : store.executions()[0];
      if (!execution) {
        return {
          ok: false,
          content: wanted
            ? `No execution with invocation id ${wanted}.`
            : "No workflow has been executed yet.",
        };
      }
      return { ok: true, content: describeExecution(execution), data: { status: execution.status } };
    },
  },

  {
    id: "project.git",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "diff", "log"], description: "What to read." },
        full: { type: "boolean", description: "For 'diff', return the full patch instead of a summary." },
        count: { type: "number", description: "For 'log', how many commits." },
      },
      required: ["action"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const workspace = EngineeringWorkspace.getInstance();
      const action = str(args, "action") || "status";
      if (action === "diff") {
        const diff = await workspace.gitDiff(args.full === true);
        return { ok: true, content: diff.trim() || "(no uncommitted changes)" };
      }
      if (action === "log") {
        const log = await workspace.gitLog(Number(args.count) || 5);
        return { ok: true, content: log.trim() || "(no commits)" };
      }
      const status = await workspace.gitStatus();
      if (!status.ok) return { ok: false, content: status.error ?? "git status failed" };
      return {
        ok: true,
        content: `branch: ${status.branch}\n${status.status.trim() || "(clean working tree)"}`,
      };
    },
  },

  {
    id: "project.commit",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The commit message. Describe what changed and why." },
      },
      required: ["message"],
    },
    run: async (args) => {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      const message = str(args, "message");
      if (!message) return { ok: false, content: "project.commit requires a message." };
      const result = await EngineeringWorkspace.getInstance().gitCommit(message);
      if (!result.ok) return { ok: false, content: result.error };
      return {
        ok: true,
        content:
          `Committed ${result.sha.slice(0, 8)}, authorized by ${result.authorizedBy}.\n\n${result.show.trim()}`,
        data: { sha: result.sha },
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
  // Applying and committing both reach the real project, so both need
  // a human authorization rather than merely a permission level.
  if (id === "project.apply" || id === "project.commit") {
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
  if ((id === "project.apply" || id === "project.commit") && !authorizedWorkspaceExists()) {
    let detail = "";
    try {
      detail = ` ${EngineeringAuthorization.getInstance().preflight().reason}`;
    } catch {
      detail = "";
    }
    return (
      `"${id}" was NOT run: changing the real project requires an explicit ` +
      `authorization from the signed-in user, and none is currently held.${detail} ` +
      `The sandbox copy is unchanged and nothing was written to the real project.`
    );
  }
  if (!AutonomyGate.getInstance().can(riskToAutonomy(definition.riskLevel))) {
    return `"${id}" is not permitted at the current autonomy level, so it was not run.`;
  }
  return `"${id}" is not permitted right now, so it was not run.`;
}

/**
 * Why a GitHub write may not happen now, or null when it may be attempted.
 *
 * The same identity requirement as changing the real project: a model
 * cannot publish to GitHub on its own say-so. This is the early, accurate
 * refusal; the server proxy enforces it again (verified identity,
 * LELU_ALLOW_PUSH, never the default branch) before anything is sent.
 */
function githubWriteRefusal(): string | null {
  try {
    const preflight = EngineeringAuthorization.getInstance().preflight();
    return preflight.ready ? null : `Nothing was written to GitHub: ${preflight.reason}`;
  } catch {
    return "Nothing was written to GitHub: no authenticated session could be established.";
  }
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
    // Registered is not the same as runnable: say which this is.
    const registered = ToolRegistry.getInstance().get(id);
    return {
      ok: false,
      content: registered
        ? `"${id}" is registered but has no executor — there is no real dispatch for it, so nothing was executed.`
        : `There is no tool named "${call.name}", so nothing was executed.`,
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
    const label = describeToolCall(id, call.arguments ?? {});
    events.emit({ type: "tool_selected", taskId, tool: id, label });
    events.emit({ type: "tool_started", taskId, tool: id, label });
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
