/**
 * LÉLU — a conversation's works (the Studio artifacts made in it).
 *
 * Every environment creates, revises and exports through the ONE Studio
 * store — the same versions, compare/restore and verified exporters as work
 * a model's tool call produced — and records what it did in the conversation
 * as a message carrying the artifact card, so the work is visible where it
 * was made and survives a reload.
 */

import { useCallback, useSyncExternalStore } from "react";
import StudioStore, { type StudioArtifact } from "../../../../../core/studio/StudioStore";
import type { ArtifactSpec, ExportFormat } from "../../../../../core/studio/StudioTypes";
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import AgentEventBus from "../../../../../core/agent/AgentEvents";
import type { ActivityArtifact } from "../../../../../core/multichat/TurnActivity";
import { downloadBytes } from "../../studio/useStudio";

const VISUAL_FORMATS = new Set(["svg", "png", "json", "mmd", "html", "csv", "glb", "gltf", "webm", "excalidraw"]);

export function useWorks(conversationId: string): StudioArtifact[] {
  const store = StudioStore.getInstance();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(() => store.getVersion(), [store]);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return store.list().filter((a) => a.conversationId === conversationId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function specOf(a: StudioArtifact): ArtifactSpec {
  return StudioStore.getInstance().latest(a).spec as ArtifactSpec;
}

export function mediumOf(a: StudioArtifact): string | undefined {
  const spec = specOf(a) as { medium?: string };
  return spec.medium;
}

function card(a: StudioArtifact, action: ActivityArtifact["action"], exports: ActivityArtifact["exports"] = []): ActivityArtifact {
  return { artifactId: a.id, rev: a.revisions[a.revisions.length - 1].rev, title: a.title, kind: a.kind as ActivityArtifact["kind"], action, exports };
}

/** Write what an environment did into the conversation, with the work's card. */
export function recordInConversation(conversationId: string, text: string, artifacts: ActivityArtifact[]): void {
  const now = Date.now();
  MultiChatStore.getInstance().addMessage(conversationId, {
    id: `env-${now}-${Math.random().toString(36).slice(2, 7)}`,
    role: "assistant",
    text,
    timestamp: now,
    source: "local",
    provider: "lelu-environment",
    activity: { status: "done", startedAt: now, finishedAt: now, steps: [], sources: [], pages: [], artifacts },
  });
  for (const a of artifacts) {
    AgentEventBus.getInstance().emit({ type: "studio_artifact", taskId: `env-${now}`, artifactId: a.artifactId, rev: a.rev, title: a.title, kind: a.kind, action: a.action, exports: a.exports });
  }
}

export function createWork(conversationId: string, spec: unknown, note: string): { ok: true; artifact: StudioArtifact } | { ok: false; reason: string } {
  const created = StudioStore.getInstance().create(spec, { by: "lelu", note, conversationId });
  if (!created.ok) return created;
  recordInConversation(conversationId, `${note} — **${created.artifact.title}**. Made on this device, no model call; it is versioned in the Studio.`, [card(created.artifact, "created")]);
  return created;
}

export function reviseWork(conversationId: string, a: StudioArtifact, spec: unknown, note: string): { ok: boolean; reason?: string } {
  const r = StudioStore.getInstance().revise(a.id, { spec, note, by: "lelu" });
  if (!r.ok) return { ok: false, reason: (r as { reason?: string }).reason };
  const fresh = StudioStore.getInstance().get(a.id)!;
  recordInConversation(conversationId, `${note} — **${fresh.title}** is now revision ${fresh.revisions[fresh.revisions.length - 1].rev}; earlier revisions are kept for comparison.`, [card(fresh, "revised")]);
  return { ok: true };
}

export interface ExportOutcome {
  ok: boolean;
  format: string;
  filename?: string;
  size?: number;
  bytes?: Uint8Array;
  reason?: string;
}

/** Export through the right verified writer (Studio formats or visual formats). */
export async function exportWork(conversationId: string, a: StudioArtifact, format: string, download = true): Promise<ExportOutcome> {
  let outcome: ExportOutcome;
  if (a.kind === "visual" || (a.kind === "drawing" && format === "excalidraw") || VISUAL_FORMATS.has(format) && !["csv", "html"].includes(format)) {
    const { exportArtifactFile, visualFile } = await import("../../../../../core/creative/kit/CreativeKitTools");
    const r = await exportArtifactFile(a, format as never);
    const rev = a.revisions[a.revisions.length - 1].rev;
    const file = visualFile(a.id, rev, format);
    outcome = { ok: r.ok, format, filename: r.record?.filename, size: r.record?.size, bytes: file?.bytes, reason: r.ok ? undefined : r.line };
  } else {
    const r = await StudioStore.getInstance().export(a.id, format as ExportFormat);
    outcome = r.ok
      ? { ok: r.record.ok, format, filename: r.record.filename, size: r.record.size, bytes: r.result.bytes, reason: r.record.ok ? undefined : "the written file failed its own verification" }
      : { ok: false, format, reason: r.reason };
  }
  if (outcome.ok && outcome.filename) {
    recordInConversation(conversationId, `Exported **${a.title}** as ${format.toUpperCase()} — ${outcome.filename} (${Math.round((outcome.size ?? 0) / 102.4) / 10} KB), verified by reading it back.`, [card(StudioStore.getInstance().get(a.id) ?? a, "exported", [{ format, filename: outcome.filename, ok: true, size: outcome.size ?? 0 }])]);
    if (download && outcome.bytes) downloadBytes(outcome.bytes, outcome.filename, format as ExportFormat);
  }
  return outcome;
}

/** Images the conversation shows, as data URLs (same-origin only), for documents and decks. */
export async function imagesAsDataUrls(srcs: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const src of srcs.slice(0, 8)) {
    try {
      const u = new URL(src, window.location.href);
      if (u.origin !== window.location.origin && !src.startsWith("data:")) continue;
      if (src.startsWith("data:")) { out[src] = src; continue; }
      const blob = await (await fetch(u.toString())).blob();
      if (blob.size > 3_000_000) continue;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1200 / bitmap.width);
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      out[src] = canvas.toDataURL("image/jpeg", 0.82);
    } catch {
      /* an image that cannot be read is left out, not faked */
    }
  }
  return out;
}

/** Ask LÉLU in the conversation itself — the real send path (commands run with no model). */
export function say(conversationId: string, text: string): void {
  window.dispatchEvent(new CustomEvent("lelu-universe-send", { detail: { text, conversationId } }));
}
