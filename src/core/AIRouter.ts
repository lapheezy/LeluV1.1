/**
 * ==========================================================
 * LÉLU
 * AI ROUTER
 * ==========================================================
 */

import { refersToConversationArtifact } from "./studio/StudioTools";
import type { AIResponse } from "../providers/AIProvider";
import type RouterContext from "./router/RouterContext";
import { isMissionResume } from "./router/continuationContext";
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
import DirectResolver from "./router/DirectResolver";
import AcquisitionResolver from "./router/AcquisitionResolver";
import ProjectResolver from "./router/ProjectResolver";
import ToolCallInterceptor from "./router/ToolCallInterceptor";
import ResponseBuilder from "./router/ResponseBuilder";
import AvatarResolver from "./router/AvatarResolver";
import SurfaceResolver from "./router/SurfaceResolver";
import CognitiveStateResolver from "./router/CognitiveStateResolver";
import SpatialResolver from "./router/SpatialResolver";
import IntelligenceResolver from "./router/IntelligenceResolver";
import CapabilityManifest from "./capabilities/CapabilityManifest";
import ToolRegistry from "./tools/ToolRegistry";
import { toolSchemasForModel } from "./tools/ToolSchemas";
import { registryIdForToolName } from "./tools/ToolDispatcher";
import WorkflowStore from "./workflows/WorkflowStore";
import { cleanAssistantText } from "./router/ToolMarkup";
import { beginRoutingTrace, finishRoutingTrace, noteStage } from "./router/RoutingTrace";
import type { BrainResult } from "./router/RouterResults";
import { asksForStudioChange } from "./studio/StudioIntent";

/**
 * An OPERATE-MY-ENVIRONMENT request: a verb that changes what is on screen,
 * aimed at a surface, layout, workspace or artifact.
 *
 * Narrow on purpose. It exists only so the model keeps turns that the
 * keyword project/creative stages used to take: measured, "create a workspace
 * to research X" became a text project and the model never saw it, even
 * though environment.compose could have built the workspace for real.
 */
const ENVIRONMENT_REQUEST =
  /\b(?:open|build|compose|create|make|set ?up|arrange|rearrange|lay ?out|present|show|display|update|revise|change|modify|highlight|trace|compare|save|restore)\b[^.?!]{0,48}\b(?:workspace|environment|surfaces?|layout|artifact|diagram|table|chart|panel|window|on screen|in place)\b/i;

/** A request to make something in 3D or put something in her world. */
const WORLD_REQUEST =
  /\b(?:3d|3-d|three[- ]?d|sculpt\w*|mesh|statue|hologram)\b|\b(?:place|put|add|spawn|build|create|make|grow|raise)\b[^.?!]{0,80}\b(?:in|into|to|inside)\s+(?:my|the|her|our|your)\s+(?:world|cosmos|universe|room|scene|garden)\b/i;

export default class AIRouter {
  private readonly time = new TimeResolver();
  private readonly direct = new DirectResolver();
  private readonly acquisition = new AcquisitionResolver();
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
    private readonly spatial = new SpatialResolver(),
    private readonly intelligence = new IntelligenceResolver(),
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
  /**
   * Is this software the studio can actually build?
   *
   * The project detector claims "create … application" before the model
   * sees it, and its reference guard then asked the user what "the
   * built and tested application" meant. When studio_project_create is really
   * offered, the studio owns the turn: it can scaffold, build, test and
   * preview the software, and the model chooses those tools.
   */
  private modelCanBuildInStudio(context: RouterContext): boolean {
    let studioAvailable = false;
    try {
      studioAvailable = toolSchemasForModel().some((schema) => schema.name === "studio_project_create");
    } catch {
      return false;
    }
    return asksForStudioChange(context.request.prompt ?? "", studioAvailable);
  }

