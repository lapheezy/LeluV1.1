/**
 * ==========================================================
 * LÉLU — EXECUTION IDENTITY AND EVIDENCE
 *
 * CATEGORY: integration. No network.
 *
 * Mission 6.1.7's claim is narrow and checkable: every REAL tool invocation
 * produces one identity and a lifecycle of records from the code that
 * observed it, on both orchestration paths, and nothing else can produce
 * them. These tests read the records off the existing AgentEventBus — the
 * same stream the activity card and the server log are fed from.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import AgentEventBus from "../src/core/agent/AgentEvents";
import type { AgentEvent } from "../src/core/agent/AgentEvents";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import {
  formatExecutionLine,
  redactExecutionText,
  sanitizeExecutionRecord,
  type ExecutionRecord,
} from "../src/core/tools/ExecutionEvidence";

const withLocalStorage = () => {
  const scope = globalThis as Record<string, unknown>;
  if (scope.localStorage) return;
  const store = new Map<string, string>();
  const shim = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  scope.localStorage = shim;
  scope.window = scope.window ?? scope;
  (scope.window as Record<string, unknown>).localStorage = shim;
};

/** Collect every evidence record emitted while `work` runs. */
async function capture(work: () => Promise<unknown>): Promise<ExecutionRecord[]> {
  const records: ExecutionRecord[] = [];
  const bus = AgentEventBus.getInstance();
  const listener = (event: AgentEvent) => {
    if (event.type === "execution_evidence") records.push(event.record);
  };
  const unsubscribe = (bus as unknown as { subscribe: (fn: (e: AgentEvent) => void) => () => void }).subscribe(listener);
  try {
    await work();
  } finally {
    unsubscribe();
  }
  return records;
}

test("one invocation produces one identity across its whole lifecycle", async () => {
  const records = await capture(() =>
    dispatchToolCall({ id: "tc-life", name: "system_config", arguments: {} }, "turn-42", undefined, { path: "chat" }),
  );

  const stages = records.map((record) => record.stage);
  assert.deepEqual(stages, ["requested", "authorized", "started", "succeeded"]);
  const ids = new Set(records.map((record) => record.executionId));
  assert.equal(ids.size, 1, `the stages were not tied to one execution: ${[...ids].join(", ")}`);
  assert.equal(records[0].path, "chat");
  assert.equal(records[0].tool, "system.config");
  assert.equal(records[0].taskId, "turn-42");
  assert.equal(records.at(-1)?.outcome, "succeeded");

  const finished = records.at(-1);
  assert.ok(typeof finished?.startedAt === "number" && typeof finished?.finishedAt === "number");
  assert.ok((finished?.durationMs ?? -1) >= 0, "the execution layer did not measure its own duration");
});

test("two separate executions get different identities", async () => {
  const records = await capture(async () => {
    await dispatchToolCall({ id: "a", name: "system_config", arguments: {} }, "turn-1", undefined, { path: "chat" });
    await dispatchToolCall({ id: "b", name: "system_config", arguments: {} }, "turn-1", undefined, { path: "chat" });
  });

  const ids = new Set(records.filter((record) => record.stage === "succeeded").map((record) => record.executionId));
  assert.equal(ids.size, 2, "two real executions were collapsed into one identity");
});

test("a deactivated capability is recorded as refused, never as done", async () => {
  withLocalStorage();
  const { default: CapabilityActivation } = await import("../src/core/acquisition/CapabilityActivation");
  const activation = CapabilityActivation.getInstance();
  const registryId = "kb.describe";

  try {
    activation.setCapability("evidence.probe", false, [registryId]);
    const records = await capture(() =>
      dispatchToolCall({ id: "tc-refused", name: "kb_describe", arguments: {} }, "turn-43", undefined, { path: "chat" }),
    );

    const stages = records.map((record) => record.stage);
    assert.ok(stages.includes("refused"), `no refusal record: ${stages.join(", ")}`);
    assert.ok(!stages.includes("started"), "a refused tool was recorded as started");
    assert.ok(!stages.includes("succeeded"), "a refused tool was recorded as a success");
    const refusal = records.find((record) => record.stage === "refused");
    assert.equal(refusal?.approval, "refused");
    assert.ok((refusal?.reason ?? "").length > 0, "the refusal gave no reason");
  } finally {
    activation.setCapability("evidence.probe", true, [registryId]);
  }
});

