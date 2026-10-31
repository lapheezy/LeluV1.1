/**
 * LÉLU — EXECUTIVE BOARD STATUS IS TRUTHFUL
 *
 * The board used to report every executive as "active" whether or not
 * it had ever been consulted. Live status must reflect real activity:
 *   - an executive nobody has consulted is "idle"
 *   - consulting it records a count and timestamp and marks it "consulted"
 *   - route() consults exactly the chain it names, nothing else
 *   - the snapshot says consultations are deterministic guidance, so no
 *     consumer can mistake them for an agent doing work
 */

import assert from "node:assert/strict";
import test from "node:test";
import ExecutiveBoard from "../src/core/executive/ExecutiveBoard.ts";

test("a fresh board reports no executive as active", () => {
  ExecutiveBoard.resetForTests();
  const snap = ExecutiveBoard.getInstance().snapshot();
  assert.equal(snap.executives.length, 6);
  for (const e of snap.executives) {
    assert.equal(e.status, "idle", `${e.id} was never consulted but reported "${e.status}"`);
    assert.equal(e.consultations, 0);
    assert.equal(e.lastConsultedAt, null);
  }
});

test("consult() records real activity for that executive only", () => {
  ExecutiveBoard.resetForTests();
  const board = ExecutiveBoard.getInstance();
  const before = Date.now();
  board.consult("caretaker", "plan a calmer morning routine");
  const snap = board.snapshot();
  const caretaker = snap.executives.find((e) => e.id === "caretaker")!;
  assert.equal(caretaker.status, "consulted");
  assert.equal(caretaker.consultations, 1);
  assert.ok(caretaker.lastConsultedAt !== null && caretaker.lastConsultedAt >= before);
  for (const e of snap.executives.filter((x) => x.id !== "caretaker")) {
    assert.equal(e.status, "idle", `${e.id} must stay idle when only caretaker was consulted`);
  }
});

test("route() marks exactly its chain as consulted", () => {
  ExecutiveBoard.resetForTests();
  const board = ExecutiveBoard.getInstance();
  board.route("improve the phone chat layout");
  const byId = Object.fromEntries(board.snapshot().executives.map((e) => [e.id, e]));
  for (const id of ["lelu", "architect", "engineering", "forge", "maat"]) {
    assert.equal(byId[id].status, "consulted", `${id} is in the route chain`);
    assert.equal(byId[id].consultations, 1);
  }
  assert.equal(byId.caretaker.status, "idle", "caretaker is not in the route chain");
});

test("snapshot labels consultations as deterministic guidance, not agent execution", () => {
  ExecutiveBoard.resetForTests();
  const snap = ExecutiveBoard.getInstance().snapshot();
  assert.equal(snap.consultationMode, "deterministic-guidance");
});
