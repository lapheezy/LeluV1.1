/**
 * ==========================================================
 * LÉLU
 * CAPABILITY REGISTRY — what LÉLU can and cannot do, honestly
 *
 * Every capability records its status, what it needs (tools,
 * providers, agents, knowledge), dependencies, tests, and known
 * limitations. Statuses make the difference between "this
 * exists" and "this works":
 *
 *   available | partial | experimental | offline |
 *   provider-dependent | disabled | broken | planned
 *
 * Seeded from the actual architecture audit; editable in the
 * Evolution workspace; consumed by self-diagnostics and the
 * opportunity detector.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type CapabilityStatus =
  | "available"
  | "partial"
  | "experimental"
  | "offline"
  | "provider-dependent"
  | "disabled"
  | "broken"
  | "planned";

export const CAPABILITY_STATUS_LABELS: Record<CapabilityStatus, string> = {
  available: "Available",
  partial: "Partial",
  experimental: "Experimental",
  offline: "Offline",
  "provider-dependent": "Provider-dependent",
  disabled: "Disabled",
  broken: "Broken",
  planned: "Planned",
};

export interface Capability {
  id: string;
  name: string;
  description: string;
  status: CapabilityStatus;
  requiredTools: string[];
  requiredProviders: string[];
  requiredAgents: string[];
  requiredKnowledge: string[];
  dependencies: string[];
  tests: string[];
  limitations: string[];
  version: string;
}

const KEY = "lelu.capabilities.v1";

function seedCapabilities(): Capability[] {
  const cap = (
    partial: Partial<Capability> & Pick<Capability, "id" | "name" | "description" | "status">,
  ): Capability => ({
    requiredTools: [],
    requiredProviders: [],
    requiredAgents: [],
    requiredKnowledge: [],
    dependencies: [],
    tests: [],
    limitations: [],
    version: "1.0",
    ...partial,
  });

  return [
    cap({
      id: "chat",
      name: "Chat",
      description: "Conversation through the single AI pipeline with memory and cognition context.",
      status: "provider-dependent",
      requiredProviders: ["any AI provider"],
      requiredKnowledge: ["prompt/context enrichment"],
      tests: ["chat pipeline smoke", "memory injection"],
      limitations: ["real answers require at least one working provider key"],
      version: "1.2",
    }),
    cap({
      id: "memory",
      name: "Memory (STM + LTM)",
      description: "Persistent memory through PatternMemory (IndexedDB), with reflection and synthesis.",
      status: "available",
      requiredKnowledge: ["IndexedDB", "storage persistence"],
      tests: ["memory roundtrip", "memory retrieval"],
      limitations: ["memory lives in this browser only"],
    }),
    cap({
      id: "cognition",
      name: "Cognition",
      description: "Context enrichment, reasoning and planning resolvers, and the cognitive loop.",
      status: "available",
      requiredKnowledge: ["retrieval-augmented generation", "agent tool-use loops"],
      tests: ["cognitive loop cycle", "self-model sync"],
      limitations: ["reasoning is heuristic, not a model call"],
    }),
    cap({
      id: "self-model",
      name: "Self-model",
      description: "Persistent representation of who LÉLU is, what she knows and is learning.",
      status: "available",
      dependencies: ["cognition"],
      tests: ["self roundtrip", "self sync from environment"],
    }),
    cap({
      id: "knowledge",
      name: "Knowledge library",
      description: "Persistent knowledge with domains and honest trust statuses.",
      status: "available",
      dependencies: ["cognition"],
      tests: ["knowledge CRUD", "gap detection"],
    }),
    cap({
      id: "work-queue",
      name: "Internal work queue",
      description: "NOW/NEXT/LEARNING/EXPERIMENTS/PROJECTS/IDEAS/BLOCKED/REVIEW task structure.",
      status: "available",
      dependencies: ["cognition"],
      tests: ["queue add/move/complete"],
    }),
    cap({
      id: "autonomy",
      name: "Autonomy gate",
      description: "Explicit levels 0-5 that bound what LÉLU may do without approval.",
      status: "available",
      dependencies: ["cognition"],
      tests: ["autonomy clamping", "can() checks"],
    }),
    cap({
      id: "agents",
      name: "Agents",
      description: "Persistent, configurable agents with tools, memory permissions, provider preferences and history.",
      status: "available",
      requiredAgents: ["any agent"],
      requiredKnowledge: ["agent tool-use loops"],
      tests: ["agent CRUD", "agent execution record"],
      limitations: ["agent output quality depends on provider availability"],
    }),
    cap({
      id: "delegation",
      name: "LÉLU delegation",
      description: "LÉLU hands work to specialized agents from chat.",
      status: "available",
      dependencies: ["chat", "agents"],
      requiredProviders: ["any AI provider"],
      tests: ["delegation route"],
    }),
    cap({
      id: "projects",
      name: "Projects & workspace",
      description: "Projects containing conversations, files, images, sketches, renders, videos, tasks, notes, outputs.",
      status: "available",
      dependencies: ["creative", "agents"],
      tests: ["project CRUD", "project context"],
    }),
    cap({
      id: "sketch",
      name: "Sketch",
      description: "Offline canvas editor: layers, strokes, shapes, text, images, undo/redo, export, autosave.",
      status: "available",
      requiredTools: ["sketch canvas"],
      requiredKnowledge: ["canvas raster pipelines", "SVG export from sketch documents"],
      tests: ["sketch document", "sketch export", "creative tool interface"],
      limitations: ["raster editing only — no filters/effects pipeline yet"],
      version: "1.1",
    }),
    cap({
      id: "render",
      name: "Render",
      description: "Pluggable render engine registry with a local procedural engine; cloud engines wait on keys.",
      status: "partial",
      requiredTools: ["render engines"],
      requiredProviders: ["image generation providers (for cloud)"],
      tests: ["local render engine", "render store"],
      limitations: ["cloud rendering requires provider keys", "no photorealistic local generation"],
    }),
    cap({
      id: "video",
      name: "Video projects",
      description: "Video project architecture: storyboards, scenes, shots, assets, timeline foundation.",
      status: "partial",
      requiredTools: ["video pipeline"],
      requiredProviders: ["video generation providers"],
      tests: ["video project CRUD", "video scene/shot/asset"],
      limitations: ["no actual video generation yet", "no editing layer yet"],
    }),
    cap({
      id: "avatar",
      name: "Avatar identity",
      description: "Persistent avatar identity (appearance, identity, presence) with a reference image.",
      status: "partial",
      dependencies: ["cognition"],
      tests: ["avatar CRUD", "avatar identity context"],
      limitations: ["2D config only — no animation or embodied avatar yet"],
    }),
    cap({
      id: "engineering",
      name: "Engineering sandbox",
      description: "Isolated virtual filesystem, project generation, static analysis, and a real JavaScript execution worker.",
      status: "available",
      requiredTools: ["sandbox", "sandbox-runtime"],
      requiredKnowledge: ["virtual sandbox design", "browser worker execution"],
      tests: ["sandbox CRUD", "sandbox generate", "sandbox analyze", "sandbox path safety", "sandbox run/tests"],
      limitations: ["worker runtime is JavaScript-only (no npm install or full Node toolchain in-browser)"],
    }),
    cap({
      id: "sandbox-runtime",
      name: "Sandbox execution runtime",
      description: "Runs sandbox JavaScript for real in an isolated Web Worker — captured stdout/stderr/exit/timing, a test harness, syntax checks, HTML preview, and hard timeouts.",
      status: "available",
      dependencies: ["engineering"],
      tests: ["sandbox run", "sandbox test harness", "sandbox syntax check", "sandbox timeout"],
      limitations: ["no DOM, network, storage or node_modules inside the worker"],
    }),
    cap({
      id: "visual-inspection",
      name: "Visual self-inspection",
      description: "Renders sandbox HTML in an iframe and inspects the real DOM for overflow, overlap, collapsed boxes, and readability issues.",
      status: "experimental",
      dependencies: ["sandbox-runtime", "ui-evolution"],
      tests: ["DOM inspection finds overflow"],
      limitations: ["DOM geometry inspection, not pixel screenshots of a dev build"],
    }),
    cap({
      id: "self-development",
      name: "Self-development engine",
      description: "Architecture map, capability registry, diagnostics, prioritized improvement queue, the closed develop→test→evaluate→candidate loop, versioning, and UI specs.",
      status: "available",
      dependencies: ["engineering", "sandbox-runtime", "cognition", "creative"],
      tests: ["self-test runner", "diagnostics run", "improvement workflow", "loop develop→ready"],
      limitations: ["candidate versions cannot overwrite production automatically — they are reviewed through the approval boundary"],
    }),
    cap({
      id: "self-diagnostics",
      name: "Self-diagnostics",
      description: "Periodic evaluation of software, cognition, agents, creative systems, and storage.",
      status: "available",
      dependencies: ["self-development"],
      tests: ["diagnostics run"],
    }),
    cap({
      id: "ui-evolution",
      name: "UI evolution",
      description: "Author JSON UI specs, preview them live, render sandbox HTML, and inspect the DOM for layout problems.",
      status: "experimental",
      dependencies: ["self-development", "ui", "visual-inspection"],
      tests: ["UI spec validation", "UI spec store roundtrip", "visual inspection"],
      limitations: ["renders data-defined components, not arbitrary JSX"],
    }),
    cap({
      id: "versioning",
      name: "Versioning & rollback",
      description: "Sandbox snapshots, version records, and rollback for every development experiment.",
      status: "available",
      dependencies: ["self-development", "engineering"],
      tests: ["snapshot/rollback"],
    }),
    cap({
      id: "voice",
      name: "Voice",
      description: "Speech recognition + synthesis through the same chat pipeline.",
      status: "available",
      requiredKnowledge: ["browser environment limits"],
      tests: ["voice engine state"],
      limitations: ["browser-dependent (mic permission, support)"],
    }),
    cap({
      id: "research",
      name: "Research",
      description: "Knowledge provider research tools (search/web sources) through the provider registry.",
      status: "provider-dependent",
      requiredProviders: ["knowledge providers"],
      tests: ["provider registry"],
      limitations: ["requires provider keys for live sources"],
    }),
    cap({
      id: "browser",
      name: "Browser tool",
      description: "Embedded browser panel for web content.",
      status: "partial",
      requiredProviders: ["none"],
      limitations: ["iframes are sandboxed; many sites block embedding"],
    }),
    cap({
      id: "workflows",
      name: "Reusable workflows",
      description:
        "Reusable multi-step workflows executed through the existing tool dispatcher — " +
        "the same path a model's native tool call takes.",
      // Measured, not asserted: a run of two dependent steps executed
      // through the real dispatcher, its execution persisted, and the
      // definition was retrievable and re-runnable afterwards.
      status: "available",
      requiredAgents: ["specialist agents"],
      tests: [
        "workflow ordering",
        "context passing",
        "real dispatcher execution",
        "blocked dependency",
        "reuse",
      ],
      limitations: [
        "Steps calling provider- or runtime-dependent tools are BLOCKED with the real dependency, never simulated.",
        "No scheduling or human-approval steps yet; a workflow runs to completion when invoked.",
        "Steps are tool calls; there is no branching or looping yet.",
      ],
    }),
    cap({
      id: "visual",
      name: "Visual environment",
      description: "The ambient visual layer and SYSTEM environment.",
      status: "available",
      tests: ["visual engine state"],
    }),
  ];
}

export default class CapabilityRegistry {
  private static instance: CapabilityRegistry | null = null;
  private capabilities: Capability[];

  private constructor() {
    const stored = KvStore.getInstance().get<Capability[]>(KEY);
    this.capabilities = stored && stored.length > 0 ? stored : seedCapabilities();
    if (!stored || stored.length === 0) {
      this.persist();
    }
  }

  public static getInstance(): CapabilityRegistry {
    if (!CapabilityRegistry.instance) {
      CapabilityRegistry.instance = new CapabilityRegistry();
    }
    return CapabilityRegistry.instance;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.capabilities);
    } catch {
      // best-effort
    }
  }

  public list(): Capability[] {
    return [...this.capabilities];
  }

  public get(id: string): Capability | undefined {
    return this.capabilities.find((capability) => capability.id === id);
  }

  public add(capability: Omit<Capability, "id"> & { id?: string }): Capability {
    const created: Capability = {
      ...capability,
      id: capability.id ?? crypto.randomUUID().slice(0, 10),
      version: capability.version ?? "1.0",
    };
    this.capabilities = [created, ...this.capabilities];
    this.persist();
    return created;
  }

  public update(id: string, patch: Partial<Capability>): void {
    this.capabilities = this.capabilities.map((capability) =>
      capability.id === id ? { ...capability, ...patch } : capability,
    );
    this.persist();
  }

  public remove(id: string): void {
    this.capabilities = this.capabilities.filter((capability) => capability.id !== id);
    this.persist();
  }

  public byStatus(status: CapabilityStatus): Capability[] {
    return this.capabilities.filter((capability) => capability.status === status);
  }

  public availableCount(): number {
    return this.capabilities.filter((capability) => capability.status === "available").length;
  }

  /** Capabilities blocked by their status — input for opportunity detection. */
  public lacking(): Capability[] {
    return this.capabilities.filter((capability) =>
      ["planned", "broken", "disabled"].includes(capability.status),
    );
  }

  public partial(): Capability[] {
    return this.capabilities.filter((capability) =>
      ["partial", "experimental"].includes(capability.status),
    );
  }

  public statusCounts(): Record<CapabilityStatus, number> {
    const counts = {
      available: 0,
      partial: 0,
      experimental: 0,
      offline: 0,
      "provider-dependent": 0,
      disabled: 0,
      broken: 0,
      planned: 0,
    } as Record<CapabilityStatus, number>;
    for (const capability of this.capabilities) {
      counts[capability.status] += 1;
    }
    return counts;
  }
}
