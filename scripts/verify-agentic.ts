/**
 * ==========================================================
 * LÉLU — LIVE AGENCY VERIFICATION
 *
 * Exercises the agentic path against the REAL model provider
 * chain (Anthropic first). Nothing is scripted except the
 * test tool used to show the approval gate:
 *
 *   A  plan: a real model turns a request into a plan, which
 *      is validated against live capabilities
 *   B  execute: real tools, a real reasoning step, a real
 *      agent delegation — verified step by step
 *   C  approval: a sensitive step pauses; the decision (as the
 *      timeline UI emits it) resumes it
 *   D  model-driven agency: in an ordinary chat turn the model
 *      itself calls capability.discover / task.start
 *   E  reflection over what just happened
 *
 * Usage:  npx tsx scripts/verify-agentic.ts
 * Needs a provider credential (e.g. LELU_ANTHROPIC_API_KEY).
 * Spends a few model calls.
 * ==========================================================
 */

// -- browser storage shim: KvStore persists through localStorage --
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
};

// -- in-memory IndexedDB (Brain's long-term store), same shim as verify-tool-execute --
const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
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
(globalThis as Record<string, unknown>).indexedDB = {
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

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

async function main(): Promise<void> {
  const [{ default: AIService }, { default: ToolRegistry }, dispatcher, { registerAgenticTools }, planner, { default: TaskExecutor },
    { default: AgentStore }, { default: AgentEventBus }, { default: DailyReflection }, { default: ProjectStore }] =
    await Promise.all([
      import("../src/core/AIService"),
      import("../src/core/tools/ToolRegistry"),
      import("../src/core/tools/ToolDispatcher"),
      import("../src/core/agentic/AgenticTools"),
      import("../src/core/agentic/TaskPlanner"),
      import("../src/core/agentic/TaskExecutor"),
      import("../src/core/agents/AgentStore"),
      import("../src/core/agent/AgentEvents"),
      import("../src/core/agentic/DailyReflection"),
      import("../src/core/projects/ProjectStore"),
    ]);

  registerAgenticTools();
  ToolRegistry.getInstance().updateAvailability("project.manage", true);
  const ai = AIService.getInstance();
  await ai.initialize();
  const executor = TaskExecutor.getInstance();
  const id = Math.random().toString(36).slice(2, 7);

  // ---- A + B: real planning, real execution ----
  const analyst = AgentStore.getInstance().create({
    name: `Reviewer ${id}`,
    role: "reviewer",
    description: "Checks a short statement and replies with one sentence.",
    instructions: "Reply in one short sentence.",
  });
  AgentStore.getInstance().setEnabled(analyst.id, true);

  const projectName = `Live ${id}`;
  const goal =
    `Create a project named "${projectName}", then list projects to confirm it exists, ` +
    `then ask the agent "${analyst.name}" to state in one sentence that the project was created.`;
  const plan = await planner.planTask(goal);
  check("A plan from a real model", plan.ok, plan.ok
    ? `${plan.validation!.steps.length} steps: ${plan.validation!.steps.map((s) => (s.action.kind === "tool" ? s.action.tool : s.action.kind === "agent" ? `agent:${s.action.agent}` : "reason")).join(" → ")} (attempts ${plan.attempts})`
    : plan.reason ?? "no plan");

  if (plan.ok) {
    const task = planner.createTask(goal, plan.validation!, "verify");
    const done = await executor.run(task.id);
    const created = ProjectStore.getInstance().list().some((p) => p.name === projectName);
    check("B executed and verified", done?.status === "completed" && created, `status ${done?.status}; project really exists: ${created}`);
    console.log(done ? executor.report(done).split("\n").map((l) => `      ${l}`).join("\n") : "");
  }

  // ---- C: approval gate with a sensitive tool ----
  const sensitiveId = `verify.send${id}`;
  const sent: unknown[] = [];
  dispatcher.registerExecutor(
    { id: sensitiveId, parameters: { type: "object", properties: { message: { type: "string" } } }, run: async (args) => { sent.push(args); return { ok: true, content: "sent" }; } },
    { id: sensitiveId, name: "Send (test)", description: "Sends a message outside LÉLU", category: "Test", permissions: ["EXTERNAL_ACTION"], riskLevel: 3, available: true },
  );
  const approvalTask = planner.createTask("send a message", planner.validatePlan([{ title: "Send", tool: sensitiveId, args: { message: "hello" } }]), "verify");
  const waiting = await executor.run(approvalTask.id);
  const statusBeforeDecision = waiting?.status;
  const beforeApproval = sent.length;
  AgentEventBus.getInstance().emit({ type: "approval_resolved", taskId: approvalTask.id, approvalId: waiting!.steps[0].approvalId!, decision: "approved" });
  await new Promise((r) => setTimeout(r, 0));
  const approved = await executor.settled(approvalTask.id);
  check("C approval gate", statusBeforeDecision === "waiting" && beforeApproval === 0 && approved?.status === "completed" && sent.length === 1,
    `paused=${statusBeforeDecision}; ran before approval=${beforeApproval}; after approval=${approved?.status}, ran ${sent.length}×`);

  // ---- D: the model uses the agency tools by itself in a chat turn ----
  const used: string[] = [];
  const stop = AgentEventBus.getInstance().subscribe((event) => {
    if (event.type === "tool_result") used.push(`${event.tool}:${event.status ?? "?"}`);
  });
  const response = await ai.chat(
    "Use your task.start tool to run this two-step plan, then tell me the result in one sentence: " +
      'step s1 calls capability.discover with {"query":"agent"}; step s2 calls agent.list. ' +
      "Report how many capabilities s1 found.",
  );
  stop();
  const startedTask = used.find((u) => u.startsWith("task.start"));
  check("D model-driven task.start in chat", Boolean(startedTask) && used.some((u) => u.startsWith("capability.discover")),
    `provider ${response.provider}; tools: ${used.join(", ") || "none"}; reply: ${response.text.slice(0, 200).replace(/\s+/g, " ")}`);

  // ---- E: reflection ----
  const reflection = await DailyReflection.getInstance().run("on-request");
  check("E reflection", reflection.tasks.total >= 2, reflection.summary.slice(0, 220));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} live checks passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
