/**
 * ==========================================================
 * LÉLU — SHAMAN ROUTES REAL WORK, AND THE ROUTE SURVIVES A RESTART
 *
 * CATEGORY: unit. Real AgentStore (KvStore over an in-memory
 * localStorage), real AgentRunner, real Shaman; the model is stubbed
 * at AIService.delegate — the one boundary AgentRunner calls.
 *
 * Measured before:
 *   - The Cosmos looked agents up as AGENT_TO_EXECUTIVE[agent.id], a
 *     table keyed by TEMPLATE id, while agent ids are per-install UUIDs:
 *     no agent ever matched, so every one was drawn in the default
 *     galaxy whatever its template.
 *   - A task recorded nothing about which executive owned it or why
 *     that agent was chosen; there was no router between LÉLU CORE and
 *     the Executive Board at all.
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
if (typeof sessionStorage === "undefined") {
  (globalThis as Record<string, unknown>).sessionStorage = globalThis.localStorage;
}

import AgentStore from "../src/core/agents/AgentStore";
import Shaman from "../src/core/agents/Shaman";
import AIService from "../src/core/AIService";
import { executiveOf, ownershipOf, templateIdOf, TEMPLATE_EXECUTIVE, EXECUTIVE_IDS } from "../src/core/agents/ExecutiveOwnership";
import { AGENT_TEMPLATES, EXECUTIVE_AGENT_TEMPLATES, SCIENTIFIC_AGENT_TEMPLATES } from "../src/core/agents/AgentTemplates";
import { EXECUTIVES } from "../src/core/executive/ExecutiveBoard";
import type { AIResponse } from "../src/providers/AIProvider";
import { stopBackgroundCognition } from "./support/isolation";

await stopBackgroundCognition();

type Delegate = AIService["delegate"];
const ai = AIService.getInstance();
const realDelegate: Delegate = ai.delegate.bind(ai);
function stubDelegate(impl: (agentName: string, task: string) => Promise<AIResponse>): () => void {
  (ai as unknown as { delegate: Delegate }).delegate = (async (agent, task) => impl(agent.name, task)) as Delegate;
  return () => {
    (ai as unknown as { delegate: Delegate }).delegate = realDelegate;
  };
}
const ok = (text: string): AIResponse => ({ text, provider: "stub", model: "stub", processingTime: 1 });

function restart(): AgentStore {
  AgentStore.resetForTests();
  return AgentStore.getInstance();
}

const store = () => AgentStore.getInstance();
const byName = (name: string) => store().list().find((agent) => agent.name === name)!;

/* ----------------------------- ownership ------------------------------ */

test("every template has an owning executive, and every owner is on the Executive Board", () => {
  const board = new Set(EXECUTIVES.map((executive) => executive.id));
  assert.deepEqual([...board].sort(), [...EXECUTIVE_IDS].sort(), "ownership and the board name the same six executives");
  for (const template of [...AGENT_TEMPLATES, ...EXECUTIVE_AGENT_TEMPLATES, ...SCIENTIFIC_AGENT_TEMPLATES]) {
    const owner = TEMPLATE_EXECUTIVE[template.id];
    assert.ok(owner, `${template.id} has an owner`);
    assert.ok(board.has(owner), `${template.id} → ${owner} is a board executive`);
  }
});

test("seeded agents carry their template id and map to their real executive, not a UUID miss", () => {
  const builder = byName("Builder");
  assert.ok(builder, "the builder template was seeded");
  assert.match(builder.id, /^[0-9a-f-]{36}$/, "agent ids really are UUIDs");
  assert.equal(builder.templateId, "builder");
  assert.equal(executiveOf(builder), "engineering");
  const researcher = store().list().find((agent) => agent.templateId === "researcher")!;
  assert.equal(executiveOf(researcher), "architect");
  const owners = new Set(store().list().map((agent) => executiveOf(agent)));
  assert.ok(owners.size >= 3, `agents spread over their galaxies, not one default (${[...owners].join(", ")})`);
});

test("an agent stored before templateId existed is backfilled by name on load", () => {
  const legacy = store().list().find((agent) => agent.templateId === "renderer")!;
  store().update(legacy.id, { templateId: undefined });
  assert.equal(store().get(legacy.id)!.templateId, undefined);
  const reloaded = restart();
  assert.equal(reloaded.get(legacy.id)!.templateId, "renderer");
  assert.equal(executiveOf(reloaded.get(legacy.id)!), "engineering");
});

test("an explicit assignment wins and persists; a user-made agent belongs to Agent Forge", () => {
  const custom = store().create({ name: "Tide Watcher", role: "Harbour logistics", capabilities: ["tides"] });
  assert.deepEqual(ownershipOf(custom), { executive: "forge", basis: "default" });
  store().assignExecutive(custom.id, "caretaker");
  const reloaded = restart();
  assert.deepEqual(ownershipOf(reloaded.get(custom.id)!), { executive: "caretaker", basis: "assigned" });
  assert.throws(() => reloaded.assignExecutive(custom.id, "nobody" as never), /not an executive/);
});

