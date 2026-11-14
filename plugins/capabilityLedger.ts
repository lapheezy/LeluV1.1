/**
 * ==========================================================
 * LÉLU — CAPABILITY LEDGER (server authority)
 *
 * The durable, cross-session record of capabilities LÉLU develops for
 * herself. Browser CapabilityRegistry entries are a cache of this ledger;
 * every device signed in to the same LÉLU server (one owner, the access
 * gate's session) reads the same file, and it survives restarts.
 *
 * Lifecycle (every transition is appended to the record's history and to
 * .lelu-state/resources/log.jsonl, with its evidence and actor):
 *
 *   discovered → evaluated → sandbox-testing → sandbox-verified →
 *   awaiting-approval → approved → registered → runtime-verified
 *   (any) → revoked | deprecated
 *
 * Who may do what:
 *   model / tools   discover, evaluate, sandbox, propose, register an
 *                   APPROVED capability, report a runtime verification
 *   the human       approve and revoke — only from the user's own typed or
 *                   spoken words (x-lelu-user-consent), never from a tool
 *                   call (x-lelu-tool-call), checked here on the server
 *
 * Records hold metadata and evidence only: names, versions, ids, short
 * stdout excerpts. Never a key, token or environment value.
 * ==========================================================
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

export const LIFECYCLE = [
  "discovered", "evaluated", "sandbox-testing", "sandbox-verified", "awaiting-approval",
  "approved", "registered", "runtime-verified", "revoked", "deprecated",
] as const;
export type LifecycleState = (typeof LIFECYCLE)[number];

export interface LedgerEvent {
  state: LifecycleState;
  at: string;
  actor: string;
  evidence: Record<string, unknown>;
}

export interface CapabilityRecord {
  id: string;
  name: string;
  /** The executable tools this capability provides. */
  tools: string[];
  /** What provides it: package@version, or an installed module being reused. */
  source?: string;
  version?: string;
  license?: string;
  sandboxId?: string;
  state: LifecycleState;
  approval?: { approver: string; basis: string; consent: string; at: string };
  revoked?: { at: string; reason: string; by: string };
  history: LedgerEvent[];
  createdAt: string;
  updatedAt: string;
}

/** Transitions that may happen from each state (revoke/deprecate are allowed from anywhere). */
const NEXT: Record<LifecycleState, LifecycleState[]> = {
  discovered: ["discovered", "evaluated"],
  evaluated: ["evaluated", "sandbox-testing", "discovered"],
  "sandbox-testing": ["sandbox-verified", "evaluated", "sandbox-testing"],
  "sandbox-verified": ["awaiting-approval", "sandbox-testing", "sandbox-verified"],
  "awaiting-approval": ["approved", "awaiting-approval"],
  approved: ["registered"],
  registered: ["runtime-verified", "registered"],
  "runtime-verified": ["runtime-verified", "registered"],
  revoked: ["awaiting-approval"],
  deprecated: ["awaiting-approval"],
};

const SECRETISH = /(key|token|secret|password|authorization|cookie)/i;

function scrub(evidence: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(evidence)) {
    if (SECRETISH.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 600).replace(/\b(sk|gsk|fc|ghp|pk)[-_][A-Za-z0-9_-]{12,}\b/g, "[redacted]");
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => (typeof x === "string" ? x.slice(0, 200) : x));
    else if (typeof v === "object") {
      const text = JSON.stringify(v);
      out[k] = text.length <= 2000 && !SECRETISH.test(text) ? v : `${text.slice(0, 600).replace(/"[^"]*(key|token|secret|password)[^"]*"\s*:\s*"[^"]*"/gi, '"[redacted]"')}…`;
    }
  }
  return out;
}

export class TransitionError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 409) {
    super(message);
  }
}

