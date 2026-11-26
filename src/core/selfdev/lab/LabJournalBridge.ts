/**
 * ==========================================================
 * LÉLU — LABORATORY → JOURNAL BRIDGE
 *
 * The scheduler runs with no browser, so it cannot write the
 * DevelopmentJournal (which is browser-persisted). It writes the
 * laboratory's own append-only journal instead, and this bridge
 * carries those entries into the ONE DevelopmentJournal when the
 * workspace is open.
 *
 * Rules that keep this honest:
 *   • verified is true only for an entry whose evidence includes a
 *     check that actually ran and passed — never because a cycle
 *     completed or a commit exists;
 *   • an entry already imported is not imported again (the lab id
 *     is part of the title), so calling this repeatedly is safe;
 *   • nothing is invented: if the journal cannot be read, the
 *     bridge reports that and imports nothing.
 * ==========================================================
 */

import DevelopmentJournal, { type JournalKind } from "../DevelopmentJournal";
import LabClient from "./LabClient";

export interface BridgeResult {
  imported: number;
  skipped: number;
  titles: string[];
  error?: string;
}

interface LabEntry {
  at: number;
  kind: string;
  id?: string;
  discoveryId?: string;
  priority?: number;
  findings?: number;
  status?: string;
  ok?: boolean;
  command?: string;
  sha?: string;
  error?: string;
}

function kindFor(kind: string): JournalKind {
  if (kind === "discovery") return "daily";
  if (kind === "scheduler-cycle" || kind === "scheduler-manual-cycle") return "daily";
  if (kind === "scheduler-failure") return "lesson";
  if (kind === "experiment-command") return "verification";
  if (kind === "experiment-commit") return "improvement";
  if (kind === "experiment-created") return "improvement";
  return "explicit";
}

/**
 * Import the laboratory's recorded activity into the development journal.
 *
 * Only entries that describe something that actually happened are imported;
 * a cycle that found nothing is imported as a daily entry that says so, which
 * is the honest record of a day without a change.
 */
export async function syncLaboratoryIntoJournal(client: LabClient = LabClient.getInstance()): Promise<BridgeResult> {
  let entries: LabEntry[];
  try {
    const response = await client.journal();
    entries = (response.entries ?? []) as unknown as LabEntry[];
  } catch (error) {
    return {
      imported: 0,
      skipped: 0,
      titles: [],
      error: `The laboratory journal could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const journal = DevelopmentJournal.getInstance();
  const existing = new Set(journal.entries().map((entry) => entry.title));
  const titles: string[] = [];
  let skipped = 0;

  // Oldest first: the journal reads as a chronology.
  for (const entry of [...entries].reverse()) {
    const label = entry.discoveryId ?? entry.id ?? "";
    const title =
      entry.kind === "discovery"
        ? `Laboratory discovery ${label}`
        : entry.kind === "scheduler-cycle" || entry.kind === "scheduler-manual-cycle"
          ? `Daily laboratory cycle ${label}`
          : entry.kind === "scheduler-failure"
            ? `Laboratory cycle failed at ${new Date(entry.at).toISOString().slice(0, 10)}`
            : entry.kind === "experiment-command"
              ? `Laboratory check ${entry.command ?? "?"} on ${entry.id ?? "?"}`
              : entry.kind === "experiment-commit"
                ? `Laboratory experiment ${entry.id ?? "?"} committed`
                : entry.kind === "experiment-created"
                  ? `Laboratory experiment ${entry.id ?? "?"} opened`
                  : "";

    if (!title) continue;
    if (existing.has(title)) {
      skipped += 1;
      continue;
    }

    const verified = entry.kind === "experiment-command" && entry.ok === true;
    const detail =
      entry.kind === "discovery" || entry.kind === "scheduler-cycle" || entry.kind === "scheduler-manual-cycle"
        ? `Inspected the repository: ${entry.findings ?? 0} finding(s), priority ${entry.priority ?? "?"}/100, status ${entry.status ?? "recorded"}.`
        : entry.kind === "scheduler-failure"
          ? `The daily cycle failed: ${entry.error ?? "no detail recorded"}. The next attempt backs off.`
          : entry.kind === "experiment-command"
            ? `Ran the declared check “${entry.command ?? "?"}” in experiment ${entry.id ?? "?"}: ${entry.ok ? "exit 0" : "non-zero exit"}.`
            : entry.kind === "experiment-commit"
              ? `Committed experiment ${entry.id ?? "?"}${entry.sha ? ` as ${String(entry.sha).slice(0, 7)}` : ""}.`
              : `Opened isolated worktree ${entry.id ?? "?"} from the current HEAD.`;

    journal.record({
      kind: kindFor(entry.kind),
      title,
      detail,
      capabilities: ["self-development"],
      evidence: entry.kind === "experiment-command" ? [`experiment ${entry.id ?? "?"}`] : [],
      verified,
      at: entry.at,
      ...(entry.sha ? { commit: String(entry.sha) } : {}),
    });
    existing.add(title);
    titles.push(title);
  }

  return { imported: titles.length, skipped, titles };
}

/** Reset the imported entries for a deterministic recount (tests, and a user who wants a clean journal). */
export function importedLaboratoryTitles(): string[] {
  return DevelopmentJournal.getInstance()
    .entries()
    .filter((entry) => entry.title.startsWith("Laboratory ") || entry.title.startsWith("Daily laboratory "))
    .map((entry) => entry.title);
}
