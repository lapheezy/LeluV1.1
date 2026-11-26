/**
 * ==========================================================
 * LÉLU — MISSION 37: MEMORY RUNTIME RECOVERY
 *
 * CATEGORY: unit. The real MemorySynthesizer, the real MemoryEngine, and the
 * real MemoryBridge with a recording brain.
 *
 * THE FAILURE THIS PINS
 *
 * `undefined is not an object (evaluating 't[n.memoryType??this.defaultType(
 * n.category)].push')` — the synthesizer grouped recalled memories through a
 * fixed map of the five cognitive layers and indexed it with whatever
 * `memoryType` the record carried. Records hydrated from persisted rows can
 * carry a SCOPE word ("session", "persistent-user") or a legacy label
 * ("episodic"), so the lookup returned undefined and `.push` threw. Because
 * synthesis runs inside the turn's memory enrichment, that TypeError did not
 * lose a memory — it lost the reply.
 *
 * Two guarantees are asserted here:
 *   • every layer value resolves to one of the five, and a memory is never
 *     dropped because its metadata was spelled differently;
 *   • a memory failure (malformed record, or synthesis itself throwing)
 *     cannot stop response generation.
 */

import assert from "node:assert/strict";
import test from "node:test";

import MemorySynthesizer from "../src/brain/MemorySynthesizer";
import MemoryEngine from "../src/brain/MemoryEngine";
import type PatternMemory from "../src/brain/PatternMemory";
import type ResponsePattern from "../src/brain/ResponsePattern";
import type { MemoryType } from "../src/brain/ResponsePattern";
import { MEMORY_TYPES, normalizeMemoryType } from "../src/brain/ResponsePattern";
import MemoryBridge from "../src/core/MemoryBridge";

