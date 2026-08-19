/**
 * ==========================================================
 * LÉLU
 * COGNITIVE CORE
 *
 * Executive cognition layer
 * ==========================================================
 */

import KnowledgeGraph
  from "./KnowledgeGraph";

import AgentManager
  from "./AgentManager";

import WorkspaceManager
  from "./WorkspaceManager";

import type {
  ReasoningResult,
} from "../reasoning/ReasoningEngine";

import type {
  Plan,
} from "../planning/PlanningEngine";





export default class CognitiveCore {


  public readonly graph:
    KnowledgeGraph;



  public readonly agents:
    AgentManager;



  public readonly workspaces:
    WorkspaceManager;



  /**
   * Most recent reasoning result
   * (ReasoningResolver's output),
   * kept for the UI to inspect.
   */
  private latestReasoning:
    ReasoningResult | null =
      null;



  /**
   * Most recent task plan
   * (PlanningResolver's output),
   * kept for the UI to inspect.
   */
  private latestPlan:
    Plan | null =
      null;




  constructor() {


    this.graph =

      new KnowledgeGraph();



    this.agents =

      new AgentManager();



    this.workspaces =

      new WorkspaceManager();

  }





  /**
   * ==========================================================
   * Initialize cognition
   * ==========================================================
   */
  public initialize():

    void {


    this.createDefaultWorkspaces();


  }





  /**
   * ==========================================================
   * Default workspaces
   * ==========================================================
   */
  private createDefaultWorkspaces():

    void {


    this.workspaces.add(

      "core",

      "Lélu Core",

    );



    this.workspaces.add(

      "projects",

      "Projects",

    );



    this.workspaces.add(

      "knowledge",

      "Knowledge",

    );



    this.workspaces.add(

      "creative",

      "Creative",

    );



    this.workspaces.add(

      "growth",

      "Growth",

    );

  }





  /**
   * ==========================================================
   * Default agents
   *
   * AgentManager creates these already
   * ==========================================================
   */





  /**
   * ==========================================================
   * Observe conversation
   * ==========================================================
   */
  public observe(

    text:
      string,

  ):
    void {


    const id =

      crypto.randomUUID();





    this.graph.addNode({

      id,

      type:

        "observation",


      label:

        text,


      data:

      {

        source:

          "conversation",

      },


      createdAt:

        Date.now(),

    });





    this.workspaces.add(

      "core",

      text,

    );

  }





  /**
   * ==========================================================
   * Create relationship
   * ==========================================================
   */
  public connect(

    from:
      string,


    to:
      string,


    relation:
      string,

  ):
    void {


    this.graph.connect(

      from,

      to,

      relation,

    );

  }





  /**
   * ==========================================================
   * Current cognitive state
   * ==========================================================
   */
  public state():

    {

      nodes: unknown[];

      connections: unknown[];

      agents: unknown[];

      workspaces: unknown[];

      reasoning: ReasoningResult | null;

      plan: Plan | null;

    } {


    return {


      nodes:

        this.graph.all(),



      connections:

        this.graph.connections(),



      agents:

        this.agents.all(),



      workspaces:

        this.workspaces.all(),


      reasoning:

        this.latestReasoning,


      plan:

        this.latestPlan,

    };

  }



  /**
   * ==========================================================
   * Record a Reasoning stage result, so Genesis's live
   * state (and a Reasoning panel) can show *why* Lélu
   * answered the way it did.
   * ==========================================================
   */
  public recordReasoning(
    reasoning: ReasoningResult | null | undefined,
  ): void {

    if (!reasoning) {
      return;
    }

    this.latestReasoning = reasoning;

    if (reasoning.selected) {
      this.workspaces.add(
        "core",
        `Reasoning: ${reasoning.explanation}`,
      );
    }
  }



  /**
   * ==========================================================
   * Record a Planning stage result, so Genesis's live
   * state (and a Reasoning/Planning panel) can show the
   * active task breakdown.
   * ==========================================================
   */
  public recordPlan(
    plan: Plan | null | undefined,
  ): void {

    if (!plan) {
      return;
    }

    this.latestPlan = plan;

    this.workspaces.add(
      "core",
      `Plan: ${plan.goal} (${plan.steps.length} step(s))`,
    );
  }

}