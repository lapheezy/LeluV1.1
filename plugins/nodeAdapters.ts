/**
 * ==========================================================
 * LÉLU — ENGINEERING RUNTIME ADAPTERS (Node / Bun)
 *
 * Node-compatible implementations of the EngineerAdapter used by
 * the Vite dev/preview server and the standalone runtime server
 * (server.ts). Deno has its own adapter (denoAdapters.ts).
 * ==========================================================
 */

import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  WorkspaceBoundaryError,
  type EngineerAdapter,
  type EngineerCommandResult,
  type EngineerDiffEntry,
  type EngineerDirEntry,
  type EngineerWorkspace,
} from "./engineerApi.ts";

/** Directories never worth listing back to the client. */
const SKIPPED_DIRS = new Set([".git", "node_modules", "dist", ".cache", ".vite", SANDBOX_DIR_NAME()]);

/** Where isolated project copies live, relative to the project root. */
function SANDBOX_DIR_NAME(): string {
  return ".lelu-sandbox";
}

/**
 * Never copied into a workspace.
 *
 * node_modules is excluded and then SYMLINKED instead: copying it would
 * take minutes and gigabytes, while a symlink makes `bun test` and
 * `tsc` inside the copy resolve exactly the dependencies the real
 * project uses. .git is excluded so a workspace can never rewrite
 * repository history, and the sandbox directory itself is excluded so
 * a copy cannot contain copies.
 */
const NEVER_COPIED = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cache",
  ".vite",
  ".lelu-sandbox",
]);

