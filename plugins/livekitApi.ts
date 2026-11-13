/**
 * ==========================================================
 * LÉLU — LIVEKIT VOICE TRANSPORT (server side)
 *
 * LiveKit is TRANSPORT. It carries her microphone audio to the voice
 * agent and her synthesised voice back. It does not think: transcripts
 * come back to the page, and the page's existing cognition (AIService,
 * the same conversation as text chat) writes the reply.
 *
 *   POST /api/livekit/token   → { url, token, room, identity, expiresAt, agent }
 *   GET  /api/livekit/status  → configured / server reachable / agent health
 *
 * SECURITY
 *   · LIVEKIT_API_KEY / LIVEKIT_API_SECRET are read on the server only. They
 *     must never carry a VITE_/NEXT_PUBLIC_ prefix and never appear in
 *     plugins/runtimeKeyBridge.ts. The browser receives only a signed JWT.
 *   · Identity comes from the caller's Supabase session, verified by
 *     Supabase itself (plugins/engineerIdentity.ts). No identity → 401.
 *     No Supabase configuration → 503. Fail closed.
 *   · Room isolation: the ROOM IS DERIVED FROM THE VERIFIED USER ID
 *     (`lelu-<uuid>`). A client cannot ask for another room; the grant
 *     names exactly one.
 *   · Short-lived: 10 minutes by default (LIVEKIT_TOKEN_TTL_SECONDS,
 *     clamped to 60–3600). The client asks again on reconnect.
 *   · Rate limited per user.
 *
 * AGENT
 *   After issuing a token the server asks the voice agent
 *   (services/livekit-agent, LELU_VOICE_AGENT_URL) to join that room,
 *   authenticated with LELU_VOICE_AGENT_TOKEN. The agent mints its own
 *   LiveKit token server-side. If the agent is down the user token is
 *   still issued and `agent.dispatched` says false, with the reason.
 * ==========================================================
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

import { verifyRequestIdentity, type IdentityCheck } from "./engineerIdentity.ts";

type ReadEnv = (name: string) => string | undefined;
type Req = IncomingMessage & { headers: IncomingMessage["headers"] };
type Res = ServerResponse;
type Handler = (req: Req, res: Res, next: () => void) => void;
type VerifyIdentity = (req: { headers?: Record<string, string | string[] | undefined> }) => Promise<IdentityCheck>;

export interface LivekitSettings {
  /** Where THIS server reaches LiveKit (RoomService, http(s)/ws(s)). */
  serverUrl: string;
  /** What the browser connects to (wss:// in production). */
  publicUrl: string;
  apiKey: string;
  apiSecret: string;
  ttlSeconds: number;
  agentUrl: string;
  agentToken: string;
}

export function livekitSettings(read: ReadEnv): LivekitSettings | null {
  const serverUrl = (read("LIVEKIT_URL") ?? "").trim();
  const apiKey = (read("LIVEKIT_API_KEY") ?? "").trim();
  const apiSecret = (read("LIVEKIT_API_SECRET") ?? "").trim();
  if (!serverUrl || !apiKey || !apiSecret) return null;
  // Readers may return "" for an unset name; that means "default", not 0.
  const ttl = Number((read("LIVEKIT_TOKEN_TTL_SECONDS") ?? "").trim() || "600");
  return {
    serverUrl,
    publicUrl: (read("LIVEKIT_PUBLIC_URL") ?? "").trim() || serverUrl,
    apiKey,
    apiSecret,
    ttlSeconds: Math.min(3600, Math.max(60, Number.isFinite(ttl) ? ttl : 600)),
    agentUrl: ((read("LELU_VOICE_AGENT_URL") ?? "").trim() || "http://127.0.0.1:8790").replace(/\/+$/, ""),
    agentToken: (read("LELU_VOICE_AGENT_TOKEN") ?? "").trim(),
  };
}

