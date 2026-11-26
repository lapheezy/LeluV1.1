/**
 * ==========================================================
 * LÉLU — CAPABILITY EVIDENCE
 *
 * A registry status is a claim. This file is what turns it into
 * an assessment: for each capability, the IMPLEMENTATION (source
 * files) and the VERIFICATION (repository tests and the runtime
 * self-test checks that actually exercise it).
 *
 * The rule the mission sets is enforced here: a commit, a status
 * or a title is never evidence on its own. A capability counts as
 * operational only when its implementation exists AND a named
 * check verifies it. Capabilities without evidence are reported
 * as unverified rather than silently promoted.
 *
 * The paths are asserted to exist by tests/self-awareness.test.ts,
 * so a rename cannot leave this table pointing at nothing — the
 * audit fails instead of the claim drifting.
 * ==========================================================
 */

export interface CapabilityEvidence {
  /** The CapabilityRegistry id this evidence belongs to. */
  id: string;
  /** Implementation files that must exist for the capability to exist. */
  sources: string[];
  /** Repository tests that cover it (run by `npm test`). */
  tests: string[];
  /** SelfTestRunner check names that execute the capability at runtime. */
  selfTests: string[];
  /** What the evidence demonstrates, in one honest sentence. */
  note: string;
}

/**
 * Limitations that a NEWER implementation removed. Each entry keeps the
 * exact old wording, so the improvement queue can recognise the
 * recommendation it came from, retire it, and keep the history.
 */
export interface ResolvedLimitation {
  capabilityId: string;
  /** The old limitation, verbatim. */
  limitation: string;
  /** What replaced it. */
  resolvedBy: string;
  /** Implementation evidence for the resolution. */
  sources: string[];
  /** Verification evidence for the resolution. */
  tests: string[];
  /** Exact SelfModel strings this resolution makes obsolete. */
  legacyModelEntries?: string[];
  /** Improvement titles this resolution retires (verbatim seeds). */
  proposalTitles?: string[];
  /** ISO date the resolution landed. */
  since: string;
}

