/**
 * ==========================================================
 * LÉLU — GLOBAL SPENDING POLICY (server side, one module)
 *
 * Default: ZERO additional spending. Every call that can cost money passes a
 * server-side choke point (the model broker, the Meshy relay, Meshy job
 * approval, ElevenLabs), and each asks THIS module first. Because the check
 * is on the server, no page code, agent, background job, scheduled task or
 * delegated tool can route around it.
 *
 * A service is FREE only when it is known not to bill (a free tier that
 * refuses instead of charging, a local worker, a $0 model). Everything else
 * — including anything whose cost status is unknown — is PAID and needs an
 * explicit, scoped, time-limited user authorization. A key being present,
 * a provider being available, a trial balance or a spending cap is never
 * permission.
 *
 * Authorizations come only from the user's own words (typed or spoken),
 * captured at the input points (src/core/spend/SpendConsent.ts) and posted
 * with a consent marker; model output, agents and background jobs have no
 * path that creates one. Every paid decision is audited (no secrets).
 * ==========================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type EnvReader = (name: string) => string | undefined;
export type CostClass = "free" | "paid";

export interface CostStatus {
  cost: CostClass;
  /** Why — shown to the user when consent is needed. */
  why: string;
}

/**
 * What each service costs, as far as LÉLU can KNOW it. Not listed = paid.
 * An operator (the user) may declare a different status for their own
 * account with LELU_SERVICE_COST_<SERVICE>=free|paid.
 */
const KNOWN_FREE: Record<string, string> = {
  groq: "free tier: requests over its limits are refused (429), never billed",
  cerebras: "free tier: requests over its limits are refused, never billed",
  githubModels: "GitHub Models free tier: rate-limited, not billed",
  firecrawl: "free plan credits: when spent, requests are refused, not billed",
  vox: "LÉLU's own local speech worker (MOSS-TTS-Nano / VoxCPM2)",
  local: "runs on this machine",
  news: "free-tier key: over-quota requests are refused",
  youtube: "free daily quota: over-quota requests are refused",
  guardian: "free developer key",
  gnews: "free-tier key",
  newsdata: "free-tier key",
  geoapify: "free-tier key",
  nasa: "free key (DEMO_KEY or registered)",
  firms: "free NASA FIRMS key",
};

const KNOWN_PAID: Record<string, string> = {
  anthropic: "Anthropic bills per token from account credit",
  fireworks: "Fireworks bills per token",
  mistral: "Mistral's paid API (free status not confirmed for this account)",
  gemini: "Gemini paid API (free status not confirmed for this account)",
  openrouter: "OpenRouter bills non-:free models per token from account credit",
  elevenlabs: "ElevenLabs bills characters against a paid plan",
  meshy: "Meshy spends account credits per generation",
};

export function costOf(service: string, detail: { model?: string } = {}, read: EnvReader = () => undefined): CostStatus {
  const declared = (read(`LELU_SERVICE_COST_${service.toUpperCase()}`) ?? "").trim().toLowerCase();
  if (declared === "free" || declared === "paid") return { cost: declared, why: `declared ${declared} by the operator (LELU_SERVICE_COST_${service.toUpperCase()})` };
  if (service === "openrouter" && typeof detail.model === "string" && /:free$/i.test(detail.model.trim())) {
    return { cost: "free", why: "OpenRouter :free model ($0 per token)" };
  }
  if (KNOWN_FREE[service]) return { cost: "free", why: KNOWN_FREE[service] };
  return { cost: "paid", why: KNOWN_PAID[service] ?? "cost status unknown — treated as paid" };
}

export interface SpendGrant {
  id: string;
  service: string;
  /** Only this model, when set. */
  model?: string;
  /** Only this operation (e.g. "chat", "tts", "generate"), when set. */
  operation?: string;
  maxRequests: number;
  usedRequests: number;
  /** Ceiling in USD when the user named one; enforced where the provider reports cost. */
  maxUsd?: number;
  usedUsd: number;
  createdAt: number;
  expiresAt: number;
  /** The user's own words that created it (trimmed). */
  consent: string;
  revoked?: boolean;
}

export interface SpendDecision {
  allowed: boolean;
  cost: CostClass;
  why: string;
  grantId?: string;
  /** Machine code for callers: "free" | "authorized" | "spend_not_authorized" | "grant_exhausted". */
  code: string;
}

