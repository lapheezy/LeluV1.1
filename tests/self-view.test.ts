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
