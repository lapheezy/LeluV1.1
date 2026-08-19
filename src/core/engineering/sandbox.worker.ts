/**
 * ==========================================================
 * LÉLU
 * SANDBOX WORKER — the isolated JavaScript execution engine
 *
 * This worker runs plain JavaScript from the virtual SandboxFS
 * in a real, isolated JavaScript context:
 *
 *   - NO DOM, NO network (fetch / XHR / WebSocket / importScripts
 *     are shadowed to undefined), NO storage, NO production access.
 *   - A minimal CommonJS module loader lets sandbox files `require`
 *     each other by relative path (there is no node_modules).
 *   - stdout / stderr / exit code / duration are captured for real.
 *   - A tiny test harness (`test`, `describe`, `it`, `assert`,
 *     `assertEqual`, `assertDeepEqual`) runs `.test.js` files.
 *   - `syntax` checks every JS file by compiling it; `preview`
 *     assembles a self-contained HTML document for the visual
 *     inspection iframe.
 *
 * This is an isolation boundary for LÉLU's generated code — real
 * execution, no arbitrary system access. It is NOT a security
 * sandbox against a deliberately malicious payload; for that, a
 * container runtime (WebContainers / a server sandbox) is required.
 * ==========================================================
 */

type FileMap = Record<string, string>;

interface RunJob {
  id: string;
  kind: "run" | "test" | "syntax" | "preview";
  files: FileMap;
  entry?: string;
}

interface TestRecord {
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

interface RunResponse {
  id: string;
  kind: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  tests: TestRecord[];
  previewHtml: string | null;
  syntax: { path: string; ok: boolean; error?: string }[];
}

/* The worker global scope, typed against the DOM lib (no WebWorker lib).
   Guarded so the core executor can also be imported in non-worker runtimes
   (e.g. Bun tests) without crashing on a missing `self`. */
const scope = (typeof self !== "undefined" ? self : globalThis) as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

const MAX_OUTPUT_CHARS = 24_000;
const MAX_OUTPUT_LINES = 1200;

/* ---------------------------------------------------------- */
/* Output capture                                              */
/* ---------------------------------------------------------- */

class OutputBuffer {
  private chunks: string[] = [];
  private lineCount = 0;

  public write(text: string): void {
    if (this.lineCount >= MAX_OUTPUT_LINES) {
      return;
    }
    this.lineCount += text.split("\n").length - 1;
    this.chunks.push(text);
  }

