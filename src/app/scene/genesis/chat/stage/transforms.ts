/**
 * LÉLU — conversation → real artifacts (deterministic).
 *
 * The environments turn what a conversation already contains into the
 * Studio's own editable specs: a DocumentSpec with real blocks, a DeckSpec,
 * Mermaid source, chart programs from its tables, a film storyboard, code
 * blocks, a GraphSpec from the board. Pure: same conversation → same specs.
 * The Studio then versions, compares, exports (DOCX/PDF/PPTX/XLSX/SVG/PNG/
 * GLB/WebM …) exactly as it does for work a model produced.
 */

import type { Block, DeckSpec, DocumentSpec, GraphSpec, Source, SlideSpec, WorkbookSpec } from "../../../../../core/studio/StudioTypes";
import { gistOf, slidesOf, stripMarkdown, type StageConversation } from "./conversationModel";

export interface MdTable {
  caption: string;
  columns: string[];
  rows: string[][];
}

/** Markdown → document blocks (headings, paragraphs, lists, tables, quotes). */
export function markdownBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/!\[[^\]]*\]\([^)]*\)/g, "").split("\n");
  let i = 0;
  const inline = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: "heading", level: Math.min(3, h[1].length) as 1 | 2 | 3, text: inline(h[2]) }); i++; continue; }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ type: "quote", text: code.join("\n") });
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => inline(c));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) blocks.push({ type: "table", columns: rows[0], rows: rows.slice(1) });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) q.push(lines[i++].trim().replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: inline(q.join(" ")) });
      continue;
    }
    const bullet = /^([-*+]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i].trim())) items.push(inline(lines[i++].trim().replace(bullet, "")));
      blocks.push({ type: "bullets", items, ordered });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\||>|[-*+]\s|\d+[.)]\s)/.test(lines[i].trim())) para.push(lines[i++].trim());
    if (para.length) blocks.push({ type: "paragraph", text: inline(para.join(" ")) });
    else i++;
  }
  return blocks;
}

export function sourcesOf(model: StageConversation): Source[] {
  return model.links.map((l, i) => ({ id: `S${i + 1}`, title: l.label, url: l.href, accessed: new Date().toISOString().slice(0, 10) }));
}

export function toDocument(model: StageConversation, images: Record<string, string> = {}): DocumentSpec {
  const blocks: Block[] = [];
  for (const t of model.turns) {
    if (t.question) blocks.push({ type: "heading", level: 2, text: stripMarkdown(t.question).slice(0, 160) });
    for (const s of t.sections) {
      if (s.heading && t.sections.length > 1) blocks.push({ type: "heading", level: 3, text: s.heading });
      blocks.push(...markdownBlocks(s.body));
      for (const m of s.media) if (images[m.src]) blocks.push({ type: "image", dataUrl: images[m.src], caption: m.alt });
    }
  }
  return {
    kind: "document",
    title: model.title || "Conversation",
    subtitle: `${model.turns.length} exchange${model.turns.length === 1 ? "" : "s"} with LÉLU`,
    author: "LÉLU",
    blocks: blocks.length ? blocks : [{ type: "paragraph", text: "This conversation has no content yet." }],
    sources: sourcesOf(model),
  };
}

export function tablesOf(model: StageConversation): MdTable[] {
  const out: MdTable[] = [];
  for (const t of model.turns) {
    for (const s of t.sections) {
      for (const b of markdownBlocks(s.body)) {
        if (b.type === "table") out.push({ caption: s.heading || model.title, columns: b.columns, rows: b.rows.map((r) => r.map(String)) });
      }
    }
  }
  return out;
}

const num = (v: string) => {
  const m = /-?\d[\d,]*(\.\d+)?/.exec(v.replace(/\s/g, ""));
  return m ? Number(m[0].replace(/,/g, "")) : NaN;
};

/** A chart program from a table, when it has a label column and at least one numeric column. */
export function tableToChart(table: MdTable): { title: string; kind: string; labels: string[]; series: Array<{ name: string; values: number[] }> } | null {
  if (table.rows.length < 2 || table.columns.length < 2) return null;
  const numeric = table.columns
    .map((c, ci) => ({ c, ci, values: table.rows.map((r) => num(r[ci] ?? "")) }))
    .filter((col) => col.ci > 0 && col.values.filter((v) => !Number.isNaN(v)).length >= Math.ceil(table.rows.length * 0.7));
  if (!numeric.length) return null;
  return {
    title: table.caption,
    kind: table.rows.length > 8 ? "line" : "column",
    labels: table.rows.map((r) => r[0]),
    series: numeric.map((col) => ({ name: col.c, values: col.values.map((v) => (Number.isNaN(v) ? 0 : v)) })),
  };
}

