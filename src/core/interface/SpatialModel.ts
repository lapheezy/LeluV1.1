/**
 * ==========================================================
 * LÉLU — SPATIAL MODEL
 *
 * The Cosmos workspace as geometry LÉLU can reason about:
 * every window's rectangle, depth (z-order), rotation, group,
 * presentation and its relationships to the others (left of,
 * above, overlapping, off-screen …), plus a layout solver that
 * turns structured operations into concrete geometry that fits
 * the real viewport.
 *
 *   move · resize · transform (rotate) · open · minimize ·
 *   maximize · restore · close · raise · group · ungroup ·
 *   arrange (relations | grid | columns | focus | cascade |
 *            organic | fit)
 *
 * Pure functions over plain data — no DOM, no React — so the
 * same plan that is previewed is the plan that is applied, and
 * every rule here is unit-tested.
 *
 * Phones: the chat is the app. A phone layout keeps the chat
 * full-screen and its composer reachable, shows ONE tool window
 * as a sheet in the upper part of the screen and minimizes the
 * rest, so nothing overlaps and every control stays reachable.
 * ==========================================================
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
  mobile: boolean;
  /** Space reserved for persistent chrome (dock rail, top controls, composer). */
  insets: Insets;
}

export type WindowKind = "chat" | "module";
export type WindowPresentation = "inline" | "expanded" | "minimized" | "closed";

export interface WindowDescriptor {
  id: string;
  kind: WindowKind;
  label: string;
  presentation: WindowPresentation;
  rect: Rect;
  zIndex: number;
  rotation: number;
  group?: string;
}

export interface WindowLayout {
  presentation: WindowPresentation;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation: number;
  group?: string;
}

export type Relation = "beside" | "left-of" | "right-of" | "above" | "below";

export interface RelationConstraint {
  id: string;
  relation: Relation;
  of: string;
}

export type ArrangeStrategy = "relations" | "grid" | "columns" | "focus" | "cascade" | "organic" | "fit";

export type WindowOp =
  | { op: "move"; id: string; x: number; y: number }
  | { op: "resize"; id: string; width: number; height: number }
  | { op: "transform"; id: string; rotation: number }
  | { op: "open" | "minimize" | "maximize" | "restore" | "close" | "raise"; id: string }
  | { op: "group"; ids: string[]; group: string }
  | { op: "ungroup"; ids: string[] }
  | { op: "arrange"; strategy: ArrangeStrategy; ids?: string[]; relations?: RelationConstraint[]; primary?: string };

export const GAP = 12;
export const MIN_WIDTH = 280;
export const MIN_HEIGHT = 200;
const MOBILE_BREAKPOINT = 720;

/** The viewport as the Genesis chrome actually reserves it. */
export function makeViewport(width: number, height: number): Viewport {
  const mobile = width < MOBILE_BREAKPOINT;
  return {
    width,
    height,
    mobile,
    insets: mobile
      ? { top: 12, right: 8, bottom: 96, left: 8 }
      : { top: 64, right: 16, bottom: 16, left: width >= MOBILE_BREAKPOINT ? 96 : 16 },
  };
}

export function workArea(viewport: Viewport): Rect {
  const { insets } = viewport;
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(1, viewport.width - insets.left - insets.right),
    height: Math.max(1, viewport.height - insets.top - insets.bottom),
  };
}

const visible = (w: { presentation: WindowPresentation }) => w.presentation === "inline" || w.presentation === "expanded";

