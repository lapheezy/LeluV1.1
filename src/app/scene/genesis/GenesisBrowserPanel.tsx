/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS BROWSER PANEL
 *
 * LÉLU's in-app browser layer. A web application cannot launch
 * the user's native Chrome/Firefox from inside a browser sandbox,
 * so this is the honest equivalent the environment permits:
 *
 *   - Navigate: the page renders in an embedded frame.
 *   - Read for Lélu: the page's readable content is extracted via
 *     BrowserTool and pushed through the EXISTING chat/cognition
 *     pipeline (AIService.chat) — the same providers, fallback
 *     chain, memory retrieval and consolidation as any message.
 *     The result is stored through addMessage so it also lands in
 *     History and the invisible dialogue replay.
 *
 * No second browser, no second runtime, no duplicate chat.
 * ==========================================================
 */

import { useCallback, useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useGenesis } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import AIService from "../../../core/AIService";
import BrowserTool from "../../../core/browser/BrowserTool";
import { getEnvironment } from "../../../core/Environment";
import AgentEventBus, { type AgentEvent, type AgentResultItem } from "../../../core/agent/AgentEvents";
import GenesisWindowFrame from "./GenesisWindowFrame";

const ai = AIService.getInstance();

interface GenesisBrowserPanelProps {
  onClose: () => void;
}

interface LiveResearch {
  taskId: string;
  query: string;
  provider: string;
  status: "running" | "complete" | "blocked" | "error";
  results: AgentResultItem[];
  message?: string;
}

function researchFromEvent(event: AgentEvent): LiveResearch | null {
  if (event.type === "tool_selected" || event.type === "tool_started") {
    if (event.tool !== "research") return null;
    return {
      taskId: event.taskId,
      query: event.label?.replace(/^Searching\s+/i, "") ?? "",
      provider: "research providers",
      status: "running",
      results: [],
    };
  }
  if (event.type === "tool_result" && event.tool === "research") {
    return {
      taskId: event.taskId,
      query: event.query ?? "",
      provider: event.provider ?? "research providers",
      status: event.status === "error" ? "error" : "complete",
      results: event.results ?? [],
      message: event.result,
    };
  }
  return null;
}

