/**
 * ==========================================================
 * LÉLU — ENGINEERING RUNTIME ADAPTERS (Deno)
 *
 * Deno-compatible implementation of the EngineerAdapter used by
 * the production server entry (main.ts). Node/Bun use
 * nodeAdapters.ts instead — the request handling in
 * engineerApi.ts is identical for both.
 * ==========================================================
 */

// Deno ships a node:path compatibility shim; resolve/sep give us the
// same boundary semantics as the Node adapter.
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  WorkspaceBoundaryError,
  type EngineerAdapter,
  type EngineerCommandResult,
  type EngineerDiffEntry,
  type EngineerDirEntry,
  type EngineerWorkspace,
} from "./engineerApi.ts";

/** Directories never worth listing back to the client. */
const SKIPPED_DIRS = new Set([".git", "node_modules", "dist", ".cache", ".vite", ".lelu-sandbox"]);

/** Never copied into a workspace — mirrors the Node adapter exactly. */
const NEVER_COPIED = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cache",
  ".vite",
  ".lelu-sandbox",
]);

export function createDenoEngineerAdapter(runtime: string): EngineerAdapter {
  const workspaceRoot = Deno.cwd();
  const sandboxRoot = join(workspaceRoot, ".lelu-sandbox");
  const startedAt = Date.now();

  function workspaceDir(workspaceId: string): string {
    const dir = resolve(sandboxRoot, workspaceId);
    if (dir !== sandboxRoot && !dir.startsWith(sandboxRoot + sep)) {
      throw new WorkspaceBoundaryError("Workspace id escapes the sandbox root.");
    }
    return dir;
  }

  function exists(target: string): boolean {
    try {
      Deno.statSync(target);
      return true;
    } catch {
      return false;
    }
  }

  function resolveInWorkspace(workspaceId: string, targetPath: string): string {
    const root = workspaceDir(workspaceId);
    if (!exists(root)) {
      throw new WorkspaceBoundaryError(
        `Workspace "${workspaceId}" does not exist. Create it before reading or writing in it.`,
      );
    }
    const absolute = resolve(root, targetPath);
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new WorkspaceBoundaryError("Path escapes the workspace copy.");
    }
    return absolute;
  }

  function walkProject(base: string, rel = ""): string[] {
    const out: string[] = [];
    let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>;
    try {
      entries = [...Deno.readDirSync(join(base, rel))];
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (NEVER_COPIED.has(entry.name)) continue;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) out.push(...walkProject(base, next));
      else if (entry.isFile) out.push(next);
    }
    return out;
  }

  function countLines(text: string): number {
    return text.length === 0 ? 0 : text.split("\n").length;
  }

  /** Same unified-style patch the Node adapter produces. */
  function buildPatch(relative: string, before: string, after: string): string {
    const a = before.length ? before.split("\n") : [];
    const b = after.length ? after.split("\n") : [];
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
      endA -= 1;
      endB -= 1;
    }
    const removed = a.slice(start, endA + 1);
    const added = b.slice(start, endB + 1);
    const CONTEXT = 3;
    const patch = [
      `--- a/${relative}`,
      `+++ b/${relative}`,
      `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`,
      ...a.slice(Math.max(0, start - CONTEXT), start).map((line) => ` ${line}`),
      ...removed.map((line) => `-${line}`),
      ...added.map((line) => `+${line}`),
      ...a.slice(endA + 1, endA + 1 + CONTEXT).map((line) => ` ${line}`),
    ].join("\n");
    const MAX_PATCH_CHARS = 8000;
    return patch.length > MAX_PATCH_CHARS
      ? `${patch.slice(0, MAX_PATCH_CHARS)}\n…[patch truncated]`
      : patch;
  }

  function resolveWithinWorkspace(targetPath: string): string {
    const absoluteTarget = resolve(workspaceRoot, targetPath);
    if (absoluteTarget !== workspaceRoot && !absoluteTarget.startsWith(workspaceRoot + sep)) {
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
    try {
      const cmd = new Deno.Command("bash", {
        args: ["-c", command],
        cwd: workspaceRoot,
        env: { ...Deno.env.toObject(), FORCE_COLOR: "0" },
        stdout: "piped",
        stderr: "piped",
      });
      const proc = cmd.spawn();
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already exited */
        }
      }, timeoutMs);
      const { code, stdout, stderr } = await proc.output();
      clearTimeout(timer);
      return {
        ok: code === 0,
        status: code ?? 1,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
        durationMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        status: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      };
    }
  }

  async function listDir(absolutePath: string): Promise<EngineerDirEntry[]> {
    const entries: EngineerDirEntry[] = [];
    for await (const entry of Deno.readDir(absolutePath)) {
      if (entry.isDirectory && SKIPPED_DIRS.has(entry.name)) continue;
      const absolute = resolve(absolutePath, entry.name);
      const rel = relative(workspaceRoot, absolute).split(sep).join("/");
      if (entry.isDirectory) {
        entries.push({ name: entry.name, path: rel, type: "dir" });
        continue;
      }
      if (!entry.isFile) continue;
      let size: number | undefined;
      try {
        size = (await Deno.stat(absolute)).size;
      } catch {
        size = undefined;
      }
      entries.push({ name: entry.name, path: rel, type: "file", size });
    }
    return entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
    );
  }

  return {
    runtime,
    workspaceRoot,
    resolve: resolveWithinWorkspace,
    readFile: (absolutePath) => Deno.readTextFile(absolutePath),
    writeFile: async (absolutePath, content) => {
      const dir = absolutePath.slice(0, absolutePath.lastIndexOf(sep));
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(absolutePath, content);
    },
    listDir,
    runtimeInfo: () => ({
      engine: "deno",
      version: Deno.version?.deno ?? "unknown",
      platform: Deno.build?.os ?? "unknown",
      cwd: workspaceRoot,
      startedAt,
    }),
    runCommand,

    /* ---------------- isolated project copies ---------------- */

    sandboxRoot,
    resolveInWorkspace,

    async createWorkspace(workspaceId) {
      const root = workspaceDir(workspaceId);
      try {
        Deno.removeSync(root, { recursive: true });
      } catch {
        /* nothing to remove */
      }
      Deno.mkdirSync(root, { recursive: true });

      const files = walkProject(workspaceRoot);
      for (const rel of files) {
        const to = join(root, rel);
        Deno.mkdirSync(dirname(to), { recursive: true });
        Deno.copyFileSync(join(workspaceRoot, rel), to);
      }

      // Share dependencies by symlink rather than copying them.
      const modules = join(workspaceRoot, "node_modules");
      if (exists(modules)) {
        try {
          Deno.symlinkSync(modules, join(root, "node_modules"), { type: "dir" });
        } catch {
          /* absent on purpose; failures surface honestly */
        }
      }

      return { id: workspaceId, root, createdAt: Date.now(), fileCount: files.length };
    },

    listWorkspaces() {
      if (!exists(sandboxRoot)) return [];
      const out: EngineerWorkspace[] = [];
      for (const entry of Deno.readDirSync(sandboxRoot)) {
        if (!entry.isDirectory) continue;
        const root = join(sandboxRoot, entry.name);
        let createdAt = 0;
        try {
          const info = Deno.statSync(root);
          createdAt = info.birthtime?.getTime() ?? info.mtime?.getTime() ?? 0;
        } catch {
          createdAt = 0;
        }
        out.push({ id: entry.name, root, createdAt, fileCount: walkProject(root).length });
      }
      return out;
    },

    removeWorkspace(workspaceId) {
      try {
        Deno.removeSync(workspaceDir(workspaceId), { recursive: true });
      } catch {
        /* already gone */
      }
    },

    deleteFile(absolutePath) {
      try {
        Deno.removeSync(absolutePath);
      } catch {
        /* already gone */
      }
    },

    async diffWorkspace(workspaceId, includePatch = false) {
      const root = workspaceDir(workspaceId);
      if (!exists(root)) {
        throw new WorkspaceBoundaryError(`Workspace "${workspaceId}" does not exist.`);
      }
      const copyFiles = new Set(walkProject(root));
      const sourceFiles = new Set(walkProject(workspaceRoot));
      const changes: EngineerDiffEntry[] = [];

      for (const rel of copyFiles) {
        const copyText = Deno.readTextFileSync(join(root, rel));
        if (!sourceFiles.has(rel)) {
          changes.push({
            path: rel,
            status: "added",
            addedLines: countLines(copyText),
            removedLines: 0,
            ...(includePatch ? { patch: buildPatch(rel, "", copyText) } : {}),
          });
          continue;
        }
        const sourceText = Deno.readTextFileSync(join(workspaceRoot, rel));
        if (sourceText === copyText) continue;
        changes.push({
          path: rel,
          status: "modified",
          addedLines: countLines(copyText),
          removedLines: countLines(sourceText),
          ...(includePatch ? { patch: buildPatch(rel, sourceText, copyText) } : {}),
        });
      }
      for (const rel of sourceFiles) {
        if (copyFiles.has(rel)) continue;
        const sourceText = Deno.readTextFileSync(join(workspaceRoot, rel));
        changes.push({
          path: rel,
          status: "deleted",
          addedLines: 0,
          removedLines: countLines(sourceText),
          ...(includePatch ? { patch: buildPatch(rel, sourceText, "") } : {}),
        });
      }
      return changes.sort((a, b) => a.path.localeCompare(b.path));
    },

    async applyWorkspace(workspaceId, paths) {
      const root = workspaceDir(workspaceId);
      const changes = await this.diffWorkspace(workspaceId);
      const wanted = new Set(paths);
      const selected = changes.filter((change) => wanted.size === 0 || wanted.has(change.path));

      const applied: string[] = [];
      for (const change of selected) {
        const target = join(workspaceRoot, change.path);
        if (change.status === "deleted") {
          try {
            Deno.removeSync(target);
          } catch {
            /* already gone */
          }
          applied.push(change.path);
          continue;
        }
        Deno.mkdirSync(dirname(target), { recursive: true });
        Deno.copyFileSync(join(root, change.path), target);
        applied.push(change.path);
      }
      return applied;
    },
  };
}
