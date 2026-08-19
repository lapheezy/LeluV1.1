/**
 * ==========================================================
 * LÉLU
 * REFLECTION ENGINE
 * ==========================================================
 */

import PatternMemory
  from "./PatternMemory";

import type ResponsePattern
  from "./ResponsePattern";


export interface Reflection {


  summary:
    string;


  memories:
    string[];


  categories:
    string[];


  insights:
    string[];


  activeThemes:
    string[];


  priorities:
    string[];

}





export default class ReflectionEngine {


  constructor(

    private readonly memory:
      PatternMemory,

  ) {}





  /**
   * ==========================================================
   * Create reflection from memories
   * ==========================================================
   */
  public async reflect():

    Promise<Reflection> {


    const memories =

      this.memory.getAll();





    if (

      memories.length === 0

    ) {


      return {

        summary:

          "No memories available yet.",


        memories:

          [],


        categories:

          [],


        insights:

          [],


        activeThemes:

          [],


        priorities:

          [],

      };

    }





    const important =

      this.rank(

        memories,

      )

      .slice(

        0,

        20,

      );





    return {


      summary:

        this.createSummary(

          important,

        ),



      memories:

        important.map(

          memory =>

            memory.response,

        ),



      categories:

        this.categories(

          important,

        ),



      insights:

        this.createInsights(

          important,

        ),



      activeThemes:

        this.extractThemes(

          important,

        ),



      priorities:

        this.findPriorities(

          important,

        ),

    };

  }





  /**
   * ==========================================================
   * Rank memories
   * ==========================================================
   */
  private rank(

    memories:
      ResponsePattern[],

  ):
    ResponsePattern[] {


    return [

      ...memories,

    ]

    .sort(

      (

        a,

        b,

      ) => {


        const scoreA =

          a.importance *

          2 +

          a.confidence +

          a.successfulUses;



        const scoreB =

          b.importance *

          2 +

          b.confidence +

          b.successfulUses;



        return scoreB - scoreA;

      },

    );

  }





  /**
   * ==========================================================
   * Categories
   * ==========================================================
   */
  private categories(

    memories:
      ResponsePattern[],

  ):
    string[] {


    return [

      ...new Set(

        memories.map(

          memory =>

            memory.category,

        ),

      ),

    ];

  }





  /**
   * ==========================================================
   * Generate insights
   * ==========================================================
   */
  private createInsights(

    memories:
      ResponsePattern[],

  ):
    string[] {


    const insights:
      string[] = [];



    const projects =

      memories.filter(

        memory =>

          memory.category === "project",

      );



    const skills =

      memories.filter(

        memory =>

          memory.category === "skill",

      );



    if (

      projects.length > 0

    ) {


      insights.push(

        "User frequently works on creative or technical projects.",

      );

    }





    if (

      skills.length > 0

    ) {


      insights.push(

        "User has stored skills that can influence future guidance.",

      );

    }





    return insights;

  }





  /**
   * ==========================================================
   * Find recurring themes
   * ==========================================================
   */
  private extractThemes(

    memories:
      ResponsePattern[],

  ):
    string[] {


    const words:

      Record<string, number> =

      {};





    for (

      const memory of memories

    ) {


      for (

        const keyword of memory.keywords

      ) {


        words[keyword] =

          (

            words[keyword] ?? 0

          ) + 1;

      }

    }





    return Object.entries(

      words,

    )

    .sort(

      (

        a,

        b,

      ) =>

        b[1] -

        a[1],

    )

    .slice(

      0,

      10,

    )

    .map(

      ([word]) =>

        word,

    );

  }





  /**
   * ==========================================================
   * Find goals and priorities
   * ==========================================================
   */
  private findPriorities(

    memories:
      ResponsePattern[],

  ):
    string[] {


    return memories

      .filter(

        memory =>

          memory.category === "goal" ||

          memory.category === "project",

      )

      .slice(

        0,

        5,

      )

      .map(

        memory =>

          memory.response,

      );

  }





  /**
   * ==========================================================
   * Build summary
   * ==========================================================
   */
  private createSummary(

    memories:
      ResponsePattern[],

  ):
    string {


    const categories =

      this.categories(

        memories,

      );



    return (

      `Lélu understands ${categories.join(", ")}. ` +

      `She has formed ${memories.length} connected memories and is tracking recurring themes.`

    );

  }

}