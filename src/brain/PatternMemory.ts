/**
 * ==========================================================
 * LÉLU
 * PATTERN MEMORY
 * ==========================================================
 */

import type ResponsePattern
  from "./ResponsePattern";

import IndexedDBStore
  from "../core/memory/IndexedDBStore";

import type {
  MemoryRecord,
} from "../core/memory/MemoryStore";


export default class PatternMemory {


  private readonly patterns =
    new Map<string, ResponsePattern>();


  private readonly store =
    new IndexedDBStore();


  private initialized =
    false;





  public async initialize():
    Promise<void> {


    if (
      this.initialized
    ) {

      return;

    }



    const memories =
      await this.store.all(

        "user",

      );



    for (

      const memory of memories

    ) {


      const metadata =
        memory.metadata ?? {};



      const pattern:
        ResponsePattern =
      {

        id:
          memory.id,


        category:

          metadata.category ??

          "general",


        prompt:

          metadata.prompt ??

          memory.title,


        response:

          memory.content,


        intent:

          metadata.intent ??

          "general",


        keywords:

          memory.tags ?? [],


        context:

          metadata.context ??

          {},


        importance:

          memory.importance ?? 0.3,


        confidence:

          metadata.confidence ??

          0.5,


        successfulUses:
          1,


        failedUses:
          0,


        createdAt:
          memory.created,


        updatedAt:
          memory.updated,

      };



      this.patterns.set(

        pattern.id,

        pattern,

      );

    }



    this.initialized =
      true;

  }





  public async add(

    pattern:
      ResponsePattern,

  ):
    Promise<void> {


    await this.initialize();



    this.patterns.set(

      pattern.id,

      pattern,

    );



    const memory:
      MemoryRecord =
    {


      id:
        pattern.id,


      space:
        "user",


      title:
        pattern.prompt,


      content:
        pattern.response,


      tags:
        pattern.keywords,


      importance:
        pattern.importance,


      created:
        pattern.createdAt,


      updated:
        pattern.updatedAt,


      metadata:
      {

        category:
          pattern.category,


        prompt:
          pattern.prompt,


        intent:
          pattern.intent,


        context:
          pattern.context,


        confidence:
          pattern.confidence,

      },

    };



    await this.store.save(

      memory,

    );

  }





  public get(

    id:
      string,

  ):
    ResponsePattern | undefined {


    return this.patterns.get(

      id,

    );

  }





  public async update(

    pattern:
      ResponsePattern,

  ):
    Promise<void> {


    await this.add(

      pattern,

    );

  }





  public async remove(

    id:
      string,

  ):
    Promise<boolean> {


    const removed =

      this.patterns.delete(

        id,

      );



    await this.store.delete(

      id,

    );



    return removed;

  }





  public async clear():
    Promise<void> {


    this.patterns.clear();



    await this.store.clear();

  }





  public getAll():
    ResponsePattern[] {


    return [

      ...this.patterns.values(),

    ];

  }





  public async search(

    prompt:
      string,

  ):
    Promise<ResponsePattern[]> {


    await this.initialize();



    const query =

      prompt

        .toLowerCase()

        .replace(

          /[^a-z0-9\s]/g,

          "",

        );



    const STOPWORDS =
      new Set([
        "the", "a", "an", "of", "in", "on", "at", "to", "for", "and",
        "or", "but", "not", "is", "are", "was", "were", "am", "be",
        "what", "whats", "who", "whos", "how", "why", "when", "where",
        "do", "does", "did", "can", "could", "would", "should", "will",
        "you", "your", "my", "me", "we", "our", "us", "i", "it", "its",
        "with", "about", "tell", "please", "latest", "current", "recent",
        "have", "has", "had", "been", "being", "this", "that", "these",
        "those", "from", "out", "all", "any", "some", "just", "know",
        "think", "like", "want", "need", "get", "make", "would", "could",
      ]);



    const words =

      query

        .split(/\s+/)

        .filter(

          word =>

            word.length > 2 &&

            !STOPWORDS.has(word),

        );





    const stem =

      (word: string):
        string => {


        const singular =

          word.endsWith("ies")
            ? `${word.slice(0, -3)}y`
            : word.endsWith("es")
              ? word.slice(0, -2)
              : word.endsWith("s")
                ? word.slice(0, -1)
                : word;



        return singular.length >= 4
          ? singular
          : word;

      };





    // Deterministic records (e.g. the LÉLU foundational identity,
    // flagged context.searchable === false) answer through explicit
    // intent handling, not fuzzy keyword search — excluding them here
    // keeps a shared word from hijacking unrelated queries or blocking
    // real user-memory consolidation.
    const searchable =

      this.getAll()

        .filter(

          pattern =>

            pattern.context?.searchable !== false,

        );



    const now =
      Date.now();



    return searchable

      .map(

        pattern => {


          let score = 0;


          let matched =
            false;



          const searchable =

            (

              pattern.prompt +

              " " +

              pattern.response +

              " " +

              pattern.keywords.join(" ")

            )

            .toLowerCase();





          for (

            const word of words

          ) {


            if (

              searchable.includes(word)

            ) {

              score += 5;

              matched =
                true;

            }

            else {


              const stemmed =

                stem(

                  word,

                );



              if (

                stemmed !== word &&

                searchable.includes(stemmed)

              ) {

                score += 4;

                matched =
                  true;

              }

            }

          }





          // Adjacent word pairs (phrases) are stronger evidence
          // than single words.

          for (

            let i = 0;

            i < words.length - 1;

            i += 1

          ) {


            const phrase =
              `${words[i]} ${words[i + 1]}`;



            if (

              searchable.includes(phrase)

            ) {

              score += 4;

              matched =
                true;

            }

          }





          if (

            searchable.includes(query)

          ) {

            score += 20;

            matched =
              true;

          }





          if (

            pattern.category === "conversation"

          ) {

            score -= 2;

          }





          // Strong, important, recently-touched memories surface
          // ahead of stale or weak ones.

          score +=

            pattern.confidence +

            pattern.importance * 3;



          if (

            pattern.memoryType === "system"

          ) {

            score -= 1;

          }



          const age =
            now -
            (pattern.updatedAt ?? pattern.createdAt ?? 0);



          if (

            age < 7 * 24 * 3600 * 1000

          ) {

            score += 2;

          }





          return {

            pattern,

            score,

            matched,

          };

        },

      )

      .filter(

        item =>

          item.matched &&

          item.score >= 5,

      )

      .sort(

        (

          a,

          b,

        ) =>

          b.score -

          a.score,

      )

      .map(

        item =>

          item.pattern,

      );

  }

}