export interface SpendPolicy {
  /** `peek` answers without writing an audit line (status polls). */
  check(service: string, detail?: { model?: string; operation?: string }, options?: { peek?: boolean }): SpendDecision;
  /** Record what an allowed paid call actually used. */
  consume(grantId: string | undefined, usage?: { usd?: number }): void;
  authorize(input: { service: string; model?: string; operation?: string; maxUsd?: number; maxRequests?: number; ttlMs?: number; consent: string }): SpendGrant;
  revokeAll(reason: string): number;
  grants(): SpendGrant[];
  audit(limit?: number): unknown[];
}

const DEFAULT_TTL_MS = 2 * 60 * 60_000; // "this job": two hours unless the user said otherwise
const MAX_TTL_MS = 24 * 60 * 60_000; // never open-ended
const DEFAULT_MAX_REQUESTS = 40;

export function createSpendPolicy(options: { stateDir?: string; read?: EnvReader; now?: () => number } = {}): SpendPolicy {
  const read = options.read ?? ((name: string) => process.env[name]);
  const now = options.now ?? Date.now;
  const dir = options.stateDir ?? path.join(process.cwd(), ".lelu-state", "spend");
  const grantsFile = path.join(dir, "authorizations.json");
  const auditFile = path.join(dir, "audit.jsonl");
  const memoryAudit: unknown[] = [];

  const load = (): SpendGrant[] => {
    try {
      return existsSync(grantsFile) ? (JSON.parse(readFileSync(grantsFile, "utf8")) as SpendGrant[]) : [];
    } catch {
      return [];
    }
  };
  let all = load();
  const save = () => {
    try {
      mkdirSync(dir, { recursive: true });
      const temp = `${grantsFile}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(all, null, 1));
      renameSync(temp, grantsFile);
    } catch {
      /* in-memory still enforces */
    }
  };
  const record = (entry: Record<string, unknown>) => {
    const line = { at: new Date(now()).toISOString(), ...entry };
    memoryAudit.push(line);
    if (memoryAudit.length > 500) memoryAudit.shift();
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(auditFile, `${JSON.stringify(line)}\n`);
    } catch {
      /* the in-memory audit remains */
    }
  };
  const ceilingUsd = (): number | undefined => {
    const raw = Number((read("LELU_SPEND_CEILING_USD") ?? "").trim());
    return Number.isFinite(raw) && raw >= 0 && (read("LELU_SPEND_CEILING_USD") ?? "").trim() !== "" ? raw : undefined;
  };
  const totalSpentUsd = () => all.reduce((sum, g) => sum + (g.usedUsd || 0), 0);

  return {
    check(service, detail = {}, options = {}) {
      const status = costOf(service, detail, read);
      if (status.cost === "free") return { allowed: true, cost: "free", why: status.why, code: "free" };
      const t = now();
      const candidates = all.filter(
        (g) =>
          !g.revoked &&
          g.service === service &&
          g.expiresAt > t &&
          (!g.model || g.model === detail.model) &&
          (!g.operation || g.operation === detail.operation),
      );
      const usable = candidates.find(
        (g) => g.usedRequests < g.maxRequests && (g.maxUsd === undefined || g.usedUsd < g.maxUsd),
      );
      const ceiling = ceilingUsd();
      if (usable && (ceiling === undefined || totalSpentUsd() < ceiling)) {
        if (!options.peek) record({ decision: "allowed", service, model: detail.model, operation: detail.operation, grant: usable.id });
        return { allowed: true, cost: "paid", why: status.why, grantId: usable.id, code: "authorized" };
      }
      const exhausted = candidates.length > 0 || (ceiling !== undefined && totalSpentUsd() >= ceiling);
      if (!options.peek) record({ decision: "denied", service, model: detail.model, operation: detail.operation, reason: exhausted ? "grant_exhausted" : "spend_not_authorized" });
      return {
        allowed: false,
        cost: "paid",
        why: status.why,
        code: exhausted ? "grant_exhausted" : "spend_not_authorized",
      };
    },

    consume(grantId, usage = {}) {
      if (!grantId) return;
      const grant = all.find((g) => g.id === grantId);
      if (!grant) return;
      grant.usedRequests += 1;
      if (typeof usage.usd === "number" && Number.isFinite(usage.usd)) grant.usedUsd += usage.usd;
      save();
      record({ decision: "consumed", grant: grantId, service: grant.service, usd: usage.usd ?? null, usedRequests: grant.usedRequests });
    },

    authorize(input) {
      const ceiling = ceilingUsd();
      const maxUsd = input.maxUsd === undefined ? undefined : ceiling === undefined ? input.maxUsd : Math.min(input.maxUsd, ceiling);
      const grant: SpendGrant = {
        id: `spend-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        service: input.service,
        ...(input.model ? { model: input.model } : {}),
        ...(input.operation ? { operation: input.operation } : {}),
        maxRequests: Math.max(1, Math.min(input.maxRequests ?? DEFAULT_MAX_REQUESTS, 500)),
        usedRequests: 0,
        ...(maxUsd !== undefined ? { maxUsd } : {}),
        usedUsd: 0,
        createdAt: now(),
        expiresAt: now() + Math.min(Math.max(60_000, input.ttlMs ?? DEFAULT_TTL_MS), MAX_TTL_MS),
        consent: input.consent.slice(0, 300),
      };
      all.push(grant);
      save();
      record({ decision: "authorized", grant: grant.id, service: grant.service, model: grant.model ?? null, maxUsd: grant.maxUsd ?? null, maxRequests: grant.maxRequests, expiresAt: new Date(grant.expiresAt).toISOString() });
      return grant;
    },

    revokeAll(reason) {
      let n = 0;
      for (const g of all) if (!g.revoked && g.expiresAt > now()) { g.revoked = true; n += 1; }
      save();
      record({ decision: "revoked", count: n, reason: reason.slice(0, 200) });
      return n;
    },

    grants: () => all.filter((g) => !g.revoked && g.expiresAt > now()).map((g) => ({ ...g })),
    audit: (limit = 50) => memoryAudit.slice(-limit),
  };
}

