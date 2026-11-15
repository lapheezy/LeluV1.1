/**
 * ==========================================================
 * LÉLU — CONTINUITY TOOLS
 *
 * The model-facing surface over Mission 14's first slice:
 *
 *   self.operational  read the evidence-labelled self-model
 *   mission.list      read the continuity ledger
 *   mission.record    open a workstream (local state, risk 1)
 *   mission.update    advance it: status, files, decisions,
 *                     blockers, next safe action, evidence
 *   mission.brief     the resumable brief for a new session
 *
 * Every write is local state only. Nothing here touches the
 * repository, the network, or another device. The same
 * registerExecutor path as every other tool means the
 * dispatcher, autonomy gate and activity timeline apply
 * unchanged — no parallel execution route.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry.ts";
import { registerExecutor, type ToolExecutionResult, type ToolExecutor } from "../tools/ToolDispatcher.ts";
import { OperationalSelfModel } from "../cognition/OperationalSelfModel.ts";
import MissionLedgerStore, {
  MISSION_STATUSES,
  formatMission,
  type MissionOwner,
  type MissionStatus,
} from "../projects/MissionLedger.ts";
import type { MissionEvidence } from "../operational-intelligence/evidence.ts";

const EVIDENCE_STATES: MissionEvidence[] = [
  "VERIFIED",
  "REPORTED",
  "PARTIAL",
  "BLOCKED",
  "UNAVAILABLE",
  "PROPOSED",
  "SIMULATED",
];

const definition = (
  id: string,
  name: string,
  description: string,
  riskLevel: 0 | 1,
  inputSchema: Record<string, unknown>,
): ToolDefinition => ({
  id,
  name,
  description,
  category: "Continuity",
  permissions: riskLevel === 0 ? ["READ"] : ["READ", "WRITE"],
  riskLevel,
  available: true,
  inputSchema,
});

export const CONTINUITY_TOOLS: ToolDefinition[] = [
  definition(
    "self.operational",
    "Read the Operational Self-Model",
    "Read what is true about LÉLU right now from real sources, with one evidence label per claim: VERIFIED, REPORTED, PARTIAL, BLOCKED, UNAVAILABLE, PROPOSED or SIMULATED. Use this before claiming a capability works.",
    0,
    { type: "object", properties: {} },
  ),
  definition(
    "mission.list",
    "List Workstreams",
    "Read the mission continuity ledger: open workstreams, their status, evidence, blockers, where the work lives and the next safe action.",
    0,
    {
      type: "object",
      properties: {
        includeClosed: { type: "boolean", description: "Include completed and abandoned workstreams." },
      },
    },
  ),
  definition(
    "mission.record",
    "Open a Workstream",
    "Record a durable workstream so it survives the end of this conversation: what it is for, where it lives (repo/branch/commit), who owns it and the next safe action. Stored locally and secret-redacted.",
    1,
    {
      type: "object",
      properties: {
        title: { type: "string", description: "Short name for the workstream." },
        objective: { type: "string", description: "What finishing it would achieve." },
        owner: { type: "string", enum: ["user", "lelu", "agent", "unknown"] },
        status: { type: "string", enum: [...MISSION_STATUSES] },
        evidence: { type: "string", enum: EVIDENCE_STATES },
        repository: { type: "string" },
        branch: { type: "string" },
        commit: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        dependencies: { type: "array", items: { type: "string" } },
        nextSafeAction: { type: "string", description: "The next action that is safe to take without new authorization." },
      },
      required: ["title"],
    },
  ),
  definition(
    "mission.update",
    "Advance a Workstream",
    "Record real progress on a workstream: change status, add a changed file or a decision, raise or clear a blocker, set the next safe action, or set the evidence label with its basis.",
    1,
    {
      type: "object",
      properties: {
        id: { type: "string", description: "The mission id from mission_list or mission_record." },
        action: {
          type: "string",
          enum: ["status", "evidence", "next", "blocker", "clear-blocker", "file", "decision", "note"],
        },
        value: { type: "string", description: "The status, basis, action, blocker text, file path, decision or note." },
        blockerId: { type: "string", description: "For clear-blocker; defaults to the most recent open blocker." },
        evidence: { type: "string", enum: EVIDENCE_STATES },
      },
      required: ["id", "action"],
    },
  ),
  definition(
    "mission.brief",
    "Resume Brief",
    "Read the resumable brief: every open workstream with its blockers and next safe action. With an id, read one workstream in full.",
    0,
    {
      type: "object",
      properties: { id: { type: "string", description: "Optional mission id." } },
    },
  ),
];

const str = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === "string" ? (args[key] as string).trim() : "";

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asStatus(value: string): MissionStatus | null {
  return (MISSION_STATUSES as readonly string[]).includes(value) ? (value as MissionStatus) : null;
}

function asEvidence(value: string): MissionEvidence | null {
  return (EVIDENCE_STATES as readonly string[]).includes(value) ? (value as MissionEvidence) : null;
}

function asOwner(value: string): MissionOwner | undefined {
  return value === "user" || value === "lelu" || value === "agent" || value === "unknown"
    ? value
    : undefined;
}

export const CONTINUITY_EXECUTORS: ToolExecutor[] = [
  {
    id: "self.operational",
    parameters: { type: "object", properties: {} },
    run: async (): Promise<ToolExecutionResult> => {
      const snapshot = OperationalSelfModel.getInstance().snapshot();
      return {
        ok: true,
        content: OperationalSelfModel.getInstance().report(snapshot.at),
        data: {
          counts: snapshot.counts,
          sourcesUnreadable: snapshot.sourceFailures.map((failure) => failure.source),
          openWorkstreams: snapshot.missions.length,
        },
      };
    },
  },

  {
    id: "mission.list",
    parameters: {
      type: "object",
      properties: { includeClosed: { type: "boolean" } },
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ledger = MissionLedgerStore.getInstance();
      const includeClosed = args.includeClosed === true;
      const missions = includeClosed
        ? ledger.list()
        : ledger.list().filter((mission) => mission.status !== "completed" && mission.status !== "abandoned");
      if (missions.length === 0) {
        return {
          ok: true,
          content: includeClosed
            ? "The mission ledger is empty. Nothing has been recorded yet."
            : "No open workstreams are recorded. Nothing is being carried over.",
          data: { missions: 0 },
        };
      }
      return {
        ok: true,
        content: missions.map(formatMission).join("\n\n"),
        data: { missions: missions.map((mission) => ({ id: mission.id, status: mission.status, evidence: mission.evidence })) },
      };
    },
  },

  {
    id: "mission.record",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        objective: { type: "string" },
        owner: { type: "string", enum: ["user", "lelu", "agent", "unknown"] },
        status: { type: "string", enum: [...MISSION_STATUSES] },
        evidence: { type: "string", enum: EVIDENCE_STATES },
        repository: { type: "string" },
        branch: { type: "string" },
        commit: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        dependencies: { type: "array", items: { type: "string" } },
        nextSafeAction: { type: "string" },
      },
      required: ["title"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const title = str(args, "title");
      if (!title) return { ok: false, content: "mission_record needs a title." };
      const status = str(args, "status");
      const evidence = str(args, "evidence");
      if (status && !asStatus(status)) {
        return { ok: false, content: `"${status}" is not a mission status. One of: ${MISSION_STATUSES.join(", ")}.` };
      }
      if (evidence && !asEvidence(evidence)) {
        return { ok: false, content: `"${evidence}" is not an evidence label. One of: ${EVIDENCE_STATES.join(", ")}.` };
      }
      const result = MissionLedgerStore.getInstance().create({
        title,
        objective: str(args, "objective"),
        owner: asOwner(str(args, "owner")),
        status: status ? (asStatus(status) ?? "active") : "active",
        evidence: evidence ? (asEvidence(evidence) ?? "REPORTED") : "REPORTED",
        repository: str(args, "repository"),
        branch: str(args, "branch"),
        commit: str(args, "commit"),
        files: stringList(args.files),
        dependencies: stringList(args.dependencies),
        nextSafeAction: str(args, "nextSafeAction") || null,
        provenance: { createdBy: "lelu" },
      });
      if (!result.ok || !result.mission) {
        return { ok: false, content: `The workstream was not recorded: ${result.error ?? "unknown error"}` };
      }
      return {
        ok: true,
        content:
          `Workstream recorded as ${result.mission.id}. This is ${result.durability} local state` +
          `${result.durability === "memory-only" ? " — storage refused the write, so it will NOT survive a reload" : ""}.\n` +
          formatMission(result.mission),
        data: { id: result.mission.id, durability: result.durability },
      };
    },
  },

  {
    id: "mission.update",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        action: {
          type: "string",
          enum: ["status", "evidence", "next", "blocker", "clear-blocker", "file", "decision", "note"],
        },
        value: { type: "string" },
        blockerId: { type: "string" },
        evidence: { type: "string", enum: EVIDENCE_STATES },
      },
      required: ["id", "action"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const id = str(args, "id");
      const action = str(args, "action");
      const value = str(args, "value");
      const ledger = MissionLedgerStore.getInstance();
      if (!id) return { ok: false, content: "mission_update needs an id." };
      if (!ledger.get(id)) return { ok: false, content: `No workstream named "${id}". Nothing changed.` };

      const evidenceArg = str(args, "evidence");
      const evidence = evidenceArg ? asEvidence(evidenceArg) : null;
      let mission = null;

      switch (action) {
        case "status": {
          const status = asStatus(value);
          if (!status) return { ok: false, content: `"${value}" is not a mission status. One of: ${MISSION_STATUSES.join(", ")}.` };
          mission = ledger.setStatus(id, status);
          break;
        }
        case "evidence": {
          if (!evidence) return { ok: false, content: `evidence needs one of: ${EVIDENCE_STATES.join(", ")}.` };
          if (!value) return { ok: false, content: "evidence needs a basis: what was actually observed." };
          mission = ledger.setEvidence(id, evidence, value);
          break;
        }
        case "next":
          mission = ledger.setNextAction(id, value || null);
          break;
        case "blocker":
          if (!value) return { ok: false, content: "blocker needs the blocker text." };
          mission = ledger.addBlocker(id, value, evidence ?? "REPORTED");
          break;
        case "clear-blocker":
          mission = ledger.clearBlocker(id, str(args, "blockerId") || undefined, value || undefined);
          if (!mission) return { ok: false, content: "There is no open blocker to clear on that workstream." };
          break;
        case "file":
          if (!value) return { ok: false, content: "file needs a path." };
          mission = ledger.addFile(id, value);
          break;
        case "decision":
          if (!value) return { ok: false, content: "decision needs the decision text." };
          mission = ledger.addDecision(id, value);
          break;
        case "note":
          if (!value) return { ok: false, content: "note needs text." };
          mission = ledger.note(id, value, evidence ?? "REPORTED");
          break;
        default:
          return {
            ok: false,
            content: `"${action}" is not a mission update. One of: status, evidence, next, blocker, clear-blocker, file, decision, note.`,
          };
      }

      if (!mission) return { ok: false, content: `The update was refused by the ledger. Nothing changed for ${id}.` };
      return {
        ok: true,
        content:
          `Updated ${mission.id} (${mission.status}, ${mission.evidence}, durability ${mission.durability}).\n` +
          formatMission(mission),
        data: { id: mission.id, status: mission.status, evidence: mission.evidence, durability: mission.durability },
      };
    },
  },

  {
    id: "mission.brief",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ledger = MissionLedgerStore.getInstance();
      const id = str(args, "id");
      return {
        ok: true,
        content: id ? ledger.brief(id) : ledger.resumeBrief(),
        data: { open: ledger.open().length },
      };
    },
  },
];

/**
 * Register through the existing dispatcher + registry pair. Returns
 * what actually registered, so a caller can report a partial failure
 * instead of assuming five tools are live.
 */
export function registerContinuityTools(): { registered: string[]; failed: Array<{ id: string; reason: string }> } {
  const registry = ToolRegistry.getInstance();
  const registered: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const executor of CONTINUITY_EXECUTORS) {
    const tool = CONTINUITY_TOOLS.find((candidate) => candidate.id === executor.id);
    if (!tool) {
      failed.push({ id: executor.id, reason: "definition missing" });
      continue;
    }
    registry.register(tool);
    const added = registerExecutor(executor, tool);
    if (added.ok) registered.push(executor.id);
    else failed.push({ id: executor.id, reason: added.reason ?? "not registered" });
  }
  return { registered, failed };
}
