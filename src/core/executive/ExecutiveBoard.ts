/**
 * ==========================================================
 * LÉLU
 * EXECUTIVE BOARD — the authoritative executive model
 *
 * The five executives below are ONE coordinated intelligence.
 * They are NOT new brains or new stores — each maps to the
 * systems that already exist in this codebase, so a consult
 * routes through the real runtime instead of a parallel copy:
 *
 *   LÉLU                        → AIService / Brain / MemoryBridge
 *   M.S. Ma'at Sentinel         → AutonomyGate + security guards
 *   Architect Executive         → ArchitectureMap / CapabilityRegistry
 *   Engineering & Systems       → SandboxFS / SelfDevelopmentEngine
 *   Agent Forge Executive       → AgentStore / AgentTemplates / AgentRunner
 *   Caretaker                   → HealthIntelligence + scientific agents
 *
 * The visual cosmos board (cosmos/CosmosTypes EXECUTIVE_DEFS)
 * is the same board — ExecutiveType keys are preserved; only the
 * names/domains were updated to match these five executives.
 * ==========================================================
 */

import AgentStore from "../agents/AgentStore";
import AutonomyGate from "../cognition/AutonomyGate";
import SelfModel from "../cognition/SelfModel";
import AvatarStore from "../avatar/AvatarProfile";
import ArchitectureMap from "../selfdev/ArchitectureMap";
import type { ExecutiveType } from "../../app/scene/genesis/cosmos/CosmosTypes";

export type ExecutiveId = "lelu" | "maat" | "architect" | "engineering" | "forge" | "caretaker";

export interface ExecutiveDef {
  id: ExecutiveId;
  name: string;
  role: string;
  domain: string;
  responsibilities: string[];
  /** The existing cosmos executive this maps to (visual board). */
  cosmosType: ExecutiveType;
  /** The real runtime systems this executive owns. */
  systems: string[];
}

export const EXECUTIVES: ExecutiveDef[] = [
  {
    id: "lelu",
    name: "Lélu",
    role: "Central Intelligence · Direction · Cognition · Synthesis",
    domain: "Who LÉLU is, what she understands, and how everything is synthesized.",
    responsibilities: [
      "Maintain awareness of identity, capabilities, limitations, memories and goals",
      "Understand objectives, reason, decompose, delegate, coordinate, evaluate and learn",
      "Synthesize results from all executives and agents into one coherent response",
    ],
    cosmosType: "governor",
    systems: ["AIService", "Brain", "MemoryBridge", "CognitiveCore", "ProactiveCore"],
  },
  {
    id: "maat",
    name: "M.S. Ma'at Sentinel",
    role: "Defense · Security · Protection · Privacy · Resilience",
    domain: "Protecting LÉLU, authorized users, memory, credentials and infrastructure.",
    responsibilities: [
      "Security review before consequential or external actions",
      "Identity/personality integrity, prompt-injection defense and secret protection",
      "Permission/access management and resilience",
      "Create specialized security agents through Agent Forge when needed",
    ],
    cosmosType: "warden",
    systems: ["AutonomyGate", "PromptInjectionGuard", "PersonalityGuard", "NativeCapabilityRegistry"],
  },
  {
    id: "architect",
    name: "Architect Executive",
    role: "Architecture · System Coherence · Long-Term Evolution",
    domain: "What the system should be and how every subsystem connects.",
    responsibilities: [
      "Maintain the living architectural map (dependencies, consumers, failures)",
      "Prevent duplicate systems and detect disconnected subsystems",
      "Plan refactors, migrations and technical-debt reduction",
    ],
    cosmosType: "sage",
    systems: ["ArchitectureMap", "CapabilityRegistry", "SelfDevelopmentEngine"],
  },
  {
    id: "engineering",
    name: "Engineering & Systems",
    role: "Construction · Implementation · Integration · Testing · Deployment · Optimization",
    domain: "Turning architecture and ideas into working, tested systems.",
    responsibilities: [
      "Implement, integrate, test, debug, optimize and maintain systems",
      "Drive the idea → requirements → architecture → tasks → implementation → validation pipeline",
      "Operate inside the sandbox first; production changes go through approval",
    ],
    cosmosType: "engineer",
    systems: ["SandboxFS", "SandboxRuntime", "WorkspaceRuntime", "SelfDevelopmentLoop"],
  },
  {
    id: "forge",
    name: "Agent Forge Executive",
    role: "Agent Creation · Multiplicity · Specialization · Delegation · Agent Evolution",
    domain: "Creating and evolving LÉLU's workforce of specialists.",
    responsibilities: [
      "Create, specialize, clone, evaluate, improve, merge and retire agents",
      "Delegate tasks and coordinate agent swarms with bounded recursion",
      "Turn successful strategies into reusable agent templates",
    ],
    cosmosType: "forge",
    systems: ["AgentStore", "AgentTemplates", "AgentRunner", "AgentEventBus"],
  },
  {
    id: "caretaker",
    name: "Caretaker",
    role: "Health · Wellness · Life Operations · Biomedical & Bioengineering Intelligence",
    domain: "The person, their environment, their life operations, and the scientific systems relevant to health.",
    responsibilities: [
      "Coordinate life operations: routines, organization, environment, hospitality, travel and human experience",
      "Provide evidence-graded health, holistic, biomedical, pharmacology and biotechnology intelligence",
      "Distinguish health information from clinical decision-making (never diagnose or prescribe)",
      "Protect personal health information through the information firewall",
      "Create and coordinate scientific specialists through Agent Forge",
    ],
    cosmosType: "caretaker",
    systems: ["HealthIntelligence", "PromptInjectionGuard", "AgentStore", "ProjectStore"],
  },
];

