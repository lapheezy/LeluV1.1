/**
 * ==========================================================
 * LÉLU — VERIFIED UPDATES PANEL
 *
 * The visible half of the update pipeline. It shows the ten
 * states the pipeline actually passes through, the checks that
 * really ran (with their command and output), the changed files,
 * the commit git produced, and — separately — whether the
 * restarted application is healthy.
 *
 * Every claim on this panel is something the server measured:
 *   • "Commit verified" only when `git show` lists every path
 *   • "Applied" only when the runtime's generation advanced AND
 *     HEAD is that commit AND the app answered a page request
 *   • failures print the failing command's own output
 *
 * It never restarts on its own, and the Apply button states why
 * it is disabled instead of looking broken.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import UpdateRuntime, { type CandidatePath } from "../../../core/selfdev/UpdateRuntime";
import {
  ALL_CHECKS,
  applyDecision,
  describeJob,
  jobIsVerified,
  shortCommit,
  stageViews,
  type UpdateCheckId,
  type UpdateJob,
  type UpdateState,
} from "../../../core/selfdev/UpdateLifecycle";

interface Props {
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "rgba(148, 163, 184, 0.45)",
  running: "#67e8f9",
  done: "#34d399",
  failed: "#f87171",
  skipped: "rgba(148, 163, 184, 0.5)",
};

const GLYPH: Record<string, string> = {
  pending: "○",
  running: "●",
  done: "✓",
  failed: "✕",
  skipped: "–",
};

function labelStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(148, 163, 184, 0.7)",
    ...extra,
  };
}

export default function GenesisUpdatePanel({ onClose }: Props) {
  const runtime = useMemo(() => UpdateRuntime.getInstance(), []);
  const [state, setState] = useState<UpdateState | null>(() => runtime.getState());
  const [candidates, setCandidates] = useState<CandidatePath[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [checks, setChecks] = useState<UpdateCheckId[]>(ALL_CHECKS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [openCheck, setOpenCheck] = useState<string | null>(null);

  const reloadCandidates = useCallback(async () => {
    const list = await runtime.changeCandidates();
    setCandidates(list);
    setSelected((previous) => {
      const kept = previous.filter((path) => list.some((candidate) => candidate.path === path));
      return kept.length > 0 ? kept : list.map((candidate) => candidate.path);
    });
  }, [runtime]);

  useEffect(() => {
    const unsubscribe = runtime.subscribe(setState);
    const unwatch = runtime.watch();
    void reloadCandidates();
    return () => {
      unsubscribe();
      unwatch();
    };
  }, [runtime, reloadCandidates]);

  const job: UpdateJob | null = state?.job ?? null;
  const settledStage = job?.stage ?? "idle";
  useEffect(() => {
    if (settledStage === "failed" || settledStage === "applied") {
      void reloadCandidates();
    }
  }, [settledStage, job?.commit, reloadCandidates]);

  const facts = state?.facts ?? null;
  const decision = applyDecision(job, facts);
  const verified = jobIsVerified(job);
  const views = stageViews(job);

  const togglePath = (path: string) =>
    setSelected((previous) => (previous.includes(path) ? previous.filter((entry) => entry !== path) : [...previous, path]));

  const toggleCheck = (id: UpdateCheckId) =>
    setChecks((previous) => (previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]));

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setPatch(null);
    const outcome = await runtime.prepare({ message: message.trim(), paths: selected, checks });
    setBusy(false);
    if (!outcome.ok) setError(outcome.error ?? "The update could not be started.");
  }, [runtime, message, selected, checks]);

  const apply = useCallback(async () => {
    if (!job?.commit) return;
    setBusy(true);
    setError(null);
    setNotice("Restarting the runtime, then checking that the app answers…");
    const outcome = await runtime.apply(job.commit);
    setBusy(false);
    if (outcome.alreadyApplied) {
      setNotice("This update was already applied and healthy — nothing restarted.");
      return;
    }
    if (!outcome.ok) {
      setNotice(null);
      setError(outcome.error ?? "The update was not applied.");
      return;
    }
    setNotice("Update applied successfully. LÉLU is running the verified version.");
  }, [runtime, job?.commit]);

  const rollBack = useCallback(async () => {
    if (!job?.commit) return;
    setBusy(true);
    setError(null);
    const outcome = await runtime.rollback(job.commit);
    setBusy(false);
    setConfirmRollback(false);
    if (!outcome.ok) {
      setError(outcome.error ?? "The rollback did not happen.");
      return;
    }
    setNotice(
      `Reverted ${shortCommit(job.commit)} as a new commit (HEAD ${shortCommit(outcome.head)}). The running process still needs a restart to serve it.`,
    );
  }, [runtime, job?.commit]);

  const showPatch = useCallback(async () => {
    if (!job?.commit) return;
    setPatch("Loading the commit's patch…");
    setPatch(await runtime.patch(job.commit));
  }, [runtime, job?.commit]);

  const running = Boolean(job && !["applied", "failed", "ready", "commit-verified"].includes(job.stage));

  return (
    <GenesisWindowFrame title="LÉLU Updates" onClose={onClose}>
      {/* Scrolls its own content inside the window frame. Measured in a
          900px-tall viewport: the frame was 412px tall holding 1041px of
          content with overflow visible, so "Verify & commit" sat at y≈977
          — below the viewport and impossible to scroll to. Capping the
          panel and giving it its own scroll region makes every control
          below the fold reachable. */}
      <div
        data-lelu-update-panel
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          // `inherit` takes the frame's RESOLVED cap as a px length. A
          // percentage would resolve against the frame's height, which is
          // only set via max-height — not a definite height — so it silently
          // becomes `none` and the content overflows as before.
          maxHeight: "inherit",
          overflowY: "auto",
          overscrollBehavior: "contain",
          paddingRight: 4,
        }}
      >
        {/* ── runtime facts ── */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 12px",
            fontSize: 11,
            color: "rgba(203, 228, 255, 0.66)",
            lineHeight: 1.6,
          }}
        >
          <span>
            <strong style={{ color: "rgba(167, 139, 250, 0.9)" }}>runtime</strong> {facts?.runtime ?? "…"}
          </span>
          <span>
            <strong style={{ color: "rgba(167, 139, 250, 0.9)" }}>branch</strong> {facts?.branch ?? "…"}
          </span>
          <span data-lelu-update-head>
            <strong style={{ color: "rgba(167, 139, 250, 0.9)" }}>HEAD</strong> {shortCommit(facts?.head) || "—"}
          </span>
          <span>
            <strong style={{ color: "rgba(167, 139, 250, 0.9)" }}>restart</strong>{" "}
            {facts?.restartSupported ? "supported" : "not supported here"}
          </span>
          {facts?.authority ? <span>authority: {facts.authority}</span> : null}
        </div>

        {facts && !facts.available ? (
          <div style={{ fontSize: 12, color: "rgba(248, 191, 36, 0.9)", lineHeight: 1.55 }}>{facts.error}</div>
        ) : null}

        {/* ── the nine states, from the job record ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {views.map((view) => (
            <div
              key={view.id}
              data-lelu-update-stage={view.id}
              data-lelu-update-status={view.status}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                fontSize: 12,
                padding: "3px 0",
                color: view.status === "pending" ? "rgba(203, 228, 255, 0.4)" : "rgba(240, 244, 255, 0.92)",
              }}
            >
              <span aria-hidden style={{ color: STATUS_COLOR[view.status], width: 12, flexShrink: 0 }}>
                {GLYPH[view.status]}
              </span>
              <span style={{ minWidth: 132, fontWeight: view.status === "running" ? 700 : 500 }}>{view.label}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "rgba(148, 163, 184, 0.72)", overflowWrap: "anywhere" }}>
                {view.detail}
              </span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, color: "rgba(203, 228, 255, 0.72)" }} data-lelu-update-summary>
          {describeJob(job)}
        </div>

        {job?.failure ? (
          <pre
            data-lelu-update-failure
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 10,
              background: "rgba(248, 113, 113, 0.08)",
              border: "1px solid rgba(248, 113, 113, 0.3)",
              color: "rgba(252, 200, 200, 0.95)",
              fontSize: 11,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              maxHeight: 180,
              overflow: "auto",
            }}
          >
            {job.failure}
          </pre>
        ) : null}

        {notice ? (
          <div
            data-lelu-update-notice
            style={{ fontSize: 12, color: "rgba(52, 211, 153, 0.92)", lineHeight: 1.55 }}
          >
            {notice}
          </div>
        ) : null}
        {error ? (
          <div data-lelu-update-error style={{ fontSize: 12, color: "rgba(248, 113, 113, 0.92)", lineHeight: 1.55 }}>
            {error}
          </div>
        ) : null}

        {/* ── the change set that was measured ── */}
        {job && job.files.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={labelStyle()}>Change set · {job.files.length} file(s)</span>
            {job.files.map((file) => (
              <div
                key={file.path}
                data-lelu-update-file={file.path}
                style={{ display: "flex", gap: 8, fontSize: 11, color: "rgba(214, 228, 244, 0.8)", lineHeight: 1.5 }}
              >
                <span style={{ color: "rgba(167, 139, 250, 0.8)", width: 54, flexShrink: 0 }}>{file.status}</span>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{file.path}</span>
                <span style={{ color: "rgba(52, 211, 153, 0.85)" }}>+{file.addedLines}</span>
                <span style={{ color: "rgba(248, 113, 113, 0.85)" }}>−{file.removedLines}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* ── checks: the real commands and their output ── */}
        {job && job.checks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={labelStyle()}>Verification</span>
            {job.checks.map((check) => (
              <div key={check.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <button
                  type="button"
                  data-lelu-update-check={check.id}
                  data-lelu-update-check-ok={check.ok ? "true" : "false"}
                  onClick={() => setOpenCheck((current) => (current === check.id ? null : check.id))}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    background: "transparent",
                    border: "none",
                    padding: "2px 0",
                    fontFamily: "inherit",
                    fontSize: 11.5,
                    color: check.ok ? "rgba(52, 211, 153, 0.92)" : "rgba(248, 113, 113, 0.92)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span aria-hidden>{check.ok ? "✓" : "✕"}</span>
                  <span style={{ minWidth: 72 }}>{check.id}</span>
                  <span style={{ color: "rgba(148, 163, 184, 0.7)", flex: 1, overflowWrap: "anywhere" }}>{check.command}</span>
                  <span style={{ color: "rgba(148, 163, 184, 0.55)" }}>{Math.round(check.durationMs / 100) / 10}s</span>
                </button>
                {openCheck === check.id ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      borderRadius: 8,
                      background: "rgba(2, 6, 23, 0.7)",
                      color: "rgba(203, 228, 255, 0.75)",
                      fontSize: 10.5,
                      lineHeight: 1.5,
                      maxHeight: 200,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {(check.stdout || "") + (check.stderr ? `\n${check.stderr}` : "") || "(no output)"}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* ── verified commit: apply, inspect, roll back ── */}
        {verified && job?.commit ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span data-lelu-update-commit style={{ fontSize: 11.5, color: "rgba(52, 211, 153, 0.92)", width: "100%" }}>
              commit {shortCommit(job.commit)} · {job.commitPaths.length} path(s) confirmed by git
            </span>
            <button
              type="button"
              data-lelu-update-apply
              disabled={busy || running || (!decision.ok && !decision.alreadyApplied)}
              onClick={() => void apply()}
              style={{
                padding: "6px 16px",
                borderRadius: 999,
                border: "1px solid rgba(52, 211, 153, 0.6)",
                background: decision.ok ? "rgba(52, 211, 153, 0.18)" : "rgba(52, 211, 153, 0.06)",
                color: decision.ok ? "#34d399" : "rgba(52, 211, 153, 0.5)",
                fontSize: 11.5,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: decision.ok && !busy ? "pointer" : "not-allowed",
              }}
            >
              {decision.alreadyApplied ? "Applied ✓" : "Apply & Restart"}
            </button>
            <button
              type="button"
              data-lelu-update-diff
              onClick={() => void showPatch()}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "transparent",
                color: "rgba(203, 228, 255, 0.7)",
                fontSize: 11.5,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              Inspect diff
            </button>
            {job.appliedAt ? (
              confirmRollback ? (
                <button
                  type="button"
                  data-lelu-update-rollback-confirm
                  onClick={() => void rollBack()}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(248, 113, 113, 0.7)",
                    background: "rgba(248, 113, 113, 0.2)",
                    color: "#fca5a5",
                    fontSize: 11.5,
                    fontWeight: 700,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Revert {shortCommit(job.commit)} for good?
                </button>
              ) : (
                <button
                  type="button"
                  data-lelu-update-rollback
                  onClick={() => setConfirmRollback(true)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(248, 113, 113, 0.35)",
                    background: "transparent",
                    color: "rgba(248, 113, 113, 0.8)",
                    fontSize: 11.5,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Roll back
                </button>
              )
            ) : null}
            {!decision.ok && decision.reason ? (
              <span style={{ fontSize: 11, color: "rgba(248, 191, 36, 0.85)", width: "100%", lineHeight: 1.5 }}>
                {decision.reason}
              </span>
            ) : null}
          </div>
        ) : null}

        {patch !== null ? (
          <pre
            data-lelu-update-patch
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 10,
              background: "rgba(2, 6, 23, 0.72)",
              border: "1px solid rgba(167, 139, 250, 0.2)",
              color: "rgba(203, 228, 255, 0.8)",
              fontSize: 10.5,
              lineHeight: 1.5,
              maxHeight: 260,
              overflow: "auto",
              whiteSpace: "pre",
            }}
          >
            {patch}
          </pre>
        ) : null}

        {/* ── prepare a new update ── */}
        {!verified && !running ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>
            <span style={labelStyle()}>Prepare an update</span>
            {candidates.length === 0 ? (
              <div style={{ fontSize: 11.5, color: "rgba(203, 228, 255, 0.5)" }}>
                No changed files are in the working tree. Make a change (LÉLU's engineering chain writes into the
                project through workspace apply), then reopen this panel.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflow: "auto" }}>
                {candidates.map((candidate) => (
                  <label
                    key={candidate.path}
                    style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 11.5, color: "rgba(214, 228, 244, 0.85)" }}
                  >
                    <input
                      type="checkbox"
                      data-lelu-update-path={candidate.path}
                      checked={selected.includes(candidate.path)}
                      onChange={() => togglePath(candidate.path)}
                    />
                    <span style={{ color: "rgba(167, 139, 250, 0.75)", width: 56 }}>{candidate.status}</span>
                    <span style={{ overflowWrap: "anywhere" }}>{candidate.path}</span>
                  </label>
                ))}
              </div>
            )}

            <input
              type="text"
              data-lelu-update-message
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Commit message — what changed and why"
              style={{
                padding: "7px 10px",
                borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(2, 6, 23, 0.5)",
                color: "rgba(240, 244, 255, 0.92)",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {ALL_CHECKS.map((id) => (
                <label key={id} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: "rgba(203, 228, 255, 0.72)" }}>
                  <input
                    type="checkbox"
                    data-lelu-update-check-toggle={id}
                    checked={checks.includes(id)}
                    onChange={() => toggleCheck(id)}
                  />
                  {id}
                </label>
              ))}
            </div>

            <button
              type="button"
              data-lelu-update-verify
              disabled={busy || selected.length === 0 || !message.trim() || checks.length === 0}
              onClick={() => void verify()}
              style={{
                alignSelf: "flex-start",
                padding: "7px 18px",
                borderRadius: 999,
                border: "1px solid rgba(167, 139, 250, 0.55)",
                background: "rgba(167, 139, 250, 0.16)",
                color: "#d4c8ff",
                fontSize: 11.5,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: busy || selected.length === 0 || !message.trim() ? "not-allowed" : "pointer",
                opacity: busy || selected.length === 0 || !message.trim() ? 0.55 : 1,
              }}
            >
              Verify &amp; commit
            </button>
            <span style={{ fontSize: 10.5, color: "rgba(148, 163, 184, 0.6)", lineHeight: 1.5 }}>
              The checks run before anything is committed. A failing check leaves the files exactly where they are and
              creates no commit.
            </span>
          </div>
        ) : null}

        {/* ── applied updates on this runtime ── */}
        {state && state.history.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
            <span style={labelStyle()}>Applied on this runtime</span>
            {state.history.map((entry) => (
              <div key={`${entry.id}-${entry.commit}`} style={{ fontSize: 11, color: "rgba(203, 228, 255, 0.7)", lineHeight: 1.55 }}>
                <span style={{ color: entry.healthOk ? "rgba(52, 211, 153, 0.9)" : "rgba(248, 113, 113, 0.9)" }}>
                  {entry.healthOk ? "✓" : "✕"}
                </span>{" "}
                {shortCommit(entry.commit)} · {entry.message} · {entry.files} file(s) · {new Date(entry.at).toLocaleString()}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </GenesisWindowFrame>
  );
}
