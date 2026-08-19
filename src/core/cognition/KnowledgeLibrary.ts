/**
 * ==========================================================
 * LÉLU
 * KNOWLEDGE LIBRARY — persistent knowledge development
 *
 * Knowledge is organized into expandable domains and carries an
 * explicit STATUS, because generated content is never trusted
 * automatically:
 *
 *   known → learned → inferred → hypothesized → unverified
 *        → tested → verified
 *
 * The cognitive loop scans for gaps (unverified/hypothesized
 * entries) and proposes LEARNING work-queue items for them.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type KnowledgeStatus =
  | "known"
  | "learned"
  | "inferred"
  | "hypothesized"
  | "unverified"
  | "tested"
  | "verified";

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  known: "Known",
  learned: "Learned",
  inferred: "Inferred",
  hypothesized: "Hypothesized",
  unverified: "Unverified",
  tested: "Tested",
  verified: "Verified",
};

/** Statuses that mean "this knowledge is not yet trustworthy". */
export const GAP_STATUSES: KnowledgeStatus[] = ["unverified", "hypothesized"];

export const KNOWLEDGE_DOMAINS = [
  { id: "computing", label: "Computing", description: "OS, filesystems, memory, networking, storage, databases, security, APIs" },
  { id: "software", label: "Software Engineering", description: "Languages, frameworks, architecture, testing, git, build systems, deployment" },
  { id: "creative", label: "Creative Technology", description: "Graphics, rendering, animation, 2D/3D, video, audio, games, simulation" },
  { id: "engineering", label: "Engineering", description: "Electronics, mechanics, materials, robotics, sensors, control systems" },
  { id: "ai", label: "AI", description: "Models, agents, memory, retrieval, tool use, planning, evaluation, multimodal" },
  { id: "selfdev", label: "LÉLU Engineering", description: "Self-development: architecture, design decisions, limitations, experiments, conventions, security" },
] as const;

export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number]["id"];

export interface KnowledgeEntry {
  id: string;
  domain: KnowledgeDomain;
  title: string;
  detail: string;
  status: KnowledgeStatus;
  source?: string;
  updatedAt: number;
}

const KEY = "lelu.knowledge.v1";

/** Base library — honest statuses: things the environment demonstrably
    does are "known"; model claims and design notes stay unverified until
    they are actually exercised and tested. */