/** Build the adapter bound to the current working directory. */
export function createNodeEngineerAdapter(runtime: string): EngineerAdapter {
  const workspaceRoot = process.cwd();
  const sandboxRoot = path.join(workspaceRoot, SANDBOX_DIR_NAME());
  const startedAt = Date.now();

  function workspaceDir(workspaceId: string): string {
    const dir = path.resolve(sandboxRoot, workspaceId);
    if (dir !== sandboxRoot && !dir.startsWith(sandboxRoot + path.sep)) {
      throw new WorkspaceBoundaryError("Workspace id escapes the sandbox root.");
    }
    return dir;
  }

  /** Resolve a path inside one workspace copy; never outside it. */
  function resolveInWorkspace(workspaceId: string, targetPath: string): string {
    const root = workspaceDir(workspaceId);
    if (!existsSync(root)) {
      throw new WorkspaceBoundaryError(
        `Workspace "${workspaceId}" does not exist. Create it before reading or writing in it.`,
      );
    }
    const absolute = path.resolve(root, targetPath);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new WorkspaceBoundaryError("Path escapes the workspace copy.");
    }
    return absolute;
  }

  /** Every project-relative file path, honouring NEVER_COPIED. */
  function walkProject(base: string, relative = ""): string[] {
    const out: string[] = [];
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(path.join(base, relative), { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (NEVER_COPIED.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.push(...walkProject(base, rel));
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
    return out;
  }

  function countLines(text: string): number {
    return text.length === 0 ? 0 : text.split("\n").length;
  }

  function resolveWithinWorkspace(targetPath: string): string {
    const absoluteTarget = path.resolve(workspaceRoot, targetPath);
    if (absoluteTarget !== workspaceRoot && !absoluteTarget.startsWith(workspaceRoot + path.sep)) {
      throw new WorkspaceBoundaryError();
    }
    return absoluteTarget;
  }

  async function runCommand(
    command: string,
    timeoutMs: number,
    cwd?: string,
  ): Promise<EngineerCommandResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(command, {
        // A workspace copy runs its own validation, in its own directory.
        cwd: cwd ?? workspaceRoot,
        shell: true,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({
          ok: false,
          status: 124,
          stdout,
          stderr: `${stderr}\n[timed out after ${Math.round(timeoutMs / 1000)}s]`,
          durationMs: Date.now() - started,
        });
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          status: 1,
          stdout,
          stderr: `${stderr}\n${error.message}`,
          durationMs: Date.now() - started,
        });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          status: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  function listDir(absolutePath: string): EngineerDirEntry[] {
    // Report paths relative to whichever root this listing belongs to.
    //
    // Everything was previously made relative to the project root, so a
    // listing inside a copy came back as ".lelu-sandbox/ws-1/src/..." —
    // paths that then failed to resolve when fed back in as workspace
    // paths. A listing inside a copy is relative to that copy.
    const base = absolutePath.startsWith(sandboxRoot + path.sep)
      ? path.join(sandboxRoot, path.relative(sandboxRoot, absolutePath).split(path.sep)[0] ?? "")
      : workspaceRoot;

    const entries: EngineerDirEntry[] = [];
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
      const absolute = path.join(absolutePath, entry.name);
      const relative = path.relative(base, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        entries.push({ name: entry.name, path: relative, type: "dir" });
        continue;
      }
      if (!entry.isFile()) continue;
      let size: number | undefined;
      try {
        size = statSync(absolute).size;
      } catch {
        size = undefined;
      }
      entries.push({ name: entry.name, path: relative, type: "file", size });
    }
    return entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
    );
  }

  return {
    runtime,
    workspaceRoot,
    resolve: resolveWithinWorkspace,
    readFile: (absolutePath) => readFileSync(absolutePath, "utf8"),
    writeFile: (absolutePath, content) => {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, "utf8");
    },
    listDir,
    runtimeInfo: () => ({
      engine: typeof Bun !== "undefined" ? "bun" : "node",
      version:
        typeof Bun !== "undefined" ? Bun.version : (process.versions?.node ?? "unknown"),
      platform: process.platform,
      cwd: workspaceRoot,
      startedAt,
    }),
    runCommand,

    /* ---------------- isolated project copies ---------------- */

    sandboxRoot,
    resolveInWorkspace,

    async createWorkspace(workspaceId) {
      const root = workspaceDir(workspaceId);
      // A create over an existing id starts clean rather than merging
      // two unrelated sets of edits.
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });

      const files = walkProject(workspaceRoot);
      for (const relative of files) {
        const from = path.join(workspaceRoot, relative);
        const to = path.join(root, relative);
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(from, to);
      }

      // Dependencies are shared by symlink rather than copied, so
      // validation inside the copy resolves exactly what the real
      // project resolves. If the link cannot be made the copy is still
      // valid — commands needing dependencies will simply report the
      // real failure rather than a fabricated one.
      const modules = path.join(workspaceRoot, "node_modules");
      if (existsSync(modules)) {
        try {
          symlinkSync(modules, path.join(root, "node_modules"), "dir");
        } catch {
          /* left absent on purpose; the failure surfaces honestly */
        }
      }

      return { id: workspaceId, root, createdAt: Date.now(), fileCount: files.length };
    },

    listWorkspaces() {
      if (!existsSync(sandboxRoot)) return [];
      const out: EngineerWorkspace[] = [];
      for (const entry of readdirSync(sandboxRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const root = path.join(sandboxRoot, entry.name);
        let createdAt = 0;
        try {
          createdAt = statSync(root).birthtimeMs || statSync(root).mtimeMs;
        } catch {
          createdAt = 0;
        }
        out.push({
          id: entry.name,
          root,
          createdAt,
          fileCount: walkProject(root).length,
        });
      }
      return out;
    },

    removeWorkspace(workspaceId) {
      rmSync(workspaceDir(workspaceId), { recursive: true, force: true });
    },

    deleteFile(absolutePath) {
      rmSync(absolutePath, { recursive: false, force: true });
    },

    async diffWorkspace(workspaceId) {
      const root = workspaceDir(workspaceId);
      if (!existsSync(root)) {
        throw new WorkspaceBoundaryError(`Workspace "${workspaceId}" does not exist.`);
      }

      // Compare real file contents on both sides — never a record of
      // what was "supposed" to have changed.
      const copyFiles = new Set(walkProject(root));
      const sourceFiles = new Set(walkProject(workspaceRoot));
      const changes: EngineerDiffEntry[] = [];

      for (const relative of copyFiles) {
        const copyText = readFileSync(path.join(root, relative), "utf8");
        if (!sourceFiles.has(relative)) {
          changes.push({
            path: relative,
            status: "added",
            addedLines: countLines(copyText),
            removedLines: 0,
          });
          continue;
        }
        const sourceText = readFileSync(path.join(workspaceRoot, relative), "utf8");
        if (sourceText === copyText) continue;
        changes.push({
          path: relative,
          status: "modified",
          addedLines: countLines(copyText),
          removedLines: countLines(sourceText),
        });
      }

      for (const relative of sourceFiles) {
        if (copyFiles.has(relative)) continue;
        changes.push({
          path: relative,
          status: "deleted",
          addedLines: 0,
          removedLines: countLines(readFileSync(path.join(workspaceRoot, relative), "utf8")),
        });
      }

      return changes.sort((a, b) => a.path.localeCompare(b.path));
    },

    async applyWorkspace(workspaceId, paths) {
      const root = workspaceDir(workspaceId);
      const changes = await this.diffWorkspace(workspaceId);
      const wanted = new Set(paths);

      // An empty list means "everything this workspace changed"; a
      // non-empty one is an allow-list, and a path that is not actually
      // changed is never written.
      const selected = changes.filter(
        (change) => wanted.size === 0 || wanted.has(change.path),
      );

      const applied: string[] = [];
      for (const change of selected) {
        const target = path.join(workspaceRoot, change.path);
        if (change.status === "deleted") {
          rmSync(target, { force: true });
          applied.push(change.path);
          continue;
        }
        mkdirSync(path.dirname(target), { recursive: true });
        cpSync(path.join(root, change.path), target);
        applied.push(change.path);
      }
      return applied;
    },
  };
}

declare const Bun: { version: string } | undefined;
