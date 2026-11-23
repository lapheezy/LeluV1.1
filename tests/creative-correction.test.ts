/**
 * M16.3 WP04 — bounded, safe correction under a real failure.
 *
 * The store call is made to fail ONCE (an injected fault, not a mock of the
 * executor). The real path then runs: tool → store → verification → one retry
 * → re-verification. Two properties are pinned:
 *
 *   - an idempotent transform is retried once and, if the retry works, the
 *     operation is VERIFIED and says so;
 *   - if it still does not work, the tool reports ok:false with the failed
 *     check, and never claims the requested state was reached.
 *
 * Evidence class: TEST (failure injection) + DISPATCH (the real tool path).
 */

const memory = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
} as Storage;

import assert from "node:assert/strict";
import test from "node:test";

type Result = { ok: boolean; content: string; data?: { verification?: Record<string, unknown> } };

async function setup() {
  const { default: CreativeObjects } = await import("../src/core/couture/objects");
  const { registerCoutureTools } = await import("../src/core/couture/CoutureTools");
  const { dispatchToolCall, toolNameForModel } = await import("../src/core/tools/ToolDispatcher");
  registerCoutureTools();
  const store = CreativeObjects.getInstance();
  const run = async (tool: string, args: Record<string, unknown>): Promise<Result> =>
    (await dispatchToolCall(
      { id: `wp04-${Date.now()}-${Math.random()}`, name: toolNameForModel(tool), arguments: args },
      `wp04-${Date.now()}`,
      undefined as never,
      { path: "direct" },
    )) as Result;
  return { store, run };
}

async function makeChair(run: (tool: string, args: Record<string, unknown>) => Promise<Result>) {
  const built = await run("couture.design", { action: "product", template: "chair", name: "Oak side chair" });
  const data = built.data as unknown as { objectId?: string; id?: string } | undefined;
  return data?.objectId ?? data?.id ?? "obj-product-1";
}

test("a transform that fails once is retried exactly once and then VERIFIED", async () => {
  const { store, run } = await setup();
  const id = await makeChair(run);

  const original = (store as unknown as { setTransform: (...args: unknown[]) => unknown }).setTransform.bind(store);
  let swallowed = 0;
  (store as unknown as { setTransform: unknown }).setTransform = (...args: unknown[]) => {
    if (swallowed === 0) {
      swallowed += 1;
      return null; // the fault: the write is dropped, the object is untouched
    }
    return original(...args);
  };

  const result = await run("couture.objects", { action: "rotate", object: id, rotation: [0, 0, 90] });
  (store as unknown as { setTransform: unknown }).setTransform = original;

  const verification = result.data?.verification as
    | { result?: { status?: string }; correction?: { attempted?: boolean; tries?: number; status?: string } }
    | undefined;
  assert.equal(swallowed, 1, "the injected fault fired once");
  assert.equal(verification?.correction?.attempted, true, "correction was attempted");
  assert.equal(verification?.correction?.tries, 2, "exactly one retry — no loop");
  assert.equal(verification?.result?.status, "VERIFIED", verification?.result?.status);
  assert.equal(result.ok, true);
  assert.deepEqual(store.get(id)?.transform.rotation, [0, 0, 90], "the world really changed");
});

test("a transform that never lands is reported as a failure, not as done", async () => {
  const { store, run } = await setup();
  const id = await makeChair(run);

  const original = (store as unknown as { setTransform: (...args: unknown[]) => unknown }).setTransform.bind(store);
  let swallowed = 0;
  (store as unknown as { setTransform: unknown }).setTransform = (...args: unknown[]) => {
    swallowed += 1;
    return null; // permanent fault: every write is dropped
  };

  const result = await run("couture.objects", { action: "rotate", object: id, rotation: [0, 0, 45] });
  (store as unknown as { setTransform: unknown }).setTransform = original;

  const verification = result.data?.verification as
    | { result?: { status?: string; note?: string }; correction?: { attempted?: boolean; tries?: number } }
    | undefined;
  assert.equal(result.ok, false, "a failed verification is a failed operation");
  assert.match(result.content, /verification failed/);
  assert.equal(verification?.result?.status, "FAILED");
  assert.equal(swallowed, 2, "one attempt and one retry, then it stops");
  assert.deepEqual(store.get(id)?.transform.rotation, [0, 0, 0], "the object was never rotated");
});

test("selection is never retried, because there is nothing to retry", async () => {
  const { run } = await setup();
  const id = await makeChair(run);
  const result = await run("couture.objects", { action: "select", object: id });
  const verification = result.data?.verification as { correction?: unknown; result?: { status?: string } } | undefined;
  assert.equal(verification?.correction, undefined);
  assert.notEqual(verification?.result?.status, "FAILED", "selecting an existing object is not a failure");
});

test("a step whose object failed on an earlier step is skipped, and said to be skipped", async () => {
  const { store, run } = await setup();
  const id = await makeChair(run);
  const { default: DirectResolver } = await import("../src/core/router/DirectResolver");

  const resolver = new DirectResolver();
  const plan = {
    explicit: false,
    summary: "three steps",
    steps: [
      { tool: "couture.objects", args: { action: "rotate", object: "obj-missing-9", rotation: [0, 0, 45] }, label: "rotate the missing object" },
      { tool: "couture.objects", args: { action: "scale", object: "obj-missing-9", scale: 2 }, label: "enlarge the missing object" },
      { tool: "couture.objects", args: { action: "rotate", object: id, rotation: [0, 0, 30] }, label: "rotate the chair" },
    ],
  };

  const result = await resolver.execute(
    { request: { prompt: "compound", timestamp: 7 }, started: Date.now(), aiProviders: { available: async () => [] } } as never,
    plan as never,
    "creative",
  );

  const steps = (result.response?.metadata as { steps?: Array<{ skipped?: boolean; ok: boolean }> } | undefined)?.steps ?? [];
  assert.equal(steps.length, 3);
  assert.equal(steps[0].ok, false, "the first step failed");
  assert.equal(steps[1].skipped, true, "the dependent step was not attempted");
  assert.equal(steps[2].ok, true, "an independent step still ran");
  assert.match(result.response?.text ?? "", /not attempted/);
  assert.deepEqual(store.get(id)?.transform.rotation, [0, 0, 30], "the independent step really happened");
});
