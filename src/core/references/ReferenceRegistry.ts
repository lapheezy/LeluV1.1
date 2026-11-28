/**
 * ==========================================================
 * LÉLU — REFERENCE REGISTRY
 *
 * One searchable index of the owner's visual references, recovered from
 * the atlas links (reference/atlas) and uploaded by the owner
 * (reference/user). Builders read it to find what a family, layer, place
 * or planned world is based on; the renderer reads it to draw a reference
 * plate or take a palette from a reference.
 *
 * The images are personal reference material: they live only in the
 * Git-ignored reference/ folder, are served by the dev server, and are
 * never copied into a production bundle. This module holds no image data.
 *
 * Nothing is silently substituted: a link that gave no image, gave only a
 * logo, or gave the wrong image, and every planned world a reference
 * points at, is kept as an UNRESOLVED record with its reason.
 *
 * Pure: no DOM, no fetch, no storage.
 * ==========================================================
 */

import { ATLAS_LABELS, CATEGORIES, USER_LABELS, type Category, type Content, type ReferenceLabel } from "./referenceLabels";

export interface AtlasIndexRecord {
  code: string;
  source: string;
  file?: string;
  files?: string[];
  note?: string;
  image?: string;
}
export interface UserIndexRecord {
  code: string;
  file: string;
  source: string;
  originalName?: string;
  size?: [number, number];
  crop?: [number, number, number, number];
}

export type RefStatus = "usable" | "logo-only" | "placeholder";

export interface ReferenceEntry {
  id: string;
  code: string;
  origin: "atlas" | "owner";
  source: string;
  /** Path inside reference/, e.g. "atlas/I-35.jpg". */
  file: string;
  /** Dev-server URL. Absent from production builds by design. */
  url: string;
  crop?: [number, number, number, number];
  status: RefStatus;
  shows: string;
  content: Content;
  categories: Category[];
  franchise?: string;
  informs: string[];
  mismatch?: string;
}

export type UnresolvedReason = "blocked" | "rate-limited" | "no-preview" | "pdf" | "network" | "logo-only" | "placeholder" | "mismatch" | "unlabelled";
export interface UnresolvedRecord {
  code: string;
  source: string;
  reason: UnresolvedReason;
  detail: string;
}

export interface Relation {
  ref: string;
  target: string;
  /** implemented: the target exists in LÉLU now; planned: recorded, not built. */
  state: "implemented" | "planned" | "unknown";
}

export interface Registry {
  version: 1;
  builtAt: string;
  totals: { atlasLinks: number; atlasDownloaded: number; atlasUsable: number; ownerUploads: number; entries: number; unresolved: number };
  entries: ReferenceEntry[];
  unresolved: UnresolvedRecord[];
  relations: Relation[];
  /** Planned targets and the references waiting on them. */
  planned: Record<string, string[]>;
}

export interface KnownTargets {
  families: string[];
  layerKinds: string[];
  /** "tampa:c1920", "tampa", … */
  places: string[];
  features: string[];
}

const reasonOf = (note = ""): UnresolvedReason =>
  /pdf/i.test(note) ? "pdf" : /preview/i.test(note) ? "no-preview" : /403/.test(note) ? "blocked" : /429/.test(note) ? "rate-limited" : "network";

export function targetState(target: string, known: KnownTargets): Relation["state"] {
  const [kind, ...rest] = target.split(":");
  const id = rest.join(":");
  switch (kind) {
    case "family":
      return known.families.includes(id) ? "implemented" : "unknown";
    case "layer":
      return known.layerKinds.includes(id) ? "implemented" : "unknown";
    case "place":
      return known.places.includes(id) ? "implemented" : "unknown";
    case "feature":
      return known.features.includes(id) ? "implemented" : "unknown";
    case "planned":
    case "character-style":
      return "planned";
    default:
      return "unknown";
  }
}