test("a tool that does not exist is recorded as a failure with no authorization", async () => {
  const records = await capture(() =>
    dispatchToolCall({ id: "tc-none", name: "no_such_tool", arguments: {} }, "turn-44", undefined, { path: "chat" }),
  );
  const stages = records.map((record) => record.stage);
  assert.deepEqual(stages, ["requested", "failed"]);
  assert.equal(records.at(-1)?.outcome, "failed");
});

test("the task-engine path is recorded as its own path, with its step", async () => {
  const records = await capture(() =>
    dispatchToolCall({ id: "task-1-9", name: "workflow_list", arguments: {} }, "task-1", undefined, {
      path: "task",
      stepId: "step-1",
    }),
  );
  assert.ok(records.length > 0);
  for (const record of records) {
    assert.equal(record.path, "task");
    assert.equal(record.stepId, "step-1");
  }
  assert.equal(records.at(-1)?.stage, "succeeded");
});

test("a message the model sent twice is recorded as suppressed, not as a second execution", async () => {
  const { default: ProviderResolver } = await import("../src/core/router/ProviderResolver");
  const { default: ExecutionLogger } = await import("../src/core/ExecutionLogger");

  let round = 0;
  const provider = {
    name: "ScriptedNative",
    priority: 1,
    enabled: true,
    timeout: 10_000,
    requiresApiKey: false,
    capabilities: ["chat"] as const,
    supportsTools: true,
    initialize: async () => {},
    isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async () => {
      round += 1;
      return round === 1
        ? {
            text: "",
            provider: "scripted",
            model: "scripted-1",
            processingTime: 1,
            toolCalls: [
              { id: "dup-a", name: "system_config", arguments: {} },
              { id: "dup-b", name: "system_config", arguments: {} },
            ],
          }
        : { text: "Checked once.", provider: "scripted", model: "scripted-1", processingTime: 1 };
    },
  };
  const context = {
    request: { prompt: "check the configuration", messages: [], timestamp: Date.now(), allowTools: true },
    started: Date.now(),
    logger: new ExecutionLogger(),
    aiProviders: {
      available: async () => [provider],
      names: () => ["scripted"],
      markFailure: () => {},
      markSuccess: () => {},
      all: () => [provider],
      get: () => provider,
    },
  } as never;

  const records = await capture(() => new ProviderResolver().execute(context));
  const succeeded = records.filter((record) => record.stage === "succeeded");
  const suppressed = records.filter((record) => record.stage === "suppressed");

  assert.equal(succeeded.length, 1, `the duplicate executed ${succeeded.length} times`);
  assert.equal(suppressed.length, 1, "the suppressed duplicate left no record at all");
  assert.notEqual(
    suppressed[0].executionId,
    succeeded[0].executionId,
    "the suppressed repeat reused the executed call's identity — the two would be indistinguishable",
  );
});

test("evidence carries no arguments and no credential", async () => {
  const records = await capture(() =>
    dispatchToolCall(
      { id: "tc-args", name: "system_config", arguments: { apiKey: "sk-live-abcdef1234567890", secret: "hunter2" } },
      "turn-45",
      undefined,
      { path: "chat" },
    ),
  );
  const wire = JSON.stringify(records);
  assert.ok(!wire.includes("abcdef1234567890"), "an argument value reached the evidence record");
  assert.ok(!wire.includes("hunter2"), "an argument value reached the evidence record");
  assert.ok(!/"arguments"/.test(wire), "the evidence record includes tool arguments");

  // Free text is redacted even if a provider echoes a credential into it.
  const echoed = redactExecutionText("upstream said: Bearer sk-live-abcdef1234567890 rejected");
  assert.ok(!echoed.includes("abcdef1234567890"), echoed);
});

