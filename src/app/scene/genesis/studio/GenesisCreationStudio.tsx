/**
 * LÉLU — Creation Studio library: every document, presentation and
 * spreadsheet, newest first. Open one as its own window, import a file
 * (its original bytes are kept), or start a new one.
 */

import { useRef, useState } from "react";
import { FilePlus2, FileSpreadsheet, FileText, Network, PenTool, Presentation, Upload, Workflow } from "lucide-react";
import GenesisWindowFrame from "../GenesisWindowFrame";
import { artifactGist, firstChartSvg } from "../../../../core/studio/StudioPreview";
import type { StudioArtifact } from "../../../../core/studio/StudioStore";
import { agentHierarchyGraph } from "../../../../core/studio/GraphSources";
import AgentStore from "../../../../core/agents/AgentStore";
import { KIND_LABEL, openArtifacts, useStudioStore } from "./useStudio";
import PlaceInWorldButton from "../spatial/PlaceInWorldButton";
import "./studio.css";

export const KIND_ICON = { document: FileText, deck: Presentation, workbook: FileSpreadsheet, graph: Network, drawing: PenTool } as const;

const BLANK = {
  document: { kind: "document", title: "Untitled document", blocks: [{ type: "heading", level: 1, text: "Untitled document" }, { type: "paragraph", text: "Ask LÉLU to write or revise this." }] },
  deck: { kind: "deck", title: "Untitled presentation", slides: [{ title: "Untitled presentation", layout: "title" }] },
  workbook: { kind: "workbook", title: "Untitled spreadsheet", sheets: [{ name: "Sheet1", columns: ["Item", "Value"], rows: [] }] },
  graph: { kind: "graph", title: "Untitled graph", nodes: [{ id: "start", label: "Start", x: 0, y: 0 }], edges: [] },
  drawing: { kind: "drawing", title: "Untitled drawing", scene: { elements: [] } },
} as const;

export default function GenesisCreationStudio({ onClose }: { onClose: () => void }) {
  const store = useStudioStore();
  const list = store.list();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const opened: string[] = [];
    const problems: string[] = [];
    for (const file of [...files]) {
      const r = await store.importFile(file.name, new Uint8Array(await file.arrayBuffer()), { mime: file.type });
      if (r.ok) opened.push(r.artifact.id);
      else problems.push(r.reason);
    }
    if (opened.length) openArtifacts(opened);
    setMessage(problems.length ? problems.join(" ") : `Imported ${opened.length} file${opened.length === 1 ? "" : "s"}; the originals are kept unchanged.`);
  };
  const createHierarchy = () => {
    const r = store.create(agentHierarchyGraph(AgentStore.getInstance().list()), { by: "user", note: "from the agent hierarchy" });
    if (r.ok) openArtifacts([r.artifact.id]);
  };
  const create = (kind: keyof typeof BLANK) => {
    const r = store.create(JSON.parse(JSON.stringify(BLANK[kind])), { by: "user" });
    if (r.ok) openArtifacts([r.artifact.id]);
  };

  return (
    <GenesisWindowFrame eyebrow="LÉLU" title={`Creation Studio · ${list.length}`} onClose={onClose} closeLabel="Close">
      <div className="lst-library" data-lelu-studio-library>
        <div className="lst-toolbar">
          <button type="button" className="lst-btn" onClick={() => create("document")}><FilePlus2 size={14} aria-hidden /> Document</button>
          <button type="button" className="lst-btn" onClick={() => create("deck")}><Presentation size={14} aria-hidden /> Presentation</button>
          <button type="button" className="lst-btn" onClick={() => create("workbook")}><FileSpreadsheet size={14} aria-hidden /> Spreadsheet</button>
          <button type="button" className="lst-btn" onClick={() => create("graph")} data-lelu-studio-new="graph"><Network size={14} aria-hidden /> Graph</button>
          <button type="button" className="lst-btn" onClick={() => create("drawing")} data-lelu-studio-new="drawing"><PenTool size={14} aria-hidden /> Drawing</button>
          <button type="button" className="lst-btn ghost" onClick={createHierarchy} data-lelu-studio-new="hierarchy" title="A graph of LÉLU's real agent hierarchy"><Workflow size={14} aria-hidden /> Agent hierarchy</button>
          <span className="lst-spacer" />
          <button type="button" className="lst-btn ghost" onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden /> Import file</button>
          <input ref={fileRef} type="file" hidden multiple accept=".docx,.pptx,.xlsx,.pdf,.csv,.md,.markdown,.html,.htm,.txt,.rtf" onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {message ? <p className="lst-note" role="status">{message}</p> : null}
        {list.length === 0 ? (
          <p className="lst-empty">Nothing yet. Ask LÉLU in chat — “make this into a PowerPoint”, “put the data in a spreadsheet” — or import a file.</p>
        ) : (
          <div className="lst-grid">
            {list.map((a) => <LibraryCard key={a.id} artifact={a} />)}
          </div>
        )}
      </div>
    </GenesisWindowFrame>
  );
}

function LibraryCard({ artifact }: { artifact: StudioArtifact }) {
  const store = useStudioStore();
  const latest = store.latest(artifact);
  const Icon = KIND_ICON[artifact.kind];
  const svg = firstChartSvg(latest.spec);
  const verified = [...new Set(artifact.exports.filter((e) => e.ok && e.rev === latest.rev).map((e) => e.format.toUpperCase()))];
  const color = artifact.kind === "deck" ? "#38bdf8" : artifact.kind === "workbook" ? "#34d399" : "#a78bfa";
  return (
    <div className="lst-card" data-lelu-studio-card={artifact.id}>
      <button type="button" className="lst-card-open" onClick={() => openArtifacts([artifact.id])}>
        <span className="lst-card-head"><Icon size={15} aria-hidden /> {KIND_LABEL[artifact.kind]} · r{latest.rev}</span>
        <strong>{artifact.title}</strong>
        {svg ? <span className="lst-thumb" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
        <span className="lst-gist">{artifactGist(latest.spec)}</span>
        <span className="lst-meta">{verified.length ? `verified: ${verified.join(", ")}` : "not exported"}{artifact.original ? ` · from ${artifact.original.name}` : ""}</span>
      </button>
      {/* The artifact is the subject; placing it makes a real scene object. */}
      <PlaceInWorldButton
        name={artifact.title}
        kind="box"
        color={color}
        scale={0.8}
        label="Place in world"
        className="lst-btn ghost"
      />
    </div>
  );
}
