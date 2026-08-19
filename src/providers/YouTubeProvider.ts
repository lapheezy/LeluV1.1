/**
 * ==========================================================
 * LÉLU
 * YOUTUBE PROVIDER
 * ==========================================================
 */

import config
  from "../core/ProviderConfig";

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class YouTubeProvider
  implements Provider {

  readonly name =
    "youtube";

  readonly category =
    "video";

  readonly priority =
    90;

  readonly enabled =
    true;

  readonly requiresApiKey =
    true;

  readonly timeout =
    15000;

  readonly cooldown =
    1000;

  readonly maxConcurrent =
    2;

  readonly capabilities = [

    "video",
    "tutorial",
    "education",
    "learning",
    "engineering",
    "science",
    "technology",
    "music",
    "news",

  ] as const;

  private readonly endpoint =
    "https://www.googleapis.com/youtube/v3/search";

  canSearch(
    query: string,
  ): boolean {

    return query.trim().length > 0;

  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const apiKey =
      config.youtubeApiKey;

    if (!apiKey) {

      throw new Error(
        "YouTube API key missing.",
      );

    }

    const url =
      new URL(
        this.endpoint,
      );

    url.searchParams.set(
      "part",
      "snippet",
    );

    url.searchParams.set(
      "q",
      query,
    );

    url.searchParams.set(
      "type",
      "video",
    );

    url.searchParams.set(
      "maxResults",
      "10",
    );

    url.searchParams.set(
      "key",
      apiKey,
    );

    const response =
      await fetch(
        url.toString(),
      );

    if (!response.ok) {

      throw new Error(
        `YouTube ${response.status}`,
      );

    }

    const json =
      await response.json();

    return (json.items ?? []).map(
      (video: any): KnowledgeResult => ({

        id:
          video.id.videoId,

        title:
          video.snippet.title,

        content:
          video.snippet.description ??
          "",

        url:
          `https://www.youtube.com/watch?v=${video.id.videoId}`,

        source:
          "YouTube",

        confidence:
          0.96,

        timestamp:
          video.snippet.publishedAt,

        metadata: {

          channel:
            video.snippet.channelTitle,

          thumbnail:
            video.snippet.thumbnails
              ?.high
              ?.url,

          videoId:
            video.id.videoId,

        },

      }),

    );

  }

}