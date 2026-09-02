/**
 * ==========================================================
 * LÉLU
 * SOURCE ACCESS — one honest door onto her own project
 *
 * Every self-inspection read goes through here, and every read
 * says WHERE it came from:
 *
 *   REAL DEVELOPMENT RUNTIME — the engineering API (/api/engineer/*)
 *     is reachable, so the file on disk right now is the answer.
 *     Directory listings, whitelisted commands (typecheck / test /
 *     build / inspect) and live runtime facts are available too.
 *
 *   STATIC SNAPSHOT — the engineering API is unreachable (a purely
 *     static deployment), so the answer comes from the build-time
 *     `import.meta.glob(..., "?raw")` bundle. Still real source, but
 *     frozen at build time: it cannot see edits, tests, or runtime.
 *
 * The fallback is deliberately kept — LÉLU must still be able to
 * read herself on a static host — but it is never presented as the
 * development runtime. `status()` reports which one is live and why.
 *
 * Connecting a deployed front-end to a real development runtime:
 *   client → VITE_LELU_ENGINEER_URL   (base URL of the runtime)
 *            VITE_LELU_ENGINEER_TOKEN (when the runtime sets
 *                                      LELU_ENGINEER_TOKEN)
 *   server → LELU_ENGINEER_ALLOWED_ORIGINS (the front-end's origin)
 *
 * There is exactly one implementation of this path: SelfCode,
 * EngineeringToolset and the self-study engine all read through it.
 * ==========================================================
 */

export type SourceOrigin = "development-runtime" | "static-snapshot" | "unavailable";

export interface SourceRead {
  path: string;
  content: string | null;
  origin: SourceOrigin;
  /** Runtime label reported by the engineering API ("vite-dev", "node-server", "deno"). */
  runtime: string | null;
  error?: string;
}

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface SourceListing {
  path: string;
  origin: SourceOrigin;
  entries: DirEntry[];
  error?: string;
}

export interface RuntimeInfo {
  engine: string;
  version: string;
  platform: string;
  cwd: string;
  startedAt: number;
}

export interface RuntimeStatus {
  /** True only when the engineering API answered. */
  reachable: boolean;
  /** "vite-dev" | "node-server" | "deno" | null */
  runtime: string | null;
  operations: string[];
  workspace: string;
  tokenRequired: boolean;
  /** Whether this client actually holds a token (when one is required). */
  tokenConfigured: boolean;
  /** "" for same-origin, otherwise the configured remote runtime. */
  baseUrl: string;
  info: RuntimeInfo | null;
  checkedAt: number;
  /** Why the runtime is not reachable, when it isn't. */
  error?: string;
  /** Number of files the build-time snapshot can serve. */
  snapshotFiles: number;
}

