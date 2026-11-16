/**
 * ==========================================================
 * LÉLU — COSMOS AUTONOMY BOUNDARIES
 *
 * Three colours, one meaning each:
 *
 *   GREEN   she may do it on her own. It changes her own
 *           workspace: navigating, opening a view, arranging
 *           windows, placing an object, restoring what was
 *           there before.
 *
 *   YELLOW  it creates or removes something that outlives the
 *           action — a room, a task, a published extension.
 *           Allowed, but only after a human approval, unless
 *           the human is the one who asked.
 *
 *   RED     protected ground: cognition, authentication,
 *           database security, secrets, production config,
 *           protected core infrastructure. Never autonomous;
 *           always a human approval, and the approval only
 *           covers the exact action that was shown.
 *
 * The classification is a pure function so it can be tested and
 * so every caller (the workspace API, the panel, a future tool)
 * gets the same answer. Approval itself goes through the
 * existing ApprovalGate — this file does not invent a second
 * approval mechanism, it names which actions need the one that
 * already exists.
 *
 * ExtensionJournal is the reversible-expansion half: an
 * experiment is opened with a checkpoint of the state it is
 * about to change, must be VERIFIED before it can be published,
 * and can be rolled back to the checkpoint while it is still a
 * draft. A published extension keeps its record so the activity
 * is visible; a rolled-back one restores the snapshot.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type Boundary = "green" | "yellow" | "red";

export type CosmosAction =
  | "navigate"
  | "open-workspace"
  | "arrange-windows"
  | "restore-workspace"
  | "place-object"
  | "read-file"
  | "open-browser"
  | "switch-project"
  | "create-room"
  | "remove-room"
  | "run-task"
  | "pause-task"
  | "resume-task"
  | "cancel-task"
  | "publish-extension"
  | "change-autonomy"
  | "access-secrets"
  | "alter-database"
  | "modify-auth"
  | "deploy";

export type Actor = "user" | "lelu" | "agent";

export interface BoundaryDecision {
  boundary: Boundary;
  /** May it run at all? */
  allowed: boolean;
  /** Does it need an approval before it runs? */
  requiresApproval: boolean;
  reason: string;
}

const REASONS: Record<CosmosAction, { boundary: Boundary; reason: string }> = {
  navigate: { boundary: "green", reason: "moving through her own environment" },
  "open-workspace": { boundary: "green", reason: "opening a workspace view" },
  "arrange-windows": { boundary: "green", reason: "arranging windows she already has open" },
  "restore-workspace": { boundary: "green", reason: "returning to a saved workspace" },
  "place-object": { boundary: "green", reason: "placing a link to an existing record" },
  "read-file": { boundary: "green", reason: "reading a file into a view" },
  "open-browser": { boundary: "green", reason: "opening a page to read it" },
  "switch-project": { boundary: "green", reason: "changing which project the workspace shows" },
  "create-room": { boundary: "yellow", reason: "adding a place that outlives this action" },
  "remove-room": { boundary: "yellow", reason: "removing a place from the environment" },
  "run-task": { boundary: "yellow", reason: "starting work that continues in the background" },
  "pause-task": { boundary: "yellow", reason: "changing a running task" },
  "resume-task": { boundary: "yellow", reason: "restarting work that was stopped" },
  "cancel-task": { boundary: "yellow", reason: "ending work that is in flight" },
  "publish-extension": { boundary: "yellow", reason: "publishing a verified UI extension" },
  "change-autonomy": { boundary: "red", reason: "changing the boundaries themselves" },
  "access-secrets": { boundary: "red", reason: "secrets and credentials" },
  "alter-database": { boundary: "red", reason: "database security and schema" },
  "modify-auth": { boundary: "red", reason: "authentication and identity" },
  deploy: { boundary: "red", reason: "production configuration and deployment" },
};

/**
 * Classify an action for an actor.
 *
 * A human clicking a yellow action has already consented — the click is
 * the decision. A yellow action LÉLU starts herself has only her own
 * judgement behind it, so it waits for a person. Red never runs on
 * autonomy at all, and still needs approval when a person asks, because
 * "I clicked it" is not the same as "I read what it would change".
 */
export function classifyCosmosAction(action: CosmosAction, actor: Actor = "lelu"): BoundaryDecision {
  const rule = REASONS[action];
  if (!rule) {
    return { boundary: "red", allowed: false, requiresApproval: true, reason: `unknown action "${action}"` };
  }
  const requiresApproval = rule.boundary === "red" || (rule.boundary === "yellow" && actor !== "user");
  return {
    boundary: rule.boundary,
    allowed: !(rule.boundary === "red" && actor !== "user"),
    requiresApproval,
    reason: rule.reason,
  };
}

