/**
 * ==========================================================
 * LÉLU
 * SELF-CODE — inspecting and working on her own codebase
 *
 *  - `listCoreSources()` / `readCoreSource()` expose the REAL
 *    source of src/core/** at runtime through Vite's lazy
 *    import.meta.glob with ?raw (content chunks are only
 *    fetched when the Evolution workspace asks for them — the
 *    main bundle stays untouched).
 *  - `openWorkingCopy(path)` copies a real source file into the
 *    SANDBOX as an editable working copy (`self-code/...`).
 *    Nothing is ever edited in place — production is never
 *    modified.
 *  - `buildPatchText()` diffs working copies against their real
 *    originals into a candidate patch the user can review,
 *    download, and (if approved) integrate.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import SandboxFS from "../engineering/SandboxFS";
import SourceAccess, { type SourceOrigin } from "./SourceAccess";

const WORKING_COPIES_KEY = "lelu.selfdev.workingcopies.v1";

/** sandboxPath → real source path it was opened from */
type WorkingCopyMap = Record<string, string>;

export interface PatchEntry {
  path: string;
  changed: boolean;
  diff: string;
}

function loadWorkingCopies(): WorkingCopyMap {
  return KvStore.getInstance().get<WorkingCopyMap>(WORKING_COPIES_KEY) ?? {};
}

function persistWorkingCopies(copies: WorkingCopyMap): void {
  try {
    KvStore.getInstance().set(WORKING_COPIES_KEY, copies);
  } catch {
    // best-effort
  }
}

/** Unified-diff-ish line comparison for a single file. */
export function diffLines(original: string, modified: string): string {
  const a = original.split("\n");
  const b = modified.split("\n");
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) {
      if (left !== undefined) lines.push(`  ${left}`);
    } else if (left === undefined) {
      lines.push(`+ ${right}`);
    } else if (right === undefined) {
      lines.push(`- ${left}`);
    } else {
      lines.push(`- ${left}`);
      lines.push(`+ ${right}`);
    }
  }
  return lines.join("\n");
}

export default class SelfCode {
  private static instance: SelfCode | null = null;

  private constructor() {}

  public static getInstance(): SelfCode {
    if (!SelfCode.instance) {
      SelfCode.instance = new SelfCode();
    }
    return SelfCode.instance;
  }

  private readonly source = SourceAccess.getInstance();

  /**
   * All core source paths this build knows about. On a live development
   * runtime the real `src/core` tree is authoritative; otherwise the
   * build-time snapshot's paths are used.
   */
  public async listCoreSources(): Promise<string[]> {
    const status = await this.source.status();
    if (status.reachable) {
      const live = await this.walkCore("src/core");
      if (live.length > 0) return live.sort();
    }
    return this.source.snapshotPaths("/src/core/").sort();
  }

  private async walkCore(dir: string, depth = 0): Promise<string[]> {
    if (depth > 6) return [];
    const listing = await this.source.list(dir);
    if (listing.origin !== "development-runtime") return [];
    const paths: string[] = [];
    for (const entry of listing.entries) {
      if (entry.type === "dir") {
        paths.push(...(await this.walkCore(entry.path, depth + 1)));
      } else if (entry.name.endsWith(".ts")) {
        paths.push(`/${entry.path}`);
      }
    }
    return paths;
  }

  /**
   * Read the REAL content of a source file through the single source
   * access layer: the live development runtime when it is reachable,
   * the build-time snapshot otherwise. Use `readCoreSourceDetailed` when
   * the caller needs to know WHICH of the two answered.
   */
  public async readCoreSource(path: string): Promise<string | null> {
    return (await this.source.read(path)).content;
  }

  /** The same read, with the origin (development runtime vs snapshot). */
  public async readCoreSourceDetailed(
    path: string,
  ): Promise<{ content: string | null; origin: SourceOrigin; runtime: string | null }> {
    const read = await this.source.read(path);
    return { content: read.content, origin: read.origin, runtime: read.runtime };
  }

  /** Real sources that have an open working copy in the sandbox. */
  public workingCopies(): WorkingCopyMap {
    return loadWorkingCopies();
  }

  public sandboxPathFor(realPath: string): string {
    return `self-code/${realPath.replace(/^\/+/, "")}`;
  }

  /** Copy a real source file into the sandbox as an editable working copy. */
  public async openWorkingCopy(realPath: string): Promise<{ ok: boolean; sandboxPath?: string; error?: string }> {
    const content = await this.readCoreSource(realPath);
    if (content === null) {
      return { ok: false, error: `Could not read ${realPath}.` };
    }
    const sandboxPath = this.sandboxPathFor(realPath);
    const result = SandboxFS.getInstance().write(sandboxPath, content);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const copies = loadWorkingCopies();
    copies[sandboxPath] = realPath;
    persistWorkingCopies(copies);
    return { ok: true, sandboxPath };
  }

  /** Diff a working copy against its real original. */
  public async patchFor(sandboxPath: string): Promise<PatchEntry | null> {
    const copies = loadWorkingCopies();
    const realPath = copies[sandboxPath];
    if (!realPath) {
      return null;
    }
    const original = await this.readCoreSource(realPath);
    const modified = SandboxFS.getInstance().read(sandboxPath);
    if (original === null || modified === null) {
      return null;
    }
    const changed = original !== modified;
    return {
      path: realPath,
      changed,
      diff: changed ? diffLines(original, modified) : "  (unchanged)",
    };
  }

  /** Build the full candidate patch text for all working copies. */
  public async buildPatchText(): Promise<string> {
    const copies = loadWorkingCopies();
    const entries: PatchEntry[] = [];
    for (const sandboxPath of Object.keys(copies)) {
      const entry = await this.patchFor(sandboxPath);
      if (entry) {
        entries.push(entry);
      }
    }
    if (entries.length === 0) {
      return "# No working copies open. Open a source file first.\n";
    }
    const header = [
      "# LÉLU candidate patch — generated by the Self-Development Engine",
      `# ${new Date().toISOString()}`,
      `# ${entries.length} file(s) reviewed; ${entries.filter((entry) => entry.changed).length} modified.`,
      "# Apply to a development branch, run the test suite, then integrate through the approval boundary.",
      "",
    ].join("\n");
    const bodies = entries.map((entry) => `--- a/${entry.path}\n+++ b/${entry.path}\n${entry.diff}`);
    return `${header}\n${bodies.join("\n\n")}\n`;
  }

  /** Download the candidate patch as a file. */
  public downloadPatch(patchText: string, name = "lelu-candidate.patch"): void {
    const blob = new Blob([patchText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