export function createCapabilityLedger(stateDir: string, now: () => Date = () => new Date()) {
  const file = path.join(stateDir, "capabilities.json");
  const logFile = path.join(stateDir, "log.jsonl");

  const load = (): Record<string, CapabilityRecord> => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Record<string, CapabilityRecord>;
    } catch {
      return {};
    }
  };
  // Atomic: a write interrupted mid-way leaves the previous ledger intact.
  const save = (all: Record<string, CapabilityRecord>) => {
    mkdirSync(stateDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 1));
    renameSync(tmp, file);
  };
  const audit = (entry: Record<string, unknown>) => {
    try {
      mkdirSync(stateDir, { recursive: true });
      appendFileSync(logFile, `${JSON.stringify({ at: now().toISOString(), ...entry })}\n`);
    } catch { /* never break a transition on logging */ }
  };

  const validId = (id: string) => /^[a-z0-9][a-z0-9._-]{1,63}$/.test(id);

  function transition(
    id: string,
    state: LifecycleState,
    actor: string,
    evidence: Record<string, unknown>,
    init?: Partial<Pick<CapabilityRecord, "name" | "tools" | "source" | "version" | "license" | "sandboxId">>,
  ): CapabilityRecord {
    if (!validId(id)) throw new TransitionError(`"${id}" is not a valid capability id`, "invalid_id", 400);
    const all = load();
    const at = now().toISOString();
    const existing = all[id];
    if (existing && state !== "revoked" && state !== "deprecated" && !NEXT[existing.state].includes(state)) {
      throw new TransitionError(`"${id}" is ${existing.state}; it cannot move to ${state}`, "invalid_transition");
    }
    const record: CapabilityRecord = existing ?? {
      id, name: init?.name ?? id, tools: init?.tools ?? [], state, history: [], createdAt: at, updatedAt: at,
    };
    if (init) {
      if (init.name) record.name = init.name;
      if (init.tools?.length) record.tools = [...new Set(init.tools)];
      for (const key of ["source", "version", "license", "sandboxId"] as const) if (init[key]) record[key] = init[key];
    }
    record.state = state;
    record.updatedAt = at;
    const clean = scrub(evidence);
    record.history.push({ state, at, actor, evidence: clean });
    if (record.history.length > 60) record.history = record.history.slice(-60);
    all[id] = record;
    save(all);
    audit({ action: "capability-transition", id, state, actor, evidence: clean });
    return record;
  }

  return {
    file,
    list: (): CapabilityRecord[] => Object.values(load()),
    get: (id: string): CapabilityRecord | undefined => load()[id],
    transition,
    /** Approval: only the human pathway calls this (enforced by the API layer). */
    approve(id: string, approval: { approver: string; basis: string; consent: string }): CapabilityRecord {
      const record = load()[id];
      if (!record) throw new TransitionError(`No capability "${id}" is awaiting approval`, "not_found", 404);
      if (record.state !== "awaiting-approval") throw new TransitionError(`"${id}" is ${record.state}, not awaiting approval`, "invalid_transition");
      const out = transition(id, "approved", approval.approver, { basis: approval.basis, consent: approval.consent });
      const all = load();
      all[id] = { ...out, approval: { ...approval, at: out.updatedAt } };
      save(all);
      return all[id];
    },
    revoke(id: string, by: string, reason: string, state: "revoked" | "deprecated" = "revoked"): CapabilityRecord {
      if (!load()[id]) throw new TransitionError(`No capability "${id}"`, "not_found", 404);
      const out = transition(id, state, by, { reason });
      const all = load();
      all[id] = { ...out, revoked: { at: out.updatedAt, reason, by } };
      save(all);
      return all[id];
    },
    exists: () => existsSync(file),
  };
}

export type CapabilityLedger = ReturnType<typeof createCapabilityLedger>;

/** Active = the dispatcher may run its tools. */
export const isActive = (record: CapabilityRecord) => record.state === "registered" || record.state === "runtime-verified";

/** "approve capability X" / "revoke capability X" in the user's own words. */
export function parseCapabilityDecision(text: string): { action: "approve" | "revoke"; id: string } | null {
  const t = text.trim();
  if (/\b(don'?t|do not|never|not)\s+(approve|authori[sz]e|revoke)\b/i.test(t)) return null;
  const approve = /\b(?:i\s+)?(?:approve|authori[sz]e)\s+(?:the\s+)?capability\s+[`"']?([a-z0-9][a-z0-9._-]{1,63})/i.exec(t);
  if (approve) return { action: "approve", id: approve[1].toLowerCase() };
  const revoke = /\b(?:revoke|disable|withdraw)\s+(?:the\s+)?capability\s+[`"']?([a-z0-9][a-z0-9._-]{1,63})/i.exec(t);
  if (revoke) return { action: "revoke", id: revoke[1].toLowerCase() };
  return null;
}
