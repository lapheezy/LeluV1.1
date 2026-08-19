/**
 * ==========================================================
 * LÉLU
 * GENESIS PROJECTS PANEL — the Workspace / project system
 *
 * Real creative work organized into persistent projects:
 * conversations, files, images, sketches, renders, videos,
 * tasks, notes, references, memories and outputs. Agents are
 * assignable to projects; project context feeds cognition and
 * agent delegation (ProjectStore.contextFor).
 * ==========================================================
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import ProjectStore, { PROJECT_ITEM_LABELS, type LeluProject } from "../../../core/projects/ProjectStore";
import AgentStore from "../../../core/agents/AgentStore";
import RenderStore, { type RenderOutput } from "../../../core/creative/RenderStore";
import SketchStore, { type SketchDocument } from "../../../core/creative/SketchDocument";
import AIService from "../../../core/AIService";

const fieldStyle: CSSProperties = {
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  padding: "7px 9px",
  color: "white",
  fontSize: 12,
  outline: "none",
  fontFamily: "inherit",
};

const chipButton: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "6px 11px",
  fontSize: 11.5,
  cursor: "pointer",
  fontFamily: "inherit",
};

interface GenesisProjectsPanelProps {
  onClose: () => void;
}

export default function GenesisProjectsPanel({ onClose }: GenesisProjectsPanelProps) {
  const store = useMemo(() => ProjectStore.getInstance(), []);
  const agents = useMemo(() => AgentStore.getInstance(), []);
  const renders = useMemo(() => RenderStore.getInstance(), []);
  const sketches = useMemo(() => SketchStore.getInstance(), []);

  const [projects, setProjects] = useState<LeluProject[]>(() => store.list());
  const [projectId, setProjectId] = useState<string | null>(() => store.list()[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [renderList, setRenderList] = useState<RenderOutput[]>(() => renders.list());
  const [sketchList, setSketchList] = useState<SketchDocument[]>(() => sketches.list());

  useEffect(() => {
    return store.subscribe((next) => {
      setProjects(next);
      setProjectId((current) => (current && next.some((project) => project.id === current) ? current : (next[0]?.id ?? null)));
    });
  }, [store]);

  useEffect(() => {
    return renders.subscribe((next) => setRenderList(next));
  }, [renders]);

  useEffect(() => {
    return sketches.subscribe((next) => setSketchList(next));
  }, [sketches]);

  useEffect(() => {
    void AIService.getInstance()
      .getMemories(500)
      .then((memories) => setMemoryCount(memories.length))
      .catch(() => setMemoryCount(null));
  }, []);

  const project = projects.find((item) => item.id === projectId) ?? null;

  function createProject() {
    const name = newName.trim() || `Project ${projects.length + 1}`;
    const created = store.create({ name, description: newDesc.trim() });
    setNewName("");
    setNewDesc("");
    setProjectId(created.id);
  }

  function attachFile(kind: "file" | "image") {
    if (!project) {
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "image" ? "image/*" : "*/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        store.addItem(project.id, {
          kind,
          title: file.name,
          ref: String(reader.result),
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function attachMemoryExcerpt() {
    if (!project) {
      return;
    }
    void AIService.getInstance()
      .getMemories(200)
      .then((memories) => {
        const memory = memories[Math.floor(Math.random() * Math.min(memories.length, 12))];
        if (!memory) {
          return;
        }
        store.addItem(project.id, {
          kind: "memory",
          title: `Memory · ${memory.category}`,
          text: memory.response.slice(0, 240),
        });
      });
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Workspace"
      title="Projects · organize creative work"
      onClose={onClose}
      width="min(96vw, 1100px)"
      maxHeight="min(92vh, 900px)"
      elevation="focus"
    >
      <div style={{ display: "flex", gap: 14, minHeight: "min(70vh, 660px)" }}>
        {/* ---------------------------------------------- project list */}
        <div
          style={{
            width: 250,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            padding: 12,
            background: "rgba(255,255,255,0.03)",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
            Projects · {projects.length}
          </div>
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Project name" style={fieldStyle} />
          <input value={newDesc} onChange={(event) => setNewDesc(event.target.value)} placeholder="Description (optional)" style={fieldStyle} />
          <button type="button" onClick={createProject} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.16)" }}>
            ＋ Create project
          </button>
          {projects.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setProjectId(item.id)}
              style={{
                textAlign: "left",
                borderRadius: 10,
                padding: "10px 11px",
                border: projectId === item.id ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.1)",
                background: projectId === item.id ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.02)",
                color: "white",
                cursor: "pointer",
                fontFamily: "inherit",
                opacity: item.status === "archived" ? 0.6 : 1,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
              <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 2 }}>
                {item.items.length} item(s) · {item.agentIds.length} agent(s) ·{" "}
                <span style={{ color: "#9be8ff" }}>{item.status}</span>
              </div>
            </button>
          ))}
        </div>

        {/* ---------------------------------------------- project detail */}
        {!project ? (
          <div style={{ flex: 1, opacity: 0.6, fontSize: 12.5 }}>Create a project to start organizing work.</div>
        ) : (
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", paddingRight: 4 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <input
                  value={project.name}
                  onChange={(event) => store.update(project.id, { name: event.target.value })}
                  style={{ ...fieldStyle, fontSize: 16, fontWeight: 700 }}
                />
                <input
                  value={project.description}
                  onChange={(event) => store.update(project.id, { description: event.target.value })}
                  placeholder="Project description"
                  style={{ ...fieldStyle, marginTop: 6 }}
                />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={() => store.update(project.id, { status: project.status === "archived" ? "active" : "archived" })} style={chipButton}>
                  {project.status === "archived" ? "Restore" : "Archive"}
                </button>
                <button type="button" onClick={() => store.remove(project.id)} style={{ ...chipButton, color: "#fca5a5" }}>
                  Delete
                </button>
              </div>
            </div>

            {/* agents */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
                Assigned agents · {project.agentIds.length}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {agents.runnable().map((agent) => {
                  const assigned = project.agentIds.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => (assigned ? store.unassignAgent(project.id, agent.id) : store.assignAgent(project.id, agent.id))}
                      style={{
                        ...chipButton,
                        background: assigned ? "rgba(34, 211, 238, 0.16)" : "rgba(255,255,255,0.04)",
                        border: assigned ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      {assigned ? "✓ " : ""}
                      {agent.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* add items */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
                Add to project
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={() => attachFile("file")} style={chipButton}>
                  📄 File
                </button>
                <button type="button" onClick={() => attachFile("image")} style={chipButton}>
                  🖼 Image
                </button>
                <button type="button" onClick={attachMemoryExcerpt} style={chipButton}>
                  ◐ Memory excerpt
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Note title" style={{ ...fieldStyle, width: 150 }} />
                <input value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Note text" style={{ ...fieldStyle, flex: 1, minWidth: 180 }} />
                <button
                  type="button"
                  onClick={() => {
                    if (noteTitle.trim() || noteText.trim()) {
                      store.addNote(project.id, noteTitle.trim() || "Note", noteText.trim());
                      setNoteTitle("");
                      setNoteText("");
                    }
                  }}
                  style={chipButton}
                >
                  ＋ Note
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <input value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder="Reference link (URL)" style={{ ...fieldStyle, flex: 1, minWidth: 200 }} />
                <button
                  type="button"
                  onClick={() => {
                    if (referenceUrl.trim()) {
                      store.addItem(project.id, { kind: "reference", title: referenceUrl.trim(), ref: referenceUrl.trim() });
                      setReferenceUrl("");
                    }
                  }}
                  style={chipButton}
                >
                  ＋ Reference
                </button>
              </div>
              {renderList.length > 0 ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>Attach a render:</span>
                  <select
                    onChange={(event) => {
                      const render = renderList.find((item) => item.id === event.target.value);
                      if (render) {
                        store.addItem(project.id, { kind: "output", title: render.name, ref: render.output, assetIds: [render.id] });
                        renders.attachToProject(render, project.id);
                      }
                      event.target.value = "";
                    }}
                    style={{ ...fieldStyle, width: 240 }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Select render…
                    </option>
                    {renderList.map((render) => (
                      <option key={render.id} value={render.id}>
                        {render.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {sketchList.length > 0 ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>Attach a sketch:</span>
                  <select
                    onChange={(event) => {
                      const sketch = sketchList.find((item) => item.id === event.target.value);
                      if (sketch) {
                        store.addItem(project.id, { kind: "sketch", title: sketch.name, assetIds: [sketch.id] });
                      }
                      event.target.value = "";
                    }}
                    style={{ ...fieldStyle, width: 240 }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Select sketch…
                    </option>
                    {sketchList.map((sketch) => (
                      <option key={sketch.id} value={sketch.id}>
                        {sketch.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            {/* items */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
                Items · {project.items.length} {memoryCount !== null ? `· ${memoryCount} local memories available` : ""}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "min(38vh, 340px)", overflowY: "auto" }}>
                {project.items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: "rgba(255,255,255,0.02)",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9.5,
                        borderRadius: 999,
                        padding: "3px 8px",
                        flexShrink: 0,
                        background:
                          item.kind === "render" || item.kind === "output"
                            ? "rgba(167,139,250,0.16)"
                            : item.kind === "note" || item.kind === "memory"
                              ? "rgba(34,211,238,0.14)"
                              : "rgba(255,255,255,0.08)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {PROJECT_ITEM_LABELS[item.kind]}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{item.title}</div>
                      {item.text ? <div style={{ opacity: 0.7, marginTop: 2, overflowWrap: "anywhere" }}>{item.text}</div> : null}
                      {item.kind === "image" && item.ref ? (
                        <img src={item.ref} alt={item.title} style={{ maxWidth: 160, maxHeight: 110, borderRadius: 8, marginTop: 6, objectFit: "cover" }} />
                      ) : null}
                      {item.kind === "render" && item.ref ? (
                        <img src={item.ref} alt={item.title} style={{ maxWidth: 160, maxHeight: 110, borderRadius: 8, marginTop: 6, objectFit: "cover" }} />
                      ) : null}
                      {item.kind === "reference" && item.ref ? (
                        <a href={item.ref} target="_blank" rel="noreferrer" style={{ color: "#9be8ff", fontSize: 11, display: "block", marginTop: 3, overflowWrap: "anywhere" }}>
                          {item.ref}
                        </a>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => store.removeItem(project.id, item.id)} style={{ ...chipButton, fontSize: 10, padding: "3px 8px", color: "#fca5a5", flexShrink: 0 }}>
                      ✕
                    </button>
                  </div>
                ))}
                {project.items.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.55 }}>No items yet — add notes, files, references, sketches, renders or memories.</div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </GenesisWindowFrame>
  );
}
