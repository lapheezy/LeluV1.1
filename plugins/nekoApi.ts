/**
 * LÉLU Neko service bridge.
 *
 * Neko is a separate Docker/WebRTC service, not part of the Vite process.
 * This endpoint only verifies the configured public Neko web client and
 * intentionally never returns passwords or ICE/network secrets.
 */

interface ConnectLikeReq {
  method?: string;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

type EnvReader = (key: string) => string | undefined;
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function configuredUrl(env: EnvReader): string {
  return (env("VITE_NEKO_URL") ?? env("NEKO_URL") ?? "").trim().replace(/\/$/, "");
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function createNekoApi(env: EnvReader): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  return {
    attach(middlewares) {
      middlewares.use("/api/neko/status", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
          next();
          return;
        }

        const url = configuredUrl(env);
        if (!url) {
          sendJson(res, {
            configured: false,
            reachable: false,
            service: "m1k1o/neko",
            httpPort: 8080,
            webrtcUdpRange: "52000-52100",
            message: "Neko is not configured. Set VITE_NEKO_URL to the reachable Neko web client.",
          });
          return;
        }

        if (!validHttpUrl(url)) {
          sendJson(res, {
            configured: true,
            reachable: false,
            service: "m1k1o/neko",
            url,
            message: "VITE_NEKO_URL must be an http(s) URL.",
          }, 503);
          return;
        }

        void fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(6000),
          headers: { Accept: "text/html,application/xhtml+xml" },
        }).then((response) => {
          sendJson(res, {
            configured: true,
            reachable: response.status >= 200 && response.status < 400,
            service: "m1k1o/neko",
            url,
            httpStatus: response.status,
            webClient: response.status >= 200 && response.status < 400,
            message: response.status >= 200 && response.status < 400
              ? "Neko web client is reachable; WebRTC availability still depends on its UDP/NAT configuration."
              : `Neko web client returned HTTP ${response.status}.`,
          }, response.status >= 200 && response.status < 400 ? 200 : 503);
        }).catch((error) => {
          sendJson(res, {
            configured: true,
            reachable: false,
            service: "m1k1o/neko",
            url,
            message: error instanceof Error ? error.message : String(error),
          }, 503);
        });
      });
    },
  };
}
