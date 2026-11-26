/**
 * ==========================================================
 * LÉLU — SELF-DEVELOPMENT LABORATORY (interface)
 *
 * One engineering environment in seven connected views, all of
 * them reading the real repository through plugins/labApi.ts:
 *
 *   REPOSITORY   the tree, the commits, the branches and search
 *   EDITOR       actual source of an isolated experiment, editable
 *   DIFF         the exact change, file by file, with its reason
 *   TIMELINE     discovery → research → branch → edit → test →
 *                commit, assembled from what the lab recorded
 *   RESEARCH     what the investigation looked at and concluded
 *   PREVIEW      the running experiment, in three viewports
 *   VERIFICATION the commands that ran, their exit codes and output
 *
 * Every panel reports the server's real answer, including
 * refusals. When the runtime is unreachable the workspace says
 * so instead of rendering an empty shell that looks healthy.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import LabClient, {
  type LabCommandResult,
  type LabCommit,
  type LabDiff,
  type LabDiscovery,
  type LabExperiment,
  type LabGenealogy,
  type LabJournalEntry,
  type LabSchedulerState,
  type LabStatus,
  type LabTreeEntry,
} from "../../../core/selfdev/lab/LabClient";

type View = "repository" | "editor" | "diff" | "timeline" | "research" | "preview" | "verification";

const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: "repository", label: "Repository", hint: "tree · commits · branches · search" },
  { id: "editor", label: "Editor", hint: "real source in the isolated copy" },
  { id: "diff", label: "Diff", hint: "exact change, file by file" },
  { id: "timeline", label: "Timeline", hint: "discovery → commit" },
  { id: "research", label: "Research", hint: "what was investigated" },
  { id: "preview", label: "Preview", hint: "the running experiment" },
  { id: "verification", label: "Verification", hint: "commands, exit codes, evidence" },
];

const card: CSSProperties = {
  border: "1px solid rgba(125, 211, 252, 0.16)",
  background: "rgba(2, 8, 23, 0.55)",
  borderRadius: 14,
  padding: "10px 12px",
};

const label: CSSProperties = {
  fontSize: 9.5,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  opacity: 0.6,
  display: "block",
  marginBottom: 4,
};

const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  lineHeight: 1.55,
};

const button = (active = false): CSSProperties => ({
  border: `1px solid ${active ? "rgba(165, 243, 252, 0.6)" : "rgba(255,255,255,0.16)"}`,
  background: active ? "rgba(34, 211, 238, 0.18)" : "rgba(255,255,255,0.05)",
  color: "white",
  borderRadius: 999,
  padding: "5px 11px",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
});

const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 9,
  padding: "6px 9px",
  color: "white",
  fontSize: 11.5,
  fontFamily: "ui-monospace, monospace",
  outline: "none",
};

const SEVERITY_COLOR: Record<string, string> = {
  high: "#f87171",
  medium: "#fbbf24",
  low: "#7dd3fc",
  info: "#94a3b8",
};

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "2px 0" }}>
      <span style={{ ...label, marginBottom: 0, minWidth: 92 }}>{name}</span>
      <span style={{ fontSize: 11.5, wordBreak: "break-all" }}>{children}</span>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        border: `1px solid ${color}66`,
        color,
        borderRadius: 999,
        padding: "1px 7px",
        fontSize: 9.5,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {text}
    </span>
  );
}

/** A tiny, real tokenizer — keywords, strings, comments and numbers. */
function highlight(source: string): ReactNode[] {
  const tokens = source.split(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b(?:export|import|from|const|let|function|return|if|else|for|of|new|await|async|class|interface|type|extends|implements|throw|try|catch|finally|default|switch|case|break|continue|while|do|null|undefined|true|false|this|void|switch|as|satisfies|readonly|public|private|static|enum)\b)/g);
  return tokens.map((token, index) => {
    if (!token) return null;
    let color = "#dbeafe";
    if (token.startsWith("//") || token.startsWith("/*")) color = "#64748b";
    else if (/^["'`]/.test(token)) color = "#86efac";
    else if (/^\d/.test(token)) color = "#fbbf24";
    else if (/^[a-z]/.test(token)) color = "#c4b5fd";
    return (
      <span key={index} style={{ color }}>
        {token}
      </span>
    );
  });
}

function PatchView({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre style={{ ...mono, margin: 0, overflowX: "auto", whiteSpace: "pre" }}>
      {lines.map((line, index) => {
        const added = line.startsWith("+") && !line.startsWith("+++");
        const removed = line.startsWith("-") && !line.startsWith("---");
        const header = line.startsWith("@@") || line.startsWith("diff --git") || line.startsWith("index ");
        return (
          <div
            key={index}
            style={{
              background: added ? "rgba(34,197,94,0.14)" : removed ? "rgba(248,113,113,0.14)" : "transparent",
              color: added ? "#bbf7d0" : removed ? "#fecaca" : header ? "#93c5fd" : "#cbd5e1",
              paddingLeft: 6,
              paddingRight: 6,
            }}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export default function GenesisSelfDevelopmentLab() {
  const client = useMemo(() => LabClient.getInstance(), []);

  const [view, setView] = useState<View>("repository");
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [scheduler, setScheduler] = useState<LabSchedulerState | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [discovery, setDiscovery] = useState<LabDiscovery | null>(null);
  const [experiment, setExperiment] = useState<LabExperiment | null>(null);
  const [diff, setDiff] = useState<LabDiff | null>(null);
  const [commits, setCommits] = useState<LabCommit[]>([]);
  const [journal, setJournal] = useState<LabJournalEntry[]>([]);
  const [evidence, setEvidence] = useState<Array<{ path: string; name: string; bytes: number }>>([]);
  const [results, setResults] = useState<LabCommandResult[]>([]);

  const [treePath, setTreePath] = useState("");
  const [tree, setTree] = useState<LabTreeEntry[]>([]);
  const [viewingPath, setViewingPath] = useState<string | null>(null);
  const [viewingText, setViewingText] = useState("");
  const [genealogy, setGenealogy] = useState<LabGenealogy | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ path: string; line: number; text: string }>>([]);

  const [editPath, setEditPath] = useState("plugins/engineerApi.ts");
  const [editText, setEditText] = useState("");
  const [dirtyEditor, setDirtyEditor] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [viewport, setViewport] = useState<"desktop" | "portrait" | "landscape">("desktop");
  const frame = useRef<HTMLIFrameElement | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const next = await client.status(true);
      setStatus(next);
      setScheduler(next.scheduler ?? null);
      setRuntimeError(null);
      /*
       * The newest experiment, not the oldest. `experiments[0]` was the first
       * one ever opened, so with several experiments the Editor, Diff and
       * Preview views inspected a different experiment than the one just
       * verified — and there was no way to choose another.
       */
      const newest = next.experiments[next.experiments.length - 1] ?? null;
      setExperiment((current) => {
        if (!newest) return null;
        return current && next.experiments.some((candidate) => candidate.id === current.id) ? current : newest;
      });
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [client]);

  const refreshExperiment = useCallback(
    async (id: string) => {
      const [diffResult, list] = await Promise.all([client.experimentDiff(id), client.listExperiments()]);
      setDiff(diffResult.diff);
      setExperiment(list.experiments.find((candidate) => candidate.id === id) ?? null);
    },
    [client],
  );

  /*
   * Each read is independent: one route being unavailable must not blank the
   * other two. (Measured: a POST to the GET-only journal route rejected, the
   * shared Promise.all dropped commits and tree with it, and the view rendered
   * an empty repository that looked like a repository with nothing in it.)
   */
  const loadRepository = useCallback(async () => {
    const [commitResult, treeResult, journalResult] = await Promise.allSettled([
      client.commits(12),
      client.tree(""),
      client.journal(),
    ]);
    if (commitResult.status === "fulfilled") setCommits(commitResult.value.commits);
    if (treeResult.status === "fulfilled") {
      setTree(treeResult.value.entries);
      setTreePath("");
    }
    if (journalResult.status === "fulfilled") setJournal(journalResult.value.entries);
    const failure = [commitResult, treeResult, journalResult].find((result) => result.status === "rejected");
    if (failure && failure.status === "rejected") {
      setNotice(`✗ ${failure.reason instanceof Error ? failure.reason.message : String(failure.reason)}`);
    }
  }, [client]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status) return;
    void loadRepository().catch(() => undefined);
    void client
      .evidence()
      .then((result) => setEvidence(result.files))
      .catch(() => undefined);
    void client
      .discoveries()
      .then((result) => setDiscovery(result.discoveries[0] ?? null))
      .catch(() => undefined);
  }, [status, client, loadRepository]);

  /*
   * Keyed on the experiment's ID, never on the experiment object.
   *
   * This effect used to depend on `experiment`, and its refresh set a NEW
   * object from the server every time — so the effect re-ran on its own
   * result, forever. The page re-rendered continuously, which made the
   * workspace feel unresponsive and starved the checks that were meant to
   * populate it.
   */
  const experimentId = experiment?.id ?? null;
  useEffect(() => {
    if (!experimentId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [diffResult, list] = await Promise.all([
          client.experimentDiff(experimentId),
          client.listExperiments(),
        ]);
        if (cancelled) return;
        setDiff(diffResult.diff);
        setExperiment(list.experiments.find((candidate) => candidate.id === experimentId) ?? null);
      } catch {
        /* the panel keeps the last known state rather than blanking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [experimentId, client]);

  const act = useCallback(async (name: string, run: () => Promise<string | void>) => {
    setBusy(name);
    setNotice(null);
    try {
      const message = await run();
      if (message) setNotice(message);
    } catch (error) {
      setNotice(`✗ ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  if (runtimeError) {
    return (
      <div style={{ ...card, borderColor: "rgba(248,113,113,0.35)" }} data-lab="unavailable">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <Badge text="laboratory offline" color="#f87171" />
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.86 }}>
          {runtimeError}
          <br />
          The laboratory performs real git, filesystem and process operations, so it only exists on a runtime that can do
          them (the development server or the standalone server). Nothing is simulated in its place.
        </div>
      </div>
    );
  }

  if (!status) {
    return <div style={{ fontSize: 12, opacity: 0.65 }}>Reading the repository…</div>;
  }

  const repo = status.repository;
  const openFile = async (path: string) => {
    await act(`open ${path}`, async () => {
      const file = await client.file(path);
      setViewingPath(file.path);
      setViewingText(file.content);
      setGenealogy(null);
      setView("editor");
    });
  };

  const currentFindings = discovery?.findings ?? [];

  return (
    <div data-lab="root" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/*
        The companion deliberately stands above workspace windows (she stays
        seen) and the orbital navigation deliberately stands above them too
        (a panel must never cover the way out). Neither is this panel's to
        change, so the laboratory leaves them their space instead of putting
        columns underneath them: a right margin where she rests on a wide
        screen, and a bottom margin for the navigation band.
      */}
      <style>{`
        [data-lab="root"] { padding-bottom: 96px; }
        @media (min-width: 1100px) { [data-lab="root"] { padding-right: 168px; } }
      `}</style>
      {/* ---------------------------- header ---------------------------- */}
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <Badge text={status.github.reachable ? "github reachable" : "github unreachable"} color={status.github.reachable ? "#34d399" : "#f87171"} />
        <span style={{ ...mono, fontSize: 10.5, opacity: 0.8 }}>
          {repo.fullName || repo.remote} · {repo.branch} @ {repo.head.shortSha}
        </span>
        <span style={{ ...mono, fontSize: 10.5, opacity: 0.6 }}>
          {repo.branches} branches · {status.github.heads} remote heads · {repo.dirty} uncommitted
        </span>
        {status.experiments.length > 0 ? (
          <label style={{ ...mono, fontSize: 10.5, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ opacity: 0.65 }}>experiment</span>
            <select
              data-lab="experiment-select"
              value={experiment?.id ?? ""}
              onChange={(event) => {
                const next = status.experiments.find((candidate) => candidate.id === event.target.value) ?? null;
                setExperiment(next);
                if (next) void refreshExperiment(next.id);
              }}
              style={{ ...mono, fontSize: 10.5, background: "rgba(10,14,22,0.9)", color: "#e7edf7", border: "1px solid rgba(148,163,184,0.35)", borderRadius: 6, padding: "2px 4px", maxWidth: 230 }}
            >
              {status.experiments.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id} · {candidate.status ?? "open"}{candidate.commit ? ` · ${candidate.commit.sha.slice(0, 7)}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <button
            type="button"
            style={button()}
            disabled={busy !== null}
            onClick={() =>
              act("sync", async () => {
                const result = await client.sync();
                await loadStatus();
                return result.ok
                  ? `✓ Synced ${result.sync.remoteHeads.length} remote heads at ${new Date(result.sync.at).toLocaleTimeString()}.`
                  : `✗ Sync failed: ${result.sync.error ?? "unknown error"}`;
              })
            }
          >
            {busy === "sync" ? "Syncing…" : "Sync repository"}
          </button>
          <button
            type="button"
            style={button(true)}
            disabled={busy !== null}
            onClick={() =>
              act("inspect", async () => {
                const result = await client.inspect();
                setDiscovery(result.discovery);
                setView("research");
                return `✓ Discovery ${result.discovery.id} · ${result.discovery.findings.length} finding(s) · priority ${result.discovery.priority.score}/100.`;
              })
            }
          >
            {busy === "inspect" ? "Investigating…" : "Run discovery"}
          </button>
        </div>
      </div>

      {notice ? (
        <div style={{ ...card, padding: "7px 11px", fontSize: 11.5, borderColor: notice.startsWith("✗") ? "rgba(248,113,113,0.4)" : "rgba(52,211,153,0.35)" }}>
          {notice}
        </div>
      ) : null}

      {/* ------------------- daily cycle (browser-independent) ------------------- */}
      <div
        style={{ ...card, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 11px" }}
        data-lab="scheduler"
      >
        <Badge
          text={scheduler?.running ? "daily cycle running" : "daily cycle stopped"}
          color={scheduler?.running ? "#34d399" : "#fbbf24"}
        />
        <span style={{ ...mono, fontSize: 10.5, opacity: 0.75, minWidth: 200, flex: "1 1 260px" }}>
          {scheduler
            ? `${scheduler.mode} · ${scheduler.cycles} cycle(s)${
                scheduler.lastCycleAt ? ` · last ${new Date(scheduler.lastCycleAt).toLocaleString()}` : " · never run"
              }${scheduler.nextAt ? ` · next ${new Date(scheduler.nextAt).toLocaleString()}` : ""}${
                scheduler.lastError ? ` · last error: ${scheduler.lastError.slice(0, 120)}` : ""
              }`
            : "This runtime did not report a scheduler."}
        </span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <button
            type="button"
            style={button()}
            disabled={busy !== null || scheduler?.running === true}
            onClick={() =>
              act("scheduler-start", async () => {
                const result = await client.startScheduler();
                setScheduler(result.scheduler);
                return result.spawned
                  ? `✓ Daily cycle started as pid ${result.spawned} — it keeps running when this window closes.`
                  : "✓ Scheduler start accepted.";
              })
            }
          >
            {busy === "scheduler-start" ? "Starting…" : "Start daily cycle"}
          </button>
          <button
            type="button"
            style={button()}
            disabled={busy !== null || !scheduler?.pid}
            onClick={() =>
              act("scheduler-stop", async () => {
                const result = await client.stopScheduler();
                setScheduler(result.scheduler);
                return `✓ Stopped the daily cycle (pid ${result.stopped}).`;
              })
            }
          >
            {busy === "scheduler-stop" ? "Stopping…" : "Stop"}
          </button>
          <button
            type="button"
            style={button()}
            disabled={busy !== null}
            onClick={() =>
              act("scheduler-once", async () => {
                const result = await client.runCycle();
                setScheduler(result.scheduler);
                setDiscovery(result.discovery);
                return `✓ Cycle complete · ${result.discovery.findings.length} finding(s) · priority ${result.discovery.priority.score}/100 · ${result.discovery.status}.`;
              })
            }
          >
            {busy === "scheduler-once" ? "Cycling…" : "Run one cycle now"}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 10.5, opacity: 0.6, lineHeight: 1.5 }} data-lab="chat-tools">
        Ask in chat: “show me the exact diff” · “what did you discover today” · “run verification on this experiment” ·
        “show me your development history” — the laboratory answers through the same conversation you are in.
      </div>

      {/* ----------------------------- views ---------------------------- */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-lab="views">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setView(entry.id)}
            className={view === entry.id ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
            style={{ borderRadius: 999, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
            title={entry.hint}
          >
            {entry.label}
            {entry.id === "diff" && diff ? ` · ${diff.files.length}` : ""}
            {entry.id === "research" && currentFindings.length ? ` · ${currentFindings.length}` : ""}
            {entry.id === "verification" && results.length ? ` · ${results.filter((r) => r.ok).length}/${results.length}` : ""}
          </button>
        ))}
      </div>

      {/* =========================== REPOSITORY ========================== */}
      {view === "repository" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(240px, 1.2fr)", gap: 10 }} data-lab="repository">
          <div style={card}>
            <Row name="Remote">{repo.remote}</Row>
            <Row name="Branch">{repo.branch}</Row>
            <Row name="Head">
              {repo.head.shortSha} — {repo.head.subject}
            </Row>
            <Row name="Author">{repo.head.author}</Row>
            <Row name="Committed">{new Date(repo.head.date).toLocaleString()}</Row>
            <Row name="Ahead / behind">
              {repo.ahead} / {repo.behind}
            </Row>
            <Row name="Last sync">
              {status.sync ? `${new Date(status.sync.at).toLocaleTimeString()} · ${status.sync.ok ? "ok" : status.sync.error ?? "failed"}` : "never"}
            </Row>

            <div style={{ marginTop: 8 }}>
              <span style={label}>Search the tree</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="e.g. ENGINEER_OPERATIONS"
                  style={input}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && query.trim().length > 1) {
                      void act("search", async () => {
                        const result = await client.search(query.trim());
                        setHits(result.hits);
                        return `${result.hits.length} hit(s) for “${result.query}”.`;
                      });
                    }
                  }}
                />
                <button
                  type="button"
                  style={button()}
                  disabled={busy !== null || query.trim().length < 2}
                  onClick={() =>
                    act("search", async () => {
                      const result = await client.search(query.trim());
                      setHits(result.hits);
                      return `${result.hits.length} hit(s) for “${result.query}”.`;
                    })
                  }
                >
                  Find
                </button>
              </div>
              <div style={{ maxHeight: 150, overflowY: "auto", marginTop: 6 }}>
                {hits.map((hit, index) => (
                  <button
                    key={`${hit.path}:${hit.line}:${index}`}
                    type="button"
                    onClick={() => void openFile(hit.path)}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", padding: "2px 0", color: "#bae6fd", ...mono, fontSize: 10 }}
                  >
                    {hit.path}:{hit.line} · {hit.text.slice(0, 46)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={label}>Tree · /{treePath}</span>
                {treePath ? (
                  <button type="button" style={button()} onClick={() => void act("tree", async () => {
                    const parent = treePath.split("/").slice(0, -1).join("/");
                    const result = await client.tree(parent);
                    setTree(result.entries);
                    setTreePath(parent);
                  })}>
                    ↑ up
                  </button>
                ) : null}
              </div>
              <div style={{ maxHeight: 168, overflowY: "auto" }}>
                {tree.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() =>
                      void act("tree", async () => {
                        if (entry.type === "dir") {
                          const result = await client.tree(entry.path);
                          setTree(result.entries);
                          setTreePath(entry.path);
                          return `${result.entries.length} entr(ies) in ${entry.path}.`;
                        }
                        await openFile(entry.path);
                      })
                    }
                    style={{ display: "flex", gap: 6, width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", color: entry.type === "dir" ? "#a5f3fc" : "#cbd5e1", padding: "1px 0", ...mono, fontSize: 10.5 }}
                  >
                    <span style={{ opacity: 0.7 }}>{entry.type === "dir" ? "▸" : "·"}</span>
                    {entry.name}
                    {entry.size ? <span style={{ marginLeft: "auto", opacity: 0.45 }}>{Math.round(entry.size / 1024)}K</span> : null}
                  </button>
                ))}
              </div>
            </div>

            <div style={card}>
              <span style={label}>Commits · {commits.length}</span>
              <div style={{ maxHeight: 190, overflowY: "auto" }}>
                {commits.map((commit) => (
                  <div key={commit.sha} style={{ padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ ...mono, fontSize: 10.5, color: "#e2e8f0" }}>
                      <span style={{ color: "#7dd3fc" }}>{commit.short}</span> {commit.subject.slice(0, 74)}
                    </div>
                    <div style={{ fontSize: 9.5, opacity: 0.5 }}>
                      {commit.author} · {new Date(commit.date).toLocaleDateString()} · {commit.files.length} file(s)
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ============================= EDITOR ============================ */}
      {view === "editor" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 10 }} data-lab="editor">
          <div style={card}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <input value={editPath} onChange={(event) => setEditPath(event.target.value)} style={{ ...input, flex: 1, minWidth: 180 }} />
              <button
                type="button"
                style={button()}
                disabled={busy !== null || !experiment}
                onClick={() =>
                  act("load-file", async () => {
                    if (!experiment) return "Create an experiment first.";
                    const file = await client.readExperiment(experiment.id, editPath);
                    if (file.content === null) return `✗ ${editPath} does not exist in the experiment.`;
                    setEditText(file.content);
                    setDirtyEditor(false);
                    return `Loaded ${editPath} from ${experiment.branch}.`;
                  })
                }
              >
                Load
              </button>
              <button
                type="button"
                style={button(true)}
                disabled={busy !== null || !experiment || !dirtyEditor}
                onClick={() =>
                  act("save-file", async () => {
                    if (!experiment) return "Create an experiment first.";
                    const written = await client.writeExperiment(experiment.id, editPath, editText);
                    setDirtyEditor(false);
                    await refreshExperiment(experiment.id);
                    return `Saved ${written.chars} characters to ${written.path} — the canonical tree is untouched.`;
                  })
                }
              >
                {busy === "save-file" ? "Saving…" : "Save to experiment"}
              </button>
            </div>
            {dirtyEditor ? <div style={{ fontSize: 10, color: "#fbbf24", marginBottom: 4 }}>Unsaved edits in the experiment copy.</div> : null}
            <textarea
              value={editText}
              onChange={(event) => {
                setEditText(event.target.value);
                setDirtyEditor(true);
              }}
              spellCheck={false}
              placeholder={experiment ? `Load a file from ${experiment.branch} to edit it.` : "Create an experiment to begin."}
              style={{ ...input, minHeight: 300, maxHeight: "min(46vh, 420px)", resize: "vertical", whiteSpace: "pre" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={card}>
              <span style={label}>Highlighted source</span>
              <pre style={{ ...mono, margin: 0, maxHeight: 150, overflow: "auto", background: "rgba(2,6,23,0.5)", borderRadius: 8, padding: 8 }}>
                {highlight(editText.slice(0, 4000))}
              </pre>
            </div>
            <div style={card}>
              <span style={label}>Reading the canonical tree</span>
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>{viewingPath ?? "Nothing opened yet."}</div>
              <pre style={{ ...mono, margin: 0, maxHeight: 150, overflow: "auto", background: "rgba(2,6,23,0.5)", borderRadius: 8, padding: 8 }}>
                {viewingText ? highlight(viewingText.slice(0, 2500)) : "Open a file from the Repository tree."}
              </pre>
              <button
                type="button"
                style={{ ...button(), marginTop: 6 }}
                disabled={!viewingPath || busy !== null}
                onClick={() =>
                  act("genealogy", async () => {
                    if (!viewingPath) return "Open a file first.";
                    const result = await client.genealogy(viewingPath);
                    setGenealogy(result.genealogy);
                    return `Genealogy for ${result.genealogy.path}: ${result.genealogy.history.length} commit(s).`;
                  })
                }
              >
                Where did this come from?
              </button>
              {genealogy ? (
                <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.6 }} data-lab="genealogy">
                  <div>origin: {genealogy.origin ? `${genealogy.origin.commit} by ${genealogy.origin.author}, ${new Date(genealogy.origin.date).toLocaleDateString()}` : "not in history"}</div>
                  <div>last change: {genealogy.lastChange ? `${genealogy.lastChange.commit} — ${genealogy.lastChange.subject.slice(0, 44)}` : "—"}</div>
                  <div>branches containing it: {genealogy.branches.join(", ") || "—"}</div>
                  <div>contributors: {genealogy.contributors.map((entry) => `${entry.author} (${entry.commits})`).join(", ") || "—"}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ============================== DIFF ============================= */}
      {view === "diff" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-lab="diff">
          <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge text={diff ? `${diff.files.length} file(s) changed` : "no diff"} color={diff && diff.files.length ? "#34d399" : "#94a3b8"} />
            {experiment ? <span style={{ ...mono, fontSize: 10.5, opacity: 0.75 }}>{experiment.branch}</span> : null}
            {diff ? <span style={{ ...mono, fontSize: 10.5, opacity: 0.6 }}>baseline {diff.baseCommit.slice(0, 7)} → head {diff.head.slice(0, 7)}</span> : null}
            <button
              type="button"
              style={{ ...button(), marginLeft: "auto" }}
              disabled={busy !== null || !experiment}
              onClick={() =>
                act("diff", async () => {
                  if (!experiment) return "No experiment.";
                  await refreshExperiment(experiment.id);
                  return "Diff refreshed from git.";
                })
              }
            >
              Refresh diff
            </button>
          </div>

          {!experiment ? (
            <div style={{ ...card, fontSize: 11.5, opacity: 0.8 }}>
              No experiment exists yet. The Diff view compares an isolated branch against its own baseline, so it needs
              one: create it in the Verification view.
            </div>
          ) : null}

          {(diff?.files ?? []).map((file) => (
            <div key={file.path} style={card}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ ...mono, fontSize: 11 }}>{file.path}</span>
                <Badge text={file.status} color="#7dd3fc" />
                <span style={{ ...mono, fontSize: 10, color: "#86efac" }}>+{file.addedLines}</span>
                <span style={{ ...mono, fontSize: 10, color: "#fca5a5" }}>−{file.removedLines}</span>
              </div>
              <PatchView patch={file.patch} />
            </div>
          ))}

          {diff && diff.files.length === 0 ? (
            <div style={{ ...card, fontSize: 11.5, opacity: 0.8 }}>The experiment matches its baseline exactly — no change has been made yet.</div>
          ) : null}
        </div>
      ) : null}

      {/* ============================= TIMELINE ========================== */}
      {view === "timeline" ? (
        <div style={{ ...card }} data-lab="timeline">
          <span style={label}>Engineering timeline · newest first</span>
          {journal.length === 0 ? (
            <div style={{ fontSize: 11.5, opacity: 0.75 }}>
              Nothing recorded yet. Sync the repository, run a discovery, then create an experiment — each step is
              written to the laboratory journal as it happens.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 380, overflowY: "auto" }}>
              {journal.map((entry, index) => {
                const stage =
                  entry.kind === "sync"
                    ? "Repository synced"
                    : entry.kind === "discovery"
                      ? "Discovery"
                      : entry.kind === "experiment-created"
                        ? "Branch created"
                        : entry.kind === "experiment-write"
                          ? "Implementation"
                          : entry.kind === "experiment-command"
                            ? `Testing — ${String(entry.command)} ${entry.ok === true ? "passed" : "failed"}`
                            : entry.kind === "experiment-commit"
                              ? "Commit"
                              : entry.kind === "preview-started"
                                ? "Preview running"
                                : entry.kind === "screenshot"
                                  ? "Evidence captured"
                                  : entry.kind === "screenshot-unavailable"
                                    ? "Evidence capture unavailable"
                                    : entry.kind;
                const detail = Object.entries(entry)
                  .filter(([key]) => !["kind", "at"].includes(key))
                  .map(([key, value]) => `${key}=${String(value).slice(0, 48)}`)
                  .join(" · ");
                return (
                  <div key={index} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ ...mono, fontSize: 10, color: "#7dd3fc", minWidth: 62 }}>
                      {new Date(Number(entry.at)).toLocaleTimeString()}
                    </span>
                    <span style={{ ...mono, fontSize: 10.5, color: "#e2e8f0", minWidth: 170 }}>{stage}</span>
                    <span style={{ ...mono, fontSize: 9.5, opacity: 0.55, wordBreak: "break-all" }}>{detail}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* ============================= RESEARCH ========================== */}
      {view === "research" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-lab="research">
          {!discovery ? (
            <div style={{ ...card, fontSize: 11.5, opacity: 0.8 }}>Run a discovery to see what the investigation found.</div>
          ) : (
            <>
              <div style={card}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                  <Badge text={`priority ${discovery.priority.score}/100`} color={SEVERITY_COLOR[discovery.priority.severity]} />
                  <Badge text={discovery.status} color="#94a3b8" />
                  <span style={{ ...mono, fontSize: 10, opacity: 0.65 }}>
                    {discovery.id} · {discovery.repository} @ {discovery.commit.slice(0, 7)}
                  </span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55 }}>{discovery.recommendedAction}</div>
                <div style={{ ...mono, fontSize: 9.5, opacity: 0.55, marginTop: 3 }}>{discovery.priority.rationale}</div>
              </div>

              {discovery.findings.map((finding) => (
                <div key={finding.id} style={card}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                    <Badge text={finding.severity} color={SEVERITY_COLOR[finding.severity]} />
                    <span style={{ fontSize: 12 }}>{finding.title}</span>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.5 }}>{finding.detail}</div>
                  <ul style={{ margin: "5px 0 0", paddingLeft: 16, ...mono, fontSize: 10, color: "#bae6fd" }}>
                    {finding.evidence.slice(0, 6).map((line, index) => (
                      <li key={index} style={{ marginBottom: 2 }}>{line}</li>
                    ))}
                  </ul>
                  {finding.files.length ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                      {finding.files.slice(0, 5).map((file) => (
                        <button key={file} type="button" style={{ ...button(), fontSize: 10 }} onClick={() => void openFile(file)}>
                          {file.split("/").slice(-1)[0]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}

              {discovery.research.map((note, index) => (
                <div key={index} style={card}>
                  <span style={label}>Research · {note.kind}</span>
                  <div style={{ fontSize: 11.5 }}>{note.question}</div>
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 3, lineHeight: 1.5 }}>{note.conclusion}</div>
                  <div style={{ ...mono, fontSize: 9.5, opacity: 0.55, marginTop: 4 }}>sources: {note.sources.join(", ")}</div>
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}

      {/* ============================= PREVIEW =========================== */}
      {view === "preview" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-lab="preview">
          <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge text={experiment?.preview ? `live :${experiment.preview.port}` : "stopped"} color={experiment?.preview ? "#34d399" : "#94a3b8"} />
            {experiment?.preview ? <span style={{ ...mono, fontSize: 10 }}>{experiment.preview.url}</span> : null}
            <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
              {(["desktop", "portrait", "landscape"] as const).map((mode) => (
                <button key={mode} type="button" style={button(viewport === mode)} onClick={() => setViewport(mode)}>
                  {mode === "desktop" ? "1440×900" : mode === "portrait" ? "390×844" : "844×390"}
                </button>
              ))}
              <button
                type="button"
                style={button(true)}
                disabled={busy !== null || !experiment}
                onClick={() =>
                  act("preview", async () => {
                    if (!experiment) return "No experiment.";
                    const result = await client.startPreview(experiment.id, 3002);
                    await refreshExperiment(experiment.id);
                    return `✓ Experimental preview answering at ${result.preview.url} (pid ${result.preview.pid}).`;
                  })
                }
              >
                {busy === "preview" ? "Starting…" : "Start preview"}
              </button>
              <button
                type="button"
                style={button()}
                disabled={busy !== null || !experiment?.preview}
                onClick={() =>
                  act("preview-stop", async () => {
                    if (!experiment) return "No experiment.";
                    await client.stopPreview(experiment.id);
                    await refreshExperiment(experiment.id);
                    return "Preview stopped.";
                  })
                }
              >
                Stop
              </button>
            </div>
          </div>

          {experiment?.preview ? (
            <div style={{ ...card, display: "flex", justifyContent: "center", overflow: "auto", maxHeight: "min(52vh, 460px)" }}>
              <iframe
                ref={frame}
                title="Experimental preview"
                src={experiment.preview.url}
                style={{
                  width: viewport === "desktop" ? 900 : viewport === "portrait" ? 390 : 844,
                  height: viewport === "portrait" ? 700 : 480,
                  border: "1px solid rgba(125,211,252,0.2)",
                  borderRadius: 10,
                  background: "#020617",
                }}
              />
            </div>
          ) : (
            <div style={{ ...card, fontSize: 11.5, opacity: 0.8 }}>
              The preview serves the experiment's own branch on a separate port. Start it to interact with the modified
              application while the canonical one keeps running untouched.
            </div>
          )}

          <div style={{ ...card }}>
            <span style={label}>Captured evidence · {evidence.length} image(s)</span>
            {evidence.length === 0 ? (
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                No screenshots in docs/missions/evidence/mission-43 yet.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
                {evidence.map((file) => (
                  <figure key={file.path} style={{ margin: 0 }}>
                    <img src={`/${file.path}`} alt={file.name} style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(125,211,252,0.2)" }} />
                    <figcaption style={{ ...mono, fontSize: 9, opacity: 0.6, marginTop: 2 }}>{file.name}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* =========================== VERIFICATION ======================== */}
      {view === "verification" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-lab="verification">
          <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {experiment ? (
              <span style={{ ...mono, fontSize: 10.5 }}>
                {experiment.branch} · baseline {(experiment.baselineCommit ?? experiment.baseCommit).slice(0, 7)}
              </span>
            ) : (
              <span style={{ fontSize: 11 }}>No experiment yet.</span>
            )}
            <button
              type="button"
              style={{ ...button(true), marginLeft: "auto" }}
              disabled={busy !== null}
              onClick={() =>
                act("create", async () => {
                  const created = await client.createExperiment();
                  setExperiment(created.experiment);
                  setDiscovery(discovery);
                  await loadStatus();
                  return `✓ Experiment ${created.experiment.id} on ${created.experiment.branch}, from ${created.experiment.baseBranch}@${created.experiment.baseCommit.slice(0, 7)}.`;
                })
              }
            >
              {busy === "create" ? "Copying…" : "New experiment copy"}
            </button>
          </div>

          <div style={{ ...card }}>
            <span style={label}>Run a check inside the experiment</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {status.commands.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  style={button()}
                  disabled={busy !== null || !experiment}
                  onClick={() =>
                    act(`run-${command.id}`, async () => {
                      if (!experiment) return "No experiment.";
                      const result = await client.runCommand(experiment.id, command.id);
                      setResults((current) => [result, ...current].slice(0, 8));
                      return `${result.ok ? "✓" : "✗"} ${result.label} exited ${result.status} in ${Math.round(result.durationMs / 1000)}s.`;
                    })
                  }
                >
                  {busy === `run-${command.id}` ? "Running…" : command.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 5 }}>
              Commands run with the experiment as their working directory — the canonical project is never the cwd of a
              check.
            </div>
          </div>

          {results.map((result, index) => (
            <div key={index} style={{ ...card, borderColor: result.ok ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.35)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                <Badge text={result.ok ? "passed" : "failed"} color={result.ok ? "#34d399" : "#f87171"} />
                <span style={{ ...mono, fontSize: 10.5 }}>{result.label}</span>
                <span style={{ ...mono, fontSize: 10, opacity: 0.6 }}>exit {result.status} · {Math.round(result.durationMs / 1000)}s</span>
              </div>
              <pre style={{ ...mono, margin: 0, maxHeight: 160, overflow: "auto", background: "rgba(2,6,23,0.55)", borderRadius: 8, padding: 8, fontSize: 10 }}>
                {`${result.stdout}\n${result.stderr}`.trim().slice(-4000) || "(no output)"}
              </pre>
            </div>
          ))}

          <div style={{ ...card }}>
            <span style={label}>Commit the experiment's change</span>
            <input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Why this change is correct, and how it was verified"
              style={{ ...input, fontFamily: "inherit" }}
            />
            <button
              type="button"
              style={{ ...button(true), marginTop: 6 }}
              disabled={busy !== null || !experiment || commitMessage.trim().length < 8}
              onClick={() =>
                act("commit", async () => {
                  if (!experiment) return "No experiment.";
                  const result = await client.commitExperiment(experiment.id, commitMessage.trim());
                  await refreshExperiment(experiment.id);
                  return `✓ Committed ${result.commit.slice(0, 10)} on ${result.branch} — ${result.files.length} file(s). Nothing was pushed.`;
                })
              }
            >
              {busy === "commit" ? "Committing…" : "Commit on the experiment branch"}
            </button>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 5 }}>
              A commit here reaches the experiment branch only. Pushing, merging and deploying are not implemented in
              the laboratory at all.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
