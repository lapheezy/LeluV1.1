/**
 * OG memory UX ↔ canonical LÉLU memory store.
 *
 * The OG surface was written against a `memories` table whose shape was
 * (key, value, importance 1-5, title, summary, tags, pinned, archived,
 * last_referenced_at). That table is now `legacy_memories`: a frozen snapshot.
 * The live brain writes `memory_items` (prompt, response, importance 0-1,
 * keywords, context jsonb) — and the legacy rows were hydrated into it with
 * their original ids.
 *
 * So the OG panels read and write `memory_items` through this translation.
 * One brain, two presentations — never a second memory store.
 *
 * Presentation-only fields the brain has no column for (title, summary,
 * pinned, archived, sourceConversationId) live under `memory_items.context`,
 * which the brain already carries untouched.
 */

import type { Json } from "@og/integrations/supabase/types";

/** Columns the OG panels need, selected from `memory_items`. */
export const MEMORY_ITEM_COLUMNS =
  "id, category, memory_type, prompt, response, keywords, context, importance, confidence, created_at, updated_at";

export interface OgMemoryRow {
  id: string;
  category: string;
  key: string;
  title: string | null;
  summary: string | null;
  value: string;
  /** 1-5, as the OG UI renders it. */
  importance: number;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  // The underlying columns are NOT NULL, so these are plain strings; the OG
  // components format them directly and a null would throw in new Date().
  last_referenced_at: string;
  created_at: string;
  updated_at: string;
  source_conversation_id: string | null;
}

type Row = Record<string, unknown>;

/** The subset of `memory_items` columns an OG edit may write. */
export interface MemoryItemPatch {
  prompt?: string;
  response?: string;
  category?: string;
  importance?: number;
  keywords?: string[];
  context?: Json;
  updated_at?: string;
}

function ctx(row: Row): Record<string, unknown> {
  const value = row.context;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** memory_items importance is a 0-1 float; the OG UI shows 1-5. */
export function toOgImportance(importance: unknown): number {
  const raw = typeof importance === "number" ? importance : Number(importance);
  if (!Number.isFinite(raw)) return 3;
  // Values already in 1-5 (legacy ints that never got normalised) pass through.
  const scaled = raw > 1 ? raw : raw * 5;
  return Math.min(5, Math.max(1, Math.round(scaled)));
}

/** Inverse of toOgImportance, back onto the brain's 0-1 scale. */
export function fromOgImportance(importance: number): number {
  return Math.min(1, Math.max(0, importance / 5));
}

export function toOgMemory(row: Row): OgMemoryRow {
  const context = ctx(row);
  return {
    id: String(row.id ?? ""),
    category: str(row.category) ?? "general",
    key: str(row.prompt) ?? "",
    title: str(context.title),
    summary: str(context.summary),
    value: str(row.response) ?? "",
    importance: toOgImportance(row.importance),
    tags: Array.isArray(row.keywords) ? row.keywords.map(String) : [],
    pinned: context.pinned === true,
    archived: context.archived === true,
    last_referenced_at: str(row.updated_at) ?? "",
    created_at: str(row.created_at) ?? "",
    updated_at: str(row.updated_at) ?? "",
    source_conversation_id: str(context.sourceConversationId) ?? str(context.source_conversation_id),
  };
}

export interface OgMemoryPatch {
  title?: string | null;
  summary?: string | null;
  value?: string;
  category?: string;
  key?: string;
  importance?: number;
  tags?: string[];
  pinned?: boolean;
  archived?: boolean;
}

/**
 * Build the `memory_items` patch for an OG edit, merging presentation fields
 * into the existing context rather than replacing it — the brain's own context
 * keys must survive a UI pin.
 */
export function toMemoryItemPatch(patch: OgMemoryPatch, existingContext: unknown): MemoryItemPatch {
  const out: MemoryItemPatch = {};
  if (patch.key !== undefined) out.prompt = patch.key;
  if (patch.value !== undefined) out.response = patch.value;
  if (patch.category !== undefined) out.category = patch.category;
  if (patch.importance !== undefined) out.importance = fromOgImportance(patch.importance);
  if (patch.tags !== undefined) out.keywords = patch.tags;

  const presentation: Array<[keyof OgMemoryPatch, string]> = [
    ["title", "title"],
    ["summary", "summary"],
    ["pinned", "pinned"],
    ["archived", "archived"],
  ];
  const touched = presentation.filter(([field]) => patch[field] !== undefined);
  if (touched.length > 0) {
    const base =
      existingContext && typeof existingContext === "object" && !Array.isArray(existingContext)
        ? { ...(existingContext as Record<string, unknown>) }
        : {};
    for (const [field, key] of touched) base[key] = patch[field];
    // The values come from (and go back into) a jsonb column; the generated
    // Json type cannot see that through Record<string, unknown>.
    out.context = base as Json;
  }

  out.updated_at = new Date().toISOString();
  return out;
}

/** Search across the fields the OG memory search box targets. */
export function matchesSearch(row: OgMemoryRow, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [row.key, row.value, row.title, row.summary]
    .some((field) => (field ?? "").toLowerCase().includes(needle));
}
