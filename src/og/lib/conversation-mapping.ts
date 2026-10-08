/**
 * OG conversation UX ↔ canonical LÉLU conversation store.
 *
 * The OG surface was written against a `conversations` table with
 * (archived, pinned, universe_id) columns and a `messages` table whose body
 * was a `parts` jsonb array. The migration gave those names to v1.1's own
 * tables — (metadata jsonb) and (text) — and moved the OG originals to
 * `legacy_conversations` / `legacy_messages`.
 *
 * The live conversation list reads the CANONICAL tables, so the OG chat list
 * shows the conversations LÉLU actually has rather than a frozen copy beside
 * them. The OG-only presentation flags live under `conversations.metadata`,
 * which SupabasePersistence already writes and carries untouched.
 *
 * Only the archive admin (crash recovery, conversation_summaries, anything
 * reading `parts`) stays on the legacy tables, which is where that history
 * and its foreign keys actually are.
 */

import type { Json } from "@og/integrations/supabase/types";

export interface OgConversationRow {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
  archived: boolean;
  pinned: boolean;
  universe_id: string | null;
}

/** Columns to select from the canonical `conversations` table. */
export const CONVERSATION_COLUMNS = "id, title, metadata, created_at, updated_at";

type Row = Record<string, unknown>;

/** The subset of `conversations` columns an OG edit may write. */
export interface ConversationPatch {
  title?: string;
  metadata?: Json;
  updated_at?: string;
}

export function conversationMetadata(row: Row): Record<string, unknown> {
  const value = row.metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toOgConversation(row: Row): OgConversationRow {
  const metadata = conversationMetadata(row);
  const universe = metadata.universeId ?? metadata.universe_id;
  return {
    id: String(row.id ?? ""),
    title: typeof row.title === "string" ? row.title : "",
    updated_at: String(row.updated_at ?? ""),
    created_at: String(row.created_at ?? row.updated_at ?? ""),
    archived: metadata.archived === true,
    pinned: metadata.pinned === true,
    universe_id: typeof universe === "string" && universe.length > 0 ? universe : null,
  };
}

export interface OgConversationPatch {
  title?: string;
  archived?: boolean;
  pinned?: boolean;
  universe_id?: string | null;
}

/**
 * Build the canonical patch for an OG conversation edit.
 *
 * The presentation flags are merged into the existing metadata rather than
 * replacing it, so the brain's own keys (tags, topic, unread, processing,
 * linkedIds) survive a pin or an archive from the UI.
 */
export function toConversationPatch(patch: OgConversationPatch, existing: unknown): ConversationPatch {
  const out: ConversationPatch = {};
  if (patch.title !== undefined) out.title = patch.title;

  const flags: Array<[keyof OgConversationPatch, string]> = [
    ["archived", "archived"],
    ["pinned", "pinned"],
    ["universe_id", "universeId"],
  ];
  const touched = flags.filter(([field]) => patch[field] !== undefined);
  if (touched.length > 0) {
    const base =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    for (const [field, key] of touched) base[key] = patch[field];
    // The values come from (and go back into) a jsonb column; the generated
    // Json type cannot see that through Record<string, unknown>.
    out.metadata = base as Json;
  }

  out.updated_at = new Date().toISOString();
  return out;
}

/**
 * The OG chat UI renders a message as AI-SDK style `parts`. The canonical
 * table stores a plain `text` column, so one text part is reconstructed —
 * the same content, in the shape the existing components already read.
 */
export function toOgMessageParts(row: Row): Array<{ type: "text"; text: string }> {
  const text = typeof row.text === "string" ? row.text : "";
  return text ? [{ type: "text", text }] : [];
}