export interface BoardConsultation {
  executiveId: ExecutiveId;
  executiveName: string;
  objective: string;
  guidance: string;
  delegatedTo: string | null;
  securityLevel: number;
  timestamp: number;
}

export interface BoardSnapshot {
  executives: { id: ExecutiveId; name: string; status: string }[];
  agents: number;
  runnableAgents: number;
  autonomyLevel: number;
  architectureSubsystems: number;
  capabilities: string[];
  identityName: string;
}

export default class ExecutiveBoard {
  private static instance: ExecutiveBoard | null = null;

  public static getInstance(): ExecutiveBoard {
    if (!ExecutiveBoard.instance) {
      ExecutiveBoard.instance = new ExecutiveBoard();
    }
    return ExecutiveBoard.instance;
  }

  public list(): ExecutiveDef[] {
    return EXECUTIVES;
  }

  public get(id: ExecutiveId): ExecutiveDef | undefined {
    return EXECUTIVES.find((executive) => executive.id === id);
  }

  /** Current board state, read from the real runtime (cheap + synchronous). */
  public snapshot(): BoardSnapshot {
    const agents = AgentStore.getInstance().list();
    const runnable = AgentStore.getInstance().runnable();
    const selfModel = SelfModel.getInstance().get();
    const avatar = AvatarStore.getInstance().get();

    return {
      executives: EXECUTIVES.map((executive) => ({
        id: executive.id,
        name: executive.name,
        status: "active",
      })),
      agents: agents.length,
      runnableAgents: runnable.length,
      autonomyLevel: AutonomyGate.getInstance().getLevel(),
      architectureSubsystems: ArchitectureMap.getInstance().list().length,
      capabilities: selfModel.capabilities,
      identityName: avatar.identity.name || selfModel.identity.name,
    };
  }

  /**
   * Route an objective through the coordinated executive chain:
   * LÉLU → Architect → Engineering → Agent Forge → M.S. security review.
   * Each consultation is deterministic guidance grounded in the mapped
   * system — it never fabricates work the system cannot actually do.
   */
  public route(objective: string): BoardConsultation[] {
    const chain: ExecutiveId[] = ["lelu", "architect", "engineering", "forge", "maat"];
    return chain.map((id) => this.consult(id, objective));
  }

  /** Consult a single executive for an objective. */
  public consult(id: ExecutiveId, objective: string): BoardConsultation {
    const executive = this.get(id) ?? EXECUTIVES[0];
    const securityLevel = AutonomyGate.getInstance().getLevel();
    const now = Date.now();
    const summary = objective.trim().slice(0, 140) || "the current objective";

    const guidance = this.guidanceFor(id, summary, securityLevel);
    const delegatedTo = this.delegationFor(id);

    return {
      executiveId: executive.id,
      executiveName: executive.name,
      objective: summary,
      guidance,
      delegatedTo,
      securityLevel,
      timestamp: now,
    };
  }

  private guidanceFor(id: ExecutiveId, summary: string, securityLevel: number): string {
    switch (id) {
      case "lelu":
        return `Understand "${summary}", decompose it into bounded tasks, delegate to the right executives/agents, then synthesize and remember the outcome.`;
      case "architect":
        return `Map "${summary}" against the living ArchitectureMap — identify dependencies, consumers, and duplicate subsystems before any change.`;
      case "engineering":
        return `Implement "${summary}" sandbox-first (autonomy L${securityLevel}), then test, validate and report the candidate change for approval.`;
      case "forge":
        return `Determine whether "${summary}" needs a new or specialized agent; if so, create it from a template with bounded permissions and recursion limits.`;
      case "maat":
        return `Review "${summary}" for security, privacy and policy compliance; minimize information sent to external systems and require authorization for consequential actions.`;
      case "caretaker":
        return `Address "${summary}" with evidence-graded health intelligence — separate established guidance from preliminary/traditional evidence, never diagnose or prescribe, and protect personal health information.`;
    }
  }

  private delegationFor(id: ExecutiveId): string | null {
    switch (id) {
      case "forge":
        return "AgentStore.createFromTemplate / AgentRunner.run";
      case "engineering":
        return "SandboxFS + SelfDevelopmentEngine";
      case "architect":
        return "ArchitectureMap.query / dependentsOf";
      case "maat":
        return "AutonomyGate + PromptInjectionGuard";
      case "caretaker":
        return "HealthIntelligence + AgentStore (scientific specialists)";
      default:
        return null;
    }
  }
}
