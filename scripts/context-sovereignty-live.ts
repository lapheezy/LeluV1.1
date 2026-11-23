/**
 * LÉLU 2.2.2 — CONCURRENCY + PROVIDER VALIDATION
 *
 * Three conversations at once, plus the two residual carriers. What is
 * asserted is the request the provider actually received and the text the
 * cognitive snapshot actually rendered — not retrieval logs.
 *
 * Run: npx tsx scripts/context-sovereignty-live.ts [--offline]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* ------------------------- browser shims (Node) ------------------------- */
const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
  onsuccess: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  settle(): void {
    queueMicrotask(() => this.onsuccess?.());
  }
}
class ShimObjectStore {
  constructor(private readonly rows: Map<string, unknown>) {}
  put(value: unknown): void {
    const record = value as { id: string };
    this.rows.set(record.id, structuredClone(value));
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
class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
// @ts-expect-error — global shim for Node
globalThis.window = {
  localStorage: new FakeStorage(),
  sessionStorage: new FakeStorage(),
  name: "",
  location: { origin: "http://localhost:3000" },
};

interface Capture {
  provider: string;
  prompt: string;
  context: string;
}

const captures: Capture[] = [];

function fakeUser(id: string): any {
  return { get: () => ({ id }), context: () => "" };
}

async function main(): Promise<void> {
  if (!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY_1) process.env.GROQ_API_KEY = process.env.GROQ_API_KEY_1;
  if (!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY_1) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY_1;
  process.env.LELU_CHAIN_BUDGET_MS ??= "60000";
  process.env.LELU_PROVIDER_RUNG_BUDGET_MS ??= "40000";

  const offline = process.argv.includes("--offline");
  mkdirSync(join(process.cwd(), "MISSION-22.2"), { recursive: true });

  const AIService = (await import("../src/core/AIService")).default;
  const MemoryBridge = (await import("../src/core/MemoryBridge")).default;
  const MultiChatStore = (await import("../src/core/multichat/MultiChatStore")).default;
  const ProjectStore = (await import("../src/core/projects/ProjectStore")).default;
  const { currentSessionId } = await import("../src/core/memory/MemorySovereignty");
  const { buildCognitiveContext, formatCognitiveContext } = await import("../src/core/cognition/CognitiveContext");
  const Groq = (await import("../src/providers/GroqProvider")).default;
  const OpenRouter = (await import("../src/providers/OpenRouterProvider")).default;

  for (const [label, ctor] of [["groq", Groq], ["openrouter", OpenRouter]] as const) {
    const proto = (ctor as unknown as { prototype: Record<string, unknown> }).prototype;
    const original = proto.generate as ((request: Record<string, unknown>) => Promise<unknown>) | undefined;
    if (typeof original !== "function") continue;
    proto.generate = async function patched(this: unknown, request: Record<string, unknown>) {
      captures.push({
        provider: label,
        prompt: String(request.prompt ?? ""),
        context: typeof request.context === "string" ? request.context : "",
      });
      return original.call(this, request);
    };
  }

  const ai = AIService.getInstance();
  await ai.initialize();
  const runtime = (ai as any).runtime;
  const brain = runtime.brain;
  const core = brain.cognition?.["core"] ?? (ai as any).runtime?.brain?.cognition;
  const chats = MultiChatStore.getInstance();
  const projects = ProjectStore.getInstance();

  const userA = "ctx-fixture-a";
  const userB = "ctx-fixture-b";
  const session = currentSessionId();

  const chatA = chats.createBackground("A — personal");
  const chatB = chats.createBackground("B — engineering");
  const chatC = chats.createBackground("C — history");

  await brain.learn("My father died last month and I cannot focus.", "Noted.", "conversation", [], {
    originSeed: {
      userId: userA,
      conversationId: chatA.id,
      sessionId: session,
      conversationTitle: chatA.title,
      sourceType: "user-said",
      scope: "persistent-user",
    },
  });
  await brain.learn("My deploy pipeline is failing on the migration step.", "Noted.", "conversation", [], {
    originSeed: {
      userId: userA,
      conversationId: chatB.id,
      sessionId: session,
      conversationTitle: chatB.title,
      sourceType: "user-said",
      scope: "persistent-user",
    },
  });

  const projectA = projects.create(
    { name: "Aurelia — private commission", description: "rose gold only" },
    { ownerId: userA, conversationId: chatA.id, sessionId: session, scope: "user-persistent" },
  );
  projects.addItem(projectA.id, { kind: "note", title: "metal", text: "rose gold, never platinum" });
  const projectB = projects.create(
    { name: "Pipeline hardening", description: "engineering" },
    { ownerId: userA, conversationId: chatB.id, sessionId: session, scope: "user-persistent" },
  );
  projects.addItem(projectB.id, { kind: "note", title: "step", text: "migration lock timeout" });

  const bridgeA = new MemoryBridge(brain, fakeUser(userA));
  const bridgeB = new MemoryBridge(brain, fakeUser(userA));
  const bridgeC = new MemoryBridge(brain, fakeUser(userB));

  const probe = async (bridge: any, prompt: string, conversationId: string) => {
    const enriched = await bridge.enrich({ prompt, messages: [], timestamp: Date.now(), conversationId } as any);
    const context = String(enriched.request.context ?? "");
    return {
      prompt,
      conversationId,
      contextChars: context.length,
      memories: enriched.memories.length,
      hasGrief: /father died|cannot focus/i.test(context),
      hasDeploy: /deploy pipeline is failing/i.test(context),
      hasProjectA: /Aurelia — private commission|never platinum/i.test(context),
      hasProjectB: /Pipeline hardening|migration lock timeout/i.test(context),
      hasHistoricalLabel: /\[earlier conversation/i.test(context),
      context,
      request: enriched.request,
    };
  };

  /* ------------------------------ concurrency ------------------------------ */
  const started = Date.now();
  const [a, b, c] = await Promise.all([
    probe(bridgeA, "Can you fix it?", chatB.id),
    probe(bridgeA, "What's the migration lock timeout about?", chatB.id),
    probe(bridgeC, "What's my project status?", chatC.id),
  ]);
  const elapsed = Date.now() - started;

  const concurrency = {
    mission: "LÉLU 2.2.2 — concurrent cognition",
    executedAt: new Date().toISOString(),
    scenario: "three conversations enriched concurrently, plus a second-user probe",
    elapsedMs: elapsed,
    checks: [
      { name: "A's grief does not enter B", passed: a.hasGrief === false, evidence: { grief: a.hasGrief, memories: a.memories } },
      { name: "B's deploy fact stays in B", passed: c.hasDeploy === false, evidence: { deployInC: c.hasDeploy } },
      {
        name: "A's durable project is labelled in B, never presented as current",
        passed: b.hasProjectA === true && /\[started in the chat/.test(b.context),
        evidence: { inB: b.hasProjectA, labelled: /\[started in the chat/.test(b.context) },
      },
      { name: "B's own project remains in B", passed: b.hasProjectB === true, evidence: { inB: b.hasProjectB } },
      { name: "another user sees neither project", passed: c.hasProjectA === false && c.hasProjectB === false, evidence: { inC: [c.hasProjectA, c.hasProjectB] } },
      { name: "no conversation's material is reassigned", passed: !/father died/i.test(b.context) && !/migration lock/i.test(a.context), evidence: { cross: true } },
    ],
  } as any;
  concurrency.pass = concurrency.checks.every((check: any) => check.passed);
  writeFileSync(join(process.cwd(), "MISSION-22.2", "concurrency-validation.json"), `${JSON.stringify(concurrency, null, 2)}\n`);
  console.log(`concurrency: ${concurrency.pass ? "PASS" : "FAIL"} (${concurrency.checks.filter((x: any) => x.passed).length}/${concurrency.checks.length}) in ${elapsed}ms`);

  /* --------------------------- workspace observations --------------------------- */
  const workspace = {
    mission: "LÉLU 2.2.2 — workspace observation isolation",
    executedAt: new Date().toISOString(),
    checks: [] as any[],
  };

  if (core) {
    core.observe("A private observation about the funeral and the studio.", chatA.id);
    const otherState = core.state(chatB.id);
    const otherItems = core.workspaceItems("core", { userId: userA, conversationId: chatB.id, sessionId: session, prompt: "status" });
    const ownItems = core.workspaceItems("core", { userId: userA, conversationId: chatA.id, sessionId: session, prompt: "status" });

    workspace.checks.push(
      { name: "state() carries no observation text", passed: !JSON.stringify(otherState.workspaces).includes("funeral"), evidence: { workspaces: otherState.workspaces } },
      { name: "another conversation cannot read the observation", passed: !otherItems.some((text) => text.includes("funeral")), evidence: { items: otherItems.length } },
      { name: "its own conversation still can", passed: ownItems.some((text) => text.includes("funeral")), evidence: { items: ownItems.length } },
    );
  } else {
    workspace.checks.push({ name: "cognitive core reachable", passed: false, evidence: { note: "core not exposed on this runtime" } });
  }
  workspace.pass = workspace.checks.every((check: any) => check.passed);
  writeFileSync(join(process.cwd(), "MISSION-22.2", "workspace-observation-live.json"), `${JSON.stringify(workspace, null, 2)}\n`);
  console.log(`workspace: ${workspace.pass ? "PASS" : "FAIL"} (${workspace.checks.filter((x: any) => x.passed).length}/${workspace.checks.length})`);

  /* ------------------------- agent cognitive snapshot ------------------------- */
  const scopedSnapshot = buildCognitiveContext({ userId: userA, conversationId: chatB.id, sessionId: session });
  const scopedText = formatCognitiveContext(scopedSnapshot);
  const anonymousText = formatCognitiveContext(buildCognitiveContext());

  const snapshot = {
    mission: "LÉLU 2.2.2 — agent cognitive snapshot",
    executedAt: new Date().toISOString(),
    checks: [
      {
        name: "scoped snapshot states another chat's durable project as such",
        passed: /Aurelia — private commission/.test(scopedText) && /\[started in the chat|\[started in another conversation/.test(scopedText),
        evidence: { chars: scopedText.length },
      },
      { name: "scoped snapshot keeps its own project", passed: /Pipeline hardening/.test(scopedText), evidence: {} },
      {
        name: "a snapshot with no identity carries no project content",
        passed: !/Aurelia — private commission|Pipeline hardening/.test(anonymousText),
        evidence: {
          chars: anonymousText.length,
          matches: (anonymousText.match(/.{0,90}(?:Aurelia — private commission|Pipeline hardening).{0,90}/g) ?? []).slice(0, 3),
        },
      },
      { name: "a snapshot with no identity carries no execution events", passed: /## RECENT EXECUTION EVENTS/.test(anonymousText) === false, evidence: {} },
      { name: "self-model project names are filtered", passed: scopedSnapshot.self.projects.every((name) => scopedSnapshot.projects.some((project) => project.name === name)), evidence: { names: scopedSnapshot.self.projects } },
    ],
  } as any;
  snapshot.pass = snapshot.checks.every((check: any) => check.passed);
  writeFileSync(join(process.cwd(), "MISSION-22.2", "agent-cognitive-context-live.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`snapshot: ${snapshot.pass ? "PASS" : "FAIL"} (${snapshot.checks.filter((x: any) => x.passed).length}/${snapshot.checks.length})`);

  /* ------------------------------ provider turns ------------------------------ */
  const turns: any[] = [];
  if (!offline) {
    const ownHistory = await probe(bridgeA, "How am I handling my father's death?", chatA.id);
    for (const [label, request] of [
      ["B asks to fix it", b.request],
      ["A asks about their own history", ownHistory.request],
    ] as const) {
      const before = captures.length;
      let response: any = null;
      let error = "";
      try {
        response = await Promise.race([
          runtime.process(request),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("turn exceeded 60s")), 60_000)),
        ]);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const captured = captures.slice(before).at(-1) ?? null;
      const context = captured?.context ?? "";
      turns.push({
        label,
        provider: response?.provider ?? null,
        model: response?.model ?? null,
        status: error ? "error" : response?.provider === "offline" ? "offline" : "answered",
        error: error || undefined,
        text: String(response?.text ?? "").slice(0, 600),
        payload: {
          provider: captured?.provider ?? null,
          contextChars: context.length,
          hasGrief: /father died|cannot focus/i.test(context),
          hasDeploy: /deploy pipeline is failing/i.test(context),
          hasProjectA: /Aurelia — private commission/i.test(context),
          hasProjectALabelled: /Aurelia — private commission/i.test(context) && /\[started in/.test(context),
          hasProjectLabel: /\[started in/.test(context),
          hasProjectB: /Pipeline hardening/i.test(context),
          hasHistoricalLabel: /\[earlier conversation/i.test(context),
        },
      });
    }
  }

  const provider = {
    mission: "LÉLU 2.2.2 — provider payload validation",
    executedAt: new Date().toISOString(),
    path: "MemoryBridge.enrich → context authorization checkpoint → AIRuntime.process → provider HTTP",
    offline,
    turns,
    checks: {
      B_payload_has_no_grief: turns.filter((turn) => turn.label.startsWith("B")).every((turn) => turn.payload.hasGrief === false),
      B_foreign_project_is_labelled: turns
        .filter((turn) => turn.label.startsWith("B"))
        .every((turn) => turn.payload.hasProjectA === false || turn.payload.hasProjectALabelled === true),
      A_payload_has_own_history: turns.filter((turn) => turn.label.startsWith("A")).every((turn) => turn.payload.hasGrief === true),
      answered: turns.every((turn) => turn.status === "answered"),
    },
  } as any;
  provider.pass = Object.values(provider.checks).every(Boolean);
  writeFileSync(join(process.cwd(), "MISSION-22.2", "provider-validation.json"), `${JSON.stringify(provider, null, 2)}\n`);
  console.log(`provider: ${provider.pass ? "PASS" : "FAIL"} (${turns.map((turn) => turn.status).join(", ")})`);

  projects.remove(projectA.id);
  projects.remove(projectB.id);
}

main().catch((error) => {
  console.error("[context-sovereignty-live] failed:", error);
  process.exitCode = 1;
});
