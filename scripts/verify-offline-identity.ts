/**
 * Offline identity verification — pure-logic tests for the parts
 * of the LÉLU memory/identity pipeline that run without a browser:
 *   - identity/profile question classification
 *   - identity seed idempotence
 *   - MemoryExtractor identity extraction keywords
 *
 * Run: bun run scripts/verify-offline-identity.ts
 */

import {
  LELU_IDENTITY_ID,
  LELU_IDENTITY_STATEMENT,
  isIdentityOrProfileQuestion,
  isLeluIdentityQuestion,
  isUserProfileQuestion,
  seedLeluIdentity,
} from "../src/brain/LeluIdentity";
import MemoryExtractor from "../src/brain/MemoryExtractor";

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log("== LÉLU identity question classification ==");

// Statements must NOT classify as questions.
assert(
  !isLeluIdentityQuestion("My name is Alex."),
  "statement 'My name is Alex.' is not an identity question",
);
assert(
  !isUserProfileQuestion("My name is Alex."),
  "statement 'My name is Alex.' is not a profile question",
);
assert(
  !isIdentityOrProfileQuestion("Build me a todo app"),
  "'Build me a todo app' is not identity-related",
);

// Lélu identity questions.
for (const q of [
  "Who are you?",
  "What are you?",
  "What's your name?",
  "Who made you?",
  "Who created you?",
  "What can you do?",
  "Tell me about yourself",
]) {
  assert(isLeluIdentityQuestion(q), `LÉLU identity: "${q}"`);
  assert(isIdentityOrProfileQuestion(q), `combined: "${q}"`);
}

// User profile questions.
for (const q of [
  "Who am I?",
  "Who am i?",
  "What do you know about me?",
  "What do you remember about me?",
  "Tell me about myself",
  "What is my name?",
  "What's my name?",
  "Do you remember me?",
]) {
  assert(isUserProfileQuestion(q), `user profile: "${q}"`);
  assert(isIdentityOrProfileQuestion(q), `combined: "${q}"`);
}

// Separation: identity vs profile must not bleed into each other.
assert(!isUserProfileQuestion("Who are you?"), "'Who are you?' is not a profile question");
assert(!isLeluIdentityQuestion("Who am I?"), "'Who am I?' is not a LÉLU identity question");

console.log("== Identity seed ==");

// The seed builds a valid persistent ResponsePattern with the
// stable id and offline-safe keywords.
let seeded: Record<string, unknown> | null = null;
const fakeMemory = {
  get(id: string) {
    return seeded && seeded.id === id ? seeded : null;
  },
  async add(pattern: unknown) {
    seeded = pattern as Record<string, unknown>;
  },
};

await seedLeluIdentity(fakeMemory as never);
assert(seeded !== null, "seed writes a pattern");
assert(seeded!.id === LELU_IDENTITY_ID, "seed uses the stable id");
assert((seeded!.keywords as string[]).includes("who"), "identity keywords match 'who are you'");
assert((seeded!.keywords as string[]).includes("lelu"), "identity keywords include 'lelu'");
assert((seeded!.response as string) === LELU_IDENTITY_STATEMENT, "identity statement stored verbatim");
assert(seeded!.importance === 1 && seeded!.confidence === 1, "identity is high confidence/importance");

// Idempotence: second seed must not overwrite an existing record.
const before = seeded;
await seedLeluIdentity(fakeMemory as never);
assert(seeded === before, "seed is idempotent (does not clobber existing identity)");

console.log("== MemoryExtractor user-identity keywords ==");

const extractor = new MemoryExtractor();
const extracted = extractor.extract("My name is Alex and I love coffee", "Got it.");
const identityMemory = extracted.find((m) => m.category === "identity");
assert(Boolean(identityMemory), "extracts a user identity memory");
assert(
  Boolean(identityMemory?.keywords.includes("name")),
  "user identity keywords include 'name'",
);
assert(
  Boolean(identityMemory?.keywords.includes("call")),
  "user identity keywords include 'call'",
);
assert(
  extracted.some((m) => m.category === "preference"),
  "extracts a preference memory from the same message",
);

console.log("\n" + (failures === 0 ? "ALL OFFLINE IDENTITY CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
