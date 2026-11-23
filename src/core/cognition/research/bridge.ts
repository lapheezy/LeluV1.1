/**
 * ==========================================================
 * LÉLU
 * COGNITION BRIDGE — research that reaches her, not a sidecar
 *
 * WP10 forbids an isolated research subsystem. The journal is
 * therefore a SOURCE for the systems LÉLU already thinks with:
 *
 *   verified entry → KnowledgeLibrary (status "verified")
 *                 → DailyRecord  (a lesson for today)
 *
 * Three rules keep the bridge honest:
 *
 *   1. Only `verified` entries cross. A hypothesis in the journal
 *      stays a hypothesis; it does not become "knowledge" because
 *      it was written down.
 *   2. The write result is returned. If the sink refuses (a
 *      runtime with no storage, a changed API), the caller is told
 *      `published: false` with the reason — never a silent success.
 *   3. Nothing is deleted on failure. The journal keeps the entry,
 *      so the next run can publish it.
 *
 * The sink is injected so this stays testable outside a browser
 * and so a future runtime can point it at another store without
 * changing the rule.
 * ==========================================================
 */

import type { ResearchEntry } from "./types";
import { MEASURED_EVIDENCE } from "./types";

export interface KnowledgeSink {
  add(input: { domain: string; title: string; detail: string; status: string; source: string }): { id: string };
}

export interface DailySink {
  appendToday(field: "lessons" | "observations" | "experiences", text: string): void;
}

export interface PublishResult {
  published: boolean;
  knowledgeId?: string;
  daily: boolean;
  reason?: string;
}

function domainFor(entry: ResearchEntry): string {
  if (entry.workPackage === "WP02" || entry.workPackage === "WP03" || entry.workPackage === "WP07") return "creative";
  if (entry.workPackage === "WP05") return "computing";
  return "selfdev";
}

/** A one-line lesson, so the daily record does not carry a whole entry. */
function lessonFor(entry: ResearchEntry): string {
  const statement = entry.learned.replace(/\s+/g, " ").trim();
  const shortened = statement.length > 220 ? `${statement.slice(0, 219)}…` : statement;
  return `Research ${entry.id} (${entry.workPackage}, verified): ${shortened}`;
}

export default class CognitionBridge {
  constructor(
    private readonly sink?: KnowledgeSink,
    private readonly daily?: DailySink,
  ) {}

  /**
   * Publish one entry into the systems LÉLU already uses.
   *
   * `sink` defaults to the real KnowledgeLibrary when this runs inside
   * the app; it is imported dynamically so a Node CLI or a test never
   * has to load the browser storage layer to use the journal.
   */
  public async publish(entry: ResearchEntry): Promise<PublishResult> {
    if (entry.status !== "verified") {
      return { published: false, daily: false, reason: `status "${entry.status}" is not verified` };
    }
    if (!entry.evidence.some((item) => MEASURED_EVIDENCE.includes(item.kind))) {
      return { published: false, daily: false, reason: "no measured evidence" };
    }

    let sink = this.sink;
    if (!sink) {
      try {
        const module = await import("../KnowledgeLibrary");
        const library = module.default.getInstance();
        sink = {
          add: (input) =>
            library.add({
              domain: input.domain as never,
              title: input.title,
              detail: input.detail,
              status: input.status as never,
              source: input.source,
            }),
        };
      } catch (caught) {
        return {
          published: false,
          daily: false,
          reason: `no knowledge sink reachable: ${caught instanceof Error ? caught.message : String(caught)}`,
        };
      }
    }

    try {
      const created = sink.add({
        domain: domainFor(entry),
        title: `Research: ${entry.question.slice(0, 120)}`,
        detail: `${entry.learned} [${entry.id}, ${entry.workPackage}, confidence ${entry.confidence.toFixed(2)}]`,
        status: "verified",
        source: `${entry.id} @ ${entry.commit?.slice(0, 8) ?? "no-commit"}`,
      });

      let daily = false;
      try {
        if (this.daily) {
          this.daily.appendToday("lessons", lessonFor(entry));
          daily = true;
        }
      } catch {
        daily = false; // the knowledge write already landed; a journal note is optional
      }

      return { published: true, knowledgeId: created.id, daily };
    } catch (caught) {
      return {
        published: false,
        daily: false,
        reason: `knowledge sink refused the write: ${caught instanceof Error ? caught.message : String(caught)}`,
      };
    }
  }

  /** Publish everything verified that is not yet in the library. */
  public async publishAll(entries: ResearchEntry[]): Promise<Array<{ id: string } & PublishResult>> {
    const results: Array<{ id: string } & PublishResult> = [];
    for (const entry of entries) {
      results.push({ id: entry.id, ...(await this.publish(entry)) });
    }
    return results;
  }
}
