/**
 * ==========================================================
 * LÉLU — UNIFIED VISUAL STUDIO
 *
 * Merges Render + Sketch + Avatar into one creative environment.
 * All three modes share the same CreativeOrchestrator pipeline —
 * the user switches between sketch/concept, 3D scene, and avatar
 * without leaving the studio. Chat remains open alongside.
 * ==========================================================
 */

import { useCallback, useMemo, useState } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import CreativeOrchestrator, {
  type CreativeResult,
} from "../../../core/creative/CreativeOrchestrator";
import AgentEventBus from "../../../core/agent/AgentEvents";

export type StudioMode = "sketch" | "render" | "avatar";

interface Props {
  onClose: () => void;
  initialMode?: StudioMode;
}

/*
 * Genesis Studios is the ONE visual environment — sketch, render and
 * avatar are modes inside it. Commands that used to open separate
 * panels now request a mode here and open the studio.
 */
let requestedMode: StudioMode | null = null;

export function openStudioMode(mode: StudioMode): void {
  requestedMode = mode;
}

const tabChip = (active: boolean): React.CSSProperties => ({
  padding: "5px 14px",
  borderRadius: 999,
  border: active
    ? "1px solid rgba(167, 139, 250, 0.5)"
    : "1px solid rgba(255,255,255,0.08)",
  background: active ? "rgba(167, 139, 250, 0.15)" : "transparent",
  color: active ? "#d4c8ff" : "rgba(203, 228, 255, 0.55)",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
});

export default function GenesisVisualStudio({ onClose, initialMode = "render" }: Props) {
  const [mode, setMode] = useState<StudioMode>(() => {
    const requested = requestedMode;
    requestedMode = null;
    return requested ?? initialMode;
  });
  const [prompt, setPrompt] = useState("");
  const [lastResult, setLastResult] = useState<CreativeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [outputImage, setOutputImage] = useState<string | null>(null);

  const orchestrator = useMemo(() => CreativeOrchestrator.getInstance(), []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const result = await orchestrator.route(`${mode}: ${prompt}`);

      if (result.artifact?.output) {
        setOutputImage(result.artifact.output);
        AgentEventBus.getInstance().emit({
          type: "creative_artifact",
          taskId: `vs-${Date.now()}`,
          image: result.artifact.output,
          label: `${mode} — ${prompt.slice(0, 60)}`,
        });
      }

      setLastResult(result);
      setPrompt("");
    } catch (err) {
      console.error("[VisualStudio] Generation failed:", err);
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, mode, orchestrator]);

  const modes: Array<{ key: StudioMode; glyph: string; label: string }> = [
    { key: "render", glyph: "◍", label: "Render" },
    { key: "sketch", glyph: "✎", label: "Sketch" },
    { key: "avatar", glyph: "◉", label: "Avatar" },
  ];

  return (
    <GenesisWindowFrame title="Visual Studio" onClose={onClose}>
      {/* ── Mode tabs ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            style={tabChip(mode === m.key)}
          >
            <span aria-hidden>{m.glyph}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* ── Prompt input ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleGenerate();
            }
          }}
          placeholder={
            mode === "sketch"
              ? "Describe what to sketch…"
              : mode === "render"
                ? "Describe the 3D scene…"
                : "Describe avatar changes…"
          }
          style={{
            flex: 1,
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(8, 16, 38, 0.5)",
            color: "#e2e8f0",
            fontSize: 13,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={busy || !prompt.trim()}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            border: "1px solid rgba(167, 139, 250, 0.45)",
            background: busy
              ? "rgba(167, 139, 250, 0.08)"
              : "rgba(167, 139, 250, 0.15)",
            color: busy ? "rgba(167, 139, 250, 0.5)" : "#d4c8ff",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "…" : "Create"}
        </button>
      </div>

      {/* ── Canvas area ── */}
      <div
        style={{
          minHeight: 220,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(2, 6, 23, 0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {outputImage ? (
          <img
            src={outputImage}
            alt="Visual output"
            style={{
              maxWidth: "100%",
              maxHeight: 320,
              objectFit: "contain",
              borderRadius: 8,
            }}
          />
        ) : (
          <div
            style={{
              textAlign: "center",
              color: "rgba(203, 228, 255, 0.35)",
              fontSize: 13,
              padding: "24px",
            }}
          >
            {mode === "sketch"
              ? "Describe your idea above — LÉLU will sketch it here."
              : mode === "render"
                ? "Describe your 3D scene above — LÉLU will render it here."
                : "Describe avatar changes above — LÉLU will generate them here."}
          </div>
        )}
      </div>

      {/* ── Result feedback ── */}
      {lastResult && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 14px",
            borderRadius: 10,
            background: "rgba(52, 211, 153, 0.08)",
            border: "1px solid rgba(52, 211, 153, 0.2)",
            fontSize: 11.5,
            color: "rgba(203, 228, 255, 0.65)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "#34d399" }}>{lastResult.status.toUpperCase()}</strong>:{" "}
          {lastResult.message.slice(0, 200)}
        </div>
      )}
    </GenesisWindowFrame>
  );
}