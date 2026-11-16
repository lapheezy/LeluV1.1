/**
 * ==========================================================
 * LÉLU — ACTION QUEUES PER CONVERSATION
 *
 * The chat's queue and a gallery card's queue are the same queue.
 * This holds one ActionQueue per conversation, folded from the ONE
 * shared AgentEventBus, routed by TurnOwnership — the map that
 * already says which conversation a task belongs to.
 *
 * That routing is what keeps two chats apart: an event whose task
 * is owned by chat A is folded into A's queue and can never appear
 * under B, whatever tab is open when it arrives. Work that belongs
 * to no conversation (cognition's own cycles, a background agent)
 * is not shown in a chat at all.
 *
 * This is a projection, not an engine: it runs no work, schedules
 * nothing and invents nothing. It listens only while something is
 * displaying a queue, so an idle app pays nothing.
 * ==========================================================
 */

import AgentEventBus, { type AgentEvent } from "../agent/AgentEvents";
import { ownerForTask } from "./TurnOwnership";
import { reduceQueue, type ActionQueue } from "./ActionQueue";

/** Conversations whose last turn is remembered. Oldest settled go first. */
const MAX_CONVERSATIONS = 24;

class ActionQueueStore {
  private static instance: ActionQueueStore | null = null;

  private readonly queues = new Map<string, ActionQueue>();
  private readonly listeners = new Set<() => void>();
  private unsubscribeBus: (() => void) | null = null;
  private version = 0;

  private constructor() {}

  public static getInstance(): ActionQueueStore {
    if (!ActionQueueStore.instance) ActionQueueStore.instance = new ActionQueueStore();
    return ActionQueueStore.instance;
  }

  /**
   * A number that changes whenever a queue changes — the snapshot a
   * component subscribes to. The queues themselves are read by id, so a
   * gallery with many cards re-renders once per event batch, not once
   * per card.
   */
  public getVersion = (): number => this.version;

  /** Subscribe to any queue changing. The bus is only listened to while someone is. */
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.attach();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.detach();
    };
  };

  /** This conversation's queue, or null if it has not run a turn. */
  public queueFor = (conversationId: string): ActionQueue | null => this.queues.get(conversationId) ?? null;

  /**
   * Forget a conversation's queue. Only the view is cleared: the events it
   * was built from are the bus's history and are untouched.
   */
  public clear = (conversationId: string): void => {
    if (!this.queues.delete(conversationId)) return;
    this.notify();
  };

  /** Test seam: forget everything and stop listening. */
  public reset = (): void => {
    this.queues.clear();
    this.detach();
    this.notify();
  };

  private attach(): void {
    if (this.unsubscribeBus) return;
    this.unsubscribeBus = AgentEventBus.getInstance().subscribe((event) => this.record(event));
  }

  private detach(): void {
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
  }

  private record(event: AgentEvent): void {
    const owner = ownerForTask(event.taskId);
    // Work no conversation asked for is not shown inside one.
    if (!owner) return;
    const before = this.queues.get(owner) ?? null;
    const next = reduceQueue(before, event, owner, Date.now());
    if (!next || next === before) return;
    this.queues.set(owner, next);
    this.prune();
    this.notify();
  }

  /** Bound the number of conversations remembered; never drop a running one. */
  private prune(): void {
    if (this.queues.size <= MAX_CONVERSATIONS) return;
    const settled = [...this.queues.entries()]
      .filter(([, queue]) => queue.status !== "running" && queue.status !== "asking" && queue.status !== "waiting")
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [id] of settled) {
      if (this.queues.size <= MAX_CONVERSATIONS) break;
      this.queues.delete(id);
    }
  }

  private notify(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[Lélu ActionQueue] listener threw (contained)", error);
      }
    }
  }
}

export default ActionQueueStore;
