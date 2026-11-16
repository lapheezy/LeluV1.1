import test from "node:test";
import assert from "node:assert/strict";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import {
  dispatchToolCall,
  executableToolIds,
  registryIdForToolName,
  toolNameForModel,
} from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel, toolSchemaDiagnostics } from "../src/core/tools/ToolSchemas";

const IDS = ["repo.research", "repo.acquire", "repo.inspect", "repo.status"];

const properties = (parameters: unknown): Record<string, { description?: string }> => {
  const shape = parameters as { properties?: Record<string, { description?: string }> };
  return shape.properties ?? {};
};

test("the repository workforce is registered, executable and actually offered to the model", () => {
  const registry = ToolRegistry.getInstance();
  const offered = new Set(toolSchemasForModel().map((schema) => schema.name));

  for (const id of IDS) {
    assert.ok(registry.get(id), `${id} is declared in the registry`);
    assert.ok(executableToolIds().includes(id), `${id} has a real executor`);

    // Offered is the only thing that matters for autonomous use: a tool the
    // model is never shown cannot be chosen, however runnable it is.
    const name = toolNameForModel(id);
    assert.ok(offered.has(name), `${id} is not offered to the model as ${name}`);
    assert.equal(registryIdForToolName(name), id, `${name} does not resolve back to ${id}`);
  }
});

test("every repository tool that is offered carries its real parameter schema", () => {
  const schemas = toolSchemasForModel();
  const byName = new Map(schemas.map((schema) => [schema.name, schema]));

  const research = byName.get("repo_research");
  assert.ok(research, "repo_research is offered");
  const researchProps = properties(research.parameters);
  assert.ok(researchProps.objective, "repo.research tells the model it needs an objective");
  assert.ok(
    String(researchProps.objective.description ?? "").trim().length > 10,
    "the objective parameter explains itself to the model",
  );

  const acquire = byName.get("repo_acquire");
  assert.ok(acquire, "repo_acquire is offered");
  const acquireProps = properties(acquire.parameters);
  assert.ok(acquireProps.identifier, "repo.acquire takes a specific repository");
  assert.ok(acquireProps.authorized, "and an explicit authorization for a commit");

  // Descriptions are what the model reasons over when choosing, so an empty
  // one is the same as not offering the tool.
  for (const schema of schemas) {
    if (!IDS.includes(registryIdForToolName(schema.name))) continue;
    assert.ok(schema.description.trim().length > 20, `${schema.name} has a usable description`);
  }
});

test("the schema diagnostics show the repository tools as offered, not merely registered", () => {
  const rows = toolSchemaDiagnostics().filter((row) => IDS.includes(row.id));
  assert.equal(rows.length, IDS.length);
  for (const row of rows) {
    assert.equal(row.registered, true, `${row.id} registered`);
    assert.equal(row.permitted, true, `${row.id} permitted`);
    assert.equal(row.offered, true, `${row.id} offered`);
  }
});

test("a model-named repository call reaches the real executor and its result comes back", async () => {
  const result = await dispatchToolCall({ id: "chat-1", name: "repo_status", arguments: {} }, "repo-chat-status");
  assert.equal(result.ok, true, result.content);
  // The executor reports the real runtime, not a claim about one.
  assert.match(result.content, /Runtime (reachable|not reachable)/);
});

test("inspection of an acquisition that does not exist fails honestly", async () => {
  const result = await dispatchToolCall(
    { id: "chat-2", name: "repo_inspect", arguments: { acquisitionId: "acq-does-not-exist" } },
    "repo-chat-inspect",
  );
  assert.equal(result.ok, false);
  assert.match(result.content, /acq-does-not-exist|no acquisition|could not/i);
});

test("acquisition without an objective is refused before anything is cloned", async () => {
  const result = await dispatchToolCall({ id: "chat-3", name: "repo_acquire", arguments: {} }, "repo-chat-acquire");
  assert.equal(result.ok, false);
  assert.match(result.content, /needs an objective/);
});

test("an unknown repository tool name is refused with the dispatcher's own wording", async () => {
  const result = await dispatchToolCall({ id: "chat-4", name: "repo_invent", arguments: {} }, "repo-chat-unknown");
  assert.equal(result.ok, false);
  assert.match(result.content, /no tool named|no executor/);
});
