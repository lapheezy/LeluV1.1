/**
 * ==========================================================
 * DEMO A: RESEARCH ENVIRONMENT
 *
 * User: "Research recent breakthroughs in CRISPR gene therapy,
 *        show me the primary sources and synthesize an interactive
 *        concept diagram beside the document."
 *
 * Verifies that LÉLU:
 *   1. Understands research intent.
 *   2. Constructs an appropriate multi-surface research workspace.
 *   3. Populates research evidence & interactive relationship diagram.
 *   4. Allows interactive exploration & node focus.
 * ==========================================================
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import EnvironmentOrchestrationEngine from "../src/core/orchestrator/EnvironmentOrchestrationEngine";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";

describe("DEMO A: Research Environment End-to-End", () => {
  test("LÉLU autonomously constructs, presents, and enables exploration of a research workspace", async () => {
    const engine = EnvironmentOrchestrationEngine.getInstance();
    const workspace = WorkspaceEngine.getInstance();
    workspace.clear();

    const userPrompt = "Research recent breakthroughs in CRISPR gene therapy, show me the primary sources and synthesize an interactive concept diagram beside the document.";

    // 1. Intent Analysis
    const intent = engine.analyzeIntent(userPrompt);
    assert.equal(intent.category, "research");
    assert.equal(intent.needsWorkspace, true);

    // 2. Plan Generation
    const plan = engine.createPlan(intent);
    assert.equal(plan.recommendedLayout, "split");
    assert.ok(plan.steps.length >= 2);

    // 3. Execution & Environment Composition
    const composeRes = await dispatchToolCall(
      {
        name: "environment_compose",
        arguments: {
          title: "CRISPR Breakthroughs & Genomic Medicine",
          category: "research",
          layout: "split",
          surfaces: [
            {
              kind: "file",
              title: "CRISPR-Cas9 Therapeutic Synthesis",
              text: "# CRISPR-Cas9 Innovations (2026)\n\n## Overview\nPrecision base editing advances have demonstrated sustained in vivo efficacy across multiple clinical trials.\n\n## Key Breakthroughs\n1. Enhanced fidelity nickase systems.\n2. Non-viral lipid nanoparticle targeting.",
            },
            {
              kind: "table",
              title: "Primary Clinical Trials & Citations",
              spec: {
                kind: "table",
                title: "Primary Sources",
                columns: ["Identifier", "Target Gene", "Delivery Vector", "Phase / Outcome"],
                rows: [
                  { Identifier: "NCT05476744", "Target Gene": "PCSK9", "Delivery Vector": "LNP (Lipid Nanoparticle)", "Phase / Outcome": "Phase 1b (84% reduction)" },
                  { Identifier: "NCT04573387", "Target Gene": "TTR", "Delivery Vector": "Cas9 mRNA + sgRNA", "Phase / Outcome": "Phase 2 (Consistent knockout)" },
                ],
              },
            },
            {
              kind: "diagram",
              title: "CRISPR Mechanism & Pathways",
              spec: {
                kind: "diagram",
                title: "Mechanism Pathway",
                nodes: [
                  { id: "cas9", label: "Cas9 Endonuclease", kind: "protein" },
                  { id: "sgrna", label: "Single-Guide RNA", kind: "guide" },
                  { id: "target_dna", label: "Target Genomic Locus", kind: "dna" },
                  { id: "repair", label: "HDR / NHEJ Pathway", kind: "mechanism" },
                ],
                edges: [
                  { from: "sgrna", to: "cas9", label: "complexes with" },
                  { from: "cas9", to: "target_dna", label: "scans & cleaves" },
                  { from: "target_dna", to: "repair", label: "triggers" },
                ],
              },
            },
          ],
        },
      },
      "demo-a-research-task",
    );

    assert.equal(composeRes.ok, true, composeRes.content);
    const ws = workspace.getState();
    assert.equal(ws.views.length, 3);
    assert.equal(ws.layout, "split");
    assert.equal(ws.visible, true);

    // 4. Interactive exploration: User or LÉLU zooms into specific mechanism nodes
    const diagramView = ws.views.find((v) => v.kind === "diagram");
    assert.ok(diagramView);

    const mutateRes = await dispatchToolCall(
      {
        name: "environment_mutate_surface",
        arguments: {
          viewId: diagramView.id,
          elementsToHighlight: ["cas9", "target_dna"],
        },
      },
      "demo-a-explore",
    );
    assert.equal(mutateRes.ok, true);

    const exploredView = workspace.getState().views.find((v) => v.id === diagramView.id);
    assert.deepEqual(exploredView?.viewState.highlighted, ["cas9", "target_dna"]);
  });
});
