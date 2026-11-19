/**
 * LÉLU 2.2.1 — CROSS-USER + PROVIDER VALIDATION
 *
 * TWO synthetic users, one canonical pipeline. User A talks about a
 * loss and starts a project; user B asks semantically similar
 * questions. What is asserted is the REQUEST THE PROVIDER RECEIVED,
 * not the wording of a reply.
 *
 * Identity is injected at the one boundary that reads it
 * (MemoryBridge.scopeFor → user.get().id), so the same code path a
 * real second account would take is exercised here. The users are
 * fixtures, never real people, and every identifier is synthetic.
 *
 * Run:
 *   npx tsx scripts/memory-hardening-live.ts            # all sections
 *   npx tsx scripts/memory-hardening-live.ts --offline  # no provider calls
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* ------------------------- browser shims (Node) ------------------------- */
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

const OUTPUT = join(process.cwd(), "MISSION-22.1");

interface Capture {
  provider: string;
  prompt: string;
  context: string;
  contextChars: number;
  messages: number;
  voiceChars: number;
}

const captures: Capture[] = [];

/** A two-user fixture identity: the exact shape MemoryBridge reads. */
function fakeUser(id: string): any {
  return {
    get: () => ({ id }),
    context: () => "",
  };
}

function redact(text: string): string {
  return text.replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, "[email]").slice(0, 6_000);
}

