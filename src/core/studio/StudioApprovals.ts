/**
 * ==========================================================
 * LÉLU — SESSION 3C: APPROVALS
 *
 * Protected acts — production deploys, paid services, production
 * databases, authentication/security changes, secret management and
 * LÉLU CORE changes — stop here and wait for a person.
 *
 * The separation is structural, exactly as it is for
 * EngineeringAuthorization: LÉLU's tools can REQUEST an approval; only a
 * deliberate user action in the Studio panel can GRANT one. The queue is
 * deliberately NOT persisted: a reload must never restore an authority
 * nobody has just given. Approvals are scoped to one project and one
 * action, and they expire.
 * ==========================================================
 */

import type { ProtectedAction, StudioApproval } from "./StudioProjectTypes";
import { isProtectedAction } from "./StudioProjectTypes";

export const APPROVAL_TTL_MS = 15 * 60 * 1000;

function makeId(): string {
  return `approval-${crypto.randomUUID().slice(0, 8)}`;
}

export const PROTECTED_ACTION_LABELS: Record<ProtectedAction, string> = {
  "production-deploy": "Publish to production",
  "paid-service": "Activate a paid service",
  "production-database": "Modify a production database",
  "auth-security": "Change authentication or security",
  "secret-management": "Create, rotate or expose a secret",
  "lelu-core": "Change protected LÉLU CORE",
};

export default class StudioApprovals {
  private static instance: StudioApprovals | null = null;
  private queue: StudioApproval[] = [];

  public static getInstance(): StudioApprovals {
    if (!StudioApprovals.instance) StudioApprovals.instance = new StudioApprovals();
    return StudioApprovals.instance;
  }

  public static resetForTests(): StudioApprovals {
    StudioApprovals.instance = new StudioApprovals();
    return StudioApprovals.instance;
  }

  private expire(): void {
    const now = Date.now();
    this.queue = this.queue.map((approval) =>
      approval.status === "pending" && now > approval.expiresAt
        ? { ...approval, status: "expired" as const }
        : approval,
    );
  }

  /** Called by a tool, on LÉLU's behalf. Never grants anything. */
  public request(input: {
    projectId: string;
    action: string;
    reason: string;
    scope?: string[];
  }): StudioApproval {
    if (!isProtectedAction(input.action)) {
      throw new Error(
        `"${input.action}" is not a protected action; work that needs no approval should proceed directly.`,
      );
    }
    const reason = input.reason.trim();
    if (reason.length < 12) {
      throw new Error(
        "An approval request must say what would happen and why — at least a sentence, not a label.",
      );
    }
    const now = Date.now();
    const approval: StudioApproval = {
      id: makeId(),
      projectId: input.projectId,
      action: input.action,
      reason,
      requestedAt: now,
      expiresAt: now + APPROVAL_TTL_MS,
      status: "pending",
      decidedAt: null,
      decidedBy: null,
      scope: [...(input.scope ?? [])],
    };
    this.queue = [...this.queue, approval].slice(-30);
    return approval;
  }

  public list(projectId?: string): StudioApproval[] {
    this.expire();
    return this.queue.filter((approval) => !projectId || approval.projectId === projectId);
  }

  public get(id: string): StudioApproval | null {
    this.expire();
    return this.queue.find((approval) => approval.id === id) ?? null;
  }

  /**
   * A PERSON's decision. The Studio panel calls this from a click handler;
   * no tool executor calls it, so a model cannot approve its own request.
   */
  public decide(id: string, decision: "approved" | "denied", decidedBy: string): StudioApproval {
    this.expire();
    const approval = this.get(id);
    if (!approval) throw new Error(`No approval "${id}".`);
    if (!decidedBy.trim()) {
      throw new Error("An approval decision needs the identity of the person making it.");
    }
    if (approval.status !== "pending") {
      throw new Error(`Approval "${id}" is already ${approval.status}.`);
    }
    const next: StudioApproval = {
      ...approval,
      status: decision,
      decidedAt: Date.now(),
      decidedBy: decidedBy.trim(),
    };
    this.queue = this.queue.map((item) => (item.id === id ? next : item));
    return next;
  }

  /** The live authorization for a project + action, or null. */
  public authorizationFor(projectId: string, action: ProtectedAction): StudioApproval | null {
    this.expire();
    const approval = this.queue.find(
      (item) =>
        item.projectId === projectId &&
        item.action === action &&
        item.status === "approved" &&
        Date.now() < item.expiresAt,
    );
    return approval ?? null;
  }

  public pending(projectId: string): StudioApproval[] {
    return this.list(projectId).filter((approval) => approval.status === "pending");
  }
}
