/**
 * ==========================================================
 * LÉLU — A STATUS ANSWER DOES NOT QUOTE THE QUESTION BACK AS EARLIER WORK
 *
 * CATEGORY: offline, deterministic (event bus + executive runtime only).
 *
 * MEASURED (Mission 3.5, iPhone-sized browser, provider chain unavailable):
 * "Hello LÉLU, can you hear me?" — a connection question, answered from
 * measured state — came back as "Before you asked, I was working on 'Hello
 * LÉLU, can you hear me?'. The last thing I verified completing was:
 * memory.recall executed." One turn is registered by the Orchestrator and
 * again by AIService under different ids, so the first registration became
 * the "previous task"; the recall made while answering became "the last
 * thing I did before you asked".
 * ==========================================================
 */
import assert from "node:assert/strict";
import test from "node:test";

import AgentEventBus from "../src/core/agent/AgentEvents";
import ExecutiveRuntime from "../src/core/executive/ExecutiveRuntime";

const QUESTION = "Hello LÉLU, can you hear me?";

test("one turn registered twice is still one task, and its own work is not 'before you asked'", () => {
  const runtime = ExecutiveRuntime.getInstance();
  runtime.start();
  const bus = AgentEventBus.getInstance();
  try {
    // Earlier, genuinely different work.
    bus.emit({ type: "task_started", taskId: "earlier-1", label: "Summarise the Fashion workspace" });
    // The same user turn, registered by two layers under different ids.
    bus.emit({ type: "task_started", taskId: "orchestrator-2", label: QUESTION });
    bus.emit({ type: "task_started", taskId: "aiservice-3", label: QUESTION });
    // A step taken WHILE answering this question.
    runtime.recordVerifiedAction({ intent: "recall memory", execution: "memory.recall executed", observation: "0 memories", verified: true });

    const answer = runtime.composeStatusAnswer(QUESTION);
    assert.doesNotMatch(answer, /Before you asked, I was working on “Hello LÉLU/, answer);
    assert.doesNotMatch(answer, /memory\.recall executed/, answer);
    // The genuinely earlier task is what "before you asked" refers to.
    assert.match(answer, /Summarise the Fashion workspace/, answer);
  } finally {
    runtime.stop();
  }
});

test("a genuinely new question after earlier work still reports that earlier work", () => {
  const runtime = ExecutiveRuntime.getInstance();
  runtime.start();
  const bus = AgentEventBus.getInstance();
  try {
    bus.emit({ type: "task_started", taskId: "work-a", label: "Render the jewelry turntable" });
    bus.emit({ type: "task_started", taskId: "question-b", label: "what are you doing?" });
    const answer = runtime.composeStatusAnswer("what are you doing?");
    assert.match(answer, /Render the jewelry turntable/, answer);
  } finally {
    runtime.stop();
  }
});