/** The one process-wide policy every choke point consults. */
let shared: SpendPolicy | null = null;
export function spendPolicy(): SpendPolicy {
  if (!shared) shared = createSpendPolicy();
  return shared;
}
/** Test seam. */
export function setSpendPolicyForTests(policy: SpendPolicy | null): void {
  shared = policy;
}

/** The refusal body every choke point returns, so the page reads one shape. */
export function spendRefusal(service: string, decision: SpendDecision, detail: { model?: string; operation?: string } = {}) {
  return {
    ok: false,
    code: decision.code,
    service,
    ...(detail.model ? { model: detail.model } : {}),
    error:
      decision.code === "grant_exhausted"
        ? `${service} is paid and the authorization you gave is used up or past its ceiling; nothing was sent.`
        : `${service} is paid (${decision.why}) and paid use has not been authorized; nothing was sent. ` +
          `To allow it, tell LÉLU in your own words, e.g. "I authorize ${service} up to $2 for this job".`,
  };
}

/* ------------------------------------------------------------------ */
/* The user's own words → a scoped authorization (deterministic).      */
/* ------------------------------------------------------------------ */

const SERVICE_ALIASES: Array<[RegExp, string]> = [
  [/\b(anthropic|claude)\b/i, "anthropic"],
  [/\bopen\s?router\b/i, "openrouter"],
  [/\bfireworks\b/i, "fireworks"],
  [/\beleven\s?labs\b/i, "elevenlabs"],
  [/\bmeshy\b/i, "meshy"],
  [/\bmistral\b/i, "mistral"],
  [/\bgemini\b/i, "gemini"],
  [/\bgroq\b/i, "groq"],
  [/\bcerebras\b/i, "cerebras"],
  [/\bfirecrawl\b/i, "firecrawl"],
];

export type ParsedConsent =
  | { kind: "authorize"; service: string; maxUsd?: number; maxRequests?: number; ttlMs: number }
  | { kind: "revoke" }
  | null;

/**
 * Explicit authorization only. Requires an authorizing phrase AND a named
 * service; a negation anywhere ("don't use paid…") is never consent. Scope
 * defaults to this job (2 h); "today" is at most 24 h; never permanent.
 */
