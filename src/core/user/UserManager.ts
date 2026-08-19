/**
 * ==========================================================
 * LÉLU
 * USER MANAGER
 * ==========================================================
 */

import UserProfileStore
  from "./UserProfileStore";

import type UserProfile
  from "./UserProfile";



type UserProfileUpdate =

  Partial<UserProfile>

  &

  {

    preferences?:
      Partial<UserProfile["preferences"]>;

  };





class UserManager {


  private readonly store =
    new UserProfileStore();



  private profile:
    UserProfile | null =
      null;





  /**
   * ==========================================================
   * Initialize
   * ==========================================================
   */
  public async initialize():

    Promise<void> {


    this.profile =

      await this.store.get();





    if (

      this.profile

    ) {


      return;

    }





    const now =

      Date.now();





    this.profile =

    {

      id:

        "primary-user",



      name:

        "",



      preferences:

      {

        communicationStyle:

          "",


        favoriteColors:

          [],


        interests:

          [],


        learningStyle:

          "",


        responsePreferences:

          [],

      },



      goals:

        [],



      skills:

        [],



      projects:

        [],



      relationships:

        [],



      values:

        [],



      currentFocus:

        [],



      experiences:

        [],



      createdAt:

        now,



      updatedAt:

        now,

    };





    await this.store.save(

      this.profile,

    );

  }





  /**
   * ==========================================================
   * Get Profile
   * ==========================================================
   */
  public get():

    UserProfile | null {


    return this.profile;

  }





  /**
   * ==========================================================
   * Update Profile
   * ==========================================================
   */
  public async update(

    updates:
      UserProfileUpdate,

  ):
    Promise<void> {


    if (

      !this.profile

    ) {


      await this.initialize();

    }





    if (

      !this.profile

    ) {


      return;

    }





    this.profile =

    {

      ...this.profile,


      ...updates,



      preferences:

      {

        ...this.profile.preferences,


        ...(updates.preferences ?? {}),

      },



      updatedAt:

        Date.now(),

    };





    await this.store.save(

      this.profile,

    );

  }





  /**
   * ==========================================================
   * Learn From Memory
   * ==========================================================
   */
  public async learn(

    category:
      string,


    value:
      string,

  ):
    Promise<void> {


    if (

      !this.profile

    ) {


      await this.initialize();

    }





    switch(category) {


      case "identity":


        await this.setName(

          value

            .replace(

              /call me/i,

              "",

            )

            .trim(),

        );


        break;





      case "preference":


        await this.learnPreference(

          value,

        );


        break;





      case "goal":


        await this.addUnique(

          "goals",

          value,

        );


        break;





      case "skill":


        await this.addUnique(

          "skills",

          value,

        );


        break;





      case "project":


        await this.addUnique(

          "projects",

          value,

        );


        break;

    }

  }





  /**
   * ==========================================================
   * Learn Preferences
   * ==========================================================
   */
  private async learnPreference(

    value:
      string,

  ):
    Promise<void> {


    if (

      !this.profile

    ) {


      return;

    }





    const colors =

      value.match(

        /blue|red|green|black|white|purple|orange|yellow/gi,

      ) ?? [];





    const interests =

      this.profile.preferences.interests;





    const favoriteColors =

      this.profile.preferences.favoriteColors;





    await this.update({

      preferences:

      {

        favoriteColors:

          [

            ...favoriteColors,

            ...colors.map(

              color =>

                color.toLowerCase(),

            ),

          ],



        interests:

          /like|love|prefer/i.test(value)

            ? [

                ...interests,

                value,

              ]

            : interests,

      },

    });

  }





  /**
   * ==========================================================
   * Add Unique
   * ==========================================================
   */
  private async addUnique(

    field:

      "goals"

      | "skills"

      | "projects",


    value:
      string,

  ):
    Promise<void> {


    if (

      !this.profile

    ) {


      return;

    }





    const current =

      this.profile[field];





    if (

      current.includes(value)

    ) {


      return;

    }





    await this.update({

      [field]:

      [

        ...current,

        value,

      ],

    });

  }





  /**
   * ==========================================================
   * AI Context
   * ==========================================================
   */
  public context():

    string {


    if (

      !this.profile

    ) {


      return "";

    }





    return `

## User Profile

Name:
${this.profile.name || "Unknown"}

Favorite Colors:
${this.profile.preferences.favoriteColors.join(", ") || "Unknown"}

Interests:
${this.profile.preferences.interests.join(", ") || "None"}

Goals:
${this.profile.goals.join(", ") || "None"}

Skills:
${this.profile.skills.join(", ") || "None"}

Projects:
${this.profile.projects.join(", ") || "None"}

`;

  }





  /**
   * ==========================================================
   * Set Name
   * ==========================================================
   */
  public async setName(

    name:
      string,

  ):
    Promise<void> {


    await this.update({

      name,

    });

  }





  /**
   * ==========================================================
   * Reset
   * ==========================================================
   */
  public async reset():

    Promise<void> {


    await this.store.clear();



    this.profile =

      null;

  }

}


export default UserManager;