/**
 * LÉLU — Chat Universe environments that make and find real work.
 *
 *   Research   real retrieval (Wikipedia / Crossref / arXiv / OpenAlex /
 *              public data / your own conversations), sources with
 *              provenance, browser + board hand-offs
 *   Document   long-form reading + a real, versioned, exportable document
 *   Diagram    Mermaid source ⇄ live render, versions, SVG/PNG/MMD
 *   Data       tables → interactive charts and workbooks; live public data
 *   Code       the conversation's code: edit, run in a sandbox, download
 *   Film       storyboard → WebM rendered on this device → play → export
 *   Voice      read the conversation aloud; talk to LÉLU
 *   Workbench  chat + browser + works arranged by the Workspace Steward
 *   Scenes     3D works: build, change components, GLB/glTF/STL/OBJ, reopen
 *   Visuals    generative compositions: make, restyle, compare versions
 *
 * Every action goes through the Studio store or the real send path (whose
 * slash commands run tools with no model). Nothing here fabricates content.
 * Lazy: none of this is downloaded until an environment is opened.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import StudioStore, { type StudioArtifact } from "../../../../../core/studio/StudioStore";
import type { DocumentSpec, DeckSpec, WorkbookSpec, GraphSpec, VisualSpec, DrawingSpec, Block } from "../../../../../core/studio/StudioTypes";
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import WorkspaceStewardStore from "../../../../../core/interface/WorkspaceStewardStore";
import { ENVIRONMENTS, environmentOf } from "../../../../../core/interface/Environments";
import type { StageMode } from "../../../../../core/interface/WorkspaceSteward";
import { useGenesis, chatWindowId } from "../../GenesisCore";
import { arrangeWorkspace } from "../../layout/stewardActions";
import { addSourceToBoard } from "./boardSources";
import type { StageConversation } from "./conversationModel";
import { codeBlocksOf, prototypeDoc, runnable, tableToChart, tableToWorkbook, tablesOf, toDeck, toDocument, toFilmScenes, toMermaid, type CodeBlock } from "./transforms";
import { createWork, exportWork, imagesAsDataUrls, mediumOf, reviseWork, say, specOf, useWorks } from "./works";

const VisualViewer = lazy(() => import("../../studio/VisualViewer"));
const Model3DView = lazy(() => import("../Model3DView"));

interface EnvProps {
  conversationId: string;
  model: StageConversation;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string; activity?: { sources?: Array<{ title?: string; url?: string; domain?: string }> } }>;
  setStage: (s: StageMode) => void;
}

/* ------------------------------------------------------------------ shared */

function Header({ stage, children }: { stage: StageMode; children?: ReactNode }) {
  const env = environmentOf(stage);
  return (
    <div className="lev-head" data-lelu-env={stage}>
      <div>
        <span className="lev-eyebrow">{env.glyph} {env.label} · runs {env.runs.map((r) => ({ local: "on this device", "public-data": "with keyless public data", provider: "with a model provider", server: "on LÉLU's server" })[r]).join(" + ")}</span>
        <p>{env.purpose}</p>
      </div>
      <div className="lev-actions">{children}</div>
    </div>
  );
}

function Btn({ children, onClick, disabled, tone, label }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: "primary"; label?: string }) {
  return <button type="button" className="lev-btn" data-tone={tone} onClick={onClick} disabled={disabled} aria-label={label}>{children}</button>;
}

function Notice({ text }: { text: string | null }) {
  return text ? <p className="lev-notice" role="status">{text}</p> : null;
}

function WorkTabs({ works, selected, onSelect, empty }: { works: StudioArtifact[]; selected: string | null; onSelect: (id: string) => void; empty: string }) {
  if (!works.length) return <p className="lev-empty">{empty}</p>;
  return (
    <div className="lev-works" role="tablist" aria-label="Works">
      {works.map((w) => (
        <button key={w.id} type="button" role="tab" aria-selected={w.id === selected} data-on={w.id === selected} onClick={() => onSelect(w.id)}>
          <strong>{w.title}</strong>
          <span>{w.kind === "visual" ? mediumOf(w) : w.kind} · rev {w.revisions[w.revisions.length - 1].rev}</span>
        </button>
      ))}
    </div>
  );
}

function useSelected(works: StudioArtifact[]): [StudioArtifact | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  const current = works.find((w) => w.id === id) ?? works[0] ?? null;
  return [current, setId];
}

