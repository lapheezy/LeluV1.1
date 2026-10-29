/**
 * ==========================================================
 * LÉLU — PERSONALITY DEVELOPMENT TESTS
 *
 * Tests for the identity/personality layer. Covers:
 *   - Identity initialization and persistence
 *   - Trait lifecycle (candidate → emerging → established)
 *   - Drift protection (single observation cannot promote)
 *   - Daily record (no fabrication)
 *   - DailyReflection pattern matching
 *   - PersonalityMemoryProvider interface compliance
 *   - Integration checks (MemoryBridge, GenesisPanel, GenesisInterface)
 *   - No second brain (identity files must not import AI systems)
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath as __toPath } from "node:url";
/** Repo root, derived from this file — never a machine-specific absolute path. */
const REPO_ROOT = __toPath(new URL("..", import.meta.url)).replace(/\/$/, "");
import { readFileSync } from "node:fs";

// ---- Source helpers ----

function src(path: string): string {
  return readFileSync(`${REPO_ROOT}/${path}`, "utf8");
}

// ---- IDENTITY INITIALIZATION ----

test("LeluIdentity: initializes with coreValues, traits, and sandboxMode", async () => {
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const identity = LeluIdentity.getInstance();
  const state = identity.getState();

  assert.ok(Array.isArray(state.coreValues), "coreValues must be an array");
  assert.ok(state.coreValues.length > 0, "coreValues must be seeded");
  assert.ok(state.coreValues.includes("curiosity"), "coreValues must include curiosity");
  assert.ok(Array.isArray(state.traits), "traits must be an array");
  assert.ok(state.traits.length > 0, "traits must be seeded");
  assert.strictEqual(typeof state.sandboxMode, "boolean", "sandboxMode must be a boolean");
  assert.ok(state.selfConcept.length > 0, "selfConcept must be seeded");
  assert.ok(state.communicationStyle.length > 0, "communicationStyle must be seeded");
  LeluIdentity.reset();
});

test("LeluIdentity: addTraitObservation increases evidenceCount", async () => {
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const identity = LeluIdentity.getInstance();
  const before = identity.getTrait("curiosity");
  const beforeCount = before?.evidenceCount ?? 0;

  identity.addTraitObservation("curiosity", "Explored a new topic with genuine interest");
  const after = identity.getTrait("curiosity");
  assert.ok((after?.evidenceCount ?? 0) > beforeCount, "evidenceCount must increase after supporting observation");
  LeluIdentity.reset();
});

test("LeluIdentity: candidate trait promoted to emerging at evidenceCount >= 3 with confidence >= 0.45", async () => {
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const identity = LeluIdentity.getInstance();

  // Add 3 supporting observations
  for (let i = 0; i < 3; i++) {
    identity.addTraitObservation("curiosity", `Evidence ${i + 1}: explored and discovered`);
  }
  const trait = identity.getTrait("curiosity");
  // The trait should be emerging or higher (it starts at 0.35 confidence, 3 * 0.06 = 0.18 → 0.53)
  assert.ok(
    trait?.status === "emerging" || trait?.status === "established",
    `Trait should be emerging or established after 3 observations, got: ${trait?.status}`,
  );
  LeluIdentity.reset();
});

test("LeluIdentity: contrarian evidence reduces confidence", async () => {
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const identity = LeluIdentity.getInstance();
  const before = identity.getTrait("curiosity");
  const beforeConfidence = before?.confidence ?? 0.35;

  identity.addTraitObservation("curiosity", "Did not engage with the topic at all", true);
  const after = identity.getTrait("curiosity");
  assert.ok((after?.confidence ?? 0) < beforeConfidence, "Confidence must decrease after contrarian evidence");
  LeluIdentity.reset();
});

