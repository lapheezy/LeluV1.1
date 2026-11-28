/**
 * LÉLU Neko service bridge.
 *
 * Neko is a separate Docker/WebRTC service, not part of the Vite process.
 * This endpoint only verifies the configured public Neko web client and
 * intentionally never returns passwords or ICE/network secrets.
 */

interface ConnectLikeReq {
  method?: string;
  url?: string;
  socket?: { remoteAddress?: string };
  on?: (event: string, cb: (chunk?: unknown) => void) => void;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

type EnvReader = (key: string) => string | undefined;

const isLoopback = (req: ConnectLikeReq) => /^(::1|127\.|::ffff:127\.)/.test(req.socket?.remoteAddress ?? "");

function readBody(req: ConnectLikeReq): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on?.("data", (c) => (data += String(c)));
    req.on?.("end", () => resolve(data));
  });
}

/**
 * Open a page in Neko's own Chromium through its DevTools endpoint (bound to this
 * machine only: NEKO_CDP_URL, default http://127.0.0.1:9222). This is how LÉLU's
 * Browser drives the live Neko session: the address she or the owner types opens there.
 */
// Navigations run one at a time. Two at once (React dev mode runs effects twice) each closed the other's
// new tab, leaving an empty New Tab: measured.
let navQueue: Promise<unknown> = Promise.resolve();
function nekoNavigate(cdp: string, target: string): Promise<{ ok: boolean; detail: string }> {
  const run = navQueue.then(() => nekoNavigateNow(cdp, target));
  navQueue = run.catch(() => undefined);
  return run;
}
async function nekoNavigateNow(cdp: string, target: string): Promise<{ ok: boolean; detail: string }> {
  // A new tab per address, brought to the front; the previous tab LÉLU opened is closed.
  // (Page.navigate from Chromium's own new-tab page does not answer, measured.)
  const created = (await (await fetch(`${cdp}/json/new?${target}`, { method: "PUT", signal: AbortSignal.timeout(5000) })).json()) as { id?: string };
  if (!created?.id) return { ok: false, detail: "Neko's browser did not open the page" };
  await fetch(`${cdp}/json/activate/${created.id}`, { signal: AbortSignal.timeout(4000) }).catch(() => undefined);
  // Close every other page tab, not only the one remembered here: that memory is lost when the dev
  // server restarts, and tabs piled up (7 open, measured). One page at a time in her one shared browser.
  const tabs = (await (await fetch(`${cdp}/json/list`, { signal: AbortSignal.timeout(4000) })).json().catch(() => [])) as { id: string; type: string }[];
  await Promise.all(tabs.filter((t) => t.type === "page" && t.id !== created.id).map((t) => fetch(`${cdp}/json/close/${t.id}`, { signal: AbortSignal.timeout(4000) }).catch(() => undefined)));
  return { ok: true, detail: "opened in Neko" };
}
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
      // The client URL with the join credentials, for the owner's own Browser panel on
      // this machine only. A remote request gets the plain URL and must log in itself.
      middlewares.use("/api/neko/client", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") return next();
        const url = configuredUrl(env);
        if (!url) return sendJson(res, { configured: false }, 404);
        const pwd = env("NEKO_PASSWORD") ?? "";
        const local = isLoopback(req) && pwd;
        sendJson(res, { configured: true, url: local ? `${url}/?usr=lelu&pwd=${encodeURIComponent(pwd)}` : url, autoJoin: Boolean(local) });
      });
      middlewares.use("/api/neko/navigate", (req, res, next) => {
        if (req.method !== "POST") return next();
        if (!isLoopback(req)) return sendJson(res, { ok: false, detail: "Neko navigation is only available on this machine" }, 403);
        void readBody(req).then(async (body) => {
          let target = "";
          try {
            target = String((JSON.parse(body || "{}") as { url?: string }).url ?? "");
          } catch {
            target = "";
          }
          if (!validHttpUrl(target)) return sendJson(res, { ok: false, detail: "an http(s) url is required" }, 400);
          try {
            const r = await nekoNavigate((env("NEKO_CDP_URL") || "http://127.0.0.1:9222").replace(/\/$/, ""), target);
            sendJson(res, { ...r, url: target }, r.ok ? 200 : 502);
          } catch (error) {
            sendJson(res, { ok: false, detail: error instanceof Error ? error.message : String(error) }, 502);
          }
        });
      });
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
