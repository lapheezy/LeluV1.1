/**
 * ==========================================================
 * LÉLU
 * MEMORY EXTRACTOR
 * ==========================================================
 */

import type {
  MemoryCategory,
  MemoryType,
} from "./ResponsePattern";





export interface ExtractedMemory {


  category:
    MemoryCategory;


  content:
    string;


  keywords:
    string[];


  importance:
    number;


  memoryType:
    MemoryType;

}





export default class MemoryExtractor {


  public extract(

    prompt:
      string,


    _response:
      string,

  ):
    ExtractedMemory[] {


    const memories:

      ExtractedMemory[] = [];





    // User memories are extracted from the USER'S STATEMENT ONLY.
    // The response is Lélu's own reply and must never become a
    // "fact about the user" (e.g. an offline reply that mentions a
    // topic must not mint a project memory from the user's message).
    const source =

      prompt.trim();

    const name =
      this.extractName(prompt);

    if (name) {


      memories.push(

      {

        category:

          "identity",


        content:

          name,


        keywords:

          [

            ...this.keywords(

              name,

            ),

            "name",

            "call",

            "me",

          ],


        importance:

          1,


        memoryType:

          "user",

      });

    }





    const preference =

      prompt.match(

        /(i like|i love|i prefer|my favorite|favorite|i hate|i dislike)\s+(.+)/i,

      );





    if (preference) {


      memories.push(

      {

        category:

          "preference",


        content:

          preference[0].trim(),


        keywords:

          this.keywords(

            preference[0],

          ),


        importance:

          0.7,


        memoryType:

          "user",

      });

    }





    const goal =

      prompt.match(

        /(i want|my goal|i plan|trying to|need to)\s+(.+)/i,

      );





    if (goal) {


      memories.push(

      {

        category:

          "goal",


        content:

          goal[0].trim(),


        keywords:

          [

            ...this.keywords(

              goal[0],

            ),

            "goal",

          ],


        importance:

          0.9,


        memoryType:

          "user",

      });

    }





    const project =

      prompt.match(

        /(?:i am|i'm|i)\s+(?:building|creating|developing|working on|making|designing|planning)\s+(.+)/i,

      );



    if (

      project ||

      /\b(project|app|business|startup)\b/i.test(source)

    ) {


      const projectContent =
        project
          ? project[0].trim()
          : prompt.trim();


      memories.push(

      {

        category:

          "project",


        content:

          projectContent,


        keywords:

          [

            ...this.keywords(

              projectContent,

            ),

            "project",

          ],


        importance:

          0.9,


        memoryType:

          "user",

      });

    }





    const skill =

      prompt.match(

        /(?:i can|i know|i make|i build|i work with|i use|learned|skilled in)\s+(.+)/i,

      );



    if (

      skill ||

      /\b(skill|skilled|experienced with)\b/i.test(prompt)

    ) {


      const skillContent =
        skill
          ? skill[0].trim()
          : prompt.trim();


      memories.push(

      {

        category:

          "skill",


        content:

          skillContent,


        keywords:

          [

            ...this.keywords(

              skillContent,

            ),

            "skill",

          ],


        importance:

          0.8,


        memoryType:

          "user",

      });

    }





    if (

      /friend|family|brother|sister|partner|relationship/i

      .test(prompt)

    ) {


      memories.push(

      {

        category:

          "relationship",


        content:

          prompt.trim(),


        keywords:

          this.keywords(

            prompt,

          ),


        importance:

          0.8,


        memoryType:

          "user",

      });

    }





    if (

      memories.length === 0 &&

      !this.isQuestion(prompt)

    ) {


      memories.push(

      {

        category:

          "conversation",


        content:

          prompt.trim(),


        keywords:

          this.keywords(

            prompt,

          ),


        importance:

          0.3,


        memoryType:

          "conversation",

      });

    }





    return memories;

  }





  private isQuestion(

    text:
      string,

  ):
    boolean {


    const clean =

      text.trim();





    return (

      /\?$/.test(clean)

      ||

      /^(what|who|where|when|why|how|is|are|do|does|can|could|would)\b/i

      .test(clean)

    );

  }





  /**
   * Pull a stated name out of "my name is X" / "call me X" — as a
   * token walk rather than a single regex lookahead, because the
   * lookahead this replaced (`(?=\s+(?:and|i|...)|,|\.|$)|$)`)
   * required WHITESPACE before hitting a comma/period, so it silently
   * failed to extract anything from the single most common phrasing:
   * a name followed immediately by a period ("My name is Alex.") or
   * comma ("Call me Alex, please."). Walks words after the trigger
   * phrase, stopping at the first non-name-shaped word, a known
   * continuation word (and/but/so/...), clause-ending punctuation, or
   * three words (a generous cap for real names).
   */
  private extractName(prompt: string): string | null {
    const phrase = prompt.match(/(?:my name is|call me)\s+(.+)/i);
    if (!phrase) {
      return null;
    }

    const CONTINUATION_WORDS = new Set([
      "and", "i", "but", "who", "that", "because",
      "instead", "too", "also", "now", "here", "actually", "so", "then",
    ]);

    const nameWords: string[] = [];
    for (const raw of phrase[1].split(/\s+/)) {
      const endsClause = /[,.!?;:]$/.test(raw);
      const stripped = raw.replace(/[,.!?;:]+$/, "");

      if (!/^[A-Za-z'-]+$/.test(stripped)) {
        break;
      }
      if (CONTINUATION_WORDS.has(stripped.toLowerCase())) {
        break;
      }

      nameWords.push(stripped);

      if (endsClause || nameWords.length >= 3) {
        break;
      }
    }

    return nameWords.length > 0 ? nameWords.join(" ") : null;
  }

  private keywords(

    text:
      string,

  ):
    string[] {


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

          word.length > 2,

      );

  }

}