export interface CommandOutcome {
  ok: boolean;
  origin: SourceOrigin;
  operation: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

type RawModule = Record<string, () => Promise<string>>;

/**
 * The build-time snapshot. Lazy (`eager: false`), so the manifest of
 * paths ships with the bundle but file contents are only fetched when
 * something actually reads one — the initial bundle is unaffected.
 *
 * Scope is a deliberate trade: `.ts` across src, plugins and tests
 * (the whole logic layer, previously only `src/core`) costs ~1.2 MB of
 * lazily-served deploy weight. Adding `.tsx` as well would take that to
 * ~2.9 MB for the React component layer, which is the least useful
 * thing to read when answering architecture, capability and runtime
 * questions. So UI components are readable only through the real
 * development runtime — and `read()` reports that origin honestly
 * rather than pretending the snapshot is the live tree.
 *
 * Outside Vite (Bun tests, SSR, headless runners) `import.meta.glob`
 * does not exist — degrade to an empty snapshot rather than crashing
 * at module load.
 */
function buildSnapshot(): RawModule {
  // The call sites below MUST be reached. Do NOT guard them with
  // `typeof import.meta.glob === "function"`: Vite rewrites the CALL
  // expression at transform time but leaves a bare `import.meta.glob`
  // reference alone, so at runtime that check is always false and the
  // snapshot silently comes back empty — the bundle still pays for the
  // emitted chunks while the fallback never works.
  //
  // Outside Vite (Bun tests, SSR, headless runners) the call throws
  // because the property does not exist; that is what the catch is for.
  try {
    // Vite parses these calls statically: the pattern and the options
    // MUST be literals written in place. A shared options constant makes
    // the build fail with "Expected the second argument to be an object
    // literal", so do not factor these out.
    return {
      ...(import.meta.glob("/src/**/*.ts", {
        query: "?raw",
        import: "default",
        eager: false,
      }) as RawModule),
      ...(import.meta.glob("/tests/**/*.ts", {
        query: "?raw",
        import: "default",
        eager: false,
      }) as RawModule),
      ...(import.meta.glob("/plugins/**/*.ts", {
        query: "?raw",
        import: "default",
        eager: false,
      }) as RawModule),
    };
  } catch {
    return {};
  }
}

const SNAPSHOT: RawModule = buildSnapshot();

/** Reachable status is re-probed this often; a dead runtime, less often. */
const STATUS_TTL_OK_MS = 20_000;
const STATUS_TTL_FAIL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 180_000;

function env(key: string): string {
  try {
    const value = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/** Normalize to a workspace-relative, forward-slashed path. */
export function normalizeWorkspacePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\\/g, "/");
}

export default class SourceAccess {
  private static instance: SourceAccess | null = null;

  private cachedStatus: RuntimeStatus | null = null;
  private statusInFlight: Promise<RuntimeStatus> | null = null;

  private constructor() {}

  public static getInstance(): SourceAccess {
    if (!SourceAccess.instance) {
      SourceAccess.instance = new SourceAccess();
    }
    return SourceAccess.instance;
  }

  /* ------------------------------ config ------------------------------ */

  /** Base URL of the engineering runtime. "" means same origin. */
  public baseUrl(): string {
    return env("VITE_LELU_ENGINEER_URL").replace(/\/+$/, "");
  }

  private token(): string {
    return env("VITE_LELU_ENGINEER_TOKEN");
  }

