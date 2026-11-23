/**
 * ==========================================================
 * LÉLU
 * KNOWLEDGE GRAPH
 * ==========================================================
 */

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





  public addNode(

    node:
      KnowledgeNode,

  ):
    void {


    this.nodes.set(

      node.id,

      node,

    );

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