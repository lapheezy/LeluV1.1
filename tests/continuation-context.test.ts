/**
 * Tool-loop continuation rounds do not re-send LÉLU's self-description;
 * everything the next step or the answer may depend on is kept.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { continuationContext } from "../src/core/router/continuationContext";

const FULL = [
  "## LÉLU EXECUTIVE SELF STATE (measured, authoritative)\nMode: working\nTask: build a tower",
  "## LÉLU SELF STATE\nName: LÉLU\n" + "x".repeat(1300),
  "## CAPABILITY STATUS\nAvailable: chat" + "y".repeat(600),
  "## ACTIONS REQUIRING CONFIRMATION\n- Acquire Repository Capability (risk 2) — ask before",
  "## LÉLU AUTONOMOUS COGNITION (self-study, already running)\n" + "z".repeat(2000),
  "## AUTONOMY LEVEL: 3",
  "## LIVE RETRIEVAL RESULTS — fetched just now\n- Canberra is the capital",
  "## Current Thread\nTopic: crystal tower",
  "## Agents\n- Designer",
].join("\n");

test("a continuation round drops the self-description and keeps what the work depends on", () => {
  const out = continuationContext(`Memory context:\n${FULL}`)!;
  for (const kept of ["EXECUTIVE SELF STATE", "ACTIONS REQUIRING CONFIRMATION", "AUTONOMY LEVEL", "LIVE RETRIEVAL RESULTS", "Current Thread"]) {
    assert.match(out, new RegExp(kept), `${kept} must be kept`);
  }
  for (const dropped of ["## LÉLU SELF STATE", "## CAPABILITY STATUS", "AUTONOMOUS COGNITION", "## Agents"]) {
    assert.doesNotMatch(out, new RegExp(dropped), `${dropped} is self-description`);
  }
  assert.ok(out.length < FULL.length * 0.4, `${out.length} vs ${FULL.length}`);
});

test("contexts without sections, or with nothing to drop, are returned unchanged", () => {
  assert.equal(continuationContext(undefined), undefined);
  assert.equal(continuationContext("plain"), "plain");
  const research = "## LIVE RETRIEVAL RESULTS\n- one\n## SPENDING\nnone";
  assert.equal(continuationContext(`a\n${research}`), `a\n${research}`);
});
