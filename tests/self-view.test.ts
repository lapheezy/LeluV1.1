/**
 * ==========================================================
 * LÉLU — HER EYES: CAPTURE, PREVIEW AND SEARCH
 *
 * CATEGORY: unit. The real selfViewApi helpers and the real tool
 * executors; the runtime response is stubbed at fetch (the live capture
 * against the running app is exercised by hand and recorded in
 * docs/LELU_V1_1_HANDOFF_PROGRESS.md).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => {},
    get length() { return Object.keys(store).length; },
    key: () => null,
  };
}

import { captureTargetAllowed, safeWorkspaceId, searchFiles } from "../plugins/selfViewApi";
import { dispatchToolCall, executableToolIds } from "../src/core/tools/ToolDispatcher";
import AgentEventBus, { type AgentEvent } from "../src/core/agent/AgentEvents";
import ToolRegistry from "../src/core/tools/ToolRegistry";

test("capture reaches public pages, this app and its previews — nothing else on the private network", () => {
  const own = "127.0.0.1:5173";
  const previews = ["127.0.0.1:5310"];
  assert.equal(captureTargetAllowed(new URL("https://example.com/"), own, previews), true);
  assert.equal(captureTargetAllowed(new URL("http://127.0.0.1:5173/"), own, previews), true, "her own UI");
  assert.equal(captureTargetAllowed(new URL("http://127.0.0.1:5310/"), own, previews), true, "her preview");
  assert.equal(captureTargetAllowed(new URL("http://127.0.0.1:6379/"), own, previews), false, "another local service");
  assert.equal(captureTargetAllowed(new URL("http://169.254.169.254/latest/meta-data"), own, previews), false, "cloud metadata");
  assert.equal(captureTargetAllowed(new URL("http://192.168.1.1/"), own, previews), false);
  assert.equal(captureTargetAllowed(new URL("file:///etc/passwd"), own, previews), false);
});

test("a workspace id cannot walk out of the sandbox", () => {
  assert.equal(safeWorkspaceId("ui-fix-1"), "ui-fix-1");
  for (const bad of ["../etc", "a/b", "", ".hidden", "x".repeat(65)]) {
    assert.throws(() => safeWorkspaceId(bad), /workspace id/, bad);
  }
});

test("search finds real code, bounded, and never leaves its root", () => {
  const found = searchFiles(process.cwd(), "export default function LeluCompanion", { under: "src/app" });
  assert.ok(found.matches.some((m) => m.path === "src/app/scene/genesis/avatar/LeluCompanion.tsx"), JSON.stringify(found.matches));
  const many = searchFiles(process.cwd(), "import", { limit: 5 });
  assert.equal(many.matches.length, 5);
  assert.equal(many.truncated, true);
  assert.throws(() => searchFiles(process.cwd(), "x", { under: "../.." }), /escapes/);
});

test("browser_capture shows the real screenshot in chat and returns the measured layout report", async () => {
  assert.ok(executableToolIds().includes("browser.capture"));
  const realFetch = globalThis.fetch;
  let sent: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        ok: true,
        url: "http://127.0.0.1:5173/",
        title: "LÉLU",
        panelOpened: "avatar",
        layout: {
          viewport: [390, 844],
          controls: 42,
          findings: [{ label: 'button "Save"', rect: [446, 313, 64, 34], problem: "off-screen" }],
          text: "Avatar · persistent identity",
        },
        screenshot: "data:image/jpeg;base64,AAAA",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const seen: AgentEvent[] = [];
  const off = AgentEventBus.getInstance().subscribe((event) => seen.push(event));
  try {
    const result = await dispatchToolCall({ id: "c", name: "browser_capture", arguments: { target: "app", viewport: "phone", panel: "avatar" } }, "t");
    assert.equal(result.ok, true, result.content);
    assert.deepEqual(sent, { viewport: "phone", panel: "avatar", app: true });
    assert.match(result.content, /off-screen: button "Save" at \[x 446, y 313, w 64, h 34\]/);
    const artifact = seen.find((event) => event.type === "creative_artifact");
    assert.ok(artifact && artifact.type === "creative_artifact" && artifact.image === "data:image/jpeg;base64,AAAA", "the screenshot goes to chat + workspace");
  } finally {
    off();
    globalThis.fetch = realFetch;
  }
});

test("a failed capture says so and shows nothing", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, error: "No headless browser on this server" }), { status: 503 })) as typeof fetch;
  const seen: AgentEvent[] = [];
  const off = AgentEventBus.getInstance().subscribe((event) => seen.push(event));
  try {
    const result = await dispatchToolCall({ id: "c2", name: "browser_capture", arguments: { target: "url", url: "https://example.com" } }, "t");
    assert.equal(result.ok, false);
    assert.match(result.content, /Nothing was captured: No headless browser/);
    assert.ok(!seen.some((event) => event.type === "creative_artifact"));
  } finally {
    off();
    globalThis.fetch = realFetch;
  }
});

/* ------------------- reading and editing without flooding ------------------- */

