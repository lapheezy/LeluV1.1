/**
 * LÉLU Instagram Graph API bridge.
 *
 * The browser calls this same-origin endpoint with a search query. The
 * access token and Business/Creator user id are read only by the server
 * runtime, matching the existing AIS and engineering API boundaries.
 */

import { endpoint } from "../src/core/Endpoints.ts";

interface ConnectLikeReq {
  method?: string;
  url?: string;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

type EnvReader = (key: string) => string | undefined;
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

interface InstagramMedia {
  id?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
}

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readEnv(env: EnvReader, key: string): string {
  return env(key)?.trim() ?? "";
}

interface InstagramIdentity {
  id?: string;
  user_id?: string;
  username?: string;
}

interface ResolvedInstagramIdentity {
  id: string;
  username?: string;
  graphBase: string;
}

export function createInstagramApi(env: EnvReader): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  let identityPromise: Promise<ResolvedInstagramIdentity> | null = null;

  async function resolveIdentity(token: string, version: string, requestedUsername: string): Promise<ResolvedInstagramIdentity> {
    const configuredId = readEnv(env, "INSTAGRAM_USER_ID") || readEnv(env, "VITE_INSTAGRAM_USER_ID");
    if (configuredId) {
      return {
        id: configuredId,
        username: requestedUsername || undefined,
        graphBase: endpoint("instagram"),
      };
    }
    if (identityPromise) return identityPromise;

    identityPromise = (async () => {
      // Instagram Login tokens resolve through graph.instagram.com and
      // return user_id. Facebook Login tokens resolve through
      // graph.facebook.com and return id. Support both without exposing
      // the token or forcing the user to supply a numeric id.
      const attempts = [
        {
          graphBase: endpoint("instagram"),
          fields: "user_id,username",
          idField: "user_id" as const,
        },
        {
          graphBase: endpoint("metaGraph"),
          fields: "id,username",
          idField: "id" as const,
        },
      ];
      const failures: string[] = [];

      for (const attempt of attempts) {
        const identityUrl = new URL(`${attempt.graphBase}/${version}/me`);
        identityUrl.searchParams.set("fields", attempt.fields);
        identityUrl.searchParams.set("access_token", token);
        const response = await fetch(identityUrl, { signal: AbortSignal.timeout(12000) });
        const payload = (await response.json().catch(() => ({}))) as InstagramIdentity & { error?: { message?: string } };
        const id = payload[attempt.idField];
        if (!response.ok || payload.error || !id) {
          failures.push(payload.error?.message ?? `${attempt.graphBase} identity lookup HTTP ${response.status}`);
          continue;
        }
        if (requestedUsername && payload.username && payload.username.toLowerCase() !== requestedUsername.toLowerCase()) {
          throw new Error(`Instagram token resolved to @${payload.username}, not @${requestedUsername}.`);
        }
        return { id, username: payload.username, graphBase: attempt.graphBase };
      }

      throw new Error(failures.join("; ") || "Instagram identity lookup failed.");
    })().catch((error) => {
      identityPromise = null;
      throw error;
    });
    return identityPromise;
  }

  return {
    attach(middlewares) {
      middlewares.use("/api/instagram/media", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
          next();
          return;
        }

        // Accept both the canonical server-only names and VITE_-prefixed
        // variants so a token pasted under either convention is found.
        const token = readEnv(env, "INSTAGRAM_ACCESS_TOKEN") || readEnv(env, "VITE_INSTAGRAM_ACCESS_TOKEN");
        const requestedUsername = (readEnv(env, "INSTAGRAM_USERNAME") || readEnv(env, "VITE_INSTAGRAM_USERNAME") || "elpheru").replace(/^@/, "");
        const version = readEnv(env, "INSTAGRAM_API_VERSION") || readEnv(env, "VITE_INSTAGRAM_API_VERSION") || "v24.0";
        if (!token) {
          sendJson(
            res,
            { ok: false, configured: false, error: "Instagram Graph API token is not configured on the server." },
            503,
          );
          return;
        }

        const requestUrl = new URL(req.url ?? "", "http://localhost");
        const query = requestUrl.searchParams.get("query")?.trim() ?? "";
        void resolveIdentity(token, version, requestedUsername)
          .then(async ({ id: userId, username, graphBase }) => {
            const graphUrl = new URL(`${graphBase}/${version}/${encodeURIComponent(userId)}/media`);
            graphUrl.searchParams.set(
              "fields",
              "id,caption,media_type,media_url,permalink,timestamp,username",
            );
            graphUrl.searchParams.set("limit", "25");
            graphUrl.searchParams.set("access_token", token);

            return {
              response: await fetch(graphUrl, { signal: AbortSignal.timeout(12000) }),
              username,
            };
          })
          .then(async ({ response, username }) => {
            const payload = (await response.json().catch(() => ({}))) as {
              data?: InstagramMedia[];
              error?: { message?: string };
            };
            if (!response.ok || payload.error) {
              sendJson(
                res,
                { ok: false, configured: true, error: payload.error?.message ?? `Instagram Graph API ${response.status}` },
                response.status || 502,
              );
              return;
            }

            const terms = query
              .toLowerCase()
              .split(/\s+/)
              .filter((term) => term.length > 2 && !/^(instagram|ig|show|find|search|posts?|reels?)$/.test(term));
            const data = (payload.data ?? []).filter((item) => {
              if (terms.length === 0) return true;
              const text = `${item.caption ?? ""} ${item.media_type ?? ""}`.toLowerCase();
              return terms.some((term) => text.includes(term));
            });
            sendJson(res, { ok: true, configured: true, username: username ?? requestedUsername, data: data.slice(0, 10) });
          })
          .catch((error) => {
          sendJson(res, {
            ok: false,
            configured: true,
            error: error instanceof Error ? error.message : String(error),
          }, 502);
        });
      });
    },
  };
}
