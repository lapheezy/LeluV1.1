/**
 * ==========================================================
 * LÉLU — CONTINUITY TOOLS
 *
 * The model-facing surface over Mission 14's first slice:
 *
 *   self.operational  read the evidence-labelled self-model
 *   mission.list      read the continuity ledger
 *   mission.find      resolve one record by id, words and provenance
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
import { BrokerHealthStore } from "../model/ProviderHealth.ts";
import type { MissionEvidence } from "../operational-intelligence/evidence.ts";
import ContinuityEngine from "../sync/ContinuityEngine.ts";
import type { ContinuityConflictResolution } from "../sync/ContinuityTypes.ts";

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
    "Read the mission continuity ledger: open workstreams, their status, evidence, blockers, where the work lives and the next safe action. Titles can repeat after a retry; use the stable id, objective, status and provenance, and call mission_find when several records look alike.",
    0,
    {
      type: "object",
      properties: {
        includeClosed: { type: "boolean", description: "Include completed and abandoned workstreams." },
      },
    },
  ),
  definition(
    "mission.find",
    "Find One Workstream",
    "Resolve the single workstream that matches an id, title, objective, repository or branch. Use this when titles collide or the request names a state (for example, the blocked original). It returns the stable id, status, objective, provenance, project identity and the full brief for the best match, plus any alternatives. Never choose a record by title alone.",
    0,
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Id, title, objective words, repository or branch." },
        status: { type: "string", enum: [...MISSION_STATUSES], description: "Optional status filter." },
        repository: { type: "string", description: "Optional exact repository filter." },
        branch: { type: "string", description: "Optional exact branch filter." },
        includeClosed: { type: "boolean", description: "Include completed and abandoned records." },
      },
      required: ["query"],
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
          enum: ["status", "evidence", "next", "blocker", "clear-blocker", "file", "decision", "note", "duplicate"],
        },
        value: { type: "string", description: "The status, basis, action, blocker text, file path, decision or note." },
        blockerId: { type: "string", description: "For clear-blocker; defaults to the most recent open blocker." },
        evidence: { type: "string", enum: EVIDENCE_STATES },
      },
      required: ["id", "action"],
    },
  ),
  definition(
    "continuity.status",
    "Read Synchronization Status",
    "Read the real local-first continuity state: pending outbox operations, confirmed cloud revisions, authentication/retry state and every unresolved conflict. A local-only result is normal; a `synced` result means a transport acknowledged that exact local revision.",
    0,
    { type: "object", properties: {} },
  ),
  definition(
    "continuity.resolve",
    "Resolve a Sync Conflict",
    "Resolve one visible continuity conflict. keep_local uploads the preserved local revision conditionally; keep_cloud restores the cloud revision; merge is accepted only where the authority has a safe merge (append-only messages and additive Cosmos rooms). The original versions remain in the conflict record.",
    1,
    {
      type: "object",
      properties: {
        conflictId: { type: "string", description: "Exact conflict id from continuity.status." },
        resolution: { type: "string", enum: ["keep_local", "keep_cloud", "merge"] },
      },
      required: ["conflictId", "resolution"],
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
      // Probe before reporting: a self-model that only reads a cached boolean
      // is the configuration claim this mission exists to remove. A failed
      // probe is recorded on the snapshot instead of aborting the read.
      const health = await BrokerHealthStore.getInstance().refresh();
      const snapshot = OperationalSelfModel.getInstance().snapshot();
      return {
        ok: true,
        content: OperationalSelfModel.getInstance().report(snapshot.at),
        data: {
          counts: snapshot.counts,
          sourcesUnreadable: snapshot.sourceFailures.map((failure) => failure.source),
          openWorkstreams: snapshot.missions.length,
          providerHealth: {
            at: health.at,
            probeError: health.probeError,
            providers: health.providers.map((provider) => ({
              id: provider.id,
              availability: provider.availability,
              lastSuccessAt: provider.lastSuccessAt,
              lastFailureAt: provider.lastFailureAt,
            })),
          },
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
    id: "mission.find",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: [...MISSION_STATUSES] },
        repository: { type: "string" },
        branch: { type: "string" },
        includeClosed: { type: "boolean" },
      },
      required: ["query"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ledger = MissionLedgerStore.getInstance();
      const query = str(args, "query");
      if (!query) return { ok: false, content: "mission_find needs a query: an id, title, objective, repository or branch." };
      const statusText = str(args, "status");
      const status = statusText ? asStatus(statusText) : undefined;
      if (statusText && !status) {
        return { ok: false, content: `"${statusText}" is not a mission status. One of: ${MISSION_STATUSES.join(", ")}.` };
      }
      const matches = ledger.find(query, {
        ...(status ? { status } : {}),
        ...(str(args, "repository") ? { repository: str(args, "repository") } : {}),
        ...(str(args, "branch") ? { branch: str(args, "branch") } : {}),
        includeClosed: args.includeClosed === true,
      });
      if (matches.length === 0) {
        return {
          ok: true,
          content: `No workstream matches "${query}" in the ledger. Do not invent one: call mission_list or ask which record is meant.`,
          data: { matches: 0 },
        };
      }

      const top = matches[0];
      const sameTitle = ledger.list().filter((mission) => mission.title === top.title);
      const alternatives = matches.slice(1).map(
        (mission) => `- ${mission.id} · ${mission.status} · ${mission.objective || mission.title}`,
      );
      const collision =
        sameTitle.length > 1
          ? `\nNote: ${sameTitle.length} records share the title "${top.title}" (${sameTitle
              .map((mission) => `${mission.id}=${mission.status}${mission.duplicateOf ? ` duplicate of ${mission.duplicateOf}` : ""}`)
              .join("; ")}). The stable id ${top.id} is authoritative for this match; do not substitute another record by title.`
          : "";
      return {
        ok: true,
        content:
          `Best match: ${top.id} (${top.status}, ${top.evidence}).\n${formatMission(top)}${collision}` +
          (alternatives.length > 0 ? `\n\nOther matches:\n${alternatives.join("\n")}` : ""),
        data: {
          id: top.id,
          candidates: matches.map((mission) => ({ id: mission.id, title: mission.title, status: mission.status })),
        },
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
          ` (sync ${result.mission.sync ?? "local"}: not synchronized to another device)` +
          `${result.durability === "memory-only" ? " — storage refused the write, so it will NOT survive a reload" : ""}.\n` +
          formatMission(result.mission),
        data: { id: result.mission.id, durability: result.durability, sync: result.mission.sync ?? "local" },
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
          enum: ["status", "evidence", "next", "blocker", "clear-blocker", "file", "decision", "note", "duplicate"],
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
      const resolved = ledger.resolveCanonical(id);
      if (!resolved) return { ok: false, content: `No workstream named "${id}". Nothing changed.` };
      // A duplicate is history, not a second workstream. Advancing it would
      // leave the canonical record stale, so every non-duplicate action is
      // applied to the stable original and the redirect is stated.
      const targetId = action === "duplicate" ? id : resolved.canonical.id;
      const redirect =
        targetId === id ? "" : `\n(${id} is a duplicate of ${targetId}; the update was applied to the canonical record.)`;

      const evidenceArg = str(args, "evidence");
      const evidence = evidenceArg ? asEvidence(evidenceArg) : null;
      let mission = null;

      switch (action) {
        case "status": {
          const status = asStatus(value);
          if (!status) return { ok: false, content: `"${value}" is not a mission status. One of: ${MISSION_STATUSES.join(", ")}.` };
          mission = ledger.setStatus(targetId, status);
          break;
        }
        case "evidence": {
          if (!evidence) return { ok: false, content: `evidence needs one of: ${EVIDENCE_STATES.join(", ")}.` };
          if (!value) return { ok: false, content: "evidence needs a basis: what was actually observed." };
          mission = ledger.setEvidence(targetId, evidence, value);
          break;
        }
        case "next":
          mission = ledger.setNextAction(targetId, value || null);
          break;
        case "blocker":
          if (!value) return { ok: false, content: "blocker needs the blocker text." };
          mission = ledger.addBlocker(targetId, value, evidence ?? "REPORTED");
          break;
        case "clear-blocker":
          mission = ledger.clearBlocker(targetId, str(args, "blockerId") || undefined, value || undefined);
          if (!mission) return { ok: false, content: "There is no open blocker to clear on that workstream." };
          break;
        case "file":
          if (!value) return { ok: false, content: "file needs a path." };
          mission = ledger.addFile(targetId, value);
          break;
        case "decision":
          if (!value) return { ok: false, content: "decision needs the decision text." };
          mission = ledger.addDecision(targetId, value);
          break;
        case "note":
          if (!value) return { ok: false, content: "note needs text." };
          mission = ledger.note(targetId, value, evidence ?? "REPORTED");
          break;
        case "duplicate":
          if (!value) return { ok: false, content: "duplicate needs the stable id of the canonical record." };
          mission = ledger.markDuplicate(id, value, evidence ? `evidence ${evidence}` : undefined);
          if (!mission) return { ok: false, content: `Cannot mark ${id} as a duplicate of "${value}": both records must exist and differ.` };
          break;
        default:
          return {
            ok: false,
            content: `"${action}" is not a mission update. One of: status, evidence, next, blocker, clear-blocker, file, decision, note, duplicate.`,
          };
      }

      if (!mission) return { ok: false, content: `The update was refused by the ledger. Nothing changed for ${id}.` };
      return {
        ok: true,
        content:
          `Updated ${mission.id} (${mission.status}, ${mission.evidence}, durability ${mission.durability}, sync ${mission.sync ?? "local"}).${redirect}\n` +
          formatMission(mission),
        data: {
          id: mission.id,
          requestedId: id,
          status: mission.status,
          evidence: mission.evidence,
          durability: mission.durability,
          sync: mission.sync ?? "local",
        },
      };
    },
  },

  {
    id: "continuity.status",
    parameters: { type: "object", properties: {} },
    run: async (): Promise<ToolExecutionResult> => {
      const engine = ContinuityEngine.getInstance();
      const status = engine.status();
      const conflicts = engine.conflicts();
      const lines = [
        `Continuity: ${status.pending} pending, ${status.conflicts} conflict(s), ${status.failed} failed.`,
        status.lastError ? `Last error: ${status.lastError}` : "No continuity error recorded.",
        ...status.authorities.map((authority) =>
          `${authority.authority}: ${authority.state}; local=${authority.local}, pending=${authority.pending}, synced=${authority.synced}, conflicts=${authority.conflicts}`),
        ...conflicts.map((conflict) =>
          `CONFLICT ${conflict.id} (${conflict.authority}/${conflict.recordId}, local r${conflict.localRevision}, cloud ${conflict.cloudRevision ?? "none"}): ${conflict.reason}`),
      ];
      return {
        ok: true,
        content: lines.join("\n"),
        data: { status, conflicts },
      };
    },
  },

  {
    id: "continuity.resolve",
    parameters: {
      type: "object",
      properties: {
        conflictId: { type: "string" },
        resolution: { type: "string", enum: ["keep_local", "keep_cloud", "merge"] },
      },
      required: ["conflictId", "resolution"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const engine = ContinuityEngine.getInstance();
      const id = str(args, "conflictId");
      const resolution = str(args, "resolution") as ContinuityConflictResolution;
      if (!id) return { ok: false, content: "continuity_resolve needs the exact conflict id." };
      if (!["keep_local", "keep_cloud", "merge"].includes(resolution)) {
        return { ok: false, content: "resolution must be keep_local, keep_cloud or merge." };
      }
      const result = engine.resolveConflict(engine.conflicts(true), id, resolution);
      if (!result.ok) return { ok: false, content: result.detail };
      if (resolution !== "keep_cloud") void engine.processOutbox();
      return { ok: true, content: result.detail, data: result.conflict };
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
      if (id && !ledger.resolveCanonical(id)) {
        return {
          ok: false,
          content: `No workstream named "${id}". Nothing was read; use mission_find or mission_list to resolve the record.`,
          data: { open: ledger.open().length },
        };
      }
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
