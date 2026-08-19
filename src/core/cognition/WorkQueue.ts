/**
 * ==========================================================
 * LÉLU
 * INTERNAL WORK QUEUE — the persistent task structure behind
 * proactive cognition
 *
 * NOW · NEXT · LEARNING · EXPERIMENTS · PROJECTS · IDEAS ·
 * BLOCKED · REVIEW
 *
 * The cognitive loop and the user both add items; the Cognition
 * workspace lets you move, complete, reopen and drop them.
 * Each item records the autonomy level its execution requires,
 * so autonomy boundaries stay explicit.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export const QUEUE_CATEGORIES = [
  "NOW",
  "NEXT",
  "LEARNING",
  "EXPERIMENTS",
  "PROJECTS",
  "IDEAS",
  "BLOCKED",
  "REVIEW",
] as const;

export type QueueCategory = (typeof QUEUE_CATEGORIES)[number];

export const QUEUE_CATEGORY_LABELS: Record<QueueCategory, string> = {
  NOW: "Now — active work",
  NEXT: "Next — likely next actions",
  LEARNING: "Learning — knowledge development",
  EXPERIMENTS: "Experiments — sandbox experiments",
  PROJECTS: "Projects — long-term objectives",
  IDEAS: "Ideas — potential opportunities",
  BLOCKED: "Blocked — waiting on something",
  REVIEW: "Review — needs your approval",
};

export interface QueueItem {
  id: string;
  category: QueueCategory;
  title: string;
  detail?: string;
  status: "open" | "done" | "dropped";
  /** Autonomy level (0-5) required to act on this item. */
  autonomy: number;
  created: number;
  updated: number;
}

const KEY = "lelu.queue.v1";

export default class WorkQueue {
  private static instance: WorkQueue | null = null;
  private items: QueueItem[];

  private constructor() {
    this.items = KvStore.getInstance().get<QueueItem[]>(KEY) ?? [];
  }

  public static getInstance(): WorkQueue {
    if (!WorkQueue.instance) {
      WorkQueue.instance = new WorkQueue();
    }
    return WorkQueue.instance;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.items);
    } catch {
      // best-effort
    }
  }

  public list(): QueueItem[] {
    return [...this.items];
  }

  public listCategory(category: QueueCategory): QueueItem[] {
    return this.items
      .filter((item) => item.category === category && item.status === "open")
      .sort((a, b) => b.updated - a.updated);
  }

  public counts(): Record<QueueCategory, number> {
    const counts = Object.fromEntries(QUEUE_CATEGORIES.map((category) => [category, 0])) as Record<
      QueueCategory,
      number
    >;
    for (const item of this.items) {
      if (item.status === "open") {
        counts[item.category] += 1;
      }
    }
    return counts;
  }

  public add(input: Omit<QueueItem, "id" | "created" | "updated" | "status">): QueueItem {
    const created: QueueItem = {
      ...input,
      id: crypto.randomUUID(),
      status: "open",
      created: Date.now(),
      updated: Date.now(),
    };
    this.items = [created, ...this.items];
    this.persist();
    return created;
  }

  public move(id: string, category: QueueCategory): void {
    this.items = this.items.map((item) =>
      item.id === id ? { ...item, category, updated: Date.now() } : item,
    );
    this.persist();
  }

  public complete(id: string): void {
    this.items = this.items.map((item) =>
      item.id === id ? { ...item, status: "done", updated: Date.now() } : item,
    );
    this.persist();
  }

  public reopen(id: string): void {
    this.items = this.items.map((item) =>
      item.id === id ? { ...item, status: "open", updated: Date.now() } : item,
    );
    this.persist();
  }

  public drop(id: string): void {
    this.items = this.items.map((item) =>
      item.id === id ? { ...item, status: "dropped", updated: Date.now() } : item,
    );
    this.persist();
  }

  public remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.persist();
  }

  public recent(limit = 12): QueueItem[] {
    return [...this.items].sort((a, b) => b.updated - a.updated).slice(0, limit);
  }
}
