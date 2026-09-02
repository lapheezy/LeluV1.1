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
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  WorkspaceBoundaryError,
  type EngineerAdapter,
  type EngineerCommandResult,
  type EngineerDirEntry,
} from "./engineerApi.ts";

/** Directories never worth listing back to the client. */
const SKIPPED_DIRS = new Set([".git", "node_modules", "dist", ".cache", ".vite"]);

/** Build the adapter bound to the current working directory. */
export function createNodeEngineerAdapter(runtime: string): EngineerAdapter {
  const workspaceRoot = process.cwd();
  const startedAt = Date.now();

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

  function listDir(absolutePath: string): EngineerDirEntry[] {
    const entries: EngineerDirEntry[] = [];
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
      const absolute = path.join(absolutePath, entry.name);
      const relative = path.relative(workspaceRoot, absolute).split(path.sep).join("/");
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
  };
}

declare const Bun: { version: string } | undefined;
