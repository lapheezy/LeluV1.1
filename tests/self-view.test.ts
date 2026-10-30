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
  for (const id of ["project.read", "project.edit", "project.write"]) ToolRegistry.getInstance().updateAvailability(id, true);
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

test("a preview capture is compared with her app under the SAME conditions — or told there is nothing comparable", async () => {
  const { compareCaptures } = await import("../src/core/tools/ToolDispatcher");
  const before = [
    { label: "button[Minimize Genesis]", problem: "covered" },
    { label: "button[Enter fullscreen]", problem: "covered" },
  ];
  const fixedOne = compareCaptures(before, [{ label: "button[Enter fullscreen]", problem: "covered" }], "phone, panel memory");
  assert.match(fixedOne, /2 finding\(s\) before → 1 now/);
  assert.match(fixedOne, /resolved: covered: button\[Minimize Genesis\]/);
  assert.match(fixedOne, /still present: covered: button\[Enter fullscreen\]/);
  // Measured mistake: app captured WITH the Memory panel, preview WITHOUT.
  // Different conditions have no "before" at all — and are told so.
  assert.match(compareCaptures(undefined, [], "phone, no panel"), /No capture of your own app at phone, no panel exists to compare with/);
});

test("a preview captured under other conditions is told which problems it says nothing about", async () => {
  const { uncomparedConditions } = await import("../src/core/tools/ToolDispatcher");
  // Measured in run 9: 13 problems with the Avatar panel open, none without;
  // the preview was captured without the panel and reported as the fix.
  const captures = new Map([
    ["phone, no panel", []],
    ["phone, panel avatar", Array.from({ length: 13 }, (_, i) => ({ label: `textarea ${i}`, problem: "partly-off-screen" }))],
  ]);
  const note = uncomparedConditions(captures, "phone, no panel");
  assert.match(note, /says NOTHING about .*phone, panel avatar: 13 finding\(s\) in your app/);
  assert.match(note, /capture the preview with exactly those conditions/);
  assert.equal(uncomparedConditions(captures, "phone, panel avatar"), "", "nothing else had problems: nothing to warn about");
});

test("the layout report is the page as a user first sees it: stable, scroll-aware, and names sideways overflow", async (t) => {
  let chromium: { launch: (options: Record<string, unknown>) => Promise<{ newPage: (o: Record<string, unknown>) => Promise<{ setContent: (html: string) => Promise<void>; evaluate: (script: string) => Promise<unknown> }>; close: () => Promise<void> }> };
  try {
    ({ chromium } = (await import("playwright")) as unknown as { chromium: typeof chromium });
  } catch {
    t.skip("no headless browser in this environment");
    return;
  }
  const { LAYOUT_SCRIPT } = await import("../plugins/selfViewApi");
  const { existsSync } = await import("node:fs");
  const browser = await chromium.launch({ ...(existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}), args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // Modelled on run 8's Avatar panel: a fixed window that clips, a
    // scrolling body, a row wider than the window, controls below the fold.
    await page.setContent(`<body style="margin:0;overflow:hidden">
      <div id="win" style="position:fixed;left:16px;top:100px;width:358px;height:600px;overflow:hidden">
        <div id="body" style="height:600px;overflow:auto">
          <div style="display:flex;gap:14px;width:520px">
            <button style="width:200px;height:34px">Default</button>
            <button style="width:200px;height:34px">Identity</button>
          </div>
          <span style="display:block;width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">a long label that is clipped on purpose</span>
          <div style="height:900px"></div>
          <button style="height:34px">Reset profile</button>
        </div>
      </div>
      <div id="tab" style="position:fixed;left:20px;top:760px;width:110px;overflow:hidden;display:flex">
        <button style="width:70px;height:30px">New chat</button>
        <button style="width:30px;height:30px">…</button>
        <span style="display:inline-block;min-width:60px"></span>
      </div>
      <button style="position:fixed;left:20px;top:20px;width:80px;height:30px">Under</button>
      <div style="position:fixed;left:0;top:0;width:200px;height:60px"></div>
    </body>`);
    await page.evaluate(`document.getElementById("body").scrollLeft = 150`);
    const first = (await page.evaluate(LAYOUT_SCRIPT)) as { findings: Array<{ label: string; problem: string; detail?: string }>; belowTheFold: number; scrollsReset: number };
    const second = (await page.evaluate(LAYOUT_SCRIPT)) as typeof first;
    const seen = (r: typeof first) => r.findings.map((f) => `${f.problem}: ${f.label}`).sort();

    assert.equal(first.scrollsReset, 1, "the sideways scroll left by the app is undone before measuring");
    assert.deepEqual(seen(first), seen(second), "same page, same report");
    assert.ok(seen(first).includes('partly-off-screen: button "Identity"'), "cut off by the WINDOW's edge (366px), not only the viewport's: " + seen(first).join(" | "));
    assert.ok(!seen(first).some((f) => f.includes('button "Default"')), "fully inside the window: " + seen(first).join(" | "));
    assert.ok(!seen(first).some((f) => f.includes("Reset profile")), "below the fold of a scrolling body: reachable, not a problem");
    assert.equal(first.belowTheFold, 1);
    assert.ok(seen(first).includes('covered: button "Under"'));
    const overflow = first.findings.filter((f) => f.problem === "sideways-overflow");
    assert.equal(overflow.length, 1, "the outermost box that hides controls sideways — not the ellipsis label, nor a tab whose content is wider but cuts no control off: " + JSON.stringify(overflow));
    assert.match(overflow[0].detail ?? "", /content 5\d\dpx wide in a 3\d\dpx box/);
    // Where it begins: the row is wider than the window it sits in.
    assert.match(overflow[0].detail ?? "", /the overflow begins at: div "Default Identity" \(width 520px, needs at least 414px, display flex\) → button "Identity" \(width 200px, needs at least 59px, min-width auto\)/);

    // An expanded panel: a see-through fixed backdrop over the whole screen,
    // the way GenesisModuleHost renders one. What is behind it is covered on
    // purpose; an opaque full-screen layer still counts as covering.
    await page.evaluate(`(() => {
      const backdrop = document.createElement("div");
      backdrop.id = "backdrop";
      backdrop.style.cssText = "position:fixed;inset:0;background:rgba(2,6,23,0.55);z-index:50";
      document.body.appendChild(backdrop);
    })()`);
    const modal = (await page.evaluate(LAYOUT_SCRIPT)) as typeof first & { behindModal: number };
    assert.ok(!seen(modal).some((f) => f.startsWith("covered:")), "nothing is reported covered behind a modal backdrop: " + seen(modal).join(" | "));
    assert.ok(modal.behindModal >= 3, "but it is counted: " + modal.behindModal);
    await page.evaluate(`document.getElementById("backdrop").style.background = "rgb(2,6,23)"`);
    const opaque = (await page.evaluate(LAYOUT_SCRIPT)) as typeof first;
    assert.ok(seen(opaque).includes('covered: button "Under"'), "an opaque layer over controls is still a problem");
  } finally {
    await browser.close();
  }
});