export function tableToWorkbook(title: string, tables: MdTable[]): WorkbookSpec {
  return {
    kind: "workbook",
    title,
    author: "LÉLU",
    sheets: tables.slice(0, 8).map((t, i) => ({ name: (t.caption || `Table ${i + 1}`).slice(0, 28), columns: t.columns, rows: t.rows.map((r) => r.map((c) => (Number.isNaN(num(c)) || /[a-z]/i.test(c) ? c : num(c)))) })),
  };
}

export function toDeck(model: StageConversation): DeckSpec {
  const slides: SlideSpec[] = slidesOf(model).map((s) => {
    if (s.kind === "title") return { title: s.heading, subtitle: s.text, layout: "title" };
    if (s.kind === "question") return { title: s.heading.slice(0, 120), layout: "section" };
    const blocks = markdownBlocks(s.text);
    const table = blocks.find((b): b is Extract<Block, { type: "table" }> => b.type === "table");
    if (table) return { title: s.heading, layout: "table", table: { columns: table.columns, rows: table.rows } };
    const bullets = blocks.flatMap((b) => (b.type === "bullets" ? b.items : b.type === "paragraph" ? [b.text] : [])).map((t) => (t.length > 140 ? `${t.slice(0, 139)}…` : t)).slice(0, 6);
    return { title: s.heading, layout: "content", bullets };
  });
  return { kind: "deck", title: model.title || "Conversation", author: "LÉLU", slides, sources: sourcesOf(model) };
}

const mmd = (t: string) => t.replace(/["\[\](){}<>|#;]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48) || "…";

/** A flowchart of the conversation: title → questions → sections, in order. */
export function toMermaid(model: StageConversation): string {
  const lines = ["flowchart TB", `  T(["${mmd(model.title || "Conversation")}"])`];
  let prev = "T";
  for (const t of model.turns) {
    const q = `Q${t.index}`;
    lines.push(`  ${q}{{"${mmd(t.question ?? "Untitled")}"}}`);
    lines.push(`  ${prev} --> ${q}`);
    t.sections.forEach((s, i) => {
      const id = `S${t.index}_${i}`;
      lines.push(`  ${id}["${mmd(s.heading || gistOf(s.text, 40))}"]`);
      lines.push(`  ${q} --> ${id}`);
    });
    prev = q;
  }
  return lines.join("\n");
}

export function toGraph(title: string, nodes: Array<{ id: string; position: { x: number; y: number }; data: { title: string; kind: string } }>, edges: Array<{ id: string; source: string; target: string; label?: unknown }>): GraphSpec {
  return {
    kind: "graph",
    title,
    author: "LÉLU",
    nodes: nodes.map((n) => ({ id: n.id, label: n.data.title.slice(0, 120), type: n.data.kind, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...(typeof e.label === "string" ? { label: e.label } : {}) })),
  };
}

export interface CodeBlock {
  id: string;
  lang: string;
  code: string;
  turn: number;
}

export function codeBlocksOf(messages: Array<{ id: string; role: string; text: string }>): CodeBlock[] {
  const out: CodeBlock[] = [];
  messages.forEach((m, turn) => {
    const re = /```([\w+-]*)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let k = 0;
    while ((match = re.exec(m.text))) out.push({ id: `${m.id}-${k++}`, lang: (match[1] || "text").toLowerCase(), code: match[2].replace(/\n$/, ""), turn });
  });
  return out;
}

/** Can this block run as a prototype in a sandboxed frame? */
export function runnable(block: CodeBlock): boolean {
  return ["html", "htm", "svg", "js", "javascript"].includes(block.lang);
}

export function prototypeDoc(block: CodeBlock): string {
  if (block.lang === "js" || block.lang === "javascript") {
    return `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;background:#0b0820;color:#ece6ff"><pre id="out"></pre><script>const out=document.getElementById("out");const log=(...a)=>{out.textContent+=a.map(x=>typeof x==="object"?JSON.stringify(x):String(x)).join(" ")+"\\n"};console.log=log;console.error=log;try{${block.code.replace(/<\/script/gi, "<\\/script")}}catch(e){log("Error:",e.message)}</script>`;
  }
  return block.code;
}

/** A storyboard: a title card, then one scene per section. */
export function toFilmScenes(model: StageConversation): Array<Record<string, unknown>> {
  const styles = ["flowfield", "constellation", "ridgelines", "circlepack"];
  const motions = ["zoom-in", "pan-left", "drift", "zoom-out", "pan-right"];
  const scenes: Array<Record<string, unknown>> = [
    { duration: 3, title: model.title || "A conversation with LÉLU", subtitle: `${model.turns.length} scene${model.turns.length === 1 ? "" : "s"}`, visual: { type: "generative", style: "constellation", palette: "aurora", seed: 7 }, motion: "zoom-in" },
  ];
  model.sections.slice(0, 7).forEach((s, i) => {
    scenes.push({ duration: 3, title: s.heading.slice(0, 60), subtitle: gistOf(s.text, 80), visual: { type: "generative", style: styles[i % styles.length], seed: 11 + i }, motion: motions[i % motions.length] });
  });
  return scenes;
}
