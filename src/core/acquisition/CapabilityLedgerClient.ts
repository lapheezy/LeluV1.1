/**
 * ==========================================================
 * LÉLU — CAPABILITY LEDGER CLIENT
 *
 * Brings the server's capability ledger (plugins/capabilityLedger.ts —
 * shared by every session and device signed in to this LÉLU) into the
 * runtime's EXISTING controls; it adds none of its own:
 *
 *   CapabilityRegistry     what she knows she can do (cache of the ledger)
 *   CapabilityActivation   which tools the dispatcher may offer and run —
 *                          toolPermitted() and dispatchToolCall() already
 *                          refuse a disabled capability's tools
 *
 * Rules applied on every hydrate:
 *   registered / runtime-verified   → registry "available", tools enabled
 *   approved (registration was interrupted) → finish registering, then as above
 *   revoked / deprecated            → registry "disabled", tools disabled
 *   anything else                   → recorded as pending; a LEDGER-GATED
 *                                     tool stays disabled
 *
 * Ledger-gated tools are shipped code that is switched OFF until the user
 * approves the capability that provides it. The last ledger snapshot is
 * cached locally, so a gated tool stays in the right state offline and in
 * the moment between boot and the first hydrate.
 *
 * The user's own words decide approvals and revocations
 * (captureCapabilityDecision, called only by the chat composer and voice
 * input). The tool layer cannot: its requests carry x-lelu-tool-call and the
 * server refuses them.
 * ==========================================================
 */
import KvStore from "../storage/KvStore";
import { sessionAuthHeader } from "../persistence/sessionAuth";

/** Tools that exist only to provide a ledger capability: off unless that capability is active. */
export const LEDGER_GATED_TOOLS: Readonly<Record<string, string>> = {
  "world.gltf": "world-export-gltf",
};

export interface LedgerRecord {
  id: string;
  name: string;
  tools: string[];
  source?: string;
  state: string;
  active: boolean;
  stale: string[];
  approval?: { approver: string; basis: string; consent: string; at: string };
  history: Array<{ state: string; at: string; actor: string }>;
}

