/**
 * ==========================================================
 * LÉLU
 * AI ROUTER
 * ==========================================================
 */

import type {
  AIResponse,
} from "../providers/AIProvider";

import type RouterContext
  from "./router/RouterContext";

import BrainResolver
  from "./router/BrainResolver";

import PlanningResolver
  from "./router/PlanningResolver";

import ReasoningResolver
  from "./router/ReasoningResolver";

import ResearchResolver
  from "./router/ResearchResolver";

import BrowserResolver
  from "./router/BrowserResolver";

import WorkspaceResolver
  from "./router/WorkspaceResolver";

import ProviderResolver
  from "./router/ProviderResolver";

import EngineeringResolver
  from "./router/EngineeringResolver";

import ToolResolver
  from "./router/ToolResolver";

import ResponseBuilder
  from "./router/ResponseBuilder";

export default class AIRouter {

  constructor(

    private readonly brain:
      BrainResolver,

    private readonly research:
      ResearchResolver,

    private readonly providers:
      ProviderResolver,

    private readonly browser =
      new BrowserResolver(),

    private readonly workspace =
      new WorkspaceResolver(),

    private readonly planning =
      new PlanningResolver(),

    private readonly reasoning =
      new ReasoningResolver(),

    private readonly engineering =
      new EngineeringResolver(),

    private readonly tools =
      new ToolResolver(),

    private readonly responses =
      new ResponseBuilder(),

  ) {}

  /**
   * Route an AI request.
   */
  public async route(
    context:
      RouterContext,
  ): Promise<AIResponse> {

    const brain =
      await this.brain.execute(
        context,
      );

    if (

      brain.handled &&

      brain.response

    ) {

      return brain.response;

    }

    await this.planning.execute(
      context,
    );

    await this.reasoning.execute(
      context,
    );

    // Device/native capability actions run through the REAL
    // capability registry (ToolResolver) — the controlled bridge
    // between cognition and the device. Unhandled results still
    // flow to the provider chain so the response stays
    // conversational.
    const tools =
      await this.tools.execute(
        context,
      );

    if (

      tools.handled &&

      tools.response

    ) {

      return this.attachThinking(

        context,

        tools.response,

      );

    }

    const engineering =
      await this.engineering.execute(
        context,
      );

    if (

      engineering.handled &&

      engineering.response

    ) {

      return this.attachThinking(

        context,

        engineering.response,

      );

    }

    const research =
      await this.research.execute(
        context,
      );

    if (

      research.handled

    ) {

      return this.attachThinking(

        context,

        this.responses.fromResearch(

          research.results,

          context.started,

        ),

      );

    }

    const browser =
      await this.browser.execute(
        context,
      );

    if (

      browser.handled &&

      browser.response

    ) {

      return this.attachThinking(

        context,

        browser.response,

      );

    }

    const workspace =
      await this.workspace.execute(
        context,
      );

    if (

      workspace.handled &&

      workspace.response

    ) {

      return this.attachThinking(

        context,

        workspace.response,

      );

    }

    const provider =
      await this.providers.execute(
        context,
      );

    if (

      provider.handled &&

      provider.response

    ) {

      return this.attachThinking(

        context,

        provider.response,

      );

    }

    return this.attachThinking(

      context,

      this.responses.offline(

        context.started,

      ),

    );

  }

  /**
   * Surface the Planning/Reasoning
   * stage output on the outgoing
   * response, so the UI and the
   * Reflection stage can see *why*
   * Lélu answered the way it did —
   * without changing any provider's
   * own response contract.
   */
  private attachThinking(

    context:
      RouterContext,

    response:
      AIResponse,

  ):
    AIResponse {


    if (

      !context.reasoning &&

      !context.plan

    ) {

      return response;

    }


    return {

      ...response,

      metadata: {

        ...response.metadata,

        reasoning:
          context.reasoning,

        plan:
          context.plan,

      },

    };

  }

}