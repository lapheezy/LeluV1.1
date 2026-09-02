/**
 * ==========================================================
 * LÉLU — CHAT ↔ AUTONOMOUS COGNITION INTEGRATION
 *
 * The chat route must READ the cognitive state her autonomous
 * self-study loop already produced. It must never be the thing
 * that creates it.
 *
 * These tests pin the contract:
 *   - reading the state runs no cycle and mutates nothing
 *   - the state survives a process restart (durable trace)
 *   - the state is served whether or not a message was just sent
 *   - the answer is composed from that state, and reports the
 *     seven things a cognitive-state answer has to report
 *   - "what are you thinking about" is not swallowed by the
 *     identity matcher, and does not steal operational-status
 *     questions from the Executive Runtime
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import SelfStudyEngine from "../src/core/cognition/SelfStudyEngine";
import StudyObjectives from "../src/core/cognition/StudyObjectives";
import KvStore from "../src/core/storage/KvStore";
import CognitiveStateResolver, { isCognitiveStateQuestion } from "../src/core/router/CognitiveStateResolver";
import { buildCognitiveContext, formatCognitiveContext } from "../src/core/cognition/CognitiveContext";
import { isIdentityOrProfileQuestion } from "../src/brain/LeluIdentity";
import ExecutiveRuntime from "../src/core/executive/ExecutiveRuntime";
import ExecutionLogger from "../src/core/ExecutionLogger";
import Brain from "../src/brain/Brain";
import type RouterContext from "../src/core/router/RouterContext";
import type ProviderRegistry from "../src/core/ProviderRegistry";
import type AIProviderRegistry from "../src/core/AIProviderRegistry";

function contextFor(prompt: string): RouterContext {
  return {
    request: { messages: [{ role: "user", content: prompt }], prompt },
    started: Date.now(),
    brain: new Brain(),
    knowledgeProviders: { all: () => [] } as unknown as ProviderRegistry,
    aiProviders: { names: () => [], all: () => [] } as unknown as AIProviderRegistry,
    logger: new ExecutionLogger(),
    intent: "chat",
  };
}

// ============================================================
// QUESTION ROUTING
// ============================================================

test("cognitive-state questions are recognised", () => {
  for (const prompt of [
    "LÉLU, what are you thinking about today?",
    "What are you thinking about?",
    "what's on your mind?",
    "What are you studying right now?",
    "what have you learned?",
    "What is your current focus?",
    "What are you trying to figure out?",
  ]) {
    assert.ok(isCognitiveStateQuestion(prompt), `should match: ${prompt}`);
  }
});

test("it does not steal operational-status questions from the Executive Runtime", () => {
  for (const prompt of ["what are you doing?", "are you still working?", "what's your status?"]) {
    assert.ok(!isCognitiveStateQuestion(prompt), `must not claim: ${prompt}`);
    assert.ok(
      ExecutiveRuntime.isOperationalStatusQuestion(prompt),
      `Executive Runtime still owns: ${prompt}`,
    );
  }
});

test("the identity matcher would otherwise swallow the question, so ordering matters", () => {
  const prompt = "LÉLU, what are you thinking about today?";
  // This is exactly why CognitiveStateResolver must run BEFORE BrainResolver.
  assert.ok(
    isIdentityOrProfileQuestion(prompt),
    "identity matcher claims it (contains 'what are you' + '?')",
  );
  assert.ok(isCognitiveStateQuestion(prompt), "cognition matcher also claims it");
});

test("ordinary chat is left alone", () => {
  for (const prompt of ["hello", "design a pendant", "what is the weather?", "who are you?"]) {
    assert.ok(!isCognitiveStateQuestion(prompt), `must not claim: ${prompt}`);
  }
});

// ============================================================
// READING STATE NEVER CREATES IT
// ============================================================

test("reading cognitive state runs no cycle and mutates nothing", async () => {
  const engine = SelfStudyEngine.getInstance();
  const ledger = StudyObjectives.getInstance();
  ledger.clear();
  await engine.runCycle();

  const cycleBefore = engine.getCycle();
  const openBefore = ledger.open().map((o) => o.id).join(",");

  const a = engine.getCognitiveState();
  const b = engine.getCognitiveState();

  assert.equal(engine.getCycle(), cycleBefore, "no cycle was run by reading");
  assert.equal(ledger.open().map((o) => o.id).join(","), openBefore, "the buffer was not mutated");
  assert.equal(a.focus?.question, b.focus?.question, "repeated reads are stable");
});

test("answering a cognitive-state question runs no cycle", async () => {
  const engine = SelfStudyEngine.getInstance();
  await engine.runCycle();
  const cycleBefore = engine.getCycle();

  const result = await new CognitiveStateResolver().execute(
    contextFor("LÉLU, what are you thinking about today?"),
  );

  assert.ok(result.handled && result.response, "the question was answered");
  assert.equal(engine.getCycle(), cycleBefore, "the chat request did not advance cognition");
  assert.equal(result.response!.metadata?.triggeredCognition, false);
  assert.equal(result.response!.metadata?.readOnly, true);
  assert.equal(result.response!.provider, "cognition");
});

test("building the shared cognitive context runs no cycle", async () => {
  const engine = SelfStudyEngine.getInstance();
  await engine.runCycle();
  const cycleBefore = engine.getCycle();

  const ctx = buildCognitiveContext();

  assert.equal(engine.getCycle(), cycleBefore, "assembling request context did not advance cognition");
  assert.ok(ctx.selfStudy, "self-study state is part of every request's context");
});

// ============================================================
// THE ANSWER IS GROUNDED IN THAT STATE
// ============================================================

test("the answer reports the actual state, covering all seven required elements", async () => {
  const engine = SelfStudyEngine.getInstance();
  StudyObjectives.getInstance().clear();
  for (let i = 0; i < 3; i += 1) await engine.runCycle();

  const state = engine.getCognitiveState();
  const result = await new CognitiveStateResolver().execute(contextFor("What are you thinking about?"));
  const text = result.response!.text;

  // 1 current cognitive focus
  assert.ok(state.focus, "she has a focus");
  assert.ok(text.includes(state.focus!.question), "the answer names the actual current focus");
  // 2 active investigation
  assert.ok(text.includes(state.investigation!.agent), "names the agent that ran it");
  assert.ok(text.includes(state.investigation!.tool), "names the tool that ran it");
  // 3 why that investigation was selected
  assert.ok(text.includes(state.focus!.whySelected), "explains why this question was selected");
  // 4 relevant discoveries
  if (state.discoveries.length > 0) {
    assert.ok(
      state.discoveries.some((d) => text.includes(d.split(" [")[0])),
      "surfaces a real discovery",
    );
  }
  // 5 unresolved questions
  if (state.unresolved.length > 0) {
    assert.ok(
      state.unresolved.some((u) => text.includes(u.split(" (")[0])),
      "surfaces a real unresolved question",
    );
  }
  // 6 current project/self understanding
  assert.ok(
    text.includes(String(state.understanding.knowledgeEntries)),
    "reports what she actually holds",
  );
  assert.ok(/development runtime|build-time snapshot/i.test(text), "states how she can read her source");
  // 7 next intended investigation
  if (state.nextIntended) {
    assert.ok(text.includes(state.nextIntended.question), "names the next intended investigation");
    assert.ok(text.includes(state.nextIntended.whySelected), "explains why that one is next");
  }
});

test("the answer surfaces conclusions, not a hidden reasoning trace", async () => {
  const engine = SelfStudyEngine.getInstance();
  await engine.runCycle();
  const result = await new CognitiveStateResolver().execute(contextFor("What are you thinking about?"));
  const text = result.response!.text;

  // The evaluation's internal labels must not be dumped verbatim.
  assert.ok(!text.includes("CONFIDENCE:"), "no raw evaluation scaffolding");
  assert.ok(!text.includes("QUESTION I AM INVESTIGATING:"), "no internal prompt text");
  assert.ok(!/\bNEXT:\s/.test(text), "no raw NEXT directive");
});

// ============================================================
// AVAILABLE WITHOUT A RECENT MESSAGE, AND ACROSS A RESTART
// ============================================================

test("the state survives a restart and is served from the durable trace", async () => {
  const engine = SelfStudyEngine.getInstance();
  StudyObjectives.getInstance().clear();
  await engine.runCycle();

  const live = engine.getCognitiveState();
  assert.equal(live.source, "live");
  assert.ok(live.focus, "a focus was recorded");

  // The durable trace is what a freshly-loaded process reads.
  const trace = KvStore.getInstance().get<{ cycle: number; question: string | null }>(
    "lelu.selfstudy.trace.v1",
  );
  assert.ok(trace, "a durable trace was written");
  assert.equal(trace!.question, live.focus!.question, "the trace holds the same focus");
  assert.ok(trace!.cycle >= 1, "the trace records the cycle number");
});

test("the same state is served regardless of whether a message was just sent", async () => {
  const engine = SelfStudyEngine.getInstance();
  await engine.runCycle();

  const withoutMessage = engine.getCognitiveState();
  await new CognitiveStateResolver().execute(contextFor("What are you thinking about?"));
  const afterMessage = engine.getCognitiveState();

  assert.equal(afterMessage.focus?.question, withoutMessage.focus?.question);
  assert.equal(afterMessage.cycle, withoutMessage.cycle, "asking did not advance cognition");
  assert.equal(afterMessage.carried, withoutMessage.carried);
});

test("the formatted context injects the state every request already receives", async () => {
  const engine = SelfStudyEngine.getInstance();
  await engine.runCycle();

  const formatted = formatCognitiveContext(buildCognitiveContext());
  const state = engine.getCognitiveState();

  assert.ok(formatted.includes("LÉLU AUTONOMOUS COGNITION"), "the section is present");
  assert.ok(formatted.includes(state.focus!.question), "the real focus is injected");
  assert.ok(
    formatted.includes("REAL_DEVELOPMENT_RUNTIME") || formatted.includes("STATIC_SNAPSHOT"),
    "evidence provenance is labelled explicitly, never left implicit",
  );
});
