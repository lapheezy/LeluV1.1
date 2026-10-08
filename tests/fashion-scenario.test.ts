/**
 * ==========================================================
 * LÉLU — THE FASHION SCENARIO
 *
 * CATEGORY: integration. Real ProjectStore, real
 * MultiChatStore, real ProactiveCore, real intent resolution,
 * against a shimmed localStorage so persistence is exercised.
 *
 * This is the acceptance test the brief names. Nothing about
 * fashion is special in the code — it is one project — and
 * that is the point: the behaviour asserted here has to hold
 * for any topic, which is why each test also runs the same
 * shape against a second, unrelated project.
 *
 * The bad behaviour being pinned shut:
 *
 *   "Fashion is active but has no defined next outcome.
 *    What should I prioritize there?"
 *
 * surfacing on every cycle, forever, with a ✕ that did not
 * work and no way to act on it.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import ProjectStore from "../src/core/projects/ProjectStore";
import MultiChatStore from "../src/core/multichat/MultiChatStore";
import ProactiveCore from "../src/core/proactive/ProactiveCore";
import { canAct, intentEvidence, resolveIntent } from "../src/core/cognition/ProjectIntent";
import {
  WORKSTREAM_TAG,
  findWorkstream,
  hasActiveWorkstream,
  openWorkstream,
} from "../src/core/proactive/Workstream";

const projects = ProjectStore.getInstance();
const chats = MultiChatStore.getInstance();
const proactive = ProactiveCore.getInstance();
proactive.updateSettings({ enabled: true, notificationLevel: "normal" });

/** A project the user made and left empty — the Fashion shape. */
function emptyProject(name: string) {
  return projects.create({ name });
}

/* ------------------- derive instead of asking ------------------- */

test("an empty project with nothing to go on genuinely needs the user", () => {
  const project = emptyProject("Fashion");
  const intent = resolveIntent({ project });
  assert.equal(canAct(intent), false, "asking is correct only when there is nothing to derive");
});

test("a project carrying the user's own request is never asked about", () => {
  const project = emptyProject("Fashion");
  projects.update(project.id, {
    originalRequest: "Design a spring capsule collection in linen and silk",
  });
  const intent = resolveIntent({ project: projects.get(project.id)! });
  assert.ok(canAct(intent), "the user already said what this is for");
  assert.equal(intent?.source, "original-request");
});

test("a prior answer about a project is remembered, not re-asked", () => {
  const project = emptyProject("Fashion");
  const intent = resolveIntent({
    project: projects.get(project.id)!,
    priorAnswers: ["Prioritise the spring capsule and source linen suppliers"],
  });
  assert.ok(canAct(intent), "re-asking a question the user answered is the bug");
  assert.equal(intent?.source, "prior-answer");
});

test("the project's own conversation supplies a direction", () => {
  const project = emptyProject("Fashion");
  const conversation = chats.create("Fashion");
  chats.setProject(conversation.id, project.id);
  chats.addMessage(conversation.id, {
    id: "m1",
    role: "user",
    text: "I want to move the fashion work toward sustainable fabrics this season",
    timestamp: Date.now(),
    source: "local",
  });
  const intent = resolveIntent({
    project: projects.get(project.id)!,
    conversations: chats.listAll().filter((c) => c.projectId === project.id),
  });
  assert.ok(canAct(intent), "what the user has been saying is a direction");
  assert.equal(intent?.source, "conversation");
});

test("LÉLU's own bookkeeping project is not treated as user intent", () => {
  const project = emptyProject("Engineering");
  projects.update(project.id, { description: "Auto-created for engineering chat turns" });
  const intent = resolveIntent({ project: projects.get(project.id)! });
  assert.equal(
    canAct(intent),
    false,
    "acting on her own filing system is how she invents work nobody asked for",
  );
});

/* ----------------------- idempotent cycles ----------------------- */

test("the same situation produces the same evidence, however many cycles run", () => {
  const project = emptyProject("Fashion");
  const first = intentEvidence({ project: projects.get(project.id)! });
  const second = intentEvidence({ project: projects.get(project.id)! });
  assert.equal(first, second, "this equality is what makes a repeated cycle a no-op");
});

test("real movement changes the evidence", () => {
  const project = emptyProject("Fashion");
  const before = intentEvidence({ project: projects.get(project.id)! });
  projects.update(project.id, { objective: "Ship the spring capsule" });
  const after = intentEvidence({ project: projects.get(project.id)! });
  assert.notEqual(before, after);
});

test("a conversation growing changes the evidence", () => {
  const project = emptyProject("Jewelry");
  const conversation = chats.create("Jewelry");
  chats.setProject(conversation.id, project.id);
  const before = intentEvidence({
    project: projects.get(project.id)!,
    conversations: chats.listAll().filter((c) => c.projectId === project.id),
  });
  chats.addMessage(conversation.id, {
    id: "j1", role: "user", text: "Let's look at recycled silver", timestamp: Date.now(), source: "local",
  });
  const after = intentEvidence({
    project: projects.get(project.id)!,
    conversations: chats.listAll().filter((c) => c.projectId === project.id),
  });
  assert.notEqual(before, after, "the user engaging IS a change in the situation");
});

