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
