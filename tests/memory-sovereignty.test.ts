/**
 * ==========================================================
 * LÉLU 2.2 — MEMORY SOVEREIGNTY ACCEPTANCE
 *
 * CATEGORY: integration (real store, real engine, real
 * synthesizer, real voice composer). No model is called here;
 * live-model evidence is MISSION-22/live-validation.json.
 *
 * The defect this pins: a loss discussed in one conversation
 * was answered as though it had been said in another. These
 * tests start from the actual runtime — Brain.learn writes a
 * memory with provenance, Brain.recall reads through the
 * scoped boundary, authorize() decides, MemorySynthesizer
 * renders — rather than from the helpers in isolation.
 *
 * Groups A–G mirror Work Package 08.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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

import Brain from "../src/brain/Brain";
import MemorySynthesizer from "../src/brain/MemorySynthesizer";
import type ResponsePattern from "../src/brain/ResponsePattern";
import {
  authorize,
  createOrigin,
  currentSessionId,
  decide,
  isEligible,
  legacyOrigin,
  memoryContextNote,
  originLabel,
  readOrigin,
  resetSessionForTests,
  SOVEREIGNTY_POLICY,
  subjectRelevance,
  type MemoryScopeContext,
} from "../src/core/memory/MemorySovereignty";
import { appraise } from "../src/core/identity/voice/EmotionAppraisal";
import { composeVoice } from "../src/core/identity/voice/VoiceComposer";

const USER = "primary-user";

function scope(conversationId: string | null, prompt: string, userId = USER, sessionId = currentSessionId()): MemoryScopeContext {
  return { userId, conversationId, sessionId, prompt };
}

/** A record shaped exactly as the store holds it, for boundary tests. */
function pattern(overrides: Partial<ResponsePattern> = {}, origin?: Record<string, unknown>): ResponsePattern {
  const id = overrides.id ?? `mem-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    category: "general",
    prompt: "stored prompt",
    response: "stored response",
    intent: "general",
    keywords: [],
    context: origin ? { origin } : {},
    memoryType: "user",
    importance: 0.8,
    confidence: 0.9,
    successfulUses: 1,
    failedUses: 0,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    ...overrides,
  };
}

function originFor(
  id: string,
  overrides: Partial<Parameters<typeof createOrigin>[0]> = {},
): Record<string, unknown> {
  return createOrigin({
    memoryId: id,
    userId: USER,
    conversationId: "chat-a",
    sessionId: currentSessionId(),
    sourceType: "user-said",
    ...overrides,
  }) as unknown as Record<string, unknown>;
}

/** Write one memory through the canonical engine, with provenance. */
async function learnIn(
  brain: Brain,
  text: string,
  conversationId: string,
  options: { userId?: string; title?: string; sessionId?: string } = {},
) {
  return brain.learn(text, "Noted.", "conversation", [], {
    source: "lelu-chat",
    originSeed: {
      userId: options.userId ?? USER,
      conversationId,
      sessionId: options.sessionId ?? currentSessionId(),
      conversationTitle: options.title ?? conversationId,
      sourceType: "user-said",
    },
  });
}

/* ============================================================
 * GROUP A — CONVERSATION ISOLATION
 * ============================================================ */

test("A: a loss stated in chat A is not retrieved into chat B", async () => {
  const brain = new Brain();
  await learnIn(brain, "My father died last month and I can't fix it.", "chat-a", { title: "Grief" });

  const b = scope("chat-b", "Can you fix it?");
  const recalled = await brain.recall("Can you fix it?", "cognition", b);
  const { allowed, decisions } = authorize(recalled, b);

  assert.equal(allowed.length, 0, "no grief memory may reach chat B for this question");
  assert.ok(
    decisions.every((d) => d.decision === "DEFER" || d.decision === "REJECT"),
    `expected deferral/rejection, got ${JSON.stringify(decisions.map((d) => d.decision))}`,
  );

  const synthesized = new MemorySynthesizer().synthesize({
    prompt: "Can you fix it?",
    memories: allowed,
    conversationId: "chat-b",
  });
  assert.ok(!/father|died|loss/i.test(synthesized.context), "the context handed to the model is clean");
});

test("A: the same memory remains available inside the conversation that owns it", async () => {
  const brain = new Brain();
  await learnIn(brain, "My father died last month and I can't fix it.", "chat-a");

  const a = scope("chat-a", "Can you fix it?");
  const recalled = await brain.recall("Can you fix it?", "cognition", a);
  const { allowed, decisions } = authorize(recalled, a);

  assert.ok(allowed.length > 0, "within its own conversation the memory is current context");
  assert.equal(decisions[0].decision, "RETRIEVE");
  assert.equal(decisions[0].relation, "this-conversation");
});

test("A: one user's memory is never eligible for another user", async () => {
  const brain = new Brain();
  await learnIn(brain, "My father died last month and I can't fix it.", "chat-a");

  const other = scope("chat-a", "Can you fix it?", "someone-else");
  const recalled = await brain.recall("Can you fix it?", "cognition", other);
  assert.deepEqual(recalled, [], "ownership is enforced inside retrieval, not after it");
});

test("A: session memory never crosses runtime sessions", () => {
  const id = "session-memory";
  const record = pattern(
    { id, memoryType: "conversation", response: "Temporary scratch note about the deploy window." },
    originFor(id, { scope: "session", sourceType: "user-said", sessionId: "session-one" }),
  );

  const otherSession = scope("chat-b", "deploy window", USER, "session-two");
  assert.equal(isEligible(record, otherSession), false);
  assert.equal(decide(record, otherSession).decision, "REJECT");

  const sameSession = scope("chat-a", "deploy window", USER, "session-one");
  assert.equal(decide(record, sameSession).decision, "RETRIEVE");
});

test("A: a legacy memory is historical by definition, never current", async () => {
  const legacy = pattern({ id: "legacy-1", response: "My father died last month." });
  const origin = legacyOrigin(legacy);
  assert.equal(origin.originatingConversationId, null);
  assert.notEqual(origin.scope, "current-conversation");
  assert.equal(decide(legacy, scope("chat-b", "Can you fix it?")).decision, "DEFER");
});

test("A: a restored session does not resurrect the previous session's temporary memory", () => {
  resetSessionForTests("restored-session");
  const id = "temp-1";
  const record = pattern({ id, memoryType: "conversation" }, originFor(id, { scope: "session", sessionId: "old-session" }));
  assert.equal(decide(record, scope("chat-a", "anything", USER, "restored-session")).decision, "REJECT");
});

test("A: cognitive observations are rendered only in the conversation that made them", async () => {
  // Found live, outside the memory store: Brain.learn fed every turn's text
  // into the global cognitive graph, and buildContext printed the last five
  // nodes on every turn. Chat B saw chat A's loss through "Recent knowledge
  // nodes" even when zero memories were recalled.
  const brain = new Brain();
  await learnIn(brain, "My father died last month and I can't focus on anything.", "chat-a");

  const other = (brain.cognitiveState("chat-b").nodes as Array<{ label?: string }>);
  assert.equal(other.length, 0, "none of chat A's observations belong to chat B");

  const own = (brain.cognitiveState("chat-a").nodes as Array<{ label?: string }>);
  assert.ok(own.length > 0, "the conversation that produced them still sees them");
  assert.ok(own.some((node) => /father died/.test(String(node.label))));
});

/* ============================================================
 * GROUP B — HISTORICAL RECALL
 * ============================================================ */

test("B: a project from an earlier conversation is recallable, with its origin preserved", async () => {
  const brain = new Brain();
  await learnIn(
    brain,
    "I'm building a project called Aurelia — a jewellery brand with a rose gold signature.",
    "chat-a",
    { title: "Aurelia studio" },
  );

  const b = scope("chat-b", "What's the status of the Aurelia project?");
  const recalled = await brain.recall("What's the status of the Aurelia project?", "cognition", b);
  const { allowed, decisions } = authorize(recalled, b);

  assert.ok(allowed.length > 0, "historical recall still works — this mission does not amputate memory");
  const decision = decisions.find((d) => d.decision === "RETRIEVE_WITH_CONTEXT");
  assert.ok(decision, "historical material is authorized WITH context");
  assert.equal(decision!.relation, "other-conversation");
  assert.equal(decision!.originatingConversationId, "chat-a");

  const synthesized = new MemorySynthesizer().synthesize({
    prompt: "What's the status of the Aurelia project?",
    memories: allowed,
    conversationId: "chat-b",
  });
  assert.match(synthesized.context, /\[earlier conversation .Aurelia studio.\]/);
  assert.match(synthesized.context, /Aurelia/);
});

test("B: the model is told how to speak about historical material", () => {
  const note = memoryContextNote([
    {
      memoryId: "m",
      decision: "RETRIEVE_WITH_CONTEXT",
      reason: "history",
      scope: "persistent-user",
      sourceType: "user-said",
      relevance: 0.8,
      relation: "other-conversation",
      originatingConversationId: "chat-a",
    },
  ]);
  assert.match(note, /never say "you just told me"/i);
  assert.match(note, /ARE things the user told you/, "the memory is not denied — only its origin is distinguished");
  assert.match(note, /present state/, "historical emotion is explicitly not current mood");
});

test("B: a turn with no historical or inferred material pays no provenance tokens", () => {
  const clean = memoryContextNote([
    {
      memoryId: "m",
      decision: "RETRIEVE",
      reason: "current",
      scope: "current-conversation",
      sourceType: "user-said",
      relevance: 1,
      relation: "this-conversation",
      originatingConversationId: "chat-b",
    },
  ]);
  assert.equal(clean, "");
});

test("B: labels never invent an origin that was not recorded", () => {
  const legacy = pattern({ id: "legacy-2" });
  assert.equal(originLabel(legacy, "chat-b"), "", "no origin means no invented attribution");
  const known = pattern(
    { id: "known-1" },
    originFor("known-1", { conversationId: "chat-a", conversationTitle: null }),
  );
  assert.equal(originLabel(known, "chat-b"), "[earlier conversation]");
});

/* ============================================================
 * GROUP C — CHRONOLOGY
 * ============================================================ */

test("C: a correction supersedes, and the original origin never moves", async () => {
  const brain = new Brain();
  const first = await learnIn(brain, "I prefer rose gold for the studio.", "chat-a", { title: "Metals" });
  assert.ok(first, "the original preference was stored");
  const originalOrigin = readOrigin(first!);

  const corrected = await learnIn(brain, "Actually, I prefer platinum now, not rose gold.", "chat-c");
  assert.ok(corrected, "the correction consolidated onto the same record");
  const updatedOrigin = readOrigin(corrected!);

  assert.equal(corrected!.id, first!.id, "one record, updated — not a duplicate");
  assert.equal(updatedOrigin.originatingConversationId, "chat-a", "where it was FIRST learned is preserved");
  assert.ok(updatedOrigin.updatedAt > originalOrigin.createdAt, "the update time advances");
  assert.match(corrected!.response, /platinum/i, "the newer value is the current one");

  const newChat = scope("chat-d", "What metal do I prefer for the studio?");
  const { allowed, decisions } = authorize(await brain.recall("What metal do I prefer for the studio?", "cognition", newChat), newChat);
  const used = allowed.map((m) => m.response).join("\n");
  assert.match(used, /platinum/i);
  assert.equal(decisions.filter((d) => d.decision === "RETRIEVE" || d.decision === "RETRIEVE_WITH_CONTEXT").length, 1);
});

test("C: an inference is never promoted to an established fact", () => {
  const id = "inferred-1";
  const low = pattern(
    { id, response: "You probably want to move the studio to Lisbon." },
    originFor(id, { scope: "derived", sourceType: "inferred", confidence: 0.5, conversationId: "chat-a" }),
  );
  const high = pattern(
    { id, response: "You probably want to move the studio to Lisbon." },
    originFor(id, { scope: "derived", sourceType: "inferred", confidence: 0.9, conversationId: "chat-a" }),
  );
  const ctx = scope("chat-b", "Where should the studio move?");

  assert.equal(decide(low, ctx).decision, "DEFER", "an unsure inference stays out");
  const decision = decide(high, ctx);
  assert.equal(decision.decision, "RETRIEVE_WITH_CONTEXT");
  assert.equal(originLabel(high, "chat-b"), "[inferred]");

  const synthesized = new MemorySynthesizer().synthesize({
    prompt: "Where should the studio move?",
    memories: [high],
    conversationId: "chat-b",
  });
  assert.match(synthesized.context, /\[inferred\]/);
});

/* ============================================================
 * GROUP D — MEMORY OWNERSHIP
 * ============================================================ */

test("D: cross-user retrieval is rejected", () => {
  const id = "owned-by-other";
  const record = pattern({ id }, originFor(id, { userId: "intruder" }));
  assert.equal(decide(record, scope("chat-a", "studio")).decision, "REJECT");
});

test("D: a forged provenance reference is rejected", () => {
  const record = pattern(
    { id: "real-id" },
    originFor("a-different-id", { userId: USER }),
  );
  const decision = decide(record, scope("chat-a", "studio"));
  assert.equal(decision.decision, "REJECT");
  assert.match(decision.reason, /provenance id/);
});

test("D: an invalid conversation id gains no current-conversation authority", () => {
  const id = "m-1";
  const record = pattern({ id, response: "The studio uses rose gold." }, originFor(id, { conversationId: "chat-a" }));
  const decision = decide(record, scope("chat-that-does-not-exist", "studio rose gold"));
  assert.notEqual(decision.decision, "RETRIEVE");
  assert.equal(decision.relation, "other-conversation");
});

test("D: a memory with no recorded owner is not claimed by anyone", () => {
  const id = "migrated-1";
  const record = pattern({ id, response: "The studio uses rose gold." }, originFor(id, { userId: null }));
  const decision = decide(record, scope("chat-b", "studio rose gold"));
  assert.notEqual(decision.decision, "REJECT", "migrated memory is not discarded");
  assert.equal(readOrigin(record).userId, null);
});

/* ============================================================
 * GROUP E — CONTEXT CONTAMINATION
 * ============================================================ */

test("E: an irrelevant memory from another conversation is deferred", () => {
  const id = "irrelevant";
  const record = pattern({ id, response: "My favourite colour is green." }, originFor(id, { conversationId: "chat-a" }));
  assert.equal(decide(record, scope("chat-b", "How do I configure the Groq provider?")).decision, "DEFER");
});

test("E: an irrelevant memory from THIS conversation is authorized but never rendered", () => {
  // Same-conversation material is legitimate continuity — it is not
  // contamination, and the transcript may not be the only consumer. Relevance
  // still decides whether it is worth putting in front of the model, which is
  // the synthesizer's job (it scores, then caps).
  const id = "irrelevant-local";
  const record = pattern({ id, response: "My favourite colour is green." }, originFor(id, { conversationId: "chat-b" }));
  const ctx = scope("chat-b", "How do I configure the Groq provider?");
  assert.equal(decide(record, ctx).decision, "RETRIEVE");

  const synthesized = new MemorySynthesizer().synthesize({
    prompt: ctx.prompt,
    memories: authorize([record], ctx).allowed,
    conversationId: "chat-b",
  });
  assert.ok(!/green/i.test(synthesized.context), "relevance keeps unrelated material out of the prompt");
});

test("E: sensitive history with a shared verb but no shared subject is deferred", () => {
  const id = "grief";
  const record = pattern(
    { id, response: "My father died last month and I can't fix it." },
    originFor(id, { conversationId: "chat-a" }),
  );
  assert.equal(subjectRelevance("Can you fix it?", record.response), 0);
  assert.equal(decide(record, scope("chat-b", "Can you fix it?")).decision, "DEFER");
});

test("E: sensitive history asked about directly is retrievable as history", () => {
  const id = "grief-2";
  const record = pattern(
    { id, response: "My father died last month and I can't fix it." },
    originFor(id, { conversationId: "chat-a" }),
  );
  const decision = decide(record, scope("chat-b", "How am I handling my father's death now?"));
  assert.equal(decision.decision, "RETRIEVE_WITH_CONTEXT");
  assert.match(decision.reason, /history/);
});

test("E: a possessive question still matches the stored statement", () => {
  // Found live: "my father's death" tokenised as one word and matched nothing,
  // so an authorized memory was then rejected by the synthesizer and the model
  // answered as if it had never been told.
  const record = pattern({ id: "p", response: "My father died last month and I can't focus on anything." });
  const synthesized = new MemorySynthesizer().synthesize({
    prompt: "How am I handling my father's death now?",
    memories: [record],
    conversationId: "chat-b",
  });
  assert.equal(synthesized.used.length, 1, "the fact reaches the model when it is asked about directly");
  assert.match(synthesized.context, /father died/);
});

test("E: duplicates collapse in synthesis and contradictions are named", () => {
  const a = pattern({ id: "a", category: "preference", response: "I prefer rose gold for the studio." });
  const b = pattern({ id: "b", category: "preference", response: "I prefer rose gold for the studio." });
  const c = pattern({ id: "c", category: "preference", response: "I no longer prefer rose gold for the studio; use platinum." });

  const synthesized = new MemorySynthesizer().synthesize({
    prompt: "what metal do I prefer for the studio",
    memories: [a, b, c],
  });
  const occurrences = synthesized.context.split("rose gold for the studio").length - 1;
  assert.ok(synthesized.used.length <= 2, `duplicates collapsed (used ${synthesized.used.length})`);
  assert.ok(occurrences >= 1);
});

test("E: an outdated summary is never presented as current", async () => {
  const brain = new Brain();
  const learned = await learnIn(brain, "I prefer rose gold for the studio.", "chat-a");
  const current = readOrigin((await learnIn(brain, "Actually, I prefer platinum now, not rose gold.", "chat-c"))!);
  assert.equal(current.memoryId, learned!.id);
  const decisions = authorize(await brain.recall("What metal do I prefer?", "cognition", scope("chat-d", "What metal do I prefer?")), scope("chat-d", "What metal do I prefer?"));
  const text = decisions.allowed.map((m) => m.response).join(" ");
  assert.match(text, /^[\s\S]*platinum/);
});

/* ============================================================
 * GROUP F — CONCURRENCY
 * ============================================================ */

test("F: simultaneous conversations do not share recalled context", async () => {
  const brain = new Brain();
  await Promise.all([
    learnIn(brain, "My father died last month and I can't fix it.", "chat-a"),
    learnIn(brain, "I'm building a telescope mount in the workshop.", "chat-b"),
  ]);

  const [fromA, fromB] = await Promise.all([
    brain.recall("father fix", "cognition", scope("chat-a", "father fix")),
    brain.recall("telescope mount", "cognition", scope("chat-b", "telescope mount")),
  ]);

  assert.ok(fromA.every((m) => !/telescope/i.test(m.response)));
  assert.ok(fromB.every((m) => !/father died/i.test(m.response)));
});

test("F: concurrent writes keep their own provenance and do not reassign conversations", async () => {
  const brain = new Brain();
  const [one, two] = await Promise.all([
    learnIn(brain, "I prefer working in the morning.", "chat-a"),
    learnIn(brain, "I prefer working late at night.", "chat-b"),
  ]);
  assert.equal(readOrigin(one!).originatingConversationId, "chat-a");
  assert.equal(readOrigin(two!).originatingConversationId, "chat-b");
  assert.notEqual(one!.id, two!.id, "two different conversations produce two different records");
});

/* ============================================================
 * GROUP G — PERSONALITY REGRESSION (2.1 BOUNDARY)
 * ============================================================ */

test("G: historical grief never becomes the present emotional appraisal", () => {
  const reading = appraise("Can you fix it?");
  assert.notEqual(reading.primary, "grief");
  assert.ok(
    reading.intensity < 0.6,
    `the current message does not read as a bereavement (intensity ${reading.intensity})`,
  );

  const composition = composeVoice({
    prompt: "Can you fix it?",
    recentMessages: [],
  });
  assert.equal(composition.appraisal.primary, reading.primary);
  assert.ok(
    !/grief|loss|bereave/i.test(composition.text),
    "the voice directive for chat B carries no trace of chat A's emotion",
  );
});

test("G: the policy document is the code's own policy", () => {
  const raw = readFileSync("MISSION-22/retrieval-policy.json", "utf8");
  const document = JSON.parse(raw) as { version?: string; thresholds?: Record<string, number> };
  assert.equal(document.version, SOVEREIGNTY_POLICY.version);
  assert.equal(document.thresholds?.sensitiveHistoricalRelevance, SOVEREIGNTY_POLICY.sensitiveHistoricalRelevance);
});
