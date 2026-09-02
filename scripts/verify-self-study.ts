/**
 * LÉLU AUTONOMOUS SELF-COGNITION — VERIFICATION
 *
 * The claim under test is not "a loop exists". It is:
 *
 *   With no user message, LÉLU derives what she does not know
 *   about her OWN system from her mission and her real
 *   architecture, reads her REAL source to answer it, delegates
 *   to a REAL agent, stores what she learned in her REAL memory,
 *   and then names a DIFFERENT next objective — twice in a row.
 *
 * Everything here drives production modules. Nothing is mocked
 * except the browser surfaces Node lacks (localStorage, window,
 * relative-URL fetch), and `/api/engineer/read` is the same live
 * endpoint SelfCode prefers inside the browser.
 *
 * Run:
 *   bun run dev &
 *   bun run scripts/verify-self-study.ts [baseUrl]
 */

const BASE = process.argv[2] ?? "http://127.0.0.1:5173";

/* ------------------------------------------------------------------ */
/* browser surfaces Node does not have                                 */
/* ------------------------------------------------------------------ */

const store = new Map<string, string>();
const localStorageShim = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
};
// @ts-expect-error — Node has no localStorage
globalThis.localStorage = localStorageShim;
// @ts-expect-error — the modules under test call window.setTimeout
globalThis.window = globalThis;

