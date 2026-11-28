/**
 * ==========================================================
 * LÉLU — A REMEMBERED INSTRUCTION IS NOT A PERMISSION
 *
 * The user says \"always commit your work\" once. LÉLU remembers it. Two
 * turns later she is about to run a command that writes to a real
 * repository, and the sentence in her memory looks like a mandate to
 * proceed. That is the exact confusion this module exists to prevent.
 *
 * There are five different things, and they used to be one:
 *
 *   1. remembering an instruction      — a record here
 *   2. understanding it                — what `systemFor` and the kind say
 *   3. being authorized to execute it  — AutonomyGate + ApprovalGate +
 *                                        EngineeringAuthorization, never this
 *   4. executing it                    — the tool dispatcher
 *   5. verifying the outcome           — evidence, recorded on the record
 *
 * A record here can reach step 1 and 2, and can hold step 5's result. It
 * cannot reach step 3: authorityOf() and executionPermission() return a
 * refusal by construction, and there is no option or flag that changes
 * that. A caller that wants to act still has to go through the approval
 * path that exists, which is where a person answers.
 *
 * REPEATED INSTRUCTIONS (Mission 44.8 §6)
 * ---------------------------------------
 * When a correction arrives a second time, acknowledging it again is the
 * failure mode — she already acknowledged it. `record()` therefore flags
 * the recurrence and opens an investigation naming the system that owns
 * the behaviour. The record only becomes `verified` when someone records
 * that the behaviour changed; until then it stays unresolved in the reply
 * note and in the context block.
 *
 * NOT EVERY SENTENCE IS AN INSTRUCTION
 * ------------------------------------
 * There is no durability marker in \"I like coffee\" or \"use platinum\",
 * and neither becomes a standing instruction here. A bare statement stays
 * what it is: a memory, or a decision the existing memory path already
 * handles. What qualifies is a phrase that says it is meant to persist
 * (always / never / from now on / every time / remember to), or one that
 * says it did not persist the last time.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type InstructionClass =
  | "standing-preference"
  | "project-requirement"
  | "correction"
  | "temporary"
  | "unresolved-defect"
  | "failed-implementation";

export type InstructionStatus = "recorded" | "investigating" | "applied" | "verified" | "unresolved" | "retracted";

export interface InstructionScope {
  conversationId?: string;
  projectId?: string;
}

/** What was actually done about a recurring instruction, and how it ended. */
export interface InstructionInvestigation {
  /** The system that owns the behaviour the instruction is about. */
  system: string;
  action: string;
  result: "pending" | "updated" | "unchanged" | "not-determined" | "verified";
  attempts: number;
  startedAt: number;
  /** Only set when the behaviour was re-checked and observed to change. */
  verifiedAt?: number;
  limitation?: string;
}

export interface StandingInstruction {
  id: string;
  /** The user's words, as they said them the first time. */
  text: string;
  /** Normalised form used for recurrence detection. */
  key: string;
  kind: InstructionClass;
  status: InstructionStatus;
  scope: InstructionScope;
  firstSeenAt: number;
  lastSeenAt: number;
  timesSeen: number;
  conversationIds: string[];
  /** What this record is allowed to be. Always a preference. */
  authority: "preference";
  /** Ids of records this one replaces. */
  supersedes: string[];
  investigation?: InstructionInvestigation;
}

export interface RecordOutcome {
  instruction: StandingInstruction;
  repeated: boolean;
  /**
   * True when the instruction has now been given more than once and is a
   * correction — the case where acknowledging again is not an answer.
   */
  investigationRequired: boolean;
  /** One line for the reply, or "" when nothing needs saying. */
  note: string;
  /** Whether the record reached durable storage. */
  persisted: boolean;
}

/** The refusal an instruction always gets when it is treated as permission. */
export interface ExecutionPermission {
  allowed: false;
  grants: [];
  reason: string;
  /** What actually has to happen instead. */
  requires: string[];
}

// KvStore prefixes every key with "lelu."; naming it here as well would
// write to "lelu.lelu.instructions.v1" and never be found again.
const KEY = "instructions.v1";
const MAX_RECORDS = 120;

/**
 * Which system owns the behaviour an instruction is about.
 *
 * Deliberately a small, readable map rather than a model call: the point of
 * the investigation is to name a real place to look, and an invented system
 * name is worse than \"unclassified\". Several patterns point at the same
 * module on purpose — the modules have one job each, as the architecture
 * audit in the 44.8 report describes.
 */