function Versions({ conversationId, artifact }: { conversationId: string; artifact: StudioArtifact }) {
  const [diff, setDiff] = useState<string[] | null>(null);
  const revs = artifact.revisions;
  if (revs.length < 2) return null;
  const a = revs[revs.length - 2].rev;
  const b = revs[revs.length - 1].rev;
  return (
    <div className="lev-versions">
      <span>{revs.length} versions</span>
      <Btn onClick={() => { const r = StudioStore.getInstance().compare(artifact.id, a, b); setDiff(r.ok ? r.changes : [r.reason]); }}>Compare rev {a} ↔ {b}</Btn>
      <Btn onClick={() => { StudioStore.getInstance().restore(artifact.id, a, "user"); setDiff([`Restored revision ${a} as a new revision.`]); void conversationId; }}>Restore rev {a}</Btn>
      {diff ? <ul className="lev-diff">{diff.slice(0, 8).map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
    </div>
  );
}

function ExportRow({ conversationId, artifact, formats }: { conversationId: string; artifact: StudioArtifact; formats: string[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="lev-export">
      {formats.map((f) => (
        <Btn key={f} disabled={busy !== null} onClick={async () => {
          setBusy(f);
          const r = await exportWork(conversationId, artifact, f);
          setBusy(null);
          setNote(r.ok ? `✓ ${r.filename} · ${Math.round((r.size ?? 0) / 102.4) / 10} KB · verified` : `✗ ${f.toUpperCase()}: ${r.reason}`);
        }}>{busy === f ? "…" : `⇣ ${f.toUpperCase()}`}</Btn>
      ))}
      <Notice text={note} />
    </div>
  );
}

function VisualOf({ artifact }: { artifact: StudioArtifact }) {
  const spec = specOf(artifact) as VisualSpec | DrawingSpec;
  const rev = artifact.revisions[artifact.revisions.length - 1].rev;
  return (
    <Suspense fallback={<p className="lev-empty">Rendering…</p>}>
      <div className="lev-visual" key={`${artifact.id}@${rev}`}><VisualViewer artifact={artifact} rev={rev} spec={spec} /></div>
    </Suspense>
  );
}

/* ------------------------------------------------------------------ research */

function ResearchEnv({ conversationId, model, messages, setStage }: EnvProps) {
  const genesis = useGenesis();
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.text ?? model.title;
  const [q, setQ] = useState(() => lastQuestion.replace(/^\/\w+\s*/, "").slice(0, 120));
  const [history, setHistory] = useState<ReturnType<MultiChatStore["search"]> | null>(null);
  const works = useWorks(conversationId).filter((w) => w.kind === "document" || w.kind === "graph");
  const [selected, select] = useSelected(works);
  const sources = useMemo(() => {
    const seen = new Map<string, { title: string; url: string; host: string; where: string }>();
    const add = (url: string | undefined, title: string | undefined, where: string) => {
      if (!url || !/^https?:/.test(url) || seen.has(url)) return;
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* raw */ }
      seen.set(url, { title: title || host, url, host, where });
    };
    messages.forEach((m, i) => (m.activity?.sources ?? []).forEach((s) => add(s.url, s.title, `retrieved in message ${i + 1}`)));
    model.links.forEach((l) => add(l.href, l.label, `cited in scene ${l.turn + 1}`));
    for (const w of works) {
      const spec = specOf(w) as DocumentSpec;
      (spec.sources ?? []).forEach((s) => add(s.url, s.title, `source of “${w.title}”`));
    }
    return [...seen.values()];
  }, [messages, model.links, works]);

  const openInBrowser = (url: string) => {
    window.dispatchEvent(new CustomEvent("genesis-browser-goto", { detail: { url } }));
    arrangeWorkspace({ modules: () => genesis.state.modules, openModule: genesis.openModule, setModulePresentation: genesis.setModulePresentation, raiseModule: genesis.raiseModule, activeConversationId: () => conversationId }, "split", ["browser", chatWindowId(conversationId)], "user");
  };

  return (
    <div className="lev" data-lelu-env-view="research">
      <Header stage="research">
        <Btn onClick={() => setStage("board")}>⌘ Board</Btn>
        <Btn onClick={() => setStage("document")}>▤ Document</Btn>
        <Btn onClick={() => setStage("diagram")}>⟜ Diagram</Btn>
      </Header>
      <form className="lev-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) say(conversationId, `/research ${q.trim()}`); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What should LÉLU research?" aria-label="Research topic" />
        <Btn tone="primary" onClick={() => q.trim() && say(conversationId, `/research ${q.trim()}`)} label="Research sources">Research sources</Btn>
        <Btn onClick={() => q.trim() && say(conversationId, `/data openalex.works query=${q.trim().replace(/\s+/g, "+")}`)}>Papers (OpenAlex)</Btn>
        <Btn onClick={() => q.trim() && say(conversationId, `/data wikipedia.search query=${q.trim().replace(/\s+/g, "+")}`)}>Wikipedia</Btn>
        <Btn onClick={() => setHistory(MultiChatStore.getInstance().search(q.trim(), "all").slice(0, 12))}>My conversations</Btn>
      </form>
      <p className="lev-hint">Research runs in this conversation — you see each step, every source it read and the cited brief it writes. Sources: Wikipedia, Crossref, arXiv, OpenAlex (keyless public APIs).</p>
      {history ? (
        <section className="lev-panel" aria-label="From your conversations">
          <h4>From your conversations · {history.length} match{history.length === 1 ? "" : "es"}</h4>
          {history.length === 0 ? <p className="lev-empty">Nothing in your conversations mentions “{q}”.</p> : null}
          {history.map((h) => (
            <button key={h.messageId} type="button" className="lev-hit" onClick={() => genesis.switchConversation(h.conversationId)}>
              <strong>{h.title}</strong><span>{h.text.slice(0, 180)}</span>
            </button>
          ))}
        </section>
      ) : null}
      <div className="lev-split">
        <section className="lev-panel" aria-label="Sources">
          <h4>Sources · {sources.length}</h4>
          {sources.length === 0 ? <p className="lev-empty">No sources yet. Run a search: every page and paper it reads is listed here with where it came from.</p> : null}
          {sources.map((s) => (
            <div key={s.url} className="lev-source">
              <div><strong>{s.title}</strong><span>{s.host} · {s.where}</span></div>
              <Btn onClick={() => openInBrowser(s.url)}>Open</Btn>
              <Btn onClick={() => addSourceToBoard(conversationId, { title: s.title, href: s.url })}>+ Board</Btn>
            </div>
          ))}
        </section>
        <section className="lev-panel" aria-label="Findings">
          <h4>Findings · {works.length}</h4>
          <WorkTabs works={works} selected={selected?.id ?? null} onSelect={select} empty="The research brief LÉLU writes appears here as a real document." />
          {selected?.kind === "document" ? <DocBody spec={specOf(selected) as DocumentSpec} compact /> : null}
          {selected ? <ExportRow conversationId={conversationId} artifact={selected} formats={selected.kind === "document" ? ["docx", "pdf", "md"] : []} /> : null}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ document */

function DocBody({ spec, compact, editable, onEdit }: { spec: DocumentSpec; compact?: boolean; editable?: boolean; onEdit?: (i: number, text: string) => void }) {
  const blocks = compact ? spec.blocks.slice(0, 14) : spec.blocks;
  const render = (b: Block, i: number) => {
    const edit = editable && (b.type === "paragraph" || b.type === "heading")
      ? { contentEditable: true, suppressContentEditableWarning: true, onBlur: (e: React.FocusEvent<HTMLElement>) => onEdit?.(i, e.currentTarget.textContent ?? "") }
      : {};
    switch (b.type) {
      case "heading": return b.level === 2 ? <h2 key={i} {...edit}>{b.text}</h2> : b.level === 1 ? <h1 key={i} {...edit}>{b.text}</h1> : <h3 key={i} {...edit}>{b.text}</h3>;
      case "paragraph": return <p key={i} {...edit}>{b.text}</p>;
      case "bullets": return b.ordered ? <ol key={i}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ol> : <ul key={i}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>;
      case "table": return <div key={i} className="lev-table"><table><thead><tr>{b.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{b.rows.slice(0, 40).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{String(c)}</td>)}</tr>)}</tbody></table></div>;
      case "quote": return <blockquote key={i}>{b.text}</blockquote>;
      case "image": return <figure key={i}><img src={b.dataUrl} alt={b.caption ?? ""} /><figcaption>{b.caption}</figcaption></figure>;
      default: return null;
    }
  };
  return (
    <article className="lev-doc" data-compact={compact}>
      {!compact ? <><h1>{spec.title}</h1>{spec.subtitle ? <p className="lev-sub">{spec.subtitle}</p> : null}</> : null}
      {blocks.map(render)}
      {spec.sources?.length && !compact ? <section className="lev-sources"><h4>Sources</h4><ol>{spec.sources.map((s) => <li key={s.id}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}{s.accessed ? ` · accessed ${s.accessed}` : ""}</li>)}</ol></section> : null}
    </article>
  );
}

function DocumentEnv({ conversationId, model }: EnvProps) {
  const works = useWorks(conversationId).filter((w) => w.kind === "document");
  const [selected, select] = useSelected(works);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const draft = useRef<DocumentSpec | null>(null);
  const make = async () => {
    const images = await imagesAsDataUrls(model.media.map((m) => m.src));
    const r = createWork(conversationId, toDocument(model, images), "Wrote a document from this conversation");
    if (r.ok) select(r.artifact.id);
    setNote(r.ok ? null : r.reason);
  };
  const spec = selected ? (specOf(selected) as DocumentSpec) : null;
  return (
    <div className="lev" data-lelu-env-view="document">
      <Header stage="document">
        <Btn tone="primary" onClick={() => void make()}>{works.length ? "New version from chat" : "Create document"}</Btn>
        {selected ? <Btn onClick={() => {
          if (editing && draft.current) reviseWork(conversationId, selected, draft.current, "Edited the document");
          draft.current = spec ? JSON.parse(JSON.stringify(spec)) : null;
          setEditing(!editing);
        }}>{editing ? "Save edits" : "Edit"}</Btn> : null}
        {selected && spec ? <Btn onClick={() => {
          const simple = { ...spec, blocks: spec.blocks.filter((b) => b.type !== "table" && b.type !== "quote").map((b) => (b.type === "paragraph" ? { ...b, text: b.text.split(/(?<=[.!?])\s/)[0] } : b)) };
          reviseWork(conversationId, selected, simple, "Simplified the document to its first sentences");
        }}>Simplify</Btn> : null}
        {selected && spec ? <Btn onClick={() => { const r = createWork(conversationId, { ...toDeck(model), title: `${spec.title} — slides` }, "Turned the document's conversation into a slide deck"); setNote(r.ok ? "Deck created — see Present." : r.reason); }}>→ Slides</Btn> : null}
      </Header>
      <Notice text={note} />
      <WorkTabs works={works} selected={selected?.id ?? null} onSelect={select} empty="No document yet. “Create document” writes this conversation as a real document: headings, lists, tables, its images and its sources." />
      {selected && spec ? (
        <>
          <ExportRow conversationId={conversationId} artifact={selected} formats={["docx", "pdf", "md", "html"]} />
          <Versions conversationId={conversationId} artifact={selected} />
          <DocBody spec={spec} editable={editing} onEdit={(i, text) => { if (draft.current) { const b = draft.current.blocks[i]; if (b && (b.type === "paragraph" || b.type === "heading")) b.text = text; } }} />
        </>
      ) : (
        <nav className="lev-toc" aria-label="Contents">
          <h4>This conversation · {model.sections.length} sections</h4>
          <ol>{model.turns.map((t) => <li key={t.index}>{t.question?.slice(0, 90) ?? "—"}<ol>{t.sections.map((s) => <li key={s.id}>{s.heading}</li>)}</ol></li>)}</ol>
        </nav>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ diagram */

function DiagramEnv({ conversationId, model }: EnvProps) {
  const works = useWorks(conversationId).filter((w) => w.kind === "visual" && mediumOf(w) === "diagram");
  const [selected, select] = useSelected(works);
  const current = selected ? String(((specOf(selected) as VisualSpec).program as { source?: string }).source ?? "") : "";
  const [source, setSource] = useState(current || toMermaid(model));
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (current) setSource(current); }, [current]);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const { normalizeDiagram, renderDiagramSvg } = await import("../../../../../core/creative/kit/Diagram");
      const p = normalizeDiagram({ source });
      if (typeof p === "string") { if (!cancelled) { setError(p); setSvg(null); } return; }
      const r = await renderDiagramSvg(p);
      if (cancelled) return;
      if (r.ok) { setSvg(r.svg); setError(null); } else { setError(r.reason); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [source]);
  const save = () => {
    const program = { source };
    if (selected) reviseWork(conversationId, selected, { ...(specOf(selected) as VisualSpec), program }, "Edited the diagram");
    else { const r = createWork(conversationId, { kind: "visual", medium: "diagram", title: `${model.title || "Conversation"} — map`, program }, "Drew a diagram of this conversation"); if (r.ok) select(r.artifact.id); }
  };
  return (
    <div className="lev" data-lelu-env-view="diagram">
      <Header stage="diagram">
        <Btn onClick={() => setSource(toMermaid(model))}>From conversation</Btn>
        <Btn onClick={() => setSource("flowchart LR\n  A[Question] --> B{Research}\n  B --> C[Sources]\n  B --> D[Findings]\n  D --> E([Document])")}>Blank flowchart</Btn>
        <Btn tone="primary" onClick={save} disabled={Boolean(error)}>{selected ? "Save new version" : "Save diagram"}</Btn>
      </Header>
      <WorkTabs works={works} selected={selected?.id ?? null} onSelect={select} empty="No saved diagram yet — the editor starts from this conversation's structure." />
      <div className="lev-split">
        <section className="lev-panel"><h4>Mermaid source</h4><textarea className="lev-code" value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} aria-label="Diagram source" /></section>
        <section className="lev-panel"><h4>Live render</h4>{error ? <p className="lev-error">✗ {error}</p> : null}{svg ? <div className="lev-svg" data-lelu-diagram-svg dangerouslySetInnerHTML={{ __html: svg }} /> : !error ? <p className="lev-empty">Rendering…</p> : null}</section>
      </div>
      {selected ? <><ExportRow conversationId={conversationId} artifact={selected} formats={["svg", "png", "mmd"]} /><Versions conversationId={conversationId} artifact={selected} /></> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ data */

const LIVE = [
  { label: "Earthquakes (USGS, past week)", cmd: "/chart earthquakes" },
  { label: "Hacker News top stories", cmd: "/data hackernews.top" },
  { label: "Weather forecast (Open-Meteo, Paris)", cmd: "/data openmeteo.forecast latitude=48.85 longitude=2.35" },
];

function DataEnv({ conversationId, model }: EnvProps) {
  const tables = useMemo(() => tablesOf(model), [model]);
  const works = useWorks(conversationId).filter((w) => (w.kind === "visual" && mediumOf(w) === "chart") || w.kind === "workbook");
  const [selected, select] = useSelected(works);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="lev" data-lelu-env-view="data">
      <Header stage="data">
        {tables.length ? <Btn onClick={() => { const r = createWork(conversationId, tableToWorkbook(`${model.title || "Conversation"} — data`, tables), "Collected this conversation's tables into a workbook"); if (r.ok) select(r.artifact.id); }}>Tables → workbook</Btn> : null}
      </Header>
      <section className="lev-panel">
        <h4>Live public data (keyless)</h4>
        <div className="lev-row">{LIVE.map((l) => <Btn key={l.cmd} onClick={() => say(conversationId, l.cmd)}>{l.label}</Btn>)}</div>
        <p className="lev-hint">Runs in the conversation: the rows, the citation and the time it was retrieved are recorded with the chart.</p>
      </section>
      <section className="lev-panel">
        <h4>Tables in this conversation · {tables.length}</h4>
        {tables.length === 0 ? <p className="lev-empty">No tables yet. Ask LÉLU for a comparison or data and it appears here.</p> : null}
        {tables.map((t, i) => {
          const chart = tableToChart(t);
          return (
            <div key={i} className="lev-tablecard">
              <div className="lev-table"><table><thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{t.rows.slice(0, 12).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table></div>
              {chart
                ? <Btn tone="primary" onClick={() => { const r = createWork(conversationId, { kind: "visual", medium: "chart", title: chart.title || "Chart", program: chart }, "Charted a table from this conversation"); if (r.ok) select(r.artifact.id); }}>Chart this table</Btn>
                : <span className="lev-hint">No numeric column to chart — it can still go into a workbook.</span>}
            </div>
          );
        })}
      </section>
      <Notice text={note} />
      <WorkTabs works={works} selected={selected?.id ?? null} onSelect={(id) => { select(id); setNote(null); }} empty="Charts and workbooks you make appear here." />
      {selected?.kind === "visual" ? <VisualOf artifact={selected} /> : null}
      {selected?.kind === "workbook" ? <><WorkbookView spec={specOf(selected) as WorkbookSpec} /><ExportRow conversationId={conversationId} artifact={selected} formats={["xlsx", "csv"]} /></> : null}
      {selected?.kind === "visual" ? <Btn onClick={() => { const spec = specOf(selected) as VisualSpec; const p = spec.program as { title?: string }; const r = createWork(conversationId, { kind: "deck", title: `${p.title ?? selected.title} — findings`, slides: [{ title: p.title ?? selected.title, layout: "title", subtitle: "Findings from the data" }, { title: "What the data shows", layout: "content", bullets: [spec.notes ?? "See the chart.", ...(spec.sources ?? []).map((s) => `Source: ${s.title}`)] }] }, "Turned the chart's findings into slides"); setNote(r.ok ? "Slides created — open Present → Export." : r.reason); }}>Findings → slides</Btn> : null}
    </div>
  );
}

function WorkbookView({ spec }: { spec: WorkbookSpec }) {
  return <div className="lev-wb">{spec.sheets.map((s) => <div key={s.name}><h4>{s.name}</h4><div className="lev-table"><table><thead><tr>{s.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{s.rows.slice(0, 20).map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}>{typeof c === "object" && c ? (c as { formula: string }).formula : String(c ?? "")}</td>)}</tr>)}</tbody></table></div></div>)}</div>;
}

/* ------------------------------------------------------------------ code */

function CodeEnv({ messages }: EnvProps) {
  const blocks = useMemo(() => codeBlocksOf(messages), [messages]);
  const [active, setActive] = useState<CodeBlock | null>(null);
  const [code, setCode] = useState("");
  const [run, setRun] = useState<string | null>(null);
  const current = active ?? blocks[0] ?? null;
  useEffect(() => { setCode(current?.code ?? ""); setRun(null); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="lev" data-lelu-env-view="code">
      <Header stage="code">
        {current ? <Btn onClick={() => navigator.clipboard?.writeText(code)}>Copy</Btn> : null}
        {current ? <Btn onClick={() => { const blob = new Blob([code], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `lelu-snippet.${current.lang === "javascript" ? "js" : current.lang || "txt"}`; a.click(); }}>Download</Btn> : null}
        {current && runnable(current) ? <Btn tone="primary" onClick={() => setRun(prototypeDoc({ ...current, code }))}>▶ Run in sandbox</Btn> : null}
      </Header>
      {blocks.length === 0 ? <p className="lev-empty">No code in this conversation yet. Ask LÉLU for a component, a script or a small web prototype; HTML and JavaScript run here in a sandbox.</p> : null}
      <div className="lev-row">{blocks.map((b) => <button key={b.id} type="button" className="lev-chipsel" data-on={b.id === current?.id} onClick={() => setActive(b)}>{b.lang} · {b.code.split("\n").length} lines</button>)}</div>
      {current ? (
        <div className="lev-split">
          <section className="lev-panel"><h4>{current.lang}</h4><textarea className="lev-code" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label="Code" /></section>
          <section className="lev-panel"><h4>Preview</h4>{run ? <iframe className="lev-frame" title="Prototype" sandbox="allow-scripts" srcDoc={run} data-lelu-code-run /> : <p className="lev-empty">{runnable(current) ? "Run to see it — scripts run sandboxed, with no access to LÉLU or your data." : `${current.lang} can't run in the browser sandbox; copy or download it.`}</p>}</section>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ film */

function FilmEnv({ conversationId, model }: EnvProps) {
  const works = useWorks(conversationId).filter((w) => w.kind === "visual" && mediumOf(w) === "video");
  const [selected, select] = useSelected(works);
  const scenes = useMemo(() => toFilmScenes(model), [model]);
  return (
    <div className="lev" data-lelu-env-view="film">
      <Header stage="film">
        <Btn tone="primary" onClick={() => { const r = createWork(conversationId, { kind: "visual", medium: "video", title: `${model.title || "Conversation"} — film`, program: { scenes, width: 960, height: 540, fps: 24, transition: "fade", soundtrack: "calm" } }, "Storyboarded a film from this conversation"); if (r.ok) select(r.artifact.id); }}>Film from this conversation</Btn>
      </Header>
      <section className="lev-panel">
        <h4>Storyboard · {scenes.length} scenes · {scenes.reduce((s, x) => s + Number(x.duration), 0)} s</h4>
        <ol className="lev-board">{scenes.map((s, i) => <li key={i}><strong>{String(s.title)}</strong><span>{String(s.subtitle ?? "")}</span><em>{String(s.motion)}</em></li>)}</ol>
      </section>
      <WorkTabs works={works} selected={selected?.id ?? null} onSelect={select} empty="No film yet. The film renders on this device (Canvas + WebCodecs/MediaRecorder) — no video service." />
      {selected ? <VisualOf artifact={selected} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ voice */

function VoiceEnv({ model }: EnvProps) {
  const [speaking, setSpeaking] = useState<number | null>(null);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const parts = model.sections.map((s) => `${s.heading}. ${s.text.replace(/[#*_`>|-]/g, " ")}`);
  const stop = () => { window.speechSynthesis?.cancel(); setSpeaking(null); };
  const read = (from: number) => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const next = (i: number) => {
      if (i >= parts.length) { setSpeaking(null); return; }
      const u = new SpeechSynthesisUtterance(parts[i].slice(0, 1200));
      u.onend = () => next(i + 1);
      setSpeaking(i);
      window.speechSynthesis.speak(u);
    };
    next(from);
  };
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return (
    <div className="lev" data-lelu-env-view="voice">
      <Header stage="voice">
        <Btn tone="primary" disabled={!supported} onClick={() => (speaking === null ? read(0) : stop())}>{speaking === null ? "▶ Read aloud" : "■ Stop"}</Btn>
        <Btn onClick={async () => (await import("../../../../../core/voice/VoiceEngine")).default.getInstance().toggle()}>◖ Talk to LÉLU</Btn>
      </Header>
      <p className="lev-hint">{supported ? "Read aloud uses this device's own voices (no network). LÉLU's cloned voice needs her VoxCPM2 worker on the server; “Talk to LÉLU” uses the voice engine already configured." : "This browser has no speech synthesis; “Talk to LÉLU” still works where the voice engine is configured."}</p>
      <ol className="lev-readalong">{model.sections.map((s, i) => <li key={s.id} data-on={i === speaking}><button type="button" onClick={() => read(i)}>{s.heading}</button><p>{s.text.slice(0, 260)}</p></li>)}</ol>
    </div>
  );
}

/* ------------------------------------------------------------------ workbench */

function WorkbenchEnv({ conversationId }: EnvProps) {
  const genesis = useGenesis();
  const works = useWorks(conversationId);
  const [picked, setPicked] = useState<string[]>([]);
  const host = { modules: () => genesis.state.modules, openModule: genesis.openModule, setModulePresentation: genesis.setModulePresentation, raiseModule: genesis.raiseModule, activeConversationId: () => conversationId };
  const compose = (withBrowser: boolean) => {
    const modules = [chatWindowId(conversationId), ...(withBrowser ? ["browser"] : []), ...picked.slice(0, 3).map((id) => `artifact:${id}`)];
    for (const id of picked.slice(0, 3)) window.dispatchEvent(new CustomEvent("lelu-studio-open", { detail: { ids: [id], layout: "single" } }));
    setTimeout(() => arrangeWorkspace(host, "tile", modules.filter((m) => !m.startsWith("artifact:")), "lelu"), 120);
    WorkspaceStewardStore.record({ by: "lelu", what: `workbench: chat${withBrowser ? " + browser" : ""} + ${picked.length} work(s)`, reasons: ["composed a multi-panel workspace for this conversation"] });
  };
  return (
    <div className="lev" data-lelu-env-view="studio">
      <Header stage="studio">
        <Btn tone="primary" onClick={() => compose(true)}>Chat + browser + works</Btn>
        <Btn onClick={() => compose(false)}>Chat + works</Btn>
      </Header>
      <p className="lev-hint">LÉLU's Workspace Steward tiles the windows locally (no model call); on a phone they become tabs you can swipe between.</p>
      <div className="lev-pick">{works.length === 0 ? <p className="lev-empty">No works yet — make a document, chart, diagram, scene or film in the other environments.</p> : works.map((w) => (
        <label key={w.id} data-on={picked.includes(w.id)}><input type="checkbox" checked={picked.includes(w.id)} onChange={() => setPicked((p) => (p.includes(w.id) ? p.filter((x) => x !== w.id) : [...p, w.id]))} />{w.title}<span>{w.kind === "visual" ? mediumOf(w) : w.kind}</span></label>
      ))}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ 3D scenes */

const PRESET_NAMES = ["forest", "city", "desert", "space"];
const SHAPES = ["box", "sphere", "torusKnot", "crystal", "tree", "building", "icosahedron"];

async function glbTo(format: "stl" | "obj", bytes: Uint8Array): Promise<Uint8Array> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const exporter = format === "stl" ? new (await import("three/examples/jsm/exporters/STLExporter.js")).STLExporter() : new (await import("three/examples/jsm/exporters/OBJExporter.js")).OBJExporter();
  const gltf = await new GLTFLoader().parseAsync(bytes.slice().buffer as ArrayBuffer, "");
  const group = new THREE.Group();
  group.add(gltf.scene);
  group.updateMatrixWorld(true);
  return new TextEncoder().encode(exporter.parse(group) as string);
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

export function ScenesPanel({ conversationId, model }: { conversationId: string; model: StageConversation }) {
  const works = useWorks(conversationId).filter((w) => w.kind === "visual" && mediumOf(w) === "scene3d");
  const [selected, select] = useSelected(works);
  const [reopened, setReopened] = useState<{ name: string; format: "glb" | "stl" | "obj"; src: string; size: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const program = selected ? ((specOf(selected) as VisualSpec).program as { objects?: Array<{ id: string; shape: string; color: string; position: number[] }> } & Record<string, unknown>) : null;
  const revise = (next: Record<string, unknown>, what: string) => {
    if (!selected) return;
    const { preset: _p, ...rest } = next;
    reviseWork(conversationId, selected, { ...(specOf(selected) as VisualSpec), program: rest }, what);
  };
  const exportAs = async (format: "glb" | "gltf" | "stl" | "obj") => {
    if (!selected) return;
    setNote(`Exporting ${format.toUpperCase()}…`);
    const base = await exportWork(conversationId, selected, format === "gltf" ? "gltf" : "glb", format === "glb" || format === "gltf");
    if (!base.ok || !base.bytes) { setNote(`✗ ${base.reason ?? "export failed"}`); return; }
    let bytes = base.bytes;
    let name = base.filename ?? "scene.glb";
    if (format === "stl" || format === "obj") {
      bytes = await glbTo(format, base.bytes);
      name = name.replace(/\.glb$/, `.${format}`);
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer]); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    }
    setNote(`✓ ${name} · ${Math.round(bytes.length / 102.4) / 10} KB`);
    if (format !== "gltf") setReopened({ name, format, src: toDataUrl(bytes, format === "glb" ? "model/gltf-binary" : "text/plain"), size: bytes.length });
  };
  return (
    <div className="lev" data-lelu-env-view="scenes">
      <div className="lev-row">
        {PRESET_NAMES.map((p) => <Btn key={p} onClick={() => { const r = createWork(conversationId, { kind: "visual", medium: "scene3d", title: `${model.title || "Scene"} — ${p}`, program: { preset: p, seed: 7 } }, `Built a ${p} 3D scene`); if (r.ok) select(r.artifact.id); }}>+ {p}</Btn>)}
      </div>
      <WorkTabs works={works} selected={selected?.id ?? null} onSelect={(id) => { select(id); setReopened(null); }} empty="No 3D scene yet — start from a preset; every object can then be changed." />
      {selected && program ? (
        <>
          <VisualOf artifact={selected} />
          <section className="lev-panel">
            <h4>Components · {program.objects?.length ?? 0}</h4>
            <div className="lev-row">
              {SHAPES.map((s) => <Btn key={s} onClick={() => revise({ ...program, objects: [...(program.objects ?? []), { id: `${s}-${Date.now() % 10000}`, shape: s, position: [Math.round(Math.random() * 6 - 3), 1, Math.round(Math.random() * 6 - 3)], color: "#c084fc", scale: [1, 1, 1], rotation: [0, 0, 0] }] }, `Added a ${s} to the scene`)}>+ {s}</Btn>)}
            </div>
            <div className="lev-objects">{(program.objects ?? []).slice(0, 24).map((o, i) => (
              <span key={o.id}>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : "#888888"} aria-label={`${o.id} colour`} onChange={(e) => { const objects = [...(program.objects ?? [])]; objects[i] = { ...o, color: e.target.value }; revise({ ...program, objects }, `Recoloured ${o.id}`); }} />
                {o.id}
                <button type="button" aria-label={`Remove ${o.id}`} onClick={() => revise({ ...program, objects: (program.objects ?? []).filter((x) => x.id !== o.id) }, `Removed ${o.id}`)}>×</button>
              </span>
            ))}</div>
          </section>
          <div className="lev-export">{(["glb", "gltf", "stl", "obj"] as const).map((f) => <Btn key={f} onClick={() => void exportAs(f)}>⇣ {f.toUpperCase()}</Btn>)}<Notice text={note} /></div>
          <Versions conversationId={conversationId} artifact={selected} />
          {reopened ? (
            <section className="lev-panel" data-lelu-reopened={reopened.format}>
              <h4>Reopened from the exported file · {reopened.name}</h4>
              <Suspense fallback={<p className="lev-empty">Opening…</p>}><Model3DView model={reopened} /></Suspense>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ visuals (gallery) */

const STYLES = ["flowfield", "circlepack", "ridgelines", "constellation", "truchet", "tree", "mosaic", "orbits"];
const PALETTE_NAMES = ["lelu", "aurora", "ember", "ocean", "forest", "noir", "pastel", "neon"];

export function VisualsPanel({ conversationId, model }: { conversationId: string; model: StageConversation }) {
  const works = useWorks(conversationId).filter((w) => (w.kind === "visual" && mediumOf(w) === "generative") || w.kind === "drawing");
  const [selected, select] = useSelected(works);
  const [style, setStyle] = useState("flowfield");
  const [palette, setPalette] = useState("lelu");
  const program = selected?.kind === "visual" ? ((specOf(selected) as VisualSpec).program as Record<string, unknown>) : null;
  return (
    <div className="lev lev-visuals" data-lelu-env-view="visuals">
      <div className="lev-row">
        <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Style">{STYLES.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={palette} onChange={(e) => setPalette(e.target.value)} aria-label="Palette">{PALETTE_NAMES.map((s) => <option key={s}>{s}</option>)}</select>
        <Btn tone="primary" onClick={() => { const r = createWork(conversationId, { kind: "visual", medium: "generative", title: `${model.title || "Composition"} — ${style}`, program: { style, palette, seed: Date.now() % 100000, width: 1200, height: 800 } }, `Composed a ${style} visual`); if (r.ok) select(r.artifact.id); }}>New composition</Btn>
        {program ? <Btn onClick={() => reviseWork(conversationId, selected!, { ...(specOf(selected!) as VisualSpec), program: { ...program, style, palette } }, `Restyled as ${style} in ${palette}`)}>Restyle selected</Btn> : null}
        <Btn onClick={() => say(conversationId, `/sketch ${model.title || "concept"}`)}>Editable sketch</Btn>
        <Btn onClick={() => say(conversationId, `/collection ${model.title || "concept"}`)}>Fashion collection</Btn>
      </div>
      <WorkTabs works={works} selected={selected?.id ?? null} onSelect={select} empty="Compositions you make here are saved, versioned and exportable (SVG/PNG/JSON)." />
      {selected ? <><VisualOf artifact={selected} /><Versions conversationId={conversationId} artifact={selected} /></> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ deck export (present) */

export function DeckExport({ conversationId, model }: { conversationId: string; model: StageConversation }) {
  const decks = useWorks(conversationId).filter((w) => w.kind === "deck");
  const [note, setNote] = useState<string | null>(null);
  const deck = decks[0] ?? null;
  return (
    <div className="lev-deckbar">
      <Btn onClick={() => { const r = createWork(conversationId, toDeck(model) as DeckSpec, "Built a slide deck from this conversation"); setNote(r.ok ? `Deck “${r.artifact.title}” — ${(specOf(r.artifact) as DeckSpec).slides.length} slides` : r.reason); }}>{deck ? "Rebuild deck" : "Make deck"}</Btn>
      {deck ? <ExportRow conversationId={conversationId} artifact={deck} formats={["pptx", "pdf"]} /> : null}
      <Notice text={note} />
    </div>
  );
}

export function GraphWorks({ conversationId }: { conversationId: string }) {
  const graphs = useWorks(conversationId).filter((w) => w.kind === "graph");
  if (!graphs.length) return null;
  return <p className="lev-hint">{graphs.length} saved graph{graphs.length === 1 ? "" : "s"}: {graphs.map((g) => `${g.title} (${(specOf(g) as GraphSpec).nodes.length} nodes)`).join(", ")}</p>;
}

/* ------------------------------------------------------------------ registry */

export default function EnvironmentStage(props: EnvProps & { stage: StageMode }) {
  const { stage } = props;
  const body = (() => {
    switch (stage) {
      case "research": return <ResearchEnv {...props} />;
      case "document": return <DocumentEnv {...props} />;
      case "diagram": return <DiagramEnv {...props} />;
      case "data": return <DataEnv {...props} />;
      case "code": return <CodeEnv {...props} />;
      case "film": return <FilmEnv {...props} />;
      case "voice": return <VoiceEnv {...props} />;
      case "studio": return <WorkbenchEnv {...props} />;
      default: return null;
    }
  })();
  // A CSS entrance (compositor-driven): content is never left half-faded on a slow device.
  return <div className="lev-scroll lev-enter">{body}</div>;
}

export const ENVIRONMENT_IDS = ENVIRONMENTS.map((e) => e.id);
