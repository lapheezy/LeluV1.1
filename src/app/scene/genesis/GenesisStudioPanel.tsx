/**
 * ==========================================================
 * LÉLU — SESSION 3C: STUDIO PANEL
 *
 * The studio's surface inside Cosmos. It is rendered by the existing
 * GenesisModuleHost, so it is a normal floating window: draggable,
 * resizable, stackable. The preview is an iframe of the project's real
 * build output (or its real backend, proxied same-origin), not a mock.
 *
 * Every button calls the studio runtime. Nothing on this panel reports a
 * build, test or deployment that the runtime did not return.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import EngineeringAuthorization from "../../../core/engineering/EngineeringAuthorization";
import StudioLibrary from "../../../core/studio/StudioLibrary";
import { fetchPersistedStudioProjects } from "../../../core/studio/StudioPersistence";
import StudioApprovals, { PROTECTED_ACTION_LABELS } from "../../../core/studio/StudioApprovals";
import StudioPipeline from "../../../core/studio/StudioPipeline";
import StudioRuntime, { type StudioEntry } from "../../../core/studio/StudioRuntime";
import { recommendEngine } from "../../../core/studio/StudioEngines";
import {
  STUDIO_PHASE_LABELS,
  STUDIO_PHASES,
  type ProtectedAction,
  type StudioProject,
  type StudioProjectKind,
} from "../../../core/studio/StudioTypes";

const label: CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  opacity: 0.6,
  display: "block",
  marginBottom: 4,
};

const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 9,
  padding: "7px 9px",
  color: "white",
  fontSize: 12.5,
  fontFamily: "inherit",
  outline: "none",
};

const button = (active = false): CSSProperties => ({
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 9,
  background: active ? "rgba(103,232,249,0.22)" : "rgba(255,255,255,0.06)",
  color: "white",
  padding: "6px 10px",
  fontSize: 11.5,
  cursor: "pointer",
  fontFamily: "inherit",
});

const panel: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  padding: 10,
  background: "rgba(255,255,255,0.03)",
  marginBottom: 10,
};

type Tab = "source" | "build" | "tests" | "workflow" | "deploy";

const KIND_LABEL: Record<StudioProjectKind, string> = {
  website: "Website",
  application: "Application",
  game: "Game",
};

export default function GenesisStudioPanel({ onClose }: { onClose: () => void }) {
  const library = useMemo(() => StudioLibrary.getInstance(), []);
  const runtime = useMemo(() => StudioRuntime.getInstance(), []);
  const pipeline = useMemo(() => StudioPipeline.getInstance(), []);
  const approvals = useMemo(() => StudioApprovals.getInstance(), []);

  const [projects, setProjects] = useState<StudioProject[]>(() => library.list());
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>("source");
  const [health, setHealth] = useState<string>("Probing the studio runtime…");
  const [available, setAvailable] = useState(false);
  const [entries, setEntries] = useState<StudioEntry[]>([]);
  const [dir, setDir] = useState(".");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [approvalList, setApprovalList] = useState<Array<Record<string, unknown>>>([]);
  const [reason, setReason] = useState("Publish the built output to the production host.");
  const [tick, setTick] = useState(0);

  const selected = projects.find((project) => project.id === selectedId) ?? null;

  const refresh = useCallback(() => {
    setProjects(library.list());
    setTick((value) => value + 1);
  }, [library]);

  // The disk is the authority for which projects exist. Adopt projects
  // created in another browser/session, while keeping measured history.
  useEffect(() => {
    let cancelled = false;
    void fetchPersistedStudioProjects().then((disk) => {
      if (cancelled || !disk) return;
      const synced = library.syncFromDisk(disk);
      setProjects(synced);
      setSelectedId((current) =>
        current && synced.some((project) => project.id === current) ? current : synced[0]?.id ?? null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [library]);

  useEffect(() => {
    let cancelled = false;
    void runtime.health().then((result) => {
      if (cancelled) return;
      setAvailable(result.ok);
      setHealth(
        result.ok
          ? `Runtime ready · node ${result.capabilities.node ? "yes" : "no"} · godot ${
              result.capabilities.godot ? "yes" : "no"
            } · unity ${result.capabilities.unity ? "yes" : "no"} · unreal ${
              result.capabilities.unreal ? "yes" : "no"
            }`
          : result.error ?? "Studio runtime unavailable.",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const loadDir = useCallback(
    async (slug: string, path: string) => {
      const listing = await runtime.tree(slug, path);
      if (!listing.ok) {
        setMessage(listing.error ?? "The directory could not be listed.");
        return;
      }
      setEntries(listing.entries);
      setDir(path);
    },
    [runtime],
  );

  useEffect(() => {
    if (!selected) return;
    void loadDir(selected.slug, ".");
    setOpenPath(null);
    setPreviewUrl(selected.previewUrl);
  }, [selectedId, loadDir, selected?.slug]);

  useEffect(() => {
    if (!selected || tab !== "deploy") return;
    void runtime.approvals(selected.slug).then((list) => setApprovalList(list));
  }, [selected, tab, runtime, tick]);

  async function seedDemos() {
    setBusy("Creating the three demonstration projects…");
    setMessage("");
    try {
      const created = await runtime.seedDemos();
      for (const demo of created) {
        if (!demo.ok) {
          setMessage(`${demo.kind}: ${demo.error ?? "not created"}`);
          continue;
        }
        if (library.get(demo.slug)) continue;
        const recommendation = recommendEngine({
          kind: demo.kind as StudioProjectKind,
          dimension: demo.kind === "game" ? "3d" : undefined,
          targets: ["web"],
        });
        library.create({
          name: demo.slug
            .split("-")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" "),
          kind: demo.kind as StudioProjectKind,
          engine: recommendation.engine,
          stack: recommendation.stack,
          root: `.lelu-studio/${demo.slug}`,
          documentation: recommendation.rationale[0],
        });
      }
      refresh();
      const first = library.list()[0];
      if (first) setSelectedId(first.id);
      setMessage(`Studio projects are on disk: ${created.map((demo) => `${demo.slug} (${demo.files} files)`).join(", ")}.`);
    } finally {
      setBusy("");
    }
  }

  async function createProject(kind: StudioProjectKind) {
    if (!available) return;
    setBusy(`Scaffolding a ${kind}…`);
    try {
      const name = `New ${KIND_LABEL[kind]} ${new Date().toLocaleTimeString()}`;
      const result = await runtime.scaffold({ kind, name });
      if (!result.ok || !result.slug) {
        setMessage(result.error ?? "Nothing was created.");
        return;
      }
      const recommendation = recommendEngine({
        kind,
        dimension: kind === "game" ? "3d" : undefined,
        targets: ["web"],
      });
      const project = library.create({
        name,
        kind,
        engine: recommendation.engine,
        stack: recommendation.stack,
        root: `.lelu-studio/${result.slug}`,
      });
      refresh();
      setSelectedId(project.id);
      setMessage(`Created ${result.slug} with ${result.files} files.`);
    } finally {
      setBusy("");
    }
  }

  function startWorkflow(project: StudioProject) {
    const recommendation = recommendEngine({
      kind: project.kind,
      dimension: project.kind === "game" ? "3d" : undefined,
      targets: ["web"],
    });
    const stages: Array<[string, Record<string, unknown>]> = [
      ["understand", { requirements: `${project.kind} for web; engine ${recommendation.engine}` }],
      ["research", { findings: recommendation.rationale.join(" ") }],
      ["architect", { decisions: recommendation.stack }],
      ["generate", { files: entries.length, engine: recommendation.engine }],
    ];
    for (const [phase, evidence] of stages) {
      pipeline.advance({ projectId: project.id, phase: phase as never, evidence });
    }
    library.update(project.id, { documentation: `${recommendation.label}. ${recommendation.rationale.join(" ")}` });
    refresh();
    setMessage("Workflow started from the real project facts.");
  }

  async function build(project: StudioProject) {
    setBusy("Building…");
    setTab("build");
    try {
      const built = await runtime.build(project.slug);
      const meta = (built as unknown as { version?: { files: number; bytes: number; hash: string } }).version;
      if (meta) {
        library.recordVersionManifest(project.id, {
          ...meta,
          note: built.ok ? "source at the last passing build" : "source at the last build attempt",
        });
      }
      library.recordBuild(project.id, {
        at: Date.now(),
        ok: built.ok,
        exitCode: built.exitCode,
        durationMs: built.durationMs,
        output: built.output,
        artifact: built.artifact,
        bytes: built.bytes,
      });
      pipeline.advance({
        projectId: project.id,
        phase: "build",
        evidence: { exitCode: built.exitCode, artifact: built.artifact ?? "none" },
        ok: built.ok,
      });
      setMessage(built.ok ? `Build passed (exit 0, ${built.durationMs} ms).` : `Build FAILED (exit ${built.exitCode}).`);
      refresh();
    } finally {
      setBusy("");
    }
  }

  async function test(project: StudioProject) {
    setBusy("Running tests…");
    setTab("tests");
    try {
      const run = await runtime.test(project.slug);
      library.recordTest(project.id, {
        at: Date.now(),
        ok: run.ok,
        exitCode: run.exitCode,
        passed: run.passed,
        failed: run.failed,
        durationMs: run.durationMs,
        output: run.output,
      });
      pipeline.advance({
        projectId: project.id,
        phase: "test",
        evidence: { exitCode: run.exitCode, passed: run.passed, failed: run.failed },
        ok: run.ok,
      });
      setMessage(`${run.passed} passed, ${run.failed} failed (exit ${run.exitCode}).`);
      refresh();
    } finally {
      setBusy("");
    }
  }

  async function preview(project: StudioProject) {
    setBusy("Building and serving the preview…");
    try {
      const built = await runtime.build(project.slug);
      if (!built.ok) {
        setMessage(`No preview: the build exited ${built.exitCode}.`);
        setTab("build");
        return;
      }
      const url = runtime.previewUrl(project.slug);
      const response = await fetch(url).catch(() => null);
      if (!response?.ok) {
        setMessage(`The preview at ${url} did not answer (HTTP ${response?.status ?? "none"}).`);
        return;
      }
      library.update(project.id, { previewUrl: url });
      pipeline.advance({ projectId: project.id, phase: "preview", evidence: { url } });
      setPreviewUrl(`${url}?v=${Date.now()}`);
      setMessage("Preview served from the real build output.");
      refresh();
    } finally {
      setBusy("");
    }
  }

  async function openFile(path: string) {
    if (!selected) return;
    const read = await runtime.read(selected.slug, path);
    if (!read.ok) {
      setMessage(read.error ?? "The file could not be read.");
      return;
    }
    setOpenPath(path);
    setContent(read.content ?? "");
  }

  async function saveFile() {
    if (!selected || !openPath) return;
    setBusy("Saving…");
    try {
      const written = await runtime.write(selected.slug, openPath, content);
      setMessage(written.ok ? `Saved ${openPath}.` : written.error ?? "Not saved.");
    } finally {
      setBusy("");
    }
  }

  function identity(): string {
    return EngineeringAuthorization.getInstance().identity() ?? "studio-user";
  }

  async function requestProductionApproval(project: StudioProject) {
    const result = await runtime.requestApproval({
      slug: project.slug,
      action: "production-deploy",
      reason,
    });
    setMessage(
      result.ok
        ? "Approval requested. It stays pending until you approve it here — LÉLU cannot grant it."
        : result.error ?? "No approval was requested.",
    );
    setApprovalList(await runtime.approvals(project.slug));
  }

  async function decide(project: StudioProject, approvalId: string, decision: "approved" | "denied") {
    const result = await runtime.decideApproval({ approvalId, decision, decidedBy: identity() });
    if (!result.ok) {
      setMessage(result.error ?? "The decision was not recorded.");
      return;
    }
    if (decision === "approved") {
      const client = approvals.request({
        projectId: project.id,
        action: "production-deploy",
        reason: "The owner approved publishing this project's build.",
      });
      approvals.decide(client.id, "approved", identity());
    }
    setApprovalList(await runtime.approvals(project.slug));
    setMessage(`Approval ${decision} as ${identity()}.`);
  }

  async function deploy(project: StudioProject, environment: "preview" | "production") {
    setBusy(`Preparing the ${environment} deployment…`);
    try {
      const approved = approvalList.find(
        (approval) => approval.action === "production-deploy" && approval.status === "approved",
      );
      const result = await runtime.deploy({
        slug: project.slug,
        environment,
        approvalId: approved ? String(approved.id) : undefined,
      });
      library.recordDeployment(project.id, {
        at: Date.now(),
        environment,
        target: result.target,
        status: result.status,
        url: result.url,
        note: result.note ?? result.error,
      });
      pipeline.advance({
        projectId: project.id,
        phase: "deploy",
        evidence: { deploymentId: result.target || "none", environment, status: result.status },
        ok: result.ok && result.status !== "blocked",
      });
      setMessage(
        result.ok
          ? `${environment} deployment ${result.status}: ${result.target}. ${result.note ?? ""}`
          : result.error ?? "Not deployed.",
      );
      refresh();
    } finally {
      setBusy("");
    }
  }

  const latestBuild = selected?.builds.at(-1) ?? null;
  const latestTest = selected?.tests.at(-1) ?? null;
  const workflow = selected ? pipeline.state(selected.id) : null;

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU Studio · Session 3C"
      title="Software Studio"
      onClose={onClose}
      width="min(94vw, 760px)"
      maxHeight="min(82vh, 760px)"
      overflow="auto-y"
    >
      <p style={{ fontSize: 11.5, opacity: 0.72, margin: "0 0 10px" }}>{health}</p>
      {busy ? <p style={{ fontSize: 11.5, color: "#67e8f9", margin: "0 0 8px" }}>{busy}</p> : null}
      {message ? (
        <p style={{ fontSize: 11.5, color: "#bae6fd", margin: "0 0 10px", overflowWrap: "anywhere" }}>{message}</p>
      ) : null}

      <div style={panel}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <button type="button" style={button(true)} onClick={() => void seedDemos()} disabled={!available || Boolean(busy)}>
            Create the 3 demonstrations
          </button>
          {(["website", "application", "game"] as StudioProjectKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              style={button()}
              disabled={!available || Boolean(busy)}
              onClick={() => void createProject(kind)}
            >
              + {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              style={{
                ...button(project.id === selectedId),
                textAlign: "left",
                padding: "7px 9px",
              }}
              onClick={() => {
                library.reopen(project.id);
                setSelectedId(project.id);
                setTab("source");
              }}
            >
              <strong style={{ display: "block", fontSize: 11.5 }}>{project.name}</strong>
              <span style={{ fontSize: 10, opacity: 0.6 }}>
                {project.discovered
                  ? `On disk${project.discoveredBuilt ? " · built" : ""}`
                  : `${KIND_LABEL[project.kind]} · ${project.engine}`}
              </span>
            </button>
          ))}
          {projects.length === 0 ? (
            <p style={{ fontSize: 11.5, opacity: 0.65, margin: 0 }}>
              No projects yet. Create the three demonstrations — real files are written to the studio runtime.
            </p>
          ) : null}
        </div>
      </div>

      {selected ? (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {(["source", "build", "tests", "workflow", "deploy"] as Tab[]).map((name) => (
              <button key={name} type="button" style={button(tab === name)} onClick={() => setTab(name)}>
                {name === "tests" ? "Tests" : name.charAt(0).toUpperCase() + name.slice(1)}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 10.5, opacity: 0.6 }}>
              {selected.slug} · {selected.discovered ? "disk project" : `${selected.versions.length} versions`} ·{" "}
              {selected.discovered
                ? selected.discoveredBuilt ? "built on disk" : "not built"
                : selected.builds.at(-1)?.ok ? "build passing" : selected.builds.length ? "build failing" : "not built"}
            </span>
          </div>

          {tab === "source" ? (
            <div style={panel}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <button type="button" style={button()} onClick={() => void loadDir(selected.slug, ".")}>
                  root
                </button>
                {dir !== "." ? (
                  <button
                    type="button"
                    style={button()}
                    onClick={() => {
                      const parent = dir.split("/").slice(0, -1).join("/");
                      void loadDir(selected.slug, parent || ".");
                    }}
                  >
                    up
                  </button>
                ) : null}
                <code style={{ fontSize: 10.5, opacity: 0.7 }}>/{dir === "." ? "" : dir}</code>
              </div>
              <div style={{ display: "grid", gap: 3, marginBottom: 10, maxHeight: 150, overflow: "auto" }}>
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    style={{ ...button(openPath === entry.path), textAlign: "left", fontSize: 11 }}
                    onClick={() => {
                      if (entry.type === "dir") void loadDir(selected.slug, entry.path);
                      else void openFile(entry.path);
                    }}
                  >
                    {entry.type === "dir" ? "▸ " : "· "}
                    {entry.name}
                  </button>
                ))}
              </div>
              {openPath ? (
                <>
                  <span style={label}>{openPath}</span>
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    spellCheck={false}
                    style={{ ...input, height: 190, fontFamily: "ui-monospace, monospace", fontSize: 11, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button type="button" style={button(true)} onClick={() => void saveFile()}>
                      Save
                    </button>
                    <button type="button" style={button()} onClick={() => void openFile(openPath)}>
                      Reload
                    </button>
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 11, opacity: 0.6, margin: 0 }}>
                  Open a file to inspect and edit it. Writes that would expose a credential are refused by the runtime.
                </p>
              )}
            </div>
          ) : null}

          {tab === "build" ? (
            <div style={panel}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <button type="button" style={button(true)} onClick={() => void build(selected)} disabled={Boolean(busy)}>
                  Build
                </button>
                <button type="button" style={button()} onClick={() => void preview(selected)} disabled={Boolean(busy)}>
                  Build + live preview
                </button>
                <button type="button" style={button()} onClick={() => startWorkflow(selected)}>
                  Start workflow
                </button>
              </div>
              <p style={{ fontSize: 11.5, margin: "0 0 6px", opacity: 0.75 }}>
                {latestBuild
                  ? `Last build: exit ${latestBuild.exitCode} in ${latestBuild.durationMs} ms · ${latestBuild.artifact ?? "no output"} · ${latestBuild.bytes} B`
                  : "No build has run yet."}
              </p>
              {previewUrl ? (
                <iframe
                  title={`${selected.name} preview`}
                  src={previewUrl}
                  style={{ width: "100%", height: 300, border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, background: "#04070f" }}
                />
              ) : null}
              <pre style={{ fontSize: 10.5, whiteSpace: "pre-wrap", maxHeight: 150, overflow: "auto", opacity: 0.8 }}>
                {latestBuild?.output ?? ""}
              </pre>
            </div>
          ) : null}

          {tab === "tests" ? (
            <div style={panel}>
              <button type="button" style={button(true)} onClick={() => void test(selected)} disabled={Boolean(busy)}>
                Run tests
              </button>
              <p style={{ fontSize: 11.5, margin: "8px 0 6px" }}>
                {latestTest
                  ? `${latestTest.passed} passed, ${latestTest.failed} failed (exit ${latestTest.exitCode}) in ${latestTest.durationMs} ms`
                  : "No test run yet."}
              </p>
              <pre style={{ fontSize: 10.5, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", opacity: 0.8 }}>
                {latestTest?.output ?? ""}
              </pre>
            </div>
          ) : null}

          {tab === "workflow" ? (
            <div style={panel}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <button type="button" style={button(true)} onClick={() => startWorkflow(selected)}>
                  Record understand → generate
                </button>
                <span style={{ fontSize: 10.5, opacity: 0.65, alignSelf: "center" }}>
                  Build, test and preview record their own stages from real exit codes.
                </span>
              </div>
              <div style={{ display: "grid", gap: 3 }}>
                {STUDIO_PHASES.map((phase) => {
                  const record = workflow?.stages.filter((stage) => stage.phase === phase).at(-1);
                  return (
                    <div key={phase} style={{ display: "flex", gap: 8, fontSize: 11.5 }}>
                      <span style={{ width: 14, opacity: 0.9 }}>{record?.ok ? "✓" : record ? "✕" : "·"}</span>
                      <span style={{ width: 86, opacity: record ? 1 : 0.55 }}>{STUDIO_PHASE_LABELS[phase]}</span>
                      <span style={{ flex: 1, opacity: 0.6, overflowWrap: "anywhere" }}>
                        {record ? JSON.stringify(record.evidence).slice(0, 120) : "not recorded"}
                      </span>
                    </div>
                  );
                })}
              </div>
                <p style={{ fontSize: 10.5, opacity: 0.6, marginTop: 8 }}>
                  {selected.id ? pipeline.describe(selected.id) : ""}
                </p>
            </div>
          ) : null}

          {tab === "deploy" ? (
            <div style={panel}>
              <span style={label}>Protected actions</span>
              <p style={{ fontSize: 11, opacity: 0.7, margin: "0 0 6px" }}>
                Production publishing, secrets, auth changes, production databases, paid services and LÉLU CORE changes
                need your decision here. LÉLU can request one; she cannot approve it.
              </p>
              <input
                style={{ ...input, marginBottom: 6 }}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-label="Approval reason"
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <button type="button" style={button()} onClick={() => void requestProductionApproval(selected)}>
                  Request production approval
                </button>
                <button type="button" style={button()} onClick={() => void deploy(selected, "preview")} disabled={Boolean(busy)}>
                  Prepare preview deployment
                </button>
                <button type="button" style={button(true)} onClick={() => void deploy(selected, "production")} disabled={Boolean(busy)}>
                  Prepare production deployment
                </button>
              </div>
              {approvalList.length === 0 ? (
                <p style={{ fontSize: 11, opacity: 0.6, margin: 0 }}>No approvals have been requested for this project.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {approvalList.map((approval) => {
                    const id = String(approval.id);
                    const status = String(approval.status);
                    return (
                      <div key={id} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, padding: 8 }}>
                        <p style={{ fontSize: 11, margin: "0 0 4px" }}>
                          <strong>{PROTECTED_ACTION_LABELS[approval.action as ProtectedAction] ?? String(approval.action)}</strong>{" "}
                          · {status}
                        </p>
                        <p style={{ fontSize: 10.5, opacity: 0.65, margin: "0 0 6px" }}>{String(approval.reason ?? "")}</p>
                        {status === "pending" ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="button" style={button(true)} onClick={() => void decide(selected, id, "approved")}>
                              Approve as {identity()}
                            </button>
                            <button type="button" style={button()} onClick={() => void decide(selected, id, "denied")}>
                              Deny
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, opacity: 0.6 }}>
                            decided by {String(approval.decidedBy ?? "—")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <span style={label}>Deployment records</span>
                {selected.deployments.length === 0 ? (
                  <p style={{ fontSize: 11, opacity: 0.6, margin: 0 }}>Nothing prepared yet.</p>
                ) : (
                  selected.deployments.map((deployment) => (
                    <p key={deployment.id} style={{ fontSize: 10.5, opacity: 0.72, margin: "0 0 3px" }}>
                      {deployment.environment} · {deployment.status} · {deployment.target || "—"}
                      {deployment.note ? ` — ${deployment.note}` : ""}
                    </p>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <div style={panel}>
            <span style={label}>Session 3B assets</span>
            {selected.assets.length === 0 ? (
              <p style={{ fontSize: 11, opacity: 0.6, margin: 0 }}>
                No asset references loaded for this project. Games read Session 3B&apos;s forge ledger.
              </p>
            ) : (
              selected.assets.map((asset) => (
                <p key={asset.id} style={{ fontSize: 10.5, opacity: 0.75, margin: "0 0 3px" }}>
                  {asset.id} · {asset.state} · {asset.note}
                </p>
              ))
            )}
          </div>
        </>
      ) : null}
    </GenesisWindowFrame>
  );
}
