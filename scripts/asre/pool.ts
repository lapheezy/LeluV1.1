/**
 * A fixed pool of worker threads that build character components in
 * parallel (JS is single-threaded per isolate: real parallelism needs
 * workers). Workers load TypeScript through tsx.
 */
import { Worker } from "node:worker_threads";
import type { BuiltComponent, Lattice } from "../../src/core/asre/character/build";
import type { CharacterSpec } from "../../src/core/asre/character/CharacterSpec";
import type { ComponentId } from "../../src/core/asre/character/components";

type Pending = { resolve: (v: { component: BuiltComponent; workerMs: number }) => void; reject: (e: unknown) => void };

export class ComponentPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Array<() => void> = [];
  private readonly pending = new Map<number, Pending>();
  private next = 0;
  readonly startupMs: Promise<number>;

  constructor(readonly size: number) {
    const t0 = performance.now();
    const ready: Promise<void>[] = [];
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./component-worker.ts", import.meta.url), { execArgv: ["--import", "tsx"] });
      w.on("message", (m: { jobId: number; component: BuiltComponent; workerMs: number }) => {
        const p = this.pending.get(m.jobId)!;
        this.pending.delete(m.jobId);
        this.release(w);
        p.resolve({ component: m.component, workerMs: m.workerMs });
      });
      w.on("error", (e) => {
        for (const p of this.pending.values()) p.reject(e);
      });
      ready.push(new Promise((r) => w.once("online", () => r())));
      this.workers.push(w);
      this.idle.push(w);
    }
    this.startupMs = Promise.all(ready).then(() => performance.now() - t0);
  }

  private release(w: Worker) {
    const job = this.queue.shift();
    this.idle.push(w);
    if (job) job();
  }

  build(spec: CharacterSpec, id: ComponentId, lattice: Lattice): Promise<{ component: BuiltComponent; workerMs: number }> {
    return new Promise((resolve, reject) => {
      const go = () => {
        const w = this.idle.shift()!;
        const jobId = this.next++;
        this.pending.set(jobId, { resolve, reject });
        w.postMessage({ jobId, spec, id, lattice });
      };
      if (this.idle.length) go();
      else this.queue.push(go);
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