/* ------------------------------ routing ------------------------------- */

test("an unassigned objective goes to the agent whose description matches, with the reason", () => {
  const decision = Shaman.getInstance().route({ objective: "Render a photoreal product shot of the ring" });
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(templateIdOf(store().get(decision.agentId)!), "renderer");
  assert.equal(decision.executive, "engineering");
  assert.match(decision.routeReason, /matched .* owned by engineering/);
});

test("an objective no agent describes is placed by its wording, security first", () => {
  const shaman = Shaman.getInstance();
  assert.equal(shaman.classify("rotate the leaked credential and fix the build"), "maat");
  assert.equal(shaman.classify("refactor the dependency graph"), "architect");
  assert.equal(shaman.classify("hello there"), null);
});

test("assignment authority: board-wide for user/LÉLU/Forge, own galaxy for an executive or agent", () => {
  const shaman = Shaman.getInstance();
  assert.equal(shaman.canAssign("user", "maat").ok, true);
  assert.equal(shaman.canAssign("lelu", "caretaker").ok, true);
  assert.equal(shaman.canAssign("forge", "engineering").ok, true);
  assert.equal(shaman.canAssign("architect", "architect").ok, true);
  const refused = shaman.canAssign("architect", "engineering");
  assert.equal(refused.ok, false);
  const builder = store().list().find((agent) => agent.templateId === "builder")!;
  assert.equal(shaman.canAssign(builder.id, "engineering").ok, true, "a peer in the same galaxy");
  assert.equal(shaman.canAssign(builder.id, "lelu").ok, false);
  assert.equal(shaman.canAssign("someone-unknown", "lelu").ok, false);
});

/* ------------------------- execution + recovery ------------------------ */

test("dispatch runs the routed agent and the task records executive, reason and delegator — across a restart", async () => {
  const ran: string[] = [];
  const restore = stubDelegate(async (agentName, task) => {
    ran.push(`${agentName}: ${task}`);
    return ok("Rendered.");
  });
  try {
    const result = await Shaman.getInstance().dispatch({ objective: "Render a photoreal product shot of the ring", delegatedBy: "lelu" });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.route.ok, true);
    if (!result.route.ok) return;
    assert.equal(ran.length, 1);
    assert.ok(ran[0].startsWith(result.route.agentName), "the routed agent is the one that ran");

    const reloaded = restart();
    const task = reloaded.get(result.route.agentId)!.tasks.find((item) => item.id === result.taskId)!;
    assert.equal(task.status, "complete");
    assert.equal(task.executive, "engineering");
    assert.equal(task.delegatedBy, "lelu");
    assert.equal(task.routeReason, result.route.routeReason);
  } finally {
    restore();
  }
});