test("LeluIdentity: drift protection — single observation does not promote from candidate (starting at 0.35 confidence)", async () => {
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const identity = LeluIdentity.getInstance();

  identity.addTraitObservation("patience", "Was patient in this one interaction");
  const trait = identity.getTrait("patience");
  // After 1 observation: evidenceCount=1, confidence=0.41 — not enough for emerging (needs ≥3 obs and ≥0.45)
  assert.strictEqual(trait?.status, "candidate", "One observation must not promote a trait from candidate");
  LeluIdentity.reset();
});

test("LeluIdentity: sandboxMode stages changes instead of applying immediately", async () => {
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const identity = LeluIdentity.getInstance();
  identity.setSandboxMode(true);

  const id = identity.stageSandboxChange({
    kind: "preference",
    description: "Prefers concise responses",
    proposedAt: Date.now(),
    evidence: "Observed preference in interaction",
    payload: { text: "concise responses" },
  });

  const state = identity.getState();
  assert.ok(state.pendingSandboxChanges.length > 0, "Sandbox mode must stage changes");
  assert.ok(state.pendingSandboxChanges.some((c) => c.id === id), "Staged change must have the returned id");
  assert.ok(!state.preferences.includes("concise responses"), "Preference must not be applied while staged");
  LeluIdentity.reset();
});

test("LeluIdentity: commitSandboxChange applies the staged change", async () => {
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const identity = LeluIdentity.getInstance();
  identity.setSandboxMode(true);

  const id = identity.stageSandboxChange({
    kind: "preference",
    description: "Prefers bullet points",
    proposedAt: Date.now(),
    evidence: "Observed preference",
    payload: { text: "bullet points" },
  });

  const committed = identity.commitSandboxChange(id);
  assert.ok(committed, "commitSandboxChange must return true on success");
  const state = identity.getState();
  assert.ok(!state.pendingSandboxChanges.some((c) => c.id === id), "Change must be removed from pending after commit");
  LeluIdentity.reset();
});

test("LeluIdentity: takeSnapshot appends to developmentHistory", async () => {
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const identity = LeluIdentity.getInstance();
  const before = identity.getState().developmentHistory.length;

  identity.takeSnapshot("Test snapshot", []);
  const after = identity.getState().developmentHistory.length;
  assert.ok(after > before, "developmentHistory must grow after takeSnapshot");
  LeluIdentity.reset();
});

// ---- DAILY RECORD ----

test("DailyRecord: getOrCreateToday creates a record for today's date", async () => {
  const { default: DailyRecord } = await import("../src/core/identity/DailyRecord.ts");
  DailyRecord.reset();
  const daily = DailyRecord.getInstance();
  const today = new Date().toISOString().slice(0, 10);
  const record = daily.getOrCreateToday();
  assert.strictEqual(record.date, today, "getOrCreateToday must use today's date");
  DailyRecord.reset();
});

test("DailyRecord: appendToday adds to existing today record", async () => {
  const { default: DailyRecord } = await import("../src/core/identity/DailyRecord.ts");
  DailyRecord.reset();
  const daily = DailyRecord.getInstance();
  daily.appendToday("observations", "Noticed a pattern in the conversation");
  const record = daily.getOrCreateToday();
  assert.ok(record.observations.includes("Noticed a pattern in the conversation"), "appendToday must add to the field");
  DailyRecord.reset();
});

test("DailyRecord: getRecent returns up to N records", async () => {
  const { default: DailyRecord } = await import("../src/core/identity/DailyRecord.ts");
  DailyRecord.reset();
  const daily = DailyRecord.getInstance();
  daily.getOrCreateToday(); // ensure at least today exists
  const recent = daily.getRecent(7);
  assert.ok(recent.length <= 7, "getRecent must return at most 7 records");
  DailyRecord.reset();
});

