/**
 * M16.3 WP04 — referent continuity and operation verification.
 *
 * The live failure WP03 reported was "the next turn cannot see the object the
 * last turn selected". These tests pin the two properties that fix it:
 *
 *   1. a referent is derived from the conversation, newest mention first,
 *      validated against the canonical store — never guessed, never global;
 *   2. a completed operation is judged against what was asked for, and the
 *      verdict distinguishes a store change, a wrong value and a persistence
 *      failure.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { compileCreativeObjectPlan } from "../src/core/couture/intents";
import { referentFromConversation, resolveCreativeReferent, isImplicitReference } from "../src/core/couture/continuity";
import { verifyCreativeOperation, type OperationSnapshot } from "../src/core/couture/verification";

/** The smallest store stand-in the continuity module actually uses. */
const fakeStore = (objects: Array<{ id: string; name: string; archived?: boolean; visible?: boolean }>) =>
  ({
    get: (id: string) => {
      const found = objects.find((object) => object.id === id);
      return found ? { ...found, archived: Boolean(found.archived) } : null;
    },
  }) as never;

const snapshot = (over: Partial<OperationSnapshot> = {}): OperationSnapshot => ({
  id: "obj-product-1",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  revision: 1,
  ...over,
});

test("the newest valid mention in the conversation is the referent", () => {
  const store = fakeStore([
    { id: "obj-product-1", name: "Oak side chair" },
    { id: "obj-jewelry-2", name: "Copper pendant" },
  ]);
  const referent = referentFromConversation(
    [
      { role: "user", content: "select the chair" },
      { role: "assistant", content: "Selected Oak side chair (obj-product-1)." },
      { role: "user", content: "now the pendant" },
      { role: "assistant", content: "Found Copper pendant (obj-jewelry-2)." },
    ],
    store,
  );
  assert.equal(referent?.object.id, "obj-jewelry-2", "the later mention wins");
  assert.equal(referent?.source, "conversation");
});

test("a stale id in the conversation is skipped, not acted on", () => {
  const store = fakeStore([{ id: "obj-product-1", name: "Oak side chair" }]);
  const referent = referentFromConversation(
    [
      { role: "assistant", content: "Selected Oak side chair (obj-product-1)." },
      { role: "assistant", content: "Deleted Oak side chair (obj-garment-9)." },
    ],
    store,
  );
  assert.equal(referent?.object.id, "obj-product-1", "the deleted id no longer resolves, so the live one is used");
});

test("an archived object is not a referent", () => {
  const store = fakeStore([{ id: "obj-product-1", name: "Oak side chair", archived: true }]);
  assert.equal(referentFromConversation([{ role: "assistant", content: "obj-product-1" }], store), null);
});

test("two conversations do not share a referent", () => {
  const store = fakeStore([{ id: "obj-product-1", name: "Oak side chair" }]);
  const chatA = [{ role: "assistant", content: "Selected Oak side chair (obj-product-1)." }];
  const chatB = [{ role: "user", content: "hello" }];
  assert.equal(resolveCreativeReferent({ messages: chatA, store })?.object.id, "obj-product-1");
  assert.equal(resolveCreativeReferent({ messages: chatB, store }), null, "chat B has no referent of its own");
});

test("an empty conversation invents nothing", () => {
  const store = fakeStore([{ id: "obj-product-1", name: "Oak side chair" }]);
  assert.equal(resolveCreativeReferent({ messages: [], store }), null);
});

test("implicit references are recognised as implicit", () => {
  for (const phrase of ["it", "that", "the same object", "the selected object", "the one you just moved"]) {
    assert.equal(isImplicitReference(phrase), true, phrase);
  }
  assert.equal(isImplicitReference("the chair"), false);
});

test("the instruction compiles against the conversation's referent", () => {
  const store = fakeStore([{ id: "obj-product-1", name: "Oak side chair" }]);
  const referent = resolveCreativeReferent({
    messages: [{ role: "assistant", content: "Selected Oak side chair (obj-product-1)." }],
    store,
  });
  const plan = compileCreativeObjectPlan("rotate it 90 degrees", { selectedId: referent?.object.id ?? null });
  assert.deepEqual(plan?.steps[0].args, { action: "rotate", object: "obj-product-1", rotation: [0, 0, 90] });
});

test("with no referent the tool is asked to refuse, not to guess", () => {
  const plan = compileCreativeObjectPlan("rotate it 90 degrees", { selectedId: null });
  assert.equal(plan?.steps[0].args.object, "it", "the tool receives 'it' and answers with the object list");
});

test("a rotation that landed is VERIFIED, and untouched fields are checked", () => {
  const result = verifyCreativeOperation(
    { action: "rotate", objectId: "obj-product-1", expect: { rotation: [0, 0, 90] }, preserve: ["position", "scale"] },
    snapshot({ revision: 4 }),
    snapshot({ revision: 5, rotation: [0, 0, 90] }),
    true,
  );
  assert.equal(result.status, "VERIFIED");
});

test("a rotation that did not change the object is FAILED, not 'done'", () => {
  const result = verifyCreativeOperation(
    { action: "rotate", objectId: "obj-product-1", expect: { rotation: [0, 0, 90] } },
    snapshot({ revision: 4 }),
    snapshot({ revision: 4 }),
    true,
  );
  assert.equal(result.status, "FAILED");
});

test("a rotation that also moved the object is PARTIAL", () => {
  const result = verifyCreativeOperation(
    { action: "rotate", objectId: "obj-product-1", expect: { rotation: [0, 0, 90] }, preserve: ["position"] },
    snapshot({ revision: 4, position: [10, 0, 0] }),
    snapshot({ revision: 5, rotation: [0, 0, 90], position: [40, 0, 0] }),
    true,
  );
  assert.equal(result.status, "PARTIAL");
  assert.match(result.note ?? "", /position was left alone/);
});

test("an unpersisted change is never VERIFIED", () => {
  const result = verifyCreativeOperation(
    { action: "scale", objectId: "obj-product-1", expect: { scale: [2, 2, 2] } },
    snapshot({ revision: 4 }),
    snapshot({ revision: 5, scale: [2, 2, 2] }),
    false,
  );
  assert.notEqual(result.status, "VERIFIED");
  assert.ok(result.checks.some((check) => check.name === "persisted" && !check.ok));
});

test("selection must not mutate anything", () => {
  const result = verifyCreativeOperation(
    { action: "select", objectId: "obj-product-1", mutates: false },
    snapshot({ revision: 4 }),
    snapshot({ revision: 4 }),
    true,
  );
  assert.equal(result.status, "VERIFIED");
});

test("the wrong object being touched is FAILED", () => {
  const result = verifyCreativeOperation(
    { action: "move", objectId: "obj-product-1" },
    snapshot({ revision: 4 }),
    snapshot({ id: "obj-jewelry-2", revision: 5 }),
    true,
  );
  assert.equal(result.status, "FAILED");
});
