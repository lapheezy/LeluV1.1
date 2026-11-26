/**
 * The work queue is claimed as a capability; this is the check that makes the
 * claim testable. It exercises the real singleton: add -> move -> complete,
 * then removes the probe so the queue is left as it was found.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import WorkQueue, { QUEUE_CATEGORIES } from "../src/core/cognition/WorkQueue";

describe("the work queue completes an item's whole lifecycle", () => {
  test("add -> move -> complete, read back from the store", () => {
    const queue = WorkQueue.getInstance();
    const before = queue.list().length;

    const item = queue.add({
      category: "improvement",
      title: "laboratory probe — remove after the check",
      detail: "Created by tests/work-queue.test.ts",
      autonomy: 0,
    });
    assert.equal(item.status, "open");
    assert.ok(queue.list().some((entry) => entry.id === item.id), "an added item is in the queue");

    const target = QUEUE_CATEGORIES.find((category) => category !== item.category);
    assert.ok(target, "the queue declares more than one category");
    queue.move(item.id, target);
    const moved = queue.list().find((entry) => entry.id === item.id);
    assert.equal(moved?.category, target, "move writes the new category");
    assert.equal(moved?.status, "open", "moving does not complete the item");

    queue.complete(item.id);
    const done = queue.list().find((entry) => entry.id === item.id);
    assert.equal(done?.status, "done", "complete writes the terminal status");

    queue.remove(item.id);
    assert.equal(queue.list().length, before, "the probe is removed, so the queue is unchanged");
  });
});
