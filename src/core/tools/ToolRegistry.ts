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
  async refreshAvailability(): Promise<void> {
    // Engineering workspace ops: real autonomy-gate check, the exact
    // same one WorkspaceRuntime itself enforces before running anything —
    // this can never say "available" when the real run would be blocked.
    const workspace = WorkspaceRuntime.getInstance();
    for (const op of ["typecheck", "test", "build"] as const) {
      this.updateAvailability(`workspace.${op}`, workspace.allowed(op));
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
        description: "Assign a task to a specialist agent",
        category: "Agents",
        permissions: ["EXECUTE"],
        riskLevel: 1,
        available: true,
        executionRoute: "AIService.delegate",
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
        description: "Read and write files in GitHub repositories via server proxy",
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
        description: "Create commits in GitHub repositories",
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
        description: "Execute code in the sandbox runtime",
        category: "Engineering",
        permissions: ["EXECUTE"],
        riskLevel: 2,
        available: true,
        executionRoute: "SandboxRuntime.run",
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
    ];

    for (const tool of builtins) {
      this.tools.set(tool.id, tool);
    }
  }
}
