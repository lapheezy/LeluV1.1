import test from "node:test";
import assert from "node:assert/strict";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { registerEnvironmentTools } from "../src/core/orchestrator/EnvironmentTools";
import EnvironmentOrchestrationEngine from "../src/core/orchestrator/EnvironmentOrchestrationEngine";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";

test("Workflow A-F: Autonomous research, in-place evolution, management, and persistence", async () => {
  registerEnvironmentTools();
  const workspace = WorkspaceEngine.getInstance();
  workspace.clear();

  // 1. Tool discovery
  const schemas = toolSchemasForModel();
  const envToolNames = [
    "environment_compose",
    "environment_present_artifact",
    "environment_mutate_surface",
    "environment_manage_workspace",
    "environment_save_state",
    "environment_restore_state"
  ];
  for (const name of envToolNames) {
    assert.ok(schemas.some((s) => s.name === name), `Schema ${name} should be offered to model`);
  }

  // WORKFLOW A: Autonomous research environment composition
  const composeRes = await dispatchToolCall({
    id: "call-compose",
    name: "environment_compose",
    arguments: {
      category: "research",
      title: "CRISPR-Cas9 Gene Therapy Mechanisms",
      prompt: "Research on CRISPR mechanisms and primary clinical trial sources",
      layout: "split"
    }
  });
  assert.equal(composeRes.ok, true);
  const stateA = workspace.getState();
  assert.equal(stateA.views.length >= 2, true, "Should have created multiple surfaces");
  const diagramView = stateA.views.find((v) => v.kind === "diagram");
  assert.ok(diagramView, "Should have a research diagram surface");

  // WORKFLOW B: In-place analytical evolution (mutation preserving surface identity)
  const initialViewId = diagramView.id;
  const mutateRes = await dispatchToolCall({
    id: "call-mutate",
    name: "environment_mutate_surface",
    arguments: {
      viewId: initialViewId,
      title: "CRISPR-Cas9 Gene Therapy Mechanisms (Updated Comparative)",
      elementsToHighlight: ["root", "evidence_a"]
    }
  });
  assert.equal(mutateRes.ok, true);
  const updatedView = workspace.getState().views.find((v) => v.id === initialViewId);
  assert.ok(updatedView, "Existing view identity must be preserved");
  assert.match(updatedView.title, /Updated Comparative/);
  assert.deepEqual(updatedView.viewState?.highlighted, ["root", "evidence_a"]);

  // WORKFLOW D: Workspace management & snapshot
  const manageRes = await dispatchToolCall({
    id: "call-manage",
    name: "environment_manage_workspace",
    arguments: {
      action: "layout",
      layout: "grid",
      viewId: initialViewId
    }
  });
  assert.equal(manageRes.ok, true);
  assert.equal(workspace.getState().layout, "grid");

  const saveRes = await dispatchToolCall({
    id: "call-save",
    name: "environment_save_state",
    arguments: {
      name: "CRISPR Milestone Alpha",
      category: "research"
    }
  });
  assert.equal(saveRes.ok, true);
  const snapshotId = (saveRes.data as { snapshotId: string }).snapshotId;
  assert.ok(snapshotId);

  // WORKFLOW E: Restoration
  workspace.clear();
  assert.equal(workspace.getState().views.length, 0);

  const restoreRes = await dispatchToolCall({
    id: "call-restore",
    name: "environment_restore_state",
    arguments: {
      snapshotId
    }
  });
  assert.equal(restoreRes.ok, true);
  const stateRestored = workspace.getState();
  assert.equal(stateRestored.views.length >= 2, true);
  assert.ok(stateRestored.views.some((v) => v.id === initialViewId));
  assert.equal(stateRestored.layout, "grid");

  // WORKFLOW F: Continued autonomy on restored workspace
  const followUpRes = await dispatchToolCall({
    id: "call-followup",
    name: "environment_mutate_surface",
    arguments: {
      viewId: initialViewId,
      title: "CRISPR-Cas9 Gene Therapy Mechanisms (Post-Restore Revision)"
    }
  });
  assert.equal(followUpRes.ok, true);
  const finalView = workspace.getState().views.find((v) => v.id === initialViewId);
  assert.match(finalView?.title ?? "", /Post-Restore Revision/);
});