function seedEntries(): KnowledgeEntry[] {
  const now = Date.now();
  const entry = (
    domain: KnowledgeDomain,
    title: string,
    detail: string,
    status: KnowledgeStatus,
    source?: string,
  ): KnowledgeEntry => ({
    id: `${domain}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    domain,
    title,
    detail,
    status,
    source,
    updatedAt: now,
  });

  return [
    entry("computing", "Filesystems & permissions", "Hierarchies of directories, files, and permission models; how read/write/execute maps to ownership and groups.", "known", "system design"),
    entry("computing", "Storage persistence", "localStorage / sessionStorage / window.name as layered offline persistence; quotas and failure modes in private browsing.", "tested", "KvStore smoke tests"),
    entry("computing", "IndexedDB", "Asynchronous document store used by PatternMemory; survives reload; offline-safe.", "tested", "PatternMemory"),
    entry("computing", "Browser environment limits", "No direct OS, filesystem or GPU access from the web sandbox; capabilities come through web APIs.", "known", "system model"),
    entry("software", "Provider fallback chains", "Primary provider → second → additional fallbacks; a provider failure must never break the assistant.", "verified", "AIProviderRegistry"),
    entry("software", "Prompt/context enrichment", "Memory, project context, agent roster and identity are injected into every request before generation.", "tested", "MemoryBridge"),
    entry("software", "Virtual sandbox design", "File tree confined to the browser; no runtime execution; analysis is static text inspection.", "known", "SandboxFS"),
    entry("software", "State-of-the-art agent memory", "Working memory vs long-term memory trade-offs in production agents; retrieval strategies, forgetting, consolidation.", "unverified"),
    entry("software", "Self-modifying systems", "Proposed change → test → evaluation → candidate version → controlled integration; never direct production mutation.", "hypothesized"),
    entry("creative", "Canvas raster pipelines", "Downscale, composite and re-encode through 2D canvas; data-URL attachments for vision providers.", "tested", "mediaProcessor"),
    entry("creative", "SVG export from sketch documents", "Strokes/shapes/text serialized to a resolution-independent vector document.", "tested", "SketchDocument"),
    entry("creative", "Procedural environment generation", "Techniques for generating terrain, textures and environments from rules rather than hand-authoring.", "unverified"),
    entry("engineering", "Electronics fundamentals", "Circuits, components, sensors and signal flow — base domain knowledge for hardware-adjacent projects.", "known"),
    entry("engineering", "Materials for product design", "Metals, alloys, finishes and manufacturing constraints relevant to jewelry/fashion product work.", "inferred"),
    entry("ai", "Retrieval-augmented generation", "Injecting retrieved context (memory/knowledge) into prompts improves grounding over raw generation.", "tested", "MemoryBridge"),
    entry("ai", "Agent tool-use loops", "Model proposes tool call → tool runs → result returns → model continues; the loop is what makes agents useful.", "learned"),
    entry("ai", "Multimodal vision", "Image/frame data URLs passed to vision-capable providers; providers without vision ignore the field.", "tested", "mediaProcessor"),
    entry("ai", "Latest frontier model architectures", "Current SOTA model families, benchmarks and pricing — needs provider docs + research to stay current.", "unverified"),
    // LÉLU engineering knowledge — prevents rediscovering the same facts.
    entry("selfdev", "Sandbox-first development", "Every self-improvement begins in the sandbox working copy; production is only touched through the approval boundary.", "verified", "Self-development engine design"),
    entry("selfdev", "No runtime self-modification", "The app cannot rewrite its own bundle at runtime; candidates are exported as patches for controlled integration.", "known", "browser environment limits"),
    entry("selfdev", "Architecture map is queryable", "Subsystems expose files, dependencies, and provided capabilities; real source paths come from import.meta.glob.", "tested", "ArchitectureMap"),
    entry("selfdev", "Capability status honesty", "Statuses distinguish available/partial/planned — a capability is never marked working without a passing self-test.", "tested", "CapabilityRegistry"),
    entry("selfdev", "Diagnostics before proposals", "Improvement proposals must cite evidence from self-diagnostics or state scans; the queue never accepts unsourced ideas.", "learned"),
    entry("selfdev", "UI evolution is data-defined", "Interfaces evolve as JSON specs rendered by the runtime renderer — preview before integration, no JSX editing in production.", "tested", "UISpec + RuntimeUI"),
    entry("selfdev", "Rollback is mandatory", "Every development experiment snapshots the sandbox first; failed candidates roll back and the reason is recorded.", "tested", "VersionHistory"),
    entry("selfdev", "Trust must be earned", "The route to production goes Detected → … → Testing → Evaluation → Ready → approval; success is measured with before/after criteria, never assumed.", "learned"),
  ];
}

export default class KnowledgeLibrary {
  private static instance: KnowledgeLibrary | null = null;
  private entries: KnowledgeEntry[];

  private constructor() {
    const stored = KvStore.getInstance().get<KnowledgeEntry[]>(KEY);
    this.entries = stored && stored.length > 0 ? stored : seedEntries();
    if (!stored || stored.length === 0) {
      this.persist();
    }
  }

  public static getInstance(): KnowledgeLibrary {
    if (!KnowledgeLibrary.instance) {
      KnowledgeLibrary.instance = new KnowledgeLibrary();
    }
    return KnowledgeLibrary.instance;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.entries);
    } catch {
      // best-effort
    }
  }

  public list(): KnowledgeEntry[] {
    return [...this.entries];
  }

  public listByDomain(domain: KnowledgeDomain): KnowledgeEntry[] {
    return this.entries.filter((entry) => entry.domain === domain);
  }

  public get(id: string): KnowledgeEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  public add(entry: Omit<KnowledgeEntry, "id" | "updatedAt">): KnowledgeEntry {
    const created: KnowledgeEntry = {
      ...entry,
      id: `${entry.domain}-${crypto.randomUUID().slice(0, 8)}`,
      updatedAt: Date.now(),
    };
    this.entries = [created, ...this.entries];
    this.persist();
    return created;
  }

  public update(id: string, patch: Partial<Omit<KnowledgeEntry, "id">>): void {
    this.entries = this.entries.map((entry) =>
      entry.id === id ? { ...entry, ...patch, updatedAt: Date.now() } : entry,
    );
    this.persist();
  }

  public setStatus(id: string, status: KnowledgeStatus): void {
    this.update(id, { status });
  }

  public remove(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.persist();
  }

  public search(query: string): KnowledgeEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    return this.entries.filter((entry) =>
      `${entry.title} ${entry.detail} ${entry.domain}`.toLowerCase().includes(q),
    );
  }

  /** Entries that are not yet trustworthy — the gap detector's input. */
  public gaps(): KnowledgeEntry[] {
    return this.entries.filter((entry) => GAP_STATUSES.includes(entry.status));
  }

  /** Counts per status — how much of the library is verified. */
  public statusCounts(): Record<KnowledgeStatus, number> {
    const counts: Record<KnowledgeStatus, number> = {
      known: 0,
      learned: 0,
      inferred: 0,
      hypothesized: 0,
      unverified: 0,
      tested: 0,
      verified: 0,
    };
    for (const entry of this.entries) {
      counts[entry.status] += 1;
    }
    return counts;
  }
}
