/**
 * ==========================================================
 * LÉLU — NEURAL MAP STEWARDSHIP (WP14 · WP15 · WP17)
 *
 * Connects the Neural Map to the cognition and governance she already has.
 * It adds no scheduler, no queue, no agent and no governor of its own:
 *
 *   understand  what the person is looking at (aspect, layout or 3D view,
 *               selection) is published here by the map and read into the
 *               self-state text her model receives every turn
 *               (ExecutiveRuntime.getSelfStateText).
 *   diagnose    findings from REAL data only: V2 (subsystems, imports,
 *               change history), V3 (agents, tasks, conversations), the
 *               conversation registry, and RepoExecutive.capabilityGaps().
 *   research    the Repository-Agent role is DISTRIBUTED, and used as is:
 *               RepoExecutive (discover / research / compare),
 *               ResourceIntelligence (licence, class, risk verdicts),
 *               RepoExecutor + EngineeringCouncil (inspection and reviews,
 *               through ApprovalGate). Network research runs on request.
 *   propose     ImprovementQueue.add — the one self-improvement pipeline.
 *   govern      the Governor is the existing chain: the Architect
 *               executive is consulted (ExecutiveBoard.consult, recorded
 *               here as the acknowledgment), AutonomyGate bounds what may
 *               run, and the OWNER decides: approve / reject / defer /
 *               request changes. Approved proposals are developed by the
 *               existing SelfDevelopmentLoop in the sandbox.
 *   learn       outcomes of her proposals are read back, recorded on
 *               NeuralMapBridge, and a finding kind the owner rejected
 *               twice is not proposed again.
 *
 * The cycle runs on CognitiveLoop's existing heartbeat, at most every 6 h,
 * makes no model call, and proposes at most 3 things per cycle.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import ImprovementQueue, { type ImprovementProposal } from "./ImprovementQueue";
import { v2Graph, v3Graph, type ExecutiveLike } from "../neural/multiverse/Aspects";
import type { LeluAgent } from "../agents/AgentTypes";
import type { ConversationRecord } from "../observability/ConversationRegistry";
import type { ToolDefinition } from "../tools/ToolRegistry";
import { registerExecutor, type ToolExecutor } from "../tools/ToolDispatcher";

/* ---------------------------------------------------------- what she sees */

export interface MapViewState {
  aspect: "v1" | "v2" | "v3";
  layout: string;
  view3d: string | null;
  selection: { id: string; label: string; kind: string; facts: Record<string, string | number | boolean> } | null;
  open: boolean;
  at: number;
}

let view: MapViewState | null = null;
export function publishMapView(v: Omit<MapViewState, "at">): void {
  view = { ...v, at: Date.now() };
}
export function currentMapView(): MapViewState | null {
  return view;
}

/** One paragraph for her model's self-state: what is on the map now and what she found. */
export function mapAwarenessText(): string {
  const lines: string[] = [];
  const v = view;
  if (v?.open) {
    const how = v.view3d ? `3D view "${v.view3d}"` : `layout "${v.layout}"`;
    lines.push(`Neural Map open: aspect ${v.aspect.toUpperCase()} (${v.aspect === "v1" ? "canonical knowledge" : v.aspect === "v2" ? "your cognitive architecture" : "your agent society"}), ${how}.`);
    if (v.selection) lines.push(`Selected: ${v.selection.label} (${v.selection.kind}) — ${Object.entries(v.selection.facts).slice(0, 6).map(([k, x]) => `${k}: ${x}`).join("; ")}.`);
  }
  const s = NeuralMapSteward.getInstance();
  const last = s.lastCycle();
  if (last) lines.push(`Last development cycle ${new Date(last.at).toISOString()}: ${last.findings} finding(s), ${last.proposed.length} proposed, ${last.awaitingOwner} awaiting the owner.`);
  return lines.join("\n");
}

/* ---------------------------------------------------------- findings */

export type FindingKind = "missing-capability" | "weak-dependency" | "unchanged" | "unclassified" | "agent-reliability" | "agent-unused" | "usage";

export interface Finding {
  id: string;
  kind: FindingKind;
  subject: string;
  title: string;
  evidence: string;
  suggestion: string;
  severity: number; // 1–5
}

export interface DiagnosisInput {
  architecture?: Parameters<typeof v2Graph>[0];
  executives: ExecutiveLike[];
  agents: LeluAgent[];
  conversations: ConversationRecord[];
  /** RepoExecutive.capabilityGaps(): CapabilityRegistry / manifest entries that are partial, planned, broken or unavailable. */
  gaps: Array<{ capabilityId: string; name: string; status: string; reason: string }>;
}

