/**
 * ==========================================================
 * LÉLU
 * CONVERSATION ENGINE
 *
 * Maintains active awareness
 * ==========================================================
 */

import Brain
  from "./Brain";

import type ResponsePattern
  from "./ResponsePattern";





export interface ConversationState {


  lastMessage:
    string;


  lastTopic:
    string;


  activeMemories:
    ResponsePattern[];


  recentMessages:
    string[];


  messageCount:
    number;


  lastInteraction:
    number;

}





export default class ConversationEngine {


  private state:

    ConversationState =

  {


    lastMessage:

      "",



    lastTopic:

      "",



    activeMemories:

      [],



    recentMessages:

      [],



    messageCount:

      0,



    lastInteraction:

      0,

  };





  constructor(

    private readonly brain:

      Brain,

  ) {}





  /**
   * ==========================================================
   * Update awareness
   * ==========================================================
   */
  public async update(

    message:
      string,

  ):
    Promise<void> {


    const memories =

      await this.brain.recall(

        message,

      );





    this.state =

    {


      lastMessage:

        message,



      lastTopic:

        this.detectTopic(

          message,

        ),



      activeMemories:

        memories.slice(

          0,

          10,

        ),



      recentMessages:

      [

        ...this.state.recentMessages,

        message,

      ]

      .slice(

        -20,

      ),



      messageCount:

        this.state.messageCount + 1,



      lastInteraction:

        Date.now(),

    };

  }





  /**
   * ==========================================================
   * Topic detection
   * ==========================================================
   */
  private detectTopic(

    message:
      string,

  ):
    string {


    const words =

      message

        .replace(

          /[^a-zA-Z0-9\s]/g,

          "",

        )

        .split(

          /\s+/,

        )

        .filter(

          word =>

            word.length > 4,

        );





    return (

      words[0] ??

      "general"

    );

  }





  /**
   * ==========================================================
   * Conversation starters
   * ==========================================================
   */
  public async starters():

    Promise<string[]> {


    const reflection =

      await this.brain.reflect();





    if (

      reflection.memories.length === 0

    ) {


      return [

        "What would you like to explore?",

        "What are you building?",

      ];

    }





    return [

      "I remember what we have been building together.",

      "I can help organize the next step.",

      "Would you like to continue one of your active projects?",

    ];

  }





  /**
   * ==========================================================
   * Current context
   * ==========================================================
   */
  public context():

    ConversationState {


    return {


      ...this.state,



      activeMemories:

      [

        ...this.state.activeMemories,

      ],



      recentMessages:

      [

        ...this.state.recentMessages,

      ],

    };

  }





  /**
   * ==========================================================
   * Clear conversation
   * ==========================================================
   */
  public clear():

    void {


    this.state =

    {


      lastMessage:

        "",



      lastTopic:

        "",



      activeMemories:

        [],



      recentMessages:

        [],



      messageCount:

        0,



      lastInteraction:

        0,

    };

  }

}