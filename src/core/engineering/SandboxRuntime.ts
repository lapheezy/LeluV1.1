/**
 * ==========================================================
 * LÉLU
 * SANDBOX RUNTIME — main-thread controller for the isolated
 * JavaScript execution engine.
 *
 *   - `run()` executes a sandbox entry file for real (offline).
 *   - `test()` runs the sandbox test files through the harness.
 *   - `syntaxCheck()` compiles every JS file and reports errors.
 *   - `preview()` assembles a self-contained HTML document for
 *     the visual-inspection iframe.
 *
 * Each job runs in a fresh Web Worker so state never bleeds
 * between runs; a hard timeout terminates the worker (this is
 * the real "stop/cancel" + timeout enforcement). Output, exit
 * code, timing and test results are captured and returned.
 * ==========================================================
 */

import SandboxFS from "./SandboxFS";

export type SandboxRunKind = "run" | "test" | "syntax" | "preview";

export interface SandboxRunOptions {
  kind: SandboxRunKind;
  entry?: string;
  timeoutMs?: number;
}

export interface SandboxTestResult {
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

export interface SandboxRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  tests: SandboxTestResult[];
  previewHtml: string | null;
  syntax: { path: string; ok: boolean; error?: string }[];
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 30_000;

/** Timers guarded so the sandbox never throws when `window` is missing
 *  (non-browser hosts, tests, SSR). In the browser these are the same
 *  APIs the worker isolation relies on. */
function safeSetTimeout(handler: () => void, ms: number): unknown {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    return window.setTimeout(handler, ms);
  }
  return globalThis.setTimeout(handler, ms);
}

function safeClearTimeout(handle: unknown): void {
  if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(handle as number);
    return;
  }
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
}

interface WorkerMessage {
  id: string;
  kind: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  tests: SandboxTestResult[];
  previewHtml: string | null;
  syntax: { path: string; ok: boolean; error?: string }[];
}

export default class SandboxRuntime {
  private static instance: SandboxRuntime | null = null;

  private constructor() {}

  public static getInstance(): SandboxRuntime {
    if (!SandboxRuntime.instance) {
      SandboxRuntime.instance = new SandboxRuntime();
    }
    return SandboxRuntime.instance;
  }

  /** All files currently in the virtual sandbox, keyed by path. */
  public snapshotFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    for (const path of SandboxFS.getInstance().filePaths()) {
      const content = SandboxFS.getInstance().read(path);
      if (content !== null) {
        files[path] = content;
      }
    }
    return files;
  }

  public run(options: SandboxRunOptions): Promise<SandboxRunResult> {
    return this.execute(this.snapshotFiles(), options);
  }

  /** Run a single file (convenience wrapper over `run`). */
  public runFile(path: string, timeoutMs?: number): Promise<SandboxRunResult> {
    return this.execute(this.snapshotFiles(), { kind: "run", entry: path, timeoutMs });
  }

  public test(timeoutMs?: number): Promise<SandboxRunResult> {
    return this.execute(this.snapshotFiles(), { kind: "test", timeoutMs });
  }

  public syntaxCheck(timeoutMs?: number): Promise<SandboxRunResult> {
    return this.execute(this.snapshotFiles(), { kind: "syntax", timeoutMs });
  }

  public preview(timeoutMs?: number): Promise<SandboxRunResult> {
    return this.execute(this.snapshotFiles(), { kind: "preview", timeoutMs });
  }

  /**
   * Execute a job over an explicit file set in a fresh worker.
   * A hard timeout terminates the worker — the isolation boundary
   * for non-terminating generated code.
   */
  public execute(files: Record<string, string>, options: SandboxRunOptions): Promise<SandboxRunResult> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timeoutMs = Math.max(100, Math.min(MAX_TIMEOUT_MS, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));

      let settled = false;
      let worker: Worker | null = null;
      const timer = safeSetTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        worker?.terminate();
        resolve({
          ok: false,
          exitCode: 124,
          stdout: "",
          stderr: `Timed out after ${timeoutMs} ms — execution was terminated.`,
          durationMs: timeoutMs,
          timedOut: true,
          tests: [],
          previewHtml: null,
          syntax: [],
        });
      }, timeoutMs);

      try {
        worker = new Worker(new URL("./sandbox.worker.ts", import.meta.url), { type: "module" });
      } catch (error) {
        safeClearTimeout(timer);
        settled = true;
        resolve({
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: `Could not start the sandbox worker: ${error instanceof Error ? error.message : String(error)}`,
          durationMs: 0,
          timedOut: false,
          tests: [],
          previewHtml: null,
          syntax: [],
        });
        return;
      }

      worker.onmessage = (event: MessageEvent) => {
        if (settled) {
          return;
        }
        settled = true;
        safeClearTimeout(timer);
        worker?.terminate();
        const message = event.data as WorkerMessage;
        resolve({
          ok: message.ok,
          exitCode: message.exitCode,
          stdout: message.stdout,
          stderr: message.stderr,
          durationMs: message.durationMs,
          timedOut: message.timedOut,
          tests: message.tests ?? [],
          previewHtml: message.previewHtml ?? null,
          syntax: message.syntax ?? [],
        });
      };

      worker.onerror = (event: ErrorEvent) => {
        if (settled) {
          return;
        }
        settled = true;
        safeClearTimeout(timer);
        worker?.terminate();
        resolve({
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: `Sandbox worker error: ${event.message}`,
          durationMs: 0,
          timedOut: false,
          tests: [],
          previewHtml: null,
          syntax: [],
        });
      };

      worker.postMessage({ id, kind: options.kind, files, entry: options.entry });
    });
  }
}
