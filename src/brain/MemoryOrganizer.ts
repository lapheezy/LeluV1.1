/**
 * ==========================================================
 * LÉLU
 * MEMORY ORGANIZER
 * ==========================================================
 */

import type {
  ExtractedMemory,
} from "./MemoryExtractor";

import type {
  MemoryCategory,
  MemoryType,
} from "./ResponsePattern";



export interface OrganizedMemory {


  category:
    MemoryCategory;


  content:
    string;


  keywords:
    string[];


  importance:
    number;


  merged:
    boolean;


  memoryType:
    MemoryType;

}





export default class MemoryOrganizer {



  /**
   * ==========================================================
   * Organize extracted memories
   * ==========================================================
   */
  public organize(

    memories:
      ExtractedMemory[],

  ):
    OrganizedMemory[] {


    const organized:
      OrganizedMemory[] = [];





    for (

      const memory of memories

    ) {


      const existing =

        organized.find(

          item =>

            item.category === memory.category &&

            this.related(

              item,

              memory,

            ),

        );





      if (

        existing

      ) {


        existing.keywords =

          this.mergeKeywords(

            existing.keywords,

            memory.keywords,

          );



        existing.importance =

          Math.max(

            existing.importance,

            memory.importance,

          );



        if (

          memory.content.length >

          existing.content.length

        ) {


          existing.content =

            memory.content;

        }



        existing.merged =
          true;



        continue;

      }





      organized.push({

        category:

          memory.category,



        content:

          memory.content,



        keywords:

          memory.keywords,



        importance:

          memory.importance,



        merged:

          false,


        memoryType:

          memory.memoryType,

      });

    }





    return organized;

  }





  /**
   * ==========================================================
   * Detect related memories
   * ==========================================================
   */
  private related(

    existing:
      OrganizedMemory,


    incoming:
      ExtractedMemory,

  ):
    boolean {


    const existingWords =

      this.words(

        existing.content,

      );



    const incomingWords =

      this.words(

        incoming.content,

      );



    const overlap =

      incomingWords.filter(

        word =>

          existingWords.includes(

            word,

          ),

      );





    return (

      overlap.length >= 1

    );

  }





  /**
   * ==========================================================
   * Normalize words
   * ==========================================================
   */
  private words(

    text:
      string,

  ):
    string[] {


    const ignored =

      new Set([

        "the",

        "and",

        "this",

        "that",

        "with",

        "from",

        "have",

        "want",

        "need",

        "make",

        "build",

        "creating",

      ]);



    return text

      .toLowerCase()

      .replace(

        /[^a-z0-9\s]/g,

        "",

      )

      .split(

        /\s+/,

      )

      .filter(

        word =>

          word.length > 3 &&

          !ignored.has(word),

      );

  }





  /**
   * ==========================================================
   * Convert category into memory space
   * ==========================================================
   */
  public spaceFor(

    category:
      MemoryCategory,

  ):
    "user"
    | "project"
    | "log" {


    switch(category) {


      case "project":

      case "goal":

      case "skill":

        return "project";



      case "conversation":

      case "experience":

        return "log";



      default:

        return "user";

    }

  }





  /**
   * ==========================================================
   * Merge keywords
   * ==========================================================
   */
  public mergeKeywords(

    a:
      string[],


    b:
      string[],

  ):
    string[] {


    return [

      ...new Set(

        [

          ...a,

          ...b,

        ],

      ),

    ];

  }

}