/**
 * ==========================================================
 * LÉLU — CONVERSATIONAL EVIDENCE (LÉLU 2.3, part 1)
 *
 * The mission's first requirement is that actual images, renders, before/after
 * comparisons, measurement overlays and commit references appear IN THE
 * CONVERSATION — not behind a dashboard, an artifact directory or a browser.
 *
 * A chat message is text, so evidence has to travel as text too. This module is
 * the protocol: a fenced `evidence` block carries a small JSON array of blocks,
 * and three renderers consume the same blocks —
 *
 *   ChatEvidence.tsx        the chat bubble (images, lightbox, compare, table)
 *   evidenceToMarkdown()    transcript export, and any surface that only speaks
 *                           markdown
 *   the CLI                 writes the blocks next to the artifact they cite
 *
 * The rules are the same ones the journal earned:
 *
 *   1. An image block names its SOURCE PATH and its COMMIT. Evidence that
 *      cannot be traced to a development state is a picture, not evidence.
 *   2. A measurement block carries the number, its unit and what produced it.
 *   3. A compare block is two images of the SAME thing at two states, with the
 *      state labelled. "Before" and "after" are never inferred from order.
 *   4. Parsing never throws in the chat path: a malformed block renders as the
 *      text it was, so a broken message cannot blank a conversation.
 * ==========================================================
 */
import type { ResearchEntry } from "./types.ts";

export interface Measurement {
  label: string;
  value: number | string;
  unit?: string;
  /** What produced this number, e.g. "head-metrics.json → head.jawToCheek". */
  source?: string;
  /** Change against the baseline, when there is one. */
  delta?: number | string;
}

export interface EvidenceImage {
  src: string;
  alt: string;
  caption?: string;
  /** The commit the image was rendered at. */
  commit?: string;
  /** Optional larger version for the expandable view (defaults to `src`). */
  hiRes?: string;
  measurements?: Measurement[];
}

export type EvidenceBlock =
  | ({ kind: "image" } & EvidenceImage)
  | {
      kind: "compare";
      title: string;
      before: EvidenceImage;
      after: EvidenceImage;
      note?: string;
      measurements?: Measurement[];
    }
  | { kind: "group"; title?: string; caption?: string; items: EvidenceImage[] }
  | { kind: "measure"; title: string; rows: Measurement[]; note?: string }
  | { kind: "commit"; sha: string; subject: string; url?: string };

const KINDS = new Set(["image", "compare", "group", "measure", "commit"]);

function isImage(value: unknown): value is EvidenceImage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.src === "string" && v.src.length > 0 && typeof v.alt === "string";
}

function isMeasurements(value: unknown): value is Measurement[] {
  return Array.isArray(value) && value.every((m) => m && typeof m === "object" && typeof (m as Measurement).label === "string");
}

/**
 * Validate one block. Returns a block or null; no exceptions, no partial
 * objects — a renderer must never be handed a shape it cannot draw.
 */
export function normaliseBlock(value: unknown): EvidenceBlock | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || !KINDS.has(v.kind)) return null;
  switch (v.kind) {
    case "image":
      if (!isImage(v)) return null;
      return { kind: "image", ...v, ...(isMeasurements(v.measurements) ? { measurements: v.measurements } : {}) };
    case "compare": {
      if (!isImage(v.before) || !isImage(v.after)) return null;
      return {
        kind: "compare",
        title: typeof v.title === "string" ? v.title : "Before / after",
        before: v.before,
        after: v.after,
        ...(typeof v.note === "string" ? { note: v.note } : {}),
        ...(isMeasurements(v.measurements) ? { measurements: v.measurements } : {}),
      };
    }
    case "group": {
      if (!Array.isArray(v.items) || !v.items.every(isImage)) return null;
      return {
        kind: "group",
        items: v.items,
        ...(typeof v.title === "string" ? { title: v.title } : {}),
        ...(typeof v.caption === "string" ? { caption: v.caption } : {}),
      };
    }
    case "measure":
      if (typeof v.title !== "string" || !isMeasurements(v.rows)) return null;
      return { kind: "measure", title: v.title, rows: v.rows, ...(typeof v.note === "string" ? { note: v.note } : {}) };
    case "commit":
      if (typeof v.sha !== "string" || typeof v.subject !== "string") return null;
      return { kind: "commit", sha: v.sha, subject: v.subject, ...(typeof v.url === "string" ? { url: v.url } : {}) };
    default:
      return null;
  }
}

/** Parse the JSON body of an `evidence` fence. Never throws. */
export function parseEvidence(source: string): EvidenceBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const blocks: EvidenceBlock[] = [];
  for (const item of list) {
    const block = normaliseBlock(item);
    if (block) blocks.push(block);
  }
  return blocks;
}

/**
 * The fenced block a message carries. This is what a generator (the research
 * CLI, an agent reply) writes into the conversation.
 */
export function evidenceFence(blocks: EvidenceBlock[]): string {
  return ["```evidence", JSON.stringify(blocks, null, 1), "```"].join("\n");
}

const escapeAlt = (text: string) => text.replace(/[[\]]/g, "");
const commitTag = (commit?: string) => (commit ? ` \`${commit.slice(0, 8)}\`` : "");

/**
 * Markdown rendering of the same blocks.
 *
 * Images become `![alt](src)` so any markdown surface — an exported transcript,
 * a plain chat, GitHub — shows them. Captions carry the commit, because a
 * picture without its development state is not evidence.
 */
