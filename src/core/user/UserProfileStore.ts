/**
 * ==========================================================
 * LÉLU
 * USER PROFILE STORE
 * ==========================================================
 */

import type UserProfile
  from "./UserProfile";


export default class UserProfileStore {


  private readonly database =
    "lelu-user";


  private readonly version =
    1;


  private readonly objectStore =
    "profile";



  private db?: IDBDatabase;





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

            this.database,

            this.version,

          );





        request.onupgradeneeded =

          () => {


            const db =

              request.result;





            if (

              !db.objectStoreNames.contains(

                this.objectStore,

              )

            ) {


              db.createObjectStore(

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





  /**
   * ==========================================================
   * Save profile
   * ==========================================================
   */
  async save(

    profile:
      UserProfile,

  ):
    Promise<void> {


    await this.initialize();





    return new Promise<void>(

      (

        resolve,

        reject,

      ) => {


        const transaction =

          this.db!.transaction(

            this.objectStore,

            "readwrite",

          );





        transaction

          .objectStore(

            this.objectStore,

          )

          .put(

            profile,

          );





        transaction.oncomplete =

          () => resolve();





        transaction.onerror =

          () => reject(

            transaction.error,

          );

      },

    );

  }





  /**
   * ==========================================================
   * Get profile
   * ==========================================================
   */
  async get():

    Promise<UserProfile | null> {


    await this.initialize();





    return new Promise(

      (

        resolve,

        reject,

      ) => {


        const request =

          this.db!

            .transaction(

              this.objectStore,

            )

            .objectStore(

              this.objectStore,

            )

            .get(

              "primary-user",

            );





        request.onsuccess =

          () => {


            resolve(

              request.result ??

              null,

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
   * Delete profile
   * ==========================================================
   */
  async delete():

    Promise<void> {


    await this.initialize();





    return new Promise<void>(

      (

        resolve,

        reject,

      ) => {


        const transaction =

          this.db!.transaction(

            this.objectStore,

            "readwrite",

          );





        transaction

          .objectStore(

            this.objectStore,

          )

          .delete(

            "primary-user",

          );





        transaction.oncomplete =

          () => resolve();





        transaction.onerror =

          () => reject(

            transaction.error,

          );

      },

    );

  }





  /**
   * ==========================================================
   * Clear profile database
   * ==========================================================
   */
  async clear():

    Promise<void> {


    await this.initialize();





    return new Promise<void>(

      (

        resolve,

        reject,

      ) => {


        const transaction =

          this.db!.transaction(

            this.objectStore,

            "readwrite",

          );





        transaction

          .objectStore(

            this.objectStore,

          )

          .clear();





        transaction.oncomplete =

          () => resolve();





        transaction.onerror =

          () => reject(

            transaction.error,

          );

      },

    );

  }

}