export function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function rectOf(layout: WindowLayout): Rect {
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

function round(rect: Rect): Rect {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
}

/* ------------------------------------------------------------------ *
 * UNDERSTANDING — relationships between windows
 * ------------------------------------------------------------------ */

export interface WindowRelationship {
  a: string;
  b: string;
  relation: "overlaps" | "left-of" | "right-of" | "above" | "below" | "diagonal";
  gap: number;
  overlapPercent?: number;
}

export function relationshipsOf(windows: Array<{ id: string; rect: Rect; presentation: WindowPresentation }>): WindowRelationship[] {
  const shown = windows.filter((w) => w.presentation === "inline");
  const out: WindowRelationship[] = [];
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const A = shown[i];
      const B = shown[j];
      const a = A.rect;
      const b = B.rect;
      const area = intersection(a, b);
      if (area > 0) {
        out.push({ a: A.id, b: B.id, relation: "overlaps", gap: 0, overlapPercent: Math.round((area / Math.min(a.width * a.height, b.width * b.height)) * 100) });
        continue;
      }
      const verticalOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0;
      const horizontalOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0;
      if (verticalOverlap) {
        const leftOf = a.x + a.width <= b.x;
        out.push({ a: A.id, b: B.id, relation: leftOf ? "left-of" : "right-of", gap: Math.round(leftOf ? b.x - (a.x + a.width) : a.x - (b.x + b.width)) });
      } else if (horizontalOverlap) {
        const above = a.y + a.height <= b.y;
        out.push({ a: A.id, b: B.id, relation: above ? "above" : "below", gap: Math.round(above ? b.y - (a.y + a.height) : a.y - (b.y + b.height)) });
      } else {
        out.push({ a: A.id, b: B.id, relation: "diagonal", gap: 0 });
      }
    }
  }
  return out;
}

export interface LayoutCheck {
  overlaps: Array<[string, string]>;
  offscreen: string[];
  coversComposer: string[];
}

/** Does this layout fit, without overlap, inside the usable viewport? */
export function checkLayout(layout: Record<string, WindowLayout>, viewport: Viewport, kinds: Record<string, WindowKind> = {}): LayoutCheck {
  const area = workArea(viewport);
  const entries = Object.entries(layout).filter(([, l]) => l.presentation === "inline");
  const overlaps: Array<[string, string]> = [];
  const offscreen: string[] = [];
  const coversComposer: string[] = [];
  // On phones the chat is the full-screen base layer by design; sheets sit
  // on top of it, so only module/module overlap counts there.
  const considered = viewport.mobile ? entries.filter(([id]) => kinds[id] !== "chat") : entries;
  for (let i = 0; i < considered.length; i++) {
    for (let j = i + 1; j < considered.length; j++) {
      if (intersection(rectOf(considered[i][1]), rectOf(considered[j][1])) > 0) overlaps.push([considered[i][0], considered[j][0]]);
    }
  }
  for (const [id, l] of considered) {
    if (l.x < 0 || l.y < 0 || l.x + l.width > viewport.width + 0.5 || l.y + l.height > viewport.height + 0.5) offscreen.push(id);
    if (viewport.mobile && l.y + l.height > area.y + area.height + 0.5) coversComposer.push(id);
  }
  return { overlaps, offscreen, coversComposer };
}

/* ------------------------------------------------------------------ *
 * SOLVING
 * ------------------------------------------------------------------ */

function toLayout(w: WindowDescriptor): WindowLayout {
  return {
    presentation: w.presentation,
    x: w.rect.x,
    y: w.rect.y,
    width: w.rect.width,
    height: w.rect.height,
    zIndex: w.zIndex,
    rotation: w.rotation,
    ...(w.group ? { group: w.group } : {}),
  };
}

function place(layout: WindowLayout, rect: Rect, rotation = 0): void {
  const r = round(rect);
  layout.x = r.x;
  layout.y = r.y;
  layout.width = r.width;
  layout.height = r.height;
  layout.rotation = rotation;
  layout.presentation = "inline";
}

function clampInto(layout: WindowLayout, viewport: Viewport): void {
  const area = workArea(viewport);
  layout.width = Math.max(Math.min(MIN_WIDTH, area.width), Math.min(layout.width, area.width));
  layout.height = Math.max(Math.min(MIN_HEIGHT, area.height), Math.min(layout.height, area.height));
  layout.x = Math.round(Math.max(area.x, Math.min(layout.x, area.x + area.width - layout.width)));
  layout.y = Math.round(Math.max(area.y, Math.min(layout.y, area.y + area.height - layout.height)));
}