// PatternMemory (long-term memory) is IndexedDB-backed. Without this
// the whole provider chain dies with "indexedDB is not defined" — which
// is how a runtime error first got stored as a self-knowledge entry.
const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  settle(): void {
    queueMicrotask(() => this.onsuccess?.());
  }
}
class ShimObjectStore {
  constructor(private readonly rows: Map<string, unknown>) {}
  put(value: unknown): void {
    this.rows.set((value as { id: string }).id, structuredClone(value));
  }
  delete(id: string): void {
    this.rows.delete(id);
  }
  clear(): void {
    this.rows.clear();
  }
  get(id: string): ShimRequest {
    const req = new ShimRequest();
    req.result = this.rows.has(id) ? structuredClone(this.rows.get(id)) : null;
    req.settle();
    return req;
  }
  getAll(): ShimRequest {
    const req = new ShimRequest();
    req.result = [...this.rows.values()].map((value) => structuredClone(value));
    req.settle();
    return req;
  }
}
class ShimTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly stores: Map<string, ShimObjectStore>;
  constructor(db: ShimDatabase, storeName: string) {
    this.stores = new Map([[storeName, new ShimObjectStore(db.store(storeName))]]);
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(name: string): ShimObjectStore {
    return this.stores.get(name)!;
  }
}
class ShimDatabase {
  onversionchange: (() => void) | null = null;
  constructor(private readonly name: string) {}
  store(storeName: string): Map<string, unknown> {
    const db = databases.get(this.name)!;
    if (!db.has(storeName)) db.set(storeName, new Map());
    return db.get(storeName)!;
  }
  get objectStoreNames() {
    return { contains: (name: string) => databases.get(this.name)!.has(name) };
  }
  createObjectStore(storeName: string): void {
    databases.get(this.name)!.set(storeName, new Map());
  }
  transaction(storeName: string): ShimTransaction {
    return new ShimTransaction(this, storeName);
  }
  close(): void {}
}
// @ts-expect-error — global shim for Node
globalThis.indexedDB = {
  open(name: string): ShimRequest {
    if (!databases.has(name)) databases.set(name, new Map());
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

// SelfCode and the provider relay both fetch RELATIVE urls, which the
// browser resolves against its origin. Node has no origin, so resolve
// them against the running dev server — the same server the browser
// would be talking to.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/")) {
    return realFetch(`${BASE}${input}`, init);
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const { default: SelfStudy } = await import("../src/core/cognition/SelfStudy");
const { default: ProjectMission } = await import("../src/core/cognition/ProjectMission");
const { default: KnowledgeLibrary } = await import("../src/core/cognition/KnowledgeLibrary");
const { default: SelfModel } = await import("../src/core/cognition/SelfModel");
const { default: AgentStore } = await import("../src/core/agents/AgentStore");
const { default: ArchitectureMap } = await import("../src/core/selfdev/ArchitectureMap");
const { default: AgentEventBus } = await import("../src/core/agent/AgentEvents");
const { EXECUTIVE_AGENT_TEMPLATES } = await import("../src/core/agents/AgentTemplates");

async function main(): Promise<void> {
  console.log("LÉLU AUTONOMOUS SELF-COGNITION VERIFICATION");
  console.log("===========================================\n");

  /* ---------------------------------------------------------------- */
  console.log("== The mission exists and actually ranks things ==");
  const mission = ProjectMission.getInstance();
  const state = mission.get();
  assert(state.northStar.length > 50, "a north star is defined");
  assert(state.programs.length >= 4, `the flagship programs are present (${state.programs.length})`);
  assert(
    state.programs.some((program) => program.name.includes("Sentinel")) &&
      state.programs.some((program) => program.name.includes("Forge")) &&
      state.programs.some((program) => program.name.includes("Riftwalker")),
    "Sentinel, Forge and Riftwalker are all carried from the vision log",
  );

  // The mission must DISCRIMINATE. A ranking that scores everything the
  // same is the same as having no mission at all.
  const cognitionScore = mission.relevanceOf("cognition memory runtime").score;
  const nothingScore = mission.relevanceOf("zzzz unrelated text").score;
  assert(
    cognitionScore > nothingScore,
    `mission-relevant text outranks irrelevant text (${cognitionScore} > ${nothingScore})`,
  );

  /* ---------------------------------------------------------------- */
  console.log("\n== The executive agents from the vision log are created ==");
  const agents = AgentStore.getInstance().ensureExecutiveAgents();
  assert(
    agents.length === EXECUTIVE_AGENT_TEMPLATES.length,
    `all ${EXECUTIVE_AGENT_TEMPLATES.length} executive agents exist (${agents.length})`,
    agents.map((agent) => agent.name).join(", "),
  );
  for (const template of EXECUTIVE_AGENT_TEMPLATES) {
    assert(
      agents.some((agent) => agent.name === template.name),
      `  ${template.name}`,
    );
  }
  // Idempotence matters: cognition calls this every cycle.
  const again = AgentStore.getInstance().ensureExecutiveAgents();
  assert(again.length === agents.length, "calling it again creates no duplicates");

  /* ---------------------------------------------------------------- */
  console.log("\n== Gaps are derived from her REAL architecture ==");
  const subsystems = ArchitectureMap.getInstance().list();
  assert(subsystems.length > 0, `the architecture map holds real subsystems (${subsystems.length})`);

  const selfStudy = SelfStudy.getInstance();

  // Record every event the cycle emits, to prove the phases are real
  // rather than a report assembled after the fact.
  const phases: string[] = [];
  const filesOpened: string[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    if (event.type === "cognitive_sync" && event.source === "SelfStudy") phases.push(event.detail ?? "");
    if (event.type === "file_opened") filesOpened.push(event.path);
  });

  /* ---------------------------------------------------------------- */
  console.log("\n== CYCLE 1 — with no user message ==");
  const first = await selfStudy.runCycle();
  console.log(`  objective : ${first.objective ?? "(none)"}`);
  console.log(`  subsystem : ${first.subsystem ?? "(none)"}`);
  console.log(`  agent     : ${first.agent ?? "(none)"}${first.agentSkippedReason ? ` — ${first.agentSkippedReason}` : ""}`);
  console.log(`  files     : ${first.filesPlanned.join(", ") || "(none)"}`);
  console.log(`  evidence  : ${first.evidence.length}`);
  console.log(`  memory    : ${first.memoryWrites.join(", ") || "(none)"}`);
  console.log(`  next      : ${first.nextObjective ?? "(none)"}`);

  assert(first.ok, "the cycle completed without error", first.error ?? undefined);
  assert(first.objective !== null, "she formed an objective from her own state, unprompted");
  assert(
    first.missionReasons.length > 0,
    "and the objective is justified BY THE MISSION, not chosen arbitrarily",
    "no mission reason was attached to the selected gap",
  );
  console.log(`  because   : ${first.missionReasons.join(" | ")}`);

  assert(
    first.reachedPhase === "reassess",
    `the state machine ran to the end (reached "${first.reachedPhase}")`,
  );
  assert(
    phases.length >= 10,
    `every phase emitted on the ONE event bus (${phases.length} phase events)`,
    phases.join(" → "),
  );
  console.log(`  phases    : ${phases.join(" → ")}`);

  /* ---------------------------------------------------------------- */
  console.log("\n== She read her OWN source — the real file, not a description ==");
  const sourceEvidence = first.evidence.filter(
    (item) => item.kind === "source" && !item.detail.startsWith("unreadable"),
  );
  assert(
    sourceEvidence.length > 0,
    `real source files were read (${sourceEvidence.length})`,
    "no source was readable — is the dev server running? /api/engineer/read is the live path",
  );
  assert(filesOpened.length > 0, `and each read announced itself as a file_opened event (${filesOpened.length})`);
  for (const item of sourceEvidence) console.log(`    - ${item.detail}`);

  /* ---------------------------------------------------------------- */
  console.log("\n== An agent was selected as part of her cognition ==");
  assert(first.agent !== null, "an executive agent was chosen for the question", first.agentSkippedReason ?? undefined);
  const agentEvidence = first.evidence.find((item) => item.kind === "agent");
  if (agentEvidence) {
    // An earlier version of this check accepted ANY agent evidence and
    // reported "the agent RAN" for a response whose provider was
    // literally "error" — the failure text was laundered into a pass
    // and then stored as knowledge. Assert a real provider answered.
    assert(
      !/\((error|offline)\)$/.test(agentEvidence.label),
      `the agent RAN against a real provider (${agentEvidence.label})`,
      "the label says the provider chain failed",
    );
    console.log(`    conclusion: ${(first.conclusion ?? "").slice(0, 200)}…`);
  } else {
    // Honest reporting: selection is deterministic, execution needs a
    // reachable provider. Say which happened rather than pretending.
    console.log(`    (agent did not execute: ${first.agentSkippedReason ?? "unknown"})`);
    assert(
      first.conclusion !== null,
      "she still formed a conclusion from the source alone",
    );
  }

  /* ---------------------------------------------------------------- */
  console.log("\n== What she learned reached her REAL memory ==");
  const knowledge = KnowledgeLibrary.getInstance();
  const selfEntries = knowledge.listByDomain("selfdev");
  assert(
    first.memoryWrites.length > 0,
    `the cycle wrote to memory (${first.memoryWrites.length} write(s))`,
  );
  assert(
    selfEntries.some((entry) => entry.title.startsWith("Self-study:")),
    "a durable self-knowledge entry exists in the KnowledgeLibrary",
    `${selfEntries.length} selfdev entries`,
  );
  assert(
    SelfModel.getInstance().get().discoveries.length > 0,
    "and the discovery reached the SelfModel",
  );

  /* ---------------------------------------------------------------- */
  console.log("\n== CYCLE 2 — she continues without being asked again ==");
  const second = await selfStudy.runCycle();
  console.log(`  objective : ${second.objective ?? "(none)"}`);
  console.log(`  subsystem : ${second.subsystem ?? "(none)"}`);

  assert(second.ok, "the second cycle completed", second.error ?? undefined);
  assert(second.objective !== null, "she formed a second objective with no new input");
  // THE autonomy test: a loop that re-studies the same thing forever is
  // a timer, not cognition. Progress means the next objective differs.
  assert(
    second.gapId !== first.gapId,
    `and it is a DIFFERENT question than cycle 1 (${first.gapId} → ${second.gapId})`,
    "she re-selected the same gap — cognition is not progressing",
  );
  assert(
    first.nextObjective === second.objective,
    "cycle 1 correctly predicted what she would study next",
    `predicted "${first.nextObjective}" but studied "${second.objective}"`,
  );

  /* ---------------------------------------------------------------- */
  console.log("\n== COGNITION is separated from AUTHORIZATION ==");
  const pending = selfStudy.pendingAuthorization();
  console.log(`  proposals awaiting authorization: ${pending.length}`);
  for (const proposal of pending.slice(0, 3)) {
    console.log(`    - [L${proposal.requiresLevel}] ${proposal.proposal.slice(0, 100)}`);
  }
  assert(
    pending.every((proposal) => proposal.requiresLevel >= 2),
    "every proposal is marked as needing authorization above sandbox level",
  );
  // The negative proof: thinking was never gated. Both cycles produced
  // conclusions while nothing was executed on her behalf.
  assert(
    first.conclusion !== null && second.conclusion !== null,
    "she reasoned freely in both cycles — authorization never blocked thinking",
  );

  /* ---------------------------------------------------------------- */
  console.log("\n== Unresolved questions remain open for revisiting ==");
  const gaps = selfStudy.getGaps();
  const open = gaps.filter((gap) => gap.status === "open");
  assert(gaps.length > 0, `she is tracking knowledge gaps (${gaps.length} total)`);
  assert(open.length > 0, `and ${open.length} remain open to revisit`);
  console.log("  top open questions by mission priority:");
  for (const gap of open.slice(0, 5)) {
    console.log(`    [${gap.priority}] ${gap.question}`);
  }

  unsubscribe();
  console.log(`\n${failures === 0 ? "ALL SELF-COGNITION CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
