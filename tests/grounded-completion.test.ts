import { test } from "node:test";
import assert from "node:assert/strict";
import { producesSomething } from "../src/core/agentic/TaskExecutor";

test("lookups do not count as making something", () => {
  for (const t of ["references.search", "references.for", "web.search", "memory.recall", "studio.project.list", "studio.project.read"]) assert.equal(producesSomething(t), false, t);
  assert.equal(producesSomething("couture.design", { action: "materials" }), false);
});

test("producing tools count", () => {
  for (const t of ["studio.create", "studio.project.create", "creative.art", "creative.scene3d", "workspace.from_image", "references.apply"]) assert.equal(producesSomething(t), true, t);
  assert.equal(producesSomething("couture.design", { action: "tech-pack" }), true);
});

test("project.manage create counts, list does not", () => {
  assert.equal(producesSomething("project.manage", { action: "create" }), true);
  assert.equal(producesSomething("project.manage", { action: "list" }), false);
});