export default function GenesisBrowserPanel({ onClose }: GenesisBrowserPanelProps) {
  const { addMessage, notify } = useGenesis();
  // Neko (m1k1o/neko) self-hosted virtual browser: when VITE_NEKO_URL is
  // configured the panel can switch the embedded surface to the LIVE Neko
  // web client — a real, rendered browser session (WebRTC), not an iframe
  // of the target page. The join password stays server-side; the client
  // embeds the public client URL as-is.
  const nekoUrl = getEnvironment().nekoUrl.trim();
  const [mode, setMode] = useState<"inline" | "neko">("inline");
  const [nekoStatus, setNekoStatus] = useState<"checking" | "reachable" | "unavailable" | "unconfigured">(
    nekoUrl ? "checking" : "unconfigured",
  );
  const [address, setAddress] = useState("https://en.wikipedia.org");
  const [current, setCurrent] = useState("https://en.wikipedia.org");
  const [reading, setReading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [research, setResearch] = useState<LiveResearch | null>(null);

  useEffect(() => {
    if (!nekoUrl) return;
    let cancelled = false;
    void fetch("/api/neko/status", { signal: AbortSignal.timeout(7000) })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { reachable?: boolean };
        if (!cancelled) setNekoStatus(response.ok && payload.reachable ? "reachable" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setNekoStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [nekoUrl]);

  // Hydrate from the real event history, then follow the same live bus so
  // a fast request cannot disappear between tool completion and mount.
  useEffect(() => {
    const bus = AgentEventBus.getInstance();
    const recent = bus.recent(60);
    for (const event of recent) {
      const next = researchFromEvent(event);
      if (next) setResearch((current) => current?.taskId === next.taskId
        ? { ...current, ...next }
        : next);
      if (event.type === "browser_result") {
        setAddress(event.url);
        setCurrent(event.url);
        setSummary(event.excerpt ?? event.error ?? null);
      }
    }
    return bus.subscribe((event) => {
      const next = researchFromEvent(event);
      if (next) setResearch((current) => current?.taskId === next.taskId
        ? { ...current, ...next }
        : next);
      if (event.type === "browser_result") {
        setAddress(event.url);
        setCurrent(event.url);
        setSummary(event.excerpt ?? event.error ?? null);
      }
    });
  }, []);

  // Real navigation → real event: the canonical bus records it, the
  // surface controller opens this panel, and chat renders the browser
  // surface inline — one execution state, many views.
  const go = useCallback((raw?: string) => {
    const target = BrowserTool.normalizeUrl(raw ?? address);
    if (!target) {
      return;
    }
    setAddress(target);
    setCurrent(target);
    setSummary(null);
    AgentEventBus.getInstance().emit({
      type: "browser_opened",
      taskId: `browser-${Date.now()}`,
      url: target,
    });
  }, [address]);

  // Chat surfaces (search results, page cards) navigate this panel by
  // dispatching genesis-browser-goto — the same surface the user sees.
  useEffect(() => {
    function onGoto(event: Event) {
      const detail = (event as CustomEvent).detail as { url?: string } | null;
      const url = detail?.url;
      if (url && BrowserTool.normalizeUrl(url)) {
        setAddress(url);
        setCurrent(url);
        setSummary(null);
        AgentEventBus.getInstance().emit({
          type: "browser_opened",
          taskId: `browser-${Date.now()}`,
          url: BrowserTool.normalizeUrl(url)!,
        });
      }
    }
    window.addEventListener("genesis-browser-goto", onGoto);
    return () => window.removeEventListener("genesis-browser-goto", onGoto);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      go();
    }
  };

  /*
   * Read the page and push it through the ONE chat pipeline: the
   * extracted content becomes a message to LÉLU, providers/fallback/
   * cognition/memory run exactly as in chat, and the reply is stored
   * through addMessage (History + dialogue replay) and shown here.
   */
  const readForLelu = useCallback(async () => {
    if (reading) {
      return;
    }
    setReading(true);
    setSummary(null);
    try {
      const result = await BrowserTool.visit(current);
      const taskId = `browser-${Date.now()}`;
      AgentEventBus.getInstance().emit({
        type: "browser_result",
        taskId,
        url: result.url,
        title: result.title,
        excerpt: result.excerpt,
        status: result.status,
        error: result.error,
      });
      if (result.status !== "read") {
        setSummary(result.error ?? "I couldn't read that page.");
        return;
      }

      const request = [
        `I opened a page in my in-app browser. Read it and tell me what it's about in a few sentences.`,
        ``,
        `Page: ${result.title}`,
        `URL: ${result.url}`,
        ``,
        result.excerpt,
      ].join("\n");

      // The REAL page result is emitted on the canonical bus so the chat
      // exchange renders the actual read inline (same event the timeline
      // and workspace layer consume).
      AgentEventBus.getInstance().emit({
        type: "tool_result",
        taskId,
        tool: "browser",
        result: result.excerpt.slice(0, 1200),
        results: [{ title: result.title, url: result.url, type: "page", content: result.excerpt }],
      });

      const response = await ai.chat(request);
      const reply = response.text.trim();

      addMessage({
        id: crypto.randomUUID(),
        role: "user",
        text: `[Browser] Read ${result.url}`,
        timestamp: Date.now(),
        source: "local",
      });
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        text: reply,
        timestamp: Date.now(),
        source: response.provider === "brain" || response.provider === "offline" ? "local" : "ai",
        provider: response.provider,
      });

      setSummary(reply);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setSummary(text);
      notify("Lélu Error", text);
    } finally {
      setReading(false);
    }
  }, [addMessage, current, notify, reading]);

  return (
    <GenesisWindowFrame
      eyebrow="Lélu Browser"
      title="Browser · in-app layer"
      onClose={onClose}
      width="min(94vw, 860px)"
      maxHeight="min(78vh, 640px)"
      zoomable={false}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
        {/* Address bar */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={handleKeyDown}
            enterKeyHint="go"
            spellCheck={false}
            aria-label="Browser address"
            placeholder="Enter a web address…"
            style={{
              flex: 1,
              minWidth: 180,
              background: "rgba(8, 16, 38, 0.55)",
              border: `1px solid rgba(148, 163, 184, 0.22)`,
              borderRadius: genesisTheme.radius.md,
              color: "white",
              padding: "8px 12px",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => go()}
            style={actionButtonStyle(genesisTheme.status.ok)}
          >
            Go
          </button>
          <button
            type="button"
            onClick={readForLelu}
            disabled={reading || mode === "neko"}
            style={actionButtonStyle(reading ? genesisTheme.status.idle : genesisTheme.status.accent)}
            title="Extract this page's content and have Lélu read it through her chat pipeline"
          >
            {reading ? "Reading…" : "Read for Lélu"}
          </button>
          {nekoStatus === "reachable" ? (
            <button
              type="button"
              onClick={() => setMode((m) => (m === "neko" ? "inline" : "neko"))}
              style={actionButtonStyle(mode === "neko" ? "#f472b6" : "#94a3b8")}
              title="Switch to the verified live Neko (m1k1o/neko) virtual browser session"
            >
              {mode === "neko" ? "◉ NEKO LIVE — SWITCH TO INLINE" : "NEKO LIVE BROWSER"}
            </button>
          ) : null}
        </div>

        {research ? (
          <div
            data-lelu-live-research
            style={{
              borderRadius: genesisTheme.radius.md,
              border: `1px solid ${research.status === "error" ? "rgba(248,113,113,0.38)" : "rgba(103,232,249,0.28)"}`,
              background: "linear-gradient(135deg, rgba(8,16,38,0.9), rgba(14,24,52,0.72))",
              padding: 12,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ color: "#a5f3fc", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                LÉLU · Research execution
              </strong>
              <span style={{ color: research.status === "running" ? "#fbbf24" : research.status === "error" ? "#f87171" : "#34d399", fontSize: 11 }}>
                {research.status === "running" ? "live" : research.status}
              </span>
            </div>
            <div style={{ marginTop: 6, color: "rgba(226,240,255,0.9)", fontSize: 12 }}>
              Search: {research.query || "current request"}
            </div>
            <div style={{ marginTop: 3, color: "rgba(148,163,184,0.82)", fontSize: 10.5 }}>
              Source: {research.provider}
            </div>
            {research.results.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 9 }}>
                {research.results.slice(0, 10).map((item, index) => (
                  <div key={`${item.url ?? item.title ?? "result"}-${index}`} style={{ padding: "7px 8px", borderRadius: 9, background: "rgba(255,255,255,0.045)", border: "1px solid rgba(148,163,184,0.14)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#67e8f9", fontSize: 10 }}>{item.type ?? "result"}</span>
                      <strong style={{ color: "#e0f2fe", fontSize: 11.5, flex: 1 }}>{item.title ?? "Untitled result"}</strong>
                      {item.url ? <button type="button" onClick={() => dispatchResearchUrl(item.url!)} style={miniButtonStyle}>Open</button> : null}
                    </div>
                    {item.content ? <div style={{ marginTop: 4, color: "rgba(226,240,255,0.74)", fontSize: 10.5, lineHeight: 1.45 }}>{item.content.slice(0, 280)}</div> : null}
                    {item.source ? <div style={{ marginTop: 4, color: "rgba(148,163,184,0.72)", fontSize: 9.5 }}>{item.source}{item.timestamp ? ` · ${item.timestamp}` : ""}</div> : null}
                  </div>
                ))}
              </div>
            ) : research.status === "running" ? (
              <div style={{ marginTop: 9, color: "rgba(226,240,255,0.68)", fontSize: 11 }}>Waiting for the real provider response...</div>
            ) : (
              <div style={{ marginTop: 9, color: "rgba(226,240,255,0.68)", fontSize: 11 }}>{research.message ?? "No structured results were returned."}</div>
            )}
          </div>
        ) : null}

        {/* Embedded page — the in-app browser surface. In NEKO mode this
            is the LIVE Neko virtual browser session (m1k1o/neko). */}
        <div
          style={{
            flex: 1,
            minHeight: 320,
            borderRadius: genesisTheme.radius.md,
            overflow: "hidden",
            background: mode === "neko" ? "#05070f" : "white",
            border: "1px solid rgba(148, 163, 184, 0.25)",
            position: "relative",
          }}
        >
          {mode === "neko" && nekoUrl ? (
            <iframe
              src={nekoUrl}
              title="Neko virtual browser (m1k1o/neko)"
              allow="clipboard-read; clipboard-write; fullscreen; autoplay; camera; microphone"
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          ) : (
            <iframe
              src={current}
              title="Lélu in-app browser"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          )}
          {mode === "neko" ? (
            <span
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                borderRadius: 999,
                background: "rgba(244,114,182,0.92)",
                color: "#170b12",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.08em",
                padding: "3px 10px",
                pointerEvents: "none",
              }}
            >
              ● NEKO · LIVE BROWSER SESSION
            </span>
          ) : null}
        </div>

        {summary ? (
          <div
            style={{
              borderRadius: genesisTheme.radius.md,
              border: `1px solid rgba(103, 232, 249, 0.22)`,
              background: "rgba(8, 16, 38, 0.5)",
              padding: "10px 12px",
              color: "rgba(228, 244, 255, 0.92)",
              fontSize: 12.5,
              lineHeight: 1.5,
              maxHeight: 180,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            <strong style={{ color: genesisTheme.status.accent, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Lélu read it
            </strong>
            <div style={{ marginTop: 6 }}>{summary}</div>
          </div>
        ) : null}

        <p style={{ margin: 0, fontSize: 11, color: "rgba(148, 163, 184, 0.85)", lineHeight: 1.5 }}>
          {mode === "neko" && nekoUrl && nekoStatus === "reachable"
            ? `Verified Neko web client at ${nekoUrl}. WebRTC still requires Neko's UDP 52000–52100 ports and NAT address to be reachable.`
            : nekoUrl && nekoStatus === "unavailable"
              ? "Neko is configured but its web client is not reachable; the live mode is disabled until the separate service responds."
              : nekoUrl && nekoStatus === "checking"
                ? "Checking the configured Neko web client…"
                : BrowserTool.nativeLaunchAvailable()
              ? "Native browser launch detected."
              : "In-app layer: some sites block embedding or direct reading — “Read for Lélu” reports exactly what happened and text chat always keeps working."}
        </p>
      </div>
    </GenesisWindowFrame>
  );
}

function dispatchResearchUrl(url: string): void {
  window.dispatchEvent(new CustomEvent("genesis-browser-goto", { detail: { url } }));
  window.dispatchEvent(new CustomEvent("genesis-show-surface", { detail: { panel: "browser" } }));
}

const miniButtonStyle: CSSProperties = {
  border: "1px solid rgba(103,232,249,0.35)",
  borderRadius: 6,
  background: "rgba(103,232,249,0.1)",
  color: "#cffafe",
  padding: "3px 7px",
  fontSize: 10,
  cursor: "pointer",
  fontFamily: "inherit",
};

function actionButtonStyle(color: string): CSSProperties {
  return {
    border: `1px solid ${color}55`,
    borderRadius: genesisTheme.radius.md,
    background: `${color}14`,
    color: "white",
    padding: "8px 14px",
    fontSize: 12.5,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
