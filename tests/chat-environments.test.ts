import test from "node:test";
import assert from "node:assert/strict";
import { ENVIRONMENTS, recommendEnvironment } from "../src/core/interface/Environments";
import { STAGE_MODES, parseWorkspaceCommand } from "../src/core/interface/WorkspaceSteward";
import { workspacePlan } from "../src/core/router/DirectResolver";
import { buildStage } from "../src/app/scene/genesis/chat/stage/conversationModel";
import { codeBlocksOf, markdownBlocks, prototypeDoc, runnable, tableToChart, tableToWorkbook, tablesOf, toDeck, toDocument, toFilmScenes, toMermaid } from "../src/app/scene/genesis/chat/stage/transforms";
import { INTERFACE_TOOLS } from "../src/core/interface/InterfaceTools";
import { normalizeDiagram } from "../src/core/creative/kit/Diagram";

const msgs = [
  { id: "u1", role: "user" as const, text: "Compare the planets" },
  { id: "a1", role: "assistant" as const, text: "## Sizes\n| Planet | Radius km | Moons |\n|---|---|---|\n| Mercury | 2,440 | 0 |\n| Earth | 6,371 | 1 |\n| Jupiter | 69,911 | 95 |\n\n## Notes\n1. Jupiter is largest.\n2. See [NASA](https://science.nasa.gov/solar-system/)\n\n```html\n<h1>Hi</h1>\n```" },
];

test("every stage mode is a registered environment with a purpose", () => {
  for (const s of STAGE_MODES) {
    const env = ENVIRONMENTS.find((e) => e.id === s);
    assert.ok(env, s);
    assert.ok(env!.purpose.length > 10);
  }
});

test("the recommender picks environments from what was made first, then what was asked", () => {
  assert.equal(recommendEnvironment("hi")?.stage, undefined);
  assert.equal(recommendEnvironment("make something", ["visual:scene3d"])!.stage, "spatial");
  assert.equal(recommendEnvironment("ok", ["deck"])?.stage, "present");
  assert.equal(recommendEnvironment("Research how coral reefs recover from bleaching")!.stage, "research");
  assert.equal(recommendEnvironment("Draw an architecture diagram of the login flow")!.stage, "diagram");
  assert.equal(recommendEnvironment("Chart of earthquakes this week")!.stage, "data");
  assert.equal(recommendEnvironment("Write a short report on the findings")!.stage, "document");
  assert.equal(recommendEnvironment("Build a 3d desert scene")!.stage, "spatial");
});

test("conversation → real Studio specs", () => {
  const model = buildStage("Planets", msgs);
  const doc = toDocument(model);
  assert.equal(doc.kind, "document");
  assert.ok(doc.blocks.some((b) => b.type === "table"));
  assert.ok(doc.blocks.some((b) => b.type === "bullets" && b.ordered));
  assert.deepEqual(doc.sources?.map((s) => s.url), ["https://science.nasa.gov/solar-system/"]);
  const tables = tablesOf(model);
  assert.equal(tables.length, 1);
  const chart = tableToChart(tables[0])!;
  assert.deepEqual(chart.labels, ["Mercury", "Earth", "Jupiter"]);
  assert.deepEqual(chart.series.map((s) => s.name), ["Radius km", "Moons"]);
  assert.deepEqual(chart.series[0].values, [2440, 6371, 69911]);
  assert.equal(tableToWorkbook("x", tables).sheets[0].rows[2][1], 69911);
  const deck = toDeck(model);
  assert.ok(deck.slides.some((s) => s.layout === "table"));
  assert.ok(typeof normalizeDiagram({ source: toMermaid(model) }) !== "string", "the flowchart is valid Mermaid for the kit");
  assert.ok(toFilmScenes(model).length >= 2);
  const code = codeBlocksOf(msgs);
  assert.equal(code[0].lang, "html");
  assert.ok(runnable(code[0]));
  assert.match(prototypeDoc({ ...code[0], lang: "js", code: "console.log(1)" }), /console\.log=log/);
  assert.deepEqual(markdownBlocks("> quoted\n\ntext").map((b) => b.type), ["quote", "paragraph"]);
});

test("language → transforms and environments, compiled to tools (no model)", () => {
  assert.equal(parseWorkspaceCommand("Turn this into a report")?.transform, "document");
  assert.equal(parseWorkspaceCommand("Make this a slide deck")?.transform, "deck");
  assert.equal(parseWorkspaceCommand("make a diagram of this")?.transform, "diagram");
  assert.equal(parseWorkspaceCommand("chart this data")?.transform, "chart");
  assert.equal(parseWorkspaceCommand("make a film of this conversation")?.transform, "film");
  assert.equal(parseWorkspaceCommand("open the research workspace")?.stage, "research");
  assert.equal(parseWorkspaceCommand("show me the code view")?.stage, "code");
  assert.equal(parseWorkspaceCommand("Make this cinematic")?.stage, "cinematic");
  assert.equal(parseWorkspaceCommand("Turn this into a visual research board")?.stage, "board");
  const plan = workspacePlan("turn this into a presentation deck")!;
  assert.deepEqual(plan.steps.map((s) => s.tool), ["workspace.transform", "workspace.stage"]);
  assert.ok(INTERFACE_TOOLS.some((t) => t.id === "workspace.transform" && t.riskLevel === 0));
});

test("chart explanations are arithmetic, and never trend over an unfinished day", async () => {
  const { explainChart } = await import("../src/app/scene/genesis/chat/stage/transforms");
  const today = new Date().toISOString().slice(0, 10);
  const lines = explainChart({ kind: "column", labels: ["2026-01-01", "2026-01-02", today], series: [{ name: "count", values: [10, 30, 2] }] });
  assert.match(lines[0], /42 in total across 3 values \(mean 14\)/);
  assert.match(lines[1], /Highest: 30 \(2026-01-02\); lowest: 2/);
  assert.match(lines[2], /still in progress/);
  const r = explainChart({ kind: "scatter", x: [1, 2, 3, 4], series: [{ name: "y", values: [2, 4, 6, 8] }], xLabel: "depth" });
  assert.match(r[0], /strong positive relationship between depth and y \(r = 1\.00\)/);
});