test("DailyRecord: empty day is valid — no fabrication (source check)", () => {
  const code = src("src/core/identity/DailyRecord.ts");
  // The empty record factory must NOT populate any arrays with default content
  const emptyFnIdx = code.indexOf("function emptyRecord(");
  const emptyFnBody = code.slice(emptyFnIdx, emptyFnIdx + 800);
  // All string arrays should be initialized as [] (empty)
  const hardcodedStrings = emptyFnBody.match(/"[a-zA-Z][a-zA-Z0-9 ]+"/g) ?? [];
  // Only the date field assignment is allowed (a YYYY-MM-DD string arg)
  // No pre-filled content strings
  const nonDateStrings = hardcodedStrings.filter((s) => !s.match(/^\"\d{4}-\d{2}-\d{2}\"$/));
  assert.ok(
    nonDateStrings.length === 0,
    `emptyRecord must not fabricate content. Found non-date strings: ${nonDateStrings.join(", ")}`,
  );
});

// ---- DAILY REFLECTION ----

test("DailyReflection: reflectOnDay detects curiosity pattern in observations", async () => {
  const { reflectOnDay } = await import("../src/core/identity/DailyReflection.ts");
  const record = {
    date: "2026-10-23",
    experiences: [],
    meaningfulInteractions: [],
    observations: ["I was curious about the connection between synthesis and exploration"],
    preferencesObserved: [],
    selfReflection: [],
    lessons: [],
    emergingTraits: [],
    traitChanges: [],
    questions: [],
    relationshipObservations: [],
    creativeIdeas: [],
    tomorrowFocus: [],
    generatedAt: Date.now(),
  };
  const result = reflectOnDay(record);
  const curiosityChange = result.candidateTraitChanges.find((c) => c.traitId === "curiosity");
  assert.ok(curiosityChange && !curiosityChange.isContrarian, "curiosity keyword must be detected as supporting evidence");
});

test("DailyReflection: reflectOnDay detects synthesis pattern", async () => {
  const { reflectOnDay } = await import("../src/core/identity/DailyReflection.ts");
  const record = {
    date: "2026-10-23",
    experiences: ["synthesized several ideas from different domains"],
    meaningfulInteractions: [],
    observations: [],
    preferencesObserved: [],
    selfReflection: [],
    lessons: [],
    emergingTraits: [],
    traitChanges: [],
    questions: [],
    relationshipObservations: [],
    creativeIdeas: [],
    tomorrowFocus: [],
    generatedAt: Date.now(),
  };
  const result = reflectOnDay(record);
  const synthesisChange = result.candidateTraitChanges.find((c) => c.traitId === "synthesis");
  assert.ok(synthesisChange && !synthesisChange.isContrarian, "synthesis keyword must be detected");
});

test("DailyReflection: no fabrication — empty record produces no candidate changes", async () => {
  const { reflectOnDay } = await import("../src/core/identity/DailyReflection.ts");
  const emptyRecord = {
    date: "2026-10-23",
    experiences: [],
    meaningfulInteractions: [],
    observations: [],
    preferencesObserved: [],
    selfReflection: [],
    lessons: [],
    emergingTraits: [],
    traitChanges: [],
    questions: [],
    relationshipObservations: [],
    creativeIdeas: [],
    tomorrowFocus: [],
    generatedAt: Date.now(),
  };
  const result = reflectOnDay(emptyRecord);
  assert.strictEqual(result.candidateTraitChanges.length, 0, "Empty record must produce no candidate trait changes");
});

// ---- MEMORY PROVIDER ----

test("PersonalityMemoryProvider: implements MemoryProvider interface (source check)", () => {
  const code = src("src/core/identity/PersonalityMemoryProvider.ts");
  assert.ok(code.includes("implements MemoryProvider"), "must declare implements MemoryProvider");
  assert.ok(code.includes("readonly id = \"personality\""), "must have id = \"personality\"");
  assert.ok(code.includes("isAvailable()"), "must implement isAvailable()");
  assert.ok(code.includes("async context("), "must implement context()");
  assert.ok(code.includes("async persist("), "must implement persist()");
});

test("PersonalityMemoryProvider: context() returns ContextItem with band 4", async () => {
  const { default: PersonalityMemoryProvider } = await import("../src/core/identity/PersonalityMemoryProvider.ts");
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity.ts");
  LeluIdentity.reset();
  const provider = new PersonalityMemoryProvider();
  const items = await provider.context("What are your thoughts?", 5);
  assert.ok(Array.isArray(items), "context() must return an array");
  if (items.length > 0) {
    assert.strictEqual(items[0].band, 4, "context items must be at band 4");
  }
  LeluIdentity.reset();
});

test("PersonalityMemoryProvider: persist() is defined and does not throw", async () => {
  const { default: PersonalityMemoryProvider } = await import("../src/core/identity/PersonalityMemoryProvider.ts");
  const provider = new PersonalityMemoryProvider();
  await assert.doesNotReject(
    () => provider.persist({ prompt: "test", response: "curious about the connection" }),
    "persist() must not throw",
  );
});

// ---- INTEGRATION / NO SECOND BRAIN ----

test("integration: PersonalityMemoryProvider registered in MemoryBridge (source check)", () => {
  const code = src("src/core/MemoryBridge.ts");
  assert.ok(code.includes("PersonalityMemoryProvider"), "MemoryBridge must import PersonalityMemoryProvider");
  assert.ok(code.includes("new PersonalityMemoryProvider()"), "MemoryBridge must register an instance");
});

test("integration: 'identity' in GenesisPanel type (source check)", () => {
  const code = src("src/app/scene/genesis/GenesisCore.tsx");
  assert.ok(
    code.includes("| \"identity\""),
    "GenesisPanel must include 'identity' type",
  );
});

test("integration: GenesisIdentityPanel imported in GenesisInterface (source check)", () => {
  const code = src("src/app/scene/genesis/GenesisInterface.tsx");
  assert.ok(code.includes("GenesisIdentityPanel"), "GenesisInterface must import GenesisIdentityPanel");
  assert.ok(code.includes("identity:"), "GenesisInterface MODULE_RENDERERS must include identity key");
});

test("no second brain: identity files must not import AI systems", () => {
  const identityFiles = [
    "src/core/identity/LeluIdentity.ts",
    "src/core/identity/DailyRecord.ts",
    "src/core/identity/DailyReflection.ts",
    "src/core/identity/PersonalityMemoryProvider.ts",
  ];
  const forbidden = ["Brain", "AIService", "AIRuntime", "Orchestrator", "AICore", "AIRouter"];
  for (const file of identityFiles) {
    const code = src(file);
    for (const banned of forbidden) {
      assert.ok(
        !code.includes(`from "../${banned}`) && !code.includes(`from "./${banned}`) && !code.includes(`import ${banned}`),
        `${file} must not import ${banned}`,
      );
    }
  }
});

test("no second brain: DailyReflection does not make LLM calls (source check)", () => {
  const code = src("src/core/identity/DailyReflection.ts");
  assert.ok(!code.includes("AIService"), "DailyReflection must not import AIService");
  assert.ok(!code.includes("Anthropic"), "DailyReflection must not use Anthropic directly");
  assert.ok(!code.includes("fetch("), "DailyReflection must not make fetch calls");
});

test("no second brain: personality context in CognitiveContext is guarded by try/catch", () => {
  const code = src("src/core/cognition/CognitiveContext.ts");
  assert.ok(code.includes("LeluIdentity"), "CognitiveContext must import LeluIdentity");
  assert.ok(code.includes("LÉLU PERSONALITY"), "CognitiveContext must include LÉLU PERSONALITY section");
  // Verify the personality block is protected: the file must contain "} catch {" or "} catch (error)"
  // after the personality section (meaning the try/catch wraps it)
  const personalityIdx = code.indexOf("LÉLU PERSONALITY");
  const afterPersonality = code.slice(personalityIdx, personalityIdx + 300);
  assert.ok(
    afterPersonality.includes("} catch {") || afterPersonality.includes("} catch("),
    "LÉLU PERSONALITY section must be followed by a catch block (guarded by try/catch)",
  );
});
