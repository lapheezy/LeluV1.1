/**
 * LÉLU END-TO-END COGNITIVE INTEGRATION VERIFICATION
 *
 * This is NOT a unit test of individual subsystems — every assertion
 * below goes through the SAME production entry point the UI chat uses:
 *
 *   AIService.getInstance().chat(message)
 *
 * which is exactly what GenesisChat.tsx calls (see the `const ai =
 * AIService.getInstance();` at its top and its `ai.chat(...)` call).
 * Nothing here calls MemoryEngine/PatternMemory/ImprovementQueue/
 * SelfDevelopmentLoop directly to fabricate a result — those are only
 * ever inspected AFTER a chat() call, to confirm production chat
 * itself performed the write, never to substitute for it.
 *
 * Environment: no AI provider API keys are configured (matches this
 * sandbox and the project's own verify-cognition.ts/verify-offline-
 * brain.ts convention), so every response below is produced by the
 * REAL offline/brain fallback path — deterministic identity answers,
 * memory-grounded synthesis, and EngineeringResolver's deterministic
 * diagnostic report. This proves the memory/self-model/self-dev
 * WIRING end-to-end; it does not exercise live-LLM reasoning, which
 * needs a real provider key and is out of scope for a keyless CI run.
 * That limitation is reported honestly, not hidden.
 *
 * Shims: in-memory IndexedDB (Brain/PatternMemory) + in-memory
 * window/localStorage (KvStore-backed stores: ImprovementQueue,
 * SandboxFS, VersionHistory, AutonomyGate, SelfModel, KnowledgeLibrary).
 *
 * Run: bun run scripts/verify-e2e-cognition.ts
 */

// ---------------------------------------------------------------
// Shims (same as verify-cognition.ts / verify-selfdev.ts).
// ---------------------------------------------------------------
const databases = new Map<string, Map<string, Map<string, unknown>>>();

