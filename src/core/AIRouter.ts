/**
 * ==========================================================
 * LÉLU
 * AI ROUTER
 * ==========================================================
 */

import type { AIResponse } from "../providers/AIProvider";
import type RouterContext from "./router/RouterContext";
import BrainResolver from "./router/BrainResolver";
import PlanningResolver from "./router/PlanningResolver";
import ReasoningResolver from "./router/ReasoningResolver";
import ResearchResolver from "./router/ResearchResolver";
import BrowserResolver from "./router/BrowserResolver";
import WorkspaceResolver from "./router/WorkspaceResolver";
import ProviderResolver from "./router/ProviderResolver";
import EngineeringResolver from "./router/EngineeringResolver";
import CreativeResolver from "./router/CreativeResolver";
import ToolResolver from "./router/ToolResolver";
import DeflockResolver from "./router/DeflockResolver";
import TimeResolver from "./router/TimeResolver";
import ProjectResolver from "./router/ProjectResolver";
import ToolCallInterceptor from "./router/ToolCallInterceptor";
import ResponseBuilder from "./router/ResponseBuilder";
import AvatarResolver from "./router/AvatarResolver";
import SurfaceResolver from "./router/SurfaceResolver";
import CognitiveStateResolver from "./router/CognitiveStateResolver";
import CapabilityManifest from "./capabilities/CapabilityManifest";
import ToolRegistry from "./tools/ToolRegistry";
import WorkflowStore from "./workflows/WorkflowStore";
import { cleanAssistantText } from "./router/ToolMarkup";

export default class AIRouter {
  private readonly time = new TimeResolver();
  private readonly interceptor = new ToolCallInterceptor();

  constructor(
    private readonly brain: BrainResolver,
    private readonly research: ResearchResolver,
    private readonly providers: ProviderResolver,
    private readonly browser = new BrowserResolver(),
    private readonly workspace = new WorkspaceResolver(),
    private readonly planning = new PlanningResolver(),
    private readonly reasoning = new ReasoningResolver(),
    private readonly engineering = new EngineeringResolver(),
    private readonly creative = new CreativeResolver(),
    private readonly tools = new ToolResolver(),
    private readonly deflock = new DeflockResolver(),
    private readonly projects = new ProjectResolver(),
    private readonly avatar = new AvatarResolver(),
    private readonly surfaces: SurfaceResolver = new SurfaceResolver(workspace),
    private readonly cognitiveState = new CognitiveStateResolver(),
    private readonly responses = new ResponseBuilder(),
  ) {}

  /**
   * Can the MODEL do this piece of engineering work itself, for real?
   *
   * True only when both halves hold: the request is engineering-shaped
   * (reusing EngineeringResolver's own classifier rather than adding a
   * second one), and the workspace tools are actually available — which
   * ToolRegistry marks only after a successful runtime probe. Anything
   * less and the existing resolvers keep the turn.
   */
  private modelCanDoEngineeringWork(context: RouterContext): boolean {
    const copyTool = ToolRegistry.getInstance().get("project.copy");
    if (!copyTool?.available) return false;
    return this.engineering.isEngineeringPrompt(context.request.prompt ?? "");
  }

  /**
   * Is this a request to use a WORKFLOW that actually exists?
   *
   * The intent detector reads "run the workflow that fits and tell me
   * what each step produced" as a project request, so ProjectResolver
   * claimed the turn and answered by creating a project from text
   * parsing — the model never saw workflow_list or workflow_run, and no
   * workflow ran. Measured: executions recorded 0 while the reply
   * described an audit it had not performed.
   *
   * Narrow on purpose, and grounded in real state rather than wording
   * alone: the tools must be available AND at least one workflow must
   * actually be defined. With nothing to run, the previous behaviour is
   * exactly as before.
   */
  private modelCanRunWorkflow(context: RouterContext): boolean {
    const runTool = ToolRegistry.getInstance().get("workflow.run");
    if (!runTool?.available) return false;

    let defined = 0;
    try {
      defined = WorkflowStore.getInstance().list().length;
    } catch {
      return false;
    }
    if (defined === 0) return false;

    return /\bworkflows?\b|\bautomation\b|\bre-?usable (?:steps|process)\b/i.test(
      context.request.prompt ?? "",
    );
  }

