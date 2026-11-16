/**
 * ==========================================================
 * LÉLU — CAPABILITY MANIFEST
 *
 * Single source of truth for every capability LÉLU can
 * invoke. Updated at runtime, not hardcoded claims.
 *
 * Used by cognition (knows what's available), chat (declines
 * unavailable capabilities gracefully), Sentinel (monitors
 * health), and the self-model (accurate self-awareness).
 * ==========================================================
 */

export type CapabilityStatus =
  | "available"
  | "degraded"
  | "unavailable"
  | "not_configured";

export interface CapabilityDef {
  id: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  status: CapabilityStatus;
  /** Which providers/systems provide this capability */
  providers: string[];
  /** Last time this capability was successfully used */
  lastSuccessful: number | null;
  /** Last time the status was checked */
  lastChecked: number;
  /** Error message if degraded/unavailable */
  error?: string;
}

export type CapabilityCategory =
  | "ai"
  | "knowledge"
  | "voice"
  | "tools"
  | "memory"
  | "agents"
  | "ui"
  | "cosmos"
  | "system";

export default class CapabilityManifest {
  private static instance: CapabilityManifest | null = null;
  private capabilities = new Map<string, CapabilityDef>();
  private listeners = new Set<() => void>();

  private constructor() {
    this.registerBuiltin();
  }

  static getInstance(): CapabilityManifest {
    if (!CapabilityManifest.instance) {
      CapabilityManifest.instance = new CapabilityManifest();
    }
    return CapabilityManifest.instance;
  }

  // ---- Registration ----

  register(def: CapabilityDef): void {
    this.capabilities.set(def.id, { ...def, lastChecked: Date.now() });
    this.notify();
  }

  updateStatus(
    id: string,
    status: CapabilityStatus,
    error?: string,
  ): void {
    const existing = this.capabilities.get(id);
    if (!existing) return;
    existing.status = status;
    existing.lastChecked = Date.now();
    if (status === "available") existing.lastSuccessful = Date.now();
    if (error) existing.error = error;
    else if (status === "available") existing.error = undefined;
    this.notify();
  }

  /** Mark a capability as having been used successfully */
  markUsed(id: string): void {
    const cap = this.capabilities.get(id);
    if (cap) {
      cap.lastSuccessful = Date.now();
      cap.status = "available";
      cap.lastChecked = Date.now();
    }
  }

  // ---- Queries ----

  get(id: string): CapabilityDef | undefined {
    return this.capabilities.get(id);
  }

  getAll(): CapabilityDef[] {
    return Array.from(this.capabilities.values());
  }

  getByCategory(category: CapabilityCategory): CapabilityDef[] {
    return this.getAll().filter((c) => c.category === category);
  }

  /** What LÉLU can actually do right now */
  getAvailable(): CapabilityDef[] {
    return this.getAll().filter(
      (c) => c.status === "available" || c.status === "degraded",
    );
  }

  /** Plain-text report for self-model / chat context */
  getReport(): string {
    const lines: string[] = ["LÉLU CAPABILITY REPORT:"];
    for (const cap of this.getAll()) {
      const icon =
        cap.status === "available"
          ? "✓"
          : cap.status === "degraded"
            ? "⚠"
            : cap.status === "unavailable"
              ? "✗"
              : "○";
      lines.push(`  ${icon} ${cap.name} (${cap.id}) — ${cap.status}`);
    }
    return lines.join("\n");
  }

