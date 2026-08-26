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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WorkspaceBoundaryError, type EngineerAdapter, type EngineerCommandResult } from "./engineerApi.ts";

/** Build the adapter bound to the current working directory. */
export function createNodeEngineerAdapter(runtime: string): EngineerAdapter {
  const workspaceRoot = process.cwd();

  function resolveWithinWorkspace(targetPath: string): string {
    const absoluteTarget = path.resolve(workspaceRoot, targetPath);
    if (absoluteTarget !== workspaceRoot && !absoluteTarget.startsWith(workspaceRoot + path.sep)) {
      throw new WorkspaceBoundaryError();
    }
    return absoluteTarget;
  }

  async function runCommand(command: string, timeoutMs: number): Promise<EngineerCommandResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd: workspaceRoot,
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

  return {
    runtime,
    workspaceRoot,
    resolve: resolveWithinWorkspace,
    readFile: (absolutePath) => readFileSync(absolutePath, "utf8"),
    writeFile: (absolutePath, content) => {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, "utf8");
    },
    runCommand,
  };
}
