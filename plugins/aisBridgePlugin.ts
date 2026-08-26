/**
 * ==========================================================
 * LÉLU — AISSTREAM SERVER-SIDE BRIDGE (Vite middleware plugin)
 *
 * AISStream exposes vessel positions over a single WebSocket
 * (`wss://stream.aisstream.io/v0/stream`) and the API key is
 * carried inside the subscription message — so the key must
 * NEVER live in client-side code or the browser bundle.
 *
 * This plugin runs inside the Vite dev/preview server process
 * and owns the whole AISStream connection:
 *
 *   • reads the key once at config time (process.env /
 *     .env files via loadEnv in vite.config.ts)
 *   • maintains a bounded vessel map keyed by MMSI
 *   • re-subscribes to the requested geographic bounding box
 *     (viewport-based loading — throttled)
 *   • reconnects with backoff; distinguishes auth errors and
 *     rate limits from plain disconnects (honest statuses)
 *   • never returns the key — only configured:true/false
 *
 * Client endpoints (same origin, no credentials involved):
 *   GET /api/ais/status    → { configured, status, vesselCount, … }
 *   GET /api/ais/vessels   → { status, updatedAt, vessels: […] }
 *                            ?bbox=west,south,east,north
 * ==========================================================
 */

export interface AisBridgeOptions {
  /** Server-only AISStream API key. Never exposed to the client. */
  apiKey?: string;
}

type BridgeStatus =
  | "idle"
  | "not_configured"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "rate_limited"
  | "auth_error"
  | "error";

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface VesselRecord {
  mmsi: number | string;
  name?: string;
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  heading?: number;
  navStatus?: number;
  shipType?: number;
  destination?: string;
  callsign?: string;
  lastUpdate: number;
}

const STALE_MS = 45 * 60 * 1000; // prune vessels silent for 45 minutes
const MAX_VESSELS = 4000;
const RESUBSCRIBE_THROTTLE_MS = 10000;
const BBOX_CHANGE_DEG = 2;

const AIS_WS_URL = "wss://stream.aisstream.io/v0/stream";

/**
 * AISStream timestamps look like "2026-08-25 14:46:14.463757861 +0000 UTC".
 * Date.parse is unreliable for that shape, so parse it deterministically.
 */
function parseAisTimeUtc(value: string): number | null {
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(?:([+-]\d{4}))?/,
  );
  if (!m) return null;
  const ms = Number((m[7] ?? "").padEnd(3, "0").slice(0, 3));
  const t = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    ms,
  );
  if (m[8]) {
    const off = m[8];
    const offMin = Number(off.slice(0, 3)) * 60 + Number(off.slice(3));
    return t - offMin * 60000;
  }
  return t;
}

/** AISStream sends permessage-deflate frames — decode any binary payload. */
async function decodeFrameData(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data as ArrayBufferView)) {
    return new TextDecoder().decode((data as ArrayBufferView).buffer as ArrayBuffer);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new TextDecoder().decode(new Uint8Array(await data.arrayBuffer()));
  }
  return "";
}

interface ResLike {
  statusCode?: number;
  setHeader: (k: string, v: string) => void;
  end: (s: string) => void;
}

interface WsClient {
  addEventListener: (ev: string, fn: (e: unknown) => void) => void;
  send: (data: string) => void;
  close: () => void;
}

type WsCtor = new (url: string) => WsClient;

function getWsCtor(): WsCtor | undefined {
  // Node ≥ 22 and Bun expose a global WebSocket client; the type is not
  // declared by @types/node, so access it defensively at runtime.
  const g = globalThis as unknown as { WebSocket?: WsCtor };
  return g.WebSocket;
}

class AisBridge {
  private apiKey: string;
  private ws: { send: (data: string) => void; close: () => void } | null = null;
  private status: BridgeStatus = "idle";
  private error: string | null = null;
  private lastMessageAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 2000;
  private vessels = new Map<string, VesselRecord>();
  private requestedBbox: Bbox | null = null;
  private subscribedBbox: Bbox | null = null;
  private lastSubscribeAt = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey || "";
    this.status = this.apiKey ? "idle" : "not_configured";
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Public state accessor (names/counts only — never the key) used by
   * /api/provider-health so the health endpoint reports the real bridge
   * state without a second connection or duplicated state.
   */
  getStatus(): Record<string, unknown> {
    return this.statusPayload();
  }

  /* ------------------------------------------------------------------
   * Middleware
   * ------------------------------------------------------------------ */

  attach(middlewares: {
    use: (path: string, handler: (req: unknown, res: unknown) => void) => void;
  }): void {
    middlewares.use("/api/ais/status", (req, res) => {
      void req;
      this.sendJson(res as never, this.statusPayload());
    });
    middlewares.use("/api/ais/vessels", (req, res) => {
      this.handleVessels(req as never, res as never);
    });
  }

