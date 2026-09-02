/**
 * ==========================================================
 * LÉLU
 * GENESIS SELF-DEVELOPMENT PANEL — the Evolution workspace
 *
 * The control surface for the Self-Development Engine:
 *   OVERVIEW      — engine cycle, version, self-tests
 *   ARCHITECTURE  — the machine-readable architecture map
 *   CAPABILITIES  — the capability registry
 *   DIAGNOSTICS   — real system findings
 *   IMPROVEMENTS  — the self-improvement queue + versions/rollback
 *   UI LAB        — design, preview and persist interface candidates
 *   CODE          — inspect real sources, open sandbox working copies,
 *                   build and download candidate patches
 *
 * Everything here observes and proposes (autonomy L0-1). Nothing
 * writes production: development happens in the sandbox.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import GenesisRuntimeUI, { type RuntimeValues } from "./GenesisRuntimeUI";
import ArchitectureMap from "../../../core/selfdev/ArchitectureMap";
import CapabilityRegistry, {
  CAPABILITY_STATUS_LABELS,
  type Capability,
  type CapabilityStatus,
} from "../../../core/selfdev/CapabilityRegistry";
import ImprovementQueue, {
  IMPROVEMENT_STATUSES,
  type ImprovementProposal,
  type ImprovementStatus,
} from "../../../core/selfdev/ImprovementQueue";
import SelfDevelopmentEngine, { type DevelopmentCycleResult } from "../../../core/selfdev/SelfDevelopmentEngine";
import SelfDiagnostics, { type DiagnosticReport } from "../../../core/selfdev/SelfDiagnostics";
import SelfTestRunner, { type TestSuiteResult } from "../../../core/selfdev/SelfTestRunner";
import VersionHistory, { LELU_VERSION, type SandboxSnapshot, type VersionRecord } from "../../../core/selfdev/VersionHistory";
import SelfCode from "../../../core/selfdev/SelfCode";
import UISpecStore, { defaultSpec, validateSpec, type UISpec } from "../../../core/selfdev/UISpec";
import ImprovementPrioritizer from "../../../core/selfdev/ImprovementPrioritizer";
import SelfDevelopmentLoop, { type LoopRunResult } from "../../../core/selfdev/SelfDevelopmentLoop";
import EngineeringMemory, { type EngineeringMemoryEntry } from "../../../core/selfdev/EngineeringMemory";
import SandboxFS from "../../../core/engineering/SandboxFS";
import WorkspaceRuntime, { type EngineeringRuntimeState } from "../../../core/engineering/WorkspaceRuntime";
import AutonomyGate from "../../../core/cognition/AutonomyGate";

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

const STATUS_COLORS: Record<string, string> = {
  Detected: "#94a3b8",
  Analyzing: "#fbbf24",
  Proposed: "#a78bfa",
  Approved: "#34d399",
  "In Development": "#38bdf8",
  Testing: "#22d3ee",
  Evaluation: "#f472b6",
  Ready: "#34d399",
  Integrated: "#34d399",
  Rejected: "#f87171",
  "Rolled Back": "#f87171",
};

type Tab = "overview" | "architecture" | "capabilities" | "diagnostics" | "improvements" | "uilab" | "code";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "capabilities", label: "Capabilities" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "improvements", label: "Improvements" },
  { id: "uilab", label: "UI Lab" },
  { id: "code", label: "Code" },
];

interface GenesisSelfDevPanelProps {
  onClose: () => void;
}

export default function GenesisSelfDevPanel({ onClose }: GenesisSelfDevPanelProps) {
  const map = useMemo(() => ArchitectureMap.getInstance(), []);
  const registry = useMemo(() => CapabilityRegistry.getInstance(), []);
  const queue = useMemo(() => ImprovementQueue.getInstance(), []);
  const engine = useMemo(() => SelfDevelopmentEngine.getInstance(), []);
  const diagnostics = useMemo(() => SelfDiagnostics.getInstance(), []);
  const tests = useMemo(() => SelfTestRunner.getInstance(), []);
  const versions = useMemo(() => VersionHistory.getInstance(), []);
  const selfCode = useMemo(() => SelfCode.getInstance(), []);
  const uiStore = useMemo(() => UISpecStore.getInstance(), []);
  const sandbox = useMemo(() => SandboxFS.getInstance(), []);
  const prioritizer = useMemo(() => ImprovementPrioritizer.getInstance(), []);
  const loop = useMemo(() => SelfDevelopmentLoop.getInstance(), []);
  const memory = useMemo(() => EngineeringMemory.getInstance(), []);

  const [tab, setTab] = useState<Tab>("overview");
  const [cycle, setCycle] = useState<DevelopmentCycleResult | null>(() => engine.getLastResult());
  const [report, setReport] = useState<DiagnosticReport | null>(() => diagnostics.getLastReport());
  const [suite, setSuite] = useState<TestSuiteResult | null>(() => tests.getLastResult());
  const [capabilities, setCapabilities] = useState<Capability[]>(() => registry.list());
  const [proposals, setProposals] = useState<ImprovementProposal[]>(() => queue.list());
  const [versionList, setVersionList] = useState<VersionRecord[]>(() => versions.listVersions());
  const [snapshots, setSnapshots] = useState<SandboxSnapshot[]>(() => versions.listSnapshots());
  const [specs, setSpecs] = useState<UISpec[]>(() => uiStore.list());
  const [running, setRunning] = useState(false);
  const [lastLoopRun, setLastLoopRun] = useState<LoopRunResult | null>(() => loop.getLastRun());
  const [memoryEntries, setMemoryEntries] = useState<EngineeringMemoryEntry[]>(() => memory.list());

  const refresh = useCallback(() => {
    setCapabilities(registry.list());
    setProposals(queue.list());
    setVersionList(versions.listVersions());
    setSnapshots(versions.listSnapshots());
    setSpecs(uiStore.list());
    setMemoryEntries(memory.list());
  }, [queue, registry, uiStore, versions, memory]);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function runCycle() {
    setRunning(true);
    try {
      const result = await engine.runCycle();
      setCycle(result);
      setReport(result.diagnostics);
      refresh();
    } finally {
      setRunning(false);
    }
  }

  async function runTests() {
    setRunning(true);
    try {
      setSuite(await tests.run());
    } finally {
      setRunning(false);
    }
  }

  const [autonomyLevel, setAutonomyLevel] = useState(AutonomyGate.getInstance().getLevel());
  const autonomy = autonomyLevel;
  const [runtimeState, setRuntimeState] = useState<EngineeringRuntimeState>(() =>
    WorkspaceRuntime.getInstance().getRuntimeState(),
  );

  useEffect(() => {
    void WorkspaceRuntime.getInstance().probe().then(setRuntimeState);
  }, []);

  async function developProposal(proposalId: string) {
    setRunning(true);
    try {
      // REAL workspace verification when the configured autonomy level
      // permits it (L3+); otherwise the loop honestly skips it.
      const runTypecheck = WorkspaceRuntime.getInstance().allowed("typecheck");
      setLastLoopRun(await loop.develop(proposalId, { runWorkspaceTypecheck: runTypecheck }));
    } finally {
      setRunning(false);
      refresh();
    }
  }

  function integrateProposal(proposalId: string) {
    setLastLoopRun(loop.integrate(proposalId));
    refresh();
  }

  // The REAL write-to-production path: applies the candidate working
  // copy to the actual workspace source via /api/engineer/write, runs
  // the real typecheck, and rolls back automatically on failure. Gated
  // at autonomy L5 — the user raises the level explicitly below.
  async function applyProposal(proposalId: string) {
    setRunning(true);
    try {
      setLastLoopRun(await loop.applyCandidate(proposalId, { approved: true }));
    } finally {
      setRunning(false);
      refresh();
    }
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Self-Development"
      title={<>Evolution · v{LELU_VERSION} · autonomy L{autonomy}</>}
      onClose={onClose}
      width="min(96vw, 1140px)"
      maxHeight="min(92vh, 940px)"
      elevation="focus"
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={tab === item.id ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
            style={{ borderRadius: 999, padding: "7px 14px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            {item.label}
            {item.id === "improvements" ? ` · ${queue.open().length}` : ""}
            {item.id === "diagnostics" && report ? ` · ${report.summary.error + report.summary.warn}` : ""}
          </button>
        ))}
      </div>

      <div style={{ maxHeight: "min(76vh, 760px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* ============================ OVERVIEW */}
        {tab === "overview" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void runCycle()} disabled={running} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.22)", border: "1px solid rgba(125, 211, 252, 0.5)" }}>
                {running ? "Running…" : "Run observe + diagnose cycle"}
              </button>
              <button type="button" onClick={() => void runTests()} disabled={running} style={{ ...chipButton, background: "rgba(167, 139, 250, 0.2)", border: "1px solid rgba(196, 181, 253, 0.45)" }}>
                {running ? "Testing…" : `Run self-test suite${suite ? ` · last ${suite.summary.passed}/${suite.summary.total}` : ""}`}
              </button>
            </div>

            {/* Engineering runtime — which runtime is actually serving the app */}
            <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
              <div style={labelStyle}>Engineering runtime — where real writes + verification execute</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
                <span
                  style={{
                    borderRadius: 999,
                    padding: "3px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                      runtimeState.available
                        ? "rgba(74, 222, 128, 0.16)"
                        : "rgba(250, 204, 21, 0.14)",
                    color: runtimeState.available ? "#86efac" : "#fde68a",
                    border: `1px solid ${runtimeState.available ? "rgba(74,222,128,0.4)" : "rgba(250,204,21,0.35)"}`,
                  }}
                >
                  {runtimeState.available
                    ? runtimeState.runtime === "server"
                      ? "SERVER-BACKED · /api/engineer live"
                      : "DEV SERVER · /api/engineer live"
                    : "STATIC-ONLY · /api/engineer not reachable"}
                </span>
                <span style={{ opacity: 0.7 }}>
                  {runtimeState.available
                    ? `Operations: ${runtimeState.operations.length > 0 ? runtimeState.operations.join(", ") : "…"}`
                    : runtimeState.error ?? ""}
                </span>
                {runtimeState.tokenRequired ? (
                  <span style={{ color: "#fde68a", fontSize: 11 }}>Token required (LELU_ENGINEER_TOKEN)</span>
                ) : null}
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
                The engineering runtime is served by the same process that serves the app — Vite dev/preview, the
                standalone runtime server (bun run serve), or the Deno production entry. When it is live, Develop can
                run the real workspace typecheck and Apply can write verified candidates to source with automatic
                rollback. When it is unreachable (static-only hosting), those steps honestly report unavailable and
                the in-browser sandbox remains the offline development surface.
              </div>
            </div>

            {/* Autonomy — explicit authorization for real execution */}
            <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
              <div style={labelStyle}>Autonomy level — what LÉLU is allowed to actually do</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[0, 1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => {
                      AutonomyGate.getInstance().setLevel(level);
                      setAutonomyLevel(level);
                    }}
                    style={{
                      ...chipButton,
                      padding: "6px 12px",
                      fontSize: 11,
                      background: autonomyLevel === level ? "rgba(34,211,238,0.25)" : "rgba(255,255,255,0.04)",
                      border: autonomyLevel === level ? "1px solid rgba(125,211,252,0.6)" : "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    L{level} <span style={{ opacity: 0.6 }}>· {AutonomyGate.getInstance().levelInfo(level).label}</span>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
                {AutonomyGate.getInstance().levelInfo(autonomyLevel).description} — sandbox development runs at L2;
                workspace typecheck (L3) and applying candidates to real source with verify + rollback (L5) require
                raising the level here. Every Apply action also asks the loop for explicit approval.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
              {(
                [
                  ["LÉLU version", LELU_VERSION],
                  ["Autonomy level", `L${autonomy} — ${AutonomyGate.getInstance().levelInfo(autonomy).label}`],
                  ["Cycle", String(cycle?.cycle ?? engine.getLastResult()?.cycle ?? 0)],
                  ["Capabilities available", String(registry.availableCount())],
                  ["Capabilities partial/planned", String(registry.partial().length + registry.lacking().length)],
                  ["Open improvement proposals", String(queue.open().length)],
                  ["Real source files", String(map.allSourceFiles().length)],
                  ["Mapped subsystems", String(map.list().length)],
                  ["Sandbox size", `${sandbox.sizeKB()} KB / 512 KB`],
                  ["Self-tests", suite ? `${suite.summary.passed}/${suite.summary.total} passing` : "not run yet"],
                  ["Diagnostics", report ? (report.healthy ? "healthy" : `${report.summary.error} error(s), ${report.summary.warn} warn(s)`) : "not run yet"],
                  ["Version records", String(versionList.length)],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: "10px 12px" }}>
                  <div style={labelStyle}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11.5, opacity: 0.75, lineHeight: 1.6, border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
              <strong>How self-development works here:</strong> the engine observes real state (diagnostics, architecture map,
              capability registry) and proposes improvements into the queue. Approved proposals are implemented in the sandbox
              working copies, run through the real workspace typecheck (L3+), snapshotted for rollback, and exported as
              candidate patches.              The route to production runs through an explicit approval boundary: raise autonomy to L5 and
              press <strong>Apply to workspace</strong> — that writes the candidate to real source through the engineering
              runtime (/api/engineer/write, available in dev and in the server-backed runtime), re-runs the real workspace
              typecheck, and rolls back automatically if verification fails. The status you see comes
              from that execution result, never from the button press.
            </div>

            {cycle ? (
              <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
                <div style={labelStyle}>Last development cycle · {new Date(cycle.updatedAt).toLocaleTimeString()}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  <div>Diagnostics: {cycle.diagnostics.summary.ok} ok · {cycle.diagnostics.summary.info} info · {cycle.diagnostics.summary.warn} warn · {cycle.diagnostics.summary.error} error</div>
                  {cycle.proposals.length > 0 ? (
                    <div>
                      Proposals created:{" "}
                      {cycle.proposals.map((proposal) => (
                        <span key={proposal} style={{ marginRight: 6, fontSize: 11, borderRadius: 999, padding: "2px 8px", background: "rgba(167, 139, 250, 0.14)" }}>
                          {proposal.slice(0, 48)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ opacity: 0.6 }}>No new proposals this cycle — queue is current.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ============================ ARCHITECTURE */}
        {tab === "architecture" ? (
          <ArchitectureTab map={map} />
        ) : null}

        {/* ============================ CAPABILITIES */}
        {tab === "capabilities" ? (
          <CapabilitiesTab capabilities={capabilities} registry={registry} refresh={refresh} />
        ) : null}

        {/* ============================ DIAGNOSTICS */}
        {tab === "diagnostics" ? (
          <DiagnosticsTab report={report} onRun={() => void runCycle()} running={running} />
        ) : null}

        {/* ============================ IMPROVEMENTS */}
        {tab === "improvements" ? (
          <ImprovementsTab
            proposals={proposals}
            queue={queue}
            versions={versions}
            versionList={versionList}
            snapshots={snapshots}
            refresh={refresh}
            onTests={() => void runTests()}
            suite={suite}
            prioritizer={prioritizer}
            lastLoopRun={lastLoopRun}
            memoryEntries={memoryEntries}
            onDevelop={(id) => void developProposal(id)}
            onIntegrate={integrateProposal}
            onApply={(id) => void applyProposal(id)}
          />
        ) : null}

        {/* ============================ UI LAB */}
        {tab === "uilab" ? (
          <UILabTab specs={specs} uiStore={uiStore} refresh={refresh} />
        ) : null}

        {/* ============================ CODE */}
        {tab === "code" ? (
          <CodeTab selfCode={selfCode} refresh={refresh} />
        ) : null}
      </div>
    </GenesisWindowFrame>
  );
}

/* ================================================================== */
/* ARCHITECTURE TAB                                                    */
/* ================================================================== */
function ArchitectureTab({ map }: { map: ArchitectureMap }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sourceCount, setSourceCount] = useState(0);

  useEffect(() => {
    setSourceCount(map.allSourceFiles().length);
  }, [map]);

  const subsystems = map.list().filter((subsystem) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      subsystem.name.toLowerCase().includes(q) ||
      subsystem.id.toLowerCase().includes(q) ||
      subsystem.provides.some((capability) => capability.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search subsystems by name, id or capability…"
          style={{ ...fieldStyle, flex: 1, minWidth: 220 }}
        />
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          {map.list().length} subsystems · {sourceCount} real source files · {map.countFiles()} curated paths
        </span>
      </div>
      {subsystems.map((subsystem) => {
        const open = expanded === subsystem.id;
        return (
          <div key={subsystem.id} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
            <button
              type="button"
              onClick={() => setExpanded(open ? null : subsystem.id)}
              style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", color: "white", cursor: "pointer", fontFamily: "inherit" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{subsystem.name}</span>
                <span style={{ fontSize: 10, borderRadius: 999, padding: "2px 8px", background: subsystem.status === "working" ? "rgba(74, 222, 128, 0.14)" : subsystem.status === "partial" ? "rgba(250, 204, 21, 0.14)" : "rgba(167, 139, 250, 0.14)", color: subsystem.status === "working" ? "#86efac" : subsystem.status === "partial" ? "#fde68a" : "#c4b5fd" }}>
                  {subsystem.status}
                </span>
                <span style={{ fontSize: 10.5, opacity: 0.55 }}>{subsystem.kind}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>{subsystem.files.length} file(s) · {open ? "▾" : "▸"}</span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{subsystem.description}</div>
            </button>
            {open ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, fontSize: 11.5 }}>
                <div>
                  <span style={labelStyle}>Provides capabilities</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {subsystem.provides.map((capability) => (
                      <span key={capability} style={{ fontSize: 10.5, borderRadius: 999, padding: "2px 9px", background: "rgba(34, 211, 238, 0.1)" }}>
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span style={labelStyle}>Depends on</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {subsystem.dependsOn.length === 0 ? <span style={{ opacity: 0.5 }}>nothing</span> : null}
                    {subsystem.dependsOn.map((dependency) => (
                      <span key={dependency} style={{ fontSize: 10.5, borderRadius: 999, padding: "2px 9px", background: "rgba(148, 163, 184, 0.12)" }}>
                        {dependency}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span style={labelStyle}>Files</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {subsystem.files.map((file) => (
                      <div key={file} style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, opacity: 0.8 }}>
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/* CAPABILITIES TAB                                                    */
/* ================================================================== */
function CapabilitiesTab({
  capabilities,
  registry,
  refresh,
}: {
  capabilities: Capability[];
  registry: CapabilityRegistry;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState({ name: "", description: "", status: "planned" as CapabilityStatus });
  const counts = registry.statusCounts();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {(Object.keys(counts) as CapabilityStatus[]).map((status) => (
          <span key={status} style={{ fontSize: 10.5, borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.06)" }}>
            {CAPABILITY_STATUS_LABELS[status]}: {counts[status]}
          </span>
        ))}
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
        <div style={labelStyle}>Add capability</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Name" style={{ ...fieldStyle, flex: 1, minWidth: 150 }} />
          <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" style={{ ...fieldStyle, flex: 2, minWidth: 200 }} />
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CapabilityStatus })} style={{ ...fieldStyle, width: 150 }}>
            {(Object.keys(CAPABILITY_STATUS_LABELS) as CapabilityStatus[]).map((status) => (
              <option key={status} value={status}>
                {CAPABILITY_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              if (!draft.name.trim()) return;
              registry.add({ ...draft, name: draft.name.trim(), description: draft.description.trim(), requiredTools: [], requiredProviders: [], requiredAgents: [], requiredKnowledge: [], dependencies: [], tests: [], limitations: [], version: "1.0" });
              setDraft({ name: "", description: "", status: "planned" });
              refresh();
            }}
            style={{ ...chipButton, background: "rgba(34, 211, 238, 0.2)" }}
          >
            Add
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
        {capabilities.map((capability) => (
          <div key={capability.id} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{capability.name}</span>
              <select
                value={capability.status}
                onChange={(event) => {
                  registry.update(capability.id, { status: event.target.value as CapabilityStatus });
                  refresh();
                }}
                style={{ ...fieldStyle, width: 150, padding: "4px 8px", fontSize: 11 }}
              >
                {(Object.keys(CAPABILITY_STATUS_LABELS) as CapabilityStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {CAPABILITY_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.75, lineHeight: 1.45 }}>{capability.description}</div>
            {capability.limitations.length > 0 ? (
              <div style={{ fontSize: 10.5, opacity: 0.6, lineHeight: 1.4 }}>
                <strong>Limitations:</strong> {capability.limitations.join("; ")}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {capability.dependencies.map((dependency) => (
                <span key={dependency} style={{ fontSize: 10, borderRadius: 999, padding: "2px 8px", background: "rgba(148, 163, 184, 0.12)" }}>
                  {dependency}
                </span>
              ))}
              {capability.requiredProviders.map((provider) => (
                <span key={provider} style={{ fontSize: 10, borderRadius: 999, padding: "2px 8px", background: "rgba(250, 204, 21, 0.12)" }}>
                  {provider}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                registry.remove(capability.id);
                refresh();
              }}
              style={{ ...chipButton, alignSelf: "flex-start", padding: "4px 10px", fontSize: 10.5, borderColor: "rgba(248,113,113,0.4)", color: "#fca5a5" }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/* DIAGNOSTICS TAB                                                     */
/* ================================================================== */
function DiagnosticsTab({
  report,
  onRun,
  running,
}: {
  report: DiagnosticReport | null;
  onRun: () => void;
  running: boolean;
}) {
  const severities = ["error", "warn", "info", "ok"] as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={onRun} disabled={running} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.22)", border: "1px solid rgba(125, 211, 252, 0.5)" }}>
          {running ? "Diagnosing…" : "Run diagnostics"}
        </button>
        {report ? (
          <span style={{ fontSize: 11.5, opacity: 0.8 }}>
            Last run {new Date(report.updatedAt).toLocaleTimeString()} ·{" "}
            {report.summary.error} error · {report.summary.warn} warn · {report.summary.info} info · {report.summary.ok} ok
            {report.healthy ? " · healthy" : ""}
          </span>
        ) : null}
      </div>
      {!report ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>No diagnostics run yet — press “Run diagnostics” (or run a cycle in Overview).</div>
      ) : (
        severities.map((severity) => {
          const findings = report.findings.filter((finding) => finding.severity === severity);
          if (findings.length === 0) return null;
          return (
            <div key={severity}>
              <div style={{ ...labelStyle, color: severity === "error" ? "#fca5a5" : severity === "warn" ? "#fde68a" : undefined }}>
                {severity.toUpperCase()} · {findings.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {findings.map((finding) => (
                  <div key={finding.id} style={{ display: "flex", gap: 8, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        flexShrink: 0,
                        marginTop: 5,
                        background: severity === "error" ? "#f87171" : severity === "warn" ? "#fbbf24" : severity === "info" ? "#67e8f9" : "#34d399",
                        boxShadow: "0 0 6px currentColor",
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12 }}>{finding.message}</div>
                      <div style={{ fontSize: 10.5, opacity: 0.55, fontFamily: "ui-monospace, monospace" }}>{finding.evidence}</div>
                    </div>
                    <span style={{ fontSize: 10, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.1em", alignSelf: "flex-start" }}>
                      {finding.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ================================================================== */
/* IMPROVEMENTS TAB                                                    */
/* ================================================================== */
function ImprovementsTab({
  proposals,
  queue,
  versions,
  versionList,
  snapshots,
  refresh,
  onTests,
  suite,
  prioritizer,
  lastLoopRun,
  memoryEntries,
  onDevelop,
  onIntegrate,
  onApply,
}: {
  proposals: ImprovementProposal[];
  queue: ImprovementQueue;
  versions: VersionHistory;
  versionList: VersionRecord[];
  snapshots: SandboxSnapshot[];
  refresh: () => void;
  onTests: () => void;
  suite: TestSuiteResult | null;
  prioritizer: ImprovementPrioritizer;
  lastLoopRun: LoopRunResult | null;
  memoryEntries: EngineeringMemoryEntry[];
  onDevelop: (id: string) => void;
  onIntegrate: (id: string) => void;
  onApply: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newProposal, setNewProposal] = useState({ title: "", problem: "", kind: "Opportunity" as ImprovementProposal["kind"], complexity: "medium" as ImprovementProposal["complexity"] });

  function addProposal() {
    if (!newProposal.title.trim()) return;
    queue.add({
      title: newProposal.title.trim(),
      problem: newProposal.problem.trim() || "—",
      observation: "Manually added in the Evolution workspace.",
      evidence: "user",
      proposedSolution: "To be designed.",
      expectedBenefit: "To be evaluated.",
      dependencies: [],
      risk: "Unknown until analyzed.",
      requiredTools: ["sandbox"],
      requiredAgents: ["Engineering Agent"],
      complexity: newProposal.complexity,
      kind: newProposal.kind,
      version: "1.0",
      testPlan: "To be defined.",
    });
    setNewProposal({ title: "", problem: "", kind: "Opportunity", complexity: "medium" });
    refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={onTests} style={{ ...chipButton, background: "rgba(167, 139, 250, 0.2)", border: "1px solid rgba(196, 181, 253, 0.45)" }}>
          Run self-test suite{suite ? ` · ${suite.summary.passed}/${suite.summary.total}` : ""}
        </button>
        {suite && !suite.healthy ? (
          <span style={{ fontSize: 11.5, color: "#fca5a5" }}>Failing tests — no proposal should be marked Ready while the suite fails.</span>
        ) : null}
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
        <div style={labelStyle}>New proposal</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={newProposal.title} onChange={(event) => setNewProposal({ ...newProposal, title: event.target.value })} placeholder="Title" style={{ ...fieldStyle, flex: 2, minWidth: 180 }} />
          <input value={newProposal.problem} onChange={(event) => setNewProposal({ ...newProposal, problem: event.target.value })} placeholder="Problem / observation" style={{ ...fieldStyle, flex: 3, minWidth: 200 }} />
          <select value={newProposal.kind} onChange={(event) => setNewProposal({ ...newProposal, kind: event.target.value as ImprovementProposal["kind"] })} style={{ ...fieldStyle, width: 140 }}>
            {["Bug", "Limitation", "Optimization", "New Capability", "Experiment", "Opportunity"].map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <select value={newProposal.complexity} onChange={(event) => setNewProposal({ ...newProposal, complexity: event.target.value as ImprovementProposal["complexity"] })} style={{ ...fieldStyle, width: 110 }}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button type="button" onClick={addProposal} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.2)" }}>
            Add
          </button>
        </div>
      </div>

      {proposals.map((proposal) => {
        const open = expandedId === proposal.id;
        const priority = prioritizer.prioritize(proposal);
        return (
          <div key={proposal.id} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_COLORS[proposal.status] ?? "#94a3b8", boxShadow: `0 0 6px ${STATUS_COLORS[proposal.status] ?? "#94a3b8"}`, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 160 }}>{proposal.title}</span>
              <span
                title={priority.explanation}
                style={{
                  fontSize: 10,
                  borderRadius: 999,
                  padding: "2px 8px",
                  background: priority.level === "high" || priority.level === "critical" ? "rgba(34, 211, 238, 0.14)" : priority.level === "medium" ? "rgba(167, 139, 250, 0.14)" : "rgba(148, 163, 184, 0.14)",
                  color: priority.level === "high" || priority.level === "critical" ? "#67e8f9" : undefined,
                }}
              >
                priority {priority.score}
              </span>
              <span style={{ fontSize: 10, borderRadius: 999, padding: "2px 8px", background: "rgba(167, 139, 250, 0.14)" }}>{proposal.kind}</span>
              <span style={{ fontSize: 10, borderRadius: 999, padding: "2px 8px", background: "rgba(148, 163, 184, 0.14)" }}>{proposal.complexity}</span>
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 5 }}>{proposal.problem}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={proposal.status}
                onChange={(event) => {
                  queue.setStatus(proposal.id, event.target.value as ImprovementStatus);
                  refresh();
                }}
                style={{ ...fieldStyle, width: 150, padding: "5px 8px", fontSize: 11 }}
              >
                {IMPROVEMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              {proposal.status === "Approved" || proposal.status === "Testing" ? (
                <button type="button" onClick={() => onDevelop(proposal.id)} style={{ ...chipButton, padding: "5px 12px", fontSize: 11, background: "rgba(34, 211, 238, 0.2)" }}>
                  Develop — run + test
                </button>
              ) : null}
              {proposal.status === "Ready" ? (
                <>
                  <button
                    type="button"
                    onClick={() => onApply(proposal.id)}
                    title="Writes the candidate to real source via /api/engineer/write, re-runs the workspace typecheck, and rolls back automatically on failure. Requires autonomy L5."
                    style={{ ...chipButton, padding: "5px 12px", fontSize: 11, background: "rgba(34, 211, 238, 0.22)", border: "1px solid rgba(125, 211, 252, 0.55)" }}
                  >
                    Apply to workspace — write + verify + rollback
                  </button>
                  <button type="button" onClick={() => onIntegrate(proposal.id)} style={{ ...chipButton, padding: "5px 12px", fontSize: 11, background: "rgba(74, 222, 128, 0.2)", border: "1px solid rgba(74, 222, 128, 0.5)" }}>
                    Integrate (record result)
                  </button>
                </>
              ) : null}
              <button type="button" onClick={() => setExpandedId(open ? null : proposal.id)} style={{ ...chipButton, padding: "5px 12px", fontSize: 11 }}>
                {open ? "Hide details" : "Details"}
              </button>
              <button type="button" onClick={() => { queue.remove(proposal.id); refresh(); }} style={{ ...chipButton, padding: "5px 12px", fontSize: 11, borderColor: "rgba(248,113,113,0.4)", color: "#fca5a5", marginLeft: "auto" }}>
                Delete
              </button>
            </div>
            {open ? (
              <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 5 }}>
                <div><strong>Observation:</strong> {proposal.observation}</div>
                <div><strong>Evidence:</strong> <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5 }}>{proposal.evidence}</span></div>
                <div><strong>Proposed solution:</strong> {proposal.proposedSolution}</div>
                <div><strong>Expected benefit:</strong> {proposal.expectedBenefit}</div>
                <div><strong>Risk:</strong> {proposal.risk}</div>
                <div><strong>Test plan:</strong> {proposal.testPlan}</div>
                <div><strong>Version:</strong> {proposal.version} · dependencies: {proposal.dependencies.join(", ") || "none"}</div>
                {proposal.candidateSnapshotId ? <div><strong>Candidate snapshot:</strong> {proposal.candidateSnapshotId}</div> : null}
              </div>
            ) : null}
          </div>
        );
      })}

      {lastLoopRun ? (
        <div style={{ border: "1px solid rgba(34, 211, 238, 0.2)", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={labelStyle}>Last development loop · {lastLoopRun.title}</div>
            <span style={{ fontSize: 10, borderRadius: 999, padding: "2px 10px", background: lastLoopRun.success ? "rgba(74, 222, 128, 0.14)" : "rgba(248, 113, 113, 0.14)", color: lastLoopRun.success ? "#86efac" : "#fca5a5" }}>
              {lastLoopRun.finalStatus}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {lastLoopRun.steps.map((step) => (
              <div key={step.step} style={{ display: "flex", gap: 8, fontSize: 11.5, fontFamily: "ui-monospace, monospace" }}>
                <span style={{ color: step.status === "done" ? "#86efac" : step.status === "failed" ? "#fca5a5" : step.status === "skipped" ? "#94a3b8" : "#67e8f9", width: 12 }}>
                  {step.status === "done" ? "✓" : step.status === "failed" ? "✗" : step.status === "skipped" ? "·" : "▸"}
                </span>
                <span style={{ opacity: 0.85, minWidth: 80 }}>{step.step}</span>
                <span style={{ opacity: 0.6 }}>{step.detail}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.7, marginTop: 6 }}>{lastLoopRun.summary}</div>
        </div>
      ) : null}

      <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
        <div style={labelStyle}>Engineering memory · {memoryEntries.length} record(s)</div>
        {memoryEntries.length === 0 ? (
          <div style={{ fontSize: 11.5, opacity: 0.55 }}>No engineering records yet — development attempts, upgrades, rollbacks and lessons land here.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {memoryEntries.slice(0, 10).map((entry) => (
              <div key={entry.id} style={{ display: "flex", gap: 8, fontSize: 11.5, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "6px 10px", background: "rgba(255,255,255,0.02)", flexWrap: "wrap" }}>
                <span style={{ color: entry.outcome === "success" ? "#86efac" : entry.outcome === "failure" ? "#fca5a5" : "#94a3b8" }}>{entry.outcome}</span>
                <span style={{ opacity: 0.85 }}>{entry.summary}</span>
                <span style={{ marginLeft: "auto", opacity: 0.5, fontSize: 10 }}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
        <div style={labelStyle}>Version records · {versionList.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {versionList.length === 0 ? <div style={{ fontSize: 11.5, opacity: 0.55 }}>No versions recorded yet — approve a proposal to start development.</div> : null}
          {versionList.map((record) => (
            <div key={record.id} style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "8px 10px", fontSize: 11.5, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong>v{record.version}</strong>
                <span style={{ flex: 1, minWidth: 120 }}>{record.changeDescription}</span>
                <span style={{ opacity: 0.55 }}>{new Date(record.createdAt).toLocaleString()}</span>
              </div>
              {record.results ? <div style={{ opacity: 0.7, marginTop: 3 }}>Results: {record.results}</div> : null}
            </div>
          ))}
        </div>
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
        <div style={labelStyle}>Sandbox snapshots · {snapshots.length} (rollback points)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {snapshots.length === 0 ? <div style={{ fontSize: 11.5, opacity: 0.55 }}>No snapshots yet — they are created when development starts.</div> : null}
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} style={{ display: "flex", gap: 8, alignItems: "center", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "8px 10px", fontSize: 11.5, background: "rgba(255,255,255,0.02)", flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 140 }}>{snapshot.label}</span>
              <span style={{ opacity: 0.55 }}>{Object.keys(snapshot.files).length} file(s) · {new Date(snapshot.createdAt).toLocaleString()}</span>
              <button
                type="button"
                onClick={() => {
                  const result = versions.rollback(snapshot.id);
                  window.alert(result.ok ? `Sandbox rolled back to “${snapshot.label}”.` : `Rollback failed: ${result.error}`);
                  refresh();
                }}
                style={{ ...chipButton, padding: "4px 10px", fontSize: 10.5, borderColor: "rgba(248,113,113,0.4)", color: "#fca5a5" }}
              >
                Rollback sandbox
              </button>
              <button
                type="button"
                onClick={() => { versions.removeSnapshot(snapshot.id); refresh(); }}
                style={{ ...chipButton, padding: "4px 10px", fontSize: 10.5 }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* UI LAB TAB                                                          */
/* ================================================================== */
function UILabTab({ specs, uiStore, refresh }: { specs: UISpec[]; uiStore: UISpecStore; refresh: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(() => specs[0]?.id ?? null);
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);

  const selected = specs.find((spec) => spec.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setJson(JSON.stringify({ name: selected.name, description: selected.description, version: selected.version, sections: selected.sections }, null, 2));
      setJsonError(null);
    } else {
      setJson("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function createNew() {
    const draft = defaultSpec();
    draft.name = `Interface ${specs.length + 1}`;
    const spec = uiStore.create(draft);
    setSelectedId(spec.id);
    refresh();
  }

  function saveFromJson() {
    if (!selected) return;
    setJsonError(null);
    try {
      const parsed = JSON.parse(json) as Omit<UISpec, "id" | "createdAt" | "updatedAt">;
      const problems = validateSpec(parsed);
      if (problems.length > 0) {
        setJsonError(problems.join(" · "));
        return;
      }
      uiStore.update(selected.id, parsed);
      setActionLog((current) => [`Saved “${parsed.name}” (${new Date().toLocaleTimeString()})`, ...current].slice(0, 6));
      refresh();
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON");
    }
  }

  const handleAction = (key: string, values: RuntimeValues) => {
    setActionLog((current) => [`Action "${key}" fired with ${JSON.stringify(values)}`, ...current].slice(0, 6));
  };

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {/* spec list */}
      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <button type="button" onClick={createNew} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.2)", border: "1px solid rgba(125, 211, 252, 0.5)" }}>
          ＋ New interface spec
        </button>
        {specs.length === 0 ? <div style={{ fontSize: 11.5, opacity: 0.55 }}>No specs yet — create one and design it in JSON.</div> : null}
        {specs.map((spec) => (
          <button
            key={spec.id}
            type="button"
            onClick={() => setSelectedId(spec.id)}
            style={{
              textAlign: "left",
              border: selectedId === spec.id ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.09)",
              borderRadius: 10,
              padding: "8px 10px",
              background: selectedId === spec.id ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.02)",
              color: "white",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          >
            <div style={{ fontWeight: 600 }}>{spec.name}</div>
            <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 2 }}>v{spec.version} · {spec.sections.length} section(s)</div>
          </button>
        ))}
      </div>

      {/* editor + preview */}
      {selected ? (
        <>
          <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{selected.name}</span>
              <span style={{ fontSize: 10.5, opacity: 0.6 }}>Spec JSON — edit, validate, save</span>
              <button type="button" onClick={saveFromJson} style={{ ...chipButton, marginLeft: "auto", background: "rgba(34, 211, 238, 0.22)", border: "1px solid rgba(125, 211, 252, 0.5)" }}>
                Validate & save
              </button>
              <button
                type="button"
                onClick={() => { uiStore.remove(selected.id); setSelectedId(null); refresh(); }}
                style={{ ...chipButton, borderColor: "rgba(248,113,113,0.4)", color: "#fca5a5" }}
              >
                Delete
              </button>
            </div>
            {jsonError ? <div style={{ fontSize: 11, color: "#fca5a5", borderRadius: 8, padding: "6px 10px", background: "rgba(248,113,113,0.08)" }}>{jsonError}</div> : null}
            <textarea
              value={json}
              onChange={(event) => setJson(event.target.value)}
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
                fontSize: 11.5,
                lineHeight: 1.55,
                outline: "none",
                resize: "vertical",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                whiteSpace: "pre",
                overflowWrap: "normal",
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Live preview</span>
              <span style={{ fontSize: 10.5, opacity: 0.6 }}>— buttons fire actions below</span>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12, background: "rgba(2, 6, 23, 0.35)", minHeight: 200 }}>
              <GenesisRuntimeUI spec={selected} onAction={handleAction} />
            </div>
            <div style={{ fontSize: 10.5, opacity: 0.7 }}>
              <div style={labelStyle}>Action log</div>
              {actionLog.length === 0 ? <div style={{ opacity: 0.55 }}>No actions fired yet.</div> : null}
              {actionLog.map((entry, index) => (
                <div key={index} style={{ fontSize: 10.5, opacity: 0.75, fontFamily: "ui-monospace, monospace", padding: "1px 0" }}>
                  • {entry}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, fontSize: 12, opacity: 0.6 }}>Select or create a spec to design it. The JSON is validated and rendered live.</div>
      )}
    </div>
  );
}

/* ================================================================== */
/* CODE TAB                                                            */
/* ================================================================== */
function CodeTab({ selfCode, refresh }: { selfCode: SelfCode; refresh: () => void }) {
  const [sources, setSources] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [sourceContent, setSourceContent] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [workingCopies, setWorkingCopies] = useState<Record<string, string>>({});
  const [patchText, setPatchText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void selfCode.listCoreSources().then((paths) => {
      if (!cancelled) setSources(paths);
    });
    setWorkingCopies(selfCode.workingCopies());
    return () => {
      cancelled = true;
    };
  }, [selfCode]);

  async function readSource(path: string) {
    setSelectedSource(path);
    setReading(true);
    try {
      setSourceContent(await selfCode.readCoreSource(path));
    } finally {
      setReading(false);
    }
  }

  async function openWorkingCopy(path: string) {
    const result = await selfCode.openWorkingCopy(path);
    setNotice(result.ok ? `Opened working copy of ${path} in the sandbox (self-code/…).` : `Failed: ${result.error}`);
    setWorkingCopies(selfCode.workingCopies());
    refresh();
  }

  async function buildPatch() {
    setPatchText(await selfCode.buildPatchText());
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 11.5 }}>
        <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.06)" }}>
          {sources.length} real core source files (lazy-fetched on demand)
        </span>
        <span style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(250, 204, 21, 0.1)", color: "#fde68a" }}>
          Read-only here — edits happen in sandbox working copies
        </span>
        <button
          type="button"
          onClick={() => void buildPatch()}
          style={{ ...chipButton, marginLeft: "auto", background: "rgba(34, 211, 238, 0.22)", border: "1px solid rgba(125, 211, 252, 0.5)" }}
        >
          Build candidate patch
        </button>
      </div>

      {notice ? (
        <div style={{ fontSize: 11.5, borderRadius: 10, padding: "8px 12px", background: "rgba(34, 211, 238, 0.08)", border: "1px solid rgba(125, 211, 252, 0.25)" }}>
          {notice}
        </div>
      ) : null}

      {Object.keys(workingCopies).length > 0 ? (
        <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
          <div style={labelStyle}>Open working copies in the sandbox · {Object.keys(workingCopies).length}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(workingCopies).map(([sandboxPath, realPath]) => (
              <span key={sandboxPath} style={{ fontSize: 10.5, borderRadius: 999, padding: "3px 10px", background: "rgba(34, 211, 238, 0.1)", fontFamily: "ui-monospace, monospace" }}>
                {realPath.replace("src/", "")} → sandbox
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 6 }}>
            Edit them in the Engineering workspace (they live under <code>self-code/</code>), then build the candidate patch here.
          </div>
        </div>
      ) : null}

      {patchText ? (
        <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Candidate patch</div>
            <button
              type="button"
              onClick={() => selfCode.downloadPatch(patchText)}
              style={{ ...chipButton, padding: "5px 12px", fontSize: 11, background: "rgba(34, 211, 238, 0.22)", border: "1px solid rgba(125, 211, 252, 0.5)" }}
            >
              Download .patch
            </button>
            <button type="button" onClick={() => setPatchText(null)} style={{ ...chipButton, padding: "5px 12px", fontSize: 11 }}>
              Close
            </button>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 10.5, lineHeight: 1.5, maxHeight: 260, overflowY: "auto", background: "rgba(2, 6, 23, 0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 10, fontFamily: "ui-monospace, monospace" }}>
            {patchText.slice(0, 12000)}
          </pre>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width: 280, flexShrink: 0, maxHeight: "min(56vh, 520px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {sources.map((path) => (
            <div key={path} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => void readSource(path)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "left",
                  border: selectedSource === path ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 9,
                  background: selectedSource === path ? "rgba(34, 211, 238, 0.08)" : "rgba(255,255,255,0.02)",
                  color: "white",
                  padding: "6px 9px",
                  fontSize: 10.5,
                  cursor: "pointer",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "ui-monospace, monospace",
                }}
                title={path}
              >
                {path.replace("/src/", "")}
              </button>
              <button
                type="button"
                onClick={() => void openWorkingCopy(path)}
                title={`Open working copy of ${path} in the sandbox`}
                style={{ border: "none", background: "transparent", color: "rgba(103, 232, 249, 0.9)", cursor: "pointer", fontSize: 13, padding: "2px 4px" }}
              >
                ＋
              </button>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 280 }}>
          {reading ? (
            <div style={{ fontSize: 11.5, opacity: 0.6 }}>Loading source…</div>
          ) : selectedSource && sourceContent !== null ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 10.5,
                lineHeight: 1.55,
                maxHeight: "min(56vh, 520px)",
                overflowY: "auto",
                background: "rgba(2, 6, 23, 0.6)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12,
                padding: "10px 12px",
                color: "#dbeafe",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {sourceContent.slice(0, 30000)}
            </pre>
          ) : (
            <div style={{ fontSize: 12, opacity: 0.6 }}>Select a source file to read its real content. To change it, open a working copy (＋) — the copy is editable in the Engineering sandbox.</div>
          )}
        </div>
      </div>
    </div>
  );
}
