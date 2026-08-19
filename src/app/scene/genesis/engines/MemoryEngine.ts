/**
 * ==========================================================
 * LÉLUVERSE
 * MEMORY ENGINE
 *
 * Living memory system.
 *
 * Stores learning events and feeds Genesis memory state.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export interface GenesisMemory {

  timestamp:number;

  type:string;

  value:number;

  importance:number;

}



export default class MemoryEngine {


  private readonly memories:
    GenesisMemory[] = [];


  private timer = 0;



  update(

    state:GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    this.timer += delta;



    /*
     * Capture meaningful events
     */

    const importance =

      (

        state.learning +

        state.awareness +

        state.intelligence

      ) / 3;



    if(

      importance > 0.05 &&

      this.timer > 1

    ){


      this.memories.push({

        timestamp:
          state.age,

        type:
          state.era ?? "unknown",

        value:
          state.learning,

        importance,

      });



      this.timer = 0;


    }



    /*
     * Sync memory into Genesis state
     */

    state.memory.shortTerm = Math.min(

      1,

      this.memories.length *

      0.02,

    );


    state.memory.longTerm = Math.min(

      1,

      this.memories.length *

      0.005,

    );


    state.memory.archived =

      this.memories.filter(

        memory =>

          memory.importance >

          0.7

      ).length / 100;



    state.memory.importance =

      importance;



  }



  getMemories():

  GenesisMemory[] {

    return this.memories;

  }



  clear():void {

    this.memories.length = 0;

  }


}