function gridRects(area: Rect, n: number, cols: number): Rect[] {
  const rows = Math.ceil(n / cols);
  const w = (area.width - GAP * (cols - 1)) / cols;
  const h = (area.height - GAP * (rows - 1)) / rows;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const itemsInRow = row === rows - 1 ? n - row * cols : cols;
    // Last row stretches so there is never an empty hole.
    const rowW = (area.width - GAP * (itemsInRow - 1)) / itemsInRow;
    const col = i % cols;
    return { x: area.x + col * (rowW + GAP), y: area.y + row * (h + GAP), width: itemsInRow === cols ? w : rowW, height: h };
  });
}

function columnRects(area: Rect, weights: number[]): Rect[] {
  const total = weights.reduce((s, w) => s + w, 0);
  const usable = area.width - GAP * (weights.length - 1);
  let x = area.x;
  return weights.map((weight) => {
    const width = (usable * weight) / total;
    const rect = { x, y: area.y, width, height: area.height };
    x += width + GAP;
    return rect;
  });
}

function stackRects(column: Rect, n: number): Rect[] {
  const h = (column.height - GAP * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: column.x, y: column.y + i * (h + GAP), width: column.width, height: h }));
}

/** Weighting: tool windows get a little more room than the chat. */
const weightFor = (kind: WindowKind | undefined) => (kind === "chat" ? 1 : 1.25);

/**
 * Turn relational constraints ("browser beside chat, project above
 * browser") into grid coordinates, then into columns of stacked
 * windows sized to the viewport.
 */
function solveRelations(
  ids: string[],
  relations: RelationConstraint[],
  kinds: Record<string, WindowKind>,
  area: Rect,
  notes: string[],
  issues: string[],
): Record<string, Rect> | null {
  const cell = new Map<string, { col: number; row: number }>();
  const occupied = (col: number, row: number) => [...cell.values()].some((c) => c.col === col && c.row === row);
  const delta: Record<Relation, { col: number; row: number }> = {
    beside: { col: 1, row: 0 },
    "right-of": { col: 1, row: 0 },
    "left-of": { col: -1, row: 0 },
    above: { col: 0, row: -1 },
    below: { col: 0, row: 1 },
  };
  const put = (id: string, near: { col: number; row: number }, d: { col: number; row: number }) => {
    let col = near.col + d.col;
    let row = near.row + d.row;
    // Push further out in the same direction until the cell is free.
    while (occupied(col, row)) {
      col += d.col;
      row += d.row;
      if (d.col === 0 && d.row === 0) row += 1;
    }
    cell.set(id, { col, row });
  };

  const pending = [...relations];
  for (let pass = 0; pass < relations.length + 2 && pending.length; pass++) {
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      const subject = cell.get(r.id);
      const object = cell.get(r.of);
      if (subject && object) {
        pending.splice(i--, 1);
        continue;
      }
      if (!subject && !object && cell.size === 0) cell.set(r.of, { col: 0, row: 0 });
      const objectNow = cell.get(r.of);
      if (objectNow && !cell.get(r.id)) {
        put(r.id, objectNow, delta[r.relation]);
        pending.splice(i--, 1);
      } else if (!objectNow && cell.get(r.id)) {
        const d = delta[r.relation];
        put(r.of, cell.get(r.id)!, { col: -d.col, row: -d.row });
        pending.splice(i--, 1);
      }
    }
  }
  if (pending.length) {
    for (const r of pending) issues.push(`could not place ${r.id} ${r.relation} ${r.of}: neither window is connected to the rest of the layout`);
  }

  // Windows the user did not mention still have to fit: each becomes its
  // own column on the right.
  let maxCol = Math.max(0, ...[...cell.values()].map((c) => c.col));
  for (const id of ids) {
    if (!cell.has(id)) {
      cell.set(id, { col: ++maxCol, row: 0 });
      notes.push(`${id} was not mentioned, so it gets its own column on the right`);
    }
  }

  const cols = [...new Set([...cell.values()].map((c) => c.col))].sort((a, b) => a - b);
  const columns = cols.map((col) =>
    [...cell.entries()]
      .filter(([, c]) => c.col === col)
      .sort((a, b) => a[1].row - b[1].row)
      .map(([id]) => id),
  );
  const weights = columns.map((members) => Math.max(...members.map((id) => weightFor(kinds[id]))));
  const minNeeded = columns.length * MIN_WIDTH + GAP * (columns.length - 1);
  if (minNeeded > area.width) {
    issues.push(`${columns.length} columns need ${minNeeded}px but only ${Math.round(area.width)}px is free — stacking instead`);
    return null;
  }
  const rects: Record<string, Rect> = {};
  columnRects(area, weights).forEach((column, i) => {
    const members = columns[i];
    if (members.length * MIN_HEIGHT + GAP * (members.length - 1) > column.height) {
      issues.push(`column ${i + 1} cannot hold ${members.length} windows at minimum height`);
    }
    stackRects(column, members.length).forEach((rect, j) => {
      rects[members[j]] = rect;
    });
  });
  return rects;
}

