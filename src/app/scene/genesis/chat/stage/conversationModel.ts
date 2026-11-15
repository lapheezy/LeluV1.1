/**
 * LÉLU — what a conversation contains, as structure.
 *
 * Every stage (cinematic, board, gallery, presentation, 3D) reads the SAME
 * stored messages through this one pure parser — no second copy of the
 * conversation, no model call to "understand" it. Markdown is read the way
 * the transcript renders it: `## headings` start sections, `![alt](src)` is
 * media, `[text](https://…)` and bare URLs are sources.
 */

export interface StageMedia {
  id: string;
  src: string;
  alt: string;
  turn: number;
  messageId: string;
}

export interface StageLink {
  id: string;
  href: string;
  label: string;
  turn: number;
}

export interface StageSection {
  id: string;
  heading: string;
  body: string;
  /** Markdown without images, for slides and cards. */
  text: string;
  media: StageMedia[];
  turn: number;
}

export interface StageTurn {
  index: number;
  question: string | null;
  questionId: string | null;
  answerId: string | null;
  answer: string;
  /** First sentence of the answer — a node or card title. */
  gist: string;
  sections: StageSection[];
  media: StageMedia[];
  links: StageLink[];
}

export interface StageConversation {
  title: string;
  turns: StageTurn[];
  media: StageMedia[];
  links: StageLink[];
  sections: StageSection[];
}

interface MessageLike {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LINK = /(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE = /(?<![([])\bhttps?:\/\/[^\s)>\]]+/g;

export function stripMarkdown(text: string): string {
  return text
    .replace(IMAGE, "")
    .replace(LINK, "$1")
    .replace(/[*_`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function gistOf(text: string, max = 90): string {
  const plain = stripMarkdown(text.replace(/^#+ .*$/m, ""));
  const first = plain.split(/(?<=[.!?])\s/)[0] ?? plain;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

function mediaIn(text: string, turn: number, messageId: string, prefix: string): StageMedia[] {
  return [...text.matchAll(IMAGE)].map((m, i) => ({ id: `${prefix}-img-${i}`, alt: m[1] || "Image", src: m[2], turn, messageId }));
}

function linksIn(text: string, turn: number, prefix: string): StageLink[] {
  const out: StageLink[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(LINK)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ id: `${prefix}-ln-${out.length}`, href: m[2], label: m[1], turn });
  }
  for (const m of text.matchAll(BARE)) {
    const href = m[0].replace(/[.,;:]+$/, "");
    if (seen.has(href)) continue;
    seen.add(href);
    let label = href;
    try {
      label = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      /* keep the raw text */
    }
    out.push({ id: `${prefix}-ln-${out.length}`, href, label, turn });
  }
  return out;
}

function sectionsOf(text: string, turn: number, messageId: string): StageSection[] {
  const lines = text.split("\n");
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } = { heading: "", lines: [] };
  for (const line of lines) {
    const h = /^#{1,3}\s+(.+)$/.exec(line.trim());
    if (h) {
      if (current.heading || current.lines.join("").trim()) sections.push(current);
      current = { heading: h[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading || current.lines.join("").trim()) sections.push(current);
  return sections.map((s, i) => {
    const body = s.lines.join("\n").trim();
    return {
      id: `t${turn}-s${i}`,
      heading: s.heading || (i === 0 ? gistOf(body, 60) : `Part ${i + 1}`),
      body,
      text: body.replace(IMAGE, "").trim(),
      media: mediaIn(body, turn, messageId, `t${turn}-s${i}`),
      turn,
    };
  });
}

export function buildStage(title: string, messages: MessageLike[]): StageConversation {
  const turns: StageTurn[] = [];
  let pending: MessageLike | null = null;
  const push = (q: MessageLike | null, a: MessageLike | null) => {
    const index = turns.length;
    const answer = a?.text ?? "";
    const sections = a ? sectionsOf(answer, index, a.id) : [];
    const media = [...(q ? mediaIn(q.text, index, q.id, `t${index}-q`) : []), ...sections.flatMap((s) => s.media)];
    turns.push({
      index,
      question: q?.text ?? null,
      questionId: q?.id ?? null,
      answerId: a?.id ?? null,
      answer,
      gist: a ? gistOf(answer) : "",
      sections,
      media,
      links: linksIn(`${q?.text ?? ""}\n${answer}`, index, `t${index}`),
    });
  };
  for (const m of messages) {
    if (m.role === "user") {
      if (pending) push(pending, null);
      pending = m;
    } else {
      push(pending, m);
      pending = null;
    }
  }
  if (pending) push(pending, null);
  return {
    title,
    turns,
    media: turns.flatMap((t) => t.media),
    links: turns.flatMap((t) => t.links),
    sections: turns.flatMap((t) => t.sections),
  };
}

/** Slides for the presentation stage: a title, then one per question and section. */
export interface Slide {
  id: string;
  kind: "title" | "question" | "section";
  heading: string;
  text: string;
  media: StageMedia | null;
}

export function slidesOf(stage: StageConversation): Slide[] {
  const slides: Slide[] = [{ id: "title", kind: "title", heading: stage.title, text: `${stage.turns.length} exchange${stage.turns.length === 1 ? "" : "s"} · ${stage.media.length} image${stage.media.length === 1 ? "" : "s"}`, media: stage.media[0] ?? null }];
  for (const t of stage.turns) {
    if (t.question) slides.push({ id: `q${t.index}`, kind: "question", heading: stripMarkdown(t.question), text: "", media: null });
    for (const s of t.sections) slides.push({ id: s.id, kind: "section", heading: s.heading, text: s.text, media: s.media[0] ?? null });
  }
  return slides;
}
