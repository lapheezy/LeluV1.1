/**
 * ==========================================================
 * LÉLU — MISSION 3: SHE READS THE CONVERSATION AND HERSELF, NOT THE WEB
 *
 * CATEGORY: offline, deterministic. No model, no network (fetch is stubbed
 * where a probe would run). Every case below is a failure MEASURED in the
 * Mission 3 audit (full startup registry, 179 tools; production Supabase
 * edge logs), pinned so it cannot quietly return:
 *
 *   · "…identify blockers … find solutions" was a MISSION RESUME → only the
 *     four ledger tools: no conversation, memory or self-inspection
 *   · "Why isn't Supabase working" was offered web research and unrelated
 *     3D tools, never a tool that reads her live state
 *   · a description repeating "out" ("find out") outranked relevant tools
 *   · "Review …" vs "review …" routed differently (case-sensitive patterns)
 *   · conversation references were planned without the conversation
 *   · a key the project rejects (401) was reported as "signed_out"
 *   · the OG archive swallowed 401 as "no memories" and retried every turn
 * ==========================================================
 */
import assert from "node:assert/strict";
import test from "node:test";

import { isMissionResume } from "../src/core/router/continuationContext";
import {
  CONVERSATION_REFERENCE,
  SELF_DIAGNOSIS_REQUEST,
  selectToolSchemas,
} from "../src/core/tools/ToolSchemas";
import type { ToolSchema } from "../src/providers/AIProvider";
import { persistenceClaim, type PersistenceObservation } from "../src/core/cognition/OperationalSelfModel";
import { OgArchiveProvider, type ArchiveClient } from "../src/core/memory/providers";
import SupabasePersistence from "../src/core/persistence/SupabasePersistence";
import { resetPublicEnv } from "../src/core/env/publicEnv";
import Orchestrator from "../src/core/orchestrator/Orchestrator";
import { bareActionTool, cleanAssistantText } from "../src/core/router/ToolMarkup";

const SCENARIO = {
  A: "Review everything we've discussed about LÉLU and tell me what's still broken.",
  blockers: "Figure out what we've discussed, identify blockers and problems, and find solutions.",
  B: "Find out why Supabase isn't working and fix it.",
  C: "Find the latest free tools that can improve our offline 3D pipeline.",
  D: "Investigate the current production voice failure and fix it.",
  E: "What can you actually do right now?",
  F: "Do the second thing you recommended.",
};

/* ------------------------------ intent ------------------------------ */

test("a turn naming blockers is not a mission resume unless it names the mission", () => {
  assert.equal(isMissionResume(SCENARIO.blockers), false);
  assert.equal(isMissionResume("Resume the blocked Mission 14 workstream and read its brief"), true);
  assert.equal(isMissionResume("pick up m-3f9a2c where we left it"), true);
  assert.equal(isMissionResume("write me a short poem about the sea"), false);
});

test("references to this conversation are recognised", () => {
  for (const prompt of [SCENARIO.A, SCENARIO.blockers, SCENARIO.F, "recap where we are", "what's left from what you suggested?"]) {
    assert.ok(CONVERSATION_REFERENCE.test(prompt), prompt);
  }
  for (const prompt of ["write me a short poem about the sea", SCENARIO.C, "what is the capital of Peru?"]) {
    assert.ok(!CONVERSATION_REFERENCE.test(prompt), prompt);
  }
});

test("a problem with one of her own systems is recognised as self-diagnosis", () => {
  for (const prompt of [SCENARIO.B, SCENARIO.D, "the engineering agent returns 503, why?", "is my memory working?"]) {
    assert.ok(SELF_DIAGNOSIS_REQUEST.test(prompt), prompt);
  }
  for (const prompt of [SCENARIO.C, "draw me a cat", "tell me about the history of Rome"]) {
    assert.ok(!SELF_DIAGNOSIS_REQUEST.test(prompt), prompt);
  }
});

/* --------------------------- tool selection -------------------------- */

const schema = (name: string, description: string): ToolSchema => ({
  name,
  description,
  parameters: { type: "object", properties: {} },
});