export function evidenceToMarkdown(blocks: EvidenceBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "image": {
        out.push(`![${escapeAlt(block.alt)}](${block.src})`);
        const caption = [block.caption, commitTag(block.commit)].filter(Boolean).join(" — ");
        if (caption) out.push(`*${caption}*`);
        if (block.measurements?.length) out.push(measurementsToMarkdown(block.measurements));
        break;
      }
      case "compare": {
        out.push(`**${block.title}**`);
        // One table, one string: a markdown table cannot survive being emitted
        // line by line, because each block is separated by a blank line.
        out.push(
          [
            `| before | after |`,
            `| --- | --- |`,
            `| ![${escapeAlt(block.before.alt)}](${block.before.src}) | ![${escapeAlt(block.after.alt)}](${block.after.src}) |`,
          ].join("\n"),
        );
        const states = [block.before.caption, block.after.caption].filter(Boolean).join(" → ");
        if (states) out.push(`*${states}${block.note ? ` — ${block.note}` : ""}*`);
        if (block.measurements?.length) out.push(measurementsToMarkdown(block.measurements));
        break;
      }
      case "group": {
        if (block.title) out.push(`**${block.title}**`);
        block.items.forEach((item, i) => {
          out.push(`![${escapeAlt(item.alt)}](${item.src})`);
          out.push(`*${[`${i + 1}. ${item.caption ?? item.alt}`, commitTag(item.commit)].filter(Boolean).join(" — ")}*`);
        });
        if (block.caption) out.push(block.caption);
        break;
      }
      case "measure":
        out.push(`**${block.title}**`);
        out.push(measurementsToMarkdown(block.rows));
        if (block.note) out.push(block.note);
        break;
      case "commit":
        out.push(`- \`${block.sha.slice(0, 8)}\` ${block.subject}${block.url ? ` — ${block.url}` : ""}`);
        break;
    }
  }
  return out.join("\n\n");
}

function measurementsToMarkdown(rows: Measurement[]): string {
  const lines = ["| measurement | value | vs baseline |", "| --- | --- | --- |"];
  for (const row of rows) {
    const value = row.unit ? `${row.value} ${row.unit}` : String(row.value);
    const delta = row.delta === undefined ? "" : String(row.delta);
    lines.push(`| ${row.label} | ${value} | ${delta} |`);
  }
  return lines.join("\n");
}

/** Every image in a block list, for a caller that has to copy assets. */
export function evidenceImages(blocks: EvidenceBlock[]): EvidenceImage[] {
  const out: EvidenceImage[] = [];
  for (const block of blocks) {
    if (block.kind === "image") out.push(block);
    else if (block.kind === "compare") out.push(block.before, block.after);
    else if (block.kind === "group") out.push(...block.items);
  }
  return out;
}

/**
 * Turn a journal entry's measured evidence into chat blocks.
 *
 * Only what the entry actually cites: renders become image blocks (with the
 * entry's commit), measurements become a table. Nothing is invented, and an
 * entry with no visual evidence produces no image block at all — the honest
 * result for a claim that was never photographed.
 */
export function evidenceFromEntry(entry: ResearchEntry): EvidenceBlock[] {
  const blocks: EvidenceBlock[] = [];
  const images = entry.evidence.filter((e) => e.kind === "render" || e.kind === "artifact").filter((e) => /\.(png|jpe?g|webp|svg)$/i.test(e.ref));
  if (images.length === 1) {
    blocks.push({ kind: "image", src: images[0].ref, alt: entry.question.slice(0, 80), caption: `${entry.id} — ${entry.learned.slice(0, 120)}`, commit: images[0].commit ?? entry.commit ?? undefined });
  } else if (images.length > 1) {
    blocks.push({
      kind: "group",
      title: `${entry.id} · ${entry.workPackage}`,
      caption: entry.learned.slice(0, 200),
      items: images.map((e, i) => ({ src: e.ref, alt: `${entry.id} image ${i + 1}`, caption: e.note ?? entry.question.slice(0, 80), commit: e.commit ?? entry.commit ?? undefined })),
    });
  }
  const numbers = entry.evidence.filter((e) => e.kind === "measurement");
  if (numbers.length) {
    blocks.push({
      kind: "measure",
      title: `${entry.id} · measurements`,
      rows: numbers.map((e) => ({ label: e.note ?? e.ref, value: e.ref, source: entry.id })),
      note: `confidence ${entry.confidence.toFixed(2)} · ${entry.status}`,
    });
  }
  if (entry.commit) blocks.push({ kind: "commit", sha: entry.commit, subject: `${entry.workPackage} · ${entry.question.slice(0, 90)}` });
  return blocks;
}

/**
 * Resolve an artifact path to something a browser can load.
 *
 * Evidence lives at repo paths (`artifacts/lelu2/...`). A chat can only render a
 * URL, so the CLI copies what it cites into the app's public directory and
 * records the public path; this function is the one place that mapping is
 * defined, so an image cannot be cited under a path no surface can load.
 */
export function publicEvidencePath(repoPath: string): string {
  const clean = repoPath.replace(/^\.?\//, "");
  return `/lelu2-evidence/${clean.replace(/[\\/]+/g, "__")}`;
}

/** Rewrite every image src through `map`, for a renderer/copy step. */
export function mapEvidenceImages(blocks: EvidenceBlock[], map: (image: EvidenceImage) => EvidenceImage): EvidenceBlock[] {
  return blocks.map((block) => {
    if (block.kind === "image") return { ...block, ...map(block) };
    if (block.kind === "compare") return { ...block, before: map(block.before), after: map(block.after) };
    if (block.kind === "group") return { ...block, items: block.items.map(map) };
    return block;
  });
}