function organicRects(area: Rect, ids: string[], kinds: Record<string, WindowKind>): { rects: Record<string, Rect>; rotations: Record<string, number> } | null {
  const n = ids.length;
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  let scale = 1;
  for (let attempt = 0; attempt < 14; attempt++) {
    const rects: Record<string, Rect> = {};
    const rotations: Record<string, number> = {};
    const baseW = Math.min(520, area.width * (n <= 2 ? 0.46 : 0.36)) * scale;
    const baseH = Math.min(420, area.height * (n <= 2 ? 0.7 : 0.44)) * scale;
    ids.forEach((id, i) => {
      const w = Math.max(MIN_WIDTH * Math.min(1, scale + 0.15), baseW * (kinds[id] === "chat" ? 0.92 : 1));
      const h = Math.max(MIN_HEIGHT * Math.min(1, scale + 0.15), baseH * (i % 2 ? 0.9 : 1.05));
      const angle = n === 1 ? 0 : -Math.PI / 2 + (i / n) * Math.PI * 2 + (n === 2 ? Math.PI / 2 : 0);
      const rx = n === 1 ? 0 : Math.max(0, area.width / 2 - w / 2);
      const ry = n === 1 ? 0 : Math.max(0, area.height / 2 - h / 2);
      rects[id] = {
        x: Math.max(area.x, Math.min(cx + Math.cos(angle) * rx - w / 2, area.x + area.width - w)),
        y: Math.max(area.y, Math.min(cy + Math.sin(angle) * ry - h / 2, area.y + area.height - h)),
        width: w,
        height: h,
      };
      rotations[id] = n === 1 ? 0 : (i % 2 ? 1.2 : -1.4);
    });
    const list = Object.values(rects);
    // Rotation enlarges the footprint slightly — keep a margin.
    const padded = list.map((r) => ({ x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 }));
    let clash = false;
    for (let i = 0; i < padded.length && !clash; i++) for (let j = i + 1; j < padded.length; j++) if (intersection(padded[i], padded[j]) > 0) clash = true;
    if (!clash) return { rects, rotations };
    scale *= 0.9;
  }
  return null;
}

export interface WindowPlan {
  layout: Record<string, WindowLayout>;
  notes: string[];
  issues: string[];
  check: LayoutCheck;
}

/**
 * Apply structured window operations to the current workspace and return
 * the resulting geometry. Never touches the live UI — the caller previews
 * this plan and applies it only after the user approves.
 */
