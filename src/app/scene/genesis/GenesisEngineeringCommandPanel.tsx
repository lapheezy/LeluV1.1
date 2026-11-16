/**
 * ==========================================================
 * LÉLU — ENGINEERING COMMAND CENTER
 *
 * One workspace for the repository workforce Mission 7 built:
 *
 *   ACQUISITIONS  real records, licences, versions, trees, files,
 *                 extracted adaptations and durability controls
 *   COMMAND       natural-language objectives, prepared proposals,
 *                 council reviews, approvals, assignments and gaps
 *   WORKBENCH     branch/commit, diffs, test/build output, logs,
 *                 approved commit and rollback
 *   MARKETPLACE   provenance, activation that really disables tools,
 *                 update checks and safe removal
 *   CREATOR       objective → plan → real files in an engineering
 *                 workspace copy, validated by its toolchain
 *
 * Every value on screen comes from a service that performed the
 * operation. Buttons are wired to those services, not to local state.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import AcquisitionRuntime, { type AcquisitionRuntimeStatus } from "../../../core/acquisition/AcquisitionRuntime";
import AcquisitionStore from "../../../core/acquisition/AcquisitionStore";
import CapabilityMarketplace, { type MarketplaceEntry } from "../../../core/acquisition/CapabilityMarketplace";
import DurableAcquisitions, { type DurabilityReport } from "../../../core/acquisition/DurableAcquisitions";
import EngineeringCommandCenter, {
  type CommandSnapshot,
  type PreparedObjective,
} from "../../../core/acquisition/EngineeringCommandCenter";
import CreatorStudio, {
  type CreatorCreateResult,
  type CreatorKind,
  type CreatorPlan,
} from "../../../core/acquisition/CreatorStudio";
import ApprovalGate from "../../../core/acquisition/ApprovalGate";
import TechnologyKnowledgeBase from "../../../core/acquisition/TechnologyKnowledgeBase";
import {
  licenseObligations,
  type AcquisitionLogEntry,
  type AcquisitionRecord,
  type RepositoryFileEntry,
} from "../../../core/acquisition/AcquisitionTypes";

const label: CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  opacity: 0.62,
  marginBottom: 4,
  display: "block",
};

const field: CSSProperties = {
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

const chip: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 999,
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "6px 12px",
  fontSize: 11.5,
  cursor: "pointer",
  fontFamily: "inherit",
};

const card: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 12,
  padding: 12,
};

const mono: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: 10.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

type Tab = "acquisitions" | "command" | "workbench" | "marketplace" | "creator";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "acquisitions", label: "Acquisitions" },
  { id: "command", label: "Command Center" },
  { id: "workbench", label: "Executor Workbench" },
  { id: "marketplace", label: "Capability Marketplace" },
  { id: "creator", label: "Creator Studio" },
];

interface Props {
  onClose: () => void;
}

export default function GenesisEngineeringCommandPanel({ onClose }: Props) {
  const runtime = useMemo(() => AcquisitionRuntime.getInstance(), []);
  const store = useMemo(() => AcquisitionStore.getInstance(), []);
  const marketplace = useMemo(() => CapabilityMarketplace.getInstance(), []);
  const durability = useMemo(() => DurableAcquisitions.getInstance(), []);
  const center = useMemo(() => EngineeringCommandCenter.getInstance(), []);
  const studio = useMemo(() => CreatorStudio.getInstance(), []);

  const [tab, setTab] = useState<Tab>("acquisitions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [status, setStatus] = useState<AcquisitionRuntimeStatus | null>(null);
  const [records, setRecords] = useState<AcquisitionRecord[]>([]);
  const [report, setReport] = useState<DurabilityReport | null>(null);
  const [snapshot, setSnapshot] = useState<CommandSnapshot | null>(null);
  const [entries, setEntries] = useState<MarketplaceEntry[]>([]);
  const [query, setQuery] = useState("");
  const [operator, setOperator] = useState("operator");

  // acquisition browser / workbench
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tree, setTree] = useState<RepositoryFileEntry[]>([]);
  const [treeRoot, setTreeRoot] = useState(".");
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [logs, setLogs] = useState<AcquisitionLogEntry[]>([]);
  const [gitStatus, setGitStatus] = useState("");
  const [gitLog, setGitLog] = useState("");
  const [gitDiff, setGitDiff] = useState("");
  const [execOutput, setExecOutput] = useState("");
  const [command, setCommand] = useState("node --version");
  const [commitMessage, setCommitMessage] = useState("lelu: adaptation for acquisition");

  // command center
  const [objective, setObjective] = useState("Add a bounded memory cache to improve working recall");
  const [repository, setRepository] = useState("sindresorhus/quick-lru");
  const [keywords, setKeywords] = useState("bounded memory cache");
  const [pending, setPending] = useState<PreparedObjective | null>(null);
  const [execution, setExecution] = useState<string | null>(null);

  // creator
  const [creatorObjective, setCreatorObjective] = useState("A status dashboard for LÉLU's acquisition pipeline");
  const [creatorKind, setCreatorKind] = useState<CreatorKind>("dashboard");
  const [plan, setPlan] = useState<CreatorPlan | null>(null);
  const [created, setCreated] = useState<CreatorCreateResult | null>(null);

  const selected = records.find((record) => record.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    setError(null);
    const [runtimeStatus, list, durable, market] = await Promise.all([
      runtime.status(),
      runtime.list(),
      durability.report(),
      Promise.resolve(marketplace.inventory(query, { includeRemoved: true })),
    ]);
    if (runtimeStatus.ok) setStatus(runtimeStatus);
    else setStatus(null);
    if (list.ok) setRecords(list.acquisitions);
    setReport(durable);
    setEntries(market);
    setSnapshot(center.snapshot());
    if (durable.ok === false && durable.error) setError(durable.error);
  }, [center, durability, marketplace, query, runtime]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  async function inspect(id: string, path = ".") {
    const record = records.find((entry) => entry.id === id) ?? null;
    if (record) setSelectedId(record.id);
    const [treeResult, logResult, statusResult, historyResult, diffResult] = await Promise.all([
      runtime.tree(id, path),
      runtime.logs(id, 80),
      runtime.git<{ output?: string }>(id, "status"),
      runtime.log(id, 20),
      runtime.diff(id, false),
    ]);
    if (treeResult.ok) {
      setTree(treeResult.entries);
      setTreeRoot(treeResult.root);
    }
    if (logResult.ok) setLogs(logResult.entries);
    if (statusResult.ok) setGitStatus(statusResult.output ?? "");
    if (historyResult.ok) setGitLog(historyResult.log);
    if (diffResult.ok) setGitDiff(`${diffResult.stat}\n${diffResult.patch}`.trim());
    setOpenFile(null);
  }

  async function readFile(path: string) {
    if (!selectedId) return;
    const result = await runtime.read(selectedId, path);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpenFile({ path: result.path, content: result.content });
  }

  async function prepare() {
    await run(async () => {
      const prepared = await center.prepare(objective, {
        repository: repository.trim() || undefined,
        keywords: keywords.trim() || objective,
      });
      setPending(prepared);
      setSnapshot(center.snapshot());
      setNotice(`Prepared ${prepared.id}. Nothing has been cloned or registered yet.`);
    });
  }

  async function approveAndRun() {
    if (!pending) return;
    if (!operator.trim()) {
      setError("A named operator is required to approve an integration.");
      return;
    }
    await run(async () => {
      const executed = await center.execute(pending.id, operator.trim());
      const stages = executed.result?.run.events ?? [];
      setExecution(
        [
          executed.ok ? "Integration completed." : `Not completed: ${executed.error ?? "the pipeline stopped."}`,
          ...stages.map((event) => `${event.ok ? "✓" : "✗"} ${event.stage}: ${event.detail}`),
          executed.result?.capability ? `Capability: ${executed.result.capability.id}` : "",
          executed.result?.useResult ? `Use: ${executed.result.useResult}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      if (executed.ok) {
        setPending(null);
        setTab("marketplace");
      }
      await refresh();
    });
  }

  async function commitSelected() {
    if (!selected) return;
    await run(async () => {
      const gate = ApprovalGate.getInstance();
      const decision = gate.authorize("canonical-write", selected.id, operator.trim(), "Commit the adaptation");
      if (!decision.allowed) throw new Error(decision.reason);
      const grant = await runtime.approve({ scope: "canonical-write", targetId: selected.id });
      if (!grant.ok) throw new Error(grant.error);
      const committed = await runtime.commit(selected.id, commitMessage, grant.nonce);
      gate.consume("canonical-write", selected.id);
      if (!committed.ok) throw new Error(committed.error);
      setNotice(`Committed ${committed.commit.slice(0, 10)} on ${committed.branch} (${committed.version ?? "no version"}), approved by ${committed.approver}.`);
      await inspect(selected.id);
      await refresh();
    });
  }

  async function rollbackSelected(version: string) {
    if (!selected) return;
    await run(async () => {
      const gate = ApprovalGate.getInstance();
      const decision = gate.authorize("destructive", selected.id, operator.trim(), `Roll ${selected.id} back to ${version}`);
      if (!decision.allowed) throw new Error(decision.reason);
      const grant = await runtime.approve({ scope: "destructive", targetId: selected.id });
      if (!grant.ok) throw new Error(grant.error);
      const rolled = await runtime.rollback(selected.id, version, grant.nonce);
      gate.consume("destructive", selected.id);
      if (!rolled.ok) throw new Error(rolled.error);
      setNotice(`Rolled back to ${rolled.version} (${rolled.commit.slice(0, 10)}), approved by ${rolled.approver}.`);
      await inspect(selected.id);
      await refresh();
    });
  }

  async function execOperation(operation: "install" | "test" | "build" | "typecheck" | "command") {
    if (!selected) return;
    await run(async () => {
      const argv = operation === "command" ? command.trim().split(/\s+/).filter(Boolean) : undefined;
      if (operation === "command" && (!argv || argv.length === 0)) throw new Error("A command is required.");
      const result = await runtime.exec(selected.id, operation, argv ? { argv, timeoutMs: 300_000 } : { timeoutMs: 300_000 });
      if (!result.ok) throw new Error(result.error);
      setExecOutput(
        `${operation} exited ${result.result.status} in ${Math.round(result.result.durationMs / 1000)}s\n\n` +
          `${result.result.stdout}\n${result.result.stderr}`.trim(),
      );
      await refresh();
    });
  }

  async function marketAction(action: "activate" | "deactivate" | "remove" | "update", id: string) {
    await run(async () => {
      if (action === "activate") {
        const result = marketplace.activate(id);
        if (!result.ok) throw new Error(result.error ?? "Activation refused.");
        setNotice(`${id} activated; its tools are offered again.`);
      } else if (action === "deactivate") {
        const result = marketplace.deactivate(id);
        if (!result.ok) throw new Error(result.error ?? "Deactivation refused.");
        setNotice(`${id} deactivated; its tools are no longer offered.`);
      } else if (action === "remove") {
        const result = await marketplace.remove(id, operator.trim());
        if (!result.ok) throw new Error(result.error ?? "Removal refused.");
        setNotice(`${id} removed; history retained.`);
      } else {
        const update = await marketplace.checkUpdates(id);
        setNotice(
          update.error
            ? `Update check failed: ${update.error}`
            : update.available
              ? `Upstream HEAD ${update.upstreamCommit?.slice(0, 10)} differs from the recorded source commit.`
              : "No upstream change was observed.",
        );
      }
      await refresh();
    });
  }

  async function maintain(operation: "verify" | "recover" | "cleanup") {
    await run(async () => {
      if (operation === "cleanup") {
        const result = await durability.cleanup(operator.trim());
        if (!result.ok) throw new Error(result.error ?? "Cleanup refused.");
        setNotice(`Cleanup removed ${result.removed.length} experimental acquisition(s); kept ${result.kept.length}.`);
      } else {
        const result = await runtime.maintenance(operation);
        if (!result.ok) throw new Error(result.error);
        setNotice(
          operation === "recover"
            ? `Recovered ${result.recovered.length} acquisition(s).`
            : `${result.findings.filter((finding) => finding.status === "ok").length}/${result.findings.length} acquisition(s) verified.`,
        );
      }
      await refresh();
    });
  }

  async function createProject() {
    await run(async () => {
      const next = studio.plan(creatorObjective, creatorKind);
      setPlan(next);
      const result = await studio.create(next);
      setCreated(result);
      if (result.ok) {
        setNotice(
          `Wrote ${result.written.length} file(s) into ${result.workspaceId}; ` +
            `typecheck ${result.validation ? (result.validation.ok ? "passed" : `exited ${result.validation.exitCode}`) : "not run"}.`,
        );
      }
    });
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Engineering Workforce"
      title={<>Command Center · {records.length} acquisition(s) · {entries.filter((entry) => entry.active).length} active capabilit{entries.filter((entry) => entry.active).length === 1 ? "y" : "ies"}</>}
      onClose={onClose}
      width="min(96vw, 1180px)"
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
            {item.id === "acquisitions" ? ` · ${records.length}` : ""}
            {item.id === "marketplace" ? ` · ${entries.filter((entry) => !entry.removed).length}` : ""}
          </button>
        ))}
        <button type="button" onClick={() => void refresh()} disabled={busy} style={{ ...chip, marginLeft: "auto" }}>
          {busy ? "Working…" : "Refresh"}
        </button>
        <span
          style={{
            ...chip,
            cursor: "default",
            color: status ? "#86efac" : "#fca5a5",
            borderColor: status ? "rgba(74,222,128,0.4)" : "rgba(248,113,113,0.4)",
          }}
        >
          {status ? `runtime · ${status.runtime}` : "runtime unreachable"}
        </span>
      </div>

      <div style={{ maxHeight: "min(76vh, 770px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {error ? <div style={{ ...card, borderColor: "rgba(248,113,113,0.45)", color: "#fca5a5", fontSize: 12 }}>{error}</div> : null}
        {notice ? <div style={{ ...card, borderColor: "rgba(74,222,128,0.35)", color: "#86efac", fontSize: 12 }}>{notice}</div> : null}

        {/* ============================== ACQUISITIONS */}
        {tab === "acquisitions" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
              {[
                ["Acquisitions", String(records.length)],
                ["Integrated", String(records.filter((record) => record.status === "integrated").length)],
                ["Experimental", String(records.filter((record) => record.status !== "integrated").length)],
                ["Workspace", report ? `${(report.totalBytes / 1024 / 1024).toFixed(1)} / ${(report.quotas.maxTotalBytes / 1024 / 1024).toFixed(0)} MB` : "—"],
                ["Integrity", report ? `${report.integrity.filter((finding) => finding.status === "ok").length}/${report.integrity.length} ok` : "—"],
                ["Knowledge", `${TechnologyKnowledgeBase.getInstance().size()} entries`],
              ].map(([name, value]) => (
                <div key={name} style={card}>
                  <span style={label}>{name}</span>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void maintain("verify")} style={chip}>Verify integrity</button>
              <button type="button" onClick={() => void maintain("recover")} style={chip}>Recover interrupted</button>
              <button type="button" onClick={() => void maintain("cleanup")} style={{ ...chip, borderColor: "rgba(248,113,113,0.4)", color: "#fca5a5" }}>
                Clean experimental (approval)
              </button>
              <span style={{ fontSize: 11, opacity: 0.6, alignSelf: "center" }}>
                Cleanup never removes integrated acquisitions or the newest recent copies.
              </span>
            </div>

            {report && report.integrity.length > 0 ? (
              <div style={card}>
                <span style={label}>Integrity findings</span>
                {report.integrity.map((finding) => (
                  <div key={finding.id} style={{ ...mono, color: finding.status === "ok" ? "#86efac" : "#fca5a5" }}>
                    {finding.id} · {finding.identifier} · {finding.status} — {finding.detail}
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={label}>Acquired repositories</span>
                {records.length === 0 ? <div style={{ fontSize: 12, opacity: 0.6 }}>Nothing has been acquired yet.</div> : null}
                {records.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => void inspect(record.id)}
                    style={{
                      ...card,
                      textAlign: "left",
                      cursor: "pointer",
                      color: "inherit",
                      background: selectedId === record.id ? "rgba(34,211,238,0.1)" : "rgba(255,255,255,0.02)",
                      borderColor: selectedId === record.id ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.09)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <strong style={{ fontSize: 12.5 }}>{record.source.identifier}</strong>
                      <span style={{ fontSize: 10, opacity: 0.6 }}>{record.status}</span>
                    </div>
                    <div style={{ ...mono, opacity: 0.65 }}>
                      {record.commit.slice(0, 10)} · {record.license.spdx} · {record.fileCount} files · {(record.sizeBytes / 1024).toFixed(0)} KB
                    </div>
                    {record.capability ? <div style={{ fontSize: 10.5, color: "#67e8f9" }}>{record.capability}</div> : null}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {!selected ? (
                  <div style={{ ...card, fontSize: 12, opacity: 0.65 }}>
                    Select an acquisition to inspect its metadata, tree, extracted adaptation, versions and tests.
                  </div>
                ) : (
                  <>
                    <div style={card}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 14 }}>{selected.source.identifier}</strong>
                        <span style={{ ...chip, cursor: "default" }}>{selected.status}</span>
                      </div>
                      <div style={{ ...mono, marginTop: 6 }}>
                        {selected.source.url}
                        {"\n"}commit {selected.commit || "(none)"}
                        {"\n"}licence {selected.license.spdx} — {selected.license.name}
                        {"\n"}versions {selected.versions.map((version) => `${version.version}=${version.commit.slice(0, 8)}`).join(", ") || "none"}
                        {"\n"}capability {selected.capability ?? "none"} · {selected.fileCount} files · {(selected.sizeBytes / 1024).toFixed(0)} KB
                        {`\nobligations: ${licenseObligations(selected.license.spdx).join(" ")}`}
                      </div>
                      {selected.license.excerpt ? (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ fontSize: 11, opacity: 0.7, cursor: "pointer" }}>Licence excerpt</summary>
                          <pre style={mono}>{selected.license.excerpt}</pre>
                        </details>
                      ) : null}
                    </div>

                    <div style={card}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={label}>File tree · {treeRoot}</span>
                        {treeRoot !== "." ? (
                          <button type="button" style={{ ...chip, padding: "3px 9px", fontSize: 10.5 }} onClick={() => void inspect(selected.id, ".")}>
                            root
                          </button>
                        ) : null}
                      </div>
                      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
                        {tree.map((entry) => (
                          <button
                            key={entry.path}
                            type="button"
                            onClick={() => void readFile(entry.path)}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "inherit",
                              textAlign: "left",
                              cursor: "pointer",
                              fontFamily: "ui-monospace, monospace",
                              fontSize: 10.5,
                              padding: "2px 4px",
                              opacity: 0.82,
                            }}
                          >
                            {entry.path}
                            {entry.size !== undefined ? ` · ${entry.size} B` : ""}
                          </button>
                        ))}
                      </div>
                      {openFile ? (
                        <pre style={{ ...mono, marginTop: 8, maxHeight: 220, overflow: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 8 }}>
                          {openFile.path}
                          {"\n\n"}
                          {openFile.content}
                        </pre>
                      ) : null}
                    </div>

                    <div style={card}>
                      <span style={label}>Registered capabilities and test evidence</span>
                      {store.capabilities().length === 0 ? (
                        <div style={{ fontSize: 11.5, opacity: 0.6 }}>No capability has been registered from an acquisition yet.</div>
                      ) : (
                        store.capabilities().map((capability) => (
                          <div key={capability.id} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{capability.name} · {capability.id}</div>
                            <div style={mono}>
                              {capability.tests.map((test) => `${test.ok ? "✓" : "✗"} ${test.command} → exit ${test.exitCode}`).join("\n")}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* ============================== COMMAND */}
        {tab === "command" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={card}>
              <span style={label}>New objective</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={2} style={{ ...field, resize: "vertical" }} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repository (optional)" style={{ ...field, flex: 1, minWidth: 200 }} />
                  <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="capability keywords" style={{ ...field, flex: 1, minWidth: 180 }} />
                  <input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="approved by" style={{ ...field, width: 150 }} />
                  <button type="button" onClick={() => void prepare()} disabled={busy} style={{ ...chip, background: "rgba(34,211,238,0.2)" }}>
                    Research objective
                  </button>
                </div>
              </div>
            </div>

            {pending ? (
              <div style={{ ...card, borderColor: "rgba(34,211,238,0.25)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>{pending.proposal.candidate.identifier}</strong>
                  <span style={{ ...chip, cursor: "default" }}>priority {pending.proposal.priority}/100</span>
                </div>
                <div style={{ ...mono, marginTop: 6 }}>
                  {pending.proposal.findings.summary}
                  {"\n"}licence {pending.proposal.findings.license.spdx} ({pending.proposal.findings.license.risk}) · compatibility{" "}
                  {Math.round(pending.proposal.findings.compatibility.score * 100)}% ({pending.proposal.findings.compatibility.runtime}) · security{" "}
                  {pending.proposal.findings.security.riskLevel}
                  {"\n"}capabilities: {pending.proposal.findings.capabilities.join(", ") || "none"}
                  {"\n"}prepared {new Date(pending.preparedAt).toLocaleString()} as {pending.id}
                </div>
                {pending.council ? (
                  <div style={{ marginTop: 8 }}>
                    <span style={label}>Council · {pending.council.verdict} · {pending.council.durationMs}ms · {pending.council.reports.length} specialists</span>
                    {pending.council.reports.map((review) => (
                      <div key={review.id} style={{ fontSize: 11, opacity: 0.82 }}>
                        <strong>{review.title}</strong> — {review.findings.slice(0, 2).join(" ")}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => void approveAndRun()} disabled={busy} style={{ ...chip, background: "rgba(74,222,128,0.18)", borderColor: "rgba(74,222,128,0.45)" }}>
                    Approve · acquire, test and integrate
                  </button>
                  <button type="button" onClick={() => { center.discard(); setPending(null); }} style={chip}>
                    Discard
                  </button>
                </div>
              </div>
            ) : null}

            {execution ? <pre style={{ ...card, ...mono, maxHeight: 260, overflow: "auto" }}>{execution}</pre> : null}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
              <div style={card}>
                <span style={label}>Assignments</span>
                {snapshot?.assignments.length ? (
                  snapshot.assignments.map((assignment) => (
                    <div key={assignment.id} style={{ fontSize: 11.5, marginBottom: 5 }}>
                      <strong>{assignment.status}</strong> · {assignment.proposal.candidate.identifier} — {assignment.objective}
                      {assignment.failure ? <div style={{ color: "#fca5a5", ...mono }}>{assignment.failure}</div> : null}
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 11.5, opacity: 0.6 }}>No assignment yet.</div>
                )}
              </div>
              <div style={card}>
                <span style={label}>Capability gaps</span>
                {snapshot?.gaps.slice(0, 8).map((gap) => (
                  <div key={gap.capabilityId} style={{ fontSize: 11.5 }}>
                    {gap.name} · {gap.status} — {gap.reason}
                  </div>
                ))}
              </div>
              <div style={card}>
                <span style={label}>Approvals</span>
                {snapshot?.approvals.length ? (
                  snapshot.approvals.map((entry, index) => (
                    <div key={`${entry.targetId}-${index}`} style={{ ...mono, color: entry.allowed ? "#86efac" : "#fca5a5" }}>
                      {entry.allowed ? "✓" : "✗"} {entry.scope} · {entry.targetId} — {entry.reason}
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 11.5, opacity: 0.6 }}>No approval has been issued yet.</div>
                )}
              </div>
              <div style={card}>
                <span style={label}>Blocked</span>
                {snapshot?.blocked.length ? (
                  snapshot.blocked.map((blocked) => (
                    <div key={blocked.id} style={{ fontSize: 11.5, color: "#fca5a5" }}>
                      {blocked.objective} — {blocked.reason}
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 11.5, opacity: 0.6 }}>Nothing blocked.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* ============================== WORKBENCH */}
        {tab === "workbench" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={selectedId ?? ""} onChange={(event) => { if (event.target.value) void inspect(event.target.value); }} style={{ ...field, width: 260 }}>
                <option value="">Select an acquisition…</option>
                {records.map((record) => (
                  <option key={record.id} value={record.id}>{record.source.identifier} · {record.status}</option>
                ))}
              </select>
              <input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="approved by" style={{ ...field, width: 150 }} />
              <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="commit message" style={{ ...field, flex: 1, minWidth: 220 }} />
              <button type="button" onClick={() => void commitSelected()} disabled={!selected || busy} style={{ ...chip, background: "rgba(74,222,128,0.16)" }}>
                Commit (approval)
              </button>
              {selected?.versions.map((version) => (
                <button key={version.version} type="button" onClick={() => void rollbackSelected(version.version)} style={{ ...chip, borderColor: "rgba(248,113,113,0.35)", color: "#fca5a5" }}>
                  Roll back {version.version}
                </button>
              ))}
            </div>

            {!selected ? (
              <div style={{ ...card, fontSize: 12, opacity: 0.65 }}>Select an acquisition to open its branch, diffs, execution output and logs.</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                  <div style={card}>
                    <span style={label}>Repository state</span>
                    <div style={mono}>
                      {selected.source.identifier}
                      {"\n"}branch {selected.ref || "(default)"} · commit {selected.commit.slice(0, 10)}
                      {"\n"}versions {selected.versions.map((version) => `${version.version}=${version.commit.slice(0, 8)}`).join(", ") || "none"}
                      {"\n"}status {selected.status}
                      {"\n"}capability {selected.capability ?? "none"}
                    </div>
                  </div>
                  <div style={card}>
                    <span style={label}>Working tree</span>
                    <pre style={{ ...mono, maxHeight: 150, overflow: "auto" }}>{gitStatus || "clean"}</pre>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["install", "test", "build", "typecheck"] as const).map((operation) => (
                    <button key={operation} type="button" onClick={() => void execOperation(operation)} disabled={busy} style={chip}>
                      Run {operation}
                    </button>
                  ))}
                  <input value={command} onChange={(event) => setCommand(event.target.value)} style={{ ...field, flex: 1, minWidth: 180 }} />
                  <button type="button" onClick={() => void execOperation("command")} disabled={busy} style={chip}>Run command</button>
                </div>
                {execOutput ? <pre style={{ ...card, ...mono, maxHeight: 220, overflow: "auto" }}>{execOutput}</pre> : null}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={card}>
                    <span style={label}>Commit history (inside the acquisition)</span>
                    <pre style={{ ...mono, maxHeight: 180, overflow: "auto" }}>{gitLog || "No commits read yet."}</pre>
                  </div>
                  <div style={card}>
                    <span style={label}>Diff</span>
                    <pre style={{ ...mono, maxHeight: 180, overflow: "auto" }}>{gitDiff || "No diff."}</pre>
                  </div>
                </div>

                <div style={card}>
                  <span style={label}>Execution log</span>
                  <div style={{ maxHeight: 200, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                    {logs.length === 0 ? <span style={{ fontSize: 11.5, opacity: 0.6 }}>No log entries.</span> : null}
                    {logs.slice().reverse().map((entry, index) => (
                      <div key={`${entry.at}-${index}`} style={{ ...mono, color: entry.ok ? "#bbf7d0" : "#fca5a5" }}>
                        {new Date(entry.at).toLocaleTimeString()} · {entry.action} · {entry.ok ? "ok" : "failed"} · {entry.detail}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* ============================== MARKETPLACE */}
        {tab === "marketplace" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setEntries(marketplace.inventory(event.target.value, { includeRemoved: true })); }}
                placeholder="Search acquired technologies, licences, sources…"
                style={{ ...field, flex: 1, minWidth: 240 }}
              />
              <input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="approved by" style={{ ...field, width: 150 }} />
            </div>

            {entries.length === 0 ? (
              <div style={{ ...card, fontSize: 12, opacity: 0.65 }}>
                No acquired capability is registered. Use the Command Center to prepare and integrate one.
              </div>
            ) : null}

            {entries.map((entry) => (
              <div key={entry.id} style={{ ...card, opacity: entry.removed ? 0.65 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>{entry.name}</strong>
                    <div style={{ ...mono, opacity: 0.7 }}>{entry.id} · {entry.active ? "active" : "inactive"} · {entry.status}</div>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => void marketAction(entry.active ? "deactivate" : "activate", entry.id)} disabled={busy || entry.removed} style={chip}>
                      {entry.active ? "Deactivate" : "Activate"}
                    </button>
                    <button type="button" onClick={() => void marketAction("update", entry.id)} disabled={busy} style={chip}>Check updates</button>
                    <button type="button" onClick={() => void marketAction("remove", entry.id)} disabled={busy || entry.removed} style={{ ...chip, borderColor: "rgba(248,113,113,0.4)", color: "#fca5a5" }}>
                      Remove
                    </button>
                    {entry.removed ? (
                      <button type="button" onClick={() => { const result = marketplace.restore(entry.id); setNotice(result.ok ? "Restored." : result.error ?? "Restore refused."); void refresh(); }} style={chip}>
                        Restore
                      </button>
                    ) : null}
                  </div>
                </div>
                <div style={{ ...mono, marginTop: 6 }}>
                  {entry.description}
                  {"\n"}source {entry.source.identifier}@{entry.source.commit.slice(0, 10)} · {entry.license.spdx}
                  {"\n"}tools {entry.tools.join(", ") || "none"} · dependencies {entry.dependencies.join(", ")}
                  {"\n"}approved by {entry.approvedBy} ({entry.approvalBasis})
                  {"\n"}tests {entry.tests.map((test) => `${test.ok ? "✓" : "✗"} ${test.command} exit ${test.exitCode}`).join("; ") || "none"}
                  {entry.update ? `\nupdate ${entry.update.available ? `available · upstream ${entry.update.upstreamCommit?.slice(0, 10)}` : entry.update.error ? `check failed: ${entry.update.error}` : "not available"}` : ""}
                  {entry.license.obligations.length > 0 ? `\nobligations ${entry.license.obligations.join(" ")}` : ""}
                </div>
              </div>
            ))}

            <div style={card}>
              <span style={label}>Integration history</span>
              {marketplace.history().capabilities.map((record) => (
                <div key={record.id} style={mono}>
                  {new Date(record.registeredAt).toLocaleString()} · {record.id} ← {record.source.identifier}@{record.source.commit.slice(0, 10)}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ============================== CREATOR */}
        {tab === "creator" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={card}>
              <span style={label}>Create something real</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={creatorObjective} onChange={(event) => setCreatorObjective(event.target.value)} style={{ ...field, flex: 1, minWidth: 260 }} />
                <select value={creatorKind} onChange={(event) => setCreatorKind(event.target.value as CreatorKind)} style={{ ...field, width: 160 }}>
                  {(["website", "dashboard", "api", "tool", "agent", "game"] as CreatorKind[]).map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </select>
                <button type="button" onClick={() => void createProject()} disabled={busy} style={{ ...chip, background: "rgba(167,139,250,0.2)" }}>
                  Plan and build
                </button>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
                Files are written into an isolated engineering workspace copy through /api/engineer and the copy is typechecked.
                Nothing is applied to the canonical project here.
              </div>
            </div>

            {plan ? (
              <div style={card}>
                <span style={label}>Plan · {plan.kind} · {plan.slug}</span>
                <div style={{ ...mono }}>{plan.files.map((file) => file.path).join("\n")}</div>
              </div>
            ) : null}

            {created ? (
              <div style={card}>
                <span style={label}>Result</span>
                <div style={{ ...mono }}>
                  workspace {created.workspaceId ?? "none"}
                  {"\n"}written {created.written.length} file(s)
                  {"\n"}changed {created.changed ?? "—"}
                  {"\n"}typecheck{" "}
                  {created.validation
                    ? created.validation.ok
                      ? `exit 0 in ${created.validation.durationMs}ms`
                      : `exit ${created.validation.exitCode}`
                    : "not run"}
                  {created.error ? `\nerror ${created.error}` : ""}
                </div>
                {created.validation?.output ? (
                  <pre style={{ ...mono, maxHeight: 200, overflow: "auto", marginTop: 8 }}>{created.validation.output}</pre>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </GenesisWindowFrame>
  );
}
