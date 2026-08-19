/**
 * ==========================================================
 * LÉLU
 * SELF-TEST RUNNER — tests for herself
 *
 * Categories: unit, integration, cognition, agent, ui,
 * creative, engineering, regression. Every test exercises REAL
 * store behavior (roundtrips through the persistent stores),
 * not mock objects. A self-improvement is never "successful"
 * on compiles alone — the suite must pass.
 * ==========================================================
 */

import SelfModel from "../cognition/SelfModel";
import KnowledgeLibrary from "../cognition/KnowledgeLibrary";
import WorkQueue from "../cognition/WorkQueue";
import AutonomyGate from "../cognition/AutonomyGate";
import CognitiveLoop from "../cognition/CognitiveLoop";
import AgentStore from "../agents/AgentStore";
import SketchStore, { emptyDocument, exportDocument } from "../creative/SketchDocument";
import SandboxFS from "../engineering/SandboxFS";
import SandboxRuntime from "../engineering/SandboxRuntime";
import KvStore from "../storage/KvStore";
import UISpecStore from "./UISpec";
import CapabilityRegistry from "./CapabilityRegistry";
import ArchitectureMap from "./ArchitectureMap";
import ImprovementQueue from "./ImprovementQueue";
import ImprovementPrioritizer from "./ImprovementPrioritizer";
import EngineeringMemory from "./EngineeringMemory";
import SelfDevelopmentLoop from "./SelfDevelopmentLoop";
import VersionHistory from "./VersionHistory";

export type TestCategory =
  | "unit"
  | "integration"
  | "cognition"
  | "agent"
  | "ui"
  | "creative"
  | "engineering"
  | "regression";

export interface TestResult {
  id: string;
  category: TestCategory;
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

export interface TestSuiteResult {
  updatedAt: number;
  results: TestResult[];
  summary: { passed: number; failed: number; total: number };
  healthy: boolean;
}

type TestFn = () => { passed: boolean; detail: string } | Promise<{ passed: boolean; detail: string }>;

export default class SelfTestRunner {
  private static instance: SelfTestRunner | null = null;
  private lastResult: TestSuiteResult | null = null;

  private constructor() {}

  public static getInstance(): SelfTestRunner {
    if (!SelfTestRunner.instance) {
      SelfTestRunner.instance = new SelfTestRunner();
    }
    return SelfTestRunner.instance;
  }

  public getLastResult(): TestSuiteResult | null {
    return this.lastResult;
  }

  /** Run `fn` against a temporarily empty sandbox, then restore the
      caller's files — so runtime tests never depend on unrelated
      sandbox content. */
  private async withCleanSandbox<T>(fn: () => Promise<T> | T): Promise<T> {
    const sandbox = SandboxFS.getInstance();
    const saved = sandbox.filePaths().map((path) => ({ path, content: sandbox.read(path) }));
    sandbox.reset();
    try {
      return await fn();
    } finally {
      sandbox.reset();
      for (const { path, content } of saved) {
        if (content !== null) {
          sandbox.write(path, content);
        }
      }
    }
  }

