/**
 * ==========================================================
 * LÉLU
 * INDEXEDDB STORE
 * ==========================================================
 */

import type MemoryStore
  from "./MemoryStore";

import type {
  MemoryRecord,
  MemorySpace,
} from "./MemoryStore";


export default class IndexedDBStore
  implements MemoryStore {


  private db?: IDBDatabase;


  private readonly databaseName =
    "lelu-memory";


  private readonly databaseVersion =
    1;


  private readonly objectStore =
    "memories";





  /**
   * ==========================================================
   * Initialize database
   * ==========================================================
   */
  async initialize():
    Promise<void> {


    if (
      this.db
    ) {

      return;

    }



    await new Promise<void>(

      (

        resolve,

        reject,

      ) => {


        const request =
          indexedDB.open(

            this.databaseName,

            this.databaseVersion,

          );



        request.onupgradeneeded =
          () => {


            const database =
              request.result;



            if (

              !database.objectStoreNames.contains(

                this.objectStore,

              )

            ) {


              database.createObjectStore(

                this.objectStore,

                {

                  keyPath:
                    "id",

                },

              );

            }

          };



        request.onsuccess =
          () => {


            this.db =
              request.result;



            this.db.onversionchange =
              () => {


                this.db?.close();


                this.db =
                  undefined;


              };



            resolve();

          };



        request.onerror =
          () => {


            reject(

              request.error,

            );

          };

      },

    );

  }





  private async getDatabase():
    Promise<IDBDatabase> {


    await this.initialize();


    if (
      !this.db
    ) {

      throw new Error(

        "IndexedDB unavailable",

      );

    }


    return this.db;

  }





  /**
   * ==========================================================
   * Save memory
   * ==========================================================
   */
  async save(

    memory:
      MemoryRecord,

  ):
    Promise<void> {


    const database =
      await this.getDatabase();



    await new Promise<void>(

      (

        resolve,

        reject,

      ) => {


        const transaction =
          database.transaction(

            this.objectStore,

            "readwrite",

          );



        transaction
          .objectStore(

            this.objectStore,

          )
          .put(

            structuredClone(memory),

          );



        transaction.oncomplete =
          () =>
            resolve();



        transaction.onerror =
          () =>
            reject(

              transaction.error,

            );

      },

    );

  }





  async update(

    memory:
      MemoryRecord,

  ):
    Promise<void> {


    await this.save(

      memory,

    );

  }





  /**
   * ==========================================================
   * Delete
   * ==========================================================
   */
  async delete(

    id:
      string,

  ):
    Promise<void> {


    const database =
      await this.getDatabase();



    const transaction =
      database.transaction(

        this.objectStore,

        "readwrite",

      );



    transaction
      .objectStore(

        this.objectStore,

      )
      .delete(

        id,

      );



    await this.wait(

      transaction,

    );

  }





  async clear():
    Promise<void> {


    const database =
      await this.getDatabase();



    const transaction =
      database.transaction(

        this.objectStore,

        "readwrite",

      );



    transaction
      .objectStore(

        this.objectStore,

      )
      .clear();



    await this.wait(

      transaction,

    );

  }





  /**
   * ==========================================================
   * Get one
   * ==========================================================
   */
  async get(

    id:
      string,

  ):
    Promise<MemoryRecord | null> {


    const database =
      await this.getDatabase();



    return new Promise(

      (

        resolve,

        reject,

      ) => {


        const request =
          database

            .transaction(

              this.objectStore,

            )

            .objectStore(

              this.objectStore,

            )

            .get(

              id,

            );



        request.onsuccess =
          () => {


            resolve(

              request.result ?? null,

            );

          };



        request.onerror =
          () => {


            reject(

              request.error,

            );

          };

      },

    );

  }





  /**
   * ==========================================================
   * Get all
   * ==========================================================
   */
  async all(

    space?:
      MemorySpace,

  ):
    Promise<MemoryRecord[]> {


    const database =
      await this.getDatabase();



    return new Promise(

      (

        resolve,

        reject,

      ) => {


        const request =
          database

            .transaction(

              this.objectStore,

            )

            .objectStore(

              this.objectStore,

            )

            .getAll();



        request.onsuccess =
          () => {


            const records =
              request.result as MemoryRecord[];



            resolve(

              space

                ? records.filter(

                    memory =>
                      memory.space === space,

                  )

                : records,

            );

          };



        request.onerror =
          () => {


            reject(

              request.error,

            );

          };

      },

    );

  }





  /**
   * ==========================================================
   * Search
   * ==========================================================
   */
  async search(

    query:
      string,


    space?:
      MemorySpace,

  ):
    Promise<MemoryRecord[]> {


    const memories =
      await this.all(

        space,

      );



    const text =
      query.toLowerCase();



    return memories

      .map(

        memory => {


          let score =
            0;



          const searchable =

            [

              memory.title,

              memory.content,

              ...memory.tags,

              JSON.stringify(

                memory.metadata ?? {},

              ),

            ]

            .join(" ")

            .toLowerCase();



          if (

            searchable.includes(text)

          ) {

            score += 10;

          }



          if (

            memory.metadata?.category

          ) {

            score += 2;

          }



          score +=
            memory.importance;



          return {

            memory,

            score,

          };

        },

      )

      .filter(

        item =>
          item.score > 0,

      )

      .sort(

        (

          a,

          b,

        ) =>

          b.score -

          a.score,

      )

      .slice(

        0,

        20,

      )

      .map(

        item =>
          item.memory,

      );

  }





  async recent(

    limit = 20,


    space?:
      MemorySpace,

  ):
    Promise<MemoryRecord[]> {


    const memories =
      await this.all(

        space,

      );



    return memories

      .sort(

        (

          a,

          b,

        ) =>

          b.updated -

          a.updated,

      )

      .slice(

        0,

        limit,

      );

  }





  private wait(

    transaction:
      IDBTransaction,

  ):
    Promise<void> {


    return new Promise(

      (

        resolve,

        reject,

      ) => {


        transaction.oncomplete =
          () =>
            resolve();



        transaction.onerror =
          () =>
            reject(

              transaction.error,

            );

      },

    );

  }

}