/**
 * ==========================================================
 * LÉLU
 * SPACEX PROVIDER (r/SpaceX community API v5)
 *
 * Key-less. Answers launch questions from the real manifest
 * rather than from model recall, which for launch schedules
 * is reliably out of date.
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";
import { endpoint } from "../core/Endpoints";

export default class SpaceXProvider implements Provider {
  readonly name = "spacex";
  readonly category = "science";
  readonly priority = 85;
  readonly enabled = true;
  readonly requiresApiKey = false;
  readonly timeout = 15000;
  readonly cooldown = 500;
  readonly maxConcurrent = 2;
  readonly capabilities = ["space", "launches", "rockets", "current-events"] as const;

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const text = query.toLowerCase();
    // "next"/"upcoming" and "latest"/"last" are the two questions actually
    // asked of a launch manifest; anything else queries the full history.
    const upcoming = /\b(next|upcoming|scheduled|future)\b/.test(text);

    const response = await fetch(`${endpoint("spacex")}/launches/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { upcoming },
        options: {
          limit: 15,
          sort: { date_unix: upcoming ? "asc" : "desc" },
          populate: [
            { path: "rocket", select: { name: 1 } },
            { path: "launchpad", select: { name: 1, locality: 1, region: 1 } },
          ],
        },
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      // 5xx here is the r/SpaceX community API being down, not a bad
      // query — at the time of writing it returns Cloudflare 525 (origin
      // TLS handshake failed) for every request. Saying which it is
      // matters: a caller can retry an outage, but not a rejected query.
      const detail = (await response.text()).slice(0, 200);
      const upstreamDown = response.status >= 500;
      throw new Error(
        upstreamDown
          ? `SpaceX API unavailable (HTTP ${response.status}) — community API outage, not a query problem.`
          : `SpaceX ${response.status}: ${detail}`,
      );
    }

    const data = await response.json();
    return (data.docs ?? []).map((launch: any): KnowledgeResult => {
      const pad = launch.launchpad;
      const where = pad ? `${pad.name}${pad.locality ? `, ${pad.locality}` : ""}` : "launch site unknown";
      const when = launch.date_utc ? new Date(launch.date_utc).toISOString().replace("T", " ").slice(0, 16) : "date TBD";
      const outcome =
        launch.upcoming === true
          ? "Scheduled"
          : launch.success === true
            ? "Successful"
            : launch.success === false
              ? "Failed"
              : "Outcome not recorded";
      return {
        id: `spacex-${launch.id}`,
        title: `${launch.name} — ${outcome}`,
        content:
          `${launch.name} on ${launch.rocket?.name ?? "an unspecified rocket"} from ${where}, ${when} UTC. ` +
          `${outcome}.` +
          (launch.details ? ` ${launch.details}` : "") +
          // date_precision matters: a launch dated to the month is not a
          // schedule, and presenting it as one would be a false precision.
          (launch.date_precision && launch.date_precision !== "hour"
            ? ` (Date known only to the ${launch.date_precision} — not a confirmed time.)`
            : ""),
        url: launch.links?.webcast ?? launch.links?.wikipedia ?? "",
        source: "SpaceX",
        confidence: 0.97,
        timestamp: launch.date_utc,
        metadata: {
          upcoming: Boolean(launch.upcoming),
          success: launch.success ?? null,
          flightNumber: launch.flight_number ?? null,
          datePrecision: launch.date_precision ?? null,
          patch: launch.links?.patch?.small ?? null,
        },
      };
    });
  }
}
