/**
 * ==========================================================
 * LÉLU — THE ARTIFACT THE USER SELECTED IS THE ONE SHE CHANGES
 *
 * CATEGORY: integration. Real WorkspaceEngine, real WorkspaceArtifacts,
 * real ToolDispatcher (artifact_read / artifact_edit / artifact_create
 * through dispatchToolCall, with its permission check), and the real
 * cognitive context. No model: the calls are the ones a model makes.
 * The running app is checked by scripts/verify-workspace-artifacts.mjs.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import { describeWorkspace, draftArtifact, planArtifactEdit, resolveArtifact } from "../src/core/workspace/WorkspaceArtifacts";
import { dispatchToolCall, executableToolIds } from "../src/core/tools/ToolDispatcher";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { buildCognitiveContext, formatCognitiveContext } from "../src/core/cognition/CognitiveContext";

const engine = WorkspaceEngine.getInstance();
const call = (name: string, args: Record<string, unknown>) => dispatchToolCall({ id: name, name, arguments: args }, "t-artifacts");
const view = (id: string) => engine.getState().views.find((item) => item.id === id)!;

const PNG = `data:image/png;base64,${"A".repeat(4000)}`;

function openCaptureAndPage() {
  engine.openView({
    id: "cap-1",
    kind: "image",
    title: "example.com (desktop)",
    url: PNG,
    text: "Title: Example Domain\nThis domain is for use in illustrative examples in documents.",
    source: { tool: "capture", url: "https://example.com/" },
  });
  engine.openView({
    id: "page-1",
    kind: "browser",
    title: "Example Domain",
    url: "https://example.com/",
    text: "This domain is for use in illustrative examples.",
    source: { tool: "browser", url: "https://example.com/" },
  });
}

beforeEach(() => engine.clear());

test("the user's selection holds while LÉLU opens other things, and ends when its view closes", () => {
  openCaptureAndPage();
  assert.equal(engine.getState().focusId, "page-1", "the last opened is in front");
  engine.selectView("cap-1");
  assert.equal(engine.getState().selectedId, "cap-1");
  engine.openView({ id: "note-x", kind: "file", title: "Scratch", text: "…" });
  assert.equal(engine.getState().focusId, "note-x", "focus follows her");
  assert.equal(engine.getState().selectedId, "cap-1", "the selection does not");
  assert.equal(resolveArtifact(engine.getState(), "this")?.id, "cap-1", "“this” is the selection, not what is in front");
  assert.equal(resolveArtifact(engine.getState(), "Example Domain")?.id, "page-1", "a title names an artifact");
  engine.selectView("nope");
  assert.equal(engine.getState().selectedId, "cap-1", "a view that does not exist cannot be selected");
  engine.closeView("cap-1");
  assert.equal(engine.getState().selectedId, null);
  assert.equal(engine.getSelected(), null);
});

test("her context names the selected artifact and what it holds — never a data URL", () => {
  openCaptureAndPage();
  engine.selectView("cap-1");
  const text = formatCognitiveContext(buildCognitiveContext());
  const section = text.slice(text.indexOf("## VISUAL WORKSPACE"));
  assert.match(section, /\[cap-1\] image “example\.com \(desktop\)” · revision 1 · from capture \(https:\/\/example\.com\/\) — SELECTED by the user/);
  assert.match(section, /they mean it:[\s\S]*Example Domain/);
  assert.match(section, /image\/png, about \d+ KB/);
  assert.ok(!section.includes("base64"), "the image's bytes are not pasted into her prompt");
  engine.selectView(null);
  assert.match(describeWorkspace(engine.getState()), /has not selected an artifact/);
});

test("artifact_edit changes the REAL selected view — the one the user sees — and its revision", async () => {
  for (const id of ["artifact.read", "artifact.edit", "artifact.create"]) {
    assert.ok(ToolRegistry.getInstance().get(id), `${id} registered`);
    assert.ok(executableToolIds().includes(id), `${id} runnable`);
  }
  openCaptureAndPage();
  engine.selectView("cap-1");
  const read = await call("artifact_read", {});
  assert.equal(read.ok, true);
  assert.match(read.content, /illustrative examples/);

  const edited = await call("artifact_edit", { title: "Example Domain — homepage", append: "Note: single paragraph, one link." });
  assert.equal(edited.ok, true, edited.content);
  assert.equal(view("cap-1").title, "Example Domain — homepage");
  assert.match(view("cap-1").text ?? "", /single paragraph, one link\.$/);
  assert.equal(view("cap-1").revision, 2);
  assert.equal(view("cap-1").url, PNG, "the image itself is untouched");
  assert.equal(view("page-1").revision, 1, "the other artifact is untouched");
  assert.equal(engine.getState().focusId, "cap-1", "the changed artifact is brought to the front");
  assert.match(edited.content, /revision 2/);
});

test("a change that cannot be made is refused with the reason, and nothing changes", async () => {
  openCaptureAndPage();
  engine.selectView("cap-1");
  const nodes = await call("artifact_edit", { addNodes: ["Header"] });
  assert.equal(nodes.ok, false);
  assert.match(nodes.content, /an image: it has no nodes/);
  const missing = await call("artifact_edit", { find: "not in there", replace: "x" });
  assert.equal(missing.ok, false);
  assert.match(missing.content, /nothing was changed/);
  assert.equal(view("cap-1").revision, 1);
  engine.selectView(null);
  engine.clear();
  const none = await call("artifact_edit", { title: "x" });
  assert.equal(none.ok, false);
  assert.match(none.content, /No artifacts are open/);
});

test("artifact_create makes a note, a diagram and a table she can then change by id", async () => {
  const made = await call("artifact_create", {
    kind: "diagram",
    title: "Example page structure",
    nodes: ["Heading", "Paragraph", "Link"],
    connections: [{ from: "Heading", to: "Paragraph" }],
  });
  assert.equal(made.ok, true, made.content);
  const id = String((made.data as { id: string }).id);
  assert.equal(view(id).source?.tool, "lelu");
  const connected = await call("artifact_edit", { artifact: id, connect: { from: "Paragraph", to: "Link", label: "contains" }, renameNode: { node: "Link", label: "More information link" } });
  assert.equal(connected.ok, true, connected.content);
  const spec = view(id).spec!;
  assert.deepEqual(spec.edges, [{ from: "heading", to: "paragraph" }, { from: "paragraph", to: "link", label: "contains" }]);
  assert.equal(spec.nodes!.find((node) => node.id === "link")?.label, "More information link");
  const removed = planArtifactEdit(view(id), { removeNode: "Paragraph" });
  assert.ok(removed.ok && removed.patch.spec!.edges!.length === 0, "removing a node removes its connections");

  const table = draftArtifact({ kind: "table", title: "Links", columns: ["Text", "Href"], rows: [["More information...", "https://iana.org/domains/example"]] });
  assert.ok(table.ok);
  const tableView = engine.openView({ ...table.view, id: "tbl" });
  const row = planArtifactEdit(tableView, { addRow: { Text: "Home", Href: "/" } });
  assert.ok(row.ok && row.patch.spec!.rows!.length === 2 && !("nodes" in row.patch.spec!), "a table gains a row, not nodes");
  assert.equal(draftArtifact({ kind: "note", title: "Empty" }).ok, false, "a note needs text");
});