/** Real names; descriptions as the registry gives them (noise tools verbatim where it mattered). */
const SCHEMAS: ToolSchema[] = [
  schema("system_config", "Report which capabilities are configured and which environment variable is missing. (category: System)"),
  schema("capabilities_list", "List capabilities. (category: System)"),
  schema("capabilities_activate", "Switch a capability on. (category: System)"),
  schema("self_operational", "Her live operational state: providers probed now, tools, agents, missions. (category: Self)"),
  schema("self_changes", "Every recent change to my code and assets from git, plus the journal. (category: Self)"),
  schema("self_run_status", "Status of a playbook run. (category: Self)"),
  schema("memory_recall", "Recall memories relevant to a query. (category: Memory)"),
  schema("memory_store", "Store a memory. (category: Memory)"),
  schema("chats_read", "Read another conversation's messages. (category: Chats)"),
  schema("chats_list", "List conversations. (category: Chats)"),
  schema("mission_list", "List recorded workstreams. (category: Continuity)"),
  schema("mission_find", "Find a recorded workstream. (category: Continuity)"),
  schema("mission_record", "Record a workstream. (category: Continuity)"),
  schema("mission_update", "Advance a workstream. (category: Continuity)"),
  schema("mission_brief", "Brief of a workstream. (category: Continuity)"),
  schema("research_web", "Search the web and read sources. (category: Research)"),
  schema("repo_research", "Research a GitHub repository. (category: Research)"),
  schema("kb_search", "Search the knowledge base. (category: Research)"),
  schema("tools_catalog", "Catalog of tools: offline, browser or server. (category: System)"),
  schema("capability_discover", "Words to match against ids, names and descriptions. (category: System)"),
  schema("device_capabilities", "What this device can run: WebGPU, WebGL, codecs. (category: System)"),
  schema("resources_discover", "Discover free open-source tools and libraries for a missing capability. (category: Resources)"),
  schema("resources_gaps", "List missing capabilities. (category: Resources)"),
  schema(
    "cosmos_object_split",
    "Split one part of an object out as its own object — the crankshaft out of an engine, a seat out of a chair, a panel out of a garment — keeping its material and where it stood. Local and undoable. (category: COSMOS)",
  ),
  schema("cosmos_object_remove", "Remove an object from the world. Why it is not working is not checked. (category: COSMOS)"),
  schema("world_promote", "Promote a draft object into the world. (category: World)"),
  schema("studio_deploy", "Deploy a studio project to production. (category: Studio)"),
];

const names = (prompt: string) => selectToolSchemas(SCHEMAS, prompt).map((item) => String(item.name));
const NOISE = ["cosmos_object_split", "cosmos_object_remove", "world_promote", "studio_deploy"];

test("a Supabase failure gets her live self-inspection tools, and no unrelated ones", () => {
  const offered = names(SCENARIO.B);
  for (const tool of ["self_operational", "system_config", "self_changes"]) assert.ok(offered.includes(tool), `${tool} in ${offered}`);
  for (const tool of NOISE) assert.ok(!offered.includes(tool), `${tool} must not be offered: ${offered}`);
});

test("a production voice failure gets self-inspection, not deploy or 3D tools", () => {
  const offered = names(SCENARIO.D);
  assert.ok(offered.includes("self_operational") && offered.includes("self_run_status"), String(offered));
  for (const tool of NOISE) assert.ok(!offered.includes(tool), `${tool} must not be offered: ${offered}`);
});

test("reviewing the conversation keeps conversation, memory and ledger tools together", () => {
  for (const prompt of [SCENARIO.A, SCENARIO.blockers, SCENARIO.F]) {
    const offered = names(prompt);
    for (const tool of ["chats_read", "memory_recall", "self_operational", "mission_list"]) {
      assert.ok(offered.includes(tool), `${prompt}: ${tool} in ${offered}`);
    }
    for (const tool of NOISE) assert.ok(!offered.includes(tool), `${prompt}: ${tool} must not be offered`);
  }
});

test("'what can you actually do' reaches the self-model and the catalog", () => {
  const offered = names(SCENARIO.E);
  for (const tool of ["self_operational", "tools_catalog", "device_capabilities"]) assert.ok(offered.includes(tool), String(offered));
});

test("'free tools' (plural) reaches resource discovery", () => {
  assert.ok(names(SCENARIO.C).includes("resources_discover"), String(names(SCENARIO.C)));
});

test("self_operational alone does not pin the six ledger tools on a diagnosis turn", () => {
  const offered = names(SCENARIO.B);
  assert.ok(!offered.includes("mission_record") && !offered.includes("mission_update"), String(offered));
});

/* ------------------------------ routing ------------------------------ */

test("multi-step detection does not depend on the first letter's case", () => {
  const orchestrator = Orchestrator.getInstance() as unknown as { isMultiStepRequest(request: string): boolean };
  assert.equal(orchestrator.isMultiStepRequest("Review the deployment logs"), true);
  assert.equal(orchestrator.isMultiStepRequest("review the deployment logs"), true);
  assert.equal(orchestrator.isMultiStepRequest("hello there"), false);
});

/* ---------------------------- persistence ---------------------------- */

const observation = (over: Partial<PersistenceObservation>): PersistenceObservation => ({
  status: "signed_out",
  keyVerdict: "unverified",
  keyCheckedAt: 1_000,
  signedIn: false,
  configError: null,
  ...over,
});

