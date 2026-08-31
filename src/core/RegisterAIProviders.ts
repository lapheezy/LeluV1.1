/**
 * ==========================================================
 * LÉLU
 * REGISTER AI PROVIDERS
 * ==========================================================
 */

import AIProviderRegistry
  from "./AIProviderRegistry";

import AnthropicProvider
  from "../providers/AnthropicProvider";

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

import LocalInferenceProvider
  from "../providers/LocalInferenceProvider";


export default function registerAIProviders() {

  const registry =
    new AIProviderRegistry();


  // LOCAL-FIRST: the on-device slot is registered first (priority 0) so
  // the fallback chain tries local capability before any remote API.
  registry.register(
    new LocalInferenceProvider(),
  );


  // Claude is the primary remote provider (priority 1). Every provider
  // below shifted down one slot to make room; their RELATIVE order — the
  // documented Groq → OpenRouter → Cerebras → Mistral → Fireworks →
  // GitHub Models chain — is unchanged.
  registry.register(
    new AnthropicProvider(),
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


  return registry;

}