/** Pure: real data in, findings out. */
export function diagnose(input: DiagnosisInput): Finding[] {
  const out: Finding[] = [];
  const g = v2Graph(input.architecture);
  const subs = g.nodes.filter((n) => n.kind === "subsystem");
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const e of g.edges.filter((x) => x.kind === "imports")) {
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + (e.weight ?? 1));
    outbound.set(e.from, (outbound.get(e.from) ?? 0) + (e.weight ?? 1));
  }
  for (const n of subs) {
    const lines = Number(n.facts.lines);
    const ins = inbound.get(n.id) ?? 0;
    if (ins === 0 && n.label !== "core-root" && lines > 200)
      out.push({ id: `weak:${n.label}`, kind: "weak-dependency", subject: n.id, title: `${n.label} is imported by no other subsystem`, evidence: `${lines} lines in ${n.facts.path}; 0 static imports from the rest of src/core.`, suggestion: `Check whether ${n.label} is reached only from the UI or is dead weight; wire it through the subsystem that should own it, or retire it.`, severity: lines > 2000 ? 3 : 2 });
    if (n.facts.function === "Unclassified")
      out.push({ id: `unclassified:${n.label}`, kind: "unclassified", subject: n.id, title: `${n.label} has no cognitive function`, evidence: `${n.facts.path} is not in the architecture classification.`, suggestion: "Classify it (FUNCTION_OF in scripts/neural/build-cognitive-architecture.ts) so it is part of her self-model.", severity: 1 });
    const commitsKey = Object.keys(n.facts).find((k) => k.startsWith("commits ("));
    if (commitsKey && Number(n.facts[commitsKey]) === 0 && lines > 1500 && (inbound.get(n.id) ?? 0) > 20)
      out.push({ id: `unchanged:${n.label}`, kind: "unchanged", subject: n.id, title: `${n.label} is heavily used and unchanged in the recorded history`, evidence: `${lines} lines, ${inbound.get(n.id)} imports from other subsystems, 0 commits in ${commitsKey.slice(9, -1)}.`, suggestion: "Review it against current requirements and tests; it carries much of the system and has not been revisited in the available history.", severity: 2 });
  }
  const fns = g.nodes.filter((n) => n.kind === "function");
  for (const f of fns) if (Number(f.facts.subsystems) === 0) out.push({ id: `missing:${f.group}`, kind: "missing-capability", subject: f.id, title: `No subsystem serves ${f.label}`, evidence: "The architecture has the function but no directory implements it.", suggestion: `Decide whether ${f.label} is needed; if so, research an implementation.`, severity: 3 });
  for (const gap of input.gaps.slice(0, 5))
    out.push({ id: `gap:${gap.capabilityId}`, kind: "missing-capability", subject: `capability:${gap.capabilityId}`, title: `Capability gap: ${gap.name} (${gap.status})`, evidence: `${gap.reason} — RepoExecutive.capabilityGaps (CapabilityRegistry / manifest).`, suggestion: "Research open-source implementations through the repository workforce and compare them before proposing an integration.", severity: 3 });
  const society = v3Graph(input.executives, input.agents);
  for (const n of society.nodes.filter((x) => x.kind === "agent")) {
    const done = Number(n.facts.complete);
    const failed = Number(n.facts.failed);
    if (done + failed >= 3 && failed / (done + failed) > 0.5)
      out.push({ id: `reliability:${n.source.id}`, kind: "agent-reliability", subject: n.id, title: `${n.label} fails more often than it succeeds`, evidence: `${failed} failed of ${done + failed} finished tasks.`, suggestion: `Inspect ${n.label}'s recent errors; change its provider or instructions, or pause it.`, severity: 3 });
    if (Number(n.facts.tasks) === 0 && n.facts.status === "active")
      out.push({ id: `unused:${n.source.id}`, kind: "agent-unused", subject: n.id, title: `${n.label} has never been given work`, evidence: "No task in its record.", suggestion: `Give ${n.label} a goal, or archive it if its role is covered.`, severity: 1 });
  }
  const heavy = input.conversations.filter((c) => c.modelCalls >= 10 && c.messagesOut === 0 && c.type !== "background" && c.type !== "unattributed");
  for (const c of heavy.slice(0, 3)) out.push({ id: `usage:${c.id}`, kind: "usage", subject: c.id, title: `${c.title} used ${c.modelCalls} model calls with no reply`, evidence: `Registry: ${c.modelCalls} calls, ${c.failedCalls} failed, 0 replies.`, suggestion: "Find why it produced nothing; set a per-conversation limit if it repeats.", severity: 3 });
  const unattributed = input.conversations.filter((c) => c.type === "unattributed").reduce((s, c) => s + c.modelCalls, 0);
  if (unattributed >= 5) out.push({ id: "usage:unattributed", kind: "usage", subject: "registry", title: `${unattributed} model calls carried no conversation id`, evidence: "Counted in the registry's per-day unattributed records.", suggestion: "Find the caller that sends requests without a conversationId and pass one, so its usage is traceable.", severity: 2 });
  return out.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
}

