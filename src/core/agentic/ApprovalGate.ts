/**
 * ==========================================================
 * LÉLU — APPROVAL GATE
 *
 * A human decision on ONE specific action, before it runs.
 *
 * The autonomy level answers "may LÉLU do this kind of thing
 * at all?". It cannot answer "may she do THIS, now?" — so
 * until now a sensitive tool was either refused outright or,
 * at a high enough level, run without asking. The Orchestrator
 * emitted approval_requested events, and the execution timeline
 * renders them with Approve / Reject buttons, but nothing ever
 * waited for the answer.
 *
 * This is the part that waits:
 *
 *   • request()  persists a pending approval and emits
 *                approval_requested (the existing UI shows it);
 *   • the answer arrives as approval_resolved on the event bus
 *                — from that UI, or from decide() here;
 *   • consume()  lets the dispatcher run the approved call ONCE,
 *                and only with the exact tool and arguments the
 *                human saw. A changed argument is a new request.
 *
 * An approval grants "Execute approved" (autonomy L3) for that
 * single call. It never lifts a destructive (L4) action above
 * the configured autonomy level, and never replaces the
 * separate project authorization that project.apply needs.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import KvStore from "../storage/KvStore";
import ToolRegistry from "../tools/ToolRegistry";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  stepId?: string;
  tool: string;
  args: Record<string, unknown>;
  argsHash: string;
  title: string;
  detail: string;
  systemsAffected: string[];
  status: ApprovalStatus;
  requestedAt: number;
  decidedAt?: number;
  /** Set once the approved call has run; an approval is single-use. */
  usedAt?: number;
}

type DecisionListener = (request: ApprovalRequest) => void;

const KEY = "lelu.approvals.v1";
const SENSITIVE_PERMISSIONS = new Set(["DESTRUCTIVE", "EXTERNAL_ACTION", "SENSITIVE"]);

/** Key-order-independent serialisation, so {a,b} and {b,a} hash alike. */
export function stableHash(value: unknown): string {
  const normalise = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalise);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>)
          .sort()
          .map((key) => [key, normalise((input as Record<string, unknown>)[key])]),
      );
    }
    return input;
  };
  return JSON.stringify(normalise(value ?? {}));
}

export default class ApprovalGate {
  private static instance: ApprovalGate | null = null;
  private requests: ApprovalRequest[];
  private listeners = new Set<DecisionListener>();

  private constructor() {
    this.requests = KvStore.getInstance().get<ApprovalRequest[]>(KEY) ?? [];
    AgentEventBus.getInstance().subscribe((event) => {
      if (event.type !== "approval_resolved") return;
      this.apply(event.approvalId, event.decision);
    });
  }

  public static getInstance(): ApprovalGate {
    if (!ApprovalGate.instance) ApprovalGate.instance = new ApprovalGate();
    return ApprovalGate.instance;
  }

  /**
   * Does running this tool need a human decision first?
   *
   * External actions (risk 3), destructive ones (risk 4) and anything the
   * registry marks DESTRUCTIVE / EXTERNAL_ACTION / SENSITIVE.
   */
  public requiresApproval(toolId: string): { required: boolean; reason: string } {
    const definition = ToolRegistry.getInstance().get(toolId);
    if (!definition) return { required: false, reason: "unknown tool" };
    if (definition.riskLevel >= 3) {
      return {
        required: true,
        reason: definition.riskLevel === 4 ? "irreversible action" : "acts outside LÉLU's own state",
      };
    }
    const flagged = definition.permissions.find((permission) => SENSITIVE_PERMISSIONS.has(permission));
    if (flagged) return { required: true, reason: `${flagged.toLowerCase().replace("_", " ")} permission` };
    return { required: false, reason: "low-risk" };
  }

  /**
   * Ask. Re-asking for the same task step and the same call returns the
   * existing request instead of stacking duplicates in the UI.
   */
  public request(input: {
    taskId: string;
    stepId?: string;
    tool: string;
    args: Record<string, unknown>;
    title: string;
    detail: string;
    systemsAffected?: string[];
  }): ApprovalRequest {
    const argsHash = stableHash(input.args);
    const existing = this.requests.find(
      (request) =>
        request.taskId === input.taskId &&
        request.stepId === input.stepId &&
        request.tool === input.tool &&
        request.argsHash === argsHash &&
        !request.usedAt &&
        request.status !== "rejected",
    );
    if (existing) return existing;

    const request: ApprovalRequest = {
      id: `approval-${crypto.randomUUID()}`,
      taskId: input.taskId,
      ...(input.stepId ? { stepId: input.stepId } : {}),
      tool: input.tool,
      args: input.args,
      argsHash,
      title: input.title,
      detail: input.detail,
      systemsAffected: input.systemsAffected ?? [input.tool],
      status: "pending",
      requestedAt: Date.now(),
    };
    this.requests.unshift(request);
    this.persist();
    AgentEventBus.getInstance().emit({
      type: "approval_requested",
      taskId: request.taskId,
      approvalId: request.id,
      title: request.title,
      detail: request.detail,
      systemsAffected: request.systemsAffected,
    });
    return request;
  }

  /**
   * Decide from code (chat command, test, another surface). Goes through
   * the event bus so every listener — this gate, the timeline, the
   * executive — sees one decision, the same way the UI's buttons do.
   */
  public decide(approvalId: string, decision: "approved" | "rejected"): ApprovalRequest | undefined {
    const request = this.get(approvalId);
    if (!request) return undefined;
    AgentEventBus.getInstance().emit({
      type: "approval_resolved",
      taskId: request.taskId,
      approvalId,
      decision,
    });
    return this.get(approvalId);
  }

  /**
   * Spend an approval on the call it was granted for.
   *
   * True only for an approved, unused request whose tool and arguments
   * match exactly. The approval is consumed by the check, so a second run
   * of the same call has to be asked for again.
   */
  public consume(approvalId: string, tool: string, args: Record<string, unknown>): boolean {
    const request = this.get(approvalId);
    if (!request || request.status !== "approved" || request.usedAt) return false;
    if (request.tool !== tool || request.argsHash !== stableHash(args)) return false;
    request.usedAt = Date.now();
    this.persist();
    return true;
  }

  public get(approvalId: string): ApprovalRequest | undefined {
    return this.requests.find((request) => request.id === approvalId);
  }

  public pending(): ApprovalRequest[] {
    return this.requests.filter((request) => request.status === "pending");
  }

  public onDecision(listener: DecisionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(approvalId: string, decision: "approved" | "rejected" | "modified"): void {
    const request = this.get(approvalId);
    if (!request || request.status !== "pending") return;
    // "modified" means the human wanted something different from what was
    // shown. LÉLU cannot know what, so she does not run the original.
    request.status = decision === "approved" ? "approved" : "rejected";
    request.decidedAt = Date.now();
    this.persist();
    for (const listener of this.listeners) {
      try {
        listener(request);
      } catch (error) {
        console.error("[ApprovalGate] listener failed:", error);
      }
    }
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.requests.slice(0, 200));
    } catch {
      /* best-effort */
    }
  }

  /** Re-read persisted requests (a fresh start reads the same state). */
  public reload(): void {
    this.requests = KvStore.getInstance().get<ApprovalRequest[]>(KEY) ?? [];
  }
}
