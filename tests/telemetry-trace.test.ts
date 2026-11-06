/**
 * ==========================================================
 * LÉLU — CORRELATED TRACES
 *
 * CATEGORY: unit. The chain the acceptance spec requires:
 *   User Request → CORE → SHAMAN → Agent → Model → Tool
 *                → Result → Verification
 *
 * What is proven:
 *   • one trace, one correlation id, staged and ordered;
 *   • a failing stage is recorded with its real error and the
 *     error is still thrown (telemetry never swallows a failure);
 *   • a credential-shaped attribute is redacted before storage;
 *   • an export without a collector refuses instead of claiming
 *     success.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import Telemetry, { redactValue } from "../src/core/observability/Telemetry";

function fresh(): Telemetry {
  const telemetry = Telemetry.getInstance();
  telemetry.resetForTests();
  return telemetry;
}

test("a full request produces one ordered, correlated chain", async () => {
  const telemetry = fresh();
  const traceId = telemetry.startTrace("fix the failing test", "audit-123");

  const core = telemetry.startSpan({ traceId, stage: "core", name: "LÉLU CORE" });
  const shaman = telemetry.startSpan({ traceId, stage: "shaman", name: "route objective", parentId: core.id });
  const agent = telemetry.startSpan({ traceId, stage: "agent", name: "Engineering agent", parentId: shaman.id });
  const model = telemetry.startSpan({ traceId, stage: "model", name: "qwen3-coder", parentId: agent.id, attributes: { provider: "litellm" } });
  const tool = telemetry.startSpan({ traceId, stage: "tool", name: "engineering.run", parentId: model.id, attributes: { capability: "coding.local" } });
  const result = telemetry.startSpan({ traceId, stage: "result", name: "tests passed", parentId: tool.id });
  const verification = telemetry.startSpan({ traceId, stage: "verification", name: "verify change", parentId: result.id });

  for (const span of [verification, result, tool, model, agent, shaman, core]) telemetry.endSpan(span.id, "ok");

  const chain = telemetry.chain(traceId);
  assert.deepEqual(
    chain.map((entry) => entry.stage),
    ["user_request", "core", "shaman", "agent", "model", "tool", "result", "verification"],
  );
  // The parent links are what make it a chain rather than a list.
  assert.equal(telemetry.span(shaman.id)?.parentId, core.id);
  assert.equal(telemetry.span(verification.id)?.parentId, result.id);

  const [summary] = telemetry.recentTraces(1);
  assert.equal(summary.correlationId, "audit-123");
  assert.equal(summary.status, "ok");
  assert.ok(summary.spanCount >= 8);
});

test("a failing stage is recorded with its real error and rethrown", async () => {
  const telemetry = fresh();
  const traceId = telemetry.startTrace("broken", "audit-err");
  await assert.rejects(
    () =>
      telemetry.withSpan({ traceId, stage: "tool", name: "scan" }, async () => {
        throw new Error("gitleaks exited 2");
      }),
    /gitleaks exited 2/,
  );
  const span = telemetry.chain(traceId).find((entry) => entry.stage === "tool");
  assert.equal(span?.status, "failed");
  const record = telemetry.traceSpans(traceId).find((item) => item.stage === "tool");
  assert.match(String(record?.error), /gitleaks exited 2/);
});

test("credential-shaped attributes are redacted before they are stored", () => {
  // Assembled at runtime: this repository should not carry a key-shaped
  // literal, even a fake one, or its own secret scanner has to special-case
  // its own tests.
  const KEY = ["sk", "live-1234567890"].join("-");
  const BARE = ["sk", "abcdefghijklmnop"].join("-");
  assert.equal(redactValue("apiKey", KEY), "[redacted]");
  assert.equal(redactValue("authorization", `Bearer ${"abcdefghijklmnop"}`), "[redacted]");
  assert.equal(redactValue("note", BARE), "[redacted]");
  assert.equal(redactValue("provider", "openrouter"), "openrouter");

  const telemetry = fresh();
  const traceId = telemetry.startTrace("redaction", "audit-redact");
  const span = telemetry.startSpan({
    traceId,
    stage: "model",
    name: "call",
    attributes: {
      apiKey: ["sk", "should-never-appear"].join("-"),
      nested: { token: ["ghp", "abcdefghijklmnop"].join("_"), model: "kimi" },
    },
  });
  const stored = telemetry.span(span.id);
  assert.equal(stored?.attributes.apiKey, "[redacted]");
  assert.equal(stored?.attributes["nested.token"], "[redacted]");
  assert.equal(stored?.attributes["nested.model"], "kimi");
  assert.ok(!JSON.stringify(stored).includes(["sk", "should-never-appear"].join("-")));
});

test("exporting without a collector refuses and says why", async () => {
  const telemetry = fresh();
  const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  try {
    const traceId = telemetry.startTrace("no collector", "audit-none");
    const outcome = await telemetry.exportOtlp(traceId);
    assert.equal(outcome.exported, false);
    assert.match(outcome.reason, /No OTel collector is configured/);
  } finally {
    if (previous !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
  }
});

test("the span buffer is bounded, so a long agent loop cannot grow without limit", () => {
  const telemetry = fresh();
  const traceId = telemetry.startTrace("bounded", "audit-bounded");
  for (let index = 0; index < 2200; index += 1) {
    const span = telemetry.startSpan({ traceId, stage: "tool", name: `step-${index}` });
    telemetry.endSpan(span.id, "ok");
  }
  const retained = telemetry.traceSpans(traceId).length;
  assert.ok(retained <= 2000, `retained ${retained} spans`);
  assert.ok(retained > 0, "the newest spans are kept");
});