/** The one room a verified user may join. Never taken from the request. */
export function roomForUser(userId: string): string {
  return `lelu-${userId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function httpUrl(url: string): string {
  return url.replace(/^ws(s?):\/\//i, "http$1://");
}

function send(res: Res, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

export interface LivekitApiOptions {
  readEnv?: ReadEnv;
  /** Injected in tests; production uses Supabase verification. */
  verifyIdentity?: VerifyIdentity;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createLivekitApi(options: LivekitApiOptions = {}): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
  issue: (req: { headers?: Record<string, string | string[] | undefined> }) => Promise<{ status: number; body: unknown }>;
} {
  const read: ReadEnv = options.readEnv ?? ((name) => process.env[name]);
  const verify = options.verifyIdentity ?? verifyRequestIdentity;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const recent = new Map<string, number[]>();
  const LIMIT = 12; // tokens per user per minute: reconnects, not abuse

  function limited(user: string): boolean {
    const cutoff = now() - 60_000;
    const hits = (recent.get(user) ?? []).filter((at) => at > cutoff);
    hits.push(now());
    recent.set(user, hits);
    return hits.length > LIMIT;
  }

  async function dispatchAgent(settings: LivekitSettings, room: string): Promise<{ dispatched: boolean; detail: string }> {
    if (!settings.agentToken) return { dispatched: false, detail: "LELU_VOICE_AGENT_TOKEN is not set; the agent is not dispatched" };
    try {
      const response = await doFetch(`${settings.agentUrl}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Lelu-Agent-Token": settings.agentToken },
        body: JSON.stringify({ room }),
        signal: AbortSignal.timeout(5000),
      });
      const text = await response.text();
      return { dispatched: response.ok, detail: response.ok ? "agent joining" : `agent answered HTTP ${response.status}: ${text.slice(0, 200)}` };
    } catch (error) {
      return { dispatched: false, detail: `voice agent unreachable: ${(error as Error).message}` };
    }
  }

  async function issue(req: { headers?: Record<string, string | string[] | undefined> }): Promise<{ status: number; body: unknown }> {
    const settings = livekitSettings(read);
    if (!settings) {
      return { status: 503, body: { ok: false, error: "LiveKit is not configured on this server (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)." } };
    }
    const identity = await verify(req);
    if (!identity.ok || !identity.identity) {
      return { status: identity.status || 401, body: { ok: false, error: identity.reason } };
    }
    const userId = identity.identity.userId;
    if (limited(userId)) {
      return { status: 429, body: { ok: false, error: "too many voice session requests; wait a minute" } };
    }
    const room = roomForUser(userId);
    const participant = `user-${userId}`;

    // Create (or confirm) the room with a cap: the user, the agent, and one
    // reconnecting tab. Joining would auto-create it, but this states limits.
    try {
      const rooms = new RoomServiceClient(httpUrl(settings.serverUrl), settings.apiKey, settings.apiSecret);
      await rooms.createRoom({ name: room, emptyTimeout: 300, maxParticipants: 3 });
    } catch (error) {
      return { status: 502, body: { ok: false, error: `LiveKit server unavailable: ${(error as Error).message}` } };
    }

    const token = new AccessToken(settings.apiKey, settings.apiSecret, {
      identity: participant,
      name: identity.identity.email ?? "LÉLU user",
      ttl: settings.ttlSeconds,
    });
    token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    const jwt = await token.toJwt();
    const agent = await dispatchAgent(settings, room);
    return {
      status: 200,
      body: {
        ok: true,
        url: settings.publicUrl,
        token: jwt,
        room,
        identity: participant,
        expiresAt: now() + settings.ttlSeconds * 1000,
        agent,
      },
    };
  }

  async function status(): Promise<unknown> {
    const settings = livekitSettings(read);
    if (!settings) return { configured: false };
    const out: Record<string, unknown> = { configured: true, url: settings.publicUrl, ttlSeconds: settings.ttlSeconds };
    try {
      const response = await doFetch(httpUrl(settings.serverUrl), { signal: AbortSignal.timeout(3000) });
      out.server = { reachable: response.ok };
    } catch (error) {
      out.server = { reachable: false, error: (error as Error).message };
    }
    try {
      const response = await doFetch(`${settings.agentUrl}/health`, { signal: AbortSignal.timeout(3000) });
      out.agent = response.ok ? await response.json() : { reachable: true, httpStatus: response.status };
    } catch (error) {
      out.agent = { reachable: false, error: (error as Error).message };
    }
    return out;
  }

  return {
    issue,
    attach(middlewares) {
      middlewares.use("/api/livekit/token", (req, res, next) => {
        if (req.method !== "POST") return next();
        issue(req)
          .then(({ status: code, body }) => send(res, code, body))
          .catch((error: Error) => send(res, 500, { ok: false, error: error.message }));
      });
      middlewares.use("/api/livekit/status", (req, res, next) => {
        if (req.method !== "GET") return next();
        status()
          .then((body) => send(res, 200, body))
          .catch((error: Error) => send(res, 500, { ok: false, error: error.message }));
      });
    },
  };
}

export function livekitApiPlugin(readEnv?: ReadEnv) {
  const api = createLivekitApi({ readEnv });
  return {
    name: "livekit-api",
    configureServer(server: { middlewares: { use: (path: string, handler: Handler) => void } }) {
      api.attach(server.middlewares);
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, handler: Handler) => void } }) {
      api.attach(server.middlewares);
    },
  };
}
