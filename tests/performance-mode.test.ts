import { test } from "node:test";
import assert from "node:assert/strict";
import { profileFor } from "../src/app/scene/genesis/SceneRenderManager";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";
import { describePerformance, setPerformanceMode, getPerformance } from "../src/core/performance/PerformanceMode";

test("CPU and memory are evidence: a low-end CPU caps at balanced, never light on its own", () => {
  assert.equal(profileFor({ renderer: "ANGLE (NVIDIA)", webgl: true, lowEndCpu: true }), "balanced");
  assert.equal(profileFor({ renderer: "ANGLE (NVIDIA)", webgl: true }), "full");
  assert.equal(profileFor({ renderer: "SwiftShader", webgl: true }), "light");
});

test("chat phrases set the weight directly", () => {
  const cases: Array<[string, string | undefined]> = [
    ["Switch to lightweight mode", "light"],
    ["go full weight", "full"],
    ["put the graphics on full quality", "full"],
    ["use auto mode for performance", "auto"],
  ];
  for (const [text, mode] of cases) {
    const plan = compileDirect(text);
    assert.equal(plan?.steps[0]?.tool, "performance.mode", text);
    assert.equal(plan?.steps[0]?.args.mode, mode, text);
  }
  assert.notEqual(compileDirect("this jacket is lightweight")?.steps[0]?.tool, "performance.mode");
});

test("the mode is stored with who set it, and a refused full weight is said plainly", () => {
  setPerformanceMode("full", "lelu", "asked");
  assert.equal(getPerformance().mode, "full");
  const s = { ...getPerformance(), effective: { profile: "light", reason: "capability", renderer: "SwiftShader", fps: 20, refused: "refused:software", cores: 4, memoryGb: 8 } };
  assert.match(describePerformance(s), /refused: this device draws with a software rasteriser/);
  setPerformanceMode("auto", "owner", "");
});
