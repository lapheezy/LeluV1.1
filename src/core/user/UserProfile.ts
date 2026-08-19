/**
 * ==========================================================
 * LÉLU
 * USER PROFILE
 * ==========================================================
 */

export default interface UserProfile {


  id:
    string;



  /**
   * Core identity
   */
  name:
    string;



  /**
   * Stable preferences
   */
  preferences:
  {

    communicationStyle?:
      string;


    favoriteColors:
      string[];


    interests:
      string[];


    learningStyle?:
      string;


    responsePreferences?:
      string[];

  };



  /**
   * Long term direction
   */
  goals:
    string[];



  /**
   * Skills and abilities
   */
  skills:
    string[];



  /**
   * Active creations
   */
  projects:
    string[];



  /**
   * Important people/context
   */
  relationships:
    string[];



  /**
   * Personal values
   */
  values:
    string[];



  /**
   * Current focus
   */
  currentFocus:
    string[];



  /**
   * Life experiences
   */
  experiences:
    string[];



  createdAt:
    number;



  updatedAt:
    number;

}