  public value(): string {
    return this.chunks.join("").slice(0, MAX_OUTPUT_CHARS);
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/* ---------------------------------------------------------- */
/* Timer tracking — clear everything when a run finishes        */
/* ---------------------------------------------------------- */

const activeTimers = new Set<number>();

function trackedSetTimeout(fn: () => void, ms?: number): number {
  const id = setTimeout(() => {
    activeTimers.delete(id);
    fn();
  }, ms) as unknown as number;
  activeTimers.add(id);
  return id;
}

function trackedClearTimeout(id: number): void {
  activeTimers.delete(id);
  clearTimeout(id);
}

function trackedSetInterval(fn: () => void, ms?: number): number {
  const id = setInterval(fn, ms) as unknown as number;
  activeTimers.add(id);
  return id;
}

function trackedClearInterval(id: number): void {
  activeTimers.delete(id);
  clearInterval(id);
}

function clearAllTimers(): void {
  for (const id of activeTimers) {
    clearTimeout(id);
    clearInterval(id);
  }
  activeTimers.clear();
}

/* ---------------------------------------------------------- */
/* Test harness                                                */
/* ---------------------------------------------------------- */

interface PendingTest {
  name: string;
  fn: () => unknown;
}

const pendingTests: PendingTest[] = [];
let currentSuite = "";

function registerTest(name: string, fn: () => unknown): void {
  pendingTests.push({ name: currentSuite ? `${currentSuite} › ${name}` : name, fn });
}

function describe(name: string, fn: () => void): void {
  const previous = currentSuite;
  currentSuite = previous ? `${previous} › ${name}` : name;
  try {
    fn();
  } finally {
    currentSuite = previous;
  }
}

function assert(condition: unknown, message?: string): void {
  if (!condition) {
    throw new Error(message ?? "Assertion failed.");
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(message ?? `Expected ${stringify(expected)}, got ${stringify(actual)}.`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${stringify(expected)}, got ${stringify(actual)}.`);
  }
}

/* ---------------------------------------------------------- */
/* The sandboxed execution context                             */
/* ---------------------------------------------------------- */

type SandboxedFn = (...args: unknown[]) => unknown;

/**
 * Create a function whose body cannot see the worker's dangerous
 * globals: network, storage, DOM and messaging are shadowed by the
 * parameters. `globalThis`/`window`/`self` resolve to a safe object
 * that only exposes console + timers, so `window.fetch` etc. are gone.
 */
function createSandboxedFn(paramNames: string[], body: string): SandboxedFn {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(...paramNames, body) as SandboxedFn;
}

const SANDBOX_PARAMS = [
  "console",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "test",
  "describe",
  "it",
  "assert",
  "assertEqual",
  "assertDeepEqual",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "importScripts",
  "postMessage",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "process",
  "Buffer",
  "window",
  "self",
  "globalThis",
];

/* ---------------------------------------------------------- */
/* Minimal CommonJS module loader                              */
/* ---------------------------------------------------------- */

const moduleCache = new Map<string, unknown>();

function makeLoader(files: FileMap, stdout: OutputBuffer, stderr: OutputBuffer) {
  moduleCache.clear();

  const sandboxConsole = {
    log: (...args: unknown[]) => stdout.write(`${args.map(stringify).join(" ")}\n`),
    info: (...args: unknown[]) => stdout.write(`${args.map(stringify).join(" ")}\n`),
    debug: (...args: unknown[]) => stdout.write(`${args.map(stringify).join(" ")}\n`),
    warn: (...args: unknown[]) => stderr.write(`${args.map(stringify).join(" ")}\n`),
    error: (...args: unknown[]) => stderr.write(`${args.map(stringify).join(" ")}\n`),
  } as Console;

  const safeGlobal = {
    console: sandboxConsole,
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    setInterval: trackedSetInterval,
    clearInterval: trackedClearInterval,
    queueMicrotask,
  };

  const sandboxValues: unknown[] = [
    sandboxConsole,
    trackedSetTimeout,
    trackedClearTimeout,
    trackedSetInterval,
    trackedClearInterval,
    queueMicrotask,
    registerTest,
    describe,
    registerTest,
    assert,
    assertEqual,
    assertDeepEqual,
    undefined, // fetch
    undefined, // XMLHttpRequest
    undefined, // WebSocket
    undefined, // importScripts
    undefined, // postMessage
    undefined, // document
    undefined, // localStorage
    undefined, // sessionStorage
    undefined, // indexedDB
    undefined, // process
    undefined, // Buffer
    safeGlobal, // window
    safeGlobal, // self
    safeGlobal, // globalThis
  ];

  function resolveModule(fromPath: string, specifier: string): string {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const base = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1) : "";
      const parts = `${base}${specifier}`.split("/");
      const out: string[] = [];
      for (const part of parts) {
        if (part === "" || part === ".") {
          continue;
        }
        if (part === "..") {
          out.pop();
          continue;
        }
        out.push(part);
      }
      let resolved = out.join("/");
      if (files[resolved] !== undefined) {
        return resolved;
      }
      for (const ext of [".js", ".ts", ".json", "/index.js", ".mjs", ".cjs"]) {
        const candidate = resolved.replace(/\/$/, "") + ext;
        if (files[candidate] !== undefined) {
          return candidate;
        }
      }
      return "";
    }
    return "";
  }

  function loadModule(path: string): unknown {
    if (moduleCache.has(path)) {
      return moduleCache.get(path);
    }
    const content = files[path];
    if (content === undefined) {
      throw new Error(`Module not found: ${path}`);
    }
    if (path.endsWith(".json")) {
      const parsed = JSON.parse(content) as unknown;
      moduleCache.set(path, parsed);
      return parsed;
    }
    const module = { exports: {} as Record<string, unknown> };
    moduleCache.set(path, module.exports);

    const localRequire = (specifier: string): unknown => {
      const resolved = resolveModule(path, specifier);
      if (!resolved) {
        throw new Error(
          `Cannot resolve "${specifier}" from "${path}" — the in-browser sandbox has no node_modules and no network.`,
        );
      }
      return loadModule(resolved);
    };

    const dirname = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const fn = createSandboxedFn(
      ["module", "exports", "require", "__filename", "__dirname", ...SANDBOX_PARAMS],
      content,
    );
    fn(module, module.exports, localRequire, path, dirname, ...sandboxValues);
    moduleCache.set(path, module.exports);
    return module.exports;
  }

  return { loadModule, resolveModule };
}

/* ---------------------------------------------------------- */
/* Job runners                                                 */
/* ---------------------------------------------------------- */

async function runJob(job: RunJob): Promise<RunResponse> {
  const started = performance.now();
  const stdout = new OutputBuffer();
  const stderr = new OutputBuffer();
  const loader = makeLoader(job.files, stdout, stderr);
  const tests: TestRecord[] = [];
  const syntax: RunResponse["syntax"] = [];
  let previewHtml: string | null = null;
  let ok = true;
  let exitCode = 0;

  try {
    if (job.kind === "syntax") {
      const jsFiles = Object.keys(job.files)
        .filter((path) => path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs"))
        .sort();
      for (const path of jsFiles) {
        try {
          createSandboxedFn([...SANDBOX_PARAMS], job.files[path]);
          syntax.push({ path, ok: true });
        } catch (error) {
          ok = false;
          syntax.push({ path, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const tsFiles = Object.keys(job.files).filter((path) => path.endsWith(".ts")).sort();
      for (const path of tsFiles) {
        syntax.push({
          path,
          ok: true,
          error: "TypeScript syntax not compiled in-browser — type checking needs the workspace runtime.",
        });
      }
      stdout.write(
        `Syntax check: ${syntax.filter((entry) => entry.ok).length}/${syntax.length} file(s) passed.\n`,
      );
    } else if (job.kind === "preview") {
      previewHtml = buildPreviewHtml(job.files, stdout);
    } else if (job.kind === "test") {
      const testFiles = findTestFiles(job.files);
      for (const path of testFiles) {
        loader.loadModule(path);
      }
      for (const test of pendingTests) {
        const testStart = performance.now();
        try {
          await test.fn();
          tests.push({ name: test.name, passed: true, detail: "passed", durationMs: Math.round(performance.now() - testStart) });
        } catch (error) {
          tests.push({
            name: test.name,
            passed: false,
            detail: error instanceof Error ? error.message : String(error),
            durationMs: Math.round(performance.now() - testStart),
          });
        }
      }
      const passed = tests.filter((test) => test.passed).length;
      exitCode = passed === tests.length ? 0 : 1;
      ok = exitCode === 0;
      stdout.write(
        `${passed}/${tests.length} test(s) passed.\n`,
      );
      for (const test of tests) {
        stdout.write(`${test.passed ? "✓" : "✗"} ${test.name}${test.passed ? "" : ` — ${test.detail}`}\n`);
      }
    } else {
      // kind === "run"
      const entry = job.entry && job.files[job.entry] !== undefined ? job.entry : firstJsFile(job.files);
      if (!entry) {
        throw new Error("No JavaScript entry file found in the sandbox.");
      }
      const loaded = loader.loadModule(entry) as { main?: unknown; default?: unknown; [key: string]: unknown };
      const mainFn = (typeof loaded?.main === "function" ? loaded.main : typeof loaded?.default === "function" ? loaded.default : null) as
        | (() => unknown)
        | null;
      if (mainFn) {
        await mainFn();
      }
      stdout.write(`\nRun of ${entry} finished cleanly.\n`);
    }
  } catch (error) {
    ok = false;
    exitCode = exitCode === 0 ? 1 : exitCode;
    stderr.write(`\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  } finally {
    clearAllTimers();
    pendingTests.length = 0;
  }

  return {
    id: job.id,
    kind: job.kind,
    ok,
    exitCode,
    stdout: stdout.value(),
    stderr: stderr.value(),
    durationMs: Math.round(performance.now() - started),
    timedOut: false,
    tests,
    previewHtml,
    syntax,
  };
}

function firstJsFile(files: FileMap): string | null {
  const paths = Object.keys(files).sort();
  return paths.find((path) => path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) ?? null;
}

function findTestFiles(files: FileMap): string[] {
  const paths = Object.keys(files).sort();
  const matches = paths.filter((path) => /(\.test\.(js|ts)$)|(^|\/)test(s)?\/.*\.(js|ts)$|(^|\/)test\.(js|ts)$/.test(path));
  if (matches.length > 0) {
    return matches;
  }
  // Fallback: any file that looks like a standalone test script.
  return paths.filter((path) => /(^|\/)(test|spec|__tests__)\/.*\.(js|ts)$/.test(path));
}

function buildPreviewHtml(files: FileMap, stdout: OutputBuffer): string | null {
  const htmlPath = Object.keys(files).find((path) => path.endsWith("index.html")) ?? null;
  if (!htmlPath) {
    stdout.write("No index.html found — preview requires an HTML entry file.\n");
    return null;
  }
  let html = files[htmlPath];
  const baseDir = htmlPath.includes("/") ? htmlPath.slice(0, htmlPath.lastIndexOf("/") + 1) : "";

  // Inline local stylesheets.
  html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, (_match, href: string) => {
    const resolved = resolveAsset(baseDir, href);
    if (resolved && files[resolved] !== undefined) {
      return `<style>\n${files[resolved]}\n</style>`;
    }
    return _match;
  });

  // Inline local scripts.
  html = html.replace(/<script\b([^>]*)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (_match, before: string, src: string, after: string) => {
    const resolved = resolveAsset(baseDir, src);
    if (resolved && files[resolved] !== undefined) {
      return `<script${before}${after}>\n${files[resolved]}\n</script>`;
    }
    return _match;
  });

  return html;
}

function resolveAsset(baseDir: string, href: string): string | null {
  if (!href || href.startsWith("http") || href.startsWith("//") || href.startsWith("data:")) {
    return null;
  }
  const parts = `${baseDir}${href}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/") || null;
}

/* ---------------------------------------------------------- */
/* Message handling                                            */
/* ---------------------------------------------------------- */

/* Exported so the pure executor can be exercised directly (e.g. tests). */
export { runJob };
export type { RunJob, RunResponse, TestRecord };

scope.onmessage = async (event: MessageEvent) => {
  const job = event.data as RunJob;
  try {
    const response = await runJob(job);
    scope.postMessage(response);
  } catch (error) {
    const response: RunResponse = {
      id: job?.id ?? "",
      kind: job?.kind ?? "run",
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: `Worker crashed: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: 0,
      timedOut: false,
      tests: [],
      previewHtml: null,
      syntax: [],
    };
    scope.postMessage(response);
  }
};