export const CAPABILITY_EVIDENCE: CapabilityEvidence[] = [
  {
    id: "chat",
    sources: ["src/core/AIService.ts", "src/core/router/ProviderResolver.ts"],
    tests: ["tests/provider-fallback.test.ts", "tests/chat-surface.test.ts"],
    selfTests: [],
    note: "The conversation path and its provider chain are wired; answers still need a configured provider.",
  },
  {
    id: "memory",
    sources: ["src/brain/PatternMemory.ts", "src/core/memory/providers.ts"],
    tests: ["tests/memory-model.test.ts", "tests/conversation-memory.test.ts"],
    selfTests: ["KvStore roundtrip"],
    note: "Persistent memory with retrieval, exercised by the memory suites.",
  },
  {
    id: "cognition",
    sources: ["src/core/cognition/CognitiveLoop.ts", "src/core/cognition/CognitiveContext.ts"],
    tests: ["tests/cognitive-behavior.test.ts"],
    selfTests: ["Cognitive loop cycle"],
    note: "The cognitive loop runs and publishes its cycle.",
  },
  {
    id: "self-model",
    sources: ["src/core/cognition/SelfModel.ts", "src/core/selfdev/SelfAwareness.ts"],
    tests: ["tests/agentic-execution.test.ts", "tests/self-awareness.test.ts"],
    selfTests: ["Self-model → queue continuity"],
    note: "The self-model persists and is reconciled against the capability registry.",
  },
  {
    id: "knowledge",
    sources: ["src/core/cognition/KnowledgeLibrary.ts"],
    tests: ["tests/knowledge-relay-security.test.ts"],
    selfTests: ["Knowledge gap detection"],
    note: "The knowledge library stores entries and detects gaps.",
  },
  {
    id: "work-queue",
    sources: ["src/core/cognition/WorkQueue.ts"],
    tests: ["tests/work-queue.test.ts"],
    selfTests: ["Work queue workflow"],
    note: "The internal queue completes add → move → complete.",
  },
  {
    id: "autonomy",
    sources: ["src/core/cognition/AutonomyGate.ts", "src/core/cognition/AutonomyPolicy.ts"],
    tests: ["tests/autonomy-bridge.test.ts"],
    selfTests: ["Autonomy clamping"],
    note: "Autonomy levels clamp and gate actions.",
  },
  {
    id: "agents",
    sources: ["src/core/agents/AgentStore.ts"],
    tests: ["tests/agent-bounds.test.ts"],
    selfTests: ["Agent store CRUD"],
    note: "Agents persist with their configuration and history.",
  },
  {
    id: "projects",
    sources: ["src/core/projects/ProjectStore.ts"],
    tests: ["tests/project-interpretation.test.ts"],
    selfTests: [],
    note: "Projects and their items persist.",
  },
  {
    id: "sketch",
    sources: ["src/core/creative/SketchDocument.ts"],
    tests: ["tests/atelier.test.ts"],
    selfTests: ["Sketch document + export", "Sketch store CRUD"],
    note: "The offline sketch document round-trips and exports.",
  },
  {
    id: "render",
    sources: ["src/core/creative/RenderStore.ts"],
    tests: ["tests/render-architecture.test.ts"],
    selfTests: [],
    note: "The render engine registry and local procedural engine exist; cloud engines wait on keys.",
  },
  {
    id: "video",
    sources: ["src/core/creative/VideoProject.ts"],
    tests: ["tests/creative-build.test.ts"],
    selfTests: [],
    note: "Video projects carry scenes, shots and a timeline; generation itself still needs a provider.",
  },
  {
    id: "avatar",
    sources: [
      "src/core/avatar/Avatar3DReconstructor.ts",
      "src/core/avatar/LeluRig.ts",
      "src/app/scene/genesis/avatar/LeluCompanion.tsx",
    ],
    tests: ["tests/avatar-presence.test.ts", "tests/lelu-character.test.ts"],
    selfTests: [],
    note: "A 3D avatar rig renders and its presence follows live activity.",
  },
  {
    id: "engineering",
    sources: ["src/core/engineering/SandboxFS.ts", "src/core/engineering/EngineeringWorkspace.ts"],
    tests: ["tests/engineering-workspace.test.ts"],
    selfTests: ["Sandbox project generation", "Sandbox edit roundtrip"],
    note: "The sandbox filesystem and the project workspace round-trip real edits.",
  },
  {
    id: "sandbox-runtime",
    sources: ["src/core/engineering/SandboxRuntime.ts", "src/core/engineering/sandbox.worker.ts"],
    tests: ["tests/sandbox-security.test.ts"],
    selfTests: ["Sandbox runtime executes a script", "Sandbox test harness"],
    note: "Sandbox JavaScript actually executes in an isolated worker with captured output.",
  },
  {
    id: "self-development",
    sources: [
      "src/core/selfdev/SelfDevelopmentLoop.ts",
      "src/core/selfdev/SelfTestRunner.ts",
      // Mission 44: the laboratory is part of this capability, not a claim beside it.
      "plugins/labEngine.ts",
      "plugins/labApi.ts",
      "scripts/lab-scheduler.ts",
      "src/core/selfdev/lab/LabTools.ts",
    ],
    tests: [
      "tests/development-loop.test.ts",
      "tests/proposal-engineering.test.ts",
      "tests/self-development-lab.test.ts",
      "tests/lab-scheduler.test.ts",
    ],
    selfTests: ["Self-development loop → Ready", "Improvement queue workflow"],
    note:
      "The development loop stages a change, checks it, and stops at the approval boundary. The laboratory adds a real repository loop — inspect, discover, isolate, diff, verify — driven by a daemon that runs without a browser.",
  },
  {
    id: "self-diagnostics",
    sources: ["src/core/selfdev/SelfDiagnostics.ts"],
    tests: ["tests/live-state-integration.test.ts"],
    selfTests: ["Capability registry integrity"],
    note: "Diagnostics read real runtime state and report findings.",
  },
  {
    id: "versioning",
    sources: ["src/core/selfdev/VersionHistory.ts"],
    tests: ["tests/development-loop.test.ts"],
    selfTests: ["Self-development loop → Ready"],
    note: "Snapshots and version records make an experiment reversible.",
  },
  {
    id: "visual",
    sources: ["src/core/visual/VisualEngine.ts"],
    tests: ["tests/runtime-integrity.test.ts"],
    selfTests: [],
    note: "The ambient visual layer and its environment state exist.",
  },
  {
    id: "browser",
    sources: ["src/app/scene/genesis/GenesisBrowserPanel.tsx"],
    tests: ["tests/spatial-experience.test.ts"],
    selfTests: [],
    note: "The embedded browser panel opens idle; many sites still refuse embedding.",
  },
  {
    id: "workflows",
    sources: ["src/core/workflows/WorkflowStore.ts", "src/core/workflows/WorkflowEngine.ts"],
    tests: ["tests/workflows.test.ts", "tests/workflow-control-flow.test.ts", "tests/workflow-learning.test.ts"],
    selfTests: [],
    note: "Workflows execute ordered steps through the real tool dispatcher and are reusable.",
  },
  {
    id: "cosmos-navigation",
    sources: [
      "src/core/cosmos/CosmosNavigation.ts",
      "src/app/scene/spatial/orbitLayout.ts",
      "src/app/scene/spatial/SpatialNavigator.tsx",
    ],
    tests: ["tests/cosmos-navigation.test.ts", "tests/spatial-dock-groups.test.ts", "tests/spatial-orbit.test.ts"],
    selfTests: [],
    note: "The Cosmos is navigable: destinations are registered, travelled to, and reachable from the orbital navigation.",
  },
];

