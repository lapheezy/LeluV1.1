/**
 * ==========================================================
 * LÉLU — SAFE SERVER-SIDE FETCH (SSRF containment)
 *
 * The browse relay fetches pages on the server, so a URL a user
 * (or a model) supplies is a request FROM this host. This module
 * makes that request without letting it reach the host's own
 * network:
 *
 *   • only http/https, only ports 80/443/8080/8443;
 *   • the hostname is RESOLVED and every address it resolves to is
 *     checked against loopback, private, link-local, CGNAT,
 *     multicast, reserved and documentation ranges (IPv4 and IPv6,
 *     including IPv4-mapped, NAT64 and 6to4 forms);
 *   • the socket connects to the address that was checked (pinned
 *     lookup), so DNS cannot answer differently between the check
 *     and the connection (rebinding);
 *   • redirects are followed by hand, at most MAX_REDIRECTS, each
 *     destination checked again, loops refused;
 *   • the body is streamed and counted: raw bytes and decoded bytes
 *     (gzip/deflate/br) are both capped, and the download stops the
 *     moment the cap is reached;
 *   • a single deadline covers DNS, connect, redirects and body;
 *   • no cookie, authorization or other credential is ever sent,
 *     and nothing from the response but text reaches the caller.
 * ==========================================================
 */

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";

export const MAX_BYTES = 2_000_000;
export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 15_000;
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);
const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|xml|rss\+xml|atom\+xml|json|ld\+json))/i;

export type SafeFetchErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "port_not_allowed"
  | "blocked_address"
  | "dns_failed"
  | "too_many_redirects"
  | "redirect_loop"
  | "timeout"
  | "unsupported_content"
  | "http_error"
  | "network_error";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status?: number;
  constructor(code: SafeFetchErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
  bytes: number;
  redirects: string[];
}

/* ---------------- address classification ---------------- */