export function buildRegistry(input: { atlas: AtlasIndexRecord[]; user: UserIndexRecord[]; known: KnownTargets; now?: string }): Registry {
  const entries: ReferenceEntry[] = [];
  const unresolved: UnresolvedRecord[] = [];
  const add = (origin: "atlas" | "owner", rec: { code: string; source: string; file: string; crop?: [number, number, number, number] }, label: ReferenceLabel | undefined) => {
    if (!label) {
      unresolved.push({ code: rec.code, source: rec.source, reason: "unlabelled", detail: `${rec.file} has not been looked at and labelled yet` });
      return;
    }
    const status: RefStatus = label.content === "logo" ? "logo-only" : label.content === "placeholder" ? "placeholder" : "usable";
    const dir = origin === "atlas" ? "atlas" : "user";
    entries.push({
      id: `${origin}:${rec.code}`,
      code: rec.code,
      origin,
      source: rec.source,
      file: `${dir}/${rec.file}`,
      url: `/reference/${dir}/${encodeURIComponent(rec.file)}`,
      crop: rec.crop,
      status,
      shows: label.shows,
      content: label.content,
      categories: label.categories.filter((c) => (CATEGORIES as readonly string[]).includes(c)),
      franchise: label.franchise,
      informs: status === "usable" ? label.informs : [],
      mismatch: label.mismatch,
    });
    if (status !== "usable") unresolved.push({ code: rec.code, source: rec.source, reason: status === "logo-only" ? "logo-only" : "placeholder", detail: label.shows });
    if (label.mismatch) unresolved.push({ code: rec.code, source: rec.source, reason: "mismatch", detail: label.mismatch });
  };
  for (const a of input.atlas) {
    if (a.file) add("atlas", { code: a.code, source: a.source, file: a.file }, ATLAS_LABELS[a.code]);
    else unresolved.push({ code: a.code, source: a.source, reason: reasonOf(a.note), detail: a.note ?? "no image" });
  }
  for (const u of input.user) add("owner", { code: u.code, source: u.source, file: u.file, crop: u.crop }, USER_LABELS[u.code]);

  const relations: Relation[] = entries.flatMap((e) => e.informs.map((t) => ({ ref: e.id, target: t, state: targetState(t, input.known) })));
  const planned: Record<string, string[]> = {};
  for (const r of relations) if (r.state === "planned") (planned[r.target] ??= []).push(r.ref);
  return {
    version: 1,
    builtAt: input.now ?? new Date().toISOString(),
    totals: {
      atlasLinks: input.atlas.length,
      atlasDownloaded: input.atlas.filter((a) => a.file).length,
      atlasUsable: entries.filter((e) => e.origin === "atlas" && e.status === "usable").length,
      ownerUploads: input.user.length,
      entries: entries.length,
      unresolved: unresolved.length,
    },
    entries,
    unresolved,
    relations,
    planned,
  };
}

export interface ReferenceQuery {
  text?: string;
  category?: Category;
  franchise?: string;
  /** A target: "family:volcano", "planned:retro-video-store", "layer:rain"… */
  informs?: string;
  origin?: "atlas" | "owner";
  /** Default true: logos and placeholders are not visual references. */
  usableOnly?: boolean;
}

export function searchReferences(reg: Pick<Registry, "entries">, q: ReferenceQuery): ReferenceEntry[] {
  const text = q.text?.trim().toLowerCase();
  return reg.entries.filter(
    (e) =>
      (q.usableOnly === false || e.status === "usable") &&
      (!q.category || e.categories.includes(q.category)) &&
      (!q.franchise || (e.franchise ?? "").toLowerCase().includes(q.franchise.toLowerCase())) &&
      (!q.informs || e.informs.includes(q.informs)) &&
      (!q.origin || e.origin === q.origin) &&
      (!text || `${e.code} ${e.shows} ${e.franchise ?? ""} ${e.categories.join(" ")} ${e.informs.join(" ")} ${e.source}`.toLowerCase().includes(text)),
  );
}

export function referenceById(reg: Pick<Registry, "entries">, id: string): ReferenceEntry | undefined {
  return reg.entries.find((e) => e.id === id || e.code === id);
}

/** What the references say about one visual object (a family, layer, place or planned world). */
export function referencesFor(reg: Pick<Registry, "entries">, target: string): ReferenceEntry[] {
  return reg.entries.filter((e) => e.status === "usable" && e.informs.includes(target));
}