/** Paths/areas that are protected regardless of what action touches them. */
const PROTECTED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\/)\.env(\.|$)/i, reason: "secrets live in env files" },
  { pattern: /secret|credential|api[-_]?key/i, reason: "secrets and credentials" },
  { pattern: /(^|\/)(auth|authn|authz)(\/|\.|$)/i, reason: "authentication" },
  { pattern: /supabase\/(migrations|functions)/i, reason: "database security" },
  { pattern: /(^|\/)(Bootstrap|MemoryBridge|PromptInjectionGuard|PersonalityGuard)\.ts$/i, reason: "protected core infrastructure" },
  { pattern: /wrangler\.(toml|jsonc?)$/i, reason: "production configuration" },
];

/** Does this target sit on protected ground? */
export function isProtectedTarget(target: string): { protected: boolean; reason: string } {
  for (const rule of PROTECTED_PATTERNS) {
    if (rule.pattern.test(target)) return { protected: true, reason: rule.reason };
  }
  return { protected: false, reason: "" };
}

/* ------------------------------------------------------------------
 * REVERSIBLE EXTENSION EXPANSION
 * ------------------------------------------------------------------ */

export type ExtensionStatus = "draft" | "verified" | "published" | "rolled-back";

export interface ExtensionRecord {
  id: string;
  label: string;
  /** What it intends to change, in words the activity log can show. */
  applies: string[];
  createdAt: number;
  status: ExtensionStatus;
  verifiedAt?: number;
  publishedAt?: number;
  rolledBackAt?: number;
}

export interface ExtensionDraft extends ExtensionRecord {
  snapshot: unknown;
}

const EXTENSION_KEY = "lelu.cosmos.extensions.v1";
const MAX_EXTENSIONS = 100;

export class ExtensionJournal {
  private drafts = new Map<string, ExtensionDraft>();
  private published: ExtensionRecord[] = [];

  constructor(private readonly persistState: (records: ExtensionRecord[]) => void = defaultPersist) {
    this.published = loadPublished();
  }

  list(): ExtensionRecord[] {
    return [...[...this.drafts.values()].map(strip), ...this.published];
  }

  get(id: string): ExtensionDraft | undefined {
    return this.drafts.get(id);
  }

  /** Open an experiment with the state it is about to change. */
  begin(input: { label: string; applies: string[]; snapshot: unknown }): ExtensionDraft {
    const draft: ExtensionDraft = {
      id: `ext-${crypto.randomUUID().slice(0, 8)}`,
      label: input.label,
      applies: [...input.applies],
      createdAt: Date.now(),
      status: "draft",
      snapshot: input.snapshot,
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  /**
   * A draft must be verified by its own checks before it may be shown as
   * done. The check is the caller's: the journal only enforces that one
   * ran and passed.
   */
  verify(id: string, check: () => boolean): boolean {
    const draft = this.drafts.get(id);
    if (!draft || draft.status !== "draft") return false;
    let passed = false;
    try {
      passed = check() === true;
    } catch {
      passed = false;
    }
    if (!passed) return false;
    draft.status = "verified";
    draft.verifiedAt = Date.now();
    return true;
  }

  /** Publish only what was verified. */
  publish(id: string): { ok: boolean; reason: string } {
    const draft = this.drafts.get(id);
    if (!draft) return { ok: false, reason: "no such extension" };
    if (draft.status !== "verified") {
      return { ok: false, reason: "the extension has not passed its checks, so it is not published" };
    }
    draft.status = "published";
    draft.publishedAt = Date.now();
    this.published = [...this.published, strip(draft)].slice(-MAX_EXTENSIONS);
    this.drafts.delete(id);
    this.persistState(this.published);
    return { ok: true, reason: `published "${draft.label}"` };
  }

  /**
   * Undo a draft by restoring the checkpoint it opened with. Returns the
   * snapshot to restore so the caller owns the state it took.
   */
  rollback(id: string): { ok: true; snapshot: unknown } | { ok: false; reason: string } {
    const draft = this.drafts.get(id);
    if (!draft) return { ok: false, reason: "no such extension" };
    if (draft.status === "published") {
      return { ok: false, reason: "a published extension is undone from its own controls" };
    }
    draft.status = "rolled-back";
    draft.rolledBackAt = Date.now();
    this.drafts.delete(id);
    return { ok: true, snapshot: draft.snapshot };
  }
}

function strip(draft: ExtensionDraft): ExtensionRecord {
  const record: ExtensionRecord = {
    id: draft.id,
    label: draft.label,
    applies: [...draft.applies],
    createdAt: draft.createdAt,
    status: draft.status,
  };
  if (draft.verifiedAt) record.verifiedAt = draft.verifiedAt;
  if (draft.publishedAt) record.publishedAt = draft.publishedAt;
  if (draft.rolledBackAt) record.rolledBackAt = draft.rolledBackAt;
  return record;
}

function defaultPersist(records: ExtensionRecord[]): void {
  try {
    KvStore.getInstance().set(EXTENSION_KEY, records);
  } catch {
    /* best-effort */
  }
}

function loadPublished(): ExtensionRecord[] {
  try {
    const stored = KvStore.getInstance().get<ExtensionRecord[]>(EXTENSION_KEY);
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}
