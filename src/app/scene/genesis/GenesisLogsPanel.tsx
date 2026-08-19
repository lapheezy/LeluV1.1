/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS LOGS PANEL
 *
 * Phase 7 — surfaces AIRuntime's ExecutionLogger, which every
 * pipeline stage already writes to (see core/AIRuntime.ts,
 * core/ExecutionLogger.ts) but that previously only printed to
 * the browser console. Newest first, read-only.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import { genesisTheme } from "./GenesisTheme";
import AIService from "../../../core/AIService";
import GenesisWindowFrame from "./GenesisWindowFrame";

const ai = AIService.getInstance();

interface LogRow {
  id: string;
  timestamp: number;
  stage: string;
  success: boolean;
  message: string;
  provider?: string;
  duration?: number;
}

interface GenesisLogsPanelProps {
  onClose: () => void;
}

export default function GenesisLogsPanel({ onClose }: GenesisLogsPanelProps) {
  const [logs, setLogs] = useState<LogRow[]>([]);

  useEffect(() => {
    function refresh() {
      setLogs([...ai.getExecutionLogs()].reverse());
    }

    refresh();
    const interval = window.setInterval(refresh, 2500);
    return () => window.clearInterval(interval);
  }, []);

  const failures = logs.filter((log) => !log.success).length;

  return (
    <GenesisWindowFrame
      title={
        <>
          Execution logs · {logs.length}
          {failures > 0 ? ` · ${failures} failed` : ""}
        </>
      }
      onClose={onClose}
      width="min(92vw, 540px)"
      active={failures > 0}
    >
      {logs.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>No pipeline activity recorded yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {logs.slice(0, 200).map((log) => (
            <div
              key={log.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                fontSize: 12,
                padding: "6px 8px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <span
                style={{
                  marginTop: 4,
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: log.success ? genesisTheme.status.ok : genesisTheme.status.error,
                  boxShadow: !log.success ? `0 0 8px ${genesisTheme.status.error}` : "none",
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{log.stage}</span>
                  <span style={{ opacity: 0.5, whiteSpace: "nowrap" }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ opacity: 0.75, marginTop: 2, overflowWrap: "anywhere" }}>{log.message}</div>
                {log.provider || log.duration ? (
                  <div style={{ opacity: 0.5, marginTop: 2, fontSize: 11 }}>
                    {[log.provider, log.duration ? `${log.duration}ms` : null].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </GenesisWindowFrame>
  );
}
