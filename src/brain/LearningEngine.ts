/**
 * ==========================================================
 * LÉLU
 * LEARNING ENGINE
 * ==========================================================
 */

import PatternMemory
  from "./PatternMemory";

import MemoryExtractor
  from "./MemoryExtractor";

import MemoryOrganizer
  from "./MemoryOrganizer";

import type ResponsePattern
  from "./ResponsePattern";


export default class LearningEngine {


  private readonly extractor =
    new MemoryExtractor();



  private readonly organizer =
    new MemoryOrganizer();





  constructor(

    private readonly memory:
      PatternMemory,

  ) {}





  /**
   * ==========================================================
   * Learn from interaction
   * ==========================================================
   */
  public async learn(

    prompt:
      string,


    response:
      string,


    intent =
      "general",


    keywords:
      string[] = [],


    context:
      Record<string, unknown> = {},

  ):
    Promise<ResponsePattern> {


    const extracted =

      this.extractor.extract(

        prompt,

        response,

      );



    const organized =

      this.organizer.organize(

        extracted,

      );



    const now =
      Date.now();



    let primary:
      ResponsePattern | undefined;





    for (

      const memory of organized

    ) {


      const pattern:

        ResponsePattern =

      {


        id:

          crypto.randomUUID(),



        category:

          memory.category,



        prompt,



        response:

          memory.content,



        intent,



        keywords:

          memory.keywords.length > 0

            ? memory.keywords

            : keywords,



        context:
        {

          ...context,


          memoryCategory:

            memory.category,


          merged:

            memory.merged,

        },



        memoryType:

          memory.memoryType,



        importance:

          memory.importance,



        confidence:

          1,



        successfulUses:

          1,



        failedUses:

          0,



        createdAt:

          now,



        updatedAt:

          now,

      };





      await this.memory.add(

        pattern,

      );





      if (

        !primary

      ) {


        primary =
          pattern;

      }

    }





    if (

      primary

    ) {


      return primary;

    }





    const fallback:

      ResponsePattern =

    {


      id:

        crypto.randomUUID(),



      category:

        "conversation",



      prompt,



      response,



      intent,      keywords,



      context,



      memoryType:

        "conversation",



      importance:

        0.3,


      confidence:

        0.5,



      successfulUses:

        1,



      failedUses:

        0,



      createdAt:

        now,



      updatedAt:

        now,

    };





    await this.memory.add(

      fallback,

    );





    return fallback;

  }





  /**
   * ==========================================================
   * Reinforce memory
   * ==========================================================
   */
  public async reinforce(

    id:
      string,

  ):
    Promise<void> {


    const pattern =

      this.memory.get(

        id,

      );



    if (

      !pattern

    ) {


      return;

    }





    pattern.successfulUses++;



    pattern.confidence =

      pattern.successfulUses /

      Math.max(

        1,

        pattern.successfulUses +

        pattern.failedUses,

      );



    pattern.updatedAt =

      Date.now();



    await this.memory.update(

      pattern,

    );

  }





  /**
   * ==========================================================
   * Weaken memory
   * ==========================================================
   */
  public async weaken(

    id:
      string,

  ):
    Promise<void> {


    const pattern =

      this.memory.get(

        id,

      );



    if (

      !pattern

    ) {


      return;

    }





    pattern.failedUses++;



    pattern.confidence =

      pattern.successfulUses /

      Math.max(

        1,

        pattern.successfulUses +

        pattern.failedUses,

      );



    pattern.updatedAt =

      Date.now();



    await this.memory.update(

      pattern,

    );

  }

}