  private sendJson(res: ResLike, payload: unknown, status = 200): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  }

  private statusPayload(): Record<string, unknown> {
    return {
      configured: this.configured,
      status: this.configured ? this.status : "not_configured",
      connected: this.status === "connected",
      vesselCount: this.vessels.size,
      lastMessageAt: this.lastMessageAt,
      error: this.error,
      subscription: this.subscribedBbox,
    };
  }

  private handleVessels(req: { url?: string }, res: ResLike): void {
    if (!this.configured) {
      this.sendJson(res, {
        status: "not_configured",
        message: "AISSTREAM_API_KEY is not configured on the server",
        vessels: [],
      });
      return;
    }
    const url = new URL(req.url ?? "", "http://localhost");
    const bboxParam = url.searchParams.get("bbox");
    if (bboxParam) {
      const parts = bboxParam.split(",").map((p) => Number(p.trim()));
      if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
        this.requestedBbox = {
          west: Math.max(-180, parts[0]),
          south: Math.max(-90, parts[1]),
          east: Math.min(180, parts[2]),
          north: Math.min(90, parts[3]),
        };
        this.maybeResubscribe();
      }
    }
    this.ensureConnected();
    const list = this.filterVessels(this.requestedBbox);
    this.sendJson(res, {
      status: this.status,
      connected: this.status === "connected",
      updatedAt: this.lastMessageAt,
      vessels: list,
    });
  }

  /* ------------------------------------------------------------------
   * Connection lifecycle — lazy: no socket until Earth asks for vessels
   * ------------------------------------------------------------------ */

  private ensureConnected(): void {
    if (!this.configured) return;
    if (
      this.status === "connecting" ||
      this.status === "connected" ||
      this.status === "reconnecting"
    ) {
      return;
    }
    this.connect();
  }

  private connect(): void {
    const WsCtor = getWsCtor() as
      | (new (url: string) => {
          addEventListener: (ev: string, fn: (e: unknown) => void) => void;
          send: (data: string) => void;
          close: () => void;
        })
      | undefined;
    if (!WsCtor) {
      this.status = "error";
      this.error = "WebSocket client unavailable in this runtime";
      return;
    }
    this.status = "connecting";
    this.error = null;
    let ws: WsClient;
    try {
      ws = new WsCtor(AIS_WS_URL);
    } catch (error) {
      this.status = "error";
      this.error = error instanceof Error ? error.message : String(error);
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.status = "connected";
      this.reconnectDelayMs = 2000;
      this.sendSubscribe();
    });
    ws.addEventListener("message", (event: unknown) => {
      void (async () => {
        try {
          await this.handleMessage(event);
        } catch {
          /* one bad frame must never take down the bridge */
        }
      })();
    });
    ws.addEventListener("close", (event: unknown) => {
      this.handleClose(event);
    });
    ws.addEventListener("error", () => {
      /* close event follows and carries the code/reason */
    });
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = delayMs ?? this.reconnectDelayMs;
    this.status = "reconnecting";
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectDelayMs = Math.min(30000, delay * 1.8);
  }

  private handleClose(event: unknown): void {
    const ev = event as { code?: number; reason?: string } | null;
    const code = ev?.code;
    const reason = (ev?.reason ?? "").toLowerCase();
    if (code === 1008 || code === 4001 || /key|auth|unauthorized|forbidden/.test(reason)) {
      this.status = "auth_error";
      this.error = reason || `closed ${code ?? "?"}`;
      return; // invalid key — do not reconnect
    }
    if (code === 1013 || /rate|quota|limit/.test(reason)) {
      this.status = "rate_limited";
      this.error = reason || `closed ${code ?? "?"}`;
      this.scheduleReconnect(30000);
      return;
    }
    this.status = "disconnected";
    this.scheduleReconnect();
  }

  /* ------------------------------------------------------------------
   * Subscription (viewport bbox, throttled)
   * ------------------------------------------------------------------ */

  private maybeResubscribe(): void {
    const b = this.requestedBbox;
    if (!b) return;
    const s = this.subscribedBbox;
    const changed =
      !s ||
      Math.abs(s.west - b.west) > BBOX_CHANGE_DEG ||
      Math.abs(s.east - b.east) > BBOX_CHANGE_DEG ||
      Math.abs(s.south - b.south) > BBOX_CHANGE_DEG ||
      Math.abs(s.north - b.north) > BBOX_CHANGE_DEG;
    if (!changed) return;
    const now = Date.now();
    if (now - this.lastSubscribeAt < RESUBSCRIBE_THROTTLE_MS) return;
    this.lastSubscribeAt = now;
    this.subscribedBbox = b;
    if (this.status === "connected" && this.ws) this.sendSubscribe();
  }

  private sendSubscribe(): void {
    const b = this.subscribedBbox ?? this.requestedBbox ?? {
      west: -180,
      south: -90,
      east: 180,
      north: 90,
    };
    this.subscribedBbox = b;
    const subscription = {
      APIKey: this.apiKey,
      BoundingBoxes: [[[b.south, b.west], [b.north, b.east]]],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    };
    try {
      this.ws?.send(JSON.stringify(subscription));
    } catch (error) {
      this.status = "error";
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  /* ------------------------------------------------------------------
   * Message handling — envelope: { MessageType, MetaData, Message }
   * ------------------------------------------------------------------ */

  private async handleMessage(event: unknown): Promise<void> {
    let text = "";
    const ev = event as { data?: unknown } | null;
    if (ev) text = await decodeFrameData(ev.data);
    else if (typeof event === "string") text = event;
    if (!text) return;
    let msg: Record<string, unknown> | null = null;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    this.lastMessageAt = Date.now();

    // Server error frames — keep them honest and never retry auth failures.
    if (msg.error !== undefined || msg.code !== undefined) {
      const detail = String(msg.error ?? msg.message ?? "");
      if (/key|auth|permission|unauthorized|forbidden/i.test(detail)) {
        this.status = "auth_error";
        this.error = detail;
        this.ws?.close();
        return;
      }
      if (/rate|limit|quota/i.test(detail)) {
        this.status = "rate_limited";
        this.error = detail;
        return;
      }
      this.error = detail || "unknown stream error";
      return;
    }

    const type = msg.MessageType as string | undefined;
    const meta = (msg.MetaData ?? {}) as Record<string, unknown>;
    const payload = (msg.Message as Record<string, unknown> | undefined)?.[type ?? ""] as
      | Record<string, unknown>
      | undefined;
    if (!type || !payload) return;

    const mmsi = meta.MMSI ?? meta.MMSI_String ?? payload.UserID;
    if (mmsi === undefined || mmsi === null) return;
    const key = String(mmsi);
    const rec: VesselRecord = this.vessels.get(key) ?? {
      mmsi: mmsi as string | number,
      lastUpdate: 0,
    };

    const parsed = typeof meta.time_utc === "string" ? parseAisTimeUtc(meta.time_utc) : null;
    rec.lastUpdate = parsed ?? Date.now();
    if (typeof meta.ShipName === "string" && meta.ShipName.trim()) {
      rec.name = meta.ShipName.trim();
    }

    if (type === "PositionReport") {
      if (typeof payload.Latitude === "number" && typeof payload.Longitude === "number") {
        rec.lat = payload.Latitude;
        rec.lon = payload.Longitude;
      }
      if (typeof payload.Sog === "number") rec.sog = payload.Sog;
      if (typeof payload.Cog === "number") rec.cog = payload.Cog;
      if (typeof payload.TrueHeading === "number") rec.heading = payload.TrueHeading;
      if (typeof payload.NavigationalStatus === "number") rec.navStatus = payload.NavigationalStatus;
    } else if (type === "ShipStaticData") {
      if (typeof payload.Name === "string" && payload.Name.trim()) rec.name = payload.Name.trim();
      if (typeof payload.Type === "number") rec.shipType = payload.Type;
      if (typeof payload.Destination === "string") rec.destination = payload.Destination;
      if (typeof payload.CallSign === "string") rec.callsign = payload.CallSign;
    }

    this.vessels.set(key, rec);
    if (this.vessels.size > MAX_VESSELS) this.prune();
  }

  private prune(): void {
    const cutoff = Date.now() - STALE_MS;
    for (const [key, vessel] of this.vessels) {
      if (vessel.lastUpdate < cutoff) this.vessels.delete(key);
    }
  }

  private filterVessels(bbox: Bbox | null): VesselRecord[] {
    this.prune();
    const out: VesselRecord[] = [];
    for (const vessel of this.vessels.values()) {
      if (typeof vessel.lat !== "number" || typeof vessel.lon !== "number") continue;
      if (bbox) {
        const margin = 0.5;
        if (
          vessel.lon < bbox.west - margin ||
          vessel.lon > bbox.east + margin ||
          vessel.lat < bbox.south - margin ||
          vessel.lat > bbox.north + margin
        ) {
          continue;
        }
      }
      out.push(vessel);
      if (out.length >= 800) break;
    }
    out.sort((a, b) => (a.name ?? `mmsi-${a.mmsi}`).localeCompare(b.name ?? `mmsi-${b.mmsi}`));
    return out;
  }
}

/**
 * Reusable bridge instance — mounted by any connect-style middleware
 * server (Vite dev/preview, the standalone server.ts, Deno main.ts).
 */
export function createAisBridge(options: AisBridgeOptions = {}): {
  attach: (middlewares: { use: (path: string, handler: (req: unknown, res: unknown) => void) => void }) => void;
  getStatus: () => Record<string, unknown>;
} {
  return new AisBridge(options.apiKey ?? "");
}

export function aisBridgePlugin(options: AisBridgeOptions = {}): {
  name: string;
  configureServer: (server: { middlewares: Parameters<AisBridge["attach"]>[0] }) => void;
  configurePreviewServer: (server: { middlewares: Parameters<AisBridge["attach"]>[0] }) => void;
} {
  const bridge = createAisBridge(options);
  return {
    name: "ais-bridge",
    configureServer(server) {
      bridge.attach(server.middlewares);
    },
    configurePreviewServer(server) {
      bridge.attach(server.middlewares);
    },
  };
}
