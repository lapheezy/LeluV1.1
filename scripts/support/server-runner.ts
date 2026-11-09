import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export interface ServerRunnerOptions {
  port?: number;
  host?: string;
  readyPath?: string;
  timeoutMs?: number;
}

export class ManagedServer {
  private process: ChildProcess | null = null;
  public readonly port: number;
  public readonly host: string;
  public readonly baseUrl: string;

  constructor(options: ServerRunnerOptions = {}) {
    this.port = options.port ?? 5173;
    this.host = options.host ?? "127.0.0.1";
    this.baseUrl = `http://${this.host}:${this.port}`;
  }

  public async start(readyPath = "/api/engineer/status", timeoutMs = 60000): Promise<boolean> {
    // Check if already running
    try {
      const res = await fetch(`${this.baseUrl}${readyPath}`);
      if (res.ok) {
        console.log(`[ManagedServer] Server already running at ${this.baseUrl}`);
        return true;
      }
    } catch {
      // not up
    }

    console.log(`[ManagedServer] Spawning Vite server on ${this.baseUrl}...`);
    this.process = spawn(
      "npx",
      ["vite", "--host", this.host, "--port", String(this.port), "--strictPort"],
      {
        cwd: process.cwd(),
        stdio: "pipe",
        detached: true,
      },
    );

    this.process.stdout?.on("data", (data) => {
      // capture if needed
    });
    this.process.stderr?.on("data", (data) => {
      // capture if needed
    });

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${this.baseUrl}${readyPath}`);
        if (res.ok) {
          console.log(`[ManagedServer] Server is ready at ${this.baseUrl}`);
          return true;
        }
      } catch {
        // waiting
      }
      await sleep(500);
    }

    console.error(`[ManagedServer] Server failed to start within ${timeoutMs}ms.`);
    this.stop();
    return false;
  }

  public stop(): void {
    if (this.process?.pid) {
      try {
        process.kill(-this.process.pid);
      } catch {
        // already stopped
      }
      this.process = null;
    }
  }
}
