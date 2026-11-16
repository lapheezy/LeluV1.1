/**
 * ==========================================================
 * LÉLU — AUTHORIZATION POLICY (OPA / Rego semantics)
 *
 * One place decides whether an ACTION on a RESOURCE by a
 * SUBJECT is permitted, needs a human approval, or is refused.
 * It is the policy half of the security gateway; the
 * relationship half (OpenFGA) lives in security/authz.
 *
 * DIVISION OF LABOUR — the two are not interchangeable:
 *   RelationshipStore (OpenFGA)  "is this user related to this
 *                                device/workspace/project, and
 *                                for how long?"
 *   this module (OPA)            "given that relationship, is
 *                                THIS action permitted under
 *                                policy, and does it need an
 *                                approval?"
 *
 * A relationship that exists does not authorise an action; a
 * permissive policy does not create a relationship. Both must
 * agree, and the adapter registry requires both.
 *
 * THE REFERENCE IMPLEMENTATION IS NOT A SIMULATION
 * ------------------------------------------------
 * `evaluatePolicy` is a complete, deterministic implementation of
 * the same rules as policies/lelu/authorization.rego. It exists
 * for the browser, where no OPA process can run, and as the
 * differential-test partner that proves the Rego agrees with it
 * (tests/policy-parity.test.ts evaluates both on the same inputs).
 * When the server binary is present the server path uses real OPA
 * and says so (`engine: "opa"`); it never claims OPA when it fell
 * back.
 * ==========================================================
 */

import type { CapabilityAction, ExecutionEnvironment } from "../integration/protocol.ts";

export type SubjectKind = "user" | "agent" | "service" | "device";

export interface PolicySubject {
  kind: SubjectKind;
  userId: string | null;
  agentId: string | null;
  sessionId: string | null;
}

export interface PolicyResource {
  kind: "file" | "repository" | "workspace" | "project" | "device" | "database" | "external_api" | "shell" | "deployment" | "secret";
  id: string;
  /** The user who owns the resource, when it has an owner. */
  ownerId?: string;
}

export interface PolicyContext {
  autonomyLevel: number;
  environment: ExecutionEnvironment;
  /** A human approval covering this exact call. */
  approvalId?: string;
  /**
   * Whether that approval is live. The caller must have checked
   * it; this module never assumes an id is enough.
   */
  approvalValid?: boolean;
  /** Whether the OpenFGA relationship check passed for a device. */
  deviceAuthorized?: boolean;
  /**
   * True when an agent is the subject AND is trying to widen its
   * own authority. Always refused, whatever else is true.
   */
  agentSelfElevation?: boolean;
}

export type PolicyRisk = "low" | "medium" | "high" | "critical";

export type PolicySubjectInput = PolicySubject;

export interface PolicyInput {
  subject: PolicySubject;
  action: CapabilityAction;
  resource: PolicyResource;
  context: PolicyContext;
}

export interface PolicyDecision {
  /** Whether the action may run at all. */
  allowed: boolean;
  /** Whether it may run only with a human approval. */
  requiresApproval: boolean;
  /** Human-readable reason — always populated, allowed or not. */
  reason: string;
  action: CapabilityAction;
  risk: PolicyRisk;
  /** Which evaluator produced this: never claim OPA when it is reference. */
  engine: "opa" | "reference";
  /** Rules that contributed, for the audit trail. */
  rules: string[];
}

/**
 * The minimum autonomy level per action.
 *
 * These mirror AutonomyGate's own ladder: 0 Observe, 2 Sandbox,
 * 3 Execute approved, 4 Project, 5 Production. Installing,
 * deleting, deploying and administering are never available below
 * project/production authority.
 */
export const ACTION_MIN_AUTONOMY: Record<CapabilityAction, number> = {
  READ: 0,
  WRITE: 2,
  EXECUTE: 3,
  ACCESS_EXTERNAL_DEVICE: 3,
  INSTALL: 4,
  DELETE: 4,
  DEPLOY: 5,
  ADMINISTER: 5,
};

/** Actions that always need a human decision, at any autonomy level. */
export const APPROVAL_REQUIRED: ReadonlySet<CapabilityAction> = new Set<CapabilityAction>([
  "INSTALL",
  "DELETE",
  "DEPLOY",
  "ADMINISTER",
]);

/** Risk classification, used by the audit log and the security centre. */
export const ACTION_RISK: Record<CapabilityAction, PolicyRisk> = {
  READ: "low",
  WRITE: "medium",
  EXECUTE: "high",
  ACCESS_EXTERNAL_DEVICE: "high",
  INSTALL: "critical",
  DELETE: "critical",
  DEPLOY: "critical",
  ADMINISTER: "critical",
};

/** Actions a device subject may ever perform. */
const DEVICE_ACTIONS: ReadonlySet<CapabilityAction> = new Set<CapabilityAction>([
  "READ",
  "ACCESS_EXTERNAL_DEVICE",
]);

/** Actions an agent may never perform on the user's behalf. */
const AGENT_FORBIDDEN: ReadonlySet<CapabilityAction> = new Set<CapabilityAction>(["ADMINISTER", "DEPLOY"]);

/** Actions that change what is stored, and therefore need ownership. */
const OWNED_ACTIONS: ReadonlySet<CapabilityAction> = new Set<CapabilityAction>(["WRITE", "DELETE"]);