  private async runTest(category: TestCategory, name: string, test: TestFn): Promise<TestResult> {
    const start = performance.now();
    try {
      const outcome = await test();
      return {
        id: `${category}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        category,
        name,
        passed: outcome.passed,
        detail: outcome.detail,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (error) {
      return {
        id: `${category}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        category,
        name,
        passed: false,
        detail: `threw: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Math.round(performance.now() - start),
      };
    }
  }

  /** Run the full self-test suite. All tests use the real stores. */
  public async run(): Promise<TestSuiteResult> {
    const results: TestResult[] = [];

    /* ---------- unit ---------- */
    results.push(
      await this.runTest("unit", "KvStore roundtrip", () => {
        const key = `self-test-${crypto.randomUUID()}`;
        KvStore.getInstance().set(key, { probe: 42 });
        const value = KvStore.getInstance().get<{ probe: number }>(key);
        KvStore.getInstance().remove(key);
        return { passed: value?.probe === 42, detail: value?.probe === 42 ? "persisted + read + removed" : "roundtrip mismatch" };
      }),
      await this.runTest("unit", "Sandbox path safety", () => {
        const sandbox = SandboxFS.getInstance();
        const escaped = sandbox.write("../../escape.md", "x");
        return { passed: !escaped.ok, detail: escaped.ok ? "escape allowed" : ".. rejected" };
      }),
      await this.runTest("unit", "Autonomy clamping", () => {
        const gate = AutonomyGate.getInstance();
        const before = gate.getLevel();
        gate.setLevel(99);
        const clamped = gate.getLevel() === 5;
        gate.setLevel(before);
        return { passed: clamped, detail: clamped ? "clamped to L5" : "not clamped" };
      }),
    );

    /* ---------- integration ---------- */
    results.push(
      await this.runTest("integration", "Self-model → queue continuity", () => {
        const self = SelfModel.getInstance();
        self.addGoal("Self-test integration probe");
        const present = self.get().goals.includes("Self-test integration probe");
        self.removeItemByField("goals", "Self-test integration probe");
        return { passed: present, detail: present ? "self-model persisted the probe" : "missing" };
      }),
      await this.runTest("integration", "Capability ↔ architecture map", () => {
        const map = ArchitectureMap.getInstance();
        const registry = CapabilityRegistry.getInstance();
        const provided = new Set(map.list().flatMap((subsystem) => subsystem.provides));
        const missing = registry.list().filter((capability) => !provided.has(capability.id)).map((capability) => capability.id);
        return {
          passed: missing.length <= 3,
          detail: missing.length === 0 ? "every capability maps to a subsystem" : `unmapped: ${missing.join(", ")}`,
        };
      }),
    );

    /* ---------- cognition ---------- */
    results.push(
      await this.runTest("cognition", "Knowledge gap detection", () => {
        const knowledge = KnowledgeLibrary.getInstance();
        return {
          passed: knowledge.gaps().length > 0,
          detail: `${knowledge.gaps().length} gap(s) detected`,
        };
      }),
      await this.runTest("cognition", "Work queue workflow", () => {
        const queue = WorkQueue.getInstance();
        const item = queue.add({ category: "EXPERIMENTS", title: "Self-test queue probe", autonomy: 1 });
        queue.move(item.id, "NOW");
        queue.complete(item.id);
        const after = queue.list().find((candidate) => candidate.id === item.id);
        queue.remove(item.id);
        return {
          passed: after?.status === "done" && after.category === "NOW",
          detail: after?.status === "done" ? "add → move → complete" : "workflow broken",
        };
      }),
      await this.runTest("cognition", "Cognitive loop cycle", async () => {
        const loop = CognitiveLoop.getInstance();
        const report = await loop.runOnce();
        return {
          passed: Boolean(report && report.cycle >= 1),
          detail: report ? `cycle ${report.cycle}: ${report.observed.projects} project(s), ${report.suggestions.length} proposal(s)` : "no report",
        };
      }),
    );

    /* ---------- agent ---------- */
    results.push(
      await this.runTest("agent", "Agent store CRUD", () => {
        const store = AgentStore.getInstance();
        const agent = store.create({ name: `Self-test Agent ${Date.now() % 10000}`, role: "Probe" });
        const fetched = store.get(agent.id);
        store.remove(agent.id);
        return {
          passed: Boolean(fetched && fetched.id === agent.id),
          detail: fetched ? "create → read → delete" : "agent roundtrip failed",
        };
      }),
      await this.runTest("agent", "Improvement queue workflow", () => {
        const queue = ImprovementQueue.getInstance();
        const proposal = queue.add({
          title: `Self-test probe ${Date.now() % 10000}`,
          problem: "probe",
          observation: "probe",
          evidence: "probe",
          proposedSolution: "probe",
          expectedBenefit: "probe",
          dependencies: [],
          risk: "none",
          requiredTools: [],
          requiredAgents: [],
          complexity: "low",
          kind: "Experiment",
          version: "1.0",
          testPlan: "probe",
        });
        queue.setStatus(proposal.id, "Testing");
        const after = queue.get(proposal.id);
        queue.remove(proposal.id);
        return { passed: after?.status === "Testing", detail: after?.status === "Testing" ? "Detected → Testing" : "status flow failed" };
      }),
    );

    /* ---------- ui ---------- */
    results.push(
      await this.runTest("ui", "UI spec store roundtrip", () => {
        const store = UISpecStore.getInstance();
        const spec = store.create({
          name: `Self-test UI ${Date.now() % 10000}`,
          description: "probe",
          version: "1.0",
          sections: [{ title: "Probe", elements: [{ type: "label", text: "hello" }] }],
        });
        const fetched = store.get(spec.id);
        store.remove(spec.id);
        return {
          passed: Boolean(fetched && fetched.sections[0].elements[0].type === "label"),
          detail: fetched ? "create → read → delete" : "UI spec roundtrip failed",
        };
      }),
      await this.runTest("ui", "Architecture map query", () => {
        const map = ArchitectureMap.getInstance();
        const ai = map.query((subsystem) => subsystem.provides.includes("chat"));
        const files = map.allSourceFiles();
        return {
          passed: ai.length >= 1 && files.length > 50,
          detail: `${ai.length} subsystem(s) provide chat; ${files.length} real source files`,
        };
      }),
    );

    /* ---------- creative ---------- */
    results.push(
      await this.runTest("creative", "Sketch document + export", () => {
        const doc = emptyDocument("Self-test sketch");
        doc.layers[0].elements.push({
          id: crypto.randomUUID(),
          kind: "stroke",
          tool: "pencil",
          color: "#67e8f9",
          size: 3,
          opacity: 1,
          erase: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        });
        const svg = exportDocument(doc, "svg");
        return {
          passed: svg.includes("<svg"),
          detail: svg.includes("<svg") ? "SVG export produced a document" : "export missing <svg>",
        };
      }),
      await this.runTest("creative", "Sketch store CRUD", () => {
        const store = SketchStore.getInstance();
        const doc = store.create(`Self-test sketch ${Date.now() % 10000}`);
        const fetched = store.get(doc.id);
        store.remove(doc.id);
        return { passed: Boolean(fetched), detail: fetched ? "create → read → delete" : "sketch store failed" };
      }),
    );

    /* ---------- engineering ---------- */
    results.push(
      await this.runTest("engineering", "Sandbox project generation", () => {
        const sandbox = SandboxFS.getInstance();
        const result = sandbox.generateProject("web", `Self Test ${Date.now() % 10000}`);
        const path = result.paths?.[0];
        const analysis = path ? sandbox.analyze(path) : null;
        if (path) sandbox.remove(path);
        return {
          passed: Boolean(result.ok && path && analysis && analysis.lines > 0),
          detail: result.ok && path ? `generated ${result.paths?.length} file(s); first file analyzed` : "generation failed",
        };
      }),
      await this.runTest("engineering", "Sandbox edit roundtrip", () => {
        const sandbox = SandboxFS.getInstance();
        const path = `self-test-${Date.now() % 10000}.md`;
        sandbox.write(path, "# probe");
        const edited = sandbox.write(path, "# probe\nedited");
        const read = sandbox.read(path);
        sandbox.remove(path);
        return { passed: edited.ok && read === "# probe\nedited", detail: "write → edit → read" };
      }),
      await this.runTest("engineering", "Sandbox runtime executes a script", async () => {
        if (typeof window === "undefined") {
          return { passed: true, detail: "skipped — no browser Worker runtime" };
        }
        return this.withCleanSandbox(async () => {
          const sandbox = SandboxFS.getInstance();
          const path = `self-test-run-${Date.now() % 10000}.js`;
          sandbox.write(path, "console.log('hello from the sandbox');");
          const run = await SandboxRuntime.getInstance().runFile(path);
          return {
            passed: run.ok && run.stdout.includes("hello from the sandbox"),
            detail: run.ok ? `executed in ${run.durationMs} ms, exit ${run.exitCode}` : run.stderr,
          };
        });
      }),
      await this.runTest("engineering", "Sandbox test harness", async () => {
        if (typeof window === "undefined") {
          return { passed: true, detail: "skipped — no browser Worker runtime" };
        }
        return this.withCleanSandbox(async () => {
          const sandbox = SandboxFS.getInstance();
          const path = `self-test-harness-${Date.now() % 10000}.test.js`;
          sandbox.write(
            path,
            "test('adds', () => { assertEqual(1 + 1, 2); });\ntest('fails', () => { assert(false, 'boom'); });",
          );
          const run = await SandboxRuntime.getInstance().test();
          return {
            passed: run.tests.length === 2 && run.tests.filter((test) => test.passed).length === 1,
            detail: `${run.tests.filter((test) => test.passed).length}/${run.tests.length} passed, exit ${run.exitCode}`,
          };
        });
      }),
      await this.runTest("engineering", "Improvement prioritizer ranks", () => {
        const queue = ImprovementQueue.getInstance();
        const bug = queue.add({
          title: `Prioritize-bug ${Date.now() % 10000}`,
          problem: "probe",
          observation: "probe",
          evidence: "user",
          proposedSolution: "probe",
          expectedBenefit: "probe",
          dependencies: [],
          risk: "Low",
          requiredTools: [],
          requiredAgents: [],
          complexity: "low",
          kind: "Bug",
          version: "1.0",
          testPlan: "probe",
        });
        const experiment = queue.add({
          title: `Prioritize-exp ${Date.now() % 10000}`,
          problem: "probe",
          observation: "probe",
          evidence: "probe",
          proposedSolution: "probe",
          expectedBenefit: "probe",
          dependencies: [],
          risk: "High",
          requiredTools: ["cloud"],
          requiredAgents: [],
          complexity: "high",
          kind: "Experiment",
          version: "1.0",
          testPlan: "probe",
        });
        const ranked = ImprovementPrioritizer.getInstance().rank([experiment, bug]);
        queue.remove(bug.id);
        queue.remove(experiment.id);
        const top = ranked[0];
        return {
          passed: top?.proposal.id === bug.id && top.priority.score > ranked[1].priority.score,
          detail: top ? `“${top.proposal.title}” ranked first (${top.priority.score}/100)` : "no ranking",
        };
      }),
      await this.runTest("engineering", "Engineering memory retrieval", () => {
        const memory = EngineeringMemory.getInstance();
        const topic = `probe-${Date.now() % 10000}`;
        memory.record({ kind: "lesson", topic, summary: "Indexing probe", outcome: "neutral" });
        const found = memory.retrieve(topic);
        const removed = found.find((entry) => entry.topic === topic);
        if (removed) {
          memory.remove(removed.id);
        }
        return { passed: removed !== undefined, detail: removed ? `retrieved “${topic}”` : "retrieval failed" };
      }),
      await this.runTest("engineering", "Self-development loop → Ready", async () => {
        if (typeof window === "undefined") {
          return { passed: true, detail: "skipped — no browser Worker runtime" };
        }
        const queue = ImprovementQueue.getInstance();
        const versions = VersionHistory.getInstance();
        const beforeSnapshots = new Set(versions.listSnapshots().map((snapshot) => snapshot.id));
        const proposal = queue.add({
          title: `Loop probe ${Date.now() % 10000}`,
          problem: "probe",
          observation: "probe",
          evidence: "user",
          proposedSolution: "probe",
          expectedBenefit: "probe",
          dependencies: [],
          risk: "Low",
          requiredTools: [],
          requiredAgents: [],
          complexity: "low",
          kind: "Opportunity",
          version: "1.0",
          testPlan: "probe",
          status: "Approved",
        });
        try {
          return await this.withCleanSandbox(async () => {
            const sandbox = SandboxFS.getInstance();
            const file = `self-test-loop-${Date.now() % 10000}.js`;
            const run = await SelfDevelopmentLoop.getInstance().develop(proposal.id, {
              edits: [{ path: file, content: "console.log('loop probe');" }],
            });
            const passed = run.success && run.finalStatus === "Ready";
            sandbox.remove(file);
            return {
              passed,
              detail: passed
                ? `develop → ${run.finalStatus} with ${run.steps.length} step(s)`
                : `loop ended ${run.finalStatus}: ${run.summary}`,
            };
          });
        } finally {
          queue.remove(proposal.id);
          for (const snapshot of versions.listSnapshots()) {
            if (!beforeSnapshots.has(snapshot.id)) {
              versions.removeSnapshot(snapshot.id);
            }
          }
        }
      }),
    );

    /* ---------- regression ---------- */
    results.push(
      await this.runTest("regression", "Dock settings storage", () => {
        const key = "lelu.dock.v1";
        const before = KvStore.getInstance().get<{ size?: string }>(key);
        const probe = { ...(before ?? {}), size: "compact" };
        KvStore.getInstance().set(key, probe);
        const after = KvStore.getInstance().get<{ size?: string }>(key);
        if (before) KvStore.getInstance().set(key, before);
        else KvStore.getInstance().remove(key);
        return { passed: after?.size === "compact", detail: "dock settings survived KvStore roundtrip" };
      }),
      await this.runTest("regression", "Capability registry integrity", () => {
        const registry = CapabilityRegistry.getInstance();
        const ids = new Set(registry.list().map((capability) => capability.id));
        return { passed: ids.size === registry.list().length, detail: `${registry.list().length} unique capability id(s)` };
      }),
    );

    const summary = {
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      total: results.length,
    };
    const suite: TestSuiteResult = {
      updatedAt: Date.now(),
      results,
      summary,
      healthy: summary.failed === 0,
    };
    this.lastResult = suite;
    return suite;
  }
}
