/**
 * Verification harness for the Living System UI (UI 2) render pipeline.
 * Server-renders each of the five system modes through the same component
 * LivingSystemVisuals uses, then asserts that every mode produces
 * distinct, non-trivial DOM (i.e. switching modes genuinely changes the
 * rendered visualization, not just a selected label).
 *
 * Run: bunx tsx scripts/verify-living-visuals.tsx
 */
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { LivingSystemVisuals } from "../src/app/scene/genesis/LivingSystemVisuals";

const baseProps = {
  rate: 72,
  runtime: { thinking: false, speaking: false, listening: false, toolsActive: 0, error: false },
  structure: { providers: ["Groq", "OpenRouter", "Cerebras", "Mistral"], memory: ["identity", "preference", "goal"], tools: ["engineering", "research"] },
  signals: [{ id: "s1", mode: "nerve", path: ["input", "cognition", "tool"], label: "test", createdAt: 0 }],
  activeNodes: ["memory"],
  activeConnections: ["cognition"],
  engineRuntime: null,
};

const modes = ["heartbeat", "matrix", "nerve", "neuron", "core"] as const;
const outputs: Record<string, string> = {};

for (const mode of modes) {
  const html = renderToString(createElement(LivingSystemVisuals, { ...baseProps, mode }));
  outputs[mode] = html;
  const svgCount = (html.match(/<svg/g) ?? []).length;
  const circleCount = (html.match(/<circle/g) ?? []).length;
  const pathCount = (html.match(/<path/g) ?? []).length;
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log(
    `[${mode}] length=${html.length} svg=${svgCount} circles=${circleCount} paths=${pathCount} label="${text.slice(0, 90)}"`,
  );
}

// 1. Every mode renders something meaningful.
for (const mode of modes) {
  if ((outputs[mode] ?? "").length < 500) {
    console.error(`FAIL: mode "${mode}" rendered too little output`);
    process.exit(1);
  }
}

// 2. Every mode is visually distinct from every other mode.
const keys = Object.keys(outputs);
for (let i = 0; i < keys.length; i += 1) {
  for (let j = i + 1; j < keys.length; j += 1) {
    const a = outputs[keys[i]];
    const b = outputs[keys[j]];
    if (a === b) {
      console.error(`FAIL: modes "${keys[i]}" and "${keys[j]}" render identical output`);
      process.exit(1);
    }
    // A modest similarity threshold: a "changed label only" implementation
    // would differ by <2% of bytes. Real renderer swaps differ by far more.
    const overlap = similarity(a, b);
    if (overlap > 0.985) {
      console.error(`FAIL: modes "${keys[i]}" and "${keys[j]}" are suspiciously similar (${overlap.toFixed(4)})`);
      process.exit(1);
    }
  }
}

// 3. Structural identity checks per mode.
if (!outputs.heartbeat.includes("BPM")) {
  console.error("FAIL: heartbeat mode missing BPM readout");
  process.exit(1);
}
if (!outputs.matrix.includes("computational lattice") && !outputs.matrix.includes("lattice")) {
  console.error("FAIL: matrix mode missing lattice identity");
  process.exit(1);
}
if (!outputs.nerve.includes("signal propagation")) {
  console.error("FAIL: nerve mode missing propagation identity");
  process.exit(1);
}
if (!outputs.neuron.includes("SOMA")) {
  console.error("FAIL: neuron mode missing soma/neuron identity");
  process.exit(1);
}
if (!outputs.core.includes("Morph")) {
  console.error("FAIL: core mode missing morphology readout");
  process.exit(1);
}

console.log("PASS: all five UI 2 modes render distinct, structurally real visualizations");
process.exit(0);

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  let same = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a.charCodeAt(i) === b.charCodeAt(i)) same += 1;
  }
  return same / max;
}
