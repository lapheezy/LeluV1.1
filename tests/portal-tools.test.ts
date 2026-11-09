/**
 * Mission 5.2 — the agent's portal tools.
 *
 * The portal channel already existed as a DOM event contract. What did not
 * exist was a tool entry, so a conversation could not reach it: an executor in
 * the dispatcher is what makes a capability advertisable to a model.
 *
 * These tests pin the honest parts: the tool is registered with the right risk,
 * its destinations come from the scene graph (no second list to drift), and an
 * executor with no mounted interface refuses instead of claiming a portal.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { INTERFACE_EXECUTORS, INTERFACE_TOOLS } from "../src/core/interface/InterfaceTools";
import { SPATIAL_DESTINATIONS } from "../src/app/scene/spatial/SpatialScenes";

const tool = (id: string) => INTERFACE_TOOLS.find((entry) => entry.id === id);
const executor = (id: string) => INTERFACE_EXECUTORS.find((entry) => entry.id === id);

test("the portal tools are registered as real interface capabilities", () => {
  const create = tool("spatial.portal.create");
  const remove = tool("spatial.portal.remove");
  assert.ok(create, "spatial.portal.create is registered");
  assert.ok(remove, "spatial.portal.remove is registered");
  for (const entry of [create!, remove!]) {
    assert.equal(entry.category, "Interface");
    assert.equal(entry.riskLevel, 1, `${entry.id} changes local state only`);
    assert.deepEqual(entry.permissions, ["WRITE"]);
    assert.equal(entry.available, true);
    assert.ok(entry.description.length > 40, "the model gets a usable description");
  }
});

test("portal destinations are the scene graph's own list, never a copy", () => {
  const parameters = executor("spatial.portal.create")?.parameters as {
    properties?: { destination?: { enum?: string[] } };
    required?: string[];
  };
  assert.ok(parameters?.properties?.destination?.enum, "the destination is an enum");
  assert.deepEqual(
    [...(parameters.properties.destination.enum ?? [])].sort(),
    SPATIAL_DESTINATIONS.map((destination) => destination.id).sort(),
  );
  assert.deepEqual(parameters.required, ["destination"]);
});

test("both tools have an executor, so neither can be offered without running", () => {
  for (const id of ["spatial.portal.create", "spatial.portal.remove"]) {
    const entry = executor(id);
    assert.ok(entry, `${id} has an executor`);
    assert.equal(typeof entry!.run, "function");
    assert.ok(entry!.parameters, `${id} declares parameters`);
  }
});

test("with no interface mounted, creating refuses instead of faking success", async () => {
  const previous = (globalThis as { window?: unknown }).window;
  delete (globalThis as { window?: unknown }).window;
  try {
    const result = await executor("spatial.portal.create")!.run({ destination: "files" });
    assert.equal(result.ok, false);
    assert.match(result.content, /No portal was created/);
    assert.match(result.content, /no spatial interface/i);
  } finally {
    if (previous !== undefined) (globalThis as { window?: unknown }).window = previous;
  }
});

test("a built-in ring identity cannot be removed as if a person made it", async () => {
  const result = await executor("spatial.portal.remove")!.run({ id: "scene:files" });
  assert.equal(result.ok, false);
  assert.match(result.content, /built-in destination/i);
});

test("removing without an id asks for one rather than guessing", async () => {
  const result = await executor("spatial.portal.remove")!.run({ id: "  " });
  assert.equal(result.ok, false);
  assert.match(result.content, /Give the id/i);
});
