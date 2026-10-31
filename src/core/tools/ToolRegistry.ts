/**
 * ==========================================================
 * LÉLU TOOL REGISTRY — Universal capability registry
 *
 * One authoritative source for every tool/capability LÉLU has.
 * Cognition queries this when deciding what actions are possible.
 * Extensible — new tools register themselves and become available.
 *
 * Risk levels:
 *   0 = read-only (safe, automatic)
 *   1 = local-state (modifies local state, automatic)
 *   2 = device-action (uses device hardware, ask-once)
 *   3 = external-action (reaches outside, ask-every-time)
 *   4 = destructive (irreversible, explicit confirmation)
 * ==========================================================
 */



import WorkspaceRuntime from "../engineering/WorkspaceRuntime";
import GitHubIntegration from "../engineering/GitHubIntegration";
import SandboxFS from "../engineering/SandboxFS";
import UIActionBus from "../cognition/UIActionBus";

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export type PermissionClass =
  | "READ"
  | "WRITE"
  | "EXECUTE"
  | "EXTERNAL_ACTION"
  | "DESTRUCTIVE"
  | "SENSITIVE";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissions: PermissionClass[];
  riskLevel: RiskLevel;
  available: boolean;
  provider?: string;
  dependency?: string;
  executionRoute?: string;
  verificationMethod?: string;
}

type ToolListener = (tools: ToolDefinition[]) => void;

export default class ToolRegistry {
  private static instance: ToolRegistry | null = null;
  private tools = new Map<string, ToolDefinition>();
  private listeners = new Set<ToolListener>();

