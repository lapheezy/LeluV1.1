/**
 * ==========================================================
 * LÉLU
 * WORKSPACE MANAGER
 * ==========================================================
 */


export interface Workspace {


  id:
    string;


  name:
    string;


  purpose:
    string;


  items:
    string[];


  createdAt:
    number;

}





export default class WorkspaceManager {


  private readonly workspaces =

    new Map<string, Workspace>();





  public create(

    id:
      string,

    name:
      string,

    purpose:
      string,

  ):
    Workspace {


    const workspace:

      Workspace =

    {

      id,

      name,

      purpose,

      items: [],

      createdAt:

        Date.now(),

    };



    this.workspaces.set(

      id,

      workspace,

    );



    return workspace;

  }





  public add(

    id:
      string,

    item:
      string,

  ):
    void {


    const workspace =

      this.workspaces.get(

        id,

      );



    if (

      workspace

    ) {


      workspace.items.push(

        item,

      );

    }

  }





  public all():

    Workspace[] {


    return [

      ...this.workspaces.values(),

    ];

  }

}