/* ---------------------------------------------------------- the cycle */

export type StageName = "observe" | "diagnose" | "research" | "compare" | "propose" | "sandbox" | "validate" | "govern" | "deliver" | "learn";
export interface CycleReport {
  at: number;
  trigger: "heartbeat" | "owner" | "tool";
  stages: Array<{ stage: StageName; status: "done" | "skipped" | "waiting" | "failed"; detail: string; ms: number }>;
  findings: number;
  proposed: string[];
  awaitingOwner: number;
}

export interface Acknowledgment {
  proposalId: string;
  executive: string;
  guidance: string;
  securityLevel: number;
  at: number;
}

export interface OwnerAction {
  proposalId: string;
  action: "approve" | "reject" | "defer" | "request-changes";
  note?: string;
  at: number;
}

interface State {
  cycles: CycleReport[];
  acks: Acknowledgment[];
  actions: OwnerAction[];
  /** finding id → proposal id (so the same finding is never proposed twice). */
  proposedFor: Record<string, string>;
  /** Finding kinds the owner rejected, counted (learn). */
  rejectedKinds: Record<string, number>;
  research: Array<{ at: number; query: string; candidates: Array<{ name: string; url?: string; stars?: number; license?: string; updatedAt?: string; archived?: boolean }>; errors: string[] }>;
}

const KEY = "lelu.neural.steward.v1";
const MIN_GAP_MS = 6 * 3_600_000;
const MAX_PROPOSALS = 3;

export default class NeuralMapSteward {
  private static instance: NeuralMapSteward | null = null;
  static getInstance(): NeuralMapSteward {
    return (NeuralMapSteward.instance ??= new NeuralMapSteward());
  }

  private state: State;
  private listeners = new Set<() => void>();

