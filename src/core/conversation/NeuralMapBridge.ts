/**
 * ==========================================================
 * LÉLU — NEURAL MAP EVENT BRIDGE (WP18.10)
 *
 * An honest note on what exists in this checkout:
 *
 * There is no subsystem named "Neural Map V2" or "V3" in this branch.
 * The repository's graph surfaces are CognitiveCore's KnowledgeGraph
 * (observations and relations) and SpatialSceneGraph (the world), and
 * the runtime's event spine is AgentEventBus + Sentinel. Building a
 * second graph store under the Neural Map name would create exactly the
 * parallel-cognition system this mission forbids.
 *
 * So this is a BRIDGE, not a map: cognitive events are recorded once,
 * with an internal/user-visible distinction, and exposed as two
 * projections whose shapes are what a Neural Map V2 (connectivity) and
 * V3 (temporal, salience-weighted, visibility-separated) view consumes
 * when one is present. When no such view exists, the bridge is still
 * the authoritative event record and the projections are inspectable.
 *
 * Nothing here invents events. Every event is emitted by the module
 * that actually did the thing, after it happened.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type { Surface } from "./types";
import { fingerprint, shorten } from "./text";

export type NeuralEventKind =
  | "self-questioning"
  | "objective-evaluation"
  | "conversational-initiative"
  | "clarification"
  | "recommendation"
  | "scope-adjustment"
  | "priority-change"
  | "post-action-continuation"
  | "learning"
  | "behavioural-development";

export const NEURAL_EVENT_KINDS: NeuralEventKind[] = [
  "self-questioning",
  "objective-evaluation",
  "conversational-initiative",
  "clarification",
  "recommendation",
  "scope-adjustment",
  "priority-change",
  "post-action-continuation",
  "learning",
  "behavioural-development",
];

export interface NeuralEvent {
  id: string;
  kind: NeuralEventKind;
  at: number;
  subject: string;
  detail: string;
  /** Internal reasoning, or something the user was actually told. */
  visibility: "internal" | "user-visible";
  refs: {
    conversationId?: string;
    objectiveId?: string;
    surface?: Surface;
    questionId?: string;
    initiativeKind?: string;
  };
  data?: Record<string, unknown>;
}

export interface NeuralNode {
  id: string;
  kind: NeuralEventKind | "subject" | "conversation" | "objective";
  label: string;
  at: number;
  visibility: "internal" | "user-visible";
  salience: number;
}

export interface NeuralEdge {
  from: string;
  to: string;
  relation: "concerns" | "follows" | "raised-in" | "advances";
}

export interface NeuralMapV2Projection {
  version: "v2";
  at: number;
  nodes: NeuralNode[];
  edges: NeuralEdge[];
  byKind: Record<string, number>;
}

export interface NeuralMapV3Projection {
  version: "v3";
  at: number;
  layers: {
    internal: NeuralNode[];
    userVisible: NeuralNode[];
  };
  timeline: Array<{ at: number; kind: NeuralEventKind; label: string; visibility: "internal" | "user-visible" }>;
  salienceByKind: Record<string, number>;
  /** Questions and challenges left open, by subject. */
  unresolved: Array<{ kind: NeuralEventKind; subject: string; detail: string }>;
}

const KEY = "lelu.wp18.neural.v1";
const MAX_EVENTS = 160;

interface Persisted {
  version: 1;
  events: NeuralEvent[];
}

type Listener = (event: NeuralEvent) => void;

export default class NeuralMapBridge {
  private static instance: NeuralMapBridge | null = null;

  private readonly kv = KvStore.getInstance();
  private state: Persisted;
  private listeners = new Set<Listener>();

  private constructor() {
    const stored = this.kv.get<Partial<Persisted>>(KEY);
    this.state = {
      version: 1,
      events:
        stored?.version === 1 && Array.isArray(stored.events)
          ? stored.events.filter(
              (event): event is NeuralEvent =>
                Boolean(event) && typeof event.kind === "string" && typeof event.at === "number",
            )
          : [],
    };
  }

  public static getInstance(): NeuralMapBridge {
    if (!NeuralMapBridge.instance) {
      NeuralMapBridge.instance = new NeuralMapBridge();
    }
    return NeuralMapBridge.instance;
  }

  public static resetForTests(): void {
    NeuralMapBridge.instance = null;
  }

  private persist(): void {
    this.state.events = this.state.events.slice(-MAX_EVENTS);
    try {
      this.kv.set(KEY, this.state);
    } catch {
      // best-effort
    }
  }

