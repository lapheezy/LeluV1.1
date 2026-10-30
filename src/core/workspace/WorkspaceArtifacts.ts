/**
 * ==========================================================
 * LÉLU — WORKSPACE ARTIFACTS
 *
 * The workspace's views ARE the artifacts: the screenshot a capture
 * took, the page browser.read opened, the note or diagram LÉLU made.
 * This module says what each one is (for her context and her tools),
 * finds the one a request means, and turns a requested change into a
 * patch of that same view — the real object, not a copy described in
 * prose. Pure: WorkspaceEngine applies what it returns.
 *
 *   "this" / "it" / nothing named → the artifact the USER selected,
 *                                   then the focused one
 *   a view id or part of a title  → that artifact
 * ==========================================================
 */

import type { WorkspaceState, WorkspaceView, WorkspaceViewKind } from "./WorkspaceEngine";
import type { GraphEdge, GraphNode, TableColumn, TableRow, VisualSpec } from "./VisualSpec";

/** Views the app opens on its own: status surfaces, not artifacts. */
const SYSTEM_KINDS = new Set<WorkspaceViewKind>(["executive", "activity", "genesis"]);

export function isArtifact(view: WorkspaceView): boolean {
  return !SYSTEM_KINDS.has(view.kind);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+\n/g, "\n").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** What an image URL is, without pasting a data URL into a prompt. */
function describeImageUrl(url: string): string {
  const match = /^data:([^;,]+)[^,]*,/.exec(url);
  if (!match) return url;
  const kb = Math.round((url.length - match[0].length) * 0.75 / 1024);
  return `an image (${match[1]}, about ${kb} KB) — the user sees it; you see only what is written about it here`;
}

function describeSpec(spec: VisualSpec, max: number): string {
  const lines: string[] = [];
  if (spec.caption) lines.push(`Caption: ${spec.caption}`);
  if (spec.nodes?.length) {
    lines.push(`Nodes: ${spec.nodes.map((node) => `${node.label} [${node.id}]`).join(", ")}`);
  }
  if (spec.edges?.length) {
    const label = new Map((spec.nodes ?? []).map((node) => [node.id, node.label]));
    lines.push(`Connections: ${spec.edges.map((edge) => `${label.get(edge.from) ?? edge.from} → ${label.get(edge.to) ?? edge.to}${edge.label ? ` (${edge.label})` : ""}`).join("; ")}`);
  }
  if (spec.columns?.length) {
    lines.push(`Columns: ${spec.columns.map((column) => column.label).join(" | ")}`);
    for (const row of (spec.rows ?? []).slice(0, 20)) {
      lines.push(`  ${spec.columns.map((column) => row[column.key] ?? "").join(" | ")}`);
    }
    if ((spec.rows?.length ?? 0) > 20) lines.push(`  … ${spec.rows!.length - 20} more rows`);
  }
  if (spec.series?.length) lines.push(`Values: ${spec.series.map((point) => `${point.label} ${point.value}`).join(", ")}`);
  if (spec.timeline?.length) lines.push(`Timeline: ${spec.timeline.map((event) => `${event.time} ${event.label}`).join("; ")}`);
  if (spec.boxes?.length) lines.push(`Boxes: ${spec.boxes.map((box) => box.label).join(", ")}`);
  if (spec.text) lines.push(`Text:\n${spec.text}`);
  return clip(lines.join("\n"), max);
}

/** One line: which artifact, what kind, what made it. */
export function describeArtifactBrief(view: WorkspaceView): string {
  const source = view.source
    ? ` · from ${view.source.tool}${view.source.url ? ` (${view.source.url})` : ""}`
    : "";
  return `[${view.id}] ${view.kind} “${view.title}” · revision ${view.revision}${source}`;
}

/** The artifact itself, as far as text can carry it. */
export function describeArtifact(view: WorkspaceView, max = 4000): string {
  const parts = [describeArtifactBrief(view)];
  if (view.url) parts.push(view.kind === "image" ? `Image: ${describeImageUrl(view.url)}` : `Address: ${view.url}`);
  if (view.text) parts.push(`${view.kind === "file" ? "Content" : view.kind === "browser" ? "Page text" : "Notes"}:\n${clip(view.text, max)}`);
  if (view.spec) parts.push(describeSpec(view.spec, max));
  if (!view.url && !view.text && !view.spec) parts.push("(no content of its own: a live status view)");
  return parts.join("\n");
}