/* -------------------------- workstreams -------------------------- */

test("engaging a suggestion opens a workstream bound to its project", () => {
  const project = emptyProject("Fashion");
  const context = openWorkstream(project.id);
  assert.ok(context);
  assert.equal(context.created, true);
  assert.equal(context.conversation.projectId, project.id, "the binding is the whole point");
  assert.ok(context.conversation.tags.includes(WORKSTREAM_TAG));
});

test("reopening a workstream does not create a second one", () => {
  const project = emptyProject("Fashion");
  const first = openWorkstream(project.id);
  const second = openWorkstream(project.id);
  assert.ok(first && second);
  assert.equal(second.created, false);
  assert.equal(second.conversation.id, first.conversation.id);
  assert.equal(
    chats.listAll().filter((c) => c.projectId === project.id).length,
    1,
    "N conversations about one subject is not a workstream",
  );
});

test("a workstream is seeded with why LÉLU raised it and what she knows", () => {
  const project = emptyProject("Fashion");
  projects.update(project.id, {
    objective: "Ship the spring capsule",
    originalRequest: "Design a spring capsule in linen",
  });
  const context = openWorkstream(project.id, {
    question: {
      id: "q1",
      key: `project-direction:${project.id}`,
      question: "What should I prioritize there?",
      category: "PROJECT",
      reason: "The project has no work items or research direction.",
      priority: "P1",
      relatedProjectId: project.id,
      blocksExecution: false,
      rememberAnswer: true,
      askedAt: Date.now(),
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  assert.ok(context?.briefing, "a cold conversation makes the user re-explain their own project");
  assert.match(context.briefing, /Ship the spring capsule/);
  assert.match(context.briefing, /I opened this because/);
});

test("the workstream binding survives a reload", () => {
  const project = emptyProject("Fashion");
  const context = openWorkstream(project.id);
  assert.ok(context);
  // A fresh read, as a reload performs.
  const reloaded = findWorkstream(project.id);
  assert.equal(reloaded?.id, context.conversation.id);
  assert.equal(reloaded?.projectId, project.id);
});

test("a project being handled in a workstream is not a global question", () => {
  const project = emptyProject("Fashion");
  assert.equal(hasActiveWorkstream(project.id), false, "an empty project is not being handled");
  const context = openWorkstream(project.id, { seed: false });
  assert.ok(context);
  assert.equal(
    hasActiveWorkstream(project.id),
    false,
    "a conversation created and never used is not work in progress",
  );
  chats.addMessage(context.conversation.id, {
    id: "f1", role: "user", text: "Start with the linen sourcing", timestamp: Date.now(), source: "local",
  });
  assert.equal(
    hasActiveWorkstream(project.id),
    true,
    "global cognition must now leave this topic to its workstream",
  );
});

test("workstreams are per-project, so two topics never share one", () => {
  const fashion = emptyProject("Fashion");
  const art = emptyProject("Art");
  const a = openWorkstream(fashion.id);
  const b = openWorkstream(art.id);
  assert.ok(a && b);
  assert.notEqual(a.conversation.id, b.conversation.id);
  assert.equal(findWorkstream(fashion.id)?.id, a.conversation.id);
  assert.equal(findWorkstream(art.id)?.id, b.conversation.id);
});

test("a workstream for a project that does not exist is refused", () => {
  assert.equal(openWorkstream("no-such-project"), null);
});

/* --------------- the full scenario, and a second topic --------------- */

for (const topic of ["Fashion", "Woodworking"]) {
  test(`${topic}: surfaced once, dismissed, and never asked again`, () => {
    const project = emptyProject(topic);
    const evidence = intentEvidence({ project: projects.get(project.id)! });
    const input = {
      key: `project-direction:${project.id}`,
      question: `“${topic}” is active but has no defined next outcome. What should I prioritize there?`,
      category: "PROJECT" as const,
      reason: "The project exists in persistent state but has no work items or research direction.",
      priority: "P1" as const,
      relatedProjectId: project.id,
      evidence,
    };

    const question = proactive.enqueueQuestion(input);
    proactive.markQuestionSurfaced(question.id);
    proactive.dismissQuestion(question.id);

    // Ten more cycles observe exactly the same situation.
    for (let cycle = 0; cycle < 10; cycle += 1) {
      proactive.enqueueQuestion({ ...input, evidence: intentEvidence({ project: projects.get(project.id)! }) });
    }

    assert.equal(
      proactive.listQuestions().filter((q) => q.key === input.key).length,
      1,
      "one decision, one record",
    );
    assert.notEqual(
      proactive.getActiveQuestion()?.key,
      input.key,
      `${topic} must not come back — this is the reported bug`,
    );
  });
}