export function planWindows(current: WindowDescriptor[], ops: WindowOp[], viewport: Viewport): WindowPlan {
  const layout: Record<string, WindowLayout> = Object.fromEntries(current.map((w) => [w.id, toLayout(w)]));
  const kinds: Record<string, WindowKind> = Object.fromEntries(current.map((w) => [w.id, w.kind]));
  const labels: Record<string, string> = Object.fromEntries(current.map((w) => [w.id, w.label]));
  const notes: string[] = [];
  const issues: string[] = [];
  const area = workArea(viewport);
  const topZ = () => Math.max(30, ...Object.values(layout).map((l) => l.zIndex)) + 1;

  const known = (id: string) => {
    if (layout[id]) return true;
    issues.push(`there is no window "${id}" (known: ${Object.keys(layout).join(", ")})`);
    return false;
  };
  const resolve = (id: string) => resolveWindowId(id, current) ?? id;

  for (const raw of ops) {
    const op = { ...raw } as WindowOp;
    if ("id" in op && typeof op.id === "string") (op as { id: string }).id = resolve(op.id);
    if ("ids" in op && Array.isArray(op.ids)) (op as { ids: string[] }).ids = op.ids.map(resolve);
    if (op.op === "arrange" && op.relations) op.relations = op.relations.map((r) => ({ ...r, id: resolve(r.id), of: resolve(r.of) }));
    if (op.op === "arrange" && op.primary) op.primary = resolve(op.primary);

    switch (op.op) {
      case "move": {
        if (!known(op.id)) break;
        const l = layout[op.id];
        l.x = op.x;
        l.y = op.y;
        if (!visible(l)) l.presentation = "inline";
        clampInto(l, viewport);
        if (l.x !== Math.round(op.x) || l.y !== Math.round(op.y)) notes.push(`${op.id} was kept on screen at (${l.x}, ${l.y})`);
        break;
      }
      case "resize": {
        if (!known(op.id)) break;
        const l = layout[op.id];
        l.width = op.width;
        l.height = op.height;
        if (!visible(l)) l.presentation = "inline";
        clampInto(l, viewport);
        break;
      }
      case "transform": {
        if (!known(op.id)) break;
        const rotation = Math.max(-12, Math.min(12, Number.isFinite(op.rotation) ? op.rotation : 0));
        if (rotation !== op.rotation) notes.push(`${op.id} rotation limited to ${rotation}° so it stays usable`);
        layout[op.id].rotation = rotation;
        break;
      }
      case "open":
      case "restore":
        if (!known(op.id)) break;
        layout[op.id].presentation = "inline";
        if (op.op === "open") layout[op.id].zIndex = topZ();
        clampInto(layout[op.id], viewport);
        break;
      case "minimize":
        if (!known(op.id)) break;
        layout[op.id].presentation = "minimized";
        break;
      case "maximize":
        if (!known(op.id)) break;
        layout[op.id].presentation = "expanded";
        layout[op.id].zIndex = topZ();
        break;
      case "close":
        if (!known(op.id)) break;
        if (kinds[op.id] === "chat") {
          issues.push("the chat cannot be closed — it is the conversation with LÉLU. Minimize it instead.");
          break;
        }
        layout[op.id].presentation = "closed";
        break;
      case "raise":
        if (!known(op.id)) break;
        layout[op.id].zIndex = topZ();
        break;
      case "group":
        for (const id of op.ids) if (known(id)) layout[id].group = op.group;
        break;
      case "ungroup":
        for (const id of op.ids) if (known(id)) delete layout[id].group;
        break;
      case "arrange": {
        const involved = new Set<string>();
        for (const id of op.ids ?? []) if (known(id)) involved.add(id);
        for (const r of op.relations ?? []) {
          if (known(r.id)) involved.add(r.id);
          if (known(r.of)) involved.add(r.of);
        }
        // Windows named in an arrangement are opened by it.
        for (const id of involved) if (!visible(layout[id])) layout[id].presentation = "inline";
        for (const [id, l] of Object.entries(layout)) {
          if (l.presentation === "expanded") {
            l.presentation = "inline";
            involved.add(id);
          }
        }
        for (const [id, l] of Object.entries(layout)) if (visible(l)) involved.add(id);
        // Grouped windows travel together: a group member pulls its group in.
        for (const id of [...involved]) {
          const g = layout[id]?.group;
          if (g) for (const [other, l] of Object.entries(layout)) if (l.group === g && l.presentation !== "closed") involved.add(other);
        }
        const ids = orderIds([...involved], op, kinds);
        arrange(op, ids, layout, kinds, labels, viewport, area, notes, issues);
        break;
      }
      default:
        issues.push(`unknown window operation ${JSON.stringify(raw)}`);
    }
  }

  if (viewport.mobile) enforceMobile(layout, kinds, viewport, notes);

  return { layout, notes, issues, check: checkLayout(layout, viewport, kinds) };
}

