/**
 * ==========================================================
 * LÉLU
 * AGENT MANAGER
 *
 * Controls cognitive agents and their memories
 * ==========================================================
 */


export interface CognitiveAgent {


  id:
    string;


  name:
    string;


  role:
    string;


  memories:
    string[];


  createdAt:
    number;


  updatedAt:
    number;

}





export default class AgentManager {



  private readonly agents:

    Map<string, CognitiveAgent> =

      new Map();





  constructor() {


    this.createDefaultAgents();

  }





  /**
   * ==========================================================
   * Default agents
   * ==========================================================
   */
  private createDefaultAgents():

    void {


    this.createAgent(

      "builder",

      "Builder Agent",

      "Creates and improves projects",

    );



    this.createAgent(

      "research",

      "Research Agent",

      "Finds and organizes knowledge",

    );



    this.createAgent(

      "creative",

      "Creative Agent",

      "Handles ideas and design",

    );



    this.createAgent(

      "life",

      "Life Agent",

      "Tracks goals and direction",

    );

  }





  /**
   * ==========================================================
   * Create agent
   * ==========================================================
   */
  public createAgent(

    id:
      string,


    name:
      string,


    role:
      string,

  ):
    void {


    if (

      this.agents.has(id)

    ) {


      return;

    }





    this.agents.set(

      id,

      {

        id,

        name,

        role,


        memories:

          [],


        createdAt:

          Date.now(),


        updatedAt:

          Date.now(),

      },

    );

  }





  /**
   * ==========================================================
   * Assign memory to agent
   * ==========================================================
   */
  public assignMemory(

    agentId:
      string,


    memory:
      string,

  ):
    void {


    const agent =

      this.agents.get(

        agentId,

      );





    if (

      !agent

    ) {


      return;

    }





    if (

      !agent.memories.includes(

        memory,

      )

    ) {


      agent.memories.push(

        memory,

      );

    }





    agent.updatedAt =

      Date.now();

  }





  /**
   * ==========================================================
   * Get agent
   * ==========================================================
   */
  public get(

    id:
      string,

  ):
    CognitiveAgent | undefined {


    return this.agents.get(

      id,

    );

  }





  /**
   * ==========================================================
   * List agents
   * ==========================================================
   */
  public all():

    CognitiveAgent[] {


    return Array.from(

      this.agents.values(),

    );

  }

}