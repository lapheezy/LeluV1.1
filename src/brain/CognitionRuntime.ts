/**
 * ==========================================================
 * LÉLU
 * COGNITION RUNTIME
 *
 * Live bridge between cognition and interface layers
 * ==========================================================
 */

import CognitiveCore
  from "../core/cognition/CognitiveCore";

import type {
  ReasoningResult,
} from "../core/reasoning/ReasoningEngine";

import type {
  Plan,
} from "../core/planning/PlanningEngine";





export interface CognitionEvent {


  type:

    "update"

    | "agent"

    | "workspace"

    | "knowledge";



  payload:

    unknown;



  timestamp:

    number;

}





export default class CognitionRuntime {


  private readonly listeners:

    Set<(event: CognitionEvent) => void> =

      new Set();





  constructor(

    private readonly core:

      CognitiveCore,

  ) {}





  public observe(

    text:
      string,

  ):
    void {


    this.core.observe(

      text,

    );





    this.emit({

      type:

        "update",


      payload:

        this.core.state(),


      timestamp:

        Date.now(),

    });

  }



  /**
   * Record the Reasoning/Planning stage
   * output for the request that just
   * completed, and broadcast the updated
   * cognitive state so the UI reflects
   * it immediately.
   */
  public think(

    reasoning:
      ReasoningResult | null | undefined,

    plan:
      Plan | null | undefined,

  ):
    void {

    if (!reasoning && !plan) {
      return;
    }

    this.core.recordReasoning(reasoning);
    this.core.recordPlan(plan);

    this.emit({

      type:

        "update",


      payload:

        this.core.state(),


      timestamp:

        Date.now(),

    });
  }





  public state():

    ReturnType<CognitiveCore["state"]> {


    return this.core.state();

  }





  public subscribe(

    listener:

      (event:CognitionEvent)=>void,

  ):
    ()=>void {


    this.listeners.add(

      listener,

    );





    return () => {


      this.listeners.delete(

        listener,

      );

    };

  }





  private emit(

    event:
      CognitionEvent,

  ):
    void {


    for (

      const listener of this.listeners

    ) {


      listener(

        event,

      );

    }

  }





  public agents():

    unknown[] {


    return this.core.agents.all();

  }





  public workspaces():

    unknown[] {


    return this.core.workspaces.all();

  }





  public nodes():

    unknown[] {


    return this.core.graph.all();

  }

}