/**
 * Which artifact a request means. An empty reference — "this", "it",
 * nothing — is the user's selection, then whatever is focused.
 */
export function resolveArtifact(state: WorkspaceState, reference?: string): WorkspaceView | null {
  const artifacts = state.views.filter(isArtifact);
  const ref = (reference ?? "").trim().toLowerCase();
  const generic = !ref || /^(this|it|that|the selected( one| artifact)?|selected|current)$/.test(ref);
  if (generic) {
    return (
      artifacts.find((view) => view.id === state.selectedId) ??
      artifacts.find((view) => view.id === state.focusId) ??
      null
    );
  }
  return (
    artifacts.find((view) => view.id.toLowerCase() === ref) ??
    artifacts.find((view) => view.title.toLowerCase() === ref) ??
    artifacts.find((view) => view.title.toLowerCase().includes(ref)) ??
    null
  );
}

/** The workspace as her cognition sees it: what is open, and what the user picked. */
export function describeWorkspace(state: WorkspaceState): string {
  const artifacts = state.views.filter(isArtifact).sort((a, b) => b.updatedAt - a.updatedAt);
  if (artifacts.length === 0) {
    return "No artifacts are open in the workspace. What you capture, read or create with artifact_create appears there.";
  }
  const lines = artifacts.slice(0, 10).map((view) => {
    const marks = [view.id === state.selectedId ? "SELECTED by the user" : "", view.id === state.focusId ? "in front" : ""].filter(Boolean);
    return `- ${describeArtifactBrief(view)}${marks.length ? ` — ${marks.join(", ")}` : ""}`;
  });
  if (artifacts.length > 10) lines.push(`- … ${artifacts.length - 10} more`);
  const selected = artifacts.find((view) => view.id === state.selectedId);
  const focus =
    selected
      ? `\nThe user selected [${selected.id}]. When they say "this", "it" or "the selected one", they mean it:\n${describeArtifact(selected, 900)}`
      : "\nThe user has not selected an artifact.";
  return (
    `${lines.join("\n")}${focus}\n` +
    "artifact_read gives an artifact's full content; artifact_edit changes that real artifact (title, notes/text, diagram nodes and connections, table rows) and the user sees the new revision; artifact_create makes a new note, diagram or table."
  );
}

/* --------------------------------- edits --------------------------------- */

export interface ArtifactEdit {
  title?: string;
  /** Replace the whole text (a note's content, a page's text, an image's notes). */
  text?: string;
  /** Add to the end of the text. */
  append?: string;
  /** Replace one exact passage of the text. */
  find?: string;
  replace?: string;
  caption?: string;
  /** Diagram: add nodes by label. */
  addNodes?: string[];
  /** Diagram: rename a node (by id or label). */
  renameNode?: { node: string; label: string };
  /** Diagram: remove a node (by id or label) and its connections. */
  removeNode?: string;
  /** Diagram: connect two nodes (by id or label). */
  connect?: { from: string; to: string; label?: string };
  /** Table: add a row (column label or key → value). */
  addRow?: Record<string, string>;
  /** Table: remove a row by its 1-based position. */
  removeRow?: number;
}

export type ArtifactPatch = { spec?: VisualSpec; text?: string; title?: string };

export type PlannedEdit = { ok: true; patch: ArtifactPatch; changes: string[] } | { ok: false; reason: string };