  /** Route an AI request. */
  public async route(context: RouterContext): Promise<AIResponse> {
    // 0. TIME — deterministic local capability, no external API needed
    const timeResult = await this.time.execute(context);
    if (timeResult.handled && timeResult.response) return timeResult.response;

    // 0.5 COGNITIVE STATE — "what are you thinking about?" REPORTS the
    // autonomous self-study state that already exists. It is a pure read:
    // it runs no cycle, starts no loop and calls no provider, so a chat
    // request can never be the thing that created the state it reports.
    // Must precede the brain stage, whose identity matcher would
    // otherwise claim "what are you …" and answer with the identity
    // statement instead.
    const cognitiveState = await this.cognitiveState.execute(context);
    if (cognitiveState.handled && cognitiveState.response) return cognitiveState.response;

    // 1. Brain / identity — always local
    const brain = await this.brain.execute(context);
    if (brain.handled && brain.response) return brain.response;

    // 1.5 Explicit surface commands — "open the browser", "show me the
    // 3d", "take me into gen v2". Chat is the primary control surface:
    // these EXECUTE the real UI state transition deterministically,
    // before any research/creative stage could misroute them.
    const surface = await this.surfaces.execute(context);
    if (surface.handled && surface.response) return surface.response;

    await this.planning.execute(context);
    await this.reasoning.execute(context);

    // Tool / device calls
    const tools = await this.tools.execute(context);
    if (tools.handled && tools.response) return this.attachThinking(context, tools.response);

    const engineering = await this.engineering.execute(context);
    if (engineering.handled && engineering.response) return this.attachThinking(context, engineering.response);

    const creative = await this.creative.execute(context);
    if (creative.handled && creative.response) return this.attachThinking(context, creative.response);

    // Avatar / embodiment commands — LÉLU's own visual identity executes
    // against the saved avatar runtime. MUST run before any research so
    // "update your avatar to 3d render and simulations" never becomes a
    // knowledge-search request.
    const avatarResult = await this.avatar.execute(context);
    if (avatarResult.handled && avatarResult.response) {
      return this.attachThinking(context, avatarResult.response);
    }
    // handled:false ⇒ facts attached to context; the provider answers
    // over the real avatar state below.

    // Project commands — create, run, pause, resume, results.
    //
    // STAND ASIDE FOR REAL ENGINEERING WORK.
    //
    // The intent detector classifies "copy the project, change this file,
    // run typecheck" as `project`, so ProjectResolver used to claim the
    // turn and answer by CREATING A PROJECT from text parsing — the
    // model never saw the request, and no file was ever touched. Now
    // that LÉLU has real workspace tools, a request to operate on the
    // codebase belongs to the model: it can copy, read, edit, validate
    // and iterate for real, and it decides which of those are needed.
    //
    // The condition is deliberately narrow. It requires the engineering
    // runtime to be genuinely reachable (project.copy is marked
    // available only by a successful probe), so where no runtime exists
    // the old project-creation behaviour is exactly as before.
    if (
      context.intent === "project" &&
      !this.modelCanDoEngineeringWork(context) &&
      !this.modelCanRunWorkflow(context)
    ) {
      const projectResult = await this.projects.execute(context);
      if (projectResult.handled && projectResult.response) {
        return this.attachThinking(context, projectResult.response);
      }
      // handled:false ⇒ not a recognized project command;
      // fall through so the model can respond conversationally.
    }

    // News / current events → live retrieval MUST happen before any
    // generation. The user's original prompt is preserved (topic kept,
    // filler stripped inside ResearchResolver). ResearchResolver injects
    // the retrieved digest into cognition context; handled:true here
    // means either an offline digest response OR the complete retrieval
    // chain genuinely failed — never a silent fallthrough to generic chat.
    //
    // CRITICAL: retrieval runs ONLY for intents that genuinely ask for
    // external information — explicit search/news intents, or ordinary
    // conversation that clearly requests current info. Action intents
    // (project, avatar, engineering, creative, voice, memory, genesis,
    // …) NEVER enter knowledge retrieval: an execution command like
    // "Start the project through Sandbox and use the current saved
    // avatar…" must never be hijacked by GDELT/RSS/News/HackerNews
    // simply because it contains a word like "current" or "update".
    // ResearchResolver applies its own narrower current-info gate for
    // chat intents on top of this.
    if (context.intent === "news" || context.intent === "search") {
      const research = await this.research.execute(context);
      if (research.handled) {
        return this.attachThinking(
          context,
          this.responses.fromResearch(research.results, context.started, research.attempted),
        );
      }
      // handled:false ⇒ results retrieved and attached to context;
      // continue so the AI provider synthesizes the answer from them.
    } else if (context.intent === "chat") {
      const research = await this.research.execute(context);
      if (research.handled) {
        return this.attachThinking(
          context,
          this.responses.fromResearch(research.results, context.started, research.attempted),
        );
      }
    }

    // Deflock/FoggedLens — ALPR camera infrastructure analysis. Runs on
    // camera/surveillance intents, executes REAL Overpass queries, drives
    // the Earth Core (fly-to + ALPR layer), attaches real data to the
    // context, and returns unhandled so the provider answers over facts.
    await this.deflock.execute(context);

    const browser = await this.browser.execute(context);
    if (browser.handled && browser.response) return this.attachThinking(context, browser.response);

    const workspace = await this.workspace.execute(context);
    if (workspace.handled && workspace.response) return this.attachThinking(context, workspace.response);

    const provider = await this.providers.execute(context);
    if (provider.handled && provider.response) {
      // Intercept raw tool-call markup before it reaches chat
      const intercepted = await this.interceptor.intercept(provider.response, context);
      if (intercepted.intercepted && intercepted.response) {
        return this.attachThinking(context, intercepted.response);
      }
      return this.attachThinking(context, provider.response);
    }

    return this.attachThinking(context, this.responses.offline(context.started));
  }

  private attachThinking(context: RouterContext, response: AIResponse): AIResponse {
    // The provider transport may contain XML/JSON tool syntax. It is
    // consumed by the router and never allowed into the normal chat view.
    const cleanText = cleanAssistantText(response.text);
    const sanitized = cleanText === response.text ? response : { ...response, text: cleanText };

    // Mark the intent-based capability as used so CapabilityManifest
    // reflects real invocation, not just configuration.
    this.trackCapabilityUse(context.intent);

    if (!context.reasoning && !context.plan) return sanitized;
    return {
      ...sanitized,
      metadata: {
        ...response.metadata,
        reasoning: context.reasoning,
        plan: context.plan,
      },
    };
  }

  private trackCapabilityUse(intent?: string): void {
    if (!intent || intent === "chat") return;
    const manifest = CapabilityManifest.getInstance();
    const capabilityMap: Record<string, string> = {
      news: "live-news",
      search: "web-search",
      time: "current-time",
      project: "project-execution",
      engineering: "engineering",
      memory: "memory",
      avatar: "avatar",
    };
    const capId = capabilityMap[intent];
    if (capId) {
      manifest.markUsed(capId);
    }
  }
}