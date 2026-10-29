/**
 * ==========================================================
 * LÉLU — A CLAIMED RESULT MUST HAVE A TOOL BEHIND IT
 *
 * CATEGORY: unit, over REAL replies from the self-improvement acceptance
 * run (docs/evidence/self-improve/2026-10-29T22-34-45/transcript.txt):
 * her second reply claimed a passing type-check, a running preview, a
 * preview capture and a diff — and none of those tools ran.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { groundingNote, ungroundedClaims } from "../src/core/tools/ClaimGrounding";

const transcript = readFileSync("docs/evidence/self-improve/2026-10-29T22-34-45/transcript.txt", "utf8");
const replies = transcript.split("── ASSISTANT ──").slice(1).map((part) => part.split("── USER ──")[0]);

// What really ran in that turn (from the run's events.json): copies,
// searches, reads and edits — no validate, preview, capture or diff.
const ranInTurnTwo = [
  { tool: "project_copy", ok: true },
  { tool: "project_search", ok: true },
  { tool: "project_read", ok: true },
  { tool: "project_edit", ok: true },
  { tool: "project_edit", ok: false },
];

test("the fabricated evidence table is caught: type-check, preview and diff with no tool behind them", () => {
  const fabricated = replies[1];
  assert.match(fabricated, /Passed \(exit\s0\)/, "this is the reply that claimed the type-check");
  const claims = ungroundedClaims(fabricated, ranInTurnTwo).map((claim) => claim.label);
  for (const label of ["the type-check result", "the running preview", "the diff"]) {
    assert.ok(claims.includes(label), `${label} flagged — got ${JSON.stringify(claims)}`);
  }
  assert.match(groundingNote(ungroundedClaims(fabricated, ranInTurnTwo)), /⚠️ Not verified: .* did not run successfully in this turn/);
});

test("her honest report is not accused: 'not reached', 'would have', 'no edit was applied'", () => {
  const honest = replies[0];
  assert.match(honest, /Not reached/);
  assert.deepEqual(ungroundedClaims(honest, [{ tool: "project_copy", ok: true }, { tool: "browser_capture", ok: true }]), []);
});

test("a claim backed by the tool that really ran is not flagged", () => {
  const reply = "| 6 | Ran project_validate (typecheck) | Passed (exit 0) |\nThe diff reports one changed line.";
  assert.deepEqual(ungroundedClaims(reply, [{ tool: "project_validate", ok: true }, { tool: "project_diff", ok: true }]), []);
  assert.equal(ungroundedClaims(reply, [{ tool: "project_validate", ok: false }]).length, 2, "a FAILED run does not back a 'passed' claim");
  assert.equal(groundingNote([]), "");
});
