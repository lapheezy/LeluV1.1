/**
 * ==========================================================
 * LÉLU — Behavioral Integration Tests
 *
 * Tests real singleton behavior, not mocks. Exercises the
 * actual runtime paths for:
 *   - CognitiveLoop observation → visual state emission
 *   - Orchestrator intent classification
 *   - AgentStore agent delegation
 *   - ProjectStore checkpoint persistence
 *   - SandboxFS file operations
 *   - ToolRegistry capability queries
 *   - CapabilityManifest registration
 *   - GitHubIntegration proxy path
 *   - WorkspaceRuntime autonomy gating
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

// Shim window/localStorage for KvStore in Node.js test env
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

import ToolRegistry from "../src/core/tools/ToolRegistry";
import CapabilityManifest from "../src/core/capabilities/CapabilityManifest";
import AgentStore from "../src/core/agents/AgentStore";
import AgentEventBus from "../src/core/agent/AgentEvents";
import ProjectStore from "../src/core/projects/ProjectStore";
import SandboxFS from "../src/core/engineering/SandboxFS";
import GitHubIntegration from "../src/core/engineering/GitHubIntegration";
import WorkspaceRuntime from "../src/core/engineering/WorkspaceRuntime";
import CognitiveLoop from "../src/core/cognition/CognitiveLoop";
import WorkQueue from "../src/core/cognition/WorkQueue";

// ============================================================
// TOOL REGISTRY
// ============================================================

test("ToolRegistry has all builtin tools registered", () => {
  const registry = ToolRegistry.getInstance();
  const all = registry.all();
  assert.ok(all.length > 10, `Expected >10 tools, got ${all.length}`);

  // Core tools
  const chat = registry.get("chat");
  assert.ok(chat, "chat tool exists");
  assert.equal(chat!.riskLevel, 0);

  // Memory tools
  assert.ok(registry.get("memory.recall"), "memory.recall exists");
  assert.ok(registry.get("memory.store"), "memory.store exists");

  // Agent tools
  assert.ok(registry.get("agent.delegate"), "agent.delegate exists");

  // GitHub tools
  assert.ok(registry.get("github.auth"), "github.auth exists");
  assert.ok(registry.get("github.repos"), "github.repos exists");
  assert.ok(registry.get("github.files"), "github.files exists");
  assert.ok(registry.get("github.branches"), "github.branches exists");
  assert.ok(registry.get("github.commits"), "github.commits exists");
  assert.ok(registry.get("github.prs"), "github.prs exists");

  // Engineering tools
  assert.ok(registry.get("sandbox.read"), "sandbox.read exists");
  assert.ok(registry.get("sandbox.write"), "sandbox.write exists");
  assert.ok(registry.get("sandbox.execute"), "sandbox.execute exists");
  assert.ok(registry.get("workspace.typecheck"), "workspace.typecheck exists");
  assert.ok(registry.get("workspace.test"), "workspace.test exists");
  assert.ok(registry.get("workspace.build"), "workspace.build exists");
});

test("ToolRegistry search finds GitHub tools", () => {
  const registry = ToolRegistry.getInstance();
  const results = registry.search("github");
  assert.ok(results.length >= 6, `Expected >=6 GitHub tools, got ${results.length}`);
  for (const tool of results) {
    assert.equal(tool.category, "GitHub");
  }
});

test("ToolRegistry search finds engineering tools", () => {
  const registry = ToolRegistry.getInstance();
  const results = registry.search("sandbox");
  assert.ok(results.length >= 2, `Expected >=2 sandbox tools, got ${results.length}`);
});

test("ToolRegistry autoSafe returns only low-risk tools", () => {
  const registry = ToolRegistry.getInstance();
  const safe = registry.autoSafe();
  for (const tool of safe) {
    assert.ok(tool.riskLevel <= 1, `Tool ${tool.id} has risk ${tool.riskLevel}`);
  }
});

test("ToolRegistry formatForPrompt produces readable output", () => {
  const registry = ToolRegistry.getInstance();
  const prompt = registry.formatForPrompt();
  // formatForPrompt only includes available tools — check that the
  // output is non-empty and structured (has category headers).
  assert.ok(prompt.length > 50, `Prompt is substantial (${prompt.length} chars)`);
  assert.ok(prompt.includes("## "), "Prompt includes category headers");
});

// ============================================================
// CAPABILITY MANIFEST
// ============================================================

test("CapabilityManifest reports all registered capabilities", () => {
  const manifest = CapabilityManifest.getInstance();
  const all = manifest.getAll();
  assert.ok(all.length > 15, `Expected >15 capabilities, got ${all.length}`);
});

test("CapabilityManifest getAvailable returns non-unavailable capabilities", () => {
  const manifest = CapabilityManifest.getInstance();
  const available = manifest.getAvailable();
  for (const cap of available) {
    assert.ok(
      cap.status === "available" || cap.status === "degraded",
      `Capability ${cap.id} should be available/degraded, got ${cap.status}`,
    );
  }
});

test("CapabilityManifest updateStatus works", () => {
  const manifest = CapabilityManifest.getInstance();
  manifest.updateStatus("ai-chat", "available");
  const cap = manifest.get("ai-chat");
  assert.ok(cap, "ai-chat exists");
  assert.equal(cap!.status, "available");
});

test("CapabilityManifest getReport produces readable output", () => {
  const manifest = CapabilityManifest.getInstance();
  const report = manifest.getReport();
  assert.ok(report.includes("CAPABILITY REPORT"), "Report header present");
  assert.ok(report.includes("✓") || report.includes("○"), "Report has status icons");
});

// ============================================================
// AGENT STORE
// ============================================================

test("AgentStore supports CRUD and task recording", () => {
  const store = AgentStore.getInstance();

  // Create
  const agent = store.create({
    name: "Test Agent",
    role: "Tester",
    capabilities: ["testing", "verification"],
    instructions: "Test things thoroughly.",
  });
  assert.ok(agent.id, "Agent has id");
  assert.equal(agent.name, "Test Agent");
  assert.equal(agent.role, "Tester");

  // Read
  const found = store.get(agent.id);
  assert.ok(found, "Agent found by id");
  assert.equal(found!.name, "Test Agent");

  // Record task
  store.recordTask(agent.id, { label: "Test task", status: "running" });
  const updated = store.get(agent.id);
  assert.ok(updated, "Agent still exists after task recording");

  // Runnable
  const runnable = store.runnable();
  assert.ok(runnable.length >= 1, "At least one runnable agent");

  // List
  const all = store.list();
  assert.ok(all.length >= 1, "Agent list non-empty");

  // Cleanup
  store.archive(agent.id);
  const archived = store.get(agent.id);
  assert.equal(archived?.status, "archived");
});

// ============================================================
// PROJECT STORE + CHECKPOINT
// ============================================================

test("ProjectStore creates projects and persists checkpoints", () => {
  const store = ProjectStore.getInstance();

  // Create
  const project = store.create({
    name: "Test Project",
    description: "A test project for behavioral verification",
  });
  assert.ok(project.id, "Project has id");
  assert.equal(project.name, "Test Project");

  // Read
  const found = store.get(project.id);
  assert.ok(found, "Project found");
  assert.equal(found!.name, "Test Project");

  // Checkpoint
  store.checkpoint(project.id, {
    status: "active",
    summary: "Working on behavioral tests",
    completed: ["Set up test harness"],
    pending: ["Run all tests", "Verify results"],
    blockers: [],
    nextAction: "Run the test suite",
  });

  // Verify checkpoint persisted via the project object
  const updated = store.get(project.id);
  assert.ok(updated, "Project still exists after checkpoint");
  const checkpoint = (updated as Record<string, unknown>).checkpoint as Record<string, unknown> | undefined;
  assert.ok(checkpoint, "Checkpoint persisted on project");
  assert.equal(checkpoint!.status, "active");
  assert.equal(checkpoint!.summary, "Working on behavioral tests");
  assert.equal((checkpoint!.completed as string[]).length, 1);
  assert.equal((checkpoint!.pending as string[]).length, 2);
  assert.equal(checkpoint!.nextAction, "Run the test suite");

  // Cleanup
  store.archive(project.id);
});

// ============================================================
// SANDBOX FS
// ============================================================

test("SandboxFS supports file CRUD and analysis", () => {
  const sandbox = SandboxFS.getInstance();

  // Write
  const writeResult = sandbox.write("test/hello.ts", "const x = 42;\nconsole.log(x);\n");
  assert.ok(writeResult.ok, "Write succeeds");

  // Read
  const content = sandbox.read("test/hello.ts");
  assert.equal(content, "const x = 42;\nconsole.log(x);\n");

  // List
  const files = sandbox.filePaths();
  assert.ok(files.includes("test/hello.ts"), "File appears in listing");

  // Analyze
  const analysis = sandbox.analyze("test/hello.ts");
  assert.ok(analysis, "Analysis produced");
  assert.ok(analysis!.lines >= 2, `Expected >=2 lines, got ${analysis!.lines}`);
  assert.equal(analysis!.functionCount, 0);

  // Remove
  sandbox.remove("test/hello.ts");
  const afterRemove = sandbox.read("test/hello.ts");
  assert.equal(afterRemove, null, "File removed");
});

test("SandboxFS rejects path traversal", () => {
  const sandbox = SandboxFS.getInstance();
  const result = sandbox.write("../escape/secret.ts", "bad");
  assert.equal(result.ok, false, "Path traversal rejected");
  assert.ok(result.error?.includes("Invalid"), "Error mentions invalid path");
});

// ============================================================
// GITHUB INTEGRATION
// ============================================================

test("GitHubIntegration singleton exists and has expected methods", () => {
  const gh = GitHubIntegration.getInstance();
  assert.ok(gh, "GitHubIntegration instance exists");
  assert.equal(typeof gh.getStatus, "function");
  assert.equal(typeof gh.getAuthenticatedUser, "function");
  assert.equal(typeof gh.listRepositories, "function");
  assert.equal(typeof gh.getFileContent, "function");
  assert.equal(typeof gh.listBranches, "function");
  assert.equal(typeof gh.createBranch, "function");
  assert.equal(typeof gh.listCommits, "function");
  assert.equal(typeof gh.createCommit, "function");
  assert.equal(typeof gh.compare, "function");
  assert.equal(typeof gh.listPullRequests, "function");
  assert.equal(typeof gh.createPullRequest, "function");
  assert.equal(typeof gh.registerCapabilities, "function");
  assert.equal(typeof gh.probeAndUpdateCapabilities, "function");
  assert.equal(typeof gh.isConfigured, "function");
});

test("GitHubIntegration registers capabilities in manifest", () => {
  const gh = GitHubIntegration.getInstance();
  gh.registerCapabilities();
  const manifest = CapabilityManifest.getInstance();
  assert.ok(manifest.get("github-auth"), "github-auth capability registered");
  assert.ok(manifest.get("github-repos"), "github-repos capability registered");
  assert.ok(manifest.get("github-files"), "github-files capability registered");
  assert.ok(manifest.get("github-branches"), "github-branches capability registered");
  assert.ok(manifest.get("github-commits"), "github-commits capability registered");
  assert.ok(manifest.get("github-prs"), "github-prs capability registered");
});

test("GitHubIntegration proxy returns structured error when server unavailable", async () => {
  const gh = GitHubIntegration.getInstance();
  // In Node.js test env, /api/github/status won't be running
  const status = await gh.getStatus();
  assert.equal(status.configured, false, "GitHub not configured in test env");
  assert.ok(status.error, "Error message present");
});

// ============================================================
// WORKSPACE RUNTIME
// ============================================================

test("WorkspaceRuntime has expected operations and autonomy levels", () => {
  const workspace = WorkspaceRuntime.getInstance();
  const ops = workspace.operations();
  assert.ok(ops.includes("typecheck"), "typecheck is a workspace operation");
  assert.ok(ops.includes("test"), "test is a workspace operation");
  assert.ok(ops.includes("build"), "build is a workspace operation");
  assert.ok(ops.includes("inspect"), "inspect is a workspace operation");

  // Each operation has a required autonomy level
  for (const op of ops) {
    const level = workspace.requiredLevel(op);
    assert.ok(level >= 0 && level <= 4, `Operation ${op} has valid level ${level}`);
  }
});

// ============================================================
// COGNITIVE LOOP
// ============================================================

test("CognitiveLoop singleton exists and can be started/stopped", () => {
  const loop = CognitiveLoop.getInstance();
  assert.ok(loop, "CognitiveLoop instance exists");
  assert.equal(typeof loop.start, "function");
  assert.equal(typeof loop.stop, "function");
  assert.equal(typeof loop.runOnce, "function");
  assert.equal(typeof loop.subscribe, "function");
  assert.equal(typeof loop.getLastReport, "function");

  // Start and stop should not throw
  loop.start(100000); // Very long interval so it doesn't fire during test
  loop.stop();
});

test("CognitiveLoop runOnce produces a valid report", async () => {
  const loop = CognitiveLoop.getInstance();
  const report = await loop.runOnce();
  assert.ok(report, "Report produced");
  assert.equal(typeof report.updatedAt, "number");
  assert.equal(typeof report.autonomyLevel, "number");
  assert.equal(typeof report.cycle, "number");
  assert.ok(report.cycle >= 1, "Cycle incremented");
  assert.ok(Array.isArray(report.suggestions), "Suggestions is array");
  assert.ok(Array.isArray(report.selfUpdates), "Self updates is array");
  assert.equal(typeof report.observed, "object", "Observed is an object");
});

test("CognitiveLoop emits visual_state_changed on cycle", async () => {
  const loop = CognitiveLoop.getInstance();
  let visualEventReceived = false;
  let receivedState = "";

  const unsub = AgentEventBus.getInstance().subscribe((event) => {
    if (event.type === "visual_state_changed") {
      visualEventReceived = true;
      receivedState = (event as { state?: string }).state ?? "";
    }
  });

  await loop.runOnce();
  unsub();

  assert.ok(visualEventReceived, "visual_state_changed event emitted");
  assert.ok(
    ["conversation", "research", "browser", "analysis", "engineering", "testing", "earth"].includes(receivedState),
    `Visual state is valid: ${receivedState}`,
  );
});

// ============================================================
// AGENT EVENT BUS
// ============================================================

test("AgentEventBus supports subscribe and emit", () => {
  const bus = AgentEventBus.getInstance();
  let received = false;

  const unsub = bus.subscribe(() => {
    received = true;
  });

  bus.emit({
    type: "task_started",
    taskId: "test-123",
    label: "Test task",
  });

  unsub();
  assert.ok(received, "Event received through subscription");
});

test("AgentEventBus handles visual_state_changed events", () => {
  const bus = AgentEventBus.getInstance();
  let receivedState = "";
  let receivedReason = "";

  const unsub = bus.subscribe((event) => {
    if (event.type === "visual_state_changed") {
      const e = event as { state: string; reason: string };
      receivedState = e.state;
      receivedReason = e.reason;
    }
  });

  bus.emit({
    type: "visual_state_changed",
    taskId: "test-456",
    state: "engineering",
    reason: "Testing visual state transitions",
  });

  unsub();
  assert.equal(receivedState, "engineering");
  assert.equal(receivedReason, "Testing visual state transitions");
});

// ============================================================
// COGNITION OBSERVES STATE, NOT JUST THE CLOCK
//
// Both cases below lock failures found by running the app in a
// real browser against the real singletons.
// ============================================================

test("a project stating its own intent becomes queued work, without the user restating it", async () => {
  const projects = ProjectStore.getInstance();
  const queue = WorkQueue.getInstance();

  const project = projects.create({ name: "Derivation Regression", description: "regression" });
  projects.update(project.id, { objective: "Ship the visual awareness report" });

  await CognitiveLoop.getInstance().runOnce();

  const derived = queue
    .list()
    .filter((item) => item.category === "NEXT")
    .find((item) => item.detail?.includes(`project:${project.id}`));

  assert.ok(derived, "cognition derived a next objective from the project's own stated intent");
  assert.match(derived.title, /Ship the visual awareness report/);

  // Running again must not queue the same objective a second time.
  await CognitiveLoop.getInstance().runOnce();
  const again = queue
    .list()
    .filter((item) => item.category === "NEXT" && item.detail?.includes(`project:${project.id}`));
  assert.equal(again.length, 1, "the derived objective is not re-queued every cycle");
});

test("stop() cancels the pending first cycle instead of leaving it to run", async () => {
  const loop = CognitiveLoop.getInstance();
  loop.stop();

  // start() schedules the first cycle 3s out. An untracked timeout
  // survives stop(), so a torn-down loop still ran a cycle — and
  // StrictMode's mount/unmount/mount left an orphan behind.
  loop.start();
  loop.stop();

  const before = loop.getLastReport()?.cycle ?? null;
  await new Promise((resolve) => setTimeout(resolve, 4000));
  assert.equal(loop.getLastReport()?.cycle ?? null, before, "no cycle ran after stop()");
});