const CACHE_KEY = "lelu.capabilityLedger.v1";
const REFRESH_MS = 60_000;
const DECISION = /\b(approve|authori[sz]e|revoke|disable|withdraw)\s+(?:the\s+)?capability\s+[`"']?[a-z0-9]/i;

export default class CapabilityLedgerClient {
  private static instance: CapabilityLedgerClient | null = null;
  static getInstance(): CapabilityLedgerClient {
    return (this.instance ??= new CapabilityLedgerClient());
  }
  static resetForTests(): void {
    this.instance = null;
  }

  private records: LedgerRecord[] = [];
  private started = false;
  private reported = new Set<string>();
  public lastHydratedAt = 0;

  /** Synchronous: apply the cached snapshot (gated tools off until proven active). */
  init(): void {
    if (this.started) return;
    this.started = true;
    try {
      this.records = KvStore.getInstance().get<LedgerRecord[]>(CACHE_KEY) ?? [];
    } catch {
      this.records = [];
    }
    void this.apply(this.records, false);
    void this.hydrate();
    if (typeof window !== "undefined") {
      setInterval(() => void this.hydrate(), REFRESH_MS);
      window.addEventListener("focus", () => void this.hydrate());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void this.hydrate();
      });
    }
    void this.watchRuntime();
  }

  list(): LedgerRecord[] {
    return this.records;
  }

  async hydrate(): Promise<LedgerRecord[]> {
    if (typeof fetch === "undefined") return this.records;
    try {
      const response = await fetch("/api/resources/capabilities", { headers: { ...sessionAuthHeader() } });
      if (!response.ok) return this.records;
      const body = (await response.json()) as { capabilities?: LedgerRecord[] };
      this.records = body.capabilities ?? [];
      this.lastHydratedAt = Date.now();
      try { KvStore.getInstance().set(CACHE_KEY, this.records); } catch { /* cache is best effort */ }
      await this.apply(this.records, true);
    } catch {
      /* offline: the cached snapshot stays applied */
    }
    return this.records;
  }

  private async apply(records: LedgerRecord[], online: boolean): Promise<void> {
    const [{ default: CapabilityRegistry }, { default: CapabilityActivation }] = await Promise.all([
      import("../selfdev/CapabilityRegistry"),
      import("./CapabilityActivation"),
    ]);
    const registry = CapabilityRegistry.getInstance();
    const activation = CapabilityActivation.getInstance();
    const activeTools = new Set<string>();

    for (const record of records) {
      // Recovery: approved by the user, but the registration step never completed.
      if (online && record.state === "approved") {
        try {
          const response = await fetch("/api/resources/capabilities/register", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...sessionAuthHeader() },
            body: JSON.stringify({ capability: record.id }),
          });
          const body = (await response.json()) as { ok?: boolean; capability?: LedgerRecord };
          if (body.ok && body.capability) Object.assign(record, body.capability, { active: true });
        } catch { /* retried on the next hydrate */ }
      }
      const status = record.active ? "available" : record.state === "revoked" || record.state === "deprecated" ? "disabled" : "planned";
      const entry = {
        name: record.name,
        description: `Capability ledger: ${record.state}${record.source ? `; provided by ${record.source}` : ""}${record.approval ? `; approved by ${record.approval.approver}` : ""}${record.stale.length ? `; STALE: ${record.stale.join(", ")}` : ""}.`,
        status: status as "available" | "disabled" | "planned",
        requiredTools: record.tools,
        dependencies: record.source ? [record.source] : [],
        tests: record.history.filter((h) => h.state === "sandbox-verified" || h.state === "runtime-verified").map((h) => `${h.state} ${h.at}`),
        version: record.history.at(-1)?.at.slice(0, 10) ?? "",
      };
      if (registry.get(record.id)) registry.update(record.id, entry);
      else registry.add({ id: record.id, requiredProviders: [], requiredAgents: [], requiredKnowledge: [], limitations: [], ...entry });

      if (record.active) {
        activation.setCapability(record.id, true, record.tools);
        for (const tool of record.tools) activeTools.add(tool);
      } else if (record.state === "revoked" || record.state === "deprecated") {
        activation.setCapability(record.id, false, record.tools);
      }
    }
    // A gated tool is on only while an active record provides it.
    for (const [tool, capability] of Object.entries(LEDGER_GATED_TOOLS)) {
      if (!activeTools.has(tool)) activation.setCapability(capability, false, [tool]);
    }
  }

  /** The first successful run of a registered capability's tool is recorded as its runtime verification. */
  private async watchRuntime(): Promise<void> {
    const { default: AgentEventBus } = await import("../agent/AgentEvents");
    AgentEventBus.getInstance().subscribe((event) => {
      if (event.type !== "tool_result" || event.status !== "complete") return;
      const tool = String(event.tool ?? "").replace(/_/g, ".");
      const record = this.records.find((r) => r.active && r.state === "registered" && r.tools.includes(tool));
      if (!record || this.reported.has(record.id) || typeof fetch === "undefined") return;
      this.reported.add(record.id);
      void fetch("/api/resources/capabilities/runtime-verified", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionAuthHeader() },
        body: JSON.stringify({ capability: record.id, tool, result: String(event.result ?? "").slice(0, 300) }),
      }).then(() => this.hydrate()).catch(() => this.reported.delete(record.id));
    });
  }
}

/**
 * The user's own typed or spoken words → an approval or revocation.
 * Called ONLY by GenesisChat (typed) and VoiceEngine (spoken); the server
 * parses the words itself and refuses anything marked as a tool call.
 */
export async function captureCapabilityDecision(text: string, source: "typed" | "spoken"): Promise<{ note: string } | null> {
  if (!DECISION.test(text) || typeof fetch === "undefined") return null;
  try {
    const response = await fetch("/api/resources/capabilities/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-lelu-user-consent": source, ...sessionAuthHeader() },
      body: JSON.stringify({ text }),
    });
    const body = (await response.json()) as { ok?: boolean; action?: string; capability?: { id: string; state: string }; error?: string };
    await CapabilityLedgerClient.getInstance().hydrate();
    if (!body.ok) return { note: `CAPABILITY DECISION: not applied — ${body.error ?? "refused"}. Tell the user exactly this.` };
    return {
      note:
        `CAPABILITY DECISION: the user ${body.action === "approve" ? "approved" : "revoked"} capability "${body.capability?.id}"; ` +
        `it is now ${CapabilityLedgerClient.getInstance().list().find((r) => r.id === body.capability?.id)?.state ?? body.capability?.state}. Confirm this in one short sentence.`,
    };
  } catch {
    return null;
  }
}
