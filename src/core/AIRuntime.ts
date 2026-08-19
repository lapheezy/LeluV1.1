/**
 * ==========================================================
 * LÉLU
 * AI RUNTIME
 * ==========================================================
 */

import AICore
  from "./AICore";

import AIRouter
  from "./AIRouter";

import ExecutionLogger
  from "./ExecutionLogger";

import registerProviders
  from "./RegisterProviders";

import registerAIProviders
  from "./RegisterAIProviders";

import Brain
  from "../brain/Brain";

import BrainResolver
  from "./router/BrainResolver";

import ResearchResolver
  from "./router/ResearchResolver";

import ProviderResolver
  from "./router/ProviderResolver";

import AIProviderRegistry
  from "./AIProviderRegistry";

import type AIProvider from "../providers/AIProvider";

import type {
  AIRequest,
  AIResponse,
} from "../providers/AIProvider";

import type RouterContext
  from "./router/RouterContext";





export default class AIRuntime {


  public readonly core:
    AICore;



  public readonly router:
    AIRouter;



  public readonly brain:
    Brain;



  private readonly logger =
    new ExecutionLogger();



  private readonly knowledge =
    registerProviders();



  private readonly providers =
    registerAIProviders();



  private initialized =
    false;





  constructor() {


    this.brain =

      new Brain();



    this.core =

      new AICore(

        this.knowledge,

        this.providers,

      );



    this.router =

      new AIRouter(

        new BrainResolver(),

        new ResearchResolver(),

        new ProviderResolver(),

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
   * Initialize runtime
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

      "AIRuntime",

      "Initializing",

    );





    await this.core.initialize();



    await this.brain.initialize();





    this.initialized =

      true;





    this.logger.info(

      "AIRuntime",

      "Ready",

    );

  }





  /**
   * ==========================================================
   * Process request
   * ==========================================================
   */
  public async process(

    request:
      AIRequest,

  ):
    Promise<AIResponse> {


    if (

      !this.initialized

    ) {


      await this.initialize();

    }





    const context:

      RouterContext =

    {


      request,



      started:

        Date.now(),



      brain:

        this.brain,



      knowledgeProviders:

        this.knowledge,



      aiProviders:

        this.providers,



      logger:

        this.logger,

    };





    return await this.router.route(

      context,

    );

  }





  /**
   * ==========================================================
   * Cognition Runtime Access
   *
   * Exposes live learning state
   * to Genesis and UI layers
   * ==========================================================
   */
  public cognition():

    ReturnType<Brain["getCognitionRuntime"]> {


    return this.brain.getCognitionRuntime();

  }




  /**
   * ==========================================================
   * Provider Snapshot Access
   *
   * Read-only view of every registered AI provider and every
   * registered knowledge/research provider, for the Providers
   * panel in Genesis. Returns plain data, never the live
   * provider instances — the UI layer should never be able to
   * reach into a provider directly.
   * ==========================================================
   */
  public aiProviderList(): {
    name: string;
    priority: number;
    enabled: boolean;
    requiresApiKey: boolean;
    timeout: number;
  }[] {

    return this.providers.all().map((provider) => ({
      name: provider.name,
      priority: provider.priority,
      enabled: provider.enabled,
      requiresApiKey: provider.requiresApiKey,
      timeout: provider.timeout,
    }));
  }

  public async aiProviderHealthList(): Promise<{
    name: string;
    priority: number;
    enabled: boolean;
    requiresApiKey: boolean;
    timeout: number;
    health: Awaited<ReturnType<AIProvider["health"]>>;
  }[]> {
    return await Promise.all(
      this.providers.all().map(async (provider) => ({
        name: provider.name,
        priority: provider.priority,
        enabled: provider.enabled,
        requiresApiKey: provider.requiresApiKey,
        timeout: provider.timeout,
        health: await provider.health(),
      })),
    );
  }

  /**
   * Live runtime state of the provider registry — which provider
   * actually generated the last response, each provider's last
   * success/failure, cooldown status and usage. This is the single
   * source of truth the API Status tab renders; it reflects what
   * the fallback chain really did, not a frontend guess.
   */
  public aiProviderRuntimeStatus(): {
    activeProvider: string | null;
    providers: ReturnType<AIProviderRegistry["statusSnapshot"]>;
  } {
    return {
      activeProvider: this.providers.getActiveProvider(),
      providers: this.providers.statusSnapshot(),
    };
  }

  public knowledgeProviderList(): {
    name: string;
    category: string;
    priority: number;
    enabled: boolean;
    requiresApiKey: boolean;
    capabilities: readonly string[];
  }[] {

    return this.knowledge.all().map((provider) => ({
      name: provider.name,
      category: provider.category,
      priority: provider.priority,
      enabled: provider.enabled,
      requiresApiKey: provider.requiresApiKey,
      capabilities: provider.capabilities,
    }));
  }




  /**
   * ==========================================================
   * Execution Log Access
   *
   * Read-only view of the pipeline's execution trace, for the
   * Logs panel — what stage ran, whether it succeeded, and how
   * long it took.
   * ==========================================================
   */
  public executionLogs() {
    return this.logger.all();
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





    await this.core.shutdown();





    this.initialized =

      false;





    this.logger.info(

      "AIRuntime",

      "Shutdown",

    );

  }

}