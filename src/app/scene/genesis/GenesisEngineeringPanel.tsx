/**
 * ==========================================================
 * LÉLU
 * GENESIS ENGINEERING PANEL — the engineering sandbox
 *
 * A safe development workspace confined to the browser:
 * create/read/edit/delete files and directories, generate
 * complete starter projects from templates, and run REAL
 * static analysis (lines, TODOs, function count, brace
 * balance). There is no runtime execution — by design, the
 * sandbox is isolated (autonomy L2). Anything that would need
 * a real runtime is honestly marked as unavailable.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import SandboxFS, { PROJECT_TEMPLATES, type AnalysisResult, type SandboxNode } from "../../../core/engineering/SandboxFS";
import SandboxRuntime, { type SandboxRunResult } from "../../../core/engineering/SandboxRuntime";
import { buildReport, inspectDocument, type VisualReport } from "../../../core/selfdev/VisualInspection";

const labelStyle: CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  opacity: 0.62,
  marginBottom: 4,
  display: "block",
};

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

interface GenesisEngineeringPanelProps {
  onClose: () => void;
}

export default function GenesisEngineeringPanel({ onClose }: GenesisEngineeringPanelProps) {
  const sandbox = useMemo(() => SandboxFS.getInstance(), []);
  const [nodes, setNodes] = useState<SandboxNode[]>(() => sandbox.list());
  const [selected, setSelected] = useState<string | null>(() => sandbox.filePaths()[0] ?? null);
  const [content, setContent] = useState<string>(() => (selected ? sandbox.read(selected) ?? "" : ""));
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [newPath, setNewPath] = useState("");
  const [newContent, setNewContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [templateId, setTemplateId] = useState<string>(PROJECT_TEMPLATES[0]?.id ?? "web");
  const [projectName, setProjectName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sizeKB, setSizeKB] = useState<number>(() => sandbox.sizeKB());
  const [runResult, setRunResult] = useState<SandboxRunResult | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [visualReport, setVisualReport] = useState<VisualReport | null>(null);
  const previewRef = useRef<HTMLIFrameElement | null>(null);

  function refresh(keepSelection = selected) {
    setNodes(sandbox.list());
    setSizeKB(sandbox.sizeKB());
    if (keepSelection && !sandbox.filePaths().includes(keepSelection)) {
      setSelected(sandbox.filePaths()[0] ?? null);
      return;
    }
    if (keepSelection) {
      setSelected(keepSelection);
      setContent(sandbox.read(keepSelection) ?? "");
      setAnalysis(sandbox.analyze(keepSelection));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(path: string) {
    setSelected(path);
    setContent(sandbox.read(path) ?? "");
    setAnalysis(sandbox.analyze(path));
  }

  function saveFile() {
    if (!selected) return;
    const result = sandbox.write(selected, content);
    setNotice(result.ok ? `Saved ${selected}` : `Save failed: ${result.error ?? "unknown error"}`);
    refresh(selected);
  }

  function createFile() {
    const path = newPath.trim().replace(/^\/+/, "");
    if (!path) return;
    const result = sandbox.write(path, newContent || "");
    setNotice(result.ok ? `Created ${path}` : `Create failed: ${result.error ?? "unknown error"}`);
    setNewPath("");
    setNewContent("");
    refresh(path);
  }

  function generate() {
    if (!projectName.trim()) {
      setNotice("Name the project first.");
      return;
    }
    setGenerating(true);
    try {
      const result = sandbox.generateProject(templateId, projectName.trim());
      if (result.ok && result.paths) {
        setNotice(`Generated ${result.paths.length} files for “${projectName.trim()}”.`);
        setProjectName("");
        select(result.paths[0]);
      } else {
        setNotice(`Generation failed: ${result.error ?? "unknown error"}`);
      }
    } finally {
      setGenerating(false);
    }
  }

  function deleteFile(path: string) {
    sandbox.remove(path);
    setNotice(`Deleted ${path}`);
    setSelected(null);
    refresh(null);
  }

  async function runSandbox(action: "run" | "test" | "syntax") {
    setRunBusy(true);
    setRunResult(null);
    try {
      const runtime = SandboxRuntime.getInstance();
      if (action === "run") {
        const file = selected?.endsWith(".js") || selected?.endsWith(".mjs") ? selected : sandbox.filePaths().find((path) => path.endsWith(".js"));
        if (!file) {
          setNotice("No JavaScript file to run — select or create one.");
          return;
        }
        setRunResult(await runtime.runFile(file));
      } else if (action === "test") {
        setRunResult(await runtime.test());
      } else {
        setRunResult(await runtime.syntaxCheck());
      }
    } finally {
      setRunBusy(false);
    }
  }

  async function runPreview() {
    setRunBusy(true);
    setPreviewHtml(null);
    setVisualReport(null);
    try {
      const result = await SandboxRuntime.getInstance().preview();
      setRunResult(result);
      setPreviewHtml(result.previewHtml);
    } finally {
      setRunBusy(false);
    }
  }

  function inspectPreview() {
    const frame = previewRef.current;
    const doc = frame?.contentDocument ?? null;
    if (!doc) {
      return;
    }
    const findings = inspectDocument(doc, { width: frame?.clientWidth ?? 800, height: frame?.clientHeight ?? 600 });
    setVisualReport(buildReport(findings));
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Engineering"
      title="Engineering · sandbox"
      onClose={onClose}
      width="min(96vw, 1120px)"
      maxHeight="min(90vh, 920px)"
      elevation="focus"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* status + honesty note */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 11 }}>
          <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.06)" }}>
            {nodes.filter((node) => node.type === "file").length} files · {sizeKB} KB of {512} KB cap
          </span>
          <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(74, 222, 128, 0.12)", color: "#86efac" }}>
            Real isolated execution — JavaScript runs in a worker (no network, no DOM, no node_modules)
          </span>
        </div>

        {/* project generator */}
        <div style={{ border: "1px solid rgba(125, 211, 252, 0.28)", borderRadius: 14, padding: 12, background: "rgba(34, 211, 238, 0.05)" }}>
          <div style={labelStyle}>Generate a project</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} style={{ ...fieldStyle, width: 150 }}>
              {PROJECT_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") generate();
              }}
              placeholder="Project name, e.g. Copper Hoodie Store"
              style={{ ...fieldStyle, flex: 1, minWidth: 200 }}
            />
            <button type="button" onClick={generate} disabled={generating} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.24)", border: "1px solid rgba(125, 211, 252, 0.5)" }}>
              {generating ? "Generating…" : "Generate"}
            </button>
          </div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6, lineHeight: 1.45 }}>
            {PROJECT_TEMPLATES.find((template) => template.id === templateId)?.description}. Generates a complete,
            runnable starter tree under <code style={{ opacity: 0.9 }}>projects/&lt;name&gt;/</code>.
          </div>
        </div>

        {notice ? (
          <div style={{ fontSize: 11.5, borderRadius: 10, padding: "8px 12px", background: "rgba(34, 211, 238, 0.08)", border: "1px solid rgba(125, 211, 252, 0.25)" }}>
            {notice}
          </div>
        ) : null}

        {/* ---------------- runtime console ---------------- */}
        <div style={{ border: "1px solid rgba(34, 211, 238, 0.24)", borderRadius: 14, padding: 12, background: "rgba(34, 211, 238, 0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={labelStyle}>Sandbox runtime — real execution, isolated</div>
            <button type="button" onClick={() => void runSandbox("run")} disabled={runBusy} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.22)", border: "1px solid rgba(125, 211, 252, 0.5)" }}>
              {runBusy ? "Running…" : "▶ Run file"}
            </button>
            <button type="button" onClick={() => void runSandbox("test")} disabled={runBusy} style={{ ...chipButton }}>
              Run tests
            </button>
            <button type="button" onClick={() => void runSandbox("syntax")} disabled={runBusy} style={{ ...chipButton }}>
              Syntax check
            </button>
            <button type="button" onClick={() => void runPreview()} disabled={runBusy} style={{ ...chipButton }}>
              Preview HTML
            </button>
          </div>

          {runResult ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, marginBottom: 8 }}>
              <span style={{ borderRadius: 999, padding: "3px 10px", background: runResult.ok ? "rgba(74, 222, 128, 0.12)" : "rgba(248, 113, 113, 0.12)", color: runResult.ok ? "#86efac" : "#fca5a5" }}>
                {runResult.timedOut ? "timed out" : runResult.ok ? "ok" : "failed"} · exit {runResult.exitCode}
              </span>
              <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.06)" }}>{runResult.durationMs} ms</span>
              {runResult.tests.length > 0 ? (
                <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.06)" }}>
                  {runResult.tests.filter((test) => test.passed).length}/{runResult.tests.length} tests
                </span>
              ) : null}
            </div>
          ) : null}

          {runResult && (runResult.stdout || runResult.stderr) ? (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.5, maxHeight: 180, overflowY: "auto", background: "rgba(2, 6, 23, 0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 10, fontFamily: "ui-monospace, monospace", margin: 0 }}>
              {runResult.stdout}
              {runResult.stderr ? `\n[stderr]\n${runResult.stderr}` : ""}
            </pre>
          ) : null}

          {previewHtml ? (
            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Visual inspection</span>
                  <button type="button" onClick={inspectPreview} style={{ ...chipButton, padding: "5px 12px", fontSize: 11, background: "rgba(34, 211, 238, 0.2)" }}>
                    Inspect rendered DOM
                  </button>
                </div>
                <iframe
                  ref={previewRef}
                  srcDoc={previewHtml}
                  onLoad={inspectPreview}
                  title="Sandbox preview"
                  sandbox="allow-scripts allow-same-origin allow-modals allow-pointer-lock"
                  style={{ width: "100%", height: 340, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, background: "white" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={labelStyle}>Inspection findings</div>
                {!visualReport ? (
                  <div style={{ fontSize: 11.5, opacity: 0.55 }}>Render a preview, then inspect the DOM for layout problems.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {visualReport.findings.map((finding, index) => (
                      <div key={index} style={{ display: "flex", gap: 8, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, marginTop: 5, background: finding.severity === "error" ? "#f87171" : finding.severity === "warn" ? "#fbbf24" : finding.severity === "info" ? "#67e8f9" : "#34d399" }} />
                        <div style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                          <div>{finding.message}</div>
                          <div style={{ fontSize: 10, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.08em" }}>{finding.category}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 12, minHeight: "min(62vh, 560px)" }}>
          {/* ---------------- file tree ---------------- */}
          <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, maxHeight: "min(62vh, 560px)", overflowY: "auto", paddingRight: 4 }}>
            <div style={labelStyle}>Sandbox files</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createFile();
                }}
                placeholder="src/notes.md"
                style={{ ...fieldStyle, flex: 1, minWidth: 110, padding: "6px 9px", fontSize: 11.5 }}
              />
              <button type="button" onClick={createFile} style={{ ...chipButton, padding: "6px 10px", fontSize: 11 }}>
                New file
              </button>
            </div>
            {newContent ? (
              <textarea
                value={newContent}
                onChange={(event) => setNewContent(event.target.value)}
                placeholder="Initial content (optional)"
                rows={3}
                style={{ ...fieldStyle, resize: "vertical", fontSize: 11.5 }}
              />
            ) : null}
            {nodes.length === 0 ? (
              <div style={{ fontSize: 11.5, opacity: 0.55 }}>Sandbox is empty — generate a project above or create a file.</div>
            ) : null}
            {nodes.map((node) => {
              const depth = node.path.split("/").length - 1;
              return (
                <div key={node.path} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (node.type === "file") select(node.path);
                    }}
                    title={node.path}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      border: selected === node.path && node.type === "file"
                        ? "1px solid rgba(125, 211, 252, 0.45)"
                        : "1px solid rgba(255,255,255,0.09)",
                      borderRadius: 9,
                      background: selected === node.path && node.type === "file" ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.02)",
                      color: node.type === "dir" ? "rgba(186, 230, 253, 0.75)" : "white",
                      padding: "6px 9px",
                      paddingLeft: 9 + depth * 12,
                      fontSize: 11.5,
                      cursor: node.type === "dir" ? "default" : "pointer",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "inherit",
                    }}
                  >
                    {node.type === "dir" ? "▸" : "·"} {node.path}
                  </button>
                  {node.type === "file" ? (
                    <button
                      type="button"
                      onClick={() => deleteFile(node.path)}
                      aria-label={`Delete ${node.path}`}
                      style={{ border: "none", background: "transparent", color: "rgba(248,113,113,0.8)", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Reset the entire sandbox? This deletes every file in it.")) {
                  sandbox.reset();
                  setSelected(null);
                  setContent("");
                  setAnalysis(null);
                  setNotice("Sandbox reset.");
                  refresh(null);
                }
              }}
              style={{ ...chipButton, borderColor: "rgba(248,113,113,0.4)", color: "#fca5a5", marginTop: 4 }}
            >
              Reset sandbox
            </button>
          </div>

          {/* ---------------- editor ---------------- */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {!selected ? (
              <div style={{ fontSize: 12.5, opacity: 0.6, border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 16 }}>
                Select a file to edit it. Files here are isolated to the sandbox — nothing outside this browser is touched.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 120 }}>
                    {selected}
                  </div>
                  {analysis ? (
                    <span style={{ fontSize: 10.5, borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.06)" }}>
                      {analysis.lines} lines · {analysis.todoCount} TODO{analysis.todoCount === 1 ? "" : "s"} · {analysis.functionCount} fn
                    </span>
                  ) : null}
                  <button type="button" onClick={saveFile} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.24)", border: "1px solid rgba(125, 211, 252, 0.5)" }}>
                    Save
                  </button>
                </div>
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 1,
                    minHeight: "min(52vh, 460px)",
                    boxSizing: "border-box",
                    width: "100%",
                    background: "rgba(2, 6, 23, 0.6)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    color: "#dbeafe",
                    fontSize: 12,
                    lineHeight: 1.6,
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    whiteSpace: "pre",
                    overflowWrap: "normal",
                  }}
                />
                {analysis ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10.5 }}>
                    <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.05)" }}>
                      Characters: {analysis.characters}
                    </span>
                    <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.05)" }}>
                      Size: {analysis.sizeKB} KB
                    </span>
                    <span
                      style={{
                        borderRadius: 999,
                        padding: "3px 10px",
                        background: analysis.braceBalance === 0 ? "rgba(74, 222, 128, 0.1)" : "rgba(248, 113, 113, 0.12)",
                        color: analysis.braceBalance === 0 ? "#86efac" : "#fca5a5",
                      }}
                    >
                      {analysis.braceBalance === 0 ? "Braces balanced" : `Braces off by ${analysis.braceBalance}`}
                    </span>
                    <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.05)", opacity: 0.7 }}>
                      Static analysis — run the file in the sandbox runtime above for live output
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </GenesisWindowFrame>
  );
}