function orderIds(ids: string[], op: Extract<WindowOp, { op: "arrange" }>, kinds: Record<string, WindowKind>): string[] {
  const priority = (id: string) => (id === op.primary ? -2 : kinds[id] === "chat" ? -1 : (op.ids ?? []).indexOf(id) >= 0 ? (op.ids ?? []).indexOf(id) : 100);
  return [...ids].sort((a, b) => priority(a) - priority(b));
}

function arrange(
  op: Extract<WindowOp, { op: "arrange" }>,
  ids: string[],
  layout: Record<string, WindowLayout>,
  kinds: Record<string, WindowKind>,
  labels: Record<string, string>,
  viewport: Viewport,
  area: Rect,
  notes: string[],
  issues: string[],
): void {
  if (!ids.length) {
    notes.push("no visible windows to arrange");
    return;
  }
  if (viewport.mobile) {
    // Phones: handled by enforceMobile (one sheet + chat), primary first.
    const primary = ids.find((id) => kinds[id] !== "chat");
    for (const id of ids) if (kinds[id] !== "chat") layout[id].presentation = id === primary ? "inline" : "minimized";
    if (ids.filter((id) => kinds[id] !== "chat").length > 1) {
      notes.push(`on a phone one tool window shows at a time above the chat: ${primary} is open, the others are minimized chips`);
    }
    return;
  }

  let strategy = op.strategy;
  if (strategy === "relations" && !(op.relations ?? []).length) strategy = "fit";
  const apply = (rects: Record<string, Rect>, rotations: Record<string, number> = {}) => {
    for (const [id, rect] of Object.entries(rects)) place(layout[id], rect, rotations[id] ?? 0);
  };

  switch (strategy) {
    case "relations": {
      const rects = solveRelations(ids, op.relations ?? [], kinds, area, notes, issues);
      if (rects) apply(rects);
      else apply(Object.fromEntries(ids.map((id, i) => [id, stackRects(area, ids.length)[i]])));
      break;
    }
    case "grid": {
      const cols = ids.length <= 2 ? ids.length : ids.length <= 4 ? 2 : 3;
      const rects = gridRects(area, ids.length, cols);
      apply(Object.fromEntries(ids.map((id, i) => [id, rects[i]])));
      break;
    }
    case "columns": {
      const fit = Math.max(1, Math.floor((area.width + GAP) / (MIN_WIDTH + GAP)));
      if (ids.length > fit) {
        notes.push(`only ${fit} columns fit; using a grid instead`);
        const rects = gridRects(area, ids.length, fit);
        apply(Object.fromEntries(ids.map((id, i) => [id, rects[i]])));
      } else {
        const rects = columnRects(area, ids.map((id) => weightFor(kinds[id])));
        apply(Object.fromEntries(ids.map((id, i) => [id, rects[i]])));
      }
      break;
    }
    case "focus": {
      const [primary, ...rest] = ids;
      if (!rest.length) {
        apply({ [primary]: area });
        break;
      }
      const [main, side] = columnRects(area, [1.7, 1]);
      const stacked = stackRects(side, rest.length);
      apply({ [primary]: main, ...Object.fromEntries(rest.map((id, i) => [id, stacked[i]])) });
      notes.push(`${labels[primary] ?? primary} is the focus; ${rest.length} window(s) stacked beside it`);
      break;
    }
    case "cascade": {
      const w = Math.min(620, area.width - 34 * (ids.length - 1));
      const h = Math.min(480, area.height - 34 * (ids.length - 1));
      apply(Object.fromEntries(ids.map((id, i) => [id, { x: area.x + i * 34, y: area.y + i * 34, width: Math.max(MIN_WIDTH, w), height: Math.max(MIN_HEIGHT, h) }])));
      ids.forEach((id, i) => (layout[id].zIndex = 40 + i));
      break;
    }
    case "organic": {
      const result = organicRects(area, ids, kinds);
      if (result) {
        apply(result.rects, result.rotations);
        notes.push("windows float on a soft ellipse with slight, alternating tilts");
      } else {
        notes.push("an organic arrangement could not fit without overlap; using a grid");
        const rects = gridRects(area, ids.length, ids.length <= 2 ? ids.length : 2);
        apply(Object.fromEntries(ids.map((id, i) => [id, rects[i]])));
      }
      break;
    }
    case "fit":
    default: {
      for (const id of ids) clampInto(layout[id], viewport);
      const shown = Object.fromEntries(ids.map((id) => [id, layout[id]]));
      if (checkLayout(shown, viewport, kinds).overlaps.length) {
        notes.push("windows overlapped after fitting to the screen; arranged them in a grid");
        const rects = gridRects(area, ids.length, ids.length <= 2 ? ids.length : ids.length <= 4 ? 2 : 3);
        apply(Object.fromEntries(ids.map((id, i) => [id, rects[i]])));
      }
    }
  }
}