test("project_write refuses what cannot be meant: read-display text and placeholders for unwritten code", async () => {
  const { unsavableContent } = await import("../src/core/tools/ToolDispatcher");
  const css = Array.from({ length: 1089 }, (_, i) => `.rule-${i} { color: red; }`).join("\n");
  const runtime = fakeRuntime({ "src/index.css": css, "src/a.tsx": "export const a = 1;\n" });
  try {
    // Measured in run 10, verbatim: the original stylesheet "kept" by a comment.
    const gutted = "/* (full original stylesheet – 1089 lines) */\n\n@media (max-width: 420px) {\n  [data-testid=\"lelu-companion\"] { display: none !important; }\n}\n";
    const refused = await dispatchToolCall({ id: "w1", name: "project_write", arguments: { workspace: "ws", path: "src/index.css", content: gutted, allowShrink: true } }, "t");
    assert.equal(refused.ok, false);
    assert.match(refused.content, /placeholder where code should be .*full original stylesheet/);
    // Measured in run 10: project_read's own display written into the source.
    const display = "src/a.tsx — lines 1–3 of 3 (the \"N| \" prefixes are not part of the file)\n  1| export const a = 1;\n  2| export const b = 2;\n  3| export const c = 3;\n";
    const refusedDisplay = await dispatchToolCall({ id: "w2", name: "project_write", arguments: { workspace: "ws", path: "src/a.tsx", content: display } }, "t");
    assert.equal(refusedDisplay.ok, false);
    assert.match(refusedDisplay.content, /project_read's display/);
    assert.equal(runtime.writes.length, 0, "nothing was written");

    const real = await dispatchToolCall({ id: "w3", name: "project_write", arguments: { workspace: "ws", path: "src/a.tsx", content: "// Keep the existing export name: callers import it.\nexport const a = 2;\n" } }, "t");
    assert.equal(real.ok, true, real.content);
  } finally {
    runtime.restore();
  }
  // Ordinary comments are not placeholders.
  for (const fine of ["// the rest is handled by the router", "/* original design: 3 columns */", "# Section heading", "// ...and the caller retries"]) {
    assert.equal(unsavableContent(`${fine}\nconst x = 1;\n`), null, fine);
  }
  for (const placeholder of ["// ... rest of the component unchanged", "{/* ...existing code... */}", "/* (rest unchanged) */", "  // remainder of the file as before", "// ...", "  /* … */"]) {
    assert.ok(unsavableContent(`const x = 1;\n${placeholder}\n`), placeholder);
  }
});

test("a finding seen in only some loads of the same page is marked, and is no evidence of a fix", async () => {
  const { mergeLoads } = await import("../plugins/selfViewApi");
  const { compareCaptures } = await import("../src/core/tools/ToolDispatcher");
  // Measured in run 20: the chat panel, loaded twice — once a background
  // message's unread dot widened a tab and cut off its options button.
  const dot = { label: "button[Options for Engineering]", rect: [237, 71, 32, 32] as [number, number, number, number], problem: "partly-off-screen" as const };
  const merged = mergeLoads([{ findings: [] }, { findings: [dot] }]);
  assert.equal(merged.loads, 2);
  assert.equal(merged.stable, false);
  assert.equal(merged.findings?.[0].seenIn, 1);
  assert.equal(mergeLoads([{ findings: [dot] }, { findings: [dot] }]).stable, true);

  // Her app showed it in one load, her preview in none: "2 → 0" was two
  // app states. The comparison does not call it resolved.
  const report = compareCaptures([{ label: dot.label, problem: dot.problem, intermittent: true }], [], "phone, panel chat");
  assert.match(report, /resolved: none/);
  assert.match(report, /NOT EVIDENCE either way .*partly-off-screen: button\[Options for Engineering\]/);
  // A stable finding that disappears IS resolved.
  assert.match(compareCaptures([{ label: dot.label, problem: dot.problem }], [], "phone, panel chat"), /resolved: partly-off-screen: button\[Options for Engineering\]/);
});

test("a control covered only while a panel opens is seen, timed, and reported apart from the settled layout", async (t) => {
  const { coveredWhileOpening, watchCoveringScript, LAYOUT_SCRIPT } = await import("../plugins/selfViewApi");
  // The pure rule first: short flickers and controls still covered once
  // settled are not "while opening" findings.
  const watched = [
    { label: 'button "New chat"', rect: [10, 10, 80, 30] as [number, number, number, number], coveredBy: "div#companion", ms: 1900, from: 300, to: 2200 },
    { label: 'button "Search"', rect: [100, 10, 30, 30] as [number, number, number, number], coveredBy: "div#companion", ms: 60, from: 300, to: 360 },
    { label: 'button "Under"', rect: [20, 20, 80, 30] as [number, number, number, number], coveredBy: "div", ms: 6000, from: 0, to: 6000 },
  ];
  const settled = [{ label: 'button "Under"', rect: [20, 20, 80, 30] as [number, number, number, number], problem: "covered" as const, coveredBy: "div" }];
  const found = coveredWhileOpening(watched, settled);
  assert.deepEqual(found.map((f) => `${f.problem}: ${f.label}`), ['covered-while-opening: button "New chat"']);
  assert.match(found[0].detail ?? "", /covered for 1900 ms between 300 and 2200 ms after the panel was opened/);

  let chromium: { launch: (options: Record<string, unknown>) => Promise<{ newPage: (o: Record<string, unknown>) => Promise<{ setContent: (html: string) => Promise<void>; evaluate: (script: string) => Promise<unknown> }>; close: () => Promise<void> }> };
  try {
    ({ chromium } = (await import("playwright")) as unknown as { chromium: typeof chromium });
  } catch {
    t.skip("no headless browser in this environment");
    return;
  }
  const { existsSync } = await import("node:fs");
  const browser = await chromium.launch({ ...(existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}), args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // Modelled on run 24: a figure starts over the header, then moves away.
    await page.setContent(`<body style="margin:0">
      <button style="position:fixed;left:10px;top:10px;width:80px;height:30px">Search  all chats</button>
      <button style="position:fixed;left:200px;top:10px;width:80px;height:30px">Stays clear</button>
      <div id="companion" style="position:fixed;left:0;top:0;width:110px;height:235px"></div>
      <script>setTimeout(() => { document.getElementById("companion").style.top = "400px"; }, 800);</script>
    </body>`);
    const watch = (await page.evaluate(watchCoveringScript(2000))) as { opened: string | null; covered: Array<{ label: string; coveredBy: string; ms: number; from: number; to: number }> };
    assert.equal(watch.opened, null, "no panel was asked for");
    assert.deepEqual(watch.covered.map((c) => c.label), ['button "Search all chats"'], "named by its text, whitespace collapsed: " + JSON.stringify(watch.covered));
    assert.match(watch.covered[0].coveredBy, /div#companion/);
    assert.ok(watch.covered[0].ms > 400 && watch.covered[0].ms < 1500, `about 800 ms: ${watch.covered[0].ms}`);
    const layout = (await page.evaluate(LAYOUT_SCRIPT)) as { findings: Array<{ label: string; problem: string; rect: [number, number, number, number] }> };
    assert.ok(!layout.findings.some((f) => f.problem === "covered"), "once settled nothing is covered — which is why the settled report alone read 0");
    assert.equal(coveredWhileOpening(watch.covered as never, layout.findings as never).length, 1);
  } finally {
    await browser.close();
  }
});

test("a fresh session is told about the copies already in the sandbox, and that project_copy would replace one", async () => {
  const { describeEarlierCopies } = await import("../src/core/engineering/EngineeringWorkspace");
  assert.equal(describeEarlierCopies([]), "No project copy exists in the engineering sandbox.");
  const text = describeEarlierCopies([
    { id: "old", root: "/x/old", createdAt: 1, fileCount: 10 },
    { id: "default", root: "/x/default", createdAt: 2, fileCount: 1274 },
  ]);
  assert.match(text, /already holds 2 from earlier: "default" \(1274 files\), "old" \(10 files\)/, "newest first");
  assert.match(text, /use one by passing its id to the project tools/);
  assert.match(text, /project_copy with an existing id replaces that copy's contents/);
});