  constructor(private readonly kv: { get<T>(k: string): T | null; set<T>(k: string, v: T): boolean } = KvStore.getInstance()) {
    this.state = { cycles: [], acks: [], actions: [], proposedFor: {}, rejectedKinds: {}, research: [], ...(kv.get<Partial<State>>(KEY) ?? {}) } as State;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  private save(): void {
    this.kv.set(KEY, this.state);
    for (const l of this.listeners) l();
  }

  lastCycle(): CycleReport | undefined {
    return this.state.cycles.at(-1);
  }
  cycles(): CycleReport[] {
    return [...this.state.cycles].reverse();
  }
  acknowledgments(proposalId?: string): Acknowledgment[] {
    return this.state.acks.filter((a) => !proposalId || a.proposalId === proposalId);
  }
  ownerActions(proposalId?: string): OwnerAction[] {
    return this.state.actions.filter((a) => !proposalId || a.proposalId === proposalId);
  }
  researchLog() {
    return [...this.state.research].reverse();
  }

  /** Her proposals, with where each stands. */
  proposals(): Array<ImprovementProposal & { finding: string; acknowledged: Acknowledgment | undefined; lastOwnerAction: OwnerAction | undefined }> {
    const q = ImprovementQueue.getInstance();
    return Object.entries(this.state.proposedFor)
      .map(([finding, id]) => {
        const p = q.get(id);
        return p ? { ...p, finding, acknowledged: this.acknowledgments(id).at(-1), lastOwnerAction: this.ownerActions(id).at(-1) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.updated - a.updated);
  }

  /** Gather the real inputs (lazy imports keep this module light for tests). */
  async gather(): Promise<DiagnosisInput> {
    const [{ default: AgentStore }, { EXECUTIVES }, { default: ConversationRegistry }, { default: RepoExecutive }] = await Promise.all([
      import("../agents/AgentStore"),
      import("../executive/ExecutiveBoard"),
      import("../observability/ConversationRegistry"),
      import("../acquisition/RepoExecutive"),
    ]);
    let gaps: DiagnosisInput["gaps"] = [];
    try {
      gaps = RepoExecutive.getInstance().capabilityGaps();
    } catch {
      gaps = [];
    }
    return { executives: EXECUTIVES, agents: AgentStore.getInstance().list(), conversations: ConversationRegistry.getInstance().list(), gaps };
  }

  /** Submit one finding to the improvement pipeline and the governor. */
  async propose(f: Finding): Promise<ImprovementProposal> {
    const q = ImprovementQueue.getInstance();
    const p = q.add({
      title: f.title,
      problem: f.title,
      observation: `Neural Map diagnosis (${f.kind}) of ${f.subject}.`,
      evidence: f.evidence,
      proposedSolution: f.suggestion,
      expectedBenefit: f.kind === "usage" ? "Less unaccounted or unproductive model use." : f.kind.startsWith("agent") ? "A more reliable, better-used agent society." : "A more coherent architecture that she can reason about.",
      dependencies: [],
      risk: f.severity >= 3 ? "medium: touches a subsystem other parts depend on" : "low",
      requiredTools: [],
      requiredAgents: f.kind === "missing-capability" ? ["Resource Intelligence", "Engineering Agent"] : ["Engineering Agent"],
      complexity: f.severity >= 3 ? "medium" : "low",
      kind: f.kind === "missing-capability" ? "New Capability" : f.kind === "usage" ? "Optimization" : f.kind === "agent-reliability" ? "Bug" : "Limitation",
      version: "1",
      testPlan: "Re-run the Neural Map diagnosis: the finding must no longer appear; npm test must stay green.",
      status: "Proposed",
    });
    this.state.proposedFor[f.id] = p.id;
    // The governor's acknowledgment: the Architect executive is consulted on
    // the proposal (and the Sentinel on anything touching security).
    const { default: ExecutiveBoard } = await import("../executive/ExecutiveBoard");
    const board = ExecutiveBoard.getInstance();
    for (const id of f.kind === "missing-capability" ? (["architect", "maat"] as const) : (["architect"] as const)) {
      const c = board.consult(id, `Proposal ${p.id}: ${f.title}`);
      this.state.acks.push({ proposalId: p.id, executive: c.executiveName, guidance: c.guidance, securityLevel: c.securityLevel, at: c.timestamp });
    }
    this.state.acks = this.state.acks.slice(-300);
    this.save();
    try {
      const { default: NeuralMapBridge } = await import("../conversation/NeuralMapBridge");
      NeuralMapBridge.getInstance().record({ kind: "recommendation", subject: f.title, detail: `Proposed ${p.id} from ${f.kind}: ${f.evidence}`, visibility: "user-visible", refs: {}, data: { proposalId: p.id, finding: f.id } });
    } catch {
      /* the bridge is optional here */
    }
    return p;
  }

  /** The owner's decision, through the existing queue. Returns the status now in force. */
  decide(proposalId: string, action: OwnerAction["action"], note?: string): string {
    const q = ImprovementQueue.getInstance();
    const p = q.get(proposalId);
    if (!p) throw new Error("No such proposal.");
    if (action === "approve") q.setStatus(proposalId, "Approved");
    else if (action === "reject") {
      q.setStatus(proposalId, "Rejected");
      const finding = Object.entries(this.state.proposedFor).find(([, id]) => id === proposalId)?.[0];
      const kind = finding?.split(":")[0];
      if (kind) this.state.rejectedKinds[kind] = (this.state.rejectedKinds[kind] ?? 0) + 1;
    } else if (action === "request-changes") q.update(proposalId, { status: "Analyzing", evidence: `${p.evidence}\n\nOwner asked for changes${note ? `: ${note}` : "."}` });
    this.state.actions.push({ proposalId, action, ...(note ? { note } : {}), at: Date.now() });
    this.save();
    return q.get(proposalId)!.status;
  }

  /** Repository research through the existing workforce (network; on request). */
  async research(query: string): Promise<State["research"][number]> {
    const { default: RepoExecutive } = await import("../acquisition/RepoExecutive");
    const at = Date.now();
    try {
      const r = await RepoExecutive.getInstance().discover({ keywords: query, limit: 8 });
      const entry = {
        at,
        query,
        candidates: r.candidates.slice(0, 8).map((c) => ({ name: c.identifier, url: c.url, stars: c.stars, license: c.license, updatedAt: c.updatedAt, archived: c.archived })),
        errors: r.errors.map((e) => `${e.sourceId}: ${e.error}`),
      };
      this.state.research = [...this.state.research, entry].slice(-30);
      this.save();
      return entry;
    } catch (error) {
      const entry = { at, query, candidates: [], errors: [(error as Error).message] };
      this.state.research = [...this.state.research, entry].slice(-30);
      this.save();
      return entry;
    }
  }

  /**
   * Observe → Diagnose → Research → Compare → Propose → Sandbox → Validate →
   * Govern → Deliver → Learn. Bounded; no model call; the sandbox, validation
   * and delivery stages are the existing SelfDevelopmentLoop's, reported here.
   */
  async cycle(trigger: CycleReport["trigger"] = "heartbeat", input?: DiagnosisInput): Promise<CycleReport | null> {
    const last = this.lastCycle();
    if (trigger === "heartbeat" && last && Date.now() - last.at < MIN_GAP_MS) return null;
    const stages: CycleReport["stages"] = [];
    const time = async <T,>(stage: StageName, fn: () => Promise<{ status: CycleReport["stages"][number]["status"]; detail: string; value?: T }>) => {
      const t0 = Date.now();
      try {
        const r = await fn();
        stages.push({ stage, status: r.status, detail: r.detail, ms: Date.now() - t0 });
        return r.value;
      } catch (e) {
        stages.push({ stage, status: "failed", detail: (e as Error).message, ms: Date.now() - t0 });
        return undefined;
      }
    };
    const data = await time<DiagnosisInput>("observe", async () => {
      const d = input ?? (await this.gather());
      return { status: "done", detail: `${d.agents.length} agents, ${d.conversations.length} conversations, ${d.gaps.length} capability gaps, architecture of ${v2Graph(d.architecture).nodes.filter((n) => n.kind === "subsystem").length} subsystems`, value: d };
    });
    const findings = data ? ((await time<Finding[]>("diagnose", async () => { const f = diagnose(data); return { status: "done", detail: `${f.length} finding(s)`, value: f }; })) ?? []) : [];
    await time("research", async () => ({ status: "done", detail: "Local evidence only (architecture, registry, capability gaps). Repository search runs on request: development.research." }));
    const fresh = await time<Finding[]>("compare", async () => {
      const q = ImprovementQueue.getInstance();
      const blocked = (f: Finding) => (this.state.rejectedKinds[f.id.split(":")[0]] ?? 0) >= 2;
      const list = findings.filter((f) => !this.state.proposedFor[f.id] && !q.hasOpenSimilar(f.title) && !blocked(f)).slice(0, MAX_PROPOSALS);
      return { status: "done", detail: `${list.length} new, ranked by severity; ${findings.length - list.length} already proposed, open or learned-unwanted`, value: list };
    });
    const proposed: string[] = [];
    await time("propose", async () => {
      for (const f of fresh ?? []) proposed.push((await this.propose(f)).id);
      return { status: "done", detail: proposed.length ? `Submitted ${proposed.join(", ")} to the improvement queue` : "Nothing new to propose" };
    });
    const mine = this.proposals();
    const count = (statuses: string[]) => mine.filter((p) => statuses.includes(p.status)).length;
    await time("sandbox", async () => ({ status: count(["In Development"]) ? "done" : "waiting", detail: `${count(["Approved"])} approved and queued for the sandbox, ${count(["In Development"])} in development (SelfDevelopmentLoop)` }));
    await time("validate", async () => ({ status: count(["Testing", "Evaluation"]) ? "done" : "waiting", detail: `${count(["Testing", "Evaluation"])} being tested, ${count(["Failed", "Blocked"])} failed or blocked` }));
    const awaitingOwner = count(["Detected", "Analyzing", "Proposed"]);
    await time("govern", async () => ({ status: awaitingOwner ? "waiting" : "done", detail: `${awaitingOwner} awaiting the owner's decision; ${this.state.acks.length} executive acknowledgments recorded` }));
    await time("deliver", async () => ({ status: count(["Ready", "Integrated", "Recorded"]) ? "done" : "waiting", detail: `${count(["Ready"])} ready for review, ${count(["Integrated", "Recorded"])} integrated. Merging and deployment stay with the owner.` }));
    await time("learn", async () => {
      const rejected = Object.entries(this.state.rejectedKinds).map(([k, n]) => `${k}×${n}`);
      return { status: "done", detail: rejected.length ? `Owner rejected: ${rejected.join(", ")}; kinds rejected twice are no longer proposed` : "No owner decisions to learn from yet" };
    });
    const report: CycleReport = { at: Date.now(), trigger, stages, findings: findings.length, proposed, awaitingOwner };
    this.state.cycles = [...this.state.cycles, report].slice(-50);
    this.save();
    return report;
  }
}

/* ---------------------------------------------------------- tools */

const tool = (id: string, name: string, description: string, inputSchema: Record<string, unknown>, risk: 0 | 1 | 2 = 0): ToolDefinition => ({ id, name, description, category: "System", permissions: risk ? ["READ", "WRITE"] : ["READ"], riskLevel: risk, available: true, inputSchema });
const EMPTY = { type: "object", properties: {}, additionalProperties: false };
const QUERY = { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false };
const DECIDE = { type: "object", properties: { proposalId: { type: "string" }, action: { type: "string", enum: ["approve", "reject", "defer", "request-changes"] }, note: { type: "string" } }, required: ["proposalId", "action"], additionalProperties: false };

export const STEWARD_TOOLS: ToolDefinition[] = [
  tool("neural.view", "What the Neural Map shows", "The Neural Map aspect, layout or 3D view and the selected node the person is looking at now, with its facts.", EMPTY),
  tool("development.diagnose", "Diagnose from the Neural Map", "Findings from her real architecture (V2), agent society (V3) and usage registry: missing capabilities, weak dependencies, unchanged heavily-used parts, unreliable or unused agents, unaccounted usage.", EMPTY),
  tool("development.cycle", "Run a development cycle", "Observe → Diagnose → Research → Compare → Propose → Sandbox → Validate → Govern → Deliver → Learn, bounded; proposals go to the improvement queue and the Architect executive.", EMPTY, 1),
  tool("development.research", "Research repositories", "Search open-source repositories through the repository workforce (RepoExecutive) and report what was found, with licences and errors as returned.", QUERY),
  tool("development.decide", "Record the owner's decision", "Approve, reject, defer or request changes on one of her proposals — only when the person has said so.", DECIDE, 2),
];

export const STEWARD_EXECUTORS: ToolExecutor[] = [
  { id: "neural.view", parameters: EMPTY, run: async () => ({ ok: true, content: mapAwarenessText() || "The Neural Map is not open." }) },
  {
    id: "development.diagnose",
    parameters: EMPTY,
    run: async () => {
      const f = diagnose(await NeuralMapSteward.getInstance().gather());
      return { ok: true, content: f.length ? f.map((x) => `• [${x.kind}, severity ${x.severity}] ${x.title} — ${x.evidence} → ${x.suggestion}`).join("\n") : "No finding.", data: { findings: f } };
    },
  },
  {
    id: "development.cycle",
    parameters: EMPTY,
    run: async () => {
      const r = await NeuralMapSteward.getInstance().cycle("tool");
      return { ok: Boolean(r), content: r ? r.stages.map((s) => `${s.stage}: ${s.status} — ${s.detail}`).join("\n") : "Not run." };
    },
  },
  {
    id: "development.research",
    parameters: QUERY,
    run: async (args) => {
      const r = await NeuralMapSteward.getInstance().research(String(args.query ?? ""));
      return { ok: r.candidates.length > 0, content: [`${r.candidates.length} candidate(s) for “${r.query}”.`, ...r.candidates.map((c) => `• ${c.name}${c.stars !== undefined ? ` ★${c.stars}` : ""}${c.license ? ` (${c.license})` : ""}${c.url ? ` ${c.url}` : ""}`), ...r.errors.map((e) => `✗ ${e}`)].join("\n") };
    },
  },
  {
    id: "development.decide",
    parameters: DECIDE,
    run: async (args) => {
      const status = NeuralMapSteward.getInstance().decide(String(args.proposalId), args.action as OwnerAction["action"], typeof args.note === "string" ? args.note : undefined);
      return { ok: true, content: `Proposal ${String(args.proposalId)} is now ${status}.` };
    },
  },
];

export function registerStewardTools(): void {
  for (const executor of STEWARD_EXECUTORS) {
    const definition = STEWARD_TOOLS.find((t) => t.id === executor.id);
    if (!definition) continue;
    const added = registerExecutor(executor, definition);
    if (!added.ok) console.warn(`[NeuralMapSteward] ${executor.id} was not registered: ${added.reason}`);
  }
}
