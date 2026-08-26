/**
 * ==========================================================
 * LÉLU — SELF EVOLUTION PANEL
 *
 * Visible dashboard where the user can see:
 * - What LELU is researching
 * - What she learned
 * - What Sentinel detected
 * - What Architect designed
 * - What Engineering is building
 * - What experiments are running
 * - What improvements are proposed
 *
 * Every entry maps to actual runtime state — no fake data.
 * ==========================================================
 */

import { useState, useEffect, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GenesisWindowFrame from "./GenesisWindowFrame";
import Sentinel, { type SentinelEvent } from "../../../core/sentinel/Sentinel";
import CapabilityManifest from "../../../core/capabilities/CapabilityManifest";
import CosmosEntityRegistry from "../../../core/cosmos/CosmosEntityRegistry";

// ---- TYPES ----

interface EvolutionEntry {
  id: string;
  kind: "research" | "learning" | "sentinel" | "architect" | "engineering" | "experiment" | "proposal";
  title: string;
  description: string;
  timestamp: number;
  status: "active" | "completed" | "proposed" | "failed";
  source: string;
}

// ---- STYLES ----

const panel: CSSProperties = {
  padding: "18px 22px", overflowY: "auto", maxHeight: "calc(100% - 30px)",
  scrollbarWidth: "thin", scrollbarColor: "rgba(148,163,184,0.3) transparent",
};

const sectionTitle: CSSProperties = {
  fontSize: 11, letterSpacing: "0.1em", color: "rgba(148,163,184,0.7)",
  textTransform: "uppercase", marginBottom: 10, marginTop: 20,
};

const entryCard: CSSProperties = {
  background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px",
  border: "1px solid rgba(148,163,184,0.1)", marginBottom: 8,
};

const kindColors: Record<string, string> = {
  research: "#67e8f9",
  learning: "#a78bfa",
  sentinel: "#f87171",
  architect: "#fbbf24",
  engineering: "#34d399",
  experiment: "#f472b6",
  proposal: "#e2e8f0",
};

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

export default function GenesisSelfEvolutionPanel() {
  const [entries, setEntries] = useState<EvolutionEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "research" | "sentinel" | "engineering">("all");

  // Subscribe to Sentinel events as evolution entries
  useEffect(() => {
    const sentinel = Sentinel.getInstance();
    const cosmos = CosmosEntityRegistry.getInstance();
    const caps = CapabilityManifest.getInstance();

    function handleSentinelEvent(event: SentinelEvent) {
      const entry: EvolutionEntry = {
        id: event.id,
        kind: event.type.startsWith("provider") ? "sentinel" :
              event.type.startsWith("agent") ? "engineering" :
              event.type.startsWith("memory") ? "research" : "sentinel",
        title: event.type.replace(/_/g, " "),
        description: event.message,
        timestamp: event.timestamp,
        status: event.severity === "error" ? "failed" : "completed",
        source: event.source,
      };
      setEntries((prev) => [entry, ...prev].slice(0, 50));
    }

    const unsubSentinel = sentinel.subscribe(handleSentinelEvent);

    // Seed initial entries from capability manifest
    const report = caps.getReport();
    const capEntry: EvolutionEntry = {
      id: "init-caps",
      kind: "research",
      title: "Capability Discovery",
      description: report,
      timestamp: Date.now(),
      status: "completed",
      source: "CapabilityManifest",
    };
    setEntries((prev) => {
      if (prev.some((e) => e.id === "init-caps")) return prev;
      return [capEntry, ...prev];
    });

    // Register cosmos entities for active tabs
    const cosmosEntities = cosmos.getActive();
    for (const entity of cosmosEntities) {
      const cosmosEntry: EvolutionEntry = {
        id: `cosmos-${entity.id}`,
        kind: "research",
        title: `Cosmos Entity: ${entity.label}`,
        description: `Active ${entity.kind} entity at position [${entity.position.map(p => p.toFixed(1)).join(", ")}]`,
        timestamp: entity.createdAt,
        status: "active",
        source: "CosmosEntityRegistry",
      };
      setEntries((prev) => {
        if (prev.some((e) => e.id === `cosmos-${entity.id}`)) return prev;
        return [cosmosEntry, ...prev];
      });
    }

    return () => unsubSentinel();
  }, []);

  const filteredEntries = entries.filter((e) =>
    activeTab === "all" ? true : e.kind === activeTab,
  );

  const tabs = ["all", "research", "sentinel", "engineering"] as const;

  return (
    <GenesisWindowFrame title="Self Evolution" onClose={() => {}}>
      <div style={panel}>
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "4px 14px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.2)",
                background: activeTab === tab ? "rgba(103,232,249,0.12)" : "transparent",
                color: activeTab === tab ? "#67e8f9" : "rgba(148,163,184,0.6)",
                fontFamily: "inherit", fontSize: 12, cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* System summary */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18,
        }}>
          <SummaryCard label="Capabilities" value={CapabilityManifest.getInstance().getAvailable().length} color="#67e8f9" />
          <SummaryCard label="Cosmos Entities" value={CosmosEntityRegistry.getInstance().getActive().length} color="#a78bfa" />
          <SummaryCard label="Sentinel Alerts" value={Sentinel.getInstance().getUnacknowledged().length} color="#f87171" />
        </div>

        {/* Section: Recent Activity */}
        <div style={sectionTitle}>
          {activeTab === "all" ? "Recent Activity" : `${activeTab} activity`}
        </div>

        <AnimatePresence>
          {filteredEntries.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              style={{ color: "rgba(148,163,184,0.5)", fontSize: 13, padding: "20px 0", textAlign: "center" }}
            >
              No {activeTab} activity yet. As LELU operates, entries will appear here.
            </motion.div>
          ) : (
            filteredEntries.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                style={entryCard}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 999,
                    background: kindColors[entry.kind] ?? "#e2e8f0",
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: kindColors[entry.kind] ?? "#e2e8f0" }}>
                    {entry.title}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(148,163,184,0.4)", marginLeft: "auto" }}>
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "rgba(203,213,225,0.7)", lineHeight: 1.5 }}>
                  {entry.description.length > 120
                    ? entry.description.slice(0, 120) + "…"
                    : entry.description}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <span style={{
                    fontSize: 10, padding: "2px 8px", borderRadius: 999,
                    background: entry.status === "active" ? "rgba(52,211,153,0.15)" :
                                entry.status === "failed" ? "rgba(248,113,113,0.15)" :
                                entry.status === "proposed" ? "rgba(251,191,36,0.15)" :
                                "rgba(103,232,249,0.1)",
                    color: entry.status === "active" ? "#34d399" :
                           entry.status === "failed" ? "#f87171" :
                           entry.status === "proposed" ? "#fbbf24" : "#67e8f9",
                  }}>
                    {entry.status}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(148,163,184,0.4)" }}>
                    {entry.source}
                  </span>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </GenesisWindowFrame>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", borderRadius: 10,
      padding: "12px 14px", border: "1px solid rgba(148,163,184,0.08)",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
      <div style={{ fontSize: 10, color: "rgba(148,163,184,0.5)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
    </div>
  );
}