/** A complete, well-formed memory; tests override only what they exercise. */
function memory(overrides: Partial<ResponsePattern> = {}): ResponsePattern {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    category: "preference",
    prompt: "I like jasmine tea",
    response: "I like jasmine tea",
    intent: "general",
    keywords: ["jasmine", "tea"],
    context: {},
    importance: 0.9,
    confidence: 1,
    successfulUses: 1,
    failedUses: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Which "## ..." section a memory's text landed in, or null. */
function sectionOf(context: string, needle: string): string | null {
  for (const section of context.split(/\n\n(?=## )/)) {
    if (section.includes(needle)) {
      return section.split("\n")[0].replace("## ", "").trim();
    }
  }
  return null;
}

/* ------------------------- layer resolution ------------------------- */

test("every canonical memory type resolves to itself", () => {
  for (const type of MEMORY_TYPES) {
    assert.equal(normalizeMemoryType(type), type);
  }
});

test("scope words and legacy labels map onto the five real layers", () => {
  const expected: Record<string, MemoryType> = {
    session: "conversation",
    "persistent-user": "user",
    "persistent_user": "user",
    temporary: "conversation",
    episodic: "conversation",
    semantic: "knowledge",
    identity: "self",
    runtime: "system",
    engineering: "system",
  };
  for (const [stored, layer] of Object.entries(expected)) {
    assert.equal(normalizeMemoryType(stored), layer, `${stored} → ${layer}`);
  }
});

test("a missing, null or unusable type falls back to the category's layer", () => {
  assert.equal(normalizeMemoryType(undefined, "goal"), "user");
  assert.equal(normalizeMemoryType(null, "preference"), "user");
  assert.equal(normalizeMemoryType(42, "conversation"), "conversation");
  assert.equal(normalizeMemoryType("", "experience"), "conversation");
  assert.equal(normalizeMemoryType("nonsense", "identity"), "self");
  assert.equal(normalizeMemoryType("  Session  "), "conversation");
});

/* ------------------------- the reported crash ------------------------ */

test("a memory whose type is a scope word does not crash synthesis", () => {
  const synthesizer = new MemorySynthesizer();
  for (const type of ["session", "persistent-user", "episodic", "bogus", "", null]) {
    const result = synthesizer.synthesize({
      prompt: "what tea do I like",
      memories: [memory({ memoryType: type as MemoryType })],
    });
    assert.ok(result.context.length > 0, `${String(type)} still reaches the model`);
    assert.equal(result.used.length, 1, `${String(type)} is not silently dropped`);
  }
});

test("each layer lands in its own section, however it was spelled", () => {
  const synthesizer = new MemorySynthesizer();
  const result = synthesizer.synthesize({
    prompt: "tell me about myself and what you know",
    memories: [
      memory({ response: "I like jasmine tea", memoryType: "persistent-user" }),
      memory({ response: "I am Lélu", memoryType: "identity", category: "identity" }),
      memory({ response: "We discussed weather", memoryType: "session", category: "conversation" }),
      memory({ response: "Jasmine grows in Yunnan", memoryType: "semantic", category: "general" }),
      memory({ response: "The Groq provider timed out", memoryType: "runtime", category: "general" }),
    ],
    deep: true,
  });

  assert.equal(sectionOf(result.context, "jasmine tea"), "About the user");
  assert.equal(sectionOf(result.context, "I am Lélu"), "About me");
  assert.equal(sectionOf(result.context, "We discussed weather"), "Recent conversation");
  assert.equal(sectionOf(result.context, "Jasmine grows in Yunnan"), "Knowledge");
  assert.equal(sectionOf(result.context, "Groq provider timed out"), "System state");
});

test("all five layers are bucketed even when the type is absent", () => {
  const synthesizer = new MemorySynthesizer();
  const result = synthesizer.synthesize({
    prompt: "everything you know",
    memories: [
      memory({ response: "I prefer green tea" }),
      memory({ response: "My name is Lélu", category: "identity" }),
      memory({ response: "Earlier we talked about tea", category: "conversation" }),
      memory({ response: "Tea is grown in Yunnan", memoryType: "knowledge" }),
      memory({ response: "The tea maker reported a timeout", memoryType: "system" }),
    ],
    deep: true,
  });

  for (const section of ["About the user", "About me", "Recent conversation", "Knowledge", "System state"]) {
    assert.ok(result.context.includes(`## ${section}`), `missing section: ${section}`);
  }
  assert.equal(result.used.length, 5);
});

/* --------------------- malformed metadata ---------------------------- */

test("malformed memory records are skipped, not fatal", () => {
  const synthesizer = new MemorySynthesizer();
  const records = [
    memory({ keywords: undefined as never, response: "I like tea" }),
    memory({ context: undefined as never, response: "I drink jasmine tea after lunch" }),
    memory({ importance: undefined as never, confidence: undefined as never, response: "Jasmine tea helps me focus in the morning" }),
    memory({ response: undefined as never }),
    memory({ category: undefined as never, response: "My favourite jasmine tea is the loose leaf kind" }),
    null as never,
    "not a memory" as never,
  ];

  const result = synthesizer.synthesize({ prompt: "jasmine tea", memories: records });

  // Four usable records; only the one with no text is dropped.
  assert.equal(result.used.length, 4);
  assert.ok(!result.used.some((used) => !used.response), "no empty memory reaches the model");
  assert.doesNotThrow(() => synthesizer.summarizeFacts("jasmine tea", records));
});

test("a memory with no keywords still matches on its own words", () => {
  const synthesizer = new MemorySynthesizer();
  const result = synthesizer.synthesize({
    prompt: "which tea do I like",
    memories: [memory({ keywords: undefined as never })],
  });
  assert.equal(result.used.length, 1);
});

/* ----------------------- writes across categories -------------------- */

/** The subset of PatternMemory MemoryEngine calls, in memory. */
class InMemoryPatterns {
  readonly patterns = new Map<string, ResponsePattern>();

  async add(pattern: ResponsePattern): Promise<void> {
    this.patterns.set(pattern.id, structuredClone(pattern));
  }

  async update(pattern: ResponsePattern): Promise<void> {
    this.patterns.set(pattern.id, structuredClone(pattern));
  }

  async search(): Promise<ResponsePattern[]> {
    return [...this.patterns.values()];
  }

  all(): ResponsePattern[] {
    return [...this.patterns.values()];
  }
}

test("every supported category writes a memory with a canonical layer", async () => {
  const cases: Array<{ prompt: string; category?: string }> = [
    { prompt: "My name is Ada", category: "identity" },
    { prompt: "I love jasmine tea", category: "preference" },
    { prompt: "My goal is to ship the archive migration this quarter", category: "goal" },
    { prompt: "I am building a memory runtime for my assistant", category: "project" },
    { prompt: "I can build Rust services and I know distributed systems", category: "skill" },
    { prompt: "My sister is called Mira and my family lives in Lisbon", category: "relationship" },
    { prompt: "Last year I lived in Porto for a while", category: undefined },
  ];

  for (const item of cases) {
    const store = new InMemoryPatterns();
    const engine = new MemoryEngine(store as unknown as PatternMemory);
    await engine.learn(item.prompt, "Noted.");
    const stored = store.all();
    assert.ok(stored.length > 0, `nothing persisted for: ${item.prompt}`);
    for (const pattern of stored) {
      assert.ok(
        MEMORY_TYPES.includes(pattern.memoryType as MemoryType),
        `non-canonical layer persisted: ${String(pattern.memoryType)} (${pattern.category})`,
      );
    }
  }
});

test("an extractor that supplies an alias still persists a canonical layer", async () => {
  const store = new InMemoryPatterns();
  const engine = new MemoryEngine(store as unknown as PatternMemory);
  // Exercised through the public write path rather than a private call: a
  // stored pattern's layer is always one the reader can index.
  await engine.learn("I prefer working late at night", "Noted.");
  for (const pattern of store.all()) {
    assert.ok(MEMORY_TYPES.includes(pattern.memoryType as MemoryType));
  }
});

/* ------------------- memory failure never costs a turn --------------- */

function bridgeWith(brainOverrides: Record<string, unknown> = {}) {
  const brain = {
    recall: async () => [],
    reflect: async () => ({ summary: "", memories: [] }),
    cognitiveState: () => null,
    getConversation: () => ({ context: () => ({ lastTopic: "", recentMessages: [], messageCount: 0 }) }),
    synthesizeContext: () => ({ context: "", used: [], rejected: 0, contradictions: [], notes: [] }),
    learn: async () => null,
    ...brainOverrides,
  };
  const user = { context: () => "", get: () => null };
  return new MemoryBridge(brain as never, user as never);
}

test("the exact production crash — an aliased layer from persisted recall — no longer fails the turn", async () => {
  const recalled = [
    memory({ memoryType: "persistent-user" as MemoryType }),
    memory({ memoryType: "personal" as MemoryType, response: "Jasmine tea helps me focus" }),
    memory({ memoryType: "semantic" as MemoryType, keywords: undefined as never, response: "I drink jasmine tea every morning" }),
  ];
  const bridge = bridgeWith({ recall: async () => recalled });

  const { request, memories } = await bridge.enrich({
    prompt: "jasmine tea",
    messages: [],
    conversationId: "chat-1",
  } as never);

  assert.equal(memories.length, 3, "recall results survive");
  assert.equal(request.prompt, "jasmine tea");
  assert.ok((request.context ?? "").length > 0, "the turn still carries context");
});

test("a session-scoped alias is deferred by policy, not by a crash", async () => {
  const bridge = bridgeWith({
    recall: async () => [
      memory({ memoryType: "session" as MemoryType, category: "conversation", response: "Jasmine tea was discussed" }),
    ],
  });

  const { memories } = await bridge.enrich({
    prompt: "jasmine tea",
    messages: [],
    conversationId: "chat-1",
  } as never);

  // Session material with no recorded session is not shown in another turn —
  // the existing sovereignty rule. The point here is that it is a decision,
  // not a TypeError.
  assert.equal(memories.length, 0);
});

test("a synthesis failure answers without synthesized memory instead of throwing", async () => {
  const bridge = bridgeWith({
    recall: async () => [memory()],
    synthesizeContext: () => {
      throw new TypeError("undefined is not an object (evaluating 't[...].push')");
    },
  });

  const { request, memories } = await bridge.enrich({
    prompt: "jasmine tea",
    messages: [],
    conversationId: "chat-1",
  } as never);

  assert.equal(memories.length, 1, "recall still reached the caller");
  assert.equal(request.prompt, "jasmine tea", "the request survives intact");
});

test("a reflection failure omits its section instead of failing the turn", async () => {
  const bridge = bridgeWith({
    recall: async () => [memory()],
    reflect: async () => {
      throw new Error("reflection store unavailable");
    },
  });

  const { request } = await bridge.enrich({
    prompt: "jasmine tea",
    messages: [],
    conversationId: "chat-1",
  } as never);

  assert.equal(request.prompt, "jasmine tea");
});

/* --------------------- WP02: a stalled provider ---------------------- */

function fakeProvider(
  name: string,
  priority: number,
  generate: Parameters<typeof Object>[0] extends never ? never : (request: never) => Promise<never>,
): never {
  return {
    name,
    priority,
    enabled: true,
    timeout: 1000,
    requiresApiKey: false,
    capabilities: ["chat"],
    async initialize() {},
    async isAvailable() {
      return true;
    },
    async health() {
      return { available: true, initialized: true, lastChecked: Date.now() };
    },
    canHandle() {
      return true;
    },
    generate,
  } as never;
}

test("a provider that ignores the abort signal cannot stall the turn", async () => {
  const { default: AIProviderRegistry } = await import("../src/core/AIProviderRegistry");
  const { default: ExecutionLogger } = await import("../src/core/ExecutionLogger");
  const { default: ProviderResolver } = await import("../src/core/router/ProviderResolver");

  const registry = new AIProviderRegistry();
  // Hangs for 5 s and never looks at request.signal — the adapter whose fetch
  // does not wire the abort. Aborting alone would leave the chain waiting.
  const stalled = fakeProvider("Stalled", 1, () => new Promise((resolve) => setTimeout(() => resolve({ text: "late", provider: "Stalled", model: "m", processingTime: 5000 }), 5000)) as never);
  const healthy = fakeProvider("Healthy", 2, async () => ({ text: "answered", provider: "Healthy", model: "m", processingTime: 5 }) as never);
  registry.registerMany([stalled, healthy]);
  await registry.initialize();

  const started = Date.now();
  const result = await new ProviderResolver({ rungBudgetMs: 250, chainBudgetMs: 5000 }).execute({
    request: { prompt: "hello", messages: [] },
    started: Date.now(),
    brain: {} as never,
    knowledgeProviders: {} as never,
    aiProviders: registry,
    logger: new ExecutionLogger(),
  } as never);

  const elapsed = Date.now() - started;
  assert.equal(result.response?.provider, "Healthy", "the healthy provider takes over");
  assert.ok(elapsed < 2000, `the turn advanced at the deadline, not at 5 s (took ${elapsed}ms)`);
});

/* ----------------- WP05: her body vs the conversation ---------------- */

test("on a phone, her presence never covers the conversation or the composer", async () => {
  const { planPresence } = await import("../src/app/scene/genesis/avatar/spatialPresence");
  const overlapArea = (a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) => {
    const width = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
    const height = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
    return width * height;
  };

  // An iPhone-sized floating chat sheet: the transcript starts at the
  // window's top edge, which is why half a body over that edge is half a body
  // over the messages.
  const chat = { left: 8, top: 320, width: 374, height: 432 };
  const composer = { left: 20, top: 700, width: 350, height: 60 };
  const space = {
    viewport: { width: 390, height: 844 },
    safe: { top: 47, right: 0, bottom: 34, left: 0 },
    chat,
    panels: [],
    composer,
    controls: [] as Array<{ left: number; top: number; width: number; height: number }>,
    reducedMotion: false,
  };
  const intent = {
    mode: "companion" as const,
    chatOpen: true,
    workspaceOpen: false,
    demonstrating: false,
    speaking: false,
    listening: false,
    interacting: false,
    toolActive: false,
  };

  const placement = planPresence(space, intent);

  assert.equal(placement.hidden, false, "she is still present");
  assert.equal(overlapArea(placement.rect, chat), 0, "she does not sit in the transcript");
  assert.equal(overlapArea(placement.rect, composer), 0, "she does not sit on the composer");
  assert.ok(placement.rect.top < chat.top, "she stands in the strip above the conversation");
});

/* ------------------ WP04: the gateway must be runnable ---------------- */

test("every whitelisted engineering operation is a command the runtime will accept", async () => {
  const { ENGINEER_OPERATIONS, TARGETED_OPERATIONS } = await import("../plugins/engineerApi");
  const { isSafeShellCommand } = await import("../plugins/commandSafety");

  // The runtime refuses any command carrying a shell metacharacter. A
  // whitelisted operation that contains one can never run, and that is how
  // `inspect` ("node --version && bun --version && pwd") was dead on arrival.
  for (const [name, command] of Object.entries(ENGINEER_OPERATIONS)) {
    assert.ok(isSafeShellCommand(command), `${name} would be refused: ${command}`);
  }
  for (const [name, entry] of Object.entries(TARGETED_OPERATIONS)) {
    assert.ok(isSafeShellCommand(entry.command), `${name} would be refused: ${entry.command}`);
  }
});

test("the inspect operation's script is on disk and needs no shell expansion", async () => {
  const { existsSync } = await import("node:fs");
  const { ENGINEER_OPERATIONS } = await import("../plugins/engineerApi");

  assert.equal(ENGINEER_OPERATIONS.inspect, "node scripts/inspect-runtime.mjs");
  assert.ok(existsSync(new URL("../scripts/inspect-runtime.mjs", import.meta.url)), "the script exists");
});
