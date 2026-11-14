/**
 * LÉLU — the research board: a conversation as a knowledge graph (React Flow).
 *
 * Generated from the SAME stored messages (conversationModel): each question,
 * the answer it got, the answer's sections, its images and its sources are
 * nodes, linked the way the conversation linked them. It stays alive — a new
 * message adds its nodes — and it is the person's board: drag, connect, add
 * notes (double-click the canvas), rename (double-click a node), delete
 * (select + Backspace). Their edits persist per conversation (KvStore) and
 * are merged over the generated graph, never thrown away by it.
 *
 * Everything here is local rendering. No model is asked to "draw" the board.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import KvStore from "../../../../../core/storage/KvStore";
import { stripMarkdown, type StageConversation } from "./conversationModel";

type Kind = "question" | "answer" | "section" | "media" | "link" | "note";
interface CardData extends Record<string, unknown> {
  kind: Kind;
  title: string;
  detail?: string;
  src?: string;
  href?: string;
}
type CardNode = Node<CardData, "card">;

interface BoardEdits {
  positions: Record<string, { x: number; y: number }>;
  labels: Record<string, string>;
  removed: string[];
  notes: CardNode[];
  edges: Edge[];
}

const keyOf = (id: string) => `lelu.board.v1.${id}`;
const emptyEdits = (): BoardEdits => ({ positions: {}, labels: {}, removed: [], notes: [], edges: [] });

function loadEdits(id: string): BoardEdits {
  try {
    return { ...emptyEdits(), ...(KvStore.getInstance().get<BoardEdits>(keyOf(id)) ?? {}) };
  } catch {
    return emptyEdits();
  }
}

const COL = 420;

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/** The conversation as a graph, laid out in columns by exchange. Pure. */
export function generateGraph(model: StageConversation): { nodes: CardNode[]; edges: Edge[] } {
  const nodes: CardNode[] = [];
  const edges: Edge[] = [];
  const edge = (source: string, target: string, label?: string) =>
    edges.push({ id: `e-${source}-${target}`, source, target, label, animated: label === "answers", type: "smoothstep" });
  for (const t of model.turns) {
    const x = t.index * COL;
    let y = 0;
    const q = `q${t.index}`;
    const a = `a${t.index}`;
    if (t.question) {
      nodes.push({ id: q, type: "card", position: { x, y }, data: { kind: "question", title: stripMarkdown(t.question).slice(0, 140) } });
      y += 130;
    }
    if (t.answerId) {
      nodes.push({ id: a, type: "card", position: { x, y }, data: { kind: "answer", title: t.gist || "LÉLU's answer", detail: `${t.sections.length} section(s) · ${t.media.length} image(s)` } });
      if (t.question) edge(q, a, "answers");
      y += 150;
    }
    for (const s of t.sections) {
      if (!s.heading && !s.text) continue;
      nodes.push({ id: s.id, type: "card", position: { x, y }, data: { kind: "section", title: s.heading, detail: stripMarkdown(s.text).slice(0, 160) } });
      edge(t.answerId ? a : q, s.id);
      s.media.forEach((m, i) => {
        nodes.push({ id: m.id, type: "card", position: { x: x + 290, y: y + i * 170 }, data: { kind: "media", title: m.alt, src: m.src } });
        edge(s.id, m.id, "shows");
      });
      y += Math.max(150, s.media.length * 170);
    }
    t.links.forEach((l, i) => {
      nodes.push({ id: l.id, type: "card", position: { x, y: y + i * 90 }, data: { kind: "link", title: l.label, href: l.href } });
      edge(t.answerId ? a : q, l.id, "source");
    });
    // Consecutive exchanges are one line of thought.
    if (t.index > 0 && t.question) edge(model.turns[t.index - 1].answerId ? `a${t.index - 1}` : `q${t.index - 1}`, q, "then");
  }
  return { nodes, edges };
}

