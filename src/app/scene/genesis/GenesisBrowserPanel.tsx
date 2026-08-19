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

import { useCallback, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useGenesis } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import AIService from "../../../core/AIService";
import BrowserTool from "../../../core/browser/BrowserTool";
import GenesisWindowFrame from "./GenesisWindowFrame";

const ai = AIService.getInstance();

interface GenesisBrowserPanelProps {
  onClose: () => void;
}

export default function GenesisBrowserPanel({ onClose }: GenesisBrowserPanelProps) {
  const { addMessage, notify } = useGenesis();
  const [address, setAddress] = useState("https://en.wikipedia.org");
  const [current, setCurrent] = useState("https://en.wikipedia.org");
  const [reading, setReading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const go = useCallback((raw?: string) => {
    const target = BrowserTool.normalizeUrl(raw ?? address);
    if (!target) {
      return;
    }
    setAddress(target);
    setCurrent(target);
    setSummary(null);
  }, [address]);

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
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
        {/* Address bar */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            disabled={reading}
            style={actionButtonStyle(reading ? genesisTheme.status.idle : genesisTheme.status.accent)}
            title="Extract this page's content and have Lélu read it through her chat pipeline"
          >
            {reading ? "Reading…" : "Read for Lélu"}
          </button>
        </div>

        {/* Embedded page — the in-app browser surface. */}
        <div
          style={{
            flex: 1,
            minHeight: 320,
            borderRadius: genesisTheme.radius.md,
            overflow: "hidden",
            background: "white",
            border: "1px solid rgba(148, 163, 184, 0.25)",
            position: "relative",
          }}
        >
          <iframe
            src={current}
            title="Lélu in-app browser"
            referrerPolicy="no-referrer-when-downgrade"
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          />
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
          {BrowserTool.nativeLaunchAvailable()
            ? "Native browser launch detected."
            : "In-app layer: some sites block embedding or direct reading — “Read for Lélu” reports exactly what happened and text chat always keeps working."}
        </p>
      </div>
    </GenesisWindowFrame>
  );
}

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
