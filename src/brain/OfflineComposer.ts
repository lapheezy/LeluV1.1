/**
 * ==========================================================
 * LÉLU
 * OFFLINE COMPOSER
 * ==========================================================
 */

import PatternMemory
  from "./PatternMemory";

import MemorySynthesizer
  from "./MemorySynthesizer";

import type ResponsePattern
  from "./ResponsePattern";

import {
  isLeluIdentityQuestion,
  isUserProfileQuestion,
} from "./LeluIdentity";


export default class OfflineComposer {


  constructor(

    private readonly memory:
      PatternMemory,

  ) {}





  /**
   * ==========================================================
   * Compose offline response
   * ==========================================================
   */  public async compose(

    prompt:
      string,

  ):
    Promise<string> {


    // Deterministic identity/profile questions are answered from
    // local persistent storage FIRST. This is not a search shortcut:
    // keyword overlap ("who" appears in both Lélu's identity and a
    // stored user identity) could otherwise misroute "Who am I?" to
    // Lélu's identity. These two question families must always
    // resolve locally, with or without any external API.
    const localAnswer =

      await this.localIdentityAnswer(

        prompt,

      );



    if (

      localAnswer

    ) {


      return localAnswer;

    }




    const matches =

      await this.memory.search(

        prompt,

      );



    if (

      matches.length === 0

    ) {


      return this.defaultResponse(

        prompt,

      );

    }




    // Synthesize the most relevant facts into a natural answer
    // instead of echoing one stored sentence (memory informs the
    // answer; it is not the verbatim answer).

    const synthesized =

      new MemorySynthesizer()

        .summarizeFacts(

          prompt,

          matches,

        );



    if (

      synthesized

    ) {


      return synthesized;

    }




    const best =

      this.pickBest(

        matches,

      );




    return this.composeFromPattern(

      best,

    );

  }





  /**
   * ==========================================================
   * Pick strongest memory
   * ==========================================================
   */
  private pickBest(

    matches:
      ResponsePattern[],

  ):
    ResponsePattern {


    return matches.sort(

      (

        a,

        b,

      ) => {


        const scoreA =

          a.confidence +

          a.importance +

          a.successfulUses;



        const scoreB =

          b.confidence +

          b.importance +

          b.successfulUses;



        return scoreB - scoreA;

      },

    )[0];

  }





  /**
   * ==========================================================
   * Convert memory into natural response
   * ==========================================================
   */
  private composeFromPattern(

    pattern:
      ResponsePattern,

  ):
    string {


    switch (

      pattern.category

    ) {



      case "identity":

        return this.identityResponse(

          pattern,

        );





      case "preference":

        return (

          `You've told me you ${pattern.response.replace(/^i\s+/i, "").toLowerCase()}.`

        );





      case "goal":

        return (

          `Your goal: ${pattern.response}`

        );





      case "project":

        return (

          `You're working on ${pattern.response.replace(/^i (?:am |'m )?(?:building|creating|working on|making)\s+/i, "")}.`

        );





      case "skill":

        return (

          `You have a skill with ${pattern.response.replace(/^i (?:can|know|make|build)\s+/i, "")}.`

        );





      default:

        return pattern.response;

    }

  }





  /**
   * ==========================================================
   * Identity formatting
   * ==========================================================
   */
  private identityResponse(

    pattern:
      ResponsePattern,

  ):
    string {


    const value =

      pattern.response;




    if (

      pattern.keywords.includes(

        "lelu",

      )

    ) {


      return value;

    }




    const match =

      value.match(

        /(.+?)\s+call me\s+(.+)/i

      );



    if (

      match

    ) {


      return (

        `Your name is ${match[1].trim()}. I'll call you ${match[2].trim()}.`

      );

    }



    return (

      `Your name is ${value}.`

    );

  }




  /**
   * ==========================================================
   * Local identity / profile answer
   *
   * Deterministic offline answers to "who are you" and "who am
   * I" style questions, composed purely from the persistent
   * local store. Returns null when the question is not one of
   * these, so normal fallback behaviour is unchanged.
   * ==========================================================
   */
  private async localIdentityAnswer(

    prompt:
      string,

  ):
    Promise<string | null> {


    if (

      isLeluIdentityQuestion(

        prompt,

      )

    ) {


      const identity =

        this.memory.get(

          "lelu-identity-foundation",

        );



      if (

        identity

      ) {


        return this.identityResponse(

          identity,

        );

      }

    }




    if (

      isUserProfileQuestion(

        prompt,

      )

    ) {


      const known =

        this.memory

          .getAll()

          .filter(

            pattern =>

              [

                "identity",

                "preference",

                "goal",

                "skill",

                "project",

                "relationship",

              ].includes(

                pattern.category,

              ) &&

              pattern.id !== "lelu-identity-foundation",

          );




      if (

        known.length > 0

      ) {


        // Synthesized answer: the important facts first, phrased
        // naturally — not a raw dump of every stored line.

        const summary =

          new MemorySynthesizer()

            .summarizeFacts(

              prompt,

              known,

            );



        if (

          summary

        ) {


          return summary;

        }



        return (

          `Here is what I know about you:\n\n${known

            .slice(0, 8)

            .map(

              pattern =>

                `- ${pattern.response}`,

            )

            .join("\n")}`

        );

      }




      return (

        "I don't have any established details about you yet — if you tell me your name, preferences or what you're working on, I'll remember it locally."

      );

    }




    return null;

  }





  /**
   * ==========================================================
   * Default response
   * ==========================================================
   */
  private defaultResponse(

    prompt:
      string,

  ):
    string {


    const message =

      prompt.trim();



    if (

      message.length === 0

    ) {


      return "I'm listening.";

    }



    return (

      `I don't have enough experience with "${message}" yet, but I'm learning.`

    );

  }





  /**
   * ==========================================================
   * Check knowledge
   * ==========================================================
   */
  public async hasKnowledge(

    prompt:
      string,

  ):
    Promise<boolean> {


    const matches =

      await this.memory.search(

        prompt,

      );



    return matches.length > 0;

  }





  /**
   * ==========================================================
   * Suggestions
   * ==========================================================
   */
  public async suggestions(

    prompt:
      string,

  ):
    Promise<string[]> {


    const matches =

      await this.memory.search(

        prompt,

      );



    return matches

      .slice(

        0,

        5,

      )

      .map(

        pattern =>

          pattern.response,

      );

  }

}