  /**
   * Can the MODEL operate the environment itself, for real?
   *
   * True only when environment.compose is genuinely offered (it has a real
   * executor and is permitted at this autonomy level) AND the request is
   * environment-shaped. Anything less and the existing resolvers keep the
   * turn exactly as before.
   */
  private modelCanComposeEnvironment(context: RouterContext): boolean {
    let offered = false;
    try {
      offered = toolSchemasForModel().some((schema) => schema.name === "environment_compose");
    } catch {
      return false;
    }
    if (!offered) return false;
    return ENVIRONMENT_REQUEST.test(context.request.prompt ?? "");
  }

  /**
   * Can the MODEL build this in her 3D world itself?
   *
   * Measured: "Make a 3D crystal tower and place it in my world." was
   * classified `project`, and ProjectResolver answered "Project created:
   * 3D Crystal Tower" with planning tasks and a web search — no object was
   * made. world.object / world.generate are real executors; when they are
   * offered and the request asks for 3D or for something placed in her
   * world, the model takes the turn, exactly like the studio and workflow
   * cases above.
   */
  private modelCanShapeWorld(context: RouterContext): boolean {
    if (!WORLD_REQUEST.test(context.request.prompt ?? "")) return false;
    try {
      return toolSchemasForModel().some((schema) => schema.name === "world_object" || schema.name === "world_generate");
    } catch {
      return false;
    }
  }

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

  /** Does the user name a tool the model is actually offered (e.g. sandbox_execute)? */
  private namesAnOfferedTool(context: RouterContext): boolean {
    const prompt = context.request.prompt ?? "";
    if (!/[a-z]+[._][a-z]+/i.test(prompt)) return false;
    try {
      return toolSchemasForModel().some(
        (schema) => prompt.includes(schema.name) || prompt.includes(registryIdForToolName(schema.name)),
      );
    } catch {
      return false;
    }
  }

  /**
   * Route an AI request, recording WHICH stage claimed it.
   *
   * The wrapper changes no routing: it opens a trace for the turn,
   * runs the existing chain, and closes the trace with the reply that
   * was actually returned. Without it, "the stage never ran" and "the
   * stage ran and something replaced it" are indistinguishable.
   */
  public async route(context: RouterContext): Promise<AIResponse> {
    beginRoutingTrace(context, context.request.prompt ?? "");
    // v3 §5: when the message is about mapped parts of her, her Neural Map appears beside the
    // conversation with them highlighted (exact matches on canonical nodes only; never takes focus).
    void import("./neural/NeuralTools")
      .then((m) => m.surfaceNeuralContext((context.request as { conversationId?: string | null }).conversationId, context.request.prompt ?? ""))
      .catch(() => undefined);
    const response = await this.routeThroughStages(context);
    finishRoutingTrace(context, response);
    return response;
  }