export function parseSpendConsent(text: string): ParsedConsent {
  const t = text.trim();
  if (!t || t.length > 600) return null;
  if (/\b(revoke|withdraw|cancel)\b[^.?!]{0,40}\bauthori[sz]ation\b|\bstop (?:all )?paid\b|\bno more paid\b|\bdon'?t spend\b/i.test(t)) {
    return { kind: "revoke" };
  }
  if (/\b(don'?t|do not|never|no)\b[^.?!]{0,30}\b(use|authori[sz]e|spend|pay)\b/i.test(t)) return null;
  const authorizing = /\b(i\s+authori[sz]e|i\s+approve|you\s+(?:can|may)\s+(?:use|spend)|go\s+ahead\s+and\s+use|i\s+allow|use\s+(?:the\s+)?paid|paid\s+(?:use|capacity)\s+is\s+(?:ok|fine|approved|authori[sz]ed))\b/i.test(t);
  if (!authorizing) return null;
  const service = SERVICE_ALIASES.find(([re]) => re.test(t))?.[1];
  if (!service) return null;
  const usd = /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|usd)\b/i.exec(t);
  const maxUsd = usd ? Number(usd[1] ?? usd[2]) : undefined;
  const reqs = /\b(\d{1,4})\s*(?:requests?|calls?|generations?|jobs?|messages?)\b/i.exec(t);
  const hours = /\bfor\s+(\d{1,2})\s*(?:h|hours?)\b/i.exec(t);
  const minutes = /\bfor\s+(\d{1,3})\s*(?:m|min|minutes?)\b/i.exec(t);
  const ttlMs = hours ? Number(hours[1]) * 3600_000 : minutes ? Number(minutes[1]) * 60_000 : /\btoday\b/i.test(t) ? 24 * 3600_000 : 2 * 3600_000;
  return { kind: "authorize", service, ...(maxUsd !== undefined ? { maxUsd } : {}), ...(reqs ? { maxRequests: Number(reqs[1]) } : {}), ttlMs };
}

/* ------------------------------------------------------------------ */
/* HTTP: /api/spend (status), /api/spend/consent (the user's words).   */
/* ------------------------------------------------------------------ */

interface SpendReq { method?: string; url?: string; headers?: Record<string, string | string[] | undefined>; on?: (event: "data" | "end" | "error", fn: (chunk?: unknown) => void) => void }
interface SpendRes { statusCode?: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }

/** Header the composer and the voice input set; nothing else in LÉLU sends it. */
export const CONSENT_HEADER = "x-lelu-user-consent";
export const CONSENT_SOURCES = new Set(["typed", "spoken"]);

export function createSpendApi(policy: () => SpendPolicy = spendPolicy) {
  const json = (res: SpendRes, payload: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  };
  const body = (req: SpendReq) =>
    new Promise<string>((resolve) => {
      let raw = "";
      if (!req.on) return resolve("");
      req.on("data", (c) => { raw += String(c); if (raw.length > 4096) raw = raw.slice(0, 4096); });
      req.on("end", () => resolve(raw));
      req.on("error", () => resolve(""));
    });
  const handle = (req: SpendReq, res: SpendRes, next: () => void) => {
    const url = (req.url ?? "").replace(/^\/api\/spend/, "") || "/";
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" && (url === "/" || url.startsWith("/?"))) {
      json(res, { ok: true, default: "no paid use without your explicit authorization", grants: policy().grants(), audit: policy().audit(30) });
      return;
    }
    if (method === "POST" && url.startsWith("/consent")) {
      void (async () => {
        const origin = String(req.headers?.origin ?? "");
        const host = String(req.headers?.host ?? "");
        if (origin && host && !origin.endsWith(`//${host}`)) return json(res, { ok: false, error: "Cross-origin consent is refused." }, 403);
        const source = String(req.headers?.[CONSENT_HEADER] ?? "");
        if (!CONSENT_SOURCES.has(source)) return json(res, { ok: false, error: "Consent is accepted only from the user's own typed or spoken words." }, 403);
        let text = "";
        try { text = String((JSON.parse(await body(req)) as { text?: unknown }).text ?? ""); } catch { text = ""; }
        const parsed = parseSpendConsent(text);
        if (!parsed) return json(res, { ok: true, granted: null });
        if (parsed.kind === "revoke") return json(res, { ok: true, revoked: policy().revokeAll(`user (${source}): ${text}`) });
        const grant = policy().authorize({ service: parsed.service, maxUsd: parsed.maxUsd, maxRequests: parsed.maxRequests, ttlMs: parsed.ttlMs, consent: `${source}: ${text}` });
        json(res, { ok: true, granted: { id: grant.id, service: grant.service, maxUsd: grant.maxUsd ?? null, maxRequests: grant.maxRequests, expiresAt: grant.expiresAt, cost: costOf(grant.service).why, costKnown: grant.service === "openrouter" ? "OpenRouter reports cost per call; the ceiling is enforced on it" : "cost per call is not reported by this provider in advance; the request count and expiry bound it" } });
      })();
      return;
    }
    next();
  };
  return { handle, attach: (m: { use: (p: string, h: (req: SpendReq, res: SpendRes, next: () => void) => void) => void }) => m.use("/api/spend", handle) };
}