function fakeRuntime(files: Record<string, string>) {
  // No runtime probe in a test process: mark the two tools available, as a
  // successful probe would.
  for (const id of ["project.read", "project.edit"]) ToolRegistry.getInstance().updateAvailability(id, true);
  const realFetch = globalThis.fetch;
  const writes: Array<{ path: string; content: string }> = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    const route = String(url);
    if (route.endsWith("/api/engineer/read")) {
      const content = files[body.path];
      return new Response(JSON.stringify(content === undefined ? { ok: false, error: "no such file" } : { ok: true, content }), { status: 200 });
    }
    if (route.endsWith("/api/engineer/write")) {
      files[body.path] = body.content;
      writes.push({ path: body.path, content: body.content });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, error: `unexpected ${route}` }), { status: 404 });
  }) as typeof fetch;
  return { writes, restore: () => { globalThis.fetch = realFetch; } };
}

test("project_read returns a numbered window, not the whole file", async () => {
  const file = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join("\n");
  const runtime = fakeRuntime({ "src/big.tsx": file });
  try {
    const first = await dispatchToolCall({ id: "r1", name: "project_read", arguments: { workspace: "ws", path: "src/big.tsx" } }, "t");
    assert.equal(first.ok, true, first.content);
    assert.match(first.content, /lines 1–250 of 600/);
    assert.match(first.content, /\n  1\| line 1\n/);
    assert.match(first.content, /lines 251–600 not shown \(read them with startLine=251\)/);
    assert.ok(!first.content.includes("line 251\n"), "the rest is not sent");
    const range = await dispatchToolCall({ id: "r2", name: "project_read", arguments: { workspace: "ws", path: "src/big.tsx", startLine: 590, endLine: 700 } }, "t");
    assert.match(range.content, /lines 590–600 of 600/);
    assert.ok(!/not shown/.test(range.content));
  } finally {
    runtime.restore();
  }
});

test("project_edit replaces exactly one snippet, and refuses ambiguity or absence", async () => {
  const runtime = fakeRuntime({ "src/panel.tsx": "a\nconst width = 780;\nb\nconst gap = 8;\nc\nconst gap = 8;\n" });
  try {
    const ok = await dispatchToolCall({ id: "e1", name: "project_edit", arguments: { workspace: "ws", path: "src/panel.tsx", find: "const width = 780;", replace: "const width = Math.min(780, innerWidth - 24);" } }, "t");
    assert.equal(ok.ok, true, ok.content);
    assert.match(ok.content, /Edited src\/panel\.tsx at line 2/);
    assert.equal(runtime.writes.at(-1)?.content, "a\nconst width = Math.min(780, innerWidth - 24);\nb\nconst gap = 8;\nc\nconst gap = 8;\n");

    const twice = await dispatchToolCall({ id: "e2", name: "project_edit", arguments: { workspace: "ws", path: "src/panel.tsx", find: "const gap = 8;", replace: "x" } }, "t");
    assert.equal(twice.ok, false);
    assert.match(twice.content, /occurs 2 times .* nothing was changed/);

    const absent = await dispatchToolCall({ id: "e3", name: "project_edit", arguments: { workspace: "ws", path: "src/panel.tsx", find: "  2| const width", replace: "x" } }, "t");
    assert.equal(absent.ok, false);
    assert.match(absent.content, /does not occur .*\(without the "N\| " line-number prefixes\)/);
    assert.equal(runtime.writes.length, 1, "refusals write nothing");
  } finally {
    runtime.restore();
  }
});

test("project_edit tolerates the model's indentation, re-indents to the file's, and still refuses ambiguity", async () => {
  const { locateSnippet } = await import("../src/core/tools/ToolDispatcher");
  const file = "function a() {\n        style={{\n          width: 34,\n          height: 34,\n        }}\n}\n";
  // The model dropped the indentation (measured: the commonest refusal).
  const found = locateSnippet(file, "width: 34,\nheight: 34,", "width: 44,\nheight: 44,\nminWidth: 44,");
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.equal(found.tolerant, true);
  const next = file.slice(0, found.start) + found.replacement + file.slice(found.end);
  assert.equal(next, "function a() {\n        style={{\n          width: 44,\n          height: 44,\n          minWidth: 44,\n        }}\n}\n");

  const exact = locateSnippet(file, "          width: 34,", "          width: 40,");
  assert.ok(exact.ok && !exact.tolerant, "an exact match is used as-is");
  assert.deepEqual(locateSnippet("  x\n  y\n x\n y\n", "x\ny", "z"), { ok: false, count: 2 }, "two tolerant matches: refused");
  assert.deepEqual(locateSnippet(file, "depth: 3", "z"), { ok: false, count: 0 });
});
