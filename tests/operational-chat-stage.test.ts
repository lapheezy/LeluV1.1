/**
 * ==========================================================
 * LÉLU — CHAT INTELLIGENCE STAGE (isolated)
 *
 * The router stage is exercised against a stubbed `/api/integration`
 * so its behaviour is provable without a browser. Two properties
 * matter most:
 *
 *   • it answers from the response it received, verbatim;
 *   • when the surface is unreachable it declines the turn instead
 *     of describing a state it never read.
 *
 * This does NOT prove the stage runs inside the live chat turn —
 * that is recorded separately in the acceptance report.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { afterEach, describe } from "node:test";

import IntelligenceResolver from "../src/core/router/IntelligenceResolver.ts";
import type RouterContext from "../src/core/router/RouterContext.ts";

const realFetch = globalThis.fetch;

function context(prompt: string): RouterContext {
  return {
    request: { prompt, timestamp: 1_700_000_000_000 },
    started: Date.now(),
    logger: { info: () => undefined },
  } as unknown as RouterContext;
}

function stub(payloads: Record<string, unknown>, failing = false) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failing) throw new Error("network down");
    const key = Object.keys(payloads).find((candidate) => url.includes(candidate));
    if (!key) throw new Error(`unexpected request: ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => payloads[key],
    } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("chat stage answers from the real surface", () => {
  test("an explanation is reproduced with its requirement states", async () => {
    stub({
      "/intelligence/explain": {
        ok: true,
        capabilityId: "engineering.openhands.execute",
        state: "NOT_CONFIGURED",
        reasons: ["not configured: the required environment or service is absent"],
        requirements: [
          { required: "engineering.openhands.runtime", state: "NOT_CONFIGURED", reason: "OpenHands must answer first" },
          { required: "security.policy.opa", state: "VERIFIED", reason: "satisfied" },
        ],
      },
    });
    const result = await new IntelligenceResolver().execute(context("why can't you run OpenHands?"));
    assert.equal(result.handled, true);
    const text = result.response?.text ?? "";
    assert.ok(text.includes("NOT_CONFIGURED"));
    assert.ok(text.includes("engineering.openhands.runtime"));
    assert.ok(text.includes("missing"));
    assert.ok(text.includes("met"));
    assert.equal(result.response?.provider, "intelligence");
  });

  test("a plan is returned as a proposal with approval still pending", async () => {
    stub({
      "/intelligence/plan": {
        ok: true,
        plan: {
          goal: "prepare yourself to use OpenHands",
          status: "AWAITING_APPROVAL",
          approvalRequired: true,
          steps: [
            {
              title: "Configure engineering.openhands.runtime",
              status: "awaiting_approval",
              observedState: "NOT_CONFIGURED",
              description: "OpenHands must answer before a task can be dispatched to it",
              requiresApproval: true,
            },
          ],
          execution: { started: false, note: "Planning is not authorization and this plan has not run." },
          evidence: [],
        },
      },
    });
    const result = await new IntelligenceResolver().execute(context("prepare yourself to use OpenHands"));
    assert.equal(result.handled, true);
    assert.ok((result.response?.text ?? "").includes("AWAITING_APPROVAL"));
    assert.ok((result.response?.text ?? "").includes("Nothing has run"));
  });

  test("a status question reports counts from the snapshot it received", async () => {
    stub({
      "/intelligence": {
        ok: true,
        snapshot: {
          snapshotId: "s1",
          timestamp: 1_700_000_000_000,
          studioStatuses: [
            { studioId: "engineering", operationalState: "NOT_CONFIGURED", capabilities: [], unavailableCapabilities: [], error: undefined },
            { studioId: "voice", operationalState: "UNAVAILABLE", capabilities: [], unavailableCapabilities: [], error: "connection refused" },
          ],
          capabilities: [],
          dependencies: [],
          findings: [],
          overallReadiness: { score: 0.2, readyCapabilities: 5, totalCapabilities: 27, blockedCapabilities: 22, detail: "5 of 27" },
          collection: { collectedAt: 1_700_000_000_000, durationMs: 12, fromCache: false, stale: false, studiosRead: 1, studiosFailed: 1 },
        },
      },
    });
    const result = await new IntelligenceResolver().execute(context("what is operational?"));
    assert.equal(result.handled, true);
    const text = result.response?.text ?? "";
    assert.ok(text.includes("Readiness"));
    assert.ok(text.includes("5 of 27"));
    assert.ok(text.includes("connection refused"));
  });

  test("an unreachable surface declines the turn rather than inventing a state", async () => {
    stub({}, true);
    const result = await new IntelligenceResolver().execute(context("why can't you run OpenHands?"));
    assert.equal(result.handled, false);
    assert.equal(result.response, undefined);
  });

  test("ordinary conversation is never sent to the integration surface", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as typeof fetch;
    const result = await new IntelligenceResolver().execute(context("write me a poem about the sea"));
    assert.equal(result.handled, false);
    assert.equal(called, false);
  });
});