export const RESOLVED_LIMITATIONS: ResolvedLimitation[] = [
  {
    capabilityId: "workflows",
    limitation: "Agents run one-off prompts; there is no saved, reusable sequence of steps.",
    resolvedBy:
      "Reusable workflows: ordered steps with context passing, executed through the same dispatcher a model's tool call uses.",
    sources: ["src/core/workflows/WorkflowStore.ts", "src/core/workflows/WorkflowEngine.ts"],
    tests: ["tests/workflows.test.ts", "tests/workflow-control-flow.test.ts"],
    proposalTitles: ["Add reusable agent workflows"],
    since: "2026-11-20",
  },
  {
    capabilityId: "avatar",
    limitation: "2D config only — no animation or embodied avatar yet",
    resolvedBy: "A 3D avatar is reconstructed and rigged, and her presence follows live activity.",
    sources: [
      "src/core/avatar/Avatar3DReconstructor.ts",
      "src/core/avatar/LeluRig.ts",
      "src/app/scene/genesis/avatar/LeluCompanion.tsx",
    ],
    tests: ["tests/avatar-presence.test.ts", "tests/lelu-character.test.ts"],
    legacyModelEntries: ["real-time embodied avatar"],
    since: "2026-11-24",
  },
  {
    capabilityId: "sandbox-runtime",
    limitation: "sandbox execution is confined to files, not a runtime",
    resolvedBy:
      "Sandbox JavaScript runs in an isolated worker: captured stdout/stderr/exit/timing and a test harness.",
    sources: ["src/core/engineering/SandboxRuntime.ts", "src/core/engineering/sandbox.worker.ts"],
    tests: ["tests/sandbox-security.test.ts"],
    legacyModelEntries: ["sandbox execution is confined to files, not a runtime"],
    since: "2026-11-18",
  },
  {
    capabilityId: "self-development",
    limitation: "Self-tests exist but are only run on demand.",
    resolvedBy:
      "Every development run executes syntax and test checks, and integrate() consults the real SelfTestRunner suite before recording a status.",
    sources: ["src/core/selfdev/SelfDevelopmentLoop.ts", "src/core/selfdev/SelfTestRunner.ts"],
    tests: ["tests/development-loop.test.ts", "tests/live-state-integration.test.ts"],
    proposalTitles: ["Automated regression testing for self-development"],
    since: "2026-11-22",
  },
];

const BY_CAPABILITY = new Map(CAPABILITY_EVIDENCE.map((entry) => [entry.id, entry]));

export function evidenceFor(capabilityId: string): CapabilityEvidence | undefined {
  return BY_CAPABILITY.get(capabilityId);
}

/** Evidence that names at least one implementation file and one check. */
export function isVerified(capabilityId: string): boolean {
  const evidence = BY_CAPABILITY.get(capabilityId);
  if (!evidence) return false;
  return evidence.sources.length > 0 && (evidence.tests.length > 0 || evidence.selfTests.length > 0);
}

export function resolvedLimitationsFor(capabilityId: string): ResolvedLimitation[] {
  return RESOLVED_LIMITATIONS.filter((entry) => entry.capabilityId === capabilityId);
}

export function allResolvedLimitations(): ResolvedLimitation[] {
  return [...RESOLVED_LIMITATIONS];
}

/** The exact SelfModel strings that newer evidence has made obsolete. */
export function obsoleteSelfModelEntries(): string[] {
  return RESOLVED_LIMITATIONS.flatMap((entry) => entry.legacyModelEntries ?? []);
}

/** Human-readable evidence line, used in the self-awareness answers. */
export function describeEvidence(capabilityId: string): string {
  const evidence = BY_CAPABILITY.get(capabilityId);
  if (!evidence) return "No implementation or verification evidence is recorded.";
  const parts: string[] = [];
  if (evidence.sources.length) parts.push(`implementation: ${evidence.sources.join(", ")}`);
  if (evidence.tests.length) parts.push(`tests: ${evidence.tests.join(", ")}`);
  if (evidence.selfTests.length) parts.push(`runtime checks: ${evidence.selfTests.join(", ")}`);
  return `${parts.join(" · ")} — ${evidence.note}`;
}
