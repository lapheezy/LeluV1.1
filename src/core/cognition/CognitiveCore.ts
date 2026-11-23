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

import AgentStore
  from "../agents/AgentStore";

import WorkspaceManager
  from "./WorkspaceManager";

import type {
  MemoryScopeContext,
} from "../memory/MemorySovereignty";

import type {
  ReasoningResult,
} from "../reasoning/ReasoningEngine";

import type {
  Plan,
} from "../planning/PlanningEngine";





export default class CognitiveCore {


  public readonly graph:
    KnowledgeGraph;



  /**
   * The agent registry. This reads through to the SAME AgentStore
   * the Agents panel and agent runner use — there is exactly one
   * canonical agent runtime. CognitiveCore never keeps its own
   * separate/decorative agent list, so "N agents" shown anywhere
   * derived from this class always reflects real, live agents.
   */
  private readonly agentStore:
    AgentStore;



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



    this.agentStore =

      AgentStore.getInstance();



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


    this.workspaces.ensure(

      "core",

      "Lélu Core",

    );



    this.workspaces.ensure(

      "projects",

      "Projects",

    );



    this.workspaces.ensure(

      "knowledge",

      "Knowledge",

    );



    this.workspaces.ensure(

      "creative",

      "Creative",

    );



    this.workspaces.ensure(

      "growth",

      "Growth",

    );

  }





  /**
   * ==========================================================
   * Default agents
   *
   * Agents are owned by AgentStore (the Agents panel's store) —
   * CognitiveCore reads them, it does not create or own any.
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

    /** The conversation this observation came from. Without it the node is
     *  unattributable, and state() refuses to show it to any conversation. */
    conversationId?:
      string,

    /** The memory this observation was derived from, when it came with one.
     *  Deleting that memory removes this node too (M22.1, WP06). */
    memoryId?:
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

        ...(conversationId
          ? { conversationId }
          : {}),
        ...(memoryId
          ? { memoryId }
          : {}),
      },


      createdAt:

        Date.now(),

    });





    // SCOPED. The workspace used to hold every observation's text in one
    // global array with no origin. It is now filed with the conversation that
    // made it and the memory it came from, and only authorized text is ever
    // read back (M22.2).
    this.workspaces.add(

      "core",

      text,

      {
        conversationId: conversationId ?? null,
        ...(memoryId ? { memoryId } : {}),
        sourceType: "lelu-observed",
        scope: conversationId ? "conversation-local" : "session-local",
      },

    );

  }

  /**
   * Workspace observation TEXT, authorized for this turn. `state()` lists
   * names and counts only, so nothing that reads the state object can quote
   * another conversation's observations by accident.
   */
  public workspaceItems(
    workspaceId:
      string,

    scope:
      MemoryScopeContext,
  ):
    string[] {

    return this.workspaces.itemsFor(
      workspaceId,
      scope,
    );
  }

  /**
   * Drop every observation made in a conversation. Used when a conversation
   * is deleted: a graph node is content, and content outliving its chat is
   * the leak 2.2 removed from the memory store now removed here too.
   */
  public forgetConversation(
    conversationId:
      string,
  ):
    number {

    this.workspaces.forgetConversation(conversationId);

    return this.graph.purge(
      (node) => node.data?.conversationId === conversationId,
    );
  }

  /** Drop nodes derived from one deleted memory. */
  public forgetMemory(
    memoryId:
      string,
  ):
    number {

    this.workspaces.forgetMemory(memoryId);

    return this.graph.purge(
      (node) => node.data?.memoryId === memoryId,
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
    public state(

    /** When given, only nodes from this conversation (and unattributed
     *  system nodes are NOT included — a node nobody can attribute must
     *  not be shown as this conversation's context). */
    conversationId?:
      string,

  ):

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
        (this.graph.all() as Array<{ data?: Record<string, unknown> }>)
          .filter((node) =>
            conversationId
              ? node.data?.conversationId === conversationId
              : true,
          ),



      connections:

        this.graph.connections(),



      // Real, live agents from the canonical AgentStore — not a
      // static decorative list. "0 agents" is an honest answer
      // when none have been created yet.
      agents:

        this.agentStore.list()
          .filter((agent) => agent.status !== "archived")
          .map((agent) => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            memories: agent.tasks
              .slice(-4)
              .map((task) => task.label),
          })),



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
      // Turn reasoning has no conversation id at this layer, so it is filed
      // as session material: visible to the workspace's own display, never
      // injected into another conversation's context.
      this.workspaces.add(
        "core",
        `Reasoning: ${reasoning.explanation}`,
        { scope: "session-local", sourceType: "inferred", retention: "session", confidence: 0.6 },
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
      { scope: "session-local", sourceType: "inferred", retention: "session", confidence: 0.6 },
    );
  }

}