function merge(model: StageConversation, edits: BoardEdits): { nodes: CardNode[]; edges: Edge[] } {
  const generated = generateGraph(model);
  const removed = new Set(edits.removed);
  const nodes = [...generated.nodes, ...edits.notes]
    .filter((n) => !removed.has(n.id))
    .map((n) => ({
      ...n,
      position: edits.positions[n.id] ?? n.position,
      data: edits.labels[n.id] ? { ...n.data, title: edits.labels[n.id] } : n.data,
    }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [...generated.edges, ...edits.edges].filter((e) => !removed.has(e.id) && ids.has(e.source) && ids.has(e.target));
  return { nodes, edges };
}

const CardView = memo(function CardView({ id, data, selected }: NodeProps<CardNode>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(data.title);
  useEffect(() => setValue(data.title), [data.title]);
  const commit = () => {
    setEditing(false);
    window.dispatchEvent(new CustomEvent("lelu-board-rename", { detail: { id, title: value.trim() || data.title } }));
  };
  return (
    <div className="lbd-card" data-kind={data.kind} data-selected={selected} onDoubleClick={() => setEditing(true)}>
      <Handle type="target" position={Position.Top} />
      <span className="lbd-kind">{data.kind === "media" ? "image" : data.kind}</span>
      {data.src ? <img src={data.src} alt={data.title} loading="lazy" decoding="async" draggable={false} /> : null}
      {editing ? (
        <textarea
          className="nodrag"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : (
        <strong>{data.title}</strong>
      )}
      {data.detail && !editing ? <p>{data.detail}</p> : null}
      {data.href ? <a className="nodrag" href={data.href} target="_blank" rel="noreferrer">{hostOf(data.href)}</a> : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

const nodeTypes = { card: CardView };

function Board({ conversationId, model }: { conversationId: string; model: StageConversation }) {
  const [edits, setEdits] = useState<BoardEdits>(() => loadEdits(conversationId));
  const initial = useMemo(() => merge(model, edits), [model, edits]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const flow = useReactFlow();

  // The conversation grew (or edits changed): re-merge, keeping where things are.
  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
  }, [initial, setNodes, setEdges]);

  const save = useCallback(
    (next: BoardEdits) => {
      setEdits(next);
      try {
        KvStore.getInstance().set(keyOf(conversationId), next);
      } catch {
        /* the board still works this session */
      }
    },
    [conversationId],
  );

  useEffect(() => {
    const onRename = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      if (!nodes.some((n) => n.id === id)) return;
      save({ ...edits, labels: { ...edits.labels, [id]: title } });
    };
    window.addEventListener("lelu-board-rename", onRename);
    return () => window.removeEventListener("lelu-board-rename", onRename);
  }, [edits, nodes, save]);

  const onConnect = useCallback(
    (c: Connection) => {
      const e: Edge = { id: `u-${c.source}-${c.target}-${Date.now()}`, source: c.source, target: c.target, type: "smoothstep", label: "relates", style: { strokeDasharray: "6 4" } };
      setEdges((eds) => addEdge(e, eds));
      save({ ...edits, edges: [...edits.edges, e] });
    },
    [edits, save, setEdges],
  );

  const addNote = useCallback(
    (x: number, y: number) => {
      const id = `note-${Date.now()}`;
      const note: CardNode = { id, type: "card", position: { x, y }, data: { kind: "note", title: "New note — double-click to edit" } };
      save({ ...edits, notes: [...edits.notes, note] });
    },
    [edits, save],
  );

  return (
    <div className="lbd" data-lelu-stage-view="board" data-nodes={nodes.length} data-edges={edges.length}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={(_, node) => save({ ...edits, positions: { ...edits.positions, [node.id]: node.position } })}
        onNodesDelete={(deleted) => save({ ...edits, removed: [...edits.removed, ...deleted.map((n) => n.id)], notes: edits.notes.filter((n) => !deleted.some((d) => d.id === n.id)) })}
        onEdgesDelete={(deleted) => save({ ...edits, removed: [...edits.removed, ...deleted.map((e) => e.id)], edges: edits.edges.filter((e) => !deleted.some((d) => d.id === e.id)) })}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
          const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          addNote(p.x, p.y);
        }}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        proOptions={{ hideAttribution: false }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="rgba(196,170,255,0.25)" />
        <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(8,6,24,0.7)" nodeColor={(n) => ({ question: "#a855f7", answer: "#38bdf8", section: "#6366f1", media: "#f472b6", link: "#34d399", note: "#fbbf24" })[(n.data as CardData).kind]} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="lbd-tools">
        <button type="button" className="lst-chip" onClick={() => { const c = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); addNote(c.x, c.y); }}>+ Note</button>
        <button type="button" className="lst-chip" onClick={() => flow.fitView({ padding: 0.15, duration: 500 })}>Fit</button>
        <button type="button" className="lst-chip" onClick={() => save(emptyEdits())} title="Forget your moves, notes and links; regenerate from the conversation">Reset</button>
        <span className="lbd-count">{nodes.length} nodes · {edges.length} links</span>
      </div>
    </div>
  );
}

export default function BoardStage(props: { conversationId: string; model: StageConversation }) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
