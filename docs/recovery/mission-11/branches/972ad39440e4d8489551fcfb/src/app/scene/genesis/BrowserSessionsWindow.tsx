/**
 * ==========================================================
 * LÉLUVERSE
 * BROWSER SESSIONS WINDOW
 *
 * The Cosmos window over plugins/browserSessionsApi.ts: the sessions
 * she is actually driving, their tabs, and the pixels the browser
 * returned after her last action. The screenshot is the file the server
 * wrote as evidence — not a rendering of state this panel guessed.
 *
 * When the host has no headless browser, this window says so, with the
 * server's own reason. It never shows a placeholder page as if it were
 * a live one.
 * ==========================================================
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import { genesisTheme } from "./GenesisTheme";
import BrowserSessions, { type BrowserSessionView, type BrowserStepResult } from "../../../core/browser/BrowserSessions";

interface BrowserSessionsWindowProps {
  onClose: () => void;
}

const client = BrowserSessions.getInstance();

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const input: CSSProperties = {
  flex: "1 1 160px",
  minWidth: 0,
  border: "1px solid rgba(103,232,249,0.28)",
  borderRadius: genesisTheme.radius.md,
  background: "rgba(8,16,38,0.7)",
  color: "#e4f4ff",
  padding: "7px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
};

function button(tone = "#67e8f9", disabled = false): CSSProperties {
  return {
    border: `1px solid ${tone}55`,
    borderRadius: genesisTheme.radius.md,
    background: `${tone}14`,
    color: disabled ? "rgba(226,232,240,0.45)" : "#e4f4ff",
    padding: "6px 11px",
    fontSize: 11.5,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
}

export default function BrowserSessionsWindow({ onClose }: BrowserSessionsWindowProps) {
  const [sessions, setSessions] = useState<BrowserSessionView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("research");
  const [url, setUrl] = useState("https://example.com");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [shot, setShot] = useState<{ session: string; file: string } | null>(null);
  const [pageText, setPageText] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await client.list();
    if (result.ok && result.sessions) {
      setSessions(result.sessions);
      setBlocked(null);
      setSelected((current) => (current && result.sessions!.some((s) => s.id === current) ? current : result.sessions![0]?.id ?? null));
    } else if (result.error) {
      setBlocked(result.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (label: string, work: () => Promise<BrowserStepResult>, describe: (result: BrowserStepResult) => string) => {
      setBusy(label);
      setNote(null);
      try {
        const result = await work();
        if (!result.ok) {
          setNote(result.error ?? "That action did not succeed.");
        } else {
          setNote(describe(result));
          if (result.evidence?.file && result.session) {
            setShot({ session: result.session, file: result.evidence.file });
          }
          if (typeof result.text === "string") setPageText(result.text);
        }
        await refresh();
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const selectedSession = sessions.find((session) => session.id === selected) ?? null;

  return (
    <GenesisWindowFrame
      eyebrow="Live execution"
      title={`Browser Sessions${sessions.length ? ` · ${sessions.length}` : ""}`}
      onClose={onClose}
      extraActions={
        <button type="button" style={button()} onClick={() => void refresh()} disabled={busy !== null}>
          Refresh
        </button>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        {blocked ? (
          <div
            style={{
              border: "1px solid rgba(248,113,113,0.4)",
              background: "rgba(248,113,113,0.10)",
              borderRadius: genesisTheme.radius.md,
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: 1.5,
              color: "#fecaca",
            }}
          >
            {blocked}
          </div>
        ) : null}

        <div style={row}>
          <input style={{ ...input, flex: "0 1 130px" }} value={name} onChange={(event) => setName(event.target.value)} aria-label="Session name" />
          <input style={input} value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Address" />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, color: "rgba(203,213,225,0.9)" }}>
            <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
            private
          </label>
          <button
            type="button"
            style={button("#a7f3d0", busy !== null)}
            disabled={busy !== null}
            onClick={() =>
              void run(
                "open",
                () => client.open({ name, url, private: isPrivate }),
                (result) => `Opened ${result.title || result.url || "the session"}`,
              )
            }
          >
            Open session
          </button>
        </div>

        {sessions.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelected(session.id)}
                style={{
                  textAlign: "left",
                  border: `1px solid ${session.id === selected ? "rgba(103,232,249,0.55)" : "rgba(148,163,184,0.22)"}`,
                  background: session.id === selected ? "rgba(103,232,249,0.10)" : "rgba(8,16,38,0.45)",
                  borderRadius: genesisTheme.radius.md,
                  padding: "7px 10px",
                  color: "#e4f4ff",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <strong>{session.name}</strong>
                <span style={{ color: "rgba(148,163,184,0.9)" }}>
                  {" "}· {session.viewport}
                  {session.private ? " · private" : ""} · {session.tabs.length} tab(s) · {session.steps} step(s)
                </span>
                <div style={{ fontSize: 11, color: "rgba(148,163,184,0.85)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {session.tabs.find((tab) => tab.id === session.activeTab)?.url || session.tabs[0]?.url || "no page yet"}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 11.5, color: "rgba(148,163,184,0.85)", lineHeight: 1.5 }}>
            No session is open. Opening one starts a real Chromium context; every action below writes a screenshot and a manifest line under{" "}
            <code>artifacts/browser-evidence/</code>.
          </p>
        )}

        {selectedSession ? (
          <div style={row}>
            <button
              type="button"
              style={button("#93c5fd", busy !== null)}
              disabled={busy !== null}
              onClick={() => void run("navigate", () => client.navigate(selectedSession.id, url), (r) => `At ${r.url ?? url}`)}
            >
              Navigate
            </button>
            <button
              type="button"
              style={button("#c4b5fd", busy !== null)}
              disabled={busy !== null}
              onClick={() => void run("read", () => client.read(selectedSession.id), (r) => `Read ${r.text?.length ?? 0} characters`)}
            >
              Read page
            </button>
            <button
              type="button"
              style={button("#fca5a5", busy !== null)}
              disabled={busy !== null}
              onClick={() => void run("capture", () => client.screenshot(selectedSession.id), () => "Captured the page")}
            >
              Capture
            </button>
            <button
              type="button"
              style={button("#fda4af", busy !== null)}
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "close",
                  async () => {
                    const result = await client.close(selectedSession.id);
                    setShot(null);
                    setPageText(null);
                    return result;
                  },
                  () => "Closed the session",
                )
              }
            >
              Close session
            </button>
          </div>
        ) : null}

        {note ? (
          <p style={{ margin: 0, fontSize: 11.5, color: "rgba(226,232,240,0.9)", lineHeight: 1.5 }}>{note}</p>
        ) : null}

        {shot ? (
          <img
            src={BrowserSessions.shotUrl(shot.session, shot.file)}
            alt="Screenshot the browser returned"
            style={{
              width: "100%",
              borderRadius: genesisTheme.radius.md,
              border: "1px solid rgba(103,232,249,0.25)",
              background: "#020617",
            }}
          />
        ) : null}

        {pageText ? (
          <pre
            style={{
              margin: 0,
              maxHeight: 190,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              borderRadius: genesisTheme.radius.md,
              border: "1px solid rgba(103,232,249,0.22)",
              background: "rgba(8,16,38,0.5)",
              padding: "9px 11px",
              fontSize: 11.5,
              lineHeight: 1.5,
              color: "rgba(228,244,255,0.92)",
            }}
          >
            {pageText}
          </pre>
        ) : null}

        <p style={{ margin: 0, fontSize: 11, color: "rgba(148,163,184,0.85)", lineHeight: 1.5 }}>
          A private session persists nothing and is destroyed on close, but it is not anonymous: sites still see this host. Clicks that submit, buy,
          post or delete are refused unless the user confirmed them.
        </p>
      </div>
    </GenesisWindowFrame>
  );
}