  private async routeThroughStages(context: RouterContext): Promise<AIResponse> {
    // Route on availability that has been determined, not on the startup
    // default (engineering tools read "unavailable" until the runtime probe
    // answers). Bounded so a slow probe can never hold a turn hostage.
    await Promise.race([
      ToolRegistry.getInstance().ensureAvailability().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);

    // An agent-to-agent conversation turn (WP13) is talk, not a command:
    // the deterministic surface, presence, time and direct-tool stages read
    // keywords ("build", "rotate", "dance") and would answer it without a
    // model. Such a turn skips them and goes to the model chain.
    const talk = context.request.conversationOnly === true;

    // 0.0 The Spatial bar: "open the spatial menu" / "hide the spatial bar".
    // First, so no creative or 3D stage reads "spatial" as a scene request.
    const spatialNav = talk ? { handled: false as const, response: undefined } : this.surfaces.spatialNav(context);
    if (spatialNav.handled && spatialNav.response) return spatialNav.response;

    // 0.01 Her presence in plain words: "become a hologram", "walk to the
    // studio", "dance". Deterministic, model-free, and verified by her renderer.
    const presence = talk ? { handled: false as const, response: undefined } : await this.traced(context, "avatar-presence", () => this.avatar.executeDirect(context));
    if (presence.handled && presence.response) return presence.response;

    // 0. TIME — deterministic local capability, no external API needed
    const timeResult = talk ? { handled: false as const, response: undefined } : await this.traced(context, "time", () => this.time.execute(context));
    if (timeResult.handled && timeResult.response) return timeResult.response;

    // 0.2 DIRECT EXECUTION — creative and data tools need no model. An
    // explicit command ("/scene forest") always runs here; a natural-language
    // creative/data request runs here only when no model provider can take
    // the turn, so the work still happens (and nothing is billed).
    const directPlan = talk ? null : this.direct.plan(context);
    // A construction is deterministic: the same parameters always yield the
    // same artifact. So it runs here even when a model is reachable, rather
    // than depending on the model choosing the right tool. "Build a cabin"
    // must produce a cabin; the model is not needed to hope so.
    const construction = Boolean(directPlan && !directPlan.explicit && directPlan.steps.length > 0 && directPlan.steps.every((step) => /^creative\.(build|modify|inspect)$/.test(step.tool) || /^cosmos\.(object|view)\./.test(step.tool)));
    /*
     * An operation on a canonical creation is the same kind of claim: "rotate it
     * 90 degrees" either rotated that object in the store or it did not. Letting
     * a reachable model answer it instead produces a description of a rotation
     * with no rotation behind it, which is precisely what the live WP03 run
     * showed. These steps are deterministic, authorized and cheap, so they run
     * here whether or not a provider is up.
     */
    const creativeOperation = Boolean(
      directPlan && !directPlan.explicit && directPlan.steps.length > 0 && directPlan.steps.every((step) => step.tool === "couture.objects"),
    );
    /*
     * A sewing tech pack is deterministic in the same way (the same garments,
     * size and measurements always draft the same patterns), and a sketch must
     * produce a drawing: measured live, the model answered "Here's the croquis"
     * with no tool used, and on another turn planned notes instead of the tech
     * pack. Both run here, so the work exists before anything says it does.
     */
    const madeDirectly = Boolean(
      directPlan && !directPlan.explicit && directPlan.steps.length > 0 && directPlan.steps.every((step) => (step.tool === "couture.design" && step.args.action === "tech-pack") || (step.tool === "studio.create" && step.args.kind === "drawing") || step.tool === "diagnostics.run" || step.tool === "neural.show"),
    );
    if (directPlan && (directPlan.explicit || construction || creativeOperation || madeDirectly || !(await this.direct.providersAvailable(context)))) {
      const reason = directPlan.explicit ? "command" : construction ? "construction" : creativeOperation || madeDirectly ? "creative" : "no-provider";
      const done = await this.traced(context, "direct", () => this.direct.execute(context, directPlan, reason));
      if (done.handled && done.response) return done.response;
    }
    if (!directPlan) {
      const unknown = this.direct.unknownCommand(context);
      if (unknown.handled && unknown.response) return unknown.response;
    }

    // 0.4 MISSION RESUMPTION — a request to pick a recorded workstream back
    // up is answered by the continuity tools, not by whichever deterministic
    // resolver happens to recognise a word in it. Measured: "resume the
    // blocked Mission 14 workstream, find the record, tell me what is blocked"
    // was claimed by ProjectResolver ("resume the"), then by the operational
    // intelligence snapshot ("what is blocked"), and the ledger was never
    // read. This route is narrow: it requires mission/workstream vocabulary
    // AND a resume/read verb, and it stands aside for a genuine studio or
    // capability question.
    // WP13: an agent conversation turn goes straight to the model chain. The
    // stages below (mission resume, identity, intelligence, surfaces,
    // repository acquisition, spatial, engineering…) all claim turns by
    // keyword, and a turn of talk must be answered by a model, not by them.
    if (talk) {
      const spoken = await this.traced(context, "provider", () => this.providers.execute(context));
      if (spoken.handled && spoken.response) return this.attachThinking(context, spoken.response);
      return this.attachThinking(context, this.responses.offline(context.started));
    }

    const resumePrompt = context.request.prompt ?? "";
    if (isMissionResume(resumePrompt) && !/\b(?:studios?|capabilit(?:y|ies)|openhands|opencode)\b/i.test(resumePrompt)) {
      const continuity = await this.traced(context, "provider", () => this.providers.execute(context));
      if (continuity.handled && continuity.response) return this.attachThinking(context, continuity.response);
    }

    // 0.5 COGNITIVE STATE — "what are you thinking about?" REPORTS the
    // autonomous self-study state that already exists. It is a pure read:
    // it runs no cycle, starts no loop and calls no provider, so a chat
    // request can never be the thing that created the state it reports.
    // Must precede the brain stage, whose identity matcher would
    // otherwise claim "what are you …" and answer with the identity
    // statement instead.
    const cognitiveState = await this.traced(context, "cognitive-state", () => this.cognitiveState.execute(context));
    if (cognitiveState.handled && cognitiveState.response) return cognitiveState.response;

    // 1. Brain / identity — always local
    const brain = await this.traced(context, "brain", () => this.brain.execute(context));
    if (brain.handled && brain.response) return brain.response;

    // 1.2 OPERATIONAL INTELLIGENCE — "why can't you run OpenHands?" is
    // answered from the four live studios, not from the model's memory.
    // The stage reads the same /api/integration surface the panels do,
    // never an adapter, and returns unhandled when no data is available
    // so the provider keeps the turn instead of guessing.
    const intelligence = await this.traced(context, "intelligence", () => this.intelligence.execute(context));
    if (intelligence.handled && intelligence.response) {
      return this.attachThinking(context, intelligence.response);
    }

    // 1.5 Explicit surface commands — "open the browser", "show me the
    // 3d", "take me into gen v2". Chat is the primary control surface:
    // these EXECUTE the real UI state transition deterministically,
    // before any research/creative stage could misroute them.
    const surface = await this.traced(context, "surface", () => this.surfaces.execute(context));
    if (surface.handled && surface.response) return surface.response;

    // 1.6 SPATIAL — scene commands execute against the live spatial
    // graph through the tier guard: "create a red cube", "move it up",
    // "connect the cube to the sphere". Deterministic and local, and it
    // runs before creative/engineering stages so the word "create" can
    // no longer send a scene request into a scaffold.
    const spatial = await this.spatial.execute(context);
    if (spatial.handled && spatial.response) return spatial.response;

    // 1.7 REPOSITORY WORKFORCE — chat prepares a real acquisition and the
    // next explicit approval runs the pipeline. This runs before planning
    // and research so an acquisition objective is never answered as a plan
    // or a web search.
    const acquisition = await this.acquisition.execute(context);
    if (acquisition.handled && acquisition.response) return acquisition.response;

    await this.planning.execute(context);
    await this.reasoning.execute(context);

    // Tool / device calls — keyword-matched device actions. A user who
    // names one of the model's own tools is directing that tool, not a
    // device: measured, "look at your app with browser_capture" fired a
    // CAMERA capture from the word "capture", before the model saw it.
    const namesTool = this.namesAnOfferedTool(context);
    if (!namesTool) {
      const tools = await this.traced(context, "tools", () => this.tools.execute(context));
      if (tools.handled && tools.response) return this.attachThinking(context, tools.response);
    }

    const engineering = await this.traced(context, "engineering", () => this.engineering.execute(context));
    if (engineering.handled && engineering.response) return this.attachThinking(context, engineering.response);

    // The creative scaffold writes to the sandbox from keyword matching
    // ("exit code" reads as "code"), BEFORE the model sees the turn.
    // Measured: "run verification/hello.js and tell me the exit code"
    // generated a 4-file app skeleton. Where the model can do the real
    // engineering work, or the user names one of its tools, the turn is
    // the model's — the same stand-aside ProjectResolver already makes.
    if (!this.modelCanComposeEnvironment(context) && !this.modelCanDoEngineeringWork(context) && !namesTool) {
      const creative = await this.traced(context, "creative", () => this.creative.execute(context));
      if (creative.handled && creative.response) return this.attachThinking(context, creative.response);
    }

    // Avatar / embodiment commands — LÉLU's own visual identity executes
    // against the saved avatar runtime. MUST run before any research so
    // "update your avatar to 3d render and simulations" never becomes a
    // knowledge-search request.
    const avatarResult = await this.traced(context, "avatar", () => this.avatar.execute(context));
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
    //
    // The same holds when the user names the model's tools: measured, a
    // self-improvement request naming project_copy / project_write was
    // answered with "Project created" and a toy 5-file scaffold in the
    // browser sandbox — the model never saw it and the repository was
    // never touched.
    if (
      context.intent === "project" &&
      !this.modelCanDoEngineeringWork(context) &&
      !this.modelCanBuildInStudio(context) &&
      !this.modelCanComposeEnvironment(context) &&
      !this.modelCanRunWorkflow(context) &&
      !namesTool &&
      !this.modelCanShapeWorld(context) &&
      // "Change the chart in the Lumo brief…" is a revision of an artifact
      // this conversation made, which the model does with studio.revise.
      // Measured: ProjectResolver claimed it and answered "Project created".
      !refersToConversationArtifact(context.request.conversationId, context.request.prompt ?? "")
    ) {
      const projectResult = await this.traced(context, "projects", () => this.projects.execute(context));
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
      const researchStarted = Date.now();
      const research = await this.research.execute(context);
      noteStage(context, "research", research.handled, { durationMs: Date.now() - researchStarted });
      if (research.handled) {
        return this.attachThinking(
          context,
          this.responses.fromResearch(research.results, context.started, research.attempted),
        );
      }
      // handled:false ⇒ results retrieved and attached to context;
      // continue so the AI provider synthesizes the answer from them.
    } else if (context.intent === "chat") {
      const researchStarted = Date.now();
      const research = await this.research.execute(context);
      noteStage(context, "research", research.handled, { durationMs: Date.now() - researchStarted });
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
    const deflockStarted = Date.now();
    await this.deflock.execute(context);
    noteStage(context, "deflock", false, { durationMs: Date.now() - deflockStarted });

    // Keyword browsing ("browser" in "browser_capture") opened the in-app
    // Browser over the chat with the user's whole message as its address
    // (measured in the self-improvement run). A turn naming the model's
    // tools is the model's.
    if (!namesTool) {
      const browser = await this.traced(context, "browser", () => this.browser.execute(context));
      if (browser.handled && browser.response) return this.attachThinking(context, browser.response);
    }

    const workspace = await this.traced(context, "workspace", () => this.workspace.execute(context));
    if (workspace.handled && workspace.response) return this.attachThinking(context, workspace.response);

    const provider = await this.traced(context, "provider", () => this.providers.execute(context));
    // Every provider failed (quota, network, outage): the request is still
    // executable without a model, so execute it instead of apologising.
    if (directPlan && provider.handled && provider.response && provider.response.provider === "offline") {
      const done = await this.traced(context, "direct", () => this.direct.execute(context, directPlan, "no-provider"));
      if (done.handled && done.response) return done.response;
    }
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

  /** Run one stage and record its claim (or refusal) in this turn's trace. */
  private async traced(
    context: RouterContext,
    stage: string,
    run: () => Promise<BrainResult>,
  ): Promise<BrainResult> {
    const started = Date.now();
    const result = await run();
    noteStage(context, stage, result.handled, {
      provider: result.response?.provider,
      model: result.response?.model,
      durationMs: Date.now() - started,
    });
    return result;
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