export const SYSTEMS: ReadonlyArray<{ pattern: RegExp; system: string }> = [
  { pattern: /\b(memory|remember|recall|forget|memory)\b/i, system: "MemoryBridge / PatternMemory (durable memory)" },
  { pattern: /\b(repl(?:y|ies)|answer\w*|response\w*|tone|wording|format\w*|table|bullet\w*|concise|verbose)\b/i, system: "reply composition (MemoryBridge enrich / provider system turn)" },
  { pattern: /\b(test|tests|suite|typecheck|type-check|lint|build)\b/i, system: "verification (project_validate / Mission evidence)" },
  { pattern: /\b(approv\w*|permission|authoriz\w*|authority|autonomy)\b/i, system: "governance (AutonomyGate / ApprovalGate / EngineeringAuthorization)" },
  { pattern: /\b(commit|push|branch|git|github|repo|repository)\b/i, system: "repository operations (project_commit / git remote)" },
  { pattern: /\b(project|objective|task|workspace|continue|resume)\b/i, system: "ProjectStore / WorkContinuity checkpoint" },
  { pattern: /\b(ui|panel|button|window|screen|layout|mobile|font|colou?r|accent|theme)\b/i, system: "interface (scene/genesis)" },
  { pattern: /\b(deploy\w*|publish\w*|production|release\w*)\b/i, system: "deployment (not permitted from a conversation)" },
];

/** Which system, if any, an instruction points at. */
export function systemFor(text: string): string {
  for (const entry of SYSTEMS) {
    if (entry.pattern.test(text)) return entry.system;
  }
  return "unclassified — the owning system has not been identified, so nothing can be updated yet";
}