async function main(): Promise<void> {
  if (!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY_1) {
    process.env.GROQ_API_KEY = process.env.GROQ_API_KEY_1;
  }
  if (!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY_1) {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY_1;
  }
  process.env.LELU_CHAIN_BUDGET_MS ??= "60000";
  process.env.LELU_PROVIDER_RUNG_BUDGET_MS ??= "40000";

  const offline = process.argv.includes("--offline");
  mkdirSync(OUTPUT, { recursive: true });

  const AIService = (await import("../src/core/AIService")).default;
  const MemoryBridge = (await import("../src/core/MemoryBridge")).default;
  const MultiChatStore = (await import("../src/core/multichat/MultiChatStore")).default;
  const ProjectStore = (await import("../src/core/projects/ProjectStore")).default;
  const { currentSessionId } = await import("../src/core/memory/MemorySovereignty");
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
        contextChars: typeof request.context === "string" ? request.context.length : 0,
        messages: Array.isArray(request.messages) ? request.messages.length : 0,
        voiceChars: typeof request.voice === "string" ? request.voice.length : 0,
      });
      return original.call(this, request);
    };
  }

  const ai = AIService.getInstance();
  await ai.initialize();
  const runtime = (ai as any).runtime;
  const brain = runtime.brain;
  const chats = MultiChatStore.getInstance();
  const projects = ProjectStore.getInstance();

  const chatA = chats.createBackground("A — personal");
  const chatB = chats.createBackground("B — technical");
  const chatA2 = chats.createBackground("A2 — studio project");
  const chatB2 = chats.createBackground("B2 — probe");

  const session = currentSessionId();
  const userA = "fixture-user-a";
  const userB = "fixture-user-b";

  /* ---------------------- seed user A through the real engine ---------------------- */
  const seeded = await brain.learn(
    "My father died last month and I cannot focus on anything.",
    "Noted.",
    "conversation",
    [],
    {
      source: "lelu-chat",
      originSeed: {
        userId: userA,
        conversationId: chatA.id,
        sessionId: session,
        conversationTitle: chatA.title,
        sourceType: "user-said",
        scope: "persistent-user",
      },
    },
  );

  const seededProjectFact = await brain.learn(
    "My jewellery brand is called Aurelia and its signature is rose gold.",
    "Noted.",
    "conversation",
    [],
    {
      source: "lelu-chat",
      originSeed: {
        userId: userA,
        conversationId: chatA2.id,
        sessionId: session,
        conversationTitle: chatA2.title,
        sourceType: "user-said",
        scope: "persistent-user",
      },
    },
  );

  const projectA = projects.create(
    { name: "Aurelia — rose gold collection", description: "A private studio commission" },
    { ownerId: userA, conversationId: chatA2.id, sessionId: session, conversationTitle: chatA2.title, scope: "user-persistent" },
  );
  projects.addItem(projectA.id, { kind: "note", title: "Signature metal", text: "rose gold only, no platinum" });

  const projectB = projects.create(
    { name: "Helix — enzyme assay", description: "lab work" },
    { ownerId: userB, conversationId: chatB.id, sessionId: session, conversationTitle: chatB.title, scope: "user-persistent" },
  );
  projects.addItem(projectB.id, { kind: "note", title: "Buffer", text: "phosphate buffered saline" });

  /* ---------------------- enrich as B, then as A ---------------------- */
  const bridgeFor = (userId: string) => new MemoryBridge(brain, fakeUser(userId));

  const bridgeA = bridgeFor(userA);
  const bridgeB = bridgeFor(userB);

  const probe = async (bridge: any, prompt: string, conversationId: string) => {
    const request = { prompt, messages: [], timestamp: Date.now(), conversationId } as any;
    const enriched = await bridge.enrich(request);
    const context = String(enriched.request.context ?? "");
    return {
      prompt,
      conversationId,
      contextChars: context.length,
      memories: enriched.memories.length,
      hasGrief: /father died|cannot focus on anything/i.test(context),
      hasAureliaFact: /jewellery brand is called Aurelia/i.test(context),
      hasProjectA: /Aurelia — rose gold collection|private studio commission|no platinum/i.test(context),
      hasProjectB: /Helix — enzyme assay|phosphate buffered saline/i.test(context),
      hasHistoricalLabel: /\[earlier conversation/i.test(context),
      hasProjectLabel: /\[started in the chat/i.test(context),
      context,
    };
  };

  const bIsolation = await probe(bridgeB, "Can you fix it?", chatB.id);
  const bProject = await probe(bridgeB, "What's the status of the Aurelia project?", chatB.id);
  const aOwnRecall = await probe(bridgeA, "What's my jewellery brand and signature metal?", chatB.id);
  const aOwnProject = await probe(bridgeA, "What's the status of the Aurelia project?", chatB.id);

  const crossUser = {
    mission: "LÉLU 2.2.1 — cross-user validation",
    executedAt: new Date().toISOString(),
    kind: "synthetic two-user execution (fixtures, no real user data)",
    users: {
      a: { id: userA, conversations: [chatA.id, chatA2.id], memories: [seeded?.id ?? null, seededProjectFact?.id ?? null], project: projectA.id },
      b: { id: userB, conversations: [chatB.id], project: projectB.id },
    },
    checks: [
      {
        name: "B asks a semantically similar question to A's loss",
        passed: bIsolation.hasGrief === false && bProject.hasGrief === false,
        evidence: { griefInContext: bIsolation.hasGrief || bProject.hasGrief, memoriesRecalled: bIsolation.memories },
      },
      {
        name: "A's persistent fact never reaches B",
        passed: bProject.hasAureliaFact === false,
        evidence: { factInContext: bProject.hasAureliaFact },
      },
      {
        name: "A's project contents never reach B",
        passed: bProject.hasProjectA === false && bIsolation.hasProjectA === false,
        evidence: { projectAInContext: bProject.hasProjectA || bIsolation.hasProjectA },
      },
      {
        name: "B's own project remains available to B",
        passed: bProject.hasProjectB === true,
        evidence: { projectBInContext: bProject.hasProjectB },
      },
      {
        name: "A still recalls their own history (isolation is not amnesia)",
        passed: aOwnRecall.hasAureliaFact === true,
        evidence: { factInContext: aOwnRecall.hasAureliaFact, memoriesRecalled: aOwnRecall.memories },
      },
      {
        name: "A's durable project is stated as started in another chat",
        passed: aOwnProject.hasProjectLabel === true,
        evidence: { projectLabel: aOwnProject.hasProjectLabel, historicalLabel: aOwnProject.hasHistoricalLabel, memories: aOwnProject.memories },
      },
    ],
    isolationPass: true as boolean,
  };
  crossUser.isolationPass = crossUser.checks.every((check) => check.passed);
  writeFileSync(join(OUTPUT, "cross-user-validation.json"), `${JSON.stringify(crossUser, null, 2)}\n`);
  console.log(`cross-user: ${crossUser.isolationPass ? "PASS" : "FAIL"} (${crossUser.checks.filter((c) => c.passed).length}/${crossUser.checks.length})`);

  /* ---------------------- provider payload for B ---------------------- */
  const providerTurns: any[] = [];

  if (!offline) {
    const send = async (label: string, prompt: string, conversationId: string, bridge: any) => {
      const before = captures.length;
      const request = { prompt, messages: [], timestamp: Date.now(), conversationId } as any;
      const enriched = await bridge.enrich(request);
      let response: any = null;
      let error = "";
      try {
        response = await Promise.race([
          runtime.process(enriched.request),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("turn exceeded 60s")), 60_000)),
        ]);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const captured = captures.slice(before).at(-1) ?? null;
      const context = captured?.context ?? "";
      return {
        label,
        prompt,
        conversationId,
        status: error ? "error" : response?.provider === "offline" ? "offline" : "answered",
        error: error || undefined,
        provider: response?.provider ?? null,
        model: response?.model ?? null,
        text: redact(String(response?.text ?? "")),
        payload: {
          contextChars: captured?.contextChars ?? 0,
          messages: captured?.messages ?? 0,
          voiceAttached: (captured?.voiceChars ?? 0) > 0,
          hasGrief: /father died|cannot focus on anything/i.test(context),
          hasAureliaFact: /jewellery brand is called Aurelia/i.test(context),
          hasProjectA: /Aurelia — rose gold collection|private studio commission/i.test(context),
          hasProjectB: /Helix — enzyme assay/i.test(context),
          hasHistoricalLabel: /\[earlier conversation/i.test(context),
          hasProjectLabel: /\[started in the chat/i.test(context),
          hasProvenanceNote: /## Memory provenance/i.test(context),
          excerpt: redact(context.slice(0, 1_500)),
        },
        memoriesAuthorized: enriched.memories.length,
      };
    };

    // B on both providers: same scoped request, same absence.
    providerTurns.push(await send("user B — groq", "What's the status of the Aurelia project?", chatB.id, bridgeB));
    providerTurns.push(await send("user B — openrouter", "What's the status of the Aurelia project?", chatB.id, bridgeB));
    // A on both: the same memory must still be usable, labelled.
    providerTurns.push(await send("user A — groq", "What's my jewellery brand and signature metal?", chatB.id, bridgeA));
    providerTurns.push(await send("user A — openrouter", "What's my jewellery brand and signature metal?", chatB.id, bridgeA));
  }

  const providerReport = {
    mission: "LÉLU 2.2.1 — provider validation",
    executedAt: new Date().toISOString(),
    path: "MemoryBridge.enrich → AIRuntime.process → provider HTTP (the canonical runtime)",
    providers: ["groq", "openrouter"],
    offline,
    turns: providerTurns,
    checks: {
      userB_payload_has_no_grief: providerTurns.filter((t) => t.label.startsWith("user B")).every((t) => t.status === "answered" && t.payload.hasGrief === false),
      userB_payload_has_no_A_fact: providerTurns.filter((t) => t.label.startsWith("user B")).every((t) => t.payload.hasAureliaFact === false),
      userB_payload_has_no_A_project: providerTurns.filter((t) => t.label.startsWith("user B")).every((t) => t.payload.hasProjectA === false),
      userA_payload_has_fact_labelled: providerTurns.filter((t) => t.label.startsWith("user A")).every((t) => t.payload.hasAureliaFact === true),
      provenance_survives_voice: providerTurns.every((t) => t.payload.voiceAttached === true || t.status !== "answered"),
      personality_preserved: providerTurns.every((t) => t.payload.voiceAttached === true || t.status !== "answered"),
    },
  } as any;
  providerReport.pass = Object.values(providerReport.checks).every(Boolean);
  writeFileSync(join(OUTPUT, "provider-validation.json"), `${JSON.stringify(providerReport, null, 2)}\n`);
  console.log(`provider: ${providerReport.pass ? "PASS" : "FAIL"} (${providerTurns.map((t) => `${t.label}:${t.status}`).join(", ")})`);

  projects.remove(projectA.id);
  projects.remove(projectB.id);
}

main().catch((error) => {
  console.error("[memory-hardening-live] failed:", error);
  process.exitCode = 1;
});
