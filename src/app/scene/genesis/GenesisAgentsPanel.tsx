/**
 * ==========================================================
 * LÉLU
 * GENESIS AGENTS PANEL — the Agents workspace
 *
 * Full agent management over the persistent AgentStore:
 * create (from template or custom), edit, duplicate, archive,
 * enable/pause, assign tools/memory/projects/providers, run
 * agents through the ONE runtime (AgentRunner), and inspect
 * task + execution history.
 * ==========================================================
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import { genesisTheme } from "./GenesisTheme";
import AgentStore from "../../../core/agents/AgentStore";
import AgentRunner from "../../../core/agents/AgentRunner";
import { AGENT_TOOL_LABELS, type AgentTool, type LeluAgent, type AgentMemoryAccess } from "../../../core/agents/AgentTypes";
import ProjectStore from "../../../core/projects/ProjectStore";
import AIService from "../../../core/AIService";

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "white",
  fontSize: 12.5,
  outline: "none",
  fontFamily: "inherit",
};

const labelStyle: CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  opacity: 0.62,
  marginBottom: 4,
  display: "block",
};

const chipButton: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 999,
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "6px 12px",
  fontSize: 11.5,
  cursor: "pointer",
  fontFamily: "inherit",
};

interface GenesisAgentsPanelProps {
  onClose: () => void;
}

export default function GenesisAgentsPanel({ onClose }: GenesisAgentsPanelProps) {
  const store = useMemo(() => AgentStore.getInstance(), []);
  const projects = useMemo(() => ProjectStore.getInstance(), []);
  const runner = useMemo(() => AgentRunner.getInstance(), []);
  const providers = useMemo(
    () => AIService.getInstance().getProviders().ai.map((provider) => provider.name),
    [],
  );

  const [agents, setAgents] = useState<LeluAgent[]>(() => store.list());
  const [selectedId, setSelectedId] = useState<string | null>(() => store.runnable()[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LeluAgent | null>(null);
  const [runPrompt, setRunPrompt] = useState("");
  const [runProject, setRunProject] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState<string | null>(null);

  useEffect(() => {
    return store.subscribe((next) => {
      setAgents(next);
      setSelectedId((current) => (current && next.some((agent) => agent.id === current) ? current : (next[0]?.id ?? null)));
    });
  }, [store]);

  const selected = agents.find((agent) => agent.id === selectedId) ?? null;

  function startEdit(agent: LeluAgent) {
    setDraft(structuredClone(agent));
    setEditing(true);
  }

  function saveDraft() {
    if (!draft) {
      return;
    }
    store.update(draft.id, draft);
    setEditing(false);
  }

  function toggleTool(tool: AgentTool, on: boolean) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const tools = on
        ? current.tools.includes(tool)
          ? current.tools
          : [...current.tools, tool]
        : current.tools.filter((item) => item !== tool);
      return { ...current, tools };
    });
  }

  async function handleRun() {
    if (!selected || !runPrompt.trim()) {
      return;
    }
    setRunning(true);
    setRunOutput(null);
    try {
      const result = await runner.run(selected.id, runPrompt.trim(), runProject || undefined);
      setRunOutput(
        result.ok
          ? `[${result.response?.provider ?? "unknown"} · ${result.response?.model ?? ""}]\n\n${result.response?.text ?? ""}`
          : `Failed: ${result.error ?? "unknown error"}`,
      );
    } finally {
      setRunning(false);
    }
  }

  function renderField(label: string, value: string, onChange: (value: string) => void, textarea = false) {
    return (
      <label style={{ display: "block", marginBottom: 10 }}>
        <span style={labelStyle}>{label}</span>
        {textarea ? (
          <textarea
            rows={3}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.45 }}
          />
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} style={fieldStyle} />
        )}
      </label>
    );
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Orchestration"
      title={<>Agents · {store.runnable().length} runnable</>}
      onClose={onClose}
      width="min(96vw, 1080px)"
      maxHeight="min(90vh, 900px)"
      elevation="focus"
    >
      <div style={{ display: "flex", gap: 14, minHeight: "min(70vh, 640px)" }}>
        {/* ------------------------------------------------ agent list */}
        <div
          style={{
            width: 248,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: "min(70vh, 640px)",
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
            Templates
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {store.templates().map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  const agent = store.createFromTemplate(template.id);
                  setSelectedId(agent.id);
                  startEdit(agent);
                }}
                style={{ ...chipButton, fontSize: 10.5, padding: "5px 10px" }}
              >
                ＋ {template.name}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginTop: 6 }}>
            Your agents
          </div>
          {agents.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.55 }}>No agents yet — create one from a template.</div>
          ) : null}
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                setSelectedId(agent.id);
                setEditing(false);
              }}
              style={{
                textAlign: "left",
                borderRadius: 12,
                padding: "10px 12px",
                border:
                  selectedId === agent.id
                    ? genesisTheme.glass.borderAccent
                    : agent.status === "archived"
                      ? "1px solid rgba(255,255,255,0.06)"
                      : "1px solid rgba(255,255,255,0.1)",
                background: selectedId === agent.id ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.03)",
                color: agent.status === "archived" ? "rgba(160,178,200,0.5)" : "white",
                cursor: "pointer",
                opacity: agent.status === "archived" ? 0.65 : 1,
                width: "100%",
                fontFamily: "inherit",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: agent.status === "archived"
                      ? genesisTheme.status.idle
                      : agent.enabled
                        ? genesisTheme.status.ok
                        : genesisTheme.status.warn,
                    boxShadow: agent.enabled ? `0 0 8px ${genesisTheme.status.ok}` : "none",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{agent.name}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agent.role || "Specialist"}
              </div>
            </button>
          ))}
        </div>

        {/* ------------------------------------------------ detail / form */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {!selected ? (
            <div style={{ fontSize: 12.5, opacity: 0.6 }}>Select or create an agent to configure it.</div>
          ) : editing && draft ? (
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 14,
                padding: 14,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 180 }}>{renderField("Name", draft.name, (v) => setDraft({ ...draft, name: v }))}</div>
                <div style={{ flex: 1, minWidth: 180 }}>{renderField("Role", draft.role, (v) => setDraft({ ...draft, role: v }))}</div>
              </div>
              {renderField("Description", draft.description, (v) => setDraft({ ...draft, description: v }), true)}
              {renderField("Instructions", draft.instructions, (v) => setDraft({ ...draft, instructions: v }), true)}
              {renderField("Personality", draft.personality, (v) => setDraft({ ...draft, personality: v }))}
              {renderField("Capabilities (comma separated)", draft.capabilities.join(", "), (v) =>
                setDraft({ ...draft, capabilities: v.split(",").map((item) => item.trim()).filter(Boolean) }),
              )}
              {renderField("Knowledge (one per line)", draft.knowledge.join("\n"), (v) =>
                setDraft({ ...draft, knowledge: v.split("\n").map((item) => item.trim()).filter(Boolean) }),
              )}

              <div style={{ marginBottom: 10 }}>
                <span style={labelStyle}>Tools</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(Object.keys(AGENT_TOOL_LABELS) as AgentTool[]).map((tool) => {
                    const on = draft.tools.includes(tool);
                    return (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleTool(tool, !on)}
                        style={{
                          ...chipButton,
                          fontSize: 10.5,
                          background: on ? "rgba(34, 211, 238, 0.16)" : "rgba(255,255,255,0.05)",
                          border: on ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.14)",
                        }}
                      >
                        {on ? "✓ " : ""}
                        {AGENT_TOOL_LABELS[tool]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <span style={labelStyle}>Memory access</span>
                  <select
                    value={draft.memoryAccess}
                    onChange={(event) => setDraft({ ...draft, memoryAccess: event.target.value as AgentMemoryAccess })}
                    style={fieldStyle}
                  >
                    <option value="none">None</option>
                    <option value="read">Read</option>
                    <option value="read-write">Read + write</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <span style={labelStyle}>Preferred provider</span>
                  <select
                    value={draft.provider ?? ""}
                    onChange={(event) => setDraft({ ...draft, provider: event.target.value || null })}
                    style={fieldStyle}
                  >
                    <option value="">Default chain</option>
                    {providers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <span style={labelStyle}>Fallback provider</span>
                  <select
                    value={draft.fallbackProvider ?? ""}
                    onChange={(event) => setDraft({ ...draft, fallbackProvider: event.target.value || null })}
                    style={fieldStyle}
                  >
                    <option value="">Default chain</option>
                    {providers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <span style={labelStyle}>Assigned project</span>
                  <select
                    value={draft.projectId ?? ""}
                    onChange={(event) => setDraft({ ...draft, projectId: event.target.value || null })}
                    style={fieldStyle}
                  >
                    <option value="">None</option>
                    {projects.list().map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ margin: "10px 0" }}>
                <span style={labelStyle}>Permissions</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
                  {(
                    [
                      ["canUseTools", "Use tools"],
                      ["canBrowse", "Browse"],
                      ["canWriteMemory", "Write memory"],
                      ["canAccessProjects", "Access projects"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={draft.permissions[key]}
                        onChange={(event) =>
                          setDraft({ ...draft, permissions: { ...draft.permissions, [key]: event.target.checked } })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={saveDraft} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.22)" }}>
                  Save agent
                </button>
                <button type="button" onClick={() => setEditing(false)} style={chipButton}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 14,
                padding: 14,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{selected.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{selected.role}</div>
                  {selected.description ? <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>{selected.description}</div> : null}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => startEdit(selected)} style={chipButton}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const copy = store.duplicate(selected.id);
                      if (copy) {
                        setSelectedId(copy.id);
                        startEdit(copy);
                      }
                    }}
                    style={chipButton}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => store.setEnabled(selected.id, !selected.enabled)}
                    style={chipButton}
                  >
                    {selected.enabled ? "Pause" : "Enable"}
                  </button>
                  {selected.status !== "archived" ? (
                    <button type="button" onClick={() => store.archive(selected.id)} style={chipButton}>
                      Archive
                    </button>
                  ) : null}
                  {selected.status === "archived" ? (
                    <button type="button" onClick={() => store.setStatus(selected.id, "active")} style={chipButton}>
                      Restore
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      store.remove(selected.id);
                      setSelectedId(null);
                    }}
                    style={{ ...chipButton, borderColor: "rgba(248,113,113,0.5)", color: "#fca5a5" }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                {selected.tools.map((tool) => (
                  <span
                    key={tool}
                    style={{
                      fontSize: 10.5,
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 999,
                      padding: "4px 10px",
                      opacity: 0.85,
                    }}
                  >
                    {AGENT_TOOL_LABELS[tool]}
                  </span>
                ))}
                {selected.capabilities.map((capability) => (
                  <span
                    key={capability}
                    style={{ fontSize: 10.5, borderRadius: 999, padding: "4px 10px", background: "rgba(167,139,250,0.14)", opacity: 0.9 }}
                  >
                    {capability}
                  </span>
                ))}
              </div>

              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8, lineHeight: 1.6 }}>
                <div>
                  Memory: <strong>{selected.memoryAccess}</strong> · Provider:{" "}
                  <strong>{selected.provider ?? "default chain"}</strong>
                  {selected.fallbackProvider ? ` · Fallback: ${selected.fallbackProvider}` : ""} · Project:{" "}
                  <strong>{projects.get(selected.projectId ?? "")?.name ?? "none"}</strong>
                </div>
                {selected.instructions ? (
                  <div style={{ marginTop: 8 }}>
                    <div style={labelStyle}>Instructions</div>
                    <div style={{ whiteSpace: "pre-wrap", opacity: 0.9, maxHeight: 110, overflowY: "auto" }}>{selected.instructions}</div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* ---------------------------------------------- run box */}
          {selected ? (
            <div
              style={{
                border: "1px solid rgba(125, 211, 252, 0.28)",
                borderRadius: 14,
                padding: 14,
                background: "rgba(34, 211, 238, 0.06)",
              }}
            >
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.7, marginBottom: 8 }}>
                Run {selected.name}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  value={runPrompt}
                  onChange={(event) => setRunPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !running) {
                      void handleRun();
                    }
                  }}
                  placeholder={`Task for ${selected.name}…`}
                  style={{ ...fieldStyle, flex: 1, minWidth: 220 }}
                />
                <select value={runProject} onChange={(event) => setRunProject(event.target.value)} style={{ ...fieldStyle, width: 170 }}>
                  <option value="">No project</option>
                  {projects.list().map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleRun()}
                  disabled={running || !runPrompt.trim()}
                  style={{
                    ...chipButton,
                    background: "rgba(34, 211, 238, 0.24)",
                    border: "1px solid rgba(125, 211, 252, 0.5)",
                    opacity: running || !runPrompt.trim() ? 0.55 : 1,
                  }}
                >
                  {running ? "Running…" : "Run agent"}
                </button>
              </div>
              {runOutput ? (
                <pre
                  style={{
                    marginTop: 10,
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    lineHeight: 1.55,
                    maxHeight: 180,
                    overflowY: "auto",
                    background: "rgba(2,6,23,0.5)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    padding: 10,
                    fontFamily: "inherit",
                  }}
                >
                  {runOutput}
                </pre>
              ) : null}
            </div>
          ) : null}

          {/* ---------------------------------------------- activity */}
          {selected && selected.executions.length > 0 ? (
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.7, marginBottom: 8 }}>
                Recent executions · {selected.executions.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                {selected.executions.slice(0, 12).map((execution) => (
                  <div
                    key={execution.id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: "rgba(255,255,255,0.03)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600 }}>{execution.prompt.slice(0, 60)}{execution.prompt.length > 60 ? "…" : ""}</span>
                      <span
                        style={{
                          fontSize: 10,
                          borderRadius: 999,
                          padding: "2px 8px",
                          background: execution.offline ? "rgba(250,204,21,0.16)" : "rgba(74,222,128,0.16)",
                        }}
                      >
                        {execution.offline ? "offline" : execution.provider}
                      </span>
                      <span style={{ opacity: 0.5, marginLeft: "auto" }}>
                        {new Date(execution.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ opacity: 0.75, marginTop: 4, maxHeight: 60, overflow: "hidden" }}>{execution.result}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </GenesisWindowFrame>
  );
}
