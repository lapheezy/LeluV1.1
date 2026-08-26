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
import { resolve, sep } from "node:path";
import { WorkspaceBoundaryError, type EngineerAdapter, type EngineerCommandResult } from "./engineerApi.ts";

export function createDenoEngineerAdapter(runtime: string): EngineerAdapter {
  const workspaceRoot = Deno.cwd();

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
    runCommand,
  };
}
