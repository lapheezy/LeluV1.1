/**
 * ==========================================================
 * LÉLU
 * RENDER STORE — persistent render output gallery
 *
 * Every render that succeeds (local or cloud) is saved here as
 * a real deliverable: name, engine, prompt, output image, and
 * optional project attachment. Persistent and offline-first.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export interface RenderOutput {
  id: string;
  name: string;
  engine: string;
  kind: string;
  prompt: string;
  output: string;
  projectId?: string;
  createdAt: number;
}

type Listener = (outputs: RenderOutput[]) => void;

export default class RenderStore {
  private static instance: RenderStore | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly listeners = new Set<Listener>();

  private constructor() {}

  public static getInstance(): RenderStore {
    if (!RenderStore.instance) {
      RenderStore.instance = new RenderStore();
    }
    return RenderStore.instance;
  }

  private static readonly KEY = "renders.v1";

  public list(): RenderOutput[] {
    const outputs = this.kv.get<RenderOutput[]>(RenderStore.KEY) ?? [];
    return outputs.sort((a, b) => b.createdAt - a.createdAt);
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.list());
      } catch (error) {
        console.error("[Lélu RenderStore] listener threw (contained)", error);
      }
    }
  }

  public save(input: Omit<RenderOutput, "id" | "createdAt">): RenderOutput {
    const output: RenderOutput = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
    this.kv.set(RenderStore.KEY, [output, ...this.list()]);
    this.notify();
    return output;
  }

  public remove(id: string): void {
    this.kv.set(RenderStore.KEY, this.list().filter((output) => output.id !== id));
    this.notify();
  }

  /** Save a render output as a project item ("output" kind). */
  public attachToProject(output: RenderOutput, projectId: string): void {
    this.kv.set(
      RenderStore.KEY,
      this.list().map((item) => (item.id === output.id ? { ...item, projectId } : item)),
    );
    this.notify();
  }
}
