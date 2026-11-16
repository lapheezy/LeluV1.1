import assert from "node:assert/strict";
import test from "node:test";
import { clearActivity, currentActivity, publishActivity, subscribeActivity } from "../src/app/scene/genesis/chat/activityRecorder";
import { emptyActivity, finishActivity, hasVisibleActivity, reduceActivity, summarizeActivity } from "../src/core/multichat/TurnActivity";

test("a turn is published for its own conversation only", () => {
  const activity = reduceActivity(emptyActivity(1000), {
    type: "tool_started",
    taskId: "t1",
    tool: "research",
    label: "Searching the web for lunar geology",
  });
  publishActivity("chat-a", activity);
  assert.equal(currentActivity("chat-a")?.steps.length, 1);
  assert.equal(currentActivity("chat-b"), null, "another chat must not inherit the turn");
  clearActivity("chat-a");
  assert.equal(currentActivity("chat-a"), null);
});

test("subscribers hear about a publish once, and stop when they unsubscribe", () => {
  let heard = 0;
  const off = subscribeActivity(() => { heard += 1; });
  publishActivity("chat-c", emptyActivity(2000));
  assert.equal(heard, 1);
  off();
  publishActivity("chat-c", emptyActivity(3000));
  assert.equal(heard, 1, "no call after unsubscribing");
  clearActivity("chat-c");
});

test("a finished turn in the window reads the same as in the chat panel", () => {
  const running = reduceActivity(emptyActivity(4000), {
    type: "tool_started",
    taskId: "t2",
    tool: "browser",
    label: "Opening example.com",
  });
  assert.equal(hasVisibleActivity(running), true);
  assert.equal(summarizeActivity(running).current, "Opening example.com");
  const done = finishActivity(running);
  assert.equal(done.status, "done");
  assert.equal(done.steps.every((step) => step.status !== "running"), true, "nothing stays running after the turn ends");
  publishActivity("chat-d", done);
  assert.equal(currentActivity("chat-d")?.status, "done");
  clearActivity("chat-d");
});
