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

import InstagramProvider
  from "../providers/InstagramProvider";

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

import {
  NASAApodProvider,
  NASANeoProvider,
  NASADonkiProvider,
  NASAEonetProvider,
  NASAEpicProvider,
  NASAExoplanetProvider,
  NASAOsdrProvider,
  NASAInsightProvider,
} from "../providers/NASAScienceProviders";

import SpaceXProvider
  from "../providers/SpaceXProvider";

import NOAAProvider
  from "../providers/NOAAProvider";

import GeoapifyProvider
  from "../providers/GeoapifyProvider";

import {
  GNewsProvider,
  GuardianProvider,
  NewsDataProvider,
} from "../providers/NewsFallbackProviders";


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
    new InstagramProvider(),
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


  // NASA science family — key-less against DEMO_KEY, faster with NASA_API_KEY.
  registry.register(new NASAApodProvider());
  registry.register(new NASANeoProvider());
  registry.register(new NASADonkiProvider());
  registry.register(new NASAEonetProvider());
  registry.register(new NASAEpicProvider());
  registry.register(new NASAExoplanetProvider());
  registry.register(new NASAOsdrProvider());
  registry.register(new NASAInsightProvider());

  registry.register(new SpaceXProvider());

  // NOAA covers the US only and returns nothing elsewhere, so Open-Meteo
  // stays the global answer rather than being displaced by it.
  registry.register(new NOAAProvider());

  // Keyed sources: each declines itself when its key is absent, so an
  // unconfigured one costs nothing and never blocks the chain.
  registry.register(new GeoapifyProvider());
  registry.register(new GNewsProvider());
  registry.register(new GuardianProvider());
  registry.register(new NewsDataProvider());

  return registry;

}