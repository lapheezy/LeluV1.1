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

export const KNOWLEDGE_GRAPH_STORAGE_KEY = "lelu.cognition.knowledge.v1";

interface PersistedKnowledgeGraph {
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
  }


  /** Load the last local graph. A corrupt or absent value is a cold start. */
  private hydrate():
    void {

    const stored = this.storage.get<Partial<PersistedKnowledgeGraph>>(KNOWLEDGE_GRAPH_STORAGE_KEY);
    if (!stored || !Array.isArray(stored.nodes) || !Array.isArray(stored.edges)) return;

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
    try {
      this.storage.set(KNOWLEDGE_GRAPH_STORAGE_KEY, {
        version: 1,
        provenance: "local",
        revision: this.revision,
        updatedAt: Date.now(),
        nodes: [...this.nodes.values()],
        edges: [...this.edges.values()],
      } satisfies PersistedKnowledgeGraph);
    } catch {
      // A local write failure must not take cognition down. The in-memory
      // graph remains authoritative for this session.
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