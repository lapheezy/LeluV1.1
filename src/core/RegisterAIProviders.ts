/**
 * ==========================================================
 * LÉLU
 * REGISTER AI PROVIDERS
 * ==========================================================
 */

import AIProviderRegistry
  from "./AIProviderRegistry";

import { primeBrokerStatus }
  from "./model/BrokerTransport";

import OpenRouterProvider
  from "../providers/OpenRouterProvider";

import GroqProvider
  from "../providers/GroqProvider";

import GitHubModelsProvider
  from "../providers/GitHubModelsProvider";

import CerebrasProvider
  from "../providers/CerebrasProvider";

import MistralProvider
  from "../providers/MistralProvider";

import FireworksProvider
  from "../providers/FireworksProvider";

import AnthropicProvider
  from "../providers/AnthropicProvider";

import GeminiProvider
  from "../providers/GeminiProvider";

import LocalInferenceProvider
  from "../providers/LocalInferenceProvider";


export default function registerAIProviders() {

  // Ask the server once, up front, which providers it can reach. Provider
  // availability is the SERVER's answer now (the browser holds no key to form
  // its own), and warming the cache here keeps the first turn from paying for
  // the lookup. Fire-and-forget: until it lands providerConfigured() lets
  // providers into the chain and a real attempt decides, so a cold start never
  // silently drops a working provider.
  void primeBrokerStatus();


  const registry =
    new AIProviderRegistry();


  // LOCAL-FIRST: the on-device slot is registered first (priority 0) so
  // the fallback chain tries local capability before any remote API.
  registry.register(
    new LocalInferenceProvider(),
  );


  registry.register(
    new OpenRouterProvider(),
  );


  registry.register(
    new GroqProvider(),
  );

  registry.register(
    new CerebrasProvider(),
  );

  registry.register(
    new MistralProvider(),
  );

  registry.register(
    new FireworksProvider(),
  );

  registry.register(
    new GitHubModelsProvider(),
  );

  // Appended last (priority 7) so the established fallback order is
  // untouched — nothing that resolved before resolves differently now.
  registry.register(
    new AnthropicProvider(),
  );

  // Priority 8 — appended after Anthropic, so the chain ahead of it
  // is untouched.
  registry.register(
    new GeminiProvider(),
  );


  return registry;

}