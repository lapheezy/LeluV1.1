/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS NAVIGATOR
 *
 * Controls movement targets inside the
 * living Genesis world.
 *
 * Used for:
 * - camera focus
 * - workspace travel
 * - agent tracking
 * - action tracking
 * ==========================================================
 */


export interface GenesisTarget {


  id:

    string;


  type:

    | "workspace"

    | "agent"

    | "action"

    | "core"

    | "system";


  name:

    string;


  position:

  {

    x:

      number;


    y:

      number;


    z:

      number;

  };

}





export interface GenesisNavigationState {


  target:

    GenesisTarget | null;


  moving:

    boolean;

}





export default class GenesisNavigator {


  private current:

    GenesisNavigationState =

  {

    target:

      null,


    moving:

      false,

  };





  private listeners:

    Set<

      (

        state:

          GenesisNavigationState,

      ) => void

    > =

      new Set();





  public navigate(

    target:

      GenesisTarget,

  ) {


    this.current =

    {

      target,


      moving:

        true,

    };


    this.emit();

  }





  public complete() {


    this.current =

    {

      ...this.current,


      moving:

        false,

    };


    this.emit();

  }





  public state():

    GenesisNavigationState {


    return {

      ...this.current,

    };

  }





  public subscribe(

    listener:

      (

        state:

          GenesisNavigationState,

      ) => void,

  ):


    () => void {


    this.listeners.add(

      listener,

    );



    return () => {


      this.listeners.delete(

        listener,

      );

    };

  }





  public clear() {


    this.current =

    {

      target:

        null,


      moving:

        false,

    };


    this.emit();

  }





  private emit() {


    const state =

      this.state();





    for (

      const listener of this.listeners

    ) {


      listener(

        state,

      );

    }

  }

}