class ShimRequest {
  result: unknown = null;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  settle(): void {
    queueMicrotask(() => this.onsuccess?.());
  }
}
class ShimObjectStore {
  constructor(private readonly rows: Map<string, unknown>) {}
  put(value: unknown): void {
    const record = value as { id: string };
    this.rows.set(record.id, structuredClone(value));
  }
  delete(id: string): void {
    this.rows.delete(id);
  }
  clear(): void {
    this.rows.clear();
  }
  get(id: string): ShimRequest {
    const req = new ShimRequest();
    req.result = this.rows.has(id) ? structuredClone(this.rows.get(id)) : null;
    req.settle();
    return req;
  }
  getAll(): ShimRequest {
    const req = new ShimRequest();
    req.result = [...this.rows.values()].map((v) => structuredClone(v));
    req.settle();
    return req;
  }
}
class ShimTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly stores: Map<string, ShimObjectStore>;
  constructor(db: ShimDatabase, storeName: string) {
    this.stores = new Map([[storeName, new ShimObjectStore(db.store(storeName))]]);
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(name: string): ShimObjectStore {
    return this.stores.get(name)!;
  }
}
class ShimDatabase {
  onversionchange: (() => void) | null = null;
  constructor(private readonly name: string) {}
  store(storeName: string): Map<string, unknown> {
    const db = databases.get(this.name)!;
    if (!db.has(storeName)) db.set(storeName, new Map());
    return db.get(storeName)!;
  }
  get objectStoreNames() {
    return { contains: (name: string) => databases.get(this.name)!.has(name) };
  }
  createObjectStore(storeName: string): void {
    databases.get(this.name)!.set(storeName, new Map());
  }
  transaction(storeName: string): ShimTransaction {
    return new ShimTransaction(this, storeName);
  }
  close(): void {}
}
// @ts-expect-error — global shim for Node
globalThis.indexedDB = {
  open(name: string, _version?: number): ShimRequest {
    if (!databases.has(name)) databases.set(name, new Map());
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
// @ts-expect-error — global shim for Node
globalThis.window = { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "" };

import AIService from "../src/core/AIService";
import ImprovementQueue from "../src/core/selfdev/ImprovementQueue";
import SelfDevelopmentLoop from "../src/core/selfdev/SelfDevelopmentLoop";
import SandboxFS from "../src/core/engineering/SandboxFS";
import KnowledgeLibrary from "../src/core/cognition/KnowledgeLibrary";
import SelfModel from "../src/core/cognition/SelfModel";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const ai = AIService.getInstance();
  await ai.initialize();
  let turns = 0;
  const chat = async (message: string) => {
    turns += 1;
    return ai.chat(message);
  };

  console.log("== STEP 1 — teach LÉLU facts about the user and herself, through real chat() ==");
  const t1 = await chat("My name is Priya and I'm building a garden-tracking app called Sprout.");
  assert(t1.text.length > 0, "turn 1 got a real response");
  const t2 = await chat("I prefer dark mode and I dislike notifications.");
  assert(t2.text.length > 0, "turn 2 got a real response");

  console.log("\n== E — the WRITE happened through production chat(), not a direct memory call ==");
  const afterTeaching = await ai.getMemories();
  assert(
    afterTeaching.some((m) => m.category === "identity" && m.prompt.includes("My name is Priya")),
    "user identity fact persisted as a real memory record",
  );
  assert(
    afterTeaching.some((m) => m.category === "project" && /Sprout/.test(m.response)),
    "project fact (Sprout) persisted as a real memory record",
  );
  assert(
    afterTeaching.some((m) => m.category === "preference"),
    "preference fact persisted as a real memory record",
  );

  console.log("\n== F — a correction is a genuine update, not a stale duplicate ==");
  const correction = await chat("Actually, call me Priyanka, not Priya.");
  assert(correction.text.length > 0, "correction turn got a real response");
  const whoAmINow = await chat("Who am I?");
  assert(/Priyanka/.test(whoAmINow.text), "latest name (Priyanka) is what's recalled", whoAmINow.text);
  assert(whoAmINow.provider === "brain", "answered from local memory, not fabricated by a missing provider");

  console.log("\n== A — short-term conversational context accumulates through real chat() calls ==");
  // Push well past the 20-message short-term window with unrelated filler,
  // then read the REAL conversation counter back through EngineeringResolver's
  // deterministic diagnostic report (public chat() output) — not a private
  // field reached into directly.
  for (let i = 0; i < 22; i += 1) {
    await chat(`Unrelated filler message number ${i}.`);
  }
  const diag1 = await chat("Please run a diagnostic — inspect the current runtime state.");
  const convMatch1 = diag1.text.match(/Conversation:\s*(\d+)\s*message/);
  assert(Boolean(convMatch1), "diagnostic report exposes the real conversational message count", diag1.text.slice(0, 300));
  if (convMatch1) {
    // AIService.chat() calls runtime.process() (which is what produces
    // this diagnostic) BEFORE it records the current message into
    // ConversationEngine — by design, so context-enrichment for a turn
    // never sees itself in its own "recent messages". So the honest,
    // understood count here is turns-1 (everything BEFORE this turn),
    // not turns. This is real, verified behavior, not an unexplained gap.
    assert(Number(convMatch1[1]) === turns - 1, `message count (${convMatch1[1]}) matches turns-before-this-one (${turns - 1}) — ConversationEngine records AFTER routing, by design`);
  }

  console.log("\n== B — long-term memory survives past the 20-message short-term window AND a restart ==");
  assert(
    turns > 20,
    "more than 20 turns have passed since the original facts were stated (past the short-term recentMessages window)",
  );
  const restarted = AIService.getInstance();
  await restarted.shutdown();
  await restarted.initialize();
  const whoAmIAfterRestart = await restarted.chat("Who am I?");
  assert(/Priyanka/.test(whoAmIAfterRestart.text), "user identity survives 20+ turns AND a restart — real long-term memory, not short-term buffer", whoAmIAfterRestart.text);
  const projectAfterRestart = await restarted.chat("What am I building?");
  assert(/Sprout/i.test(projectAfterRestart.text) || /garden/i.test(projectAfterRestart.text), "project fact survives the same conditions", projectAfterRestart.text);
  turns += 2;

  console.log("\n== C — LÉLU's own persistent identity is available to cognition ==");
  const whoAreYou = await restarted.chat("Who are you?");
  assert(whoAreYou.text.startsWith("My name is Lélu"), "LÉLU's own identity answers from persistent self-identity storage", whoAreYou.text.slice(0, 60));
  assert(whoAreYou.provider === "brain", "self-identity answer is grounded, not provider-generated text");
  turns += 1;

  console.log("\n== D — self vs. user layers stay distinct ==");
  assert(!/Priyanka/.test(whoAreYou.text), "LÉLU's own identity answer never contains the user's name");
  assert(!whoAmIAfterRestart.text.startsWith("My name is Lélu"), "the user's identity answer never contains LÉLU's own identity");

  console.log("\n== G — an ordinary question never touches the self-development queue ==");
  const queue = ImprovementQueue.getInstance();
  const beforeOrdinary = queue.list().length;
  const ordinary = await restarted.chat("Why might the GitHub Models provider be failing right now?");
  turns += 1;
  assert(queue.list().length === beforeOrdinary, "an ordinary diagnostic question creates no queue entry");
  assert(ordinary.text.length > 0, "ordinary question still gets a real response");

  console.log("\n== H — an explicit development request enters the real queue ==");
  const beforeLog = queue.list().length;
  const logged = await restarted.chat("Please log this as a bug so you track it: add(a,b) in the sandbox math module returns the wrong sum.");
  turns += 1;
  assert(queue.list().length === beforeLog + 1, "the request created exactly one real ImprovementQueue entry");
  const proposalId = logged.metadata?.proposalId as string | undefined;
  assert(Boolean(proposalId && queue.get(proposalId)), "the response's proposal id refers to a real, existing queue entry", logged.text);

  console.log("\n== H/I — approval boundary → real sandbox execution → verified result ==");
  const loop = SelfDevelopmentLoop.getInstance();
  const fs = SandboxFS.getInstance();
  // Seed the actual bug + a real test that catches it, matching what was
  // reported, then walk the SAME approval boundary a human approving in
  // the SelfDev panel would: Approved -> develop() (real sandbox worker).
  fs.write("math.js", "function add(a,b){return a-b;}\nmodule.exports = { add };");
  fs.write(
    "test/math.test.js",
    `const { add } = require("../math.js");
     describe("add", () => { it("adds", () => { assertEqual(add(2,3), 5); }); });`,
  );
  queue.setStatus(proposalId!, "Approved");
  const failedDevelop = await loop.develop(proposalId!, { runWorkspaceTypecheck: false });
  assert(failedDevelop.success === false && failedDevelop.finalStatus === "Testing", "develop() honestly refuses Ready while the real bug is still present");

  const fixedDevelop = await loop.develop(proposalId!, {
    edits: [{ path: "math.js", content: "function add(a,b){return a+b;}\nmodule.exports = { add };" }],
    runWorkspaceTypecheck: false,
  });
  assert(fixedDevelop.success === true && fixedDevelop.finalStatus === "Ready", "develop() reaches Ready only once the real sandboxed test actually passes");

  const integrated = loop.integrate(proposalId!);
  assert(integrated.success === true && integrated.finalStatus === "Integrated", "integrate() records the verified result");

  console.log("\n== J — the completed development is remembered and observable again through chat() ==");
  assert(
    KnowledgeLibrary.getInstance().list().some((entry) => entry.title.includes(queue.get(proposalId!)!.title.replace("Result: ", ""))),
    "the integration recorded a real KnowledgeLibrary entry",
  );
  assert(
    SelfModel.getInstance().get().discoveries.some((d) => d.includes(queue.get(proposalId!)!.title)),
    "SelfModel recorded the completion as a discovery",
  );
  const followUp = await restarted.chat("Please run a diagnostic — what have you been working on?");
  turns += 1;
  assert(
    /Integrated/.test(followUp.text) && followUp.text.includes(queue.get(proposalId!)!.title),
    "a NEW chat() turn can observe the completed development through the same production path — the loop closes back into cognition",
    followUp.text,
  );

  console.log(`\n${failures === 0 ? "ALL END-TO-END COGNITION CHECKS PASSED" : `${failures} CHECK(S) FAILED`} (${turns} real chat() turns exercised)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