  /** JSON-serializable snapshot for UI */
  getSnapshot() {
    return this.getAll().map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      status: c.status,
      lastSuccessful: c.lastSuccessful,
    }));
  }

  // ---- Subscriptions ----

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  // ---- Built-in capabilities (always available) ----

  private registerBuiltin(): void {
    const now = Date.now();

    // AI chat — availability depends on provider health checks
    this.capabilities.set("ai-chat", {
      id: "ai-chat",
      name: "AI Chat",
      category: "ai",
      description: "Generate conversational responses via configured AI providers",
      status: "available",
      providers: ["groq", "openrouter", "cerebras", "fireworks", "anthropic", "github-models"],
      lastSuccessful: null,
      lastChecked: now,
    });

    this.capabilities.set("ai-vision", {
      id: "ai-vision",
      name: "AI Vision",
      category: "ai",
      description: "Analyze images and video frames via multimodal models",
      status: "not_configured",
      providers: [],
      lastSuccessful: null,
      lastChecked: now,
    });

    // Always-available local capabilities
    const alwaysAvailable: [string, string, CapabilityCategory, string][] = [
      ["current-time", "Current Time", "knowledge", "Real-time clock from browser/device"],
      ["current-date", "Current Date", "knowledge", "Real-time date from browser/device"],
      ["web-search", "Web Search", "knowledge", "Search the web via configured providers"],
      ["wikipedia", "Wikipedia", "knowledge", "Look up articles on Wikipedia"],
      ["news-current", "Current News", "knowledge", "Retrieve current news headlines"],
      ["geolocation", "Geolocation", "knowledge", "Determine geographic location"],
      ["geocoding", "Geocoding", "knowledge", "Convert addresses to coordinates and back"],
      ["weather", "Weather", "knowledge", "Current weather data via OpenMeteo"],
      ["arxiv", "Research Papers", "knowledge", "Search academic papers on arXiv"],
      ["nasa", "NASA Data", "knowledge", "Access NASA public datasets and imagery"],
      ["hacker-news", "Hacker News", "knowledge", "Browse technology news and discussions"],
      ["voice-input", "Voice Input", "voice", "Capture and transcribe user speech"],
      ["voice-output", "Voice Output", "voice", "Speak responses aloud via TTS"],
      ["short-term-memory", "Short-Term Memory", "memory", "Remember recent conversation context"],
      ["long-term-memory", "Long-Term Memory", "memory", "Store and retrieve persistent memories"],
      ["agent-registry", "Agent Registry", "agents", "Create, configure, and run specialized agents"],
      ["executive-board", "Executive Board", "agents", "Coordinate Sentinel, Architect, Engineering executives"],
      ["task-engine", "Task Engine", "tools", "Create and track multi-step tasks"],
      ["file-tools", "File Tools", "tools", "Read, write, and manage project files"],
      ["cosmos-navigation", "Cosmos Navigation", "cosmos", "Navigate and explore the LÉLUVERSE"],
      ["ui-panels", "UI Panels", "ui", "Open and interact with workspace panels"],
      ["self-exploration", "Self Exploration", "cosmos", "LELU autonomously explores her environment"],
      ["sentinel-monitoring", "Sentinel Monitoring", "system", "Real-time system health and event monitoring"],
      ["architect-planning", "Architect Planning", "system", "System architecture analysis and planning"],
      ["engineering-sandbox", "Engineering Sandbox", "system", "Controlled code inspection and improvement"],
      // Acquisition workforce: the local half is always present; the
      // runtime-dependent half is registered below as not_configured and
      // becomes "available" only when the acquisition runtime answers.
      ["technology-knowledge-base", "Technology Knowledge Base", "knowledge", "Searchable record of researched and integrated technology"],
      ["fuzzy-text-search", "Fuzzy Text Search", "knowledge", "Local Bitap approximate matching, adapted from Fuse (Apache-2.0)"],
      ["repo-executive", "Repo Executive", "agents", "Strategic repository research, comparison and assignment"],
      ["repo-executor", "Repo Executor", "agents", "Repository acquisition, adaptation, testing and integration"],
    ];

    for (const [id, name, category, description] of alwaysAvailable) {
      this.capabilities.set(id, {
        id,
        name,
        category,
        description,
        status: "available",
        providers: ["builtin"],
        lastSuccessful: now,
        lastChecked: now,
      });
    }

    // Repository acquisition and its pipeline are real only where a
    // server runtime serves /api/acquisition. They start unconfigured so
    // cognition never advertises a capability this deployment cannot use;
    // the runtime probe promotes them when it succeeds.
    for (const [id, name, description] of [
      ["repository-acquisition", "Repository Acquisition", "Secure server-side clone, ZIP import, inspection and isolated execution"],
      ["capability-pipeline", "Repository-to-Capability Pipeline", "Discover → research → acquire → adapt → connect → test → approve → integrate → register → use"],
      ["engineering-command-center", "Engineering Command Center", "Executive objectives, assignments, approvals, blocked work and completed acquisitions"],
      ["capability-marketplace", "Capability Marketplace", "Inventory, activation, provenance, updates and safe removal of acquired capabilities"],
      ["engineering-council", "Engineering Council", "Parallel architecture, security, testing, documentation, API, memory and UI review"],
      ["creator-studio", "Creator Studio", "Objective to real project files through the engineering workspace, validated by its real toolchain"],
    ] as const) {
      this.capabilities.set(id, {
        id,
        name,
        category: "tools",
        description,
        status: "not_configured",
        providers: ["engineering-runtime"],
        lastSuccessful: null,
        lastChecked: now,
        error: "No acquisition runtime has been reachable yet.",
      });
    }
  }
}