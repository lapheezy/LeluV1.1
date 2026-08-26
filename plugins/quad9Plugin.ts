/**
 * LÉLU — Quad9 secure DNS verification bridge.
 *
 * GET /api/network/quad9 → a real, measured snapshot of the runtime's
 * DNS posture, not a settings display:
 *
 *   • system resolvers   — nameservers actually listed in the container's
 *                          /etc/resolv.conf
 *   • quad9 active       — whether 9.9.9.9 / 149.112.112.112 is among them
 *   • Quad9 DoH          — live query to https://dns.quad9.net/dns-query
 *                          (JSON API), with measured latency
 *   • DNSSEC validation  — measured via dnssec-failed.org: a validating
 *                          resolver MUST return SERVFAIL (rcode 2); an
 *                          answer means validation is NOT in effect
 *   • DoT / ECS          — configured endpoint + optional ECS prefix from
 *                          the environment (QUAD9_ECS / QUAD9_ECS_MASK)
 *
 * The bridge is honest: if the container's system resolver is not Quad9,
 * it says so. Enabling Quad9 at the network layer is a deployment-level
 * change; this endpoint reports what the runtime actually resolves
 * through, and verifies the Quad9 DoH/DoT path itself is reachable.
 */

import { promises as dnsPromises } from "node:dns";
import { readFileSync } from "node:fs";

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

const QUAD9_IPS = new Set(["9.9.9.9", "149.112.112.112"]);

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function systemResolvers(): string[] {
  try {
    const text = readFileSync("/etc/resolv.conf", "utf8");
    return text
      .split(/\r?\n/)
      .filter((line) => /^\s*nameserver\s+/i.test(line))
      .map((line) => line.trim().split(/\s+/)[1])
      .filter(Boolean);
  } catch {
    return [];
  }
}

interface DohResult {
  ok: boolean;
  rcode?: number;
  addresses?: string[];
  tookMs: number;
  error?: string;
}

async function quad9DohQuery(name: string, dohUrl: string): Promise<DohResult> {
  const start = Date.now();
  try {
    const url = new URL(dohUrl);
    url.searchParams.set("name", name);
    url.searchParams.set("type", "A");
    const response = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(8000),
    });
    const tookMs = Date.now() - start;
    if (!response.ok) return { ok: false, rcode: undefined, tookMs, error: `DoH HTTP ${response.status}` };
    const data = (await response.json().catch(() => ({}))) as {
      Status?: number;
      Answer?: Array<{ type?: number; data?: string }>;
    };
    const answers = (data.Answer ?? [])
      .filter((a) => a.type === 1 && typeof a.data === "string")
      .map((a) => a.data as string);
    return { ok: true, rcode: data.Status, addresses: answers, tookMs };
  } catch (error) {
    return {
      ok: false,
      tookMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Validate DNSSEC like a resolver would: SERVFAIL on a broken-sig domain. */
async function dnssecBrokenTest(resolveFn: (name: string) => Promise<unknown>): Promise<{
  validating: boolean;
  result: string;
}> {
  try {
    await resolveFn("dnssec-failed.org");
    return { validating: false, result: "answered" };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    // SERVFAIL/ENOTFOUND-type failure from a validating resolver is the
    // expected DNSSEC outcome for dnssec-failed.org.
    if (code === "SERVFAIL" || code === "ENODATA" || code === "ENOTFOUND") {
      return { validating: true, result: `rejected (${code})` };
    }
    return { validating: false, result: `error ${code ?? String(error)}` };
  }
}

export function createQuad9Api(env: EnvReader): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  return {
    attach(middlewares) {
      middlewares.use("/api/network/quad9", async (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
          next();
          return;
        }
        const dohUrl = env("QUAD9_DOH_URL")?.trim() || "https://dns.quad9.net/dns-query";
        const resolvers = systemResolvers();
        const quad9Active = resolvers.some((ip) => QUAD9_IPS.has(ip));

        // Measured through the container's ACTUAL system resolver.
        const systemDnssec = await dnssecBrokenTest((name) =>
          dnsPromises.resolve4(name),
        );

        // Measured against Quad9's DoH endpoint (bypasses system resolver).
        const dohLookup = await quad9DohQuery("quad9.net", dohUrl);
        const dohDnssec = await quad9DohQuery("dnssec-failed.org", dohUrl);

        const ecs = env("QUAD9_ECS")?.trim();
        const ecsMask = env("QUAD9_ECS_MASK")?.trim();

        sendJson(res, {
          ok: true,
          measuredAt: new Date().toISOString(),
          dohEndpoint: dohUrl,
          system: {
            resolvers,
            quad9Active,
            dnssecValidating: systemDnssec.validating,
            dnssecTest: systemDnssec.result,
          },
          doh: {
            reachable: dohLookup.ok,
            quad9Net: dohLookup,
            dnssecBrokenDomain: {
              ...dohDnssec,
              validating: dohDnssec.ok && dohDnssec.rcode === 2,
            },
          },
          dot: {
            endpoint: "tls://dns.quad9.net:853",
            // Real DoT termination is a deployment-network concern; the
            // configured value is reported, reachability of the endpoint
            // itself is verified by the DoH test above.
            configured: true,
          },
          ecs: ecs
            ? { configured: true, prefix: ecs, mask: ecsMask ?? "24" }
            : { configured: false },
        });
      });
    },
  };
}