test("a refused assignment runs nothing and says why", async () => {
  let calls = 0;
  const restore = stubDelegate(async () => {
    calls += 1;
    return ok("should not run");
  });
  try {
    const builder = store().list().find((agent) => agent.templateId === "builder")!;
    const result = await Shaman.getInstance().dispatch({ objective: "review the design", agentId: builder.id, delegatedBy: "caretaker" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /own galaxy/);
    assert.equal(calls, 0);

    const archived = store().create({ name: "Retired Helper" });
    store().update(archived.id, { status: "archived" });
    const unavailable = await Shaman.getInstance().dispatch({ objective: "anything", agentId: archived.id });
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.error ?? "", /archived/);
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test("interrupted work whose agent became unavailable is re-routed within the same executive", async () => {
  const engineering = store().runnable().filter((agent) => executiveOf(agent) === "engineering");
  assert.ok(engineering.length >= 2, "need two engineering agents");
  const [gone] = engineering;
  const original = store().recordTask(gone.id, {
    label: "compile the shader bundle",
    status: "running",
    delegatedBy: "architect",
    executive: "engineering",
    routeReason: "test",
  });
  restart();
  store().update(gone.id, { enabled: false });

  const ran: string[] = [];
  const restore = stubDelegate(async (agentName) => {
    ran.push(agentName);
    return ok("Compiled.");
  });
  try {
    const result = await Shaman.getInstance().resume(gone.id, original.id);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.route.ok, true);
    if (!result.route.ok) return;
    assert.notEqual(result.route.agentId, gone.id);
    assert.equal(result.route.executive, "engineering");
    assert.match(result.route.routeReason, /unavailable; re-routed within engineering/);
    assert.deepEqual(ran, [result.route.agentName]);

    const reloaded = restart();
    const old = reloaded.get(gone.id)!.tasks.find((task) => task.id === original.id)!;
    const next = reloaded.get(result.route.agentId)!.tasks.find((task) => task.id === result.taskId)!;
    assert.equal(old.status, "interrupted", "history is kept");
    assert.equal(old.resumedBy, next.id, "the original points at its continuation, on the other agent");
    assert.equal(next.resumedFrom, original.id);
    assert.equal(next.delegatedBy, "architect", "ownership carries over");
    assert.equal(next.executive, "engineering");
  } finally {
    restore();
    store().update(gone.id, { enabled: true });
  }
});

test("with nobody available in the galaxy, resume refuses instead of guessing", async () => {
  const maat = store().runnable().filter((agent) => executiveOf(agent) === "maat");
  for (const agent of maat) store().update(agent.id, { enabled: false });
  const lone = store().create({ name: "Lone Sentinel" });
  store().assignExecutive(lone.id, "maat");
  const task = store().recordTask(lone.id, { label: "audit secrets", status: "failed", error: "x", executive: "maat" });
  store().update(lone.id, { enabled: false });
  try {
    const result = await Shaman.getInstance().resume(lone.id, task.id);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /unavailable and no available agent in the maat galaxy/);
  } finally {
    for (const agent of maat) store().update(agent.id, { enabled: true });
  }
});

/* -------------------------------- Cosmos ------------------------------- */

test("the Cosmos draws each agent in its owner's galaxy and lights only the working agent's galaxy", async () => {
  const { default: CosmosStore } = await import("../src/app/scene/genesis/cosmos/CosmosStore");
  const AgentEventBus = (await import("../src/core/agent/AgentEvents")).default;
  const cosmos = CosmosStore.getInstance();
  try {
    const state = cosmos.getState();
    const galaxyOf = (templateId: string) => {
      const agent = store().list().find((item) => item.templateId === templateId)!;
      return state.agentUniverses.find((universe) => universe.runtimeId === agent.id)!.parentId;
    };
    assert.equal(galaxyOf("builder"), "exec-engineer");
    assert.equal(galaxyOf("researcher"), "exec-sage");
    assert.equal(galaxyOf("designer"), "exec-governor");
    assert.equal(galaxyOf("marketing"), "exec-caretaker");
    const parents = new Set(state.agentUniverses.map((universe) => universe.parentId));
    assert.ok(parents.size >= 3, "agents are spread across galaxies, not piled into one");

    const builder = store().list().find((item) => item.templateId === "builder")!;
    const before = new Map(cosmos.getState().executiveGalaxies.map((galaxy) => [galaxy.id, galaxy.activity.lastActive]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    AgentEventBus.getInstance().emit({ type: "agent_started", taskId: "cosmos-t", agent: builder.name, objective: "x" });
    const after = cosmos.getState().executiveGalaxies;
    const lit = after.filter((galaxy) => galaxy.activity.lastActive !== before.get(galaxy.id)).map((galaxy) => galaxy.id);
    assert.deepEqual(lit, ["exec-engineer"], "only the working agent's galaxy");
  } finally {
    cosmos.destroy();
  }
});

/* ------------------- SHAMAN from chat: the model's tools ------------------- */

test("a model tool call reaches SHAMAN: agent_delegate routes, runs, and returns the result to the conversation", async () => {
  const { dispatchToolCall, executableToolIds } = await import("../src/core/tools/ToolDispatcher");
  for (const id of ["agent.delegate", "agent.status", "agent.resume"]) {
    assert.ok(executableToolIds().includes(id), `${id} is runnable, not just registered`);
  }
  const restore = stubDelegate(async (agentName, task) => ok(`${agentName} did: ${task}`));
  try {
    const result = await dispatchToolCall(
      { id: "d1", name: "agent_delegate", arguments: { objective: "Render a photoreal product shot of the ring" } },
      "turn-1",
    );
    assert.equal(result.ok, true, result.content);
    assert.match(result.content, /SHAMAN routed it to .* \(engineering\): matched/);
    assert.match(result.content, /did: Render a photoreal product shot/);

    const status = await dispatchToolCall({ id: "d2", name: "agent_status", arguments: {} }, "turn-1");
    assert.match(status.content, /\[complete\] .* \(engineering\): "Render a photoreal product shot of the ring".*assigned by lelu; routed: matched/);

    const unknown = await dispatchToolCall({ id: "d3", name: "agent_delegate", arguments: { objective: "x", agent: "Nobody Atall" } }, "turn-1");
    assert.equal(unknown.ok, false);
    assert.match(unknown.content, /no agent called "Nobody Atall"\. Nothing was run/);
  } finally {
    restore();
  }
});

test("agent_resume continues interrupted work through SHAMAN", async () => {
  const { dispatchToolCall } = await import("../src/core/tools/ToolDispatcher");
  const agent = store().runnable().find((item) => executiveOf(item) === "architect")!;
  const task = store().recordTask(agent.id, { label: "map the voice subsystem", status: "running", delegatedBy: "user", executive: "architect" });
  restart();
  const restore = stubDelegate(async () => ok("Mapped."));
  try {
    const result = await dispatchToolCall({ id: "r1", name: "agent_resume", arguments: { taskId: task.id } }, "turn-2");
    assert.equal(result.ok, true, result.content);
    assert.match(result.content, /Resumed — .* \(architect\): resumed by its own agent/);
    const old = store().get(agent.id)!.tasks.find((item) => item.id === task.id)!;
    assert.equal(old.status, "interrupted");
    assert.ok(old.resumedBy);
  } finally {
    restore();
  }
});