  private constructor() {
    this.registerBuiltinTools();
  }

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  // ---------- REGISTRATION ----------

  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
    this.notify();
  }

  unregister(toolId: string): void {
    this.tools.delete(toolId);
    this.notify();
  }

  updateAvailability(toolId: string, available: boolean): void {
    const tool = this.tools.get(toolId);
    if (tool) {
      tool.available = available;
      this.notify();
    }
  }

  // ---------- EXECUTE (real dispatch, not a catalog lookup) ----------

  /**
   * Every entry here is a REAL call into the existing implementation
   * the tool's `executionRoute` already documents — never a second,
   * competing implementation. A tool with no entry here is honestly
   * reported as such by execute(): still a real catalog entry
   * cognition can reason about, just not (yet) reachable through
   * ToolRegistry itself. See the capability audit for the full
   * REGISTERED/IMPLEMENTED/DISPATCHABLE/EXECUTABLE breakdown — this
   * table is intentionally a starting subset (the actions PRIORITY 6
   * named explicitly: panels/navigation, sandbox read/write, memory,
   * self-analysis), not a claim that every registered tool dispatches.
   */
  private static readonly DISPATCH: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    "cosmos.openInterface": async (params) => {
      const panel = String(params.panel ?? "");
      const result = UIActionBus.getInstance().dispatch({
        type: "open_panel",
        target: panel,
        reason: typeof params.reason === "string" ? params.reason : "Tool dispatch",
        initiatedBy: "lelu",
      });
      if (!result.ok) throw new Error(result.detail);
      return result.detail;
    },
    "sandbox.read": async (params) => {
      const path = String(params.path ?? "");
      const content = SandboxFS.getInstance().read(path);
      if (content === null) throw new Error(`No sandbox file at "${path}".`);
      return content;
    },
    "sandbox.write": async (params) => {
      const path = String(params.path ?? "");
      const content = String(params.content ?? "");
      const result = SandboxFS.getInstance().write(path, content);
      if (!result.ok) throw new Error(result.error ?? "Sandbox write failed.");
      return result;
    },
    "memory.recall": async (params) => {
      // Dynamic import: AIService is a large, central module — kept
      // out of ToolRegistry's static import graph so this catalog
      // (constructed very early, before most of the app exists) can
      // never become part of a load-order cycle with it.
      const { default: AIService } = await import("../AIService");
      const limit = typeof params.count === "number" ? params.count : 10;
      return AIService.getInstance().getMemories(limit);
    },
    "selfdev.analyze": async () => {
      const { default: SelfDevelopmentEngine } = await import("../selfdev/SelfDevelopmentEngine");
      return SelfDevelopmentEngine.getInstance().proactiveScan();
    },
  };

  /**
   * Actually invoke a tool — never a claim of success without this
   * having run the real underlying implementation. Returns ok:false
   * (never throws) both when the tool is unknown/unavailable AND when
   * it is registered but has no real dispatch wired yet, so a caller
   * can never mistake "nothing happened" for "it worked".
   */
  async execute(toolId: string, params: Record<string, unknown> = {}): Promise<{ ok: boolean; output?: unknown; detail: string }> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { ok: false, detail: `No such tool "${toolId}".` };
    }
    if (!tool.available) {
      return { ok: false, detail: `"${tool.name}" is registered but not currently available.` };
    }
    // ONE AUTHORITY. ToolDispatcher's executors are what a model's tool
    // call runs; this used to be a second, smaller table, so the same
    // tool could execute through one path and be "not wired" through the
    // other (sandbox.execute, every github.* and project.* tool). Any tool
    // with an executor runs through it here too — with its permission and
    // authorization checks — and the table below only covers tools the
    // dispatcher has no executor for. Dynamic import: ToolDispatcher
    // imports this module.
    const dispatcher = await import("./ToolDispatcher");
    if (dispatcher.executableToolIds().includes(toolId)) {
      const result = await dispatcher.dispatchToolCall(
        { id: `registry-${toolId}-${Date.now().toString(36)}`, name: dispatcher.toolNameForModel(toolId), arguments: params },
        `registry-${toolId}`,
      );
      return { ok: result.ok, output: result.data ?? result.content, detail: result.content };
    }
    const handler = ToolRegistry.DISPATCH[toolId];
    if (!handler) {
      return {
        ok: false,
        detail: `"${tool.name}" is registered but has no real dispatch wired through ToolRegistry.execute() yet — its actual implementation is ${tool.executionRoute ?? "undocumented"}.`,
      };
    }
    try {
      const output = await handler(params);
      return { ok: true, output, detail: `Executed "${tool.name}".` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  // ---------- QUERY ----------

  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  all(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  available(): ToolDefinition[] {
    return this.all().filter((t) => t.available);
  }

  byCategory(category: string): ToolDefinition[] {
    return this.all().filter((t) => t.category === category);
  }

  byRiskLevel(maxRisk: RiskLevel): ToolDefinition[] {
    return this.all().filter((t) => t.riskLevel <= maxRisk && t.available);
  }

  byPermission(permission: PermissionClass): ToolDefinition[] {
    return this.all().filter((t) => t.permissions.includes(permission) && t.available);
  }

  /** Get tools safe for automatic execution (risk 0-1). */
  autoSafe(): ToolDefinition[] {
    return this.byRiskLevel(1);
  }

  /** Get tools that need user confirmation (risk 2+). */
  needsConfirmation(): ToolDefinition[] {
    return this.all().filter((t) => t.riskLevel >= 2 && t.available);
  }

  /** Search tools by name/description. */
  search(query: string): ToolDefinition[] {
    const lower = query.toLowerCase();
    return this.all().filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower) ||
        t.category.toLowerCase().includes(lower),
    );
  }

  /** Format for LÉLU's system prompt so she knows her capabilities. */
  formatForPrompt(): string {
    const tools = this.available();
    if (tools.length === 0) return "No tools currently available.";

    const grouped = new Map<string, ToolDefinition[]>();
    for (const tool of tools) {
      const list = grouped.get(tool.category) ?? [];
      list.push(tool);
      grouped.set(tool.category, list);
    }

    const sections: string[] = [];
    for (const [category, categoryTools] of grouped) {
      const items = categoryTools
        .map((t) => `  - ${t.name}: ${t.description} (risk: ${t.riskLevel})`)
        .join("\n");
      sections.push(`## ${category}\n${items}`);
    }

    return sections.join("\n\n");
  }

  // ---------- AVAILABILITY (real, not hardcoded) ----------

  /**
   * Recompute `available` from real runtime state instead of the
   * hardcoded booleans set at registration. This was the actual gap:
   * the catalog claimed availability nobody ever checked. Safe to call
   * repeatedly (Bootstrap calls it once at startup; anything can call
   * it again after a state change, e.g. the autonomy level changing).
   */
  private refreshing: Promise<void> | null = null;
  private refreshedAt = 0;

  /**
   * Availability that has actually been determined — refreshed when it is
   * older than `maxAgeMs` or was never computed, one refresh at a time.
   *
   * The catalog starts with the engineering tools marked unavailable until
   * the runtime probe answers, and that answer arrived ~22 s after page
   * load (measured). A turn in that window was routed as if LÉLU had no
   * project tools: keyword resolvers took it and the model never saw it.
   */
  async ensureAvailability(maxAgeMs = 60_000): Promise<void> {
    if (this.refreshedAt && Date.now() - this.refreshedAt < maxAgeMs) return;
    if (!this.refreshing) {
      this.refreshing = this.refreshAvailability().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async refreshAvailability(): Promise<void> {
    try {
      await this.computeAvailability();
    } finally {
      this.refreshedAt = Date.now();
    }
  }

  private async computeAvailability(): Promise<void> {
    // Engineering workspace ops: real autonomy-gate check, the exact
    // same one WorkspaceRuntime itself enforces before running anything —
    // this can never say "available" when the real run would be blocked.
    // ONE PROBE OF THE DEVELOPMENT RUNTIME, used for everything below
    // that depends on it.
    //
    // Those facts used to have two owners: this method set workspace.*
    // from the autonomy gate alone, and EngineeringWorkspace separately
    // set project.* from its own probe. So workspace.test could be
    // offered at L3 with no runtime to run it on, and project.read's
    // answer depended on which of the two had run last. This is the
    // single writer now; EngineeringWorkspace answers and writes nothing.
    let runtimeReachable = false;
    try {
      const { default: EngineeringWorkspace } = await import("../engineering/EngineeringWorkspace");
      runtimeReachable = await EngineeringWorkspace.getInstance().runtimeReachable();
    } catch {
      // Unreachable means unavailable, never "assume yes".
      runtimeReachable = false;
    }

    // Workspace commands need BOTH: the same autonomy-gate check
    // WorkspaceRuntime itself enforces, AND a runtime to run on. Either
    // missing means the command cannot execute, and a tool that cannot
    // execute must not be offered.
    const workspace = WorkspaceRuntime.getInstance();
    for (const op of ["typecheck", "test", "build"] as const) {
      this.updateAvailability(`workspace.${op}`, workspace.allowed(op) && runtimeReachable);
    }

    // The project.* tools only work where that runtime serves
    // /api/engineer. Authorization is a separate, later question:
    // toolPermitted() still requires a human grant for project.apply and
    // project.commit, and the dispatcher re-checks before writing.
    for (const id of [
      "project.copy",
      "project.list",
      "project.read",
      "project.write",
      "project.edit",
      "project.delete",
      "project.validate",
      "project.diff",
      "project.apply",
      "project.git",
      "project.commit",
    ]) {
      this.updateAvailability(id, runtimeReachable);
    }

    // GitHub: one real probe (network/config), shared by every github.*
    // entry — they all depend on the same configured connection today,
    // so claiming per-entry granularity nothing actually differentiates
    // would just be a more specific-looking guess.
    try {
      const status = await GitHubIntegration.getInstance().getStatus();
      for (const id of ["github.auth", "github.repos", "github.files", "github.branches", "github.commits", "github.prs"]) {
        this.updateAvailability(id, status.configured);
      }
    } catch {
      for (const id of ["github.auth", "github.repos", "github.files", "github.branches", "github.commits", "github.prs"]) {
        this.updateAvailability(id, false);
      }
    }

    // Device capabilities: real browser feature detection, not a guess.
    // Guarded for non-browser (Node/test) environments, where none of
    // these globals exist — they correctly stay at their current value
    // rather than throwing.
    if (typeof navigator !== "undefined") {
      this.updateAvailability("device.camera", Boolean(navigator.mediaDevices?.getUserMedia));
      this.updateAvailability("device.microphone", Boolean(navigator.mediaDevices?.getUserMedia));
      this.updateAvailability("device.share", typeof navigator.share === "function");
      this.updateAvailability("device.haptics", typeof navigator.vibrate === "function");
    }
    if (typeof window !== "undefined") {
      this.updateAvailability("device.notifications", "Notification" in window);
    }
  }

  // ---------- SUBSCRIPTION ----------

  subscribe(listener: ToolListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    const snapshot = this.all();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* swallow */ }
    }
  }

  // ---------- BUILTIN TOOLS ----------

  private registerBuiltinTools(): void {
    const builtins: ToolDefinition[] = [
      // Chat / Conversation
      {
        id: "chat",
        name: "Chat",
        description: "Conversational interaction through text",
        category: "Communication",
        permissions: ["READ", "WRITE"],
        riskLevel: 0,
        available: true,
        executionRoute: "AIService.chat",
      },

      // Memory
      {
        id: "memory.recall",
        name: "Recall Memory",
        description: "Search and retrieve memories from long-term storage",
        category: "Memory",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "Brain.recall",
      },
      {
        id: "memory.store",
        name: "Store Memory",
        description: "Persist important information to long-term memory",
        category: "Memory",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "MemoryEngine.learn",
      },

      // Research
      {
        id: "research.web",
        name: "Web Research",
        description: "Search Wikipedia, ArXiv, news, and other knowledge sources",
        category: "Research",
        permissions: ["READ", "EXTERNAL_ACTION"],
        riskLevel: 1,
        available: true,
        provider: "research",
        executionRoute: "ResearchResolver",
      },
      {
        id: "browser.read",
        name: "Read Web Page",
        description: "Open a web page and read its title and text (through LÉLU's server-side reader)",
        category: "Research",
        permissions: ["READ", "EXTERNAL_ACTION"],
        riskLevel: 1,
        available: true,
        provider: "browser",
        executionRoute: "BrowserTool.visit",
      },

      // Other chats — what LÉLU may do is decided by the user's words
      // (multichat/ChatConsent), not by this permission alone.
      {
        id: "avatar.companion",
        name: "Companion Mode",
        description: "Show or hide yourself as the companion figure over the app, or change your size",
        category: "Creative",
        permissions: ["WRITE"],
        riskLevel: 0,
        available: true,
        executionRoute: "CompanionStore",
      },
      {
        id: "avatar.gesture",
        name: "Gesture",
        description: "Move your own 3D body: wave, dance, bow, nod/agree, shrug, make a heart, cheer, jump, look around, walk, sit down or stand up",
        category: "Creative",
        permissions: ["WRITE"],
        riskLevel: 0,
        available: true,
        executionRoute: "AvatarCommandBus.issue",
      },
      {
        id: "artifact.read",
        name: "Read Workspace Artifact",
        description: "Read an artifact in the workspace (the one the user selected by default): a capture, a page, a note, a diagram or a table",
        category: "Workspace",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "WorkspaceEngine.getState",
      },
      {
        id: "artifact.edit",
        name: "Edit Workspace Artifact",
        description: "Change an artifact in the workspace — its title, text or notes, diagram nodes and connections, table rows — and show the new revision",
        category: "Workspace",
        permissions: ["WRITE"],
        riskLevel: 0,
        available: true,
        executionRoute: "WorkspaceEngine.updateView",
        verificationMethod: "the view's revision increases and the changed content is returned",
      },
      {
        id: "artifact.create",
        name: "Create Workspace Artifact",
        description: "Make a note, diagram or table in the workspace, beside the conversation",
        category: "Workspace",
        permissions: ["WRITE"],
        riskLevel: 0,
        available: true,
        executionRoute: "WorkspaceEngine.openView",
      },
      {
        id: "chats.list",
        name: "List Other Chats",
        description: "See the titles of the user's other chats (never their contents)",
        category: "Memory",
        permissions: ["READ"],
        riskLevel: 1,
        available: true,
        executionRoute: "MultiChatStore.list",
      },
      {
        id: "chats.read",
        name: "Read Another Chat",
        description: "Read another chat's relevant messages — only when linked, or the user brought it up or agreed",
        category: "Memory",
        permissions: ["READ"],
        riskLevel: 1,
        available: true,
        executionRoute: "MultiChatStore.get",
      },
      {
        id: "chats.link",
        name: "Link Another Chat",
        description: "Link another chat to this one so its research can be used — when the user asks or agrees",
        category: "Memory",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "MultiChatStore.link",
      },
      {
        id: "chats.merge",
        name: "Merge Chats",
        description: "Create a new chat merging two or more chats (originals unchanged) — when the user asks or agrees",
        category: "Memory",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "MultiChatStore.merge",
      },

      // Providers
      {
        id: "ai.generate",
        name: "AI Generation",
        description: "Generate text through AI providers with fallback chain",
        category: "AI",
        permissions: ["READ", "EXTERNAL_ACTION"],
        riskLevel: 1,
        available: true,
        provider: "provider-chain",
        executionRoute: "ProviderResolver",
      },

      // Device Capabilities
      {
        id: "device.camera",
        name: "Camera",
        description: "Take a photo with the device camera",
        category: "Device",
        permissions: ["EXECUTE", "SENSITIVE"],
        riskLevel: 2,
        available: false, // detected at runtime
        executionRoute: "ToolResolver.camera.capture",
      },
      {
        id: "device.microphone",
        name: "Microphone",
        description: "Record audio for voice interaction or transcription",
        category: "Device",
        permissions: ["EXECUTE", "SENSITIVE"],
        riskLevel: 2,
        available: false,
        executionRoute: "VoiceEngine",
      },
      {
        id: "device.tts",
        name: "Text to Speech",
        description: "Speak text aloud through the device speakers",
        category: "Device",
        permissions: ["EXECUTE"],
        riskLevel: 1,
        available: true,
        executionRoute: "VoiceEngine.speakResponse",
      },
      {
        id: "device.share",
        name: "Share",
        description: "Open the system share sheet",
        category: "Device",
        permissions: ["EXECUTE", "EXTERNAL_ACTION"],
        riskLevel: 2,
        available: false,
        executionRoute: "ToolResolver.share.sheet",
      },
      {
        id: "device.clipboard",
        name: "Clipboard",
        description: "Read from or write to the system clipboard",
        category: "Device",
        permissions: ["READ", "WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "ToolResolver.clipboard",
      },
      {
        id: "device.notifications",
        name: "Notifications",
        description: "Send a local notification",
        category: "Device",
        permissions: ["EXECUTE"],
        riskLevel: 1,
        available: false,
        executionRoute: "ToolResolver.notifications.send",
      },
      {
        id: "device.storage",
        name: "Storage",
        description: "Estimate available device storage",
        category: "Device",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "ToolResolver.storage.estimate",
      },
      {
        id: "device.haptics",
        name: "Haptic Feedback",
        description: "Trigger vibration feedback",
        category: "Device",
        permissions: ["EXECUTE"],
        riskLevel: 1,
        available: false,
        executionRoute: "ToolResolver.haptics.vibrate",
      },

      // Agents
      {
        id: "agent.delegate",
        name: "Delegate to Agent",
        description: "Hand an objective to SHAMAN: it routes it to the right executive and agent, runs it, and returns the result",
        category: "Agents",
        permissions: ["EXECUTE"],
        riskLevel: 1,
        available: true,
        executionRoute: "Shaman.dispatch → AgentRunner.run",
      },
      {
        id: "browser.capture",
        name: "See a Page or Your Own Interface",
        description: "Render a page in a real headless browser — a public site, your own running app (phone or desktop, optionally a panel), or a workspace preview — and get a screenshot plus a layout report of off-screen and covered controls",
        category: "Engineering",
        permissions: ["READ"],
        riskLevel: 1,
        available: true,
        executionRoute: "POST /api/browser/capture (plugins/selfViewApi.ts)",
      },
      {
        id: "project.search",
        name: "Search Code",
        description: "Find text in the project or a workspace copy (read-only)",
        category: "Engineering",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "POST /api/engineer/search",
      },
      {
        id: "project.preview",
        name: "Preview a Workspace",
        description: "Run a workspace copy as a live app (loopback), so its changed interface can be captured before anything reaches the real project",
        category: "Engineering",
        permissions: ["EXECUTE"],
        riskLevel: 1,
        available: true,
        executionRoute: "POST /api/engineer/preview",
      },
      {
        id: "agent.status",
        name: "Agent Work Status",
        description: "See delegated work across agents: who owns it, which executive, why it was routed there, and its status",
        category: "Agents",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "AgentStore.delegations",
      },
      {
        id: "agent.resume",
        name: "Resume Agent Work",
        description: "Continue an interrupted or failed agent task (re-routed within its executive if its agent is unavailable)",
        category: "Agents",
        permissions: ["EXECUTE"],
        riskLevel: 1,
        available: true,
        executionRoute: "Shaman.resume → AgentRunner.resume",
      },

      // Projects
      {
        id: "project.manage",
        name: "Manage Projects",
        description: "Create, update, and organize projects",
        category: "Projects",
        permissions: ["READ", "WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "ProjectStore",
      },

      // Planning
      {
        id: "plan.create",
        name: "Create Plan",
        description: "Create a multi-step plan for a complex task",
        category: "Planning",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "PlanningEngine.create",
      },

      // Reasoning
      {
        id: "reason.evaluate",
        name: "Evaluate Hypotheses",
        description: "Evaluate competing hypotheses with confidence scoring",
        category: "Reasoning",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "ReasoningEngine.evaluate",
      },

      // Cosmos / Navigation
      {
        id: "cosmos.navigate",
        name: "Navigate Cosmos",
        description: "Move the avatar and camera through the cosmic environment",
        category: "Cosmos",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "CosmosStore.navigateToEntity",
      },
      {
        id: "cosmos.openInterface",
        name: "Open Interface",
        description: "Open a panel or interface in the Genesis UI",
        category: "Cosmos",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "GenesisCore.openPanel",
      },

      // Self Development
      {
        id: "selfdev.analyze",
        name: "Self Analysis",
        description: "Analyze own architecture and identify improvements",
        category: "Self Development",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "SelfDevelopmentEngine",
      },

      // GitHub Integration
      {
        id: "github.auth",
        name: "GitHub Auth",
        description: "Authenticate with GitHub and identify the authorized account",
        category: "GitHub",
        permissions: ["READ"],
        riskLevel: 0,
        available: false,
        executionRoute: "GitHubIntegration.probeAndUpdateCapabilities",
      },
      {
        id: "github.repos",
        name: "GitHub Repositories",
        description: "List, read, and access GitHub repositories",
        category: "GitHub",
        permissions: ["READ"],
        riskLevel: 0,
        available: false,
        executionRoute: "GitHubIntegration.listRepositories",
      },
      {
        id: "github.files",
        name: "GitHub Files",
        description: "Read files and directories in a GitHub repository at any branch or commit, via the server proxy",
        category: "GitHub",
        permissions: ["READ", "WRITE"],
        riskLevel: 1,
        available: false,
        executionRoute: "GitHubIntegration.getFileContent",
      },
      {
        id: "github.branches",
        name: "GitHub Branches",
        description: "Create and manage branches in GitHub repositories",
        category: "GitHub",
        permissions: ["READ", "WRITE"],
        riskLevel: 1,
        available: false,
        executionRoute: "GitHubIntegration.createBranch",
      },
      {
        id: "github.commits",
        name: "GitHub Commits",
        description: "List and read commits, and commit a file to a working (non-default) branch — confirmed by reading the commit back from GitHub",
        category: "GitHub",
        permissions: ["WRITE"],
        riskLevel: 2,
        available: false,
        executionRoute: "GitHubIntegration.createCommit",
      },
      {
        id: "github.prs",
        name: "GitHub Pull Requests",
        description: "Create and manage pull requests",
        category: "GitHub",
        permissions: ["WRITE", "EXTERNAL_ACTION"],
        riskLevel: 3,
        available: false,
        executionRoute: "GitHubIntegration.createPullRequest",
      },

      // Engineering Sandbox
      {
        id: "sandbox.read",
        name: "Sandbox Read",
        description: "Read files from the engineering sandbox",
        category: "Engineering",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "SandboxFS.read",
      },
      {
        id: "sandbox.write",
        name: "Sandbox Write",
        description: "Write files to the engineering sandbox",
        category: "Engineering",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "SandboxFS.write",
      },
      {
        id: "sandbox.execute",
        name: "Sandbox Execute",
        description: "Run a sandbox JavaScript file, the sandbox tests, or a syntax check in an isolated worker with a hard timeout; returns the real exit code and output",
        category: "Engineering",
        permissions: ["EXECUTE"],
        riskLevel: 2,
        available: true,
        executionRoute: "SandboxRuntime.run",
      },
      {
        id: "engineering.remote",
        name: "Remote Engineering Agent",
        description:
          "Run a bounded engineering task in an Anthropic-hosted sandbox against a " +
          "disposable clone of the repository pinned to an exact commit. Returns a " +
          "reviewable diff; never pushes and never touches the local working tree.",
        category: "Engineering",
        // EXTERNAL_ACTION because the session runs on Anthropic's infrastructure;
        // EXECUTE because real commands run in the container. Risk 3 rather
        // than 4: the sandbox is disposable and the local tree is unreachable.
        permissions: ["EXECUTE", "EXTERNAL_ACTION"],
        riskLevel: 3,
        // Detected at runtime — this is false until BOTH an Anthropic key
        // and a repository token are configured, so the catalogue never
        // advertises a capability that cannot actually run.
        available: false,
        provider: "anthropic-managed-agents",
        executionRoute: "AnthropicEngineeringAgent.execute",
        verificationMethod: "session event stream + returned diff",
      },
      {
        id: "workspace.typecheck",
        name: "Type Check",
        description: "Run TypeScript type checking on the project",
        category: "Engineering",
        permissions: ["EXECUTE"],
        riskLevel: 3,
        available: false,
        executionRoute: "WorkspaceRuntime.run",
      },
      {
        id: "workspace.test",
        name: "Run Tests",
        description: "Run the project test suite",
        category: "Engineering",
        permissions: ["EXECUTE"],
        riskLevel: 3,
        available: false,
        executionRoute: "WorkspaceRuntime.run",
      },
      {
        id: "workspace.build",
        name: "Build",
        description: "Run the project build process",
        category: "Engineering",
        permissions: ["EXECUTE"],
        riskLevel: 3,
        available: false,
        executionRoute: "WorkspaceRuntime.run",
      },

      /* ---- isolated project copies (real files, real commands) ----
         Availability is decided at runtime by the engineering runtime
         probe, not declared here: these can only work where a real
         development runtime is serving /api/engineer. */
      {
        id: "project.copy",
        name: "Copy Project To Sandbox",
        description:
          "Create an isolated copy of the real project in the engineering sandbox. " +
          "All edits happen in the copy; the real project is never modified by an edit.",
        category: "Engineering",
        permissions: ["WRITE", "EXECUTE"],
        riskLevel: 1,
        available: false,
        executionRoute: "EngineeringWorkspace.createCopy",
        verificationMethod: "server returns the on-disk file count of the copy",
      },
      {
        id: "project.list",
        name: "List Project Files",
        description:
          "List files and directories inside the sandbox copy. Use '.' for the project root.",
        category: "Engineering",
        permissions: ["READ"],
        riskLevel: 0,
        available: false,
        executionRoute: "EngineeringWorkspace.listDir",
      },
      {
        id: "project.read",
        name: "Read Project File",
        description: "Read the real contents of a file inside the sandbox copy.",
        category: "Engineering",
        permissions: ["READ"],
        riskLevel: 0,
        available: false,
        executionRoute: "EngineeringWorkspace.readFile",
      },
      {
        id: "project.edit",
        name: "Edit Project File",
        description:
          "Change part of a file inside the sandbox copy: replace one exact snippet with new text. " +
          "Cheaper and safer than rewriting the whole file. This never touches the real project.",
        category: "Engineering",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: false,
        executionRoute: "EngineeringWorkspace.readFile + writeFile",
      },
      {
        id: "project.write",
        name: "Write Project File",
        description:
          "Write a file inside the sandbox copy. Supply the COMPLETE new file contents. " +
          "This never touches the real project.",
        category: "Engineering",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: false,
        executionRoute: "EngineeringWorkspace.writeFile",
      },
      {
        id: "project.delete",
        name: "Delete Project File",
        description: "Delete a file inside the sandbox copy. This never touches the real project.",
        category: "Engineering",
        permissions: ["WRITE", "DESTRUCTIVE"],
        riskLevel: 2,
        available: false,
        executionRoute: "EngineeringWorkspace.deleteFile",
      },
      {
        id: "project.validate",
        name: "Validate Project Copy",
        description:
          "Run a real typecheck, test, build or inspect command INSIDE the sandbox copy and " +
          "return its actual exit code and output.",
        category: "Engineering",
        permissions: ["EXECUTE"],
        riskLevel: 2,
        available: false,
        executionRoute: "EngineeringWorkspace.validate",
        verificationMethod: "process exit code and captured stdout/stderr",
      },
      {
        id: "project.diff",
        name: "Diff Project Copy",
        description:
          "Compare the sandbox copy against the real project and list every file that differs.",
        category: "Engineering",
        permissions: ["READ"],
        riskLevel: 0,
        available: false,
        executionRoute: "EngineeringWorkspace.diff",
      },
      {
        id: "project.apply",
        name: "Apply Changes To Real Project",
        description:
          "Apply the validated change set from the sandbox copy to the REAL project. " +
          "Only available while the signed-in user has explicitly authorized this workspace.",
        category: "Engineering",
        permissions: ["WRITE", "EXTERNAL_ACTION"],
        riskLevel: 4,
        available: false,
        executionRoute: "EngineeringWorkspace.apply",
        verificationMethod: "server returns the list of files actually written",
      },
      {
        id: "project.git",
        name: "Inspect Project Git State",
        description:
          "Read the real repository state: 'status', 'diff' (add full:true for the patch), or " +
          "'log'. Read-only — this never commits or pushes.",
        category: "Engineering",
        permissions: ["READ"],
        riskLevel: 0,
        available: false,
        executionRoute: "EngineeringWorkspace.gitStatus",
        verificationMethod: "raw git output",
      },
      {
        id: "system.config",
        name: "Read Configuration Status",
        description:
          "Report which capabilities are configured and, for the ones that are not, which " +
          "environment variable is missing. Names and presence only — this cannot read a " +
          "secret's value. Use it when something is unavailable and you need to say why.",
        category: "System",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "ConfigStatus.describeConfiguration",
        verificationMethod: "resolves through the same env resolver the providers use",
      },
      /* ---- workflows: the same tool path as everything else ---- */
      {
        id: "workflow.list",
        name: "List Workflows",
        description:
          "List the reusable workflows that exist, with how many steps each has and whether " +
          "it can run right now. Use this before running one.",
        category: "Workflows",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "AgentWorkflowBridge.discover",
        verificationMethod: "reads the persisted workflow definitions",
      },
      {
        id: "workflow.run",
        name: "Run Workflow",
        description:
          "Execute a reusable workflow by name or id. Every step runs as a real tool call and " +
          "the result reports what each step actually did.",
        category: "Workflows",
        permissions: ["EXECUTE"],
        riskLevel: 1,
        available: true,
        executionRoute: "WorkflowEngine.run",
        verificationMethod: "per-step tool results and the persisted execution record",
      },
      {
        id: "workflow.author",
        name: "Author Workflow",
        description:
          "Create or replace a reusable workflow by describing its steps as data. Every step " +
          "names an EXISTING tool; branching, retries, loops and failure handling are declared, " +
          "not written as code. The definition is validated and only stored if it could really " +
          "run, and it is then available to every future objective.",
        category: "Workflows",
        permissions: ["WRITE"],
        riskLevel: 1,
        available: true,
        executionRoute: "WorkflowAuthoring.authorWorkflow",
        verificationMethod: "validated against the tool registry and persisted definitions",
      },
      {
        id: "workflow.status",
        name: "Workflow Execution Status",
        description:
          "Read the recorded state of a workflow execution — its steps, their inputs, outputs " +
          "and failures — by invocation id, or the most recent run.",
        category: "Workflows",
        permissions: ["READ"],
        riskLevel: 0,
        available: true,
        executionRoute: "WorkflowStore.execution",
      },

      {
        id: "project.commit",
        name: "Commit Applied Changes",
        description:
          "Commit the files that were actually applied to the real project. Stages only those " +
          "paths. Requires the same explicit authorization as applying.",
        category: "Engineering",
        permissions: ["WRITE", "EXTERNAL_ACTION"],
        riskLevel: 4,
        available: false,
        executionRoute: "EngineeringWorkspace.gitCommit",
        verificationMethod: "git returns the commit sha and stat",
      },
    ];

    for (const tool of builtins) {
      this.tools.set(tool.id, tool);
    }
  }
}