function deny(reason: string, input: PolicyInput, rules: string[]): PolicyDecision {
  return {
    allowed: false,
    requiresApproval: false,
    reason,
    action: input.action,
    risk: ACTION_RISK[input.action],
    engine: "reference",
    rules,
  };
}

/**
 * Evaluate one decision.
 *
 * Order is deliberate and matches the Rego: identity, then
 * self-elevation, then subject-kind limits, then ownership, then
 * autonomy, then environment, then approval. The FIRST failing
 * rule is the reason reported, so a refusal names the real cause
 * rather than a generic "denied".
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { subject, action, resource, context } = input;
  const rules: string[] = [];

  if (context.agentSelfElevation === true) {
    return deny("An agent may never elevate its own privileges.", input, ["deny_self_elevation"]);
  }

  const identified =
    (subject.kind === "user" && !!subject.userId) ||
    (subject.kind === "agent" && !!subject.agentId) ||
    (subject.kind === "service" && !!subject.sessionId) ||
    (subject.kind === "device" && !!subject.sessionId);
  if (!identified) {
    return deny(`No identified ${subject.kind} subject — anonymous execution is refused.`, input, ["deny_no_identity"]);
  }
  rules.push("subject_identified");

  if (subject.kind === "device" && !DEVICE_ACTIONS.has(action)) {
    return deny(`A device subject may not ${action}; that needs a user or an agent.`, input, ["deny_device_action"]);
  }
  if (subject.kind === "agent" && AGENT_FORBIDDEN.has(action)) {
    return deny(`An agent may not ${action} — only the user may.`, input, ["deny_agent_action"]);
  }
  rules.push("subject_may_act");

  if (
    subject.kind === "user" &&
    resource.ownerId &&
    OWNED_ACTIONS.has(action) &&
    resource.ownerId !== subject.userId
  ) {
    return deny(
      `Cross-user access refused: ${resource.kind} "${resource.id}" belongs to another user.`,
      input,
      ["deny_cross_user"],
    );
  }
  if (resource.ownerId) rules.push("ownership_ok");

  const minimum = ACTION_MIN_AUTONOMY[action];
  if (context.autonomyLevel < minimum) {
    return deny(
      `${action} requires autonomy level ${minimum}; the current level is ${context.autonomyLevel}.`,
      input,
      ["deny_autonomy"],
    );
  }
  rules.push("autonomy_ok");

  if (context.environment === "production" && context.autonomyLevel < 5) {
    return deny("Production actions require autonomy level 5.", input, ["deny_production_autonomy"]);
  }
  if (context.environment === "production") rules.push("production_authorized");

  if (action === "ACCESS_EXTERNAL_DEVICE" && context.deviceAuthorized !== true) {
    return deny(
      "Device access refused: no authorized relationship to that device.",
      input,
      ["deny_device_relationship"],
    );
  }
  if (action === "ACCESS_EXTERNAL_DEVICE") rules.push("device_relationship_ok");

  if (action === "DEPLOY" && context.approvalValid !== true) {
    return deny("Deployment refused: no human approval covers this call.", input, ["deny_deploy_approval"]);
  }

  const requiresApproval = APPROVAL_REQUIRED.has(action);
  if (requiresApproval) rules.push("approval_required");
  if (requiresApproval && context.approvalValid !== true) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: `${action} needs an explicit human approval; none is live for this call.`,
      action,
      risk: ACTION_RISK[action],
      engine: "reference",
      rules: [...rules, "deny_missing_approval"],
    };
  }
  if (requiresApproval) rules.push("approval_present");

  return {
    allowed: true,
    requiresApproval,
    reason: `Permitted: ${subject.kind} may ${action} ${resource.kind} "${resource.id}" at autonomy ${context.autonomyLevel}.`,
    action,
    risk: ACTION_RISK[action],
    engine: "reference",
    rules,
  };
}

/**
 * The Rego input document, in the shape policies/lelu/authorization.rego
 * expects. One builder, so the browser path and the server path cannot
 * disagree about the input.
 */
export function toRegoInput(input: PolicyInput): Record<string, unknown> {
  return {
    subject: {
      kind: input.subject.kind,
      user_id: input.subject.userId ?? "",
      agent_id: input.subject.agentId ?? "",
      session_id: input.subject.sessionId ?? "",
    },
    action: input.action,
    resource: {
      kind: input.resource.kind,
      id: input.resource.id,
      owner_id: input.resource.ownerId ?? "",
    },
    context: {
      autonomy_level: input.context.autonomyLevel,
      environment: input.context.environment,
      approval_valid: input.context.approvalValid === true,
      device_authorized: input.context.deviceAuthorized === true,
      agent_self_elevation: input.context.agentSelfElevation === true,
    },
  };
}

/** Narrow an OPA result document into a PolicyDecision. */
export function fromRegoResult(
  document: Record<string, unknown>,
  input: PolicyInput,
): PolicyDecision {
  const allowed = document.allowed === true;
  const requiresApproval = document.requires_approval === true;
  const rules = Array.isArray(document.rules) ? document.rules.map(String) : [];
  const reason = typeof document.reason === "string" ? document.reason : "Policy returned no reason.";
  return {
    allowed,
    requiresApproval,
    reason,
    action: input.action,
    risk: (typeof document.risk === "string" ? document.risk : ACTION_RISK[input.action]) as PolicyRisk,
    engine: "opa",
    rules,
  };
}
