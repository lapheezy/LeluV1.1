import { test } from "node:test";
import assert from "node:assert/strict";
import CapabilityRegistry from "../src/core/selfdev/CapabilityRegistry";
import ImprovementQueue from "../src/core/selfdev/ImprovementQueue";
import SelfDevelopmentEngine from "../src/core/selfdev/SelfDevelopmentEngine";

test("Avatar identity is recorded as available (her 3D animated body), and video generation is no longer called missing", () => {
  const caps = CapabilityRegistry.getInstance().list();
  assert.equal(caps.find((c) => c.name === "Avatar identity")?.status, "available");
  const video = caps.find((c) => c.name === "Video projects");
  assert.ok(video && !video.limitations.some((l) => /no actual video generation/.test(l)));
});

test("stale 'Complete capability' proposals are closed as no longer needed, with the reason", () => {
  const q = ImprovementQueue.getInstance();
  const avatar = CapabilityRegistry.getInstance().list().find((c) => c.name === "Avatar identity")!;
  const p = q.add({ title: "Complete capability: Avatar identity", kind: "Limitation", problem: "Capability “Avatar identity” is partial: 2D config only — no animation or embodied avatar yet.", observation: "", evidence: "", proposedSolution: "", expectedBenefit: "", dependencies: [], risk: "", requiredTools: [], requiredAgents: [], complexity: "medium", capabilityId: avatar.id, version: "1.0", testPlan: "" });
  const closed = SelfDevelopmentEngine.getInstance().reconcile();
  assert.ok(closed.some((c) => /Avatar identity/.test(c)));
  const after = q.list().find((x) => x.id === p.id)!;
  assert.equal(after.status, "Superseded");
  assert.match(after.superseded!.reason, /available/);
});
