/**
 * LÉLU 2.2 — MEMORY SOVEREIGNTY, LIVE MODEL VALIDATION
 *
 * Every conversational turn goes through the SAME entry point GenesisChat
 * uses: AIService.getInstance().chat({ conversationId }). The real memory
 * bridge, the real retrieval boundary, the real router and the real provider
 * chain all participate. What is CAPTURED is the request the provider was
 * actually handed — so "the other conversation's grief never reached the
 * model" is observed in the payload, not inferred from the reply.
 *
 * Verification levels are recorded per turn:
 *   pipeline      AIService.chat → provider HTTP
 *   parity        AIRuntime.process → provider HTTP (same memory path)
 *   (browser acceptance is separate: verify/memory-sovereignty-browser.mjs)
 *
 * Run:
 *   npx tsx scripts/memory-live.ts
 *   npx tsx scripts/memory-live.ts --parity
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

interface Capture {
  provider: string;
  prompt: string;
  context: string;
  contextChars: number;
  roles: string[];
  voiceChars: number;
  /** Computed on the FULL context — a 4k excerpt hid the labelled section. */
  hasEarlierConversationLabel: boolean;
  hasProvenanceNote: boolean;
  hasGriefText: boolean;
  hasAboutUserSection: boolean;
  memorySection: string | null;
  griefMatches: string[];
}

const captures: Capture[] = [];

