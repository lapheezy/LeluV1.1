/**
 * ==========================================================
 * LÉLU — AWARE OF EVERY CHANGE MADE TO HER
 *
 * Reads /api/self/changes (git history — every coder's commits, not only
 * the ones someone remembered to log — plus the journal written for her)
 * and keeps a short, first-person summary that goes into EVERY conversation
 * through CognitiveContext. Refreshed at startup and every ten minutes, so a
 * change made by anyone while she runs reaches her without a restart.
 *
 * Also feeds her SelfModel: the newest journal lessons become things she
 * "knows", the playbooks become things she can do.
 *
 * Her chat tools (SelfTools.ts) answer "what changed in you?", "how do I
 * redo the coat?" and run a playbook — the same records, no second story.
 * ==========================================================
 */

import SelfModel from "./SelfModel";
import OutfitDirector from "../avatar/OutfitDirector";

export interface SelfChangeView {
  hash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  areas: string[];
}
export interface JournalView {
  file: string;
  date: string;
  title: string;
  commits: string[];
  playbooks: string[];
  text: string;
}

export function summariseChanges(changes: SelfChangeView[], journal: JournalView[], max = 8): string {
  if (!changes.length && !journal.length) return "";
  const lines: string[] = [];
  for (const c of changes.slice(0, max)) {
    lines.push(`- ${c.date.slice(0, 10)} ${c.author}: ${c.subject} [${c.areas.slice(0, 3).join("; ")}] (${c.hash.slice(0, 8)})`);
  }
  const lessons = journal.slice(0, 3).map((j) => `- ${j.title} — read ${j.file}${j.playbooks.length ? `; I can repeat it with playbook ${j.playbooks.join(", ")}` : ""}`);
  return [
    "Every commit to my code and assets, newest first (from git, whoever made it):",
    ...lines,
    ...(lessons.length ? ["What was done to me, explained so I can redo it:", ...lessons] : []),
    "If someone asks what changed in me, how something was made, or to redo it, use self.changes / self.journal / self.playbook — never guess.",
  ].join("\n");
}

export default class SelfChangeAwareness {
  private static instance: SelfChangeAwareness | null = null;
  private changes: SelfChangeView[] = [];
  private journal: JournalView[] = [];
  private loadedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  static getInstance(): SelfChangeAwareness {
    if (!SelfChangeAwareness.instance) SelfChangeAwareness.instance = new SelfChangeAwareness();
    return SelfChangeAwareness.instance;
  }

  async refresh(fetcher: typeof fetch = fetch): Promise<void> {
    const res = await fetcher("/api/self/changes?limit=30");
    if (!res.ok) return;
    const data = (await res.json()) as { changes?: SelfChangeView[]; journal?: JournalView[] };
    this.changes = data.changes ?? [];
    this.journal = data.journal ?? [];
    this.loadedAt = Date.now();
    this.teachSelfModel();
  }

  start(intervalMs = 10 * 60 * 1000): void {
    if (this.timer) return;
    void this.refresh().catch(() => undefined);
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), intervalMs);
  }

  /** The newest lessons become knowledge, so she keeps them between conversations. */
  private teachSelfModel(): void {
    try {
      const model = SelfModel.getInstance();
      const state = model.get();
      const lessons = this.journal.slice(0, 5).map((j) => `How I was changed: ${j.title} (${j.file})`);
      const knows = [...lessons, ...state.knows.filter((k) => !k.startsWith("How I was changed:"))].slice(0, 40);
      model.update({ knows });
    } catch {
      /* the self-model is optional in non-browser runtimes */
    }
  }

  data(): { changes: SelfChangeView[]; journal: JournalView[]; loadedAt: number } {
    return { changes: this.changes, journal: this.journal, loadedAt: this.loadedAt };
  }

  /** Section text for CognitiveContext. */
  contextText(): string {
    const outfit = OutfitDirector.get()?.describe() ?? "";
    const changes = summariseChanges(this.changes, this.journal);
    return [outfit, changes].filter(Boolean).join("\n");
  }
}
