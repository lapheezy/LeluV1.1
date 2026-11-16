/**
 * LÉLU — a graph artifact, edited in React Flow (lazy-loaded: this module
 * and @xyflow/react load only when a graph is opened).
 *
 * The artifact's spec is the source of truth (Creation Studio store):
 * React Flow is its editor. Move, connect, add, rename and delete are
 * saved back with StudioStore.saveEdit — one "edited" revision per
 * editing session, so LÉLU's revisions and the user's stay distinct.
 * A node with `group` sits inside that node (nested systems).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphSpec } from "../../../../core/studio/StudioTypes";
import { useStudioStore } from "./useStudio";

type GNode = Node<{ label: string; type?: string; ref?: string; color?: string }>;

function toFlow(spec: GraphSpec): { nodes: GNode[]; edges: Edge[] } {
  const parents = new Set(spec.nodes.map((n) => n.group).filter(Boolean));
  // React Flow needs a parent before its children.
  const ordered = [...spec.nodes].sort((a, b) => Number(Boolean(a.group)) - Number(Boolean(b.group)));
  const nodes: GNode[] = ordered.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label, type: n.type, ref: n.ref, color: n.color },
    ...(n.group ? { parentId: n.group, extent: "parent" as const } : {}),
    style: {
      background: n.color ?? "#ede9fe",
      color: "#1e1b4b",
      border: parents.has(n.id) ? "1px dashed #7c6fd0" : "1px solid #7c6fd0",
      borderRadius: 12,
      fontSize: 12,
      ...(parents.has(n.id) ? { width: 320, height: 200, background: `${n.color ?? "#ede9fe"}55` } : {}),
    },
  }));
  const edges: Edge[] = spec.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.label }));
  return { nodes, edges };
}

function toSpec(base: GraphSpec, nodes: GNode[], edges: Edge[]): GraphSpec {
  return {
    ...base,
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.data.label,
      type: n.data.type,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      color: n.data.color,
      group: n.parentId,
      ref: n.data.ref,
    })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, label: typeof e.label === "string" ? e.label : undefined })),
  };
}

export default function GraphEditor({ artifactId, spec, readOnly }: { artifactId: string; spec: GraphSpec; readOnly: boolean }) {
  const store = useStudioStore();
  const initial = useMemo(() => toFlow(spec), [spec]);
  const [nodes, setNodes] = useState<GNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [status, setStatus] = useState<string>("Saved");
  const [renaming, setRenaming] = useState<string | null>(null);
  const baseRef = useRef(spec);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // A revision made elsewhere (LÉLU, restore) replaces what is shown.
  useEffect(() => {
    if (dirty.current) return;
    baseRef.current = spec;
    setNodes(initial.nodes);
    setEdges(initial.edges);
  }, [spec, initial]);

  const pending = useRef<GraphSpec | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return null;
    const r = store.saveEdit(artifactId, next);
    dirty.current = false;
    return r;
  }, [artifactId, store]);

  const save = useCallback((n: GNode[], e: Edge[]) => {
    if (readOnly) return;
    dirty.current = true;
    pending.current = toSpec(baseRef.current, n, e);
    setStatus("Saving…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = flush();
      if (r) setStatus(!r.ok ? `Not saved: ${r.reason}` : r.persisted ? `Saved · r${r.revision.rev}` : "Not saved to this device (storage full) — kept for this session");
    }, 600);
  }, [flush, readOnly]);

  // Closing the window, switching away or going Home saves what is pending.
  useEffect(() => {
    const onHide = () => { flush(); };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  const onNodesChange = useCallback((changes: NodeChange<GNode>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      const meaningful = changes.some((c) => c.type === "remove" || (c.type === "position" && !c.dragging));
      if (meaningful) save(next, edges);
      return next;
    });
  }, [edges, save]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current);
      if (changes.some((c) => c.type === "remove")) save(nodes, next);
      return next;
    });
  }, [nodes, save]);

  const onConnect = useCallback((c: Connection) => {
    setEdges((current) => {
      const next = addEdge({ ...c, id: `e-${c.source}-${c.target}-${Date.now().toString(36)}` }, current);
      save(nodes, next);
      return next;
    });
  }, [nodes, save]);

  const addNode = () => {
    const id = `n-${Date.now().toString(36)}`;
    const next = [...nodes, { id, position: { x: 40 + nodes.length * 12, y: 40 + nodes.length * 12 }, data: { label: "New node", type: "idea" }, style: { background: "#ede9fe", color: "#1e1b4b", border: "1px solid #7c6fd0", borderRadius: 12, fontSize: 12 } } as GNode];
    setNodes(next);
    save(next, edges);
    setRenaming(id);
  };

  const rename = (id: string, label: string) => {
    const next = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: label.trim() || n.data.label } } : n));
    setNodes(next);
    save(next, edges);
  };

  const selected = nodes.find((n) => n.selected);
  const editing = nodes.find((n) => n.id === (renaming ?? selected?.id));

  return (
    <div className="lst-graph" data-lelu-graph-editor={artifactId}>
      <div className="lst-toolbar">
        {!readOnly ? <button type="button" className="lst-btn" onClick={addNode} data-lelu-graph-add>+ Node</button> : null}
        {!readOnly && editing ? (
          <input
            key={editing.id}
            className="lst-input"
            aria-label="Node label"
            defaultValue={editing.data.label}
            autoFocus={renaming === editing.id}
            onBlur={(e) => { rename(editing.id, e.target.value); setRenaming(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            data-lelu-graph-label
          />
        ) : null}
        <span className="lst-spacer" />
        <span className="lst-note" role="status" data-lelu-graph-status>{readOnly ? "Viewing an earlier revision" : status}</span>
      </div>
      <div className="lst-graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          fitView
          minZoom={0.1}
          proOptions={{ hideAttribution: false }}
          colorMode="dark"
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
