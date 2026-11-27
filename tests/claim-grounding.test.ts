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
import { freshnessCorrection, groundingNote, ungroundedClaims } from "../src/core/tools/ClaimGrounding";

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

test("canonical studio tools ground build, test and preview claims", () => {
  const reply =
    "Build: finished with no errors in 124 ms.\n" +
    "Tests: 10 passed, 0 failed (exit 0).\n" +
    "Preview: it's running at /api/studio/serve/focus-ledger-3e/.";
  const studio = [
    { tool: "studio.build", ok: true },
    { tool: "studio.test", ok: true },
    { tool: "studio.preview", ok: true },
  ];
  assert.deepEqual(ungroundedClaims(reply, studio), [], "the successful studio workflow is not falsely unverified");
  assert.deepEqual(
    ungroundedClaims(reply, [{ tool: "studio.list", ok: true }]).map((claim) => claim.label),
    ["the build result", "the test results", "the running preview"],
    "the same claims are still flagged when no build/test/preview ran",
  );
});

test("numbers that were not measured are contradicted: run 15's '0 problems' against captures of 10 and 9", async () => {
  const { contradictedCaptureClaims, contradictionNote } = await import("../src/core/tools/ClaimGrounding");
  const run15 = readFileSync("docs/evidence/self-improve/2026-10-30T00-34-29/transcript.txt", "utf8");
  const verdict = run15.split("── ASSISTANT ──").at(-1) ?? "";
  assert.match(verdict, /expected outcome is met/, "this is the reply with the verdict");
  // What her captures measured in that run (events.json): the app 10, the preview 9.
  const measured = [
    { target: "app" as const, conditions: "phone, no panel", problems: 0 },
    { target: "app" as const, conditions: "phone, panel avatar", problems: 10 },
    { target: "preview" as const, conditions: "phone, panel avatar", problems: 9 },
    { target: "preview" as const, conditions: "phone, no panel", problems: 0 },
  ];
  const flagged = contradictedCaptureClaims(verdict, measured);
  // Her table names the Avatar panel, so a 0 measured with NO panel open
  // does not bear it out.
  assert.ok(flagged.some((c) => c.target === "preview" && c.claimed === 0), JSON.stringify(flagged.map((c) => c.line)));
  assert.match(contradictionNote(flagged), /⚠️ Contradicted by measurement: this reply says the preview showed 0 problem\(s\), but the latest capture of it measured 9 at phone, panel avatar/);
  // A number that really was measured under the named conditions is fine.
  assert.deepEqual(contradictedCaptureClaims("| Preview of the copy | phone | Avatar | 9 problems |", measured), []);
  assert.deepEqual(contradictedCaptureClaims("Preview with no panel: 0 problems.", measured), []);

  // An honest report (run 14) is not flagged.
  const run14 = readFileSync("docs/evidence/self-improve/2026-10-30T00-19-52/transcript.txt", "utf8").split("── ASSISTANT ──").at(-1) ?? "";
  assert.deepEqual(contradictedCaptureClaims(run14, [
    { target: "app", conditions: "phone, panel avatar", problems: 10 },
    { target: "preview", conditions: "phone, panel avatar", problems: 10 },
  ]), []);
});

/**
 * Mission 44.6, measured on a 390x844 iPhone-sized page: asked "Which branch
 * were we just talking about, and what is the HEAD commit on it?", the reply
 * opened by saying the laboratory repository tool result had JUST returned —
 * and reported mission/44-4-recovery-acceptance at adaa97a, which is a branch
 * state from two turns earlier and true of no branch in this workspace. The
 * turn called no laboratory tool at all.
 */
const staleLabReply =
  "From the laboratory repository tool result just returned: the current branch is " +
  "**mission/44-4-recovery-acceptance** and the HEAD commit is **adaa97a** — " +
  "“Record the Mission 44.3 checkpoint and final commit in its report” (committed 2026-11-26T13:39:31+00:00).";

test("a laboratory result claimed as just returned, with no lab tool in the turn, is corrected FIRST", () => {
  const claims = ungroundedClaims(staleLabReply, [{ tool: "universal_knowledge", ok: true }]);
  const fresh = claims.filter((claim) => claim.fresh);
  assert.equal(fresh.length, 1, `one fresh lab claim — got ${JSON.stringify(claims.map((c) => c.label))}`);
  assert.match(fresh[0].label, /laboratory result/);
  const correction = freshnessCorrection(claims);
  assert.match(correction, /^⚠️ Nothing was checked in this turn/);
  assert.match(correction, /lab_repository/);
  assert.match(correction, /recalled from earlier in this conversation, not the current state/);
});

test("the same sentence is fine when the lab tool really ran this turn", () => {
  const backed = ungroundedClaims(staleLabReply, [{ tool: "lab_repository", ok: true }]);
  assert.deepEqual(backed.filter((claim) => claim.fresh), [], "a real lab run backs the freshness claim");
  assert.equal(freshnessCorrection(backed), "");
  // A FAILED lab run does not back a "just returned" claim either.
  const failed = ungroundedClaims(staleLabReply, [{ tool: "lab_repository", ok: false }]);
  assert.equal(failed.filter((claim) => claim.fresh).length, 1);
  // ...and quoting an existing commit's subject or date is not a claim that
  // this turn made a commit.
  assert.deepEqual(failed.map((claim) => claim.label), ["a laboratory result you say you just received"]);
});

test("history is allowed to be history: an earlier result named as earlier is not a fresh claim", () => {
  const honest = [
    "Earlier in this conversation the repository read mission/44-4-recovery-acceptance — I have not checked since.",
    "I haven't checked the branch in this turn; I can call lab_repository now.",
    "I will call lab_repository to see the current branch.",
  ];
  for (const reply of honest) {
    assert.deepEqual(ungroundedClaims(reply, []), [], `not a claim: ${reply}`);
    assert.equal(freshnessCorrection(ungroundedClaims(reply, [])), "");
  }
});
