/**
 * ==========================================================
 * LÉLU
 * KNOWLEDGE GRAPH
 *
 * Local-first, like every other persistence owner in the runtime.
 * Nodes and their relationships are written through the canonical
 * KvStore, not Supabase and not a second graph database. The envelope
 * names its provenance so a reader can never mistake this for remote
 * state, and carries a revision so a reload has an ordering fact.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { noteContinuityChange } from "../sync/ContinuitySignals";

export const KNOWLEDGE_GRAPH_STORAGE_KEY = "lelu.cognition.knowledge.v1";

export interface PersistedKnowledgeGraphEnvelope {
  version: 1;
  provenance: "local";
  revision: number;
  updatedAt: number;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface KnowledgeNode {

  id:
    string;

  type:
    string;

  label:
    string;

  data:
    Record<string, unknown>;

  createdAt:
    number;

}


export interface KnowledgeEdge {

  from:
    string;

  to:
    string;

  relation:
    string;

  createdAt:
    number;

}



export default class KnowledgeGraph {

  /** Live graphs follow a reconciled envelope without a second store. */
  private static readonly liveInstances = new Set<KnowledgeGraph>();

  private readonly nodes =
    new Map<string, KnowledgeNode>();


  private readonly edges =
    new Map<string, KnowledgeEdge>();


  private readonly storage =
    KvStore.getInstance();


  private revision =
    0;


  constructor() {
    this.hydrate();
    KnowledgeGraph.liveInstances.add(this);
  }


  /** Load the last local graph. A corrupt or absent value is a cold start. */
  private hydrate():
    void {

    const stored = this.storage.get<Partial<PersistedKnowledgeGraphEnvelope>>(KNOWLEDGE_GRAPH_STORAGE_KEY);
    if (!stored) return;
    this.hydrateEnvelope(stored);
  }

  private hydrateEnvelope(stored: Partial<PersistedKnowledgeGraphEnvelope>): void {
    if (!Array.isArray(stored.nodes) || !Array.isArray(stored.edges)) return;
    this.nodes.clear();
    this.edges.clear();
    for (const node of stored.nodes) {
      if (typeof node?.id === "string") this.nodes.set(node.id, node);
    }
    for (const edge of stored.edges) {
      if (typeof edge?.from === "string" && typeof edge?.to === "string") {
        this.edges.set(`${edge.from}-${edge.to}-${edge.relation}`, edge);
      }
    }
    this.revision = typeof stored.revision === "number" ? stored.revision : 0;
  }


  private persist():
    void {

    this.revision += 1;
    const envelope = {
      version: 1,
      provenance: "local",
      revision: this.revision,
      updatedAt: Date.now(),
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    } satisfies PersistedKnowledgeGraphEnvelope;
    try {
      this.storage.set(KNOWLEDGE_GRAPH_STORAGE_KEY, envelope);
    } catch {
      // A local write failure must not take cognition down. The in-memory
      // graph remains authoritative for this session.
    }
    noteContinuityChange("knowledgeGraph", "local", [{
      id: "graph",
      updatedAt: envelope.updatedAt,
      data: envelope,
    }]);
  }

  /** Read the persisted graph without creating a second live instance. */
  public static readPersistedEnvelope(): PersistedKnowledgeGraphEnvelope | null {
    try {
      const stored = KvStore.getInstance().get<Partial<PersistedKnowledgeGraphEnvelope>>(KNOWLEDGE_GRAPH_STORAGE_KEY);
      if (!stored || !Array.isArray(stored.nodes) || !Array.isArray(stored.edges)) return null;
      return {
        version: 1,
        provenance: "local",
        revision: typeof stored.revision === "number" ? stored.revision : 0,
        updatedAt: typeof stored.updatedAt === "number" ? stored.updatedAt : 0,
        nodes: stored.nodes,
        edges: stored.edges,
      };
    } catch {
      return null;
    }
  }

  /**
   * Apply a reconciled envelope. Existing instances keep their in-memory
   * graph for the current session; the next instance hydrates this value.
   * No node or edge is duplicated because both are keyed by identity.
   */
  public static applyPersistedEnvelope(envelope: PersistedKnowledgeGraphEnvelope): void {
    if (!envelope || !Array.isArray(envelope.nodes) || !Array.isArray(envelope.edges)) return;
    try {
      KvStore.getInstance().set(KNOWLEDGE_GRAPH_STORAGE_KEY, {
        version: 1,
        provenance: "local",
        revision: Math.max(0, envelope.revision),
        updatedAt: envelope.updatedAt,
        nodes: envelope.nodes,
        edges: envelope.edges,
      } satisfies PersistedKnowledgeGraphEnvelope);
      // Existing CognitiveCore instances must see the reconciled graph in
      // this session, not only after a reload.
      for (const instance of KnowledgeGraph.liveInstances) {
        instance.hydrateEnvelope(envelope);
      }
      noteContinuityChange("knowledgeGraph", "remote", [{
        id: "graph",
        updatedAt: envelope.updatedAt,
        data: envelope,
      }]);
    } catch {
      // best-effort, as with the authority's own local write
    }
  }


  public getRevision():
    number {

    return this.revision;
  }


  public addNode(

    node:
      KnowledgeNode,

  ):
    void {


    this.nodes.set(

      node.id,

      node,

    );

    this.persist();

  }





  public connect(

    from:
      string,

    to:
      string,

    relation:
      string,

  ):
    void {


    const id =

      `${from}-${to}-${relation}`;



    this.edges.set(

      id,

      {

        from,

        to,

        relation,

        createdAt:

          Date.now(),

      },

    );

    this.persist();

  }





  /**
   * Remove one node and every edge touching it. A deleted memory must not
   * survive in the graph as an orphan observation (M22.1, WP06).
   */
  public removeNode(
    id:
      string,
  ):
    boolean {

    const removed =
      this.nodes.delete(
        id,
      );

    if (!removed) {
      return false;
    }

    for (const [edgeId, edge] of this.edges) {
      if (edge.from === id || edge.to === id) {
        this.edges.delete(edgeId);
      }
    }

    return true;
  }

  /** Remove every node matching a predicate; returns how many were removed. */
  public purge(
    predicate:
      (node: KnowledgeNode) => boolean,
  ):
    number {

    let removed = 0;

    for (const [id, node] of this.nodes) {
      if (predicate(node)) {
        this.removeNode(id);
        removed += 1;
      }
    }

    return removed;
  }

  public all():

    KnowledgeNode[] {


    return [

      ...this.nodes.values(),

    ];

  }





  public connections():

    KnowledgeEdge[] {


    return [

      ...this.edges.values(),

    ];

  }

}