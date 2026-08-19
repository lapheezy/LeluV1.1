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