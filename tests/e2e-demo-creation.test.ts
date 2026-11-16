/**
 * ==========================================================
 * DEMO B: CREATION ENVIRONMENT
 *
 * User: "Create a visual design artboard for the Quantum Nebula project.
 *        Show me the color palette, compositional geometry, and allow me
 *        to revise elements interactively."
 *
 * Verifies that LÉLU:
 *   1. Understands creative intent.
 *   2. Generates an interactive visual creation studio environment.
 *   3. Displays the creative visual artifact (artboard spec).
 *   4. Supports dynamic in-place revisions based on user feedback.
 *   5. Snapshots the creative state for subsequent recall.
 * ==========================================================
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import EnvironmentOrchestrationEngine from "../src/core/orchestrator/EnvironmentOrchestrationEngine";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";

describe("DEMO B: Creation Environment End-to-End", () => {
  test("LÉLU autonomously constructs a creative studio, generates an artifact, and revises it in-place", async () => {
    const engine = EnvironmentOrchestrationEngine.getInstance();
    const workspace = WorkspaceEngine.getInstance();
    workspace.clear();

    const userPrompt = "Create a visual design artboard for the Quantum Nebula project. Show me the color palette, compositional geometry, and allow me to revise elements interactively.";

    // 1. Intent Analysis
    const intent = engine.analyzeIntent(userPrompt);
    assert.equal(intent.category, "creative");

    // 2. Environment Plan
    const plan = engine.createPlan(intent);
    assert.equal(plan.recommendedLayout, "grid");
    assert.equal(plan.suggestedPreset, "creative-studio");

    // 3. Compose Creative Studio Environment
    const composeRes = await dispatchToolCall(
      {
        name: "environment_compose",
        arguments: {
          title: "Quantum Nebula Visual Artboard",
          category: "creative",
          layout: "grid",
          surfaces: [
            {
              kind: "diagram",
              title: "Compositional Layout Canvas",
              spec: {
                kind: "diagram",
                title: "Artboard Canvas",
                nodes: [
                  { id: "core_nebula", label: "Central Stellar Core", color: "#ec4899", kind: "stellar" },
                  { id: "dust_filaments", label: "Ionized Dust Filaments", color: "#8b5cf6", kind: "dust" },
                  { id: "outer_envelope", label: "Hydrogen Envelope", color: "#3b82f6", kind: "gas" },
                ],
                edges: [
                  { from: "core_nebula", to: "dust_filaments", label: "irradiates" },
                  { from: "dust_filaments", to: "outer_envelope", label: "disperses into" },
                ],
              },
            },
            {
              kind: "file",
              title: "Artistic Rationale & Color Palette",
              text: "# Quantum Nebula Palette Spec\n\n- Primary: Deep Cosmic Indigo (#0f172a)\n- Accent A: Solar Flare Magenta (#ec4899)\n- Accent B: Ionized Violet (#8b5cf6)\n- Glow: Cyan Plasma (#38bdf8)\n\nLighting Strategy: Rim-lit volumetric scatter.",
            },
          ],
        },
      },
      "demo-b-create-task",
    );

    assert.equal(composeRes.ok, true);
    const canvasView = workspace.getState().views.find((v) => v.kind === "diagram");
    assert.ok(canvasView);
    const initialRev = canvasView.revision;

    // 4. In-Place Revision from Feedback: User requests adding a gravitational lens ring
    const mutateRes = await dispatchToolCall(
      {
        name: "environment_mutate_surface",
        arguments: {
          viewId: canvasView.id,
          title: "Compositional Layout Canvas (Revision 2 - Lensing Added)",
          spec: {
            kind: "diagram",
            title: "Artboard Canvas (Revised)",
            nodes: [
              { id: "core_nebula", label: "Central Stellar Core", color: "#ec4899" },
              { id: "dust_filaments", label: "Ionized Dust Filaments", color: "#8b5cf6" },
              { id: "outer_envelope", label: "Hydrogen Envelope", color: "#3b82f6" },
              { id: "einstein_ring", label: "Gravitational Einstein Ring", color: "#facc15" },
            ],
            edges: [
              { from: "core_nebula", to: "einstein_ring", label: "warps space" },
              { from: "einstein_ring", to: "outer_envelope", label: "refracts" },
            ],
          },
        },
      },
      "demo-b-revision",
    );

    assert.equal(mutateRes.ok, true);
    const revisedView = workspace.getState().views.find((v) => v.id === canvasView.id);
    assert.ok(revisedView);
    assert.ok(revisedView.revision > initialRev);
    assert.equal(revisedView.title, "Compositional Layout Canvas (Revision 2 - Lensing Added)");

    // 5. Save the snapshot for state preservation
    const saveRes = await dispatchToolCall(
      {
        name: "environment_save_state",
        arguments: { name: "Nebula Artboard Milestone 1", category: "creative" },
      },
      "demo-b-snapshot",
    );
    assert.equal(saveRes.ok, true);
  });
});
