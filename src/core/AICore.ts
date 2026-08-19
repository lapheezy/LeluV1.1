/**
 * ==========================================================
 * LÉLU
 * AI CORE
 * ==========================================================
 */

import ProviderRegistry
  from "./ProviderRegistry";

import AIProviderRegistry
  from "./AIProviderRegistry";

import ExecutionLogger
  from "./ExecutionLogger";


export default class AICore {


  private readonly logger =
    new ExecutionLogger();


  private initialized =
    false;



  constructor(

    private readonly knowledgeProviders:
      ProviderRegistry,


    private readonly aiProviders:
      AIProviderRegistry,

  ) {}



  /**
   * ==========================================================
   * Initialize core systems
   * ==========================================================
   */
  public async initialize():
    Promise<void> {


    if (
      this.initialized
    ) {

      return;

    }


    this.logger.info(
      "AICore",
      "Initializing",
    );



    await this.aiProviders.initialize();



    this.initialized =
      true;



    this.logger.info(
      "AICore",
      "Ready",
    );

  }



  /**
   * ==========================================================
   * Ready status
   * ==========================================================
   */
  public isReady():
    boolean {

    return this.initialized;

  }



  /**
   * ==========================================================
   * Knowledge providers
   * ==========================================================
   */
  public getKnowledgeProviders():
    ProviderRegistry {

    return this.knowledgeProviders;

  }



  /**
   * ==========================================================
   * AI providers
   * ==========================================================
   */
  public getAIProviders():
    AIProviderRegistry {

    return this.aiProviders;

  }



  /**
   * ==========================================================
   * Logger access
   * ==========================================================
   */
  public getLogger():
    ExecutionLogger {

    return this.logger;

  }



  /**
   * ==========================================================
   * Shutdown
   * ==========================================================
   */
  public async shutdown():
    Promise<void> {


    if (
      !this.initialized
    ) {

      return;

    }


    this.logger.info(
      "AICore",
      "Shutdown",
    );



    await this.aiProviders.shutdown();



    this.initialized =
      false;


  }


}