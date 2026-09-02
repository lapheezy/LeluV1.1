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
import { relative, resolve, sep } from "node:path";
import {
  WorkspaceBoundaryError,
  type EngineerAdapter,
  type EngineerCommandResult,
  type EngineerDirEntry,
} from "./engineerApi.ts";

/** Directories never worth listing back to the client. */
const SKIPPED_DIRS = new Set([".git", "node_modules", "dist", ".cache", ".vite"]);

export function createDenoEngineerAdapter(runtime: string): EngineerAdapter {
  const workspaceRoot = Deno.cwd();
  const startedAt = Date.now();

  function resolveWithinWorkspace(targetPath: string): string {
    const absoluteTarget = resolve(workspaceRoot, targetPath);
    if (absoluteTarget !== workspaceRoot && !absoluteTarget.startsWith(workspaceRoot + sep)) {
      throw new WorkspaceBoundaryError();
    }
    return absoluteTarget;
  }

  async function runCommand(command: string, timeoutMs: number): Promise<EngineerCommandResult> {
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
  };
}