  private url(route: string): string {
    return `${this.baseUrl()}${route}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = this.token();
    if (token) {
      headers["x-lelu-token"] = token;
    }
    return headers;
  }

  /* ------------------------------ status ------------------------------ */

  /**
   * Is the REAL development runtime reachable? Cached, de-duplicated,
   * and never throws — an unreachable runtime is a reported fact, not
   * an error the caller has to handle.
   */
  public async status(force = false): Promise<RuntimeStatus> {
    const cached = this.cachedStatus;
    if (!force && cached) {
      const ttl = cached.reachable ? STATUS_TTL_OK_MS : STATUS_TTL_FAIL_MS;
      if (Date.now() - cached.checkedAt < ttl) {
        return cached;
      }
    }
    if (this.statusInFlight) {
      return this.statusInFlight;
    }
    this.statusInFlight = this.probe().finally(() => {
      this.statusInFlight = null;
    });
    return this.statusInFlight;
  }

  /** Last known status without triggering a probe. */
  public cached(): RuntimeStatus | null {
    return this.cachedStatus;
  }

  private async probe(): Promise<RuntimeStatus> {
    const base: RuntimeStatus = {
      reachable: false,
      runtime: null,
      operations: [],
      workspace: "",
      tokenRequired: false,
      tokenConfigured: this.token().length > 0,
      baseUrl: this.baseUrl(),
      info: null,
      checkedAt: Date.now(),
      snapshotFiles: Object.keys(SNAPSHOT).length,
    };

    try {
      const response = await this.fetchJson<{
        ok?: boolean;
        runtime?: string;
        operations?: string[];
        workspace?: string;
        tokenRequired?: boolean;
        runtimeInfo?: RuntimeInfo;
      }>("/api/engineer/status", undefined, REQUEST_TIMEOUT_MS);

      if (response?.ok !== true) {
        this.cachedStatus = { ...base, error: "Engineering runtime did not report ok." };
        return this.cachedStatus;
      }

      this.cachedStatus = {
        ...base,
        reachable: true,
        runtime: response.runtime ?? "unknown",
        operations: response.operations ?? [],
        workspace: response.workspace ?? "",
        tokenRequired: response.tokenRequired === true,
        info: response.runtimeInfo ?? null,
      };
      return this.cachedStatus;
    } catch (error) {
      this.cachedStatus = {
        ...base,
        error: error instanceof Error ? error.message : String(error),
      };
      return this.cachedStatus;
    }
  }

  /** One-line description of where self-inspection is currently reading from. */
  public describe(status: RuntimeStatus): string {
    if (status.reachable) {
      const where = status.baseUrl || "same origin";
      const engine = status.info ? `${status.info.engine} ${status.info.version}` : "unknown engine";
      return `REAL DEVELOPMENT RUNTIME — ${status.runtime} (${engine}) at ${where}, workspace “${status.workspace}”, operations: ${status.operations.join(", ") || "none"}.`;
    }
    return `STATIC SNAPSHOT — the engineering runtime is unreachable${
      status.error ? ` (${status.error})` : ""
    }. ${status.snapshotFiles} build-time file(s) readable; live files, directory listings, commands and runtime state are NOT available.${
      status.baseUrl ? ` Configured runtime URL: ${status.baseUrl}.` : ""
    }`;
  }

  /* ------------------------------- read ------------------------------- */

  /**
   * Read a project file. Prefers the live workspace; falls back to the
   * build-time snapshot. The returned `origin` is the truth about which
   * one answered — callers must not assume.
   */
  public async read(path: string): Promise<SourceRead> {
    const normalized = normalizeWorkspacePath(path);
    const status = await this.status();

    if (status.reachable) {
      try {
        const payload = await this.fetchJson<{ ok?: boolean; content?: string; error?: string }>(
          "/api/engineer/read",
          { path: normalized },
          REQUEST_TIMEOUT_MS,
        );
        if (payload?.ok === true && typeof payload.content === "string") {
          return {
            path: normalized,
            content: payload.content,
            origin: "development-runtime",
            runtime: status.runtime,
          };
        }
        // The runtime answered but refused this path — fall through to
        // the snapshot rather than reporting nothing at all.
      } catch {
        // A read failure invalidates the cached status: re-probe next call.
        this.cachedStatus = null;
      }
    }

    const snapshot = await this.readSnapshot(normalized);
    if (snapshot !== null) {
      return {
        path: normalized,
        content: snapshot,
        origin: "static-snapshot",
        runtime: null,
      };
    }

    return {
      path: normalized,
      content: null,
      origin: "unavailable",
      runtime: null,
      error: status.reachable
        ? `${normalized} was not readable from the development runtime.`
        : `${normalized} is not in the build-time snapshot and the development runtime is unreachable.`,
    };
  }

  private async readSnapshot(normalized: string): Promise<string | null> {
    const loader = SNAPSHOT[`/${normalized}`] ?? SNAPSHOT[normalized];
    if (!loader) return null;
    try {
      return await loader();
    } catch {
      return null;
    }
  }

  /* ------------------------------- list ------------------------------- */

  /**
   * List a directory. The live runtime lists the real filesystem; the
   * snapshot can only synthesize a listing from the paths it bundled.
   */
  public async list(path = ""): Promise<SourceListing> {
    const normalized = normalizeWorkspacePath(path);
    const status = await this.status();

    if (status.reachable) {
      try {
        const payload = await this.fetchJson<{ ok?: boolean; entries?: DirEntry[] }>(
          "/api/engineer/list",
          { path: normalized || "." },
          REQUEST_TIMEOUT_MS,
        );
        if (payload?.ok === true && Array.isArray(payload.entries)) {
          return { path: normalized, origin: "development-runtime", entries: payload.entries };
        }
      } catch {
        this.cachedStatus = null;
      }
    }

    return {
      path: normalized,
      origin: Object.keys(SNAPSHOT).length > 0 ? "static-snapshot" : "unavailable",
      entries: this.listSnapshot(normalized),
    };
  }

  private listSnapshot(normalized: string): DirEntry[] {
    const prefix = normalized ? `/${normalized.replace(/\/+$/, "")}/` : "/";
    const names = new Map<string, DirEntry>();
    for (const key of Object.keys(SNAPSHOT)) {
      if (!key.startsWith(prefix)) continue;
      const remainder = key.slice(prefix.length);
      const slash = remainder.indexOf("/");
      if (slash === -1) {
        names.set(remainder, {
          name: remainder,
          path: key.slice(1),
          type: "file",
        });
      } else {
        const dir = remainder.slice(0, slash);
        if (!names.has(dir)) {
          names.set(dir, { name: dir, path: `${prefix.slice(1)}${dir}`, type: "dir" });
        }
      }
    }
    return [...names.values()].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
    );
  }

  /** Every path the build-time snapshot can serve, optionally filtered. */
  public snapshotPaths(prefix?: string): string[] {
    const keys = Object.keys(SNAPSHOT).sort();
    if (!prefix) return keys;
    return keys.filter((key) => key.startsWith(prefix));
  }

  /* ----------------------------- commands ----------------------------- */

  /**
   * Run a whitelisted operation (typecheck / test / build / inspect) in
   * the real development runtime. There is no snapshot equivalent —
   * commands need a runtime, and saying so is the honest answer.
   */
  public async command(operation: string): Promise<CommandOutcome> {
    const status = await this.status();
    if (!status.reachable) {
      return {
        ok: false,
        origin: "static-snapshot",
        operation,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: `“${operation}” needs the development runtime; only the build-time snapshot is available.`,
      };
    }
    if (status.operations.length > 0 && !status.operations.includes(operation)) {
      return {
        ok: false,
        origin: "development-runtime",
        operation,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: `“${operation}” is not offered by this runtime (allowed: ${status.operations.join(", ")}).`,
      };
    }

    try {
      const payload = await this.fetchJson<{
        ok?: boolean;
        stdout?: string;
        stderr?: string;
        durationMs?: number;
        error?: string;
      }>("/api/engineer/command", { operation }, COMMAND_TIMEOUT_MS);
      return {
        ok: payload?.ok === true,
        origin: "development-runtime",
        operation,
        stdout: payload?.stdout ?? "",
        stderr: payload?.stderr ?? "",
        durationMs: payload?.durationMs ?? 0,
        error: payload?.error,
      };
    } catch (error) {
      this.cachedStatus = null;
      return {
        ok: false,
        origin: "development-runtime",
        operation,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Write through the development runtime. Never touches the snapshot. */
  public async write(path: string, content: string): Promise<{ ok: boolean; error?: string }> {
    const status = await this.status();
    if (!status.reachable) {
      return { ok: false, error: "No development runtime — writes are not possible on a static snapshot." };
    }
    try {
      const payload = await this.fetchJson<{ ok?: boolean; error?: string }>(
        "/api/engineer/write",
        { path: normalizeWorkspacePath(path), content },
        REQUEST_TIMEOUT_MS,
      );
      return { ok: payload?.ok === true, error: payload?.error };
    } catch (error) {
      this.cachedStatus = null;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /* ------------------------------ transport ---------------------------- */

  private async fetchJson<T>(
    route: string,
    body: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<T | null> {
    if (typeof fetch !== "function") {
      throw new Error("fetch is unavailable in this runtime.");
    }
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const response = await fetch(this.url(route), {
        method: body === undefined ? "GET" : "POST",
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      if (!response.ok) {
        throw new Error(`${route} responded ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
