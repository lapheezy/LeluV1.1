/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS ACTIONS
 *
 * Universal event model.
 *
 * Handles:
 * - browser activity
 * - navigation
 * - research
 * - AI thinking
 * - agents
 * - workspaces
 * - building
 * - simulations
 * - creation
 * - memory activity
 * ==========================================================
 */





export type GenesisActionType =


  | "browse"

  | "navigate"

  | "search"

  | "research"

  | "analyze"

  | "think"

  | "learn"

  | "remember"

  | "retrieve"

  | "build"

  | "code"

  | "create"

  | "design"

  | "simulate"

  | "observe"

  | "agent"

  | "workspace"

  | "system";





export type GenesisActionStatus =


  | "idle"

  | "queued"

  | "running"

  | "paused"

  | "complete"

  | "failed"

  | "cancelled";





export type GenesisActionSource =


  | "ai"

  | "browser"

  | "agent"

  | "memory"

  | "user"

  | "system";





export interface GenesisAction {


  /**
   * Unique event id
   */
  id:

    string;




  /**
   * What Lélu is doing
   */
  type:

    GenesisActionType;




  /**
   * Human readable title
   */
  label:

    string;




  /**
   * More information
   */
  detail?:

    string;




  /**
   * Origin of action
   */
  source:

    GenesisActionSource;




  /**
   * Current state
   */
  status:

    GenesisActionStatus;




  /**
   * URL, file, workspace,
   * agent, project, etc.
   */
  target?:

    string;




  /**
   * Connected agent
   */
  agentId?:

    string;




  /**
   * Connected workspace
   */
  workspaceId?:

    string;




  /**
   * Progress 0-100
   */
  progress:

    number;




  /**
   * Created time
   */
  timestamp:

    number;




  /**
   * Finished time
   */
  completedAt?:

    number;




  /**
   * Extra data
   */
  metadata?:

    Record<string, unknown>;

}





export function createGenesisAction(

  type:

    GenesisActionType,


  label:

    string,


  options:

  {

    source?:

      GenesisActionSource;


    detail?:

      string;


    target?:

      string;


    agentId?:

      string;


    workspaceId?:

      string;


    metadata?:

      Record<string, unknown>;

  } = {},

):

GenesisAction {


  return {


    id:

      crypto.randomUUID(),



    type,



    label,



    detail:

      options.detail,



    source:

      options.source ?? "ai",



    status:

      "queued",



    target:

      options.target,



    agentId:

      options.agentId,



    workspaceId:

      options.workspaceId,



    progress:

      0,



    timestamp:

      Date.now(),



    metadata:

      options.metadata,

  };

}