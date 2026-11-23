/**
 * ==========================================================
 * LÉLU
 * USER PROFILE STORE
 * ==========================================================
 */

import type UserProfile
  from "./UserProfile";

import KvStore from "../storage/KvStore";


export default class UserProfileStore {


  private readonly database =
    "lelu-user";


  private readonly version =
    1;


  private readonly objectStore =
    "profile";



  private db?: IDBDatabase;

  /**
   * IndexedDB is the preferred local backend, but it is not always
   * available (private windows, embedded frames, storage-denied
   * contexts). The profile is local identity, not a Supabase concern, so
   * an unavailable database must fall back to the same KvStore every
   * other local store uses instead of taking identity offline.
   */
  private readonly fallback = KvStore.getInstance();
  private fallbackActive = false;
  private static readonly FALLBACK_KEY = "user.profile.v1";





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

    if (this.fallbackActive) return;

    if (typeof indexedDB === "undefined") {
      this.fallbackActive = true;
      return;
    }





    await new Promise<void>(

      (

        resolve,

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

            // A local database that cannot open is an unavailable backend,
            // not a fatal identity failure. Use KvStore and say so once.
            console.warn("[Lélu] IndexedDB profile store unavailable; using KvStore");
            this.fallbackActive = true;
            resolve();

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

    if (this.fallbackActive) {
      this.fallback.set(UserProfileStore.FALLBACK_KEY, profile);
      return;
    }





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

    if (this.fallbackActive) {
      return this.fallback.get<UserProfile>(UserProfileStore.FALLBACK_KEY);
    }





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

    if (this.fallbackActive) {
      this.fallback.remove(UserProfileStore.FALLBACK_KEY);
      return;
    }





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

    if (this.fallbackActive) {
      this.fallback.remove(UserProfileStore.FALLBACK_KEY);
      return;
    }





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