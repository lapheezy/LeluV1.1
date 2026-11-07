import { test, describe } from "node:test";
import assert from "node:assert/strict";
import EnvironmentOrchestrationEngine from "../src/core/orchestrator/EnvironmentOrchestrationEngine";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";

describe("Environment Orchestration Engine (Session 02)", () => {
  test("environment operator tools are offered to the model via schemas", () => {
    AutonomyGate.getInstance().setLevel(1);
    const offered = toolSchemasForModel().map((s) => s.name);

    for (const toolName of [
      "environment_compose",
      "environment_present_artifact",
      "environment_mutate_surface",
      "environment_manage_workspace",
      "environment_save_state",
      "environment_restore_state",
    ]) {
      assert.ok(offered.includes(toolName), `${toolName} must be offered to the model`);
    }
  });

  test("analyzes intent across task categories and derives operational plans", () => {
    const engine = EnvironmentOrchestrationEngine.getInstance();

    const researchIntent = engine.analyzeIntent("Research recent breakthroughs in quantum gravity and cite sources");
    assert.equal(researchIntent.category, "research");
    assert.equal(researchIntent.needsWorkspace, true);

    const creativeIntent = engine.analyzeIntent("Design a visual palette and draw an abstract constellation map");
    assert.equal(creativeIntent.category, "creative");

    const devIntent = engine.analyzeIntent("Analyze this repository architecture and show me its component hierarchy");
    assert.equal(devIntent.category, "development");

    const plan = engine.createPlan(devIntent);
    assert.ok(plan.steps.length >= 2);
    assert.equal(plan.intent.category, "development");
  });

  test("environment.compose constructs multi-surface workspaces with explicit layout", async () => {
    const workspace = WorkspaceEngine.getInstance();
    workspace.clear();

    const result = await dispatchToolCall(
      {
        name: "environment_compose",
        arguments: {
          title: "Quantum Mechanics Study",
          category: "research",
          layout: "split",
          surfaces: [
            {
              kind: "table",
              title: "Source Matrix",
              spec: {
                kind: "table",
                title: "Sources",
                columns: ["Source", "Citation"],
                rows: [{ Source: "Physical Review", Citation: "10.1103" }],
              },
            },
            {
              kind: "diagram",
              title: "Theory Dependency Graph",
              spec: {
                kind: "diagram",
                title: "Dependencies",
                nodes: [{ id: "n1", label: "Relativity" }, { id: "n2", label: "Quantum Field Theory" }],
                edges: [{ from: "n1", to: "n2", label: "unification" }],
              },
            },
          ],
        },
      },
      "task-test-compose",
    );

    assert.equal(result.ok, true, result.content);
    const wsState = workspace.getState();
    assert.equal(wsState.views.length, 2);
    assert.equal(wsState.layout, "split");
    assert.equal(wsState.splitIds.length, 2);
  });

  test("environment.mutate_surface updates existing surfaces in place and advances revision", async () => {
    const workspace = WorkspaceEngine.getInstance();
    const views = workspace.getState().views;
    assert.ok(views.length > 0);
    const targetView = views[0];
    const initialRev = targetView.revision;

    const mutateRes = await dispatchToolCall(
      {
        name: "environment_mutate_surface",
        arguments: {
          viewId: targetView.id,
          title: "Updated Source Matrix (Peer Reviewed)",
          text: "Updated text notes on verified literature.",
          elementsToHighlight: ["n1"],
        },
      },
      "task-test-mutate",
    );

    assert.equal(mutateRes.ok, true, mutateRes.content);
    const updatedView = workspace.getState().views.find((v) => v.id === targetView.id);
    assert.ok(updatedView);
    assert.equal(updatedView.title, "Updated Source Matrix (Peer Reviewed)");
    assert.ok(updatedView.revision > initialRev);
  });

  test("environment.manage_workspace manages layouts, view focus, and closures", async () => {
    const workspace = WorkspaceEngine.getInstance();

    // 1. Change layout to grid
    const layoutRes = await dispatchToolCall(
      {
        name: "environment_manage_workspace",
        arguments: { action: "layout", layout: "grid" },
      },
      "task-test-manage",
    );
    assert.equal(layoutRes.ok, true);
    assert.equal(workspace.getState().layout, "grid");

    // 2. Focus first view
    const firstView = workspace.getState().views[0];
    const focusRes = await dispatchToolCall(
      {
        name: "environment_manage_workspace",
        arguments: { action: "focus", viewId: firstView.id },
      },
      "task-test-manage",
    );
    assert.equal(focusRes.ok, true);
    assert.equal(workspace.getState().focusId, firstView.id);
  });

  test("environment snapshot save and restore preserves views and layout accurately", async () => {
    const workspace = WorkspaceEngine.getInstance();

    const saveRes = await dispatchToolCall(
      {
        name: "environment_save_state",
        arguments: { name: "Checkpoint Alpha", category: "research" },
      },
      "task-test-snapshot",
    );
    assert.equal(saveRes.ok, true);
    const snapshotId = (saveRes.data as any)?.snapshotId;
    assert.ok(snapshotId);

    // Alter workspace
    workspace.clear();
    assert.equal(workspace.getState().views.length, 0);

    // Restore workspace
    const restoreRes = await dispatchToolCall(
      {
        name: "environment_restore_state",
        arguments: { snapshotId },
      },
      "task-test-restore",
    );
    assert.equal(restoreRes.ok, true);
    assert.equal(workspace.getState().views.length, 2);
  });
});