function v4Blocked(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true;               // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true;               // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                          // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;                 // private
  if (a === 192 && b === 168) return true;                          // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;    // IETF protocol / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;             // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;              // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;               // TEST-NET-3
  if (a >= 224) return true;                                        // multicast, reserved, broadcast
  return false;
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // Embedded IPv4 in the last 32 bits.
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    const p = m[2].split(".").map(Number);
    s = `${m[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isFinite(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function v6Blocked(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // unparseable: refuse
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return true;                                     // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;          // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Blocked(embedded(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return v4Blocked(embedded(g[6], g[7]));                   // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Blocked(embedded(g[6], g[7]));                       // NAT64
  if (g[0] === 0x2002) return v4Blocked(embedded(g[1], g[2]));                                         // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                  // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                  // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true;                                  // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true;                                  // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                          // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true;      // discard-only
  return false;
}

/** True when an IP literal must never be connected to from this server. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip.replace(/^\[|\]$/g, ""));
  if (family === 4) return v4Blocked(ip);
  if (family === 6) return v6Blocked(ip.replace(/^\[|\]$/g, ""));
  return true;
}

/** Names that are internal by convention, refused before any lookup. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(h)) return isBlockedAddress(h);
  return h === "localhost" || /\.(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(h) || !h.includes(".");
}

/* ---------------- the fetch ---------------- */

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface SafeFetchOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  /** DNS resolution (injectable for tests). Default: the system resolver, all addresses. */
  resolve?: Resolver;
  /**
   * Tests only: where to actually open the socket for a checked address
   * (lets a fixture server on loopback stand in for a "public" address
   * WITHOUT loosening the check itself).
   */
  dial?: (address: string, port: number) => { host: string; port: number };
}

const systemResolve: Resolver = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

async function checkTarget(url: URL, resolve: Resolver): Promise<{ address: string; family: number; port: number }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("unsupported_protocol", `Only http and https are supported (got ${url.protocol}).`);
  if (url.username || url.password) throw new SafeFetchError("invalid_url", "URLs with credentials are not fetched.");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new SafeFetchError("port_not_allowed", `Port ${port} is not allowed.`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host)) throw new SafeFetchError("blocked_address", "That address is not permitted.");
  let addresses: Array<{ address: string; family: number }>;
  if (isIP(host)) addresses = [{ address: host, family: isIP(host) }];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new SafeFetchError("dns_failed", `Could not resolve ${host}.`);
    }
  }
  if (addresses.length === 0) throw new SafeFetchError("dns_failed", `${host} has no address.`);
  // Every address must be public: a name resolving to ANY internal address is refused,
  // so a resolver cannot be steered between answers.
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new SafeFetchError("blocked_address", "That address is not permitted.");
  return { ...addresses[0], port };
}

interface HopResult { status: number; location?: string; contentType: string; body: string; truncated: boolean; bytes: number }

function requestOnce(url: URL, target: { address: string; family: number; port: number }, options: Required<Pick<SafeFetchOptions, "maxBytes">> & SafeFetchOptions, signal: AbortSignal): Promise<HopResult> {
  return new Promise((resolvePromise, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const dialled = options.dial ? options.dial(target.address, target.port) : { host: target.address, port: target.port };
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ""), // Host header and TLS SNI/certificate check use the NAME
      port: dialled.port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // Pin the socket to the address that was checked: no second DNS answer.
      // Node asks for every address (all: true, for happy-eyeballs) or for one; answer either way.
      lookup: ((_host: string, lookupOptions: { all?: boolean }, cb: (err: Error | null, address: unknown, family?: number) => void) => {
        const family = isIP(dialled.host) || target.family;
        if (lookupOptions?.all) cb(null, [{ address: dialled.host, family }]);
        else cb(null, dialled.host, family);
      }) as unknown as http.RequestOptions["lookup"],
      headers: {
        "User-Agent": "Lelu/1.0 (+in-app reader)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
      },
      signal,
    }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers["content-type"] ?? "");
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolvePromise({ status, location: String(res.headers.location), contentType, body: "", truncated: false, bytes: 0 });
        return;
      }
      if (status >= 400) {
        res.resume();
        resolvePromise({ status, contentType, body: "", truncated: false, bytes: 0 });
        return;
      }
      if (contentType && !TEXT_TYPES.test(contentType)) {
        res.destroy();
        reject(new SafeFetchError("unsupported_content", `Not a text page (${contentType.split(";")[0]}).`));
        return;
      }
      const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
      const decoder = encoding === "gzip" || encoding === "x-gzip" ? zlib.createGunzip()
        : encoding === "deflate" ? zlib.createInflate()
        : encoding === "br" ? zlib.createBrotliDecompress()
        : null;
      let raw = 0;
      let decoded = 0;
      let truncated = false;
      const chunks: Buffer[] = [];
      const finish = () => {
        const body = Buffer.concat(chunks).subarray(0, options.maxBytes).toString("utf8");
        resolvePromise({ status, contentType, body, truncated, bytes: decoded });
      };
      const stop = () => {
        // Stop the download now: no more bytes are read from the network.
        truncated = true;
        res.destroy();
        decoder?.destroy();
        finish();
      };
      const take = (chunk: Buffer) => {
        if (truncated) return;
        const room = options.maxBytes - decoded;
        // Keep exactly up to the cap: the chunk that crosses it is trimmed, not dropped.
        const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
        decoded += kept.length;
        chunks.push(kept);
        if (decoded >= options.maxBytes) stop();
      };
      res.on("data", (chunk: Buffer) => {
        if (!decoder) { take(chunk); return; }
        raw += chunk.length;
        // A compressed body is capped on the wire too (a decompression bomb
        // fails on the decoded count; a huge compressed body on this one).
        if (raw > options.maxBytes) { stop(); return; }
        decoder.write(chunk);
      });
      decoder?.on("data", take);
      decoder?.on("error", () => { if (!truncated) reject(new SafeFetchError("network_error", "The page's compressed body is malformed.")); });
      res.on("end", () => {
        if (truncated) return;
        if (decoder) { decoder.end(); decoder.on("end", () => { if (!truncated) finish(); }); }
        else finish();
      });
      res.on("error", (e) => { if (!truncated) reject(e); });
    });
    req.on("error", (e) => reject(e));
    req.end();
  });
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const resolve = options.resolve ?? systemResolve;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    clearTimeout(timer);
    throw new SafeFetchError("invalid_url", "Invalid URL.");
  }
  const redirects: string[] = [];
  const seen = new Set<string>();
  try {
    for (let hop = 0; ; hop += 1) {
      const key = url.toString();
      if (seen.has(key)) throw new SafeFetchError("redirect_loop", "The page redirects in a loop.");
      seen.add(key);
      const target = await checkTarget(url, resolve);
      let result: HopResult;
      try {
        result = await requestOnce(url, target, { ...options, maxBytes }, controller.signal);
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        if (controller.signal.aborted) throw new SafeFetchError("timeout", "The page took too long to answer.");
        throw new SafeFetchError("network_error", "The page could not be reached.");
      }
      if (result.location) {
        if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects", `More than ${maxRedirects} redirects.`);
        let next: URL;
        try {
          next = new URL(result.location, url);
        } catch {
          throw new SafeFetchError("invalid_url", "The page redirected to an invalid address.");
        }
        redirects.push(next.toString());
        url = next; // checked at the top of the next hop, like the first URL
        continue;
      }
      if (result.status >= 400 || result.status === 0) throw new SafeFetchError("http_error", `HTTP ${result.status}`, result.status);
      return { url: url.toString(), status: result.status, contentType: result.contentType, body: result.body, truncated: result.truncated, bytes: result.bytes, redirects };
    }
  } finally {
    clearTimeout(timer);
  }
}
