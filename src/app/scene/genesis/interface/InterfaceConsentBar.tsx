/**
 * ==========================================================
 * LÉLU — INTERFACE CONSENT BAR
 *
 * Where the user exercises final authority over LÉLU's
 * interface changes:
 *
 *   • a proposal arrives → its preview is live on screen, and
 *     this bar says what it changes, why, which scopes, any
 *     warnings, and offers Approve / Reject / compare-with-live;
 *   • destructive proposals need an explicit extra
 *     confirmation before Approve is enabled;
 *   • after an approval → "Applied · Undo" for a few seconds;
 *   • History → every version (restore any), redo, the decision
 *     log, and per-scope permissions (ask / blocked).
 *
 * Phones: pinned to the top safe area, compact, scrollable,
 * every control ≥ 40px, never covering the chat composer.
 * ==========================================================
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import InterfaceOrchestrator, { INTERFACE_SCOPES, type InterfaceScope } from "../../../../core/interface/InterfaceOrchestrator";
import useInterface from "./useInterface";

const panel: CSSProperties = {
  position: "fixed",
  top: "calc(env(safe-area-inset-top, 0px) + 10px)",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(560px, calc(100vw - 16px))",
  maxHeight: "min(62dvh, 560px)",
  overflowY: "auto",
  overscrollBehavior: "contain",
  zIndex: 9000,
  pointerEvents: "auto",
  background: "rgba(8, 12, 28, 0.96)",
  border: "1px solid rgba(250, 204, 21, 0.45)",
  borderRadius: 16,
  boxShadow: "0 18px 60px rgba(2, 6, 23, 0.7)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  color: "#f1f5f9",
  padding: 14,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: 13,
  lineHeight: 1.45,
  letterSpacing: "normal",
  textAlign: "left",
};

const button = (tone: "primary" | "neutral" | "danger" = "neutral", disabled = false): CSSProperties => ({
  minHeight: 40,
  padding: "8px 14px",
  borderRadius: 999,
  border: tone === "primary" ? "1px solid rgba(74, 222, 128, 0.7)" : tone === "danger" ? "1px solid rgba(248, 113, 113, 0.6)" : "1px solid rgba(148, 163, 184, 0.35)",
  background: tone === "primary" ? "rgba(22, 163, 74, 0.28)" : tone === "danger" ? "rgba(220, 38, 38, 0.18)" : "rgba(255, 255, 255, 0.06)",
  color: "#f8fafc",
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.45 : 1,
  fontFamily: "inherit",
  touchAction: "manipulation",
});

const chip: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid rgba(148, 163, 184, 0.3)",
  fontSize: 11,
  marginRight: 4,
  marginBottom: 4,
  color: "#cbd5e1",
};

export default function InterfaceConsentBar() {
  const view = useInterface();
  const orchestrator = InterfaceOrchestrator.getInstance();
  const [showAll, setShowAll] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toastFor, setToastFor] = useState<string | null>(null);
  /** Tucked away so the whole preview can be inspected unobstructed. */
  const [collapsed, setCollapsed] = useState(false);

  const proposal = view.previewing ?? view.pending[0] ?? null;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 720);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 720);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setShowAll(false);
    setConfirmed(false);
    setMessage(null);
    setCollapsed(false);
  }, [proposal?.id]);

  // Recently applied → show Undo for a moment.
  useEffect(() => {
    if (!view.lastApplied) return;
    setToastFor(view.lastApplied.proposalId);
    const timer = window.setTimeout(() => setToastFor(null), 9000);
    return () => window.clearTimeout(timer);
  }, [view.lastApplied]);

  // Command palette / other surfaces can open the history drawer.
  useEffect(() => {
    const open = () => setHistoryOpen(true);
    const undo = () => orchestrator.undo();
    window.addEventListener("lelu-interface-open-history", open);
    window.addEventListener("lelu-interface-undo", undo);
    return () => {
      window.removeEventListener("lelu-interface-open-history", open);
      window.removeEventListener("lelu-interface-undo", undo);
    };
  }, [orchestrator]);

  const changes = useMemo(() => (proposal ? (showAll ? proposal.changes : proposal.changes.slice(0, 6)) : []), [proposal, showAll]);

  if (historyOpen) {
    return (
      <div style={panel} role="dialog" aria-label="Interface history">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Interface history</strong>
          <button type="button" style={button()} onClick={() => setHistoryOpen(false)}>Close</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button type="button" style={button("neutral", !view.canUndo)} disabled={!view.canUndo} onClick={() => orchestrator.undo()}>↶ Undo</button>
          <button type="button" style={button("neutral", !view.canRedo)} disabled={!view.canRedo} onClick={() => orchestrator.redo()}>↷ Redo</button>
        </div>
        <div style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>Versions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {[...view.history].reverse().map((snapshot) => {
            const index = view.history.findIndex((s) => s.version === snapshot.version);
            const live = index === view.cursor;
            return (
              <div key={snapshot.version} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", padding: "6px 8px", borderRadius: 10, background: live ? "rgba(74, 222, 128, 0.1)" : "rgba(255,255,255,0.03)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>v{snapshot.version} · {snapshot.label}</div>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{new Date(snapshot.at).toLocaleString()}</div>
                </div>
                {live ? (
                  <span style={{ ...chip, borderColor: "rgba(74,222,128,0.6)", color: "#86efac" }}>live</span>
                ) : (
                  <button type="button" style={button()} onClick={() => orchestrator.restoreVersion(snapshot.version)}>Restore</button>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>What LÉLU may propose</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
          {INTERFACE_SCOPES.map((scope: InterfaceScope) => (
            <label key={scope} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 36 }}>
              <span style={{ textTransform: "capitalize" }}>{scope}</span>
              <select
                value={view.scopes[scope]}
                onChange={(e) => orchestrator.setScopePolicy(scope, e.target.value as "ask" | "blocked")}
                style={{ minHeight: 34, borderRadius: 8, background: "#0f172a", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.35)", padding: "0 8px" }}
              >
                <option value="ask">Ask me</option>
                <option value="blocked">Never</option>
              </select>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>Decisions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {orchestrator.log().slice(0, 12).map((entry) => (
            <div key={entry.id} style={{ fontSize: 12, opacity: 0.85 }}>
              <span style={{ ...chip, color: entry.status === "approved" ? "#86efac" : entry.status === "rejected" ? "#fca5a5" : "#cbd5e1" }}>{entry.status}</span>
              {entry.description}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!proposal) {
    if (!toastFor || !view.lastApplied) return null;
    return (
      <div
        style={{
          ...panel,
          border: "1px solid rgba(74, 222, 128, 0.45)",
          padding: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          justifyContent: "space-between",
          // Phones: a window's title bar sits at the top, so the toast goes
          // bottom-left, above the composer and clear of the resize grip.
          ...(narrow
            ? { top: "auto", bottom: "calc(env(safe-area-inset-bottom, 0px) + 104px)", left: 8, transform: "none", width: "auto", maxWidth: "calc(100vw - 72px)" }
            : {}),
        }}
        role="status"
      >
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>✓ Applied: {view.lastApplied.description}</span>
        <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" style={button()} onClick={() => { orchestrator.undo(); setToastFor(null); }}>Undo</button>
          <button type="button" style={button()} onClick={() => setHistoryOpen(true)}>History</button>
        </span>
      </div>
    );
  }

  const previewing = view.previewing?.id === proposal.id;
  const approveDisabled = proposal.destructive && !confirmed;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Review LÉLU's proposed interface change"
        style={{
          ...button(),
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 10px)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9000,
          pointerEvents: "auto",
          maxWidth: "calc(100vw - 16px)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          background: "rgba(8, 12, 28, 0.94)",
          border: "1px solid rgba(250, 204, 21, 0.6)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        ◐ Previewing: {proposal.description} — Review
      </button>
    );
  }

  return (
    <div style={panel} role="dialog" aria-label="LÉLU proposes an interface change" data-lelu-consent="">
      <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "#fde68a", marginBottom: 4 }}>
        {proposal.origin === "lelu" ? "LÉLU proposes" : "Proposed"} · {previewing ? "previewing — not applied yet" : "not previewing"}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, overflowWrap: "anywhere" }}>{proposal.description}</div>
      {proposal.rationale ? <div style={{ opacity: 0.8, marginBottom: 8 }}>{proposal.rationale}</div> : null}
      <div style={{ marginBottom: 6 }}>
        {proposal.scopes.map((scope) => (
          <span key={scope} style={chip}>{scope}</span>
        ))}
      </div>
      <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12, opacity: 0.9 }}>
        {changes.map((line, i) => (
          <li key={i} style={{ overflowWrap: "anywhere" }}>{line}</li>
        ))}
      </ul>
      {proposal.changes.length > 6 ? (
        <button type="button" style={{ ...button(), minHeight: 32, padding: "4px 10px", fontSize: 12, marginBottom: 8 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${proposal.changes.length} changes`}
        </button>
      ) : null}
      {proposal.warnings.length || proposal.notes.length ? (
        <div style={{ fontSize: 12, color: "#fcd34d", marginBottom: 8 }}>
          {[...proposal.notes, ...proposal.warnings].slice(0, 5).map((w, i) => (
            <div key={i}>• {w}</div>
          ))}
        </div>
      ) : null}
      {proposal.destructive ? (
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 10, borderRadius: 10, background: "rgba(220, 38, 38, 0.14)", border: "1px solid rgba(248, 113, 113, 0.45)", marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }} />
          <span>
            <strong>This change is destructive.</strong> {proposal.destructiveReasons.join("; ")}. I understand and want to allow it.
          </span>
        </label>
      ) : null}
      {message ? <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 8 }}>{message}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          style={button("primary", approveDisabled)}
          disabled={approveDisabled}
          onClick={() => {
            const result = orchestrator.decide(proposal.id, "approved", { confirmDestructive: confirmed });
            if (!result.ok) setMessage(result.reason ?? "Could not apply.");
          }}
        >
          Approve & apply
        </button>
        <button type="button" style={button("danger")} onClick={() => orchestrator.decide(proposal.id, "rejected")}>
          Reject
        </button>
        <button
          type="button"
          style={button()}
          onClick={() => (previewing ? orchestrator.stopPreview() : orchestrator.startPreview(proposal.id))}
          title="Compare the proposal with what is live now"
        >
          {previewing ? "Show current" : "Preview"}
        </button>
        <button type="button" style={button()} onClick={() => setHistoryOpen(true)}>History</button>
        <button type="button" style={button()} onClick={() => setCollapsed(true)} title="Hide this panel to inspect the whole preview">Hide panel</button>
      </div>
      {view.pending.length > 1 ? <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>{view.pending.length - 1} more proposal(s) waiting.</div> : null}
    </div>
  );
}