function slug(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "node";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function findNode(nodes: GraphNode[], ref: string): GraphNode | undefined {
  const lower = ref.trim().toLowerCase();
  return nodes.find((node) => node.id.toLowerCase() === lower) ?? nodes.find((node) => node.label.toLowerCase() === lower);
}

/** The change, as a patch of the artifact — or exactly why it cannot be made. */
export function planArtifactEdit(view: WorkspaceView, edit: ArtifactEdit): PlannedEdit {
  const changes: string[] = [];
  const patch: ArtifactPatch = {};

  const title = edit.title?.trim();
  if (title && title !== view.title) {
    patch.title = title.slice(0, 120);
    changes.push(`title → “${patch.title}”`);
  }

  let text = view.text ?? "";
  let textChanged = false;
  if (typeof edit.text === "string") {
    text = edit.text;
    textChanged = true;
    changes.push(`text replaced (${edit.text.length} characters)`);
  }
  if (edit.find !== undefined) {
    if (!edit.find || !text.includes(edit.find)) {
      return { ok: false, reason: `The text “${(edit.find ?? "").slice(0, 80)}” is not in [${view.id}]; nothing was changed. Read it with artifact_read first.` };
    }
    text = text.replace(edit.find, edit.replace ?? "");
    textChanged = true;
    changes.push(`replaced “${edit.find.slice(0, 40)}”`);
  }
  if (edit.append) {
    text = text ? `${text}\n${edit.append}` : edit.append;
    textChanged = true;
    changes.push(`added ${edit.append.length} characters of text`);
  }
  if (textChanged) patch.text = text;

  const wantsGraph = Boolean(edit.addNodes?.length || edit.renameNode || edit.removeNode || edit.connect);
  const wantsTable = Boolean(edit.addRow || edit.removeRow);
  if (wantsGraph || wantsTable || edit.caption !== undefined) {
    if (!view.spec) {
      return {
        ok: false,
        reason: `[${view.id}] is ${view.kind === "image" ? "an image" : `a ${view.kind} view`}: it has no ${wantsGraph ? "nodes" : wantsTable ? "rows" : "caption"}. You can change its title or its text/notes, or make a new diagram or table with artifact_create.`,
      };
    }
    const spec: VisualSpec = { ...view.spec, nodes: [...(view.spec.nodes ?? [])], edges: [...(view.spec.edges ?? [])], rows: [...(view.spec.rows ?? [])] };
    if (edit.caption !== undefined) {
      spec.caption = edit.caption;
      changes.push("caption changed");
    }
    if (wantsGraph && !view.spec.nodes && view.kind !== "diagram") {
      return { ok: false, reason: `[${view.id}] is a ${view.kind}, not a diagram: it has no nodes.` };
    }
    const nodes = spec.nodes!;
    let edges: GraphEdge[] = spec.edges!;
    const taken = new Set(nodes.map((node) => node.id));
    for (const label of edit.addNodes ?? []) {
      if (!label.trim()) continue;
      nodes.push({ id: slug(label, taken), label: label.trim() });
      changes.push(`node “${label.trim()}” added`);
    }
    if (edit.renameNode) {
      const node = findNode(nodes, edit.renameNode.node);
      if (!node) return { ok: false, reason: `No node “${edit.renameNode.node}” in [${view.id}]; nothing was changed.` };
      nodes[nodes.indexOf(node)] = { ...node, label: edit.renameNode.label };
      changes.push(`node “${node.label}” renamed “${edit.renameNode.label}”`);
    }
    if (edit.removeNode) {
      const node = findNode(nodes, edit.removeNode);
      if (!node) return { ok: false, reason: `No node “${edit.removeNode}” in [${view.id}]; nothing was changed.` };
      nodes.splice(nodes.indexOf(node), 1);
      edges = edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
      changes.push(`node “${node.label}” removed`);
    }
    if (edit.connect) {
      const from = findNode(nodes, edit.connect.from);
      const to = findNode(nodes, edit.connect.to);
      if (!from || !to) return { ok: false, reason: `No node “${!from ? edit.connect.from : edit.connect.to}” in [${view.id}]; nothing was changed.` };
      edges.push({ from: from.id, to: to.id, ...(edit.connect.label ? { label: edit.connect.label } : {}) });
      changes.push(`connected “${from.label}” → “${to.label}”`);
    }
    spec.edges = edges;
    if (wantsTable) {
      const columns: TableColumn[] = spec.columns ?? [];
      if (columns.length === 0) return { ok: false, reason: `[${view.id}] has no table columns.` };
      const rows: TableRow[] = spec.rows!;
      if (edit.removeRow) {
        if (edit.removeRow < 1 || edit.removeRow > rows.length) return { ok: false, reason: `[${view.id}] has ${rows.length} rows; there is no row ${edit.removeRow}.` };
        rows.splice(edit.removeRow - 1, 1);
        changes.push(`row ${edit.removeRow} removed`);
      }
      if (edit.addRow) {
        const row: TableRow = {};
        for (const [key, value] of Object.entries(edit.addRow)) {
          const column = columns.find((c) => c.key === key || c.label.toLowerCase() === key.toLowerCase());
          if (!column) return { ok: false, reason: `[${view.id}] has no column “${key}” (columns: ${columns.map((c) => c.label).join(", ")}).` };
          row[column.key] = String(value);
        }
        rows.push(row);
        changes.push("row added");
      }
    }
    // Arrays the view never had stay absent: a table does not gain empty nodes.
    if (!view.spec.nodes && nodes.length === 0) delete spec.nodes;
    if (!view.spec.edges && edges.length === 0) delete spec.edges;
    if (!view.spec.rows && spec.rows!.length === 0) delete spec.rows;
    patch.spec = spec;
  }

  if (changes.length === 0) return { ok: false, reason: "No change was asked for; the artifact is as it was." };
  return { ok: true, patch, changes };
}

/* -------------------------------- creation -------------------------------- */

export interface ArtifactDraft {
  kind: "note" | "diagram" | "table";
  title: string;
  text?: string;
  nodes?: string[];
  connections?: Array<{ from: string; to: string; label?: string }>;
  columns?: string[];
  rows?: Array<Record<string, string> | string[]>;
}

/** A new artifact as a workspace view — or why it cannot be made. */
export function draftArtifact(draft: ArtifactDraft): { ok: true; view: { kind: WorkspaceViewKind; title: string; text?: string; spec?: VisualSpec } } | { ok: false; reason: string } {
  const title = draft.title?.trim().slice(0, 120);
  if (!title) return { ok: false, reason: "A new artifact needs a title." };
  if (draft.kind === "note") {
    if (!draft.text?.trim()) return { ok: false, reason: "A note needs its text." };
    return { ok: true, view: { kind: "file", title, text: draft.text } };
  }
  if (draft.kind === "diagram") {
    const taken = new Set<string>();
    const nodes: GraphNode[] = (draft.nodes ?? []).filter((label) => label.trim()).map((label) => ({ id: slug(label, taken), label: label.trim() }));
    if (nodes.length === 0) return { ok: false, reason: "A diagram needs at least one node." };
    const edges: GraphEdge[] = [];
    for (const connection of draft.connections ?? []) {
      const from = findNode(nodes, connection.from);
      const to = findNode(nodes, connection.to);
      if (!from || !to) return { ok: false, reason: `The connection ${connection.from} → ${connection.to} names a node that is not in the diagram.` };
      edges.push({ from: from.id, to: to.id, ...(connection.label ? { label: connection.label } : {}) });
    }
    return { ok: true, view: { kind: "diagram", title, ...(draft.text ? { text: draft.text } : {}), spec: { kind: "diagram", title, nodes, edges } } };
  }
  if (draft.kind === "table") {
    const labels = (draft.columns ?? []).map((label) => label.trim()).filter(Boolean);
    if (labels.length === 0) return { ok: false, reason: "A table needs its columns." };
    const taken = new Set<string>();
    const columns: TableColumn[] = labels.map((label) => ({ key: slug(label, taken), label }));
    const rows: TableRow[] = (draft.rows ?? []).map((row) => {
      const out: TableRow = {};
      columns.forEach((column, index) => {
        const value = Array.isArray(row) ? row[index] : (row[column.label] ?? row[column.key]);
        out[column.key] = value === undefined ? "" : String(value);
      });
      return out;
    });
    return { ok: true, view: { kind: "table", title, ...(draft.text ? { text: draft.text } : {}), spec: { kind: "table", title, columns, rows } } };
  }
  return { ok: false, reason: `Unknown artifact kind “${String(draft.kind)}”: use note, diagram or table.` };
}