test("the self-model states persistence from the project's answer, not from configuration", () => {
  assert.equal(persistenceClaim(observation({ status: "disabled", keyVerdict: "unverified" }), 1).state, "BLOCKED");
  const rejected = persistenceClaim(observation({ status: "degraded", keyVerdict: "rejected" }), 1);
  assert.equal(rejected.state, "UNAVAILABLE");
  assert.match(rejected.statement, /^FAILED/);
  // Signed in is not live: only a completed load from the project is.
  const notLoaded = persistenceClaim(observation({ status: "connected", keyVerdict: "valid", signedIn: true }), 1);
  assert.equal(notLoaded.state, "PARTIAL");
  assert.match(notLoaded.statement, /may be the local cache/);
  const loaded = persistenceClaim(
    observation({ status: "connected", keyVerdict: "valid", signedIn: true, hydration: { core: true, coreAt: 5_000, history: false } }),
    1,
  );
  assert.equal(loaded.state, "VERIFIED");
  assert.match(loaded.statement, /history still loading/);
  const degraded = persistenceClaim(
    observation({ status: "degraded", keyVerdict: "valid", signedIn: true, hydration: { core: false, coreAt: null, history: false } }),
    1,
  );
  assert.equal(degraded.state, "PARTIAL");
  assert.match(degraded.statement, /load from the project failed/);
  const signedOut = persistenceClaim(observation({ keyVerdict: "valid" }), 1);
  assert.equal(signedOut.state, "PARTIAL");
  assert.match(signedOut.statement, /no one is signed in/);
  assert.equal(persistenceClaim(observation({ keyVerdict: "unreachable" }), 1).state, "PARTIAL");
});

test("a key the project rejects is reported as degraded with the operator's explanation, not 'signed out'", async () => {
  const names = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const probed: string[] = [];
  process.env.VITE_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_rejected_key";
  resetPublicEnv();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    probed.push(String(input));
    return new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const persistence = SupabasePersistence.getInstance();
  try {
    persistence.resetForTests();
    await persistence.initialize();
    assert.deepEqual(probed, [], "initialize() stays network-free");
    assert.equal(await persistence.verifyKey(), "rejected");
    assert.equal(persistence.getStatus(), "degraded");
    assert.equal(persistence.getKeyVerdict().verdict, "rejected");
    assert.match(String(persistence.getAuthState().configError), /not valid for the configured project/);
    assert.ok(probed.some((url) => url.endsWith("/auth/v1/settings")), String(probed));
    assert.ok(!probed.some((url) => url.includes("sb_publishable_test_rejected_key")), "the key never appears in a URL");
  } finally {
    persistence.resetForTests();
    globalThis.fetch = originalFetch;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetPublicEnv();
  }
});

test("the OG archive stops retrying a rejected key and says why, instead of returning 'no memories'", async () => {
  let reads = 0;
  const failing = {
    select() { return this; },
    order() { return this; },
    or() { return this; },
    limit() {
      reads += 1;
      return Promise.resolve({ data: null, error: { message: "Invalid API key" } });
    },
  };
  const client: ArchiveClient = {
    from: () => failing,
    auth: { getSession: async () => ({ data: { session: null } }) },
  };
  const provider = new OgArchiveProvider(() => client);
  assert.equal(provider.isAvailable(), true);
  assert.deepEqual(await provider.context("supabase memory", 4), []);
  const readsAfterFirstTurn = reads;
  assert.equal(readsAfterFirstTurn, 1, "the turn that learns the key is rejected must not also run the server query");
  assert.equal(provider.isAvailable(), false);
  assert.match(String(provider.lastFailure()), /rejected this deployment's key/);
  assert.deepEqual(await provider.context("another turn", 4), []);
  assert.equal(reads, readsAfterFirstTurn, "no further round trips once the key is known to be rejected");
});

/* --------------------------- user-facing text --------------------------- */


test("an action payload is never shown as her answer, whichever tool it names", () => {
  for (const raw of [
    '{"tool":"repo.acquire","arguments":{"repository":"?"}}',
    '```json\n{"name":"self_operational","arguments":{}}\n```',
    '[{"action":"memory.recall","args":{"query":"blockers"}},{"action":"chats.read","args":{}}]',
  ]) {
    assert.ok(bareActionTool(raw), raw);
    const shown = cleanAssistantText(raw);
    assert.doesNotMatch(shown, /[{}]/, shown);
    assert.match(shown, /nothing was done/);
  }
});

test("JSON a person asked for, and prose that mentions a tool, are left alone", () => {
  for (const kept of [
    '{"name":"my-app","version":"1.0.0","scripts":{"dev":"vite"}}',
    '{"name":"lelu","parameters":{"temperature":0.2}}',
    "I checked memory.recall and found nothing about Supabase.",
  ]) {
    assert.equal(bareActionTool(kept), null, kept);
    assert.equal(cleanAssistantText(kept), kept);
  }
});
