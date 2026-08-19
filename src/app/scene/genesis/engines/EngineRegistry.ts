/**
 * ==========================================================
 * LÉLUVERSE
 * ENGINE REGISTRY
 *
 * Central manager for all Genesis engines.
 *
 * Responsibilities:
 * - Register engines
 * - Control execution order
 * - Prevent duplicate engines
 * - Safe engine updates
 * - Runtime inspection
 *
 * ==========================================================
 */


import type {
  GenesisState,
} from "../state/GenesisState";

import {
  idleGenesisSignals,
  type GenesisSignals,
} from "./GenesisSignals";




export interface GenesisEngine {


  readonly id?: string;


  readonly priority?: number;

  /** Optional simulation cadence metadata. Undefined means render-driven. */
  readonly targetFrequency?: number;


  enabled?: boolean;

  error?: string;

  weight?: number;

getWeight?(
  state: GenesisState,
): number;

  initialize?(): void | Promise<void>;

  handleEvent?(
    event: string,
    payload?: unknown,
    state?: GenesisState,
  ): void | Promise<void>;

  update?(

    state: GenesisState,

    delta: number,

    signals?: GenesisSignals,

  ): void;


}





export interface EngineTelemetry {

  updateFrequency: number;

  targetFrequency?: number;

  deltaTime: number;

  lastUpdateTimestamp: number;

  updateCount: number;

  stateWriteConfirmed: boolean;

  rendererReadConfirmed: boolean;

  rendererReadCount: number;

}


export interface EngineStatus {


  id:string;


  enabled:boolean;


  priority:number;


  error?:string;

  telemetry: EngineTelemetry;


}





export default class EngineRegistry {




  private readonly engines =

    new Map<string, GenesisEngine>();

  private fallbackId = 0;

  private readonly telemetry =
    new Map<string, EngineTelemetry>();







  register(

    engine:GenesisEngine,

  ):void {



    const baseId =

      (engine.id ??

      engine.constructor.name) ||

      "GenesisEngine";

    let id = baseId;

    // Constructor names are not stable after production minification. Keep
    // unnamed engine instances distinct rather than silently dropping all
    // but the first one with the same generated name.
    while (this.engines.has(id)) {

      this.fallbackId += 1;
      id = `${baseId}_${this.fallbackId}`;

    }





    // Keep the original instance instead of spreading it into a plain
    // object. Engine behavior lives on the class prototype, so spreading
    // would silently drop initialize/update/handleEvent methods and leave
    // the registry with metadata-only shells.
    if (engine.enabled === undefined) {

      engine.enabled = true;

    }

    this.engines.set(

      id,

      engine,

    );

    this.telemetry.set(id, {
      updateFrequency: 0,
      targetFrequency: engine.targetFrequency,
      deltaTime: 0,
      lastUpdateTimestamp: 0,
      updateCount: 0,
      stateWriteConfirmed: false,
      rendererReadConfirmed: false,
      rendererReadCount: 0,
    });



  }







  unregister(

    id:string,

  ):void {    this.engines.delete(
      id,
    );
    this.telemetry.delete(id);


  }







  get(

    id:string,

  ):


  GenesisEngine | undefined {


    return this.engines.get(

      id,

    );


  }







  enable(

    id:string,

  ):void {


    const engine =

      this.engines.get(id);





    if(engine){


      engine.enabled = true;


    }


  }







  disable(

    id:string,

  ):void {


    const engine =

      this.engines.get(id);





    if(engine){


      engine.enabled = false;


    }


  }







  async initialize(): Promise<void> {

    for (const engine of this.getAll()) {

      if (engine.enabled === false) {

        continue;

      }

      try {

        await engine.initialize?.();

      }

      catch (error) {

        engine.enabled = false;
        engine.error = error instanceof Error ? error.message : String(error);

        console.error(`Genesis engine initialization failed: ${engine.id}`, error);

      }

    }

  }



  async dispatch(
    event: string,
    payload?: unknown,
    state?: GenesisState,
  ): Promise<void> {

    for (const engine of this.getAll()) {

      if (engine.enabled === false) {

        continue;

      }

      try {

        await engine.handleEvent?.(event, payload, state);

      }

      catch (error) {

        engine.enabled = false;
        engine.error = error instanceof Error ? error.message : String(error);

        console.error(`Genesis engine event failed: ${engine.id}`, error);

      }

    }

  }



  update(

    state:GenesisState,

    delta:number,

    signals:GenesisSignals = idleGenesisSignals,

  ):void {



    const engines =

      this.getAll();





    for(

      const engine

      of engines

    ){



      if(

        engine.enabled === false

        || typeof engine.update !== "function"

      ){

        continue;

      }





      const telemetry = this.telemetry.get(
        this.getId(engine),
      );
      const before = JSON.stringify(state);
      const updateStarted = this.now();

      try {

        engine.update(

          state,

          delta,

          signals,

        );

        if (telemetry) {
          telemetry.updateCount += 1;
          telemetry.deltaTime = delta;
          telemetry.lastUpdateTimestamp = updateStarted;
          telemetry.stateWriteConfirmed =
            before !== JSON.stringify(state);
          telemetry.updateFrequency =
            telemetry.updateCount /
            Math.max(delta * telemetry.updateCount, Number.EPSILON);
        }



      }      catch(error){



        engine.enabled = false;
        engine.error = error instanceof Error ? error.message : String(error);



        if (telemetry) {
          telemetry.updateCount += 1;
          telemetry.deltaTime = delta;
          telemetry.lastUpdateTimestamp = updateStarted;
          telemetry.stateWriteConfirmed =
            before !== JSON.stringify(state);
        }

        console.error(

          `Genesis engine failed: ${engine.id}`,

          error,

        );



      }


    }


  }







  getAll():GenesisEngine[] {


    return Array.from(

      this.engines.values(),

    )

    .sort(


      (a,b)=>



        (

          a.priority ??

          100

        )

        -

        (

          b.priority ??

          100

        )



    );


  }







  getStatus():EngineStatus[] {

    return Array.from(this.engines.entries())

      .sort(([, left], [, right]) =>
        (left.priority ?? 100) - (right.priority ?? 100),
      )

      .map(([id, engine]) => ({

        id,

        enabled: engine.enabled !== false,

        priority: engine.priority ?? 100,

        error: engine.error,

        telemetry: {
          ...(this.telemetry.get(id) ?? this.emptyTelemetry()),
        },

      }));

  }

  markRendererRead(): void {
    const timestamp = this.now();

    for (const [id, engine] of this.engines) {
      if (engine.enabled === false) {
        continue;
      }

      const telemetry = this.telemetry.get(id);
      if (!telemetry) {
        continue;
      }

      telemetry.rendererReadCount += 1;
      telemetry.rendererReadConfirmed = true;
      telemetry.lastUpdateTimestamp =
        telemetry.lastUpdateTimestamp || timestamp;
    }
  }

  private getId(engine: GenesisEngine): string {
    for (const [id, registered] of this.engines) {
      if (registered === engine) {
        return id;
      }
    }

    return engine.id ?? engine.constructor.name;
  }

  private emptyTelemetry(): EngineTelemetry {
    return {
      updateFrequency: 0,
      deltaTime: 0,
      lastUpdateTimestamp: 0,
      updateCount: 0,
      stateWriteConfirmed: false,
      rendererReadConfirmed: false,
      rendererReadCount: 0,
    };
  }

  private now(): number {
    return typeof performance !== "undefined"
      ? performance.now()
      : Date.now();
  }







  clear():void {


    this.engines.clear();
    this.telemetry.clear();


  }



}