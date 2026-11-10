/**
 * CATEGORY: unit.
 *
 * The browser session runtime (plugins/browserSessionsApi.ts) drives a
 * real Chromium, which this container cannot start (missing system
 * libraries, no root). What can be proven here is the part that decides
 * what the runtime is allowed to do and what it writes down:
 *
 *   - session names can never escape the evidence directory,
 *   - consequential clicks are refused without confirmation,
 *   - evidence steps are ordered and named safely,
 *   - and unavailability is reported honestly, with no simulated page.
 *
 * The live actions themselves are exercised against a real browser by
 * scripts/verify-browser-sessions.mjs on a host that has one; this file
 * never fakes a page to make a test pass.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  browserSessionsAvailable,
  closeAllBrowserSessions,
  evidenceStepFile,
  isConsequentialAction,
  safeSessionName,
} from "../plugins/browserSessionsApi";

test("a session name cannot traverse out of the evidence directory", () => {
  for (const raw of ["../../etc/passwd", "..\\..\\windows", "a/b/c", "...", "../../"]) {
    let name: string;
    try {
      name = safeSessionName(raw);
    } catch {
      // A name made only of path punctuation is refused outright, which is
      // also safe: there is nothing to write outside the evidence root.
      continue;
    }
    assert.ok(!name.includes("/"), `"${raw}" produced a path separator: ${name}`);
    assert.ok(!name.includes("\\"), `"${raw}" produced a backslash: ${name}`);
    assert.ok(!name.includes(".."), `"${raw}" kept a parent reference: ${name}`);
    assert.match(name, /^[a-z0-9_-]+$/);
  }
});

test("a session name is required", () => {
  assert.throws(() => safeSessionName("   "), /needs a name/i);
  assert.throws(() => safeSessionName("///"), /needs a name/i);
});

test("names are normalised, not rejected for ordinary punctuation", () => {
  assert.equal(safeSessionName("Research: Laptops!"), "research-laptops");
  assert.equal(safeSessionName("  Session 1  "), "session-1");
});

test("consequential actions are recognised", () => {
  for (const label of ["Buy now", "button#submit", "Post comment", "Delete account", "Place order", "subscribe", "Follow"]) {
    assert.equal(isConsequentialAction(label), true, `"${label}" should need confirmation`);
  }
});

test("reading and navigation are not consequential", () => {
  for (const label of ["a.more", "Read the article", "button#search", "Next page", "Sign in"]) {
    assert.equal(isConsequentialAction(label), false, `"${label}" should not need confirmation`);
  }
});

test("evidence steps are ordered and safe to write", () => {
  assert.equal(evidenceStepFile(1, "open"), "0001-open.png");
  assert.equal(evidenceStepFile(42, "click"), "0042-click.png");
  const untrusted = evidenceStepFile(7, "../../etc/passwd");
  assert.match(untrusted, /^0007-[a-z-]*etc-passwd\.png$/);
  assert.ok(!untrusted.includes("/"), `evidence file kept a path separator: ${untrusted}`);
  const ordered = [evidenceStepFile(10, "read"), evidenceStepFile(2, "open")].sort();
  assert.deepEqual(ordered, ["0002-open.png", "0010-read.png"]);
});

test("browser availability is reported honestly, either way", async () => {
  try {
    const availability = await browserSessionsAvailable();
    if (availability.ok) {
      assert.match(availability.reason, /Chromium/i);
      return;
    }
    assert.match(availability.reason, /no headless browser could be started/i);
    assert.match(availability.reason, /nothing was opened or simulated/i);
  } finally {
    // Availability starts a real browser when one exists; closing it here
    // is what lets the test process exit instead of waiting on the child.
    await closeAllBrowserSessions();
  }
});