test("the server line is greppable, correlatable and argument-free", async () => {
  const records = await capture(() =>
    dispatchToolCall({ id: "tc-line", name: "workflow_list", arguments: {} }, "turn-46", undefined, { path: "chat" }),
  );
  const line = formatExecutionLine(records.at(-1) as ExecutionRecord);
  assert.match(line, /^\[execution\] id=/);
  for (const field of ["stage=succeeded", "path=chat", "tool=workflow.list", "outcome=succeeded", "durationMs="]) {
    assert.ok(line.includes(field), `missing ${field} in: ${line}`);
  }
  assert.ok(line.includes(records[0].executionId));

  // A hostile payload is trimmed to the fields the log understands.
  const sanitized = sanitizeExecutionRecord({
    ...records[0],
    tool: "x".repeat(200),
    reason: "token=supersecret " + "y".repeat(400),
    durationMs: -5,
  } as ExecutionRecord);
  assert.ok(sanitized.tool.length <= 80);
  assert.ok((sanitized.reason ?? "").length <= 200);
  assert.ok(!(sanitized.reason ?? "").includes("supersecret"));
  assert.equal(sanitized.durationMs, 0);
});

test("a cancelled turn dispatches no tool and records no execution", async () => {
  const { default: ProviderResolver } = await import("../src/core/router/ProviderResolver");
  const { default: ExecutionLogger } = await import("../src/core/ExecutionLogger");

  const provider = {
    name: "ScriptedNative",
    priority: 1,
    enabled: true,
    timeout: 10_000,
    requiresApiKey: false,
    capabilities: ["chat"] as const,
    supportsTools: true,
    initialize: async () => {},
    isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async () => ({
      text: "",
      provider: "scripted",
      model: "scripted-1",
      processingTime: 1,
      toolCalls: [{ id: "never", name: "system_config", arguments: {} }],
    }),
  };
  const controller = new AbortController();
  controller.abort();
  const context = {
    request: { prompt: "stop already", messages: [], timestamp: Date.now(), allowTools: true, signal: controller.signal },
    started: Date.now(),
    logger: new ExecutionLogger(),
    aiProviders: {
      available: async () => [provider],
      names: () => ["scripted"],
      markFailure: () => {},
      markSuccess: () => {},
      all: () => [provider],
      get: () => provider,
    },
  } as never;

  const records = await capture(async () => {
    await assert.rejects(() => new ProviderResolver().execute(context));
  });
  assert.equal(
    records.filter((record) => record.stage === "started" || record.stage === "succeeded").length,
    0,
    "a cancelled turn still executed a tool",
  );
});

test("a provider that fails after a tool ran keeps the execution and never claims more", async () => {
  const { default: ProviderResolver } = await import("../src/core/router/ProviderResolver");
  const { default: ExecutionLogger } = await import("../src/core/ExecutionLogger");

  let round = 0;
  const provider = {
    name: "ScriptedNative",
    priority: 1,
    enabled: true,
    timeout: 10_000,
    requiresApiKey: false,
    capabilities: ["chat"] as const,
    supportsTools: true,
    initialize: async () => {},
    isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async () => {
      round += 1;
      if (round === 1) {
        return {
          text: "",
          provider: "scripted",
          model: "scripted-1",
          processingTime: 1,
          toolCalls: [{ id: "ran-1", name: "system_config", arguments: {} }],
        };
      }
      throw new Error("upstream refused the follow-up round");
    },
  };
  const context = {
    request: { prompt: "check the configuration", messages: [], timestamp: Date.now(), allowTools: true },
    started: Date.now(),
    logger: new ExecutionLogger(),
    aiProviders: {
      available: async () => [provider],
      names: () => ["scripted"],
      markFailure: () => {},
      markSuccess: () => {},
      all: () => [provider],
      get: () => provider,
    },
  } as never;

  const records = await capture(async () => {
    await new ProviderResolver().execute(context).catch(() => undefined);
  });
  const succeeded = records.filter((record) => record.stage === "succeeded");
  assert.equal(succeeded.length, 1, "the tool that really ran was not recorded as having run");
  assert.equal(succeeded[0].outcome, "succeeded");
  // The failure happened in the MODEL round, not in a tool: no fabricated
  // execution may appear for it.
  assert.equal(records.filter((record) => record.stage === "started").length, 1);
});