  /**
   * Record one real cognitive event.
   *
   * The id is derived from kind + subject + detail, so re-observing the
   * same situation does not create a second node. Time is carried on
   * the event rather than in the identity.
   */
  public record(
    input: Omit<NeuralEvent, "id" | "at" | "visibility"> & {
      at?: number;
      visibility?: NeuralEvent["visibility"];
    },
  ): NeuralEvent {
    const event: NeuralEvent = {
      ...input,
      id: fingerprint("neural", input.kind, input.subject, input.detail),
      at: input.at ?? Date.now(),
      detail: shorten(input.detail, 240),
      visibility: input.visibility ?? "internal",
    };
    const existingIndex = this.state.events.findIndex((item) => item.id === event.id);
    if (existingIndex >= 0) {
      // Same observation, later: keep the newest timestamp but no new node.
      this.state.events[existingIndex] = { ...this.state.events[existingIndex]!, at: event.at };
    } else {
      this.state.events = [...this.state.events, event];
    }
    this.persist();
    if (existingIndex < 0) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // A view must never break cognition.
        }
      }
    }
    return event;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public recent(limit = 30): NeuralEvent[] {
    return this.state.events.slice(-limit);
  }

  public byKind(kind: NeuralEventKind, limit = 20): NeuralEvent[] {
    return this.state.events.filter((event) => event.kind === kind).slice(-limit);
  }

  /**
   * V2: connectivity.
   *
   * Every event becomes a node tied to its subject, its conversation
   * and its objective, and chained to the event before it on the same
   * subject. This is the shape a connectivity view can render.
   */
  public projectV2(now = Date.now()): NeuralMapV2Projection {
    const events = this.state.events;
    const nodes: NeuralNode[] = [];
    const edges: NeuralEdge[] = [];
    const byKind: Record<string, number> = {};
    const lastBySubject = new Map<string, string>();

    for (const event of events) {
      const nodeId = `event:${event.id}`;
      nodes.push({
        id: nodeId,
        kind: event.kind,
        label: shorten(event.detail, 110),
        at: event.at,
        visibility: event.visibility,
        salience: this.salienceOf(event),
      });
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;

      const subjectId = `subject:${fingerprint("subject", event.kind, event.subject)}`;
      if (!nodes.some((node) => node.id === subjectId)) {
        nodes.push({
          id: subjectId,
          kind: "subject",
          label: shorten(event.subject, 90),
          at: event.at,
          visibility: "internal",
          salience: 0.4,
        });
      }
      edges.push({ from: nodeId, to: subjectId, relation: "concerns" });

      if (event.refs.conversationId) {
        const conversationId = `conversation:${event.refs.conversationId}`;
        if (!nodes.some((node) => node.id === conversationId)) {
          nodes.push({
            id: conversationId,
            kind: "conversation",
            label: "conversation",
            at: event.at,
            visibility: event.visibility,
            salience: 0.3,
          });
        }
        edges.push({ from: nodeId, to: conversationId, relation: "raised-in" });
      }

      if (event.refs.objectiveId) {
        const objectiveId = `objective:${event.refs.objectiveId}`;
        if (!nodes.some((node) => node.id === objectiveId)) {
          nodes.push({
            id: objectiveId,
            kind: "objective",
            label: "objective",
            at: event.at,
            visibility: "internal",
            salience: 0.6,
          });
        }
        edges.push({ from: nodeId, to: objectiveId, relation: "advances" });
      }

      const previous = lastBySubject.get(event.subject);
      if (previous) edges.push({ from: nodeId, to: previous, relation: "follows" });
      lastBySubject.set(event.subject, nodeId);
    }

    return { version: "v2", at: now, nodes, edges, byKind };
  }

  /**
   * V3: temporal layers.
   *
   * The layer split is the important part: an internal observation and
   * a user-visible statement are never merged, so the map cannot make
   * it look like she told the user something she only thought.
   */
  public projectV3(now = Date.now()): NeuralMapV3Projection {
    const events = this.state.events;
    const nodes = events.map<NeuralNode>((event) => ({
      id: `event:${event.id}`,
      kind: event.kind,
      label: shorten(event.detail, 110),
      at: event.at,
      visibility: event.visibility,
      salience: this.salienceOf(event),
    }));
    const salienceByKind: Record<string, number> = {};
    for (const node of nodes) {
      const current = salienceByKind[node.kind] ?? 0;
      salienceByKind[node.kind] = Math.max(current, node.salience);
    }
    return {
      version: "v3",
      at: now,
      layers: {
        internal: nodes.filter((node) => node.visibility === "internal"),
        userVisible: nodes.filter((node) => node.visibility === "user-visible"),
      },
      timeline: events.slice(-60).map((event) => ({
        at: event.at,
        kind: event.kind,
        label: shorten(event.detail, 120),
        visibility: event.visibility,
      })),
      salienceByKind,
      unresolved: events
        .filter((event) => event.kind === "self-questioning" || event.kind === "objective-evaluation")
        .slice(-8)
        .map((event) => ({ kind: event.kind, subject: event.subject, detail: event.detail })),
    };
  }

  private salienceOf(event: NeuralEvent): number {
    switch (event.kind) {
      case "self-questioning":
        return 0.85;
      case "clarification":
        return 0.75;
      case "scope-adjustment":
        return 0.7;
      case "post-action-continuation":
        return event.visibility === "user-visible" ? 0.7 : 0.55;
      case "learning":
        return 0.65;
      case "objective-evaluation":
        return 0.6;
      case "conversational-initiative":
        return event.visibility === "user-visible" ? 0.65 : 0.45;
      case "recommendation":
        return 0.6;
      case "priority-change":
        return 0.55;
      case "behavioural-development":
        return 0.5;
    }
  }

  public reset(): void {
    this.state = { version: 1, events: [] };
    this.persist();
  }
}
