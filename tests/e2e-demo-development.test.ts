/**
 * ==========================================================
 * DEMO C: DEVELOPMENT ENVIRONMENT
 *
 * User: "Analyze this repository architecture and show me its
 *        components in an interactive development workspace."
 *
 * Verifies that LÉLU:
 *   1. Understands repository inspection / engineering intent.
 *   2. Constructs an integrated development workspace with architecture diagram & files.
 *   3. Exposes interactive components that can be focused/inspected.
 *   4. Allows dynamic layout changes and surface manipulations.
 * ==========================================================
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import EnvironmentOrchestrationEngine from "../src/core/orchestrator/EnvironmentOrchestrationEngine";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";

describe("DEMO C: Development Environment End-to-End", () => {
  test("LÉLU inspects repository architecture, constructs dev environment, and supports interactive component navigation", async () => {
    const engine = EnvironmentOrchestrationEngine.getInstance();
    const workspace = WorkspaceEngine.getInstance();
    workspace.clear();

    const userPrompt = "Analyze this repository architecture and show me its components in an interactive development workspace.";

    // 1. Intent Analysis
    const intent = engine.analyzeIntent(userPrompt);
    assert.equal(intent.category, "development");

    // 2. Derive Plan
    const plan = engine.createPlan(intent);
    assert.ok(plan.steps.some((s) => s.action === "compose"));

    // 3. Environment Composition
    const composeRes = await dispatchToolCall(
      {
        name: "environment_compose",
        arguments: {
          title: "LÉLU Architecture & Execution Pipeline",
          category: "development",
          layout: "split",
          surfaces: [
            {
              kind: "diagram",
              title: "System Architecture & Dataflow",
              spec: {
                kind: "diagram",
                title: "LÉLU Subsystem Topology",
                nodes: [
                  { id: "core_runtime", label: "LeluRuntime", kind: "core" },
                  { id: "orchestration_engine", label: "EnvironmentOrchestrationEngine", kind: "orchestrator" },
                  { id: "workspace_engine", label: "WorkspaceEngine", kind: "workspace" },
                  { id: "interface_orchestrator", label: "InterfaceOrchestrator", kind: "ui" },
                  { id: "tool_dispatcher", label: "ToolDispatcher", kind: "tools" },
                ],
                edges: [
                  { from: "core_runtime", to: "orchestration_engine", label: "orchestrates" },
                  { from: "orchestration_engine", to: "tool_dispatcher", label: "dispatches" },
                  { from: "orchestration_engine", to: "workspace_engine", label: "presents" },
                  { from: "orchestration_engine", to: "interface_orchestrator", label: "styles & controls" },
                ],
              },
            },
            {
              kind: "file",
              title: "Architecture Diagnostics & Invariants",
              text: "### Subsystem Invariants\n\n1. Deterministic Execution: Model proposals require human consent for destructive actions.\n2. In-place Revisions: Workspace views preserve revision counters on model patch.\n3. Universal Presentation: Continuous Cosmos and workspace medium without window fragmentation.",
            },
          ],
        },
      },
      "demo-c-dev-task",
    );

    assert.equal(composeRes.ok, true);
    assert.equal(workspace.getState().views.length, 2);

    // 4. Trace dependencies across components
    const archDiagram = workspace.getState().views.find((v) => v.kind === "diagram");
    assert.ok(archDiagram);

    const traceRes = await dispatchToolCall(
      {
        name: "environment_mutate_surface",
        arguments: {
          viewId: archDiagram.id,
          elementsToHighlight: ["orchestration_engine", "workspace_engine"],
        },
      },
      "demo-c-trace",
    );
    assert.equal(traceRes.ok, true);

    // 5. Dynamic Layout Management: Re-layout to grid for multi-window development
    const manageRes = await dispatchToolCall(
      {
        name: "environment_manage_workspace",
        arguments: {
          action: "layout",
          layout: "grid",
        },
      },
      "demo-c-layout",
    );
    assert.equal(manageRes.ok, true);
    assert.equal(workspace.getState().layout, "grid");
  });
});