async function main(): Promise<void> {
  if (!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY_1) {
    process.env.GROQ_API_KEY = process.env.GROQ_API_KEY_1;
  }
  if (!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY_1) {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY_1;
  }
  process.env.LELU_CHAIN_BUDGET_MS ??= "60000";
  process.env.LELU_PROVIDER_RUNG_BUDGET_MS ??= "40000";

  const parity = process.argv.includes("--parity");
  const startedAt = new Date().toISOString();

  const AIService = (await import("../src/core/AIService")).default;
  const MultiChatStore = (await import("../src/core/multichat/MultiChatStore")).default;
  const CognitiveTrace = (await import("../src/core/cognition/CognitiveTrace")).default;
  const Groq = (await import("../src/providers/GroqProvider")).default;
  const OpenRouter = (await import("../src/providers/OpenRouterProvider")).default;
  const AIRuntime = (await import("../src/core/AIRuntime")).default;

  for (const [label, ctor] of [["Groq", Groq], ["OpenRouter", OpenRouter]] as const) {
    const proto = (ctor as unknown as { prototype: Record<string, unknown> }).prototype;
    const original = proto.generate as ((request: Record<string, unknown>) => Promise<unknown>) | undefined;
    if (typeof original !== "function") continue;
    proto.generate = async function patched(this: unknown, request: Record<string, unknown>) {
      captures.push({
        provider: label,
        prompt: String(request.prompt ?? ""),
        context: typeof request.context === "string" ? request.context : "",
        contextChars: typeof request.context === "string" ? request.context.length : 0,
        roles: Array.isArray(request.messages)
          ? (request.messages as Array<{ role?: string }>).map((message) => String(message.role ?? ""))
          : [],
        voiceChars: typeof request.voice === "string" ? request.voice.length : 0,
        hasEarlierConversationLabel: /\[earlier conversation/.test(
          typeof request.context === "string" ? request.context : "",
        ),
        hasProvenanceNote: /## Memory provenance/.test(
          typeof request.context === "string" ? request.context : "",
        ),
        hasGriefText: /father died|died last month|grief/i.test(
          typeof request.context === "string" ? request.context : "",
        ),
        hasAboutUserSection: /## About the user/.test(
          typeof request.context === "string" ? request.context : "",
        ),
        memorySection: (() => {
          const context = typeof request.context === "string" ? request.context : "";
          const start = context.indexOf("## About the user");
          return start < 0 ? null : context.slice(start, start + 1_200);
        })(),
        griefMatches: (() => {
          const context = typeof request.context === "string" ? request.context : "";
          return (context.match(/.{0,90}(?:father died|died last month|grief).{0,90}/gi) ?? []).slice(0, 4);
        })(),
      });
      return original.call(this, request);
    };
  }

  const ai = AIService.getInstance();
  await ai.initialize();
  CognitiveTrace.getInstance().setEnabled(true);
  CognitiveTrace.getInstance().clear();

  const store = MultiChatStore.getInstance();
  const chats = {
    grief: store.createBackground("A — a personal loss"),
    project: store.createBackground("C — Aurelia studio"),
    metals: store.createBackground("D — metals"),
    correction: store.createBackground("E — correction"),
    probe: store.createBackground("B — unrelated technical question"),
  };

  const aiPrivate = ai as unknown as {
    memory: {
      enrich: (request: Record<string, unknown>) => Promise<{ request: Record<string, unknown>; memories: unknown[] }>;
      learn: (prompt: string, response: string, taskId?: string, conversationId?: string) => Promise<void>;
      scopeFor: (conversationId: string | undefined, prompt: string) => Record<string, unknown>;
    };
    runtime: AIRuntime;
  };

  async function turn(prompt: string, conversationId: string) {
    const before = captures.length;
    const clock = Date.now();
    let response: { text: string; provider: string; model: string; metadata?: Record<string, unknown> } | null = null;
    let error = "";
    try {
      response = await Promise.race([
        ai.chat(prompt, undefined, undefined, { conversationId }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("turn exceeded 90s")), 90_000)),
      ]);
      await ai.waitForPendingConsolidations();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const ms = Date.now() - clock;
    const turnCaptures = captures.slice(before);
    const capture = turnCaptures.find((item) => item.prompt === prompt) ?? turnCaptures.at(-1) ?? null;
    const trace = CognitiveTrace.getInstance().lastTurn();
    const retrieval = trace?.entries
      .filter((entry) => entry.stage === "MEMORY_RETRIEVAL")
      .map((entry) => ({ detail: entry.detail, data: entry.data })) ?? [];
    const injection = trace?.entries.find((entry) => entry.stage === "CONTEXT_INJECTION");

    return {
      prompt,
      conversationId,
      status: error ? "error" : response && response.provider !== "offline" ? "answered" : "offline",
      error: error || undefined,
      ms,
      provider: response?.provider ?? null,
      model: response?.model ?? null,
      text: response?.text ?? "",
      contextChars: capture?.contextChars ?? 0,
      payload: {
        contextExcerpt: capture ? capture.context.slice(0, 2_000) : null,
        contextTail: capture ? capture.context.slice(-2_500) : null,
        roles: capture?.roles ?? [],
        voiceAttached: (capture?.voiceChars ?? 0) > 0,
        captured: Boolean(capture),
        hasEarlierConversationLabel: capture?.hasEarlierConversationLabel ?? false,
        hasProvenanceNote: capture?.hasProvenanceNote ?? false,
        hasGriefText: capture?.hasGriefText ?? false,
        hasAboutUserSection: capture?.hasAboutUserSection ?? false,
        memorySection: capture?.memorySection ?? null,
        griefMatches: capture?.griefMatches ?? [],
        capturedPrompt: capture?.prompt ?? null,
        capturedProvider: capture?.provider ?? null,
      },
      retrieval,
      injection: injection ? { detail: injection.detail, data: injection.data } : null,
    };
  }

  type TurnRecord = Awaited<ReturnType<typeof turn>>;

  const seeded: TurnRecord[] = [];
  const probes: TurnRecord[] = [];

  if (!parity) {
    /* ------------------------- seed conversations ------------------------- */
    seeded.push(await turn("My father died last month and I can't focus on anything.", chats.grief.id));
    seeded.push(await turn("I'm building a project called Aurelia — a jewellery brand with a rose gold signature.", chats.project.id));
    seeded.push(await turn("I prefer rose gold for the studio.", chats.metals.id));
    seeded.push(await turn("Actually, I prefer platinum now, not rose gold.", chats.correction.id));

    /* ------------------------------ probes ------------------------------ */
    probes.push(await turn("Can you fix it?", chats.probe.id));
    probes.push(await turn("What's the status of the Aurelia project?", chats.probe.id));
    probes.push(await turn("What metal do I prefer for the studio?", chats.probe.id));
    probes.push(await turn("How am I handling my father's death now?", chats.probe.id));

    const isolation = probes[0];
    const recall = probes[1];
    const chronology = probes[2];
    const sensitive = probes[3];

    const leaksGriefInContext = isolation.payload.hasGriefText;
    const griefComfort = /sorry about your (?:father|dad|loss)|your (?:father|dad)'s death|condolence/i.test(isolation.text);
    const recallLabelled = recall.payload.hasEarlierConversationLabel;
    const recallNote = recall.payload.hasProvenanceNote;
    const recallGrounded = /aurelia/i.test(recall.text);
    const recallAttributed = /earlier|previous|last (?:chat|conversation|time)|from our/i.test(recall.text);
    const chronologyPlatinum = /platinum/i.test(chronology.payload.contextExcerpt ?? "") ||
      /platinum/i.test(chronology.payload.contextTail ?? "");
    const chronologyRoseCurrent = /I prefer rose gold for the studio\.\s*(?:$|\n)/.test(
      `${recall.payload.contextExcerpt ?? ""}\n${recall.payload.contextTail ?? ""}`,
    );
    const sensitiveLabelled = sensitive.payload.hasEarlierConversationLabel;
    // The reply must be framed as HISTORY ("last month you said"), not as
    // something said in this conversation. Naming the chat is preferred and
    // instructed, but an accurate time reference is also a truthful origin.
    const sensitiveAttributed =
      /\b(earlier|previously|before|last (?:chat|conversation|time|month|week|year)|from our|you (?:said|told me) (?:last|back|earlier))\b/i.test(
        sensitive.text,
      );
    const sensitivePresentedAsJustNow = /you just told me|you told me (?:just|only) now/i.test(sensitive.text);

    const scenarios = [
      {
        id: "A-isolation",
        requirement: "Conversation B asking \"Can you fix it?\" never receives conversation A's loss",
        passes: !leaksGriefInContext && !griefComfort,
        evidence: { leaksGriefInContext, griefComfort, contextChars: isolation.contextChars },
        turn: isolation,
      },
      {
        id: "B-historical-recall",
        requirement: "A project from conversation C is recalled in B, with its origin labelled in the payload",
        passes: recallLabelled && recallNote && recallGrounded,
        evidence: { recallLabelled, recallNote, recallGrounded, recallAttributed },
        turn: recall,
      },
      {
        id: "C-chronology",
        requirement: "The corrected metal is what reaches the model; the superseded value is not presented as current",
        passes: chronologyPlatinum && !chronologyRoseCurrent,
        evidence: { chronologyPlatinum, chronologyRoseCurrent },
        turn: chronology,
      },
      {
        id: "E-sensitive-history",
        requirement: "A directly asked-about loss is retrievable as history, labelled, not as present mood",
        passes: sensitiveLabelled && sensitiveAttributed && !sensitivePresentedAsJustNow,
        evidence: { sensitiveLabelled, sensitiveAttributed, sensitivePresentedAsJustNow },
        turn: sensitive,
      },
    ];

    const answered = [...seeded, ...probes].filter((item) => item.status === "answered").length;
    const output = {
      mission: "LÉLU 2.2 — memory sovereignty",
      verificationLevel: "pipeline (Node → real provider HTTP, canonical AIService.chat)",
      startedAt,
      finishedAt: new Date().toISOString(),
      providerChainObserved: [...new Set([...seeded, ...probes].map((item) => item.provider).filter(Boolean))],
      conversations: Object.fromEntries(Object.entries(chats).map(([key, chat]) => [key, { id: chat.id, title: chat.title }])),
      turnsAnswered: answered,
      turnsTotal: seeded.length + probes.length,
      scenarios,
      seededTurns: seeded,
      probeTurns: probes,
      limitations: [
        "Node/browser shims stand in for IndexedDB and localStorage; the store implementation is the real one.",
        "Reply wording is model-dependent; the load-bearing evidence is the captured provider payload.",
      ],
    };

    mkdirSync(join(process.cwd(), "MISSION-22"), { recursive: true });
    const file = join(process.cwd(), "MISSION-22", "live-validation.json");
    writeFileSync(file, JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ file, answered, total: seeded.length + probes.length, scenarios: scenarios.map((s) => ({ id: s.id, passes: s.passes, evidence: s.evidence })) }, null, 2));
    return;
  }

  /* ------------------------------- parity ------------------------------- */
  // Same memory path, same runtime, provider pinned. This is how each engine is
  // proven to receive the scoped, provenance-labelled payload rather than only
  // whichever engine the chain happened to pick.
  let enriched;
  try {
    // Seed a real memory with real provenance through the same bridge, then
    // build the probe request through the same enrichment path.
    await aiPrivate.memory.learn(
      "My father died last month and I can't focus on anything.",
      "Noted.",
      "parity-seed",
      chats.grief.id,
    );
    enriched = await aiPrivate.memory.enrich({
      messages: [],
      prompt: "Can you fix it?",
      conversationId: chats.probe.id,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[memory-live] parity seeding failed", error);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const provider of ["groq", "openrouter"] as const) {
    const before = captures.length;
    const clock = Date.now();
    let text = "";
    let error = "";
    try {
      const response = await aiPrivate.runtime.process(
        { ...(enriched?.request ?? {}), preferredProviders: [provider], allowTools: false, prompt: "Can you fix it?" },
        { recalledMemories: (enriched?.memories ?? []) as never[] },
      );
      text = response.text;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const turnCaptures = captures.slice(before);
    const capture = turnCaptures.at(-1) ?? null;
    results.push({
      provider,
      status: error ? "error" : capture ? "answered" : "no-model-call",
      error: error || undefined,
      ms: Date.now() - clock,
      model: turnCaptures.at(-1)?.provider ?? null,
      contextChars: capture?.contextChars ?? 0,
      griefInContext: /father died|died last month|grief/i.test(capture?.context ?? ""),
      voiceAttached: (capture?.voiceChars ?? 0) > 0,
      text,
    });
  }

  const output = {
    mission: "LÉLU 2.2 — provider parity for the memory boundary",
    verificationLevel: "pipeline parity (canonical MemoryBridge.enrich + AIRuntime.process → real provider HTTP)",
    startedAt,
    finishedAt: new Date().toISOString(),
    scenario: "Chat B asks \"Can you fix it?\" after a loss was discussed in chat A.",
    results,
    passes: results.filter((r) => r.status === "answered" && r.griefInContext === false).length,
  };
  mkdirSync(join(process.cwd(), "MISSION-22"), { recursive: true });
  const file = join(process.cwd(), "MISSION-22", "live-parity.json");
  writeFileSync(file, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ file, passes: output.passes, results: results.map((r) => ({ provider: r.provider, status: r.status, griefInContext: r.griefInContext, contextChars: r.contextChars })) }, null, 2));
}

main().catch((error) => {
  console.error("[memory-live] fatal", error);
  process.exitCode = 1;
});
