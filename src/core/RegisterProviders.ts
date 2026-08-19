/**
 * ==========================================================
 * LÉLU
 * REGISTER PROVIDERS
 * ==========================================================
 */

import ProviderRegistry
  from "./ProviderRegistry";

import ArxivProvider
  from "../providers/ArxivProvider";

import CrossRefProvider
  from "../providers/CrossRefProvider";

import GDELTProvider
  from "../providers/GDELTProvider";

import GitHubProvider
  from "../providers/GitHubProvider";

import HackerNewsProvider
  from "../providers/HackerNews";

import NASAProvider
  from "../providers/NASAProvider";

import NewsProvider
  from "../providers/NewsProvider";

import NominatimProvider
  from "../providers/NominatimProvider";

import OpenAlexProvider
  from "../providers/OpenAlexProvider";

import OpenMeteoProvider
  from "../providers/OpenMeteoProvider";

import OpenStreetMapProvider
  from "../providers/OpenStreetMapProvider";

import { RSSProvider }
  from "../providers/RSSprovider";

import WikidataProvider
  from "../providers/WikidataProvider";

import WikimediaProvider
  from "../providers/WikimediaProvider";

import {
  WikipediaProvider,
} from "../providers/WikipediaProvider";

import YouTubeProvider
  from "../providers/YouTubeProvider";

export default function registerProviders():
  ProviderRegistry {

  const registry =
    new ProviderRegistry();

  registry.register(
    new ArxivProvider(),
  );

  registry.register(
    new CrossRefProvider(),
  );

  registry.register(
    new GDELTProvider(),
  );

  registry.register(
    new GitHubProvider(),
  );

  registry.register(
    new HackerNewsProvider(),
  );

  registry.register(
    new NASAProvider(),
  );

  registry.register(
    new NewsProvider(),
  );

  registry.register(
    new NominatimProvider(),
  );

  registry.register(
    new OpenAlexProvider(),
  );

  registry.register(
    new OpenMeteoProvider(),
  );

  registry.register(
    new OpenStreetMapProvider(),
  );

  registry.register(
    new RSSProvider(),
  );

  registry.register(
    new WikidataProvider(),
  );

  registry.register(
    new WikimediaProvider(),
  );

  registry.register(
    new WikipediaProvider(),
  );

  registry.register(
    new YouTubeProvider(),
  );

  return registry;

}