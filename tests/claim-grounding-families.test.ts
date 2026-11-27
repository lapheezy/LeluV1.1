/**
 * ==========================================================
 * LÉLU — CLAIM GROUNDING ACROSS EVERY OPERATIONAL FAMILY
 *
 * CATEGORY: unit, over the real rule table.
 *
 * Mission 44.6 proved one family (the laboratory) could ship a two-turn
 * stale answer as a fresh check. Mission 44.7 asks the same question of
 * every family the registry exposes — repository/GitHub, laboratory,
 * engineering studio, runtime, provider health, voice, workspace, memory,
 * browser/research, agents, build/lint/test, deployment, files — and of
 * the five evidence classes a reply can rest on:
 *
 *   current-turn · earlier-turn · memory · inference · unverified
 *
 * The last test in this file would have caught the 44.6 defect directly:
 * that rule named lab_status, lab_tree, lab_journal, lab_cycle and
 * lab_execute, and no module declares any of them.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CLAIM_FAMILIES,
  claimEvidenceCounts,
  freshnessCorrection,
  groundingNote,
  ungroundedClaims,
} from "../src/core/tools/ClaimGrounding";

/** One representative sentence per family, with the tool that backs it. */
const FAMILIES: Array<{ family: string; reply: string; tool: string }> = [
  { family: "typecheck", reply: "The type-check passed with exit code 0.", tool: "project_validate" },
  { family: "build", reply: "Build finished with no errors.", tool: "workspace_build" },
  { family: "tests", reply: "Tests: 24/24 passed.", tool: "workspace_test" },
  { family: "lint", reply: "Lint is clean, no warnings.", tool: "project_validate" },
  { family: "preview", reply: "The preview is running at http://localhost:3001.", tool: "project_preview" },
  { family: "diff", reply: "The diff shows one changed line.", tool: "project_diff" },
  { family: "capture", reply: "The layout report shows no problems.", tool: "browser_capture" },
  { family: "apply", reply: "I applied the change to the real project.", tool: "project_apply" },
  { family: "commit", reply: "I committed the fix.", tool: "project_commit" },
  { family: "laboratory", reply: "From the laboratory repository tool result just returned: the branch is main.", tool: "lab_repository" },
  { family: "github", reply: "I pushed the branch to origin.", tool: "github_branches" },
  { family: "runtime", reply: "The dev server is running on port 3001.", tool: "project_preview" },
  { family: "provider-health", reply: "All providers are healthy.", tool: "system_config" },
  { family: "voice", reply: "I transcribed your recording.", tool: "device_microphone" },
  { family: "workspace", reply: "I restored the workspace.", tool: "environment_restore_state" },
  { family: "memory", reply: "I saved that to my memory.", tool: "memory_store" },
  { family: "research", reply: "The page says the release is out.", tool: "browser_read" },
  { family: "agents", reply: "The agent finished the task.", tool: "agent_status" },
  { family: "deployment", reply: "I deployed the app.", tool: "studio_deploy" },
  { family: "files", reply: "I edited the file.", tool: "project_edit" },
];

for (const entry of FAMILIES) {
  test(`${entry.family}: an unbacked claim is flagged, the same claim with its tool is not`, () => {
    const flagged = ungroundedClaims(entry.reply, []);
    assert.equal(flagged.length, 1, `one claim for "${entry.reply}" — got ${JSON.stringify(flagged.map((c) => c.label))}`);
    assert.equal(flagged[0].family, entry.family);
    assert.equal(flagged[0].evidence, "unverified");
    // The same sentence, with the tool really run this turn, is grounded.
    assert.deepEqual(
      ungroundedClaims(entry.reply, [{ tool: entry.tool, ok: true }]),
      [],
      `${entry.tool} backs it`,
    );
    // A FAILED run does not back a success claim.
    assert.equal(ungroundedClaims(entry.reply, [{ tool: entry.tool, ok: false }]).length, 1);
  });
}

test("the rule table covers every family this mission names", () => {
  const covered = new Set(CLAIM_FAMILIES.map((entry) => entry.family));
  for (const entry of FAMILIES) assert.ok(covered.has(entry.family), `${entry.family} is represented`);
});

/* ------------------------------ evidence classes ------------------------------ */

test("current-turn evidence: nothing is reported when the tool ran this turn", () => {
  const claims = ungroundedClaims("The build finished clean at exit 0.", [{ tool: "workspace_build", ok: true }]);
  assert.deepEqual(claims, []);
  assert.equal(groundingNote(claims), "");
});

test("earlier-turn evidence: real history is not called invented, and is not called fresh", () => {
  const now = Date.now();
  const claims = ungroundedClaims("The build finished clean.", [], [{ tool: "workspace_build", at: now - 180_000 }]);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].evidence, "earlier-turn");
  const note = groundingNote(claims);
  assert.match(note, /⚠️ History, not a fresh check/);
  assert.match(note, /supported by an earlier studio_build \/ workspace_build result in this conversation/);
  assert.doesNotMatch(note, /Not verified/, "a real earlier result is not 'unverified'");

  // ...but "just returned" about that same earlier result is still wrong.
  const fresh = ungroundedClaims("The build passed just now.", [], [{ tool: "workspace_build", at: now - 180_000 }]);
  const correction = freshnessCorrection(fresh, { now, earlierRuns: [{ tool: "workspace_build", at: now - 180_000 }] });
  assert.match(correction, /^⚠️ Nothing was checked in this turn/);
  assert.match(correction, /last real result in this conversation is about 3 minutes ago/);
});

test("persisted memory: a sentence that says it is from memory is not an unverified claim", () => {
  const claims = ungroundedClaims("From memory, the build passed last week.", []);
  assert.equal(claims.length, 1, "the claim is recognised");
  assert.equal(claims[0].evidence, "memory");
  assert.equal(groundingNote(claims), "", "memory is a declared source, not an accusation");
  assert.deepEqual(claimEvidenceCounts(claims), { memory: 1 });
});

test("inference: a hedged sentence is classified as inference, not as a measurement", () => {
  const claims = ungroundedClaims("I think the build passed, but I did not run it this turn.", []);
  // The second clause is a negation on the SAME line, so the conservative
  // filter drops it entirely — which is the safe direction.
  assert.deepEqual(claims, []);
  const hedged = ungroundedClaims("It looks like the build passed.", []);
  assert.equal(hedged.length, 1);
  assert.equal(hedged[0].evidence, "inference");
  assert.equal(groundingNote(hedged), "", "her own hedge stands; it is not presented as measured");
  assert.deepEqual(claimEvidenceCounts(hedged), { inference: 1 });
});

test("unverified: the only class that carries the 'not verified' note, and it keeps the wording", () => {
  const claims = ungroundedClaims("The type-check passed (exit 0).", []);
  assert.equal(claims[0].evidence, "unverified");
  assert.match(groundingNote(claims).trim(), /^⚠️ Not verified: this reply describes the type-check result, but project_validate \/ workspace_typecheck did not run successfully in this turn\./);
  assert.deepEqual(claimEvidenceCounts(claims), { unverified: 1 });
});

test("a reply can carry several classes at once, and each is labelled as itself", () => {
  const reply =
    "The type-check passed (exit 0).\n" +
    "The build finished clean.\n" +
    "From memory, the tests passed yesterday.";
  const claims = ungroundedClaims(reply, [], [{ tool: "workspace_build" }]);
  assert.deepEqual(claimEvidenceCounts(claims), { unverified: 1, "earlier-turn": 1, memory: 1 });
  const note = groundingNote(claims);
  assert.match(note, /Not verified: this reply describes the type-check result/);
  assert.match(note, /History, not a fresh check: this reply describes the build result/);
  assert.doesNotMatch(note, /tests passed yesterday/, "declared memory is not in the accusation");
});

test("negated, hypothetical and forwarded content stays out of every class", () => {
  const honest = [
    "I did not run the build this turn, so I cannot say it passed.",
    "I would have checked the providers, but the request was cancelled.",
    "The page you sent says the release is out.",
    "Next step: run the tests.",
  ];
  for (const line of honest) assert.deepEqual(ungroundedClaims(line, []), [], `not a claim: ${line}`);
});

/* --------------------------- tool names must be real --------------------------- */

function declaredToolIds(directory: string, found = new Set<string>()): Set<string> {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      declaredToolIds(path, found);
      continue;
    }
    if (!name.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\bid:\s*"([a-z][a-zA-Z0-9_.]*)"/g)) found.add(match[1]);
  }
  return found;
}

test("no rule names a tool the source does not declare (Mission 44.6 shipped five phantom names)", () => {
  const declared = declaredToolIds("src");
  const modelNames = new Set([...declared].map((id) => id.replace(/\./g, "_")));
  const missing: string[] = [];
  for (const entry of CLAIM_FAMILIES) {
    for (const tool of entry.tools) {
      if (declared.has(tool) || modelNames.has(tool)) continue;
      missing.push(`${entry.family}: ${tool}`);
    }
  }
  assert.deepEqual(missing, [], `rules must name real tools — missing: ${missing.join(", ")}`);
  // The exact names the 44.6 rule invented are still absent from the source.
  for (const phantom of ["lab_status", "lab_tree", "lab_journal", "lab_cycle", "lab_execute"]) {
    assert.equal(declared.has(phantom) || modelNames.has(phantom), false, `${phantom} does not exist`);
    assert.equal(
      CLAIM_FAMILIES.some((entry) => entry.tools.includes(phantom)),
      false,
      `${phantom} is not used by a rule`,
    );
  }
});