/** Phone rules: chat stays the full-screen base, at most one sheet above it. */
function enforceMobile(layout: Record<string, WindowLayout>, kinds: Record<string, WindowKind>, viewport: Viewport, notes: string[]): void {
  const area = workArea(viewport);
  for (const [id, l] of Object.entries(layout)) {
    if (kinds[id] === "chat") {
      l.x = 0;
      l.y = 0;
      l.width = viewport.width;
      l.height = viewport.height;
      l.rotation = 0;
      if (l.presentation === "closed") l.presentation = "inline";
    }
  }
  const sheets = Object.entries(layout)
    .filter(([id, l]) => kinds[id] !== "chat" && visible(l))
    .sort((a, b) => b[1].zIndex - a[1].zIndex);
  sheets.forEach(([id, l], i) => {
    if (i > 0) {
      l.presentation = "minimized";
      notes.push(`${id} minimized — only one tool window fits above the chat on a phone`);
      return;
    }
    // A maximized window on a phone is still a sheet, never a cover over the
    // composer: the composer must stay reachable.
    l.presentation = "inline";
    l.rotation = 0;
    l.x = area.x;
    l.width = area.width;
    l.y = area.y;
    l.height = Math.round(Math.min(Math.max(MIN_HEIGHT, l.height), area.height * 0.62));
  });
}

/**
 * Resolve a loose window name ("browser", "my project window", "the chat")
 * to a real window id.
 */
export function resolveWindowId(name: string, windows: Array<{ id: string; label: string }>): string | undefined {
  const n = name.toLowerCase().replace(/\b(my|the|window|panel|tab)\b/g, "").trim();
  if (!n) return undefined;
  const exact = windows.find((w) => w.id.toLowerCase() === n || w.label.toLowerCase() === n);
  if (exact) return exact.id;
  const aliases: Record<string, string[]> = {
    chat: ["conversation", "dialogue", "lelu", "messages"],
    projects: ["project", "project manager"],
    browser: ["web", "research", "internet"],
    render: ["renders", "gallery", "3d"],
    engineering: ["code", "editor", "terminal", "sandbox"],
    memory: ["memories"],
    sketch: ["drawing", "canvas"],
  };
  for (const [id, words] of Object.entries(aliases)) {
    if ((n === id || words.some((w) => n === w || n.includes(w))) && windows.some((w) => w.id === id)) return id;
  }
  return windows.find((w) => w.label.toLowerCase().includes(n) || n.includes(w.id.toLowerCase()))?.id;
}

export function describeWindows(windows: WindowDescriptor[]): string {
  const shown = windows.filter((w) => w.presentation !== "closed");
  if (!shown.length) return "No windows are open.";
  return shown
    .map((w) => `${w.id} "${w.label}" (${w.kind}, ${w.presentation}${w.group ? `, group ${w.group}` : ""}) at x=${Math.round(w.rect.x)} y=${Math.round(w.rect.y)} ${Math.round(w.rect.width)}×${Math.round(w.rect.height)}, z=${w.zIndex}${w.rotation ? `, rotated ${w.rotation}°` : ""}`)
    .join("\n");
}

export function describeRelationships(relationships: WindowRelationship[]): string {
  if (!relationships.length) return "No two visible windows to relate.";
  return relationships
    .map((r) => (r.relation === "overlaps" ? `${r.a} overlaps ${r.b} (${r.overlapPercent}% of the smaller)` : r.relation === "diagonal" ? `${r.a} and ${r.b} are diagonal` : `${r.a} is ${r.relation} ${r.b} (gap ${r.gap}px)`))
    .join("\n");
}
