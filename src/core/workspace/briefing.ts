/**
 * Her workspace at sign-in (owner, 2026-11-28): LÉLU organizes what matters into sections (recent
 * updates, previous work, self development, future work and tasks), and lays them out in a FORMAT. The
 * home layouts are no longer fixed boxes: each is a format for arranging this information, chosen by the
 * owner or by her, and every item opens the real thing (a conversation, a task, a proposal, a change).
 *
 * Read-only over the existing authorities: NotificationProvider, MultiChatStore, ProjectStore,
 * ImprovementQueue, TaskEngine, and the self journal API. Nothing is copied into a store of its own.
 */
import { COMPOSITION_KINDS } from "../../app/scene/genesis/home/homeComposition";

export type SectionId = "updates" | "previous" | "selfdev" | "future";
export const SECTIONS: Array<{ id: SectionId; title: string }> = [
  { id: "updates", title: "Recent updates" },
  { id: "previous", title: "Previous work" },
  { id: "selfdev", title: "Self development" },
  { id: "future", title: "Future work & tasks" },
];

export type Open =
  | { kind: "conversation"; id: string }
  | { kind: "panel"; panel: string }
  | { kind: "none" };
export interface BriefItem {
  id: string;
  section: SectionId;
  title: string;
  detail?: string;
  time?: number;
  /** A short status word (Proposed, running, 3 messages…). */
  tag?: string;
  open: Open;
}

/** Every format is one of the layout kinds the home engine already defines (one list, not a copy). */
export const FORMATS = COMPOSITION_KINDS.map((k) => ({ id: k.id as string, name: k.name, blurb: k.blurb }));
export type FormatId = string;

const KEY = "lelu.workspace.format.v1";
let format: { id: FormatId; by: "owner" | "lelu" | "default"; reason: string } = { id: "bento", by: "default", reason: "" };
try {
  const saved = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(KEY) ?? "null") : null;
  if (saved && FORMATS.some((f) => f.id === saved.id)) format = saved;
} catch {
  /* default */
}
const listeners = new Set<() => void>();
export function workspaceFormat(): typeof format {
  return format;
}
export function setWorkspaceFormat(id: FormatId, by: "owner" | "lelu", reason = ""): boolean {
  const f = FORMATS.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
  if (!f) return false;
  format = { id: f.id, by, reason };
  try {
    localStorage?.setItem(KEY, JSON.stringify(format));
  } catch {
    /* memory only */
  }
  for (const fn of listeners) fn();
  return true;
}
export function subscribeWorkspaceFormat(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** The format a sentence names ("as a timeline" is not one; "bento", "card table", "retro terminal" are). */
export function formatIn(text: string): FormatId | null {
  const t = text.toLowerCase();
  const hit = [...FORMATS].sort((a, b) => b.name.length - a.name.length).find((f) => t.includes(f.name.toLowerCase()) || new RegExp(`\\b${f.id}\\b`).test(t));
  return hit?.id ?? null;
}

const OPEN_IMPROVEMENT = new Set(["Detected", "Analyzing", "Proposed", "Approved", "In Development", "Testing", "Evaluation", "Ready", "Applying", "Blocked"]);
const OPEN_TASK = /^(new|planning|ready|running|waiting|paused|blocked|queued|pending|in[_ -]?progress)/i;

/** Gather the sections from the live authorities. `journal` comes from /api/self/journal when reachable. */
export async function gatherBriefing(journal?: Array<{ file: string; date: string; title: string }>): Promise<BriefItem[]> {
  const out: BriefItem[] = [];
  const safe = async (fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch {
      /* an authority that cannot answer contributes nothing */
    }
  };
  await safe(async () => {
    const N = (await import("../notifications/NotificationProvider")).default.getInstance();
    for (const n of N.history().slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 8))
      out.push({ id: `n-${n.id}`, section: "updates", title: n.title, detail: n.body, time: n.timestamp, tag: n.type, open: n.conversationId ? { kind: "conversation", id: n.conversationId } : { kind: "panel", panel: "notifications" } });
  });
  await safe(async () => {
    const MC = (await import("../multichat/MultiChatStore")).default.getInstance() as unknown as { list(): Array<{ id: string; title: string; messages: Array<{ text: string; timestamp?: number }>; updatedAt?: number }> };
    for (const c of MC.list().slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 8)) {
      const last = c.messages[c.messages.length - 1];
      out.push({ id: `c-${c.id}`, section: "previous", title: c.title, detail: last?.text?.slice(0, 140), time: c.updatedAt ?? last?.timestamp, tag: `${c.messages.length} message${c.messages.length === 1 ? "" : "s"}`, open: { kind: "conversation", id: c.id } });
    }
  });
  await safe(async () => {
    const P = (await import("../projects/ProjectStore")).default.getInstance() as unknown as { list(): Array<{ id: string; name: string; items: unknown[]; updatedAt?: number }> };
    for (const p of P.list().slice(0, 6)) out.push({ id: `p-${p.id}`, section: "previous", title: p.name, tag: `${p.items.length} item${p.items.length === 1 ? "" : "s"}`, time: p.updatedAt, open: { kind: "panel", panel: "projects" } });
  });
  for (const j of (journal ?? []).slice(0, 8)) out.push({ id: `j-${j.file}`, section: "selfdev", title: j.title, detail: j.file.replace(/^journal\//, ""), time: Date.parse(j.date) || undefined, tag: "journal", open: { kind: "panel", panel: "evolution" } });
  await safe(async () => {
    const Q = (await import("../selfdev/ImprovementQueue")).default.getInstance();
    for (const p of Q.list()) {
      const open = OPEN_IMPROVEMENT.has(p.status);
      out.push({ id: `i-${p.id}`, section: open ? "future" : "selfdev", title: p.title, detail: p.expectedBenefit || p.problem, time: p.updated, tag: p.status, open: { kind: "panel", panel: "evolution" } });
    }
  });
  await safe(async () => {
    const T = (await import("../tasks/TaskEngine")).default.getInstance();
    for (const t of T.list().filter((x) => OPEN_TASK.test(String(x.status))).slice(0, 10)) out.push({ id: `t-${t.id}`, section: "future", title: t.goal, detail: t.description, time: t.updatedAt, tag: String(t.status), open: { kind: "panel", panel: "workspaces" } });
  });
  return out;
}