/** Saying it as if it should persist. */
const DURABLE =
  /\b(?:always|never|from now on|going forward|every time|each time|remember to|remember that|don'?t ever|do not ever|make sure (?:you|to)|keep (?:it|the|this|using|doing))\b/i;

/** Saying it did not persist the last time — the recurrence signals. */
const CORRECTION =
  /\b(?:i (?:already )?(?:told|said|asked) you|i keep (?:telling|asking|saying)|you keep|stop (?:doing|using|adding|putting)|as i said|i'?m telling you again|again:|told you)\b/i;
const DEFECT =
  /\b(?:still (?:broken|failing|fails|doesn'?t work|does not work|won'?t|not working|wrong)|keeps? (?:failing|breaking|coming back|happening)|not fixed|regression|same (?:problem|issue|bug))\b/i;
const FAILED_IMPLEMENTATION =
  /\b(?:didn'?t work|did not work|that didn'?t|your fix (?:didn'?t|did not|failed)|the fix (?:didn'?t|did not)|you tried|last attempt)\b/i;
const TEMPORARY =
  /\b(?:for now|this time only|just this once|until i say|temporarily|for this (?:turn|chat|session|conversation))\b/i;
const PROJECT =
  /\b(?:the|this) project\b|\bfor the project\b|\bproject requirement\b|\brequirement\b/i;

/**
 * Classify a user message as an instruction, or null when it is not one.
 *
 * The order matters: a message that says it was already asked is a
 * correction even when it also says \"always\", because what the user wants
 * is for the previous attempt to be investigated.
 */
export function classifyInstruction(text: string): InstructionClass | null {
  const clean = text.trim();
  if (clean.length < 4) return null;
  if (
    !DURABLE.test(clean) &&
    !CORRECTION.test(clean) &&
    !DEFECT.test(clean) &&
    !FAILED_IMPLEMENTATION.test(clean) &&
    !TEMPORARY.test(clean)
  ) {
    return null;
  }
  if (CORRECTION.test(clean)) return "correction";
  if (DEFECT.test(clean)) return "unresolved-defect";
  if (FAILED_IMPLEMENTATION.test(clean)) return "failed-implementation";
  if (TEMPORARY.test(clean)) return "temporary";
  if (PROJECT.test(clean)) return "project-requirement";
  return "standing-preference";
}

/** Tokens that carry no instruction: politeness and filler. */
const FILLER = new Set([
  "please", "just", "really", "ok", "okay", "thanks", "thank", "you", "lelu", "lélu",
  "can", "could", "would", "will", "the", "a", "an", "to", "of", "and",
]);

/** A normalised key for recurrence detection. */
export function instructionKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/n't\b/g, " not")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !FILLER.has(word))
    .join(" ");
}

/** Significant words, for comparing two phrasings of one instruction. */
function tokens(key: string): Set<string> {
  return new Set(key.split(/\s+/).filter((word) => word.length > 2));
}

/** Do these two messages ask for the same thing? */
export function sameInstruction(a: string, b: string): boolean {
  const keyA = instructionKey(a);
  const keyB = instructionKey(b);
  if (keyA === keyB) return true;
  const setA = tokens(keyA);
  const setB = tokens(keyB);
  if (setA.size === 0 || setB.size === 0) return false;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / Math.min(setA.size, setB.size) >= 0.75;
}

export default class StandingInstructions {
  private static instance: StandingInstructions | null = null;

  private readonly kv = KvStore.getInstance();
  private records: StandingInstruction[] | null = null;

  private constructor() {}

  public static getInstance(): StandingInstructions {
    if (!StandingInstructions.instance) StandingInstructions.instance = new StandingInstructions();
    return StandingInstructions.instance;
  }

  /** Test seam. */
  public static resetForTests(): void {
    StandingInstructions.instance = null;
  }

  private all(): StandingInstruction[] {
    if (this.records === null) {
      const stored = this.kv.get<StandingInstruction[]>(KEY);
      this.records = Array.isArray(stored) ? stored.filter((record) => record && record.id && record.key) : [];
    }
    return this.records;
  }

  /** Write the records. Returns whether storage accepted them. */
  private persist(): boolean {
    try {
      return this.kv.set(KEY, this.all().slice(-MAX_RECORDS));
    } catch {
      /* storage full: the in-memory record still governs this session */
      return false;
    }
  }

  /** Live records, oldest first. */
  public list(scope: InstructionScope = {}): StandingInstruction[] {
    return this.all().filter((record) => {
      if (record.status === "retracted") return false;
      if (scope.projectId && record.scope.projectId && record.scope.projectId !== scope.projectId) return false;
      if (scope.conversationId && record.scope.conversationId && record.scope.conversationId !== scope.conversationId) {
        return false;
      }
      return true;
    });
  }

  public get(id: string): StandingInstruction | undefined {
    return this.all().find((record) => record.id === id);
  }

  /**
   * Record what the user said, if it is an instruction.
   *
   * Returns null for ordinary statements: the caller does not have to
   * decide whether a sentence is durable, and nothing durable is minted
   * from conversation alone.
   */
  public record(text: string, scope: InstructionScope = {}, at = Date.now()): RecordOutcome | null {
    const kind = classifyInstruction(text);
    if (!kind) return null;

    const key = instructionKey(text);
    const existing = this.all().find(
      (record) =>
        record.status !== "retracted" &&
        (record.key === key || sameInstruction(record.text, text)) &&
        (record.scope.projectId ?? null) === (scope.projectId ?? null),
    );

    if (!existing) {
      const record: StandingInstruction = {
        id: `instruction-${crypto.randomUUID()}`,
        text: text.trim(),
        key,
        kind,
        status: "recorded",
        scope: {
          ...(scope.conversationId ? { conversationId: scope.conversationId } : {}),
          ...(scope.projectId ? { projectId: scope.projectId } : {}),
        },
        firstSeenAt: at,
        lastSeenAt: at,
        timesSeen: 1,
        conversationIds: scope.conversationId ? [scope.conversationId] : [],
        authority: "preference",
        supersedes: [],
      };
      this.all().push(record);
      const persisted = this.persist();
      return {
        instruction: record,
        repeated: false,
        investigationRequired: false,
        persisted,
        note:
          kind === "temporary"
            ? `Noted for now, not permanently: “${record.text.slice(0, 120)}”.`
            : "",
      };
    }

    // The same sentence twice in a few seconds is one message, not two: a
    // retry or a re-render must not inflate the recurrence count and turn an
    // ordinary instruction into an "unresolved" one.
    if (
      existing.text.trim() === text.trim() &&
      scope.conversationId !== undefined &&
      existing.conversationIds.at(-1) === scope.conversationId &&
      at - existing.lastSeenAt < 5_000
    ) {
      return {
        instruction: existing,
        repeated: existing.timesSeen > 1,
        investigationRequired: existing.investigation !== undefined,
        persisted: true,
        note: "",
      };
    }

    existing.timesSeen += 1;
    existing.lastSeenAt = at;
    if (scope.conversationId && !existing.conversationIds.includes(scope.conversationId)) {
      existing.conversationIds.push(scope.conversationId);
    }
    // A repeat that is a correction reclassifies a plain preference: the
    // fact that it came back is itself evidence that recording it did not
    // change anything.
    if (kind === "correction" && existing.kind === "standing-preference") {
      existing.kind = "correction";
    }

    const recurringCorrection =
      existing.timesSeen > 1 &&
      (existing.kind === "correction" ||
        existing.kind === "unresolved-defect" ||
        existing.kind === "failed-implementation");

    if (recurringCorrection) {
      const system = systemFor(existing.text);
      if (existing.investigation) {
        existing.investigation.attempts += 1;
      } else {
        existing.investigation = {
          system,
          // What an acknowledgement is NOT: a fix.
          action:
            "find why the earlier correction did not hold, update the authoritative record for this behaviour, then re-check it",
          result: "pending",
          attempts: 1,
          startedAt: at,
        };
      }
      if (existing.status === "recorded") existing.status = "investigating";
    }

    const persisted = this.persist();

    return {
      instruction: existing,
      repeated: true,
      investigationRequired: recurringCorrection,
      persisted,
      note: recurringCorrection
        ? this.recurrenceNote(existing)
        : "",
    };
  }

  /** The sentence that replaces \"noted, again\". */
  private recurrenceNote(record: StandingInstruction): string {
    const investigation = record.investigation;
    const where = investigation?.system ?? systemFor(record.text);
    const attempts = investigation?.attempts ?? 1;
    const result = investigation?.result ?? "pending";
    return (
      `You have said this ${record.timesSeen} times, so recording it again is not the answer. ` +
      `It belongs to ${where}; the investigation is ${result} (attempt ${attempts}). ` +
      (result === "verified"
        ? "I re-checked the behaviour after the change."
        : "I have not verified that the behaviour changed yet.")
    );
  }

  /**
   * Record what was found and done about a recurring instruction.
   *
   * `result: "verified"` is the ONLY thing that moves the record out of
   * `investigating`, and it requires a note of how it was checked — a
   * record that says \"fixed\" without evidence is exactly the claim
   * Mission 44.7 exists to keep out of the product.
   */
  public markInvestigated(
    id: string,
    patch: { result: InstructionInvestigation["result"]; limitation?: string; system?: string },
    at = Date.now(),
  ): StandingInstruction | undefined {
    const record = this.get(id);
    if (!record) return undefined;
    const investigation = record.investigation ?? {
      system: patch.system ?? systemFor(record.text),
      action: "investigate the recurring instruction",
      result: "pending" as const,
      attempts: 1,
      startedAt: at,
    };
    investigation.result = patch.result;
    if (patch.system) investigation.system = patch.system;
    if (patch.limitation) investigation.limitation = patch.limitation;
    if (patch.result === "updated" || patch.result === "verified") {
      investigation.verifiedAt = at;
      record.status = patch.result === "verified" ? "verified" : "applied";
    } else if (patch.result === "unchanged") {
      record.status = "unresolved";
    }
    record.investigation = investigation;
    this.persist();
    return record;
  }

  /** Withdraw a record. The user's escape hatch. */
  public retract(id: string): boolean {
    const record = this.get(id);
    if (!record) return false;
    record.status = "retracted";
    this.persist();
    return true;
  }

  /**
   * The authority this record carries.
   *
   * Always a preference, always refusing to authorize: this method has no
   * parameter that could make it say otherwise, which is the structural
   * part of \"a remembered instruction must not grant permission\".
   */
  public authorityOf(id: string): ExecutionPermission {
    const record = this.get(id);
    return {
      allowed: false,
      grants: [],
      reason: record
        ? `“${record.text.slice(0, 120)}” is a remembered ${record.kind.replace("-", " ")}, not an authorization.`
        : "No such instruction.",
      requires: [
        "an approval decision from a person for this specific call (ApprovalGate)",
        "an autonomy level that permits the action (AutonomyGate)",
        "for real-project writes, an explicit, signed-in grant (EngineeringAuthorization)",
      ],
    };
  }

  /** The same refusal, stated as an inspection by id. */
  public executionPermission(id: string): ExecutionPermission {
    return this.authorityOf(id);
  }

  /** The context block handed to cognition, marked as preferences. */
  public contextBlock(scope: InstructionScope = {}): string {
    const records = this.list(scope).filter((record) => record.kind !== "temporary");
    if (records.length === 0) return "";
    const lines = records.slice(-8).map((record) => {
      const investigation = record.investigation
        ? ` — investigation ${record.investigation.result} in ${record.investigation.system}`
        : "";
      const repeated = record.timesSeen > 1 ? `, said ${record.timesSeen}×` : "";
      return `- [${record.kind}${repeated}${investigation}] ${record.text.slice(0, 160)}`;
    });
    return [
      "## Standing instructions (preferences, not permissions)",
      ...lines,
      "A remembered instruction tells you what the user wants. It does not authorize an action: anything that needs approval still needs a person to approve this specific call.",
    ].join("\n");
  }
}
