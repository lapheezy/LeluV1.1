/**
 * ==========================================================
 * LÉLU — IDENTITY PANEL
 *
 * Displays LÉLU's personality development state. Six views:
 * IDENTITY, JOURNAL, GROWTH, RELATIONSHIP, QUESTIONS, HISTORY.
 *
 * All data comes from real stored state — nothing is fabricated.
 * The "No development recorded today" message is intentional
 * when the daily record is genuinely empty.
 * ==========================================================
 */

import { useState, useEffect, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import LeluIdentity, { type LeluIdentityState, type LeluTrait } from "../../../core/identity/LeluIdentity";
import DailyRecord, { type LeluDailyRecord } from "../../../core/identity/DailyRecord";

type IdentityTab = "identity" | "journal" | "growth" | "relationship" | "questions" | "history";

// ---- STYLES ----

const panelStyle: CSSProperties = {
  padding: "16px 20px",
  overflowY: "auto",
  maxHeight: "calc(100% - 30px)",
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(148,163,184,0.3) transparent",
};

const tabBarStyle: CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 16,
  flexWrap: "wrap",
};

const tabStyle = (active: boolean): CSSProperties => ({
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  cursor: "pointer",
  border: active ? "1px solid rgba(167,139,250,0.6)" : "1px solid rgba(148,163,184,0.2)",
  background: active ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.03)",
  color: active ? "#a78bfa" : "rgba(148,163,184,0.7)",
});

const sectionTitle: CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.1em",
  color: "rgba(148,163,184,0.6)",
  textTransform: "uppercase",
  marginBottom: 8,
  marginTop: 18,
};

const card: CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  borderRadius: 8,
  padding: "10px 12px",
  border: "1px solid rgba(148,163,184,0.1)",
  marginBottom: 6,
};

const labelText: CSSProperties = {
  fontSize: 12,
  color: "rgba(148,163,184,0.9)",
  lineHeight: 1.5,
};

const valueText: CSSProperties = {
  fontSize: 13,
  color: "rgba(226,232,240,0.95)",
  lineHeight: 1.6,
};

const emptyText: CSSProperties = {
  fontSize: 12,
  color: "rgba(148,163,184,0.5)",
  fontStyle: "italic",
  padding: "12px 0",
};

const statusColors: Record<string, string> = {
  candidate: "rgba(148,163,184,0.6)",
  emerging: "#67e8f9",
  established: "#34d399",
  evolving: "#fbbf24",
  declining: "#f87171",
  retired: "rgba(148,163,184,0.3)",
};

const directionSymbols: Record<string, string> = {
  increasing: "↑",
  stable: "→",
  decreasing: "↓",
  unknown: "·",
};

// ---- SUB-VIEWS ----

function IdentityView({ state }: { state: LeluIdentityState }) {
  return (
    <div>
      <div style={sectionTitle}>Self Concept</div>
      <div style={{ ...card, ...valueText }}>{state.selfConcept || <span style={emptyText}>Not yet defined</span>}</div>

      <div style={sectionTitle}>Core Values</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {state.coreValues.map((v) => (
          <span key={v} style={{ ...card, padding: "3px 10px", fontSize: 12, color: "#a78bfa", marginBottom: 0 }}>{v}</span>
        ))}
      </div>

      <div style={sectionTitle}>Communication Style</div>
      <div style={{ ...card, ...labelText }}>{state.communicationStyle}</div>

      {state.strengths.length > 0 && (
        <>
          <div style={sectionTitle}>Strengths</div>
          <div style={card}>
            {state.strengths.map((s) => (
              <div key={s} style={{ ...labelText, marginBottom: 3 }}>· {s}</div>
            ))}
          </div>
        </>
      )}

      {state.growthAreas.length > 0 && (
        <>
          <div style={sectionTitle}>Growth Areas</div>
          <div style={card}>
            {state.growthAreas.map((g) => (
              <div key={g} style={{ ...labelText, marginBottom: 3 }}>· {g}</div>
            ))}
          </div>
        </>
      )}

      {state.principles.length > 0 && (
        <>
          <div style={sectionTitle}>Principles</div>
          {state.principles.map((p) => (
            <div key={p} style={{ ...card, ...labelText }}>{p}</div>
          ))}
        </>
      )}
    </div>
  );
}

function JournalView() {
  const [todayRecord, setTodayRecord] = useState<LeluDailyRecord | null>(null);
  const [recentRecords, setRecentRecords] = useState<LeluDailyRecord[]>([]);

  useEffect(() => {
    const daily = DailyRecord.getInstance();
    const today = daily.getOrCreateToday();
    setTodayRecord(today);
    setRecentRecords(daily.getRecent(7));
  }, []);

  const hasToday = todayRecord && (
    todayRecord.observations.length > 0 ||
    todayRecord.experiences.length > 0 ||
    todayRecord.meaningfulInteractions.length > 0 ||
    todayRecord.lessons.length > 0
  );

  return (
    <div>
      <div style={sectionTitle}>Today</div>
      {!hasToday ? (
        <div style={emptyText}>No development recorded today.</div>
      ) : (
        <div>
          {todayRecord.observations.length > 0 && (
            <div style={card}>
              <div style={{ ...labelText, marginBottom: 4, color: "rgba(148,163,184,0.6)", fontSize: 10 }}>OBSERVATIONS</div>
              {todayRecord.observations.map((o, i) => <div key={i} style={labelText}>· {o}</div>)}
            </div>
          )}
          {todayRecord.experiences.length > 0 && (
            <div style={card}>
              <div style={{ ...labelText, marginBottom: 4, color: "rgba(148,163,184,0.6)", fontSize: 10 }}>EXPERIENCES</div>
              {todayRecord.experiences.map((e, i) => <div key={i} style={labelText}>· {e}</div>)}
            </div>
          )}
          {todayRecord.lessons.length > 0 && (
            <div style={card}>
              <div style={{ ...labelText, marginBottom: 4, color: "rgba(148,163,184,0.6)", fontSize: 10 }}>LESSONS</div>
              {todayRecord.lessons.map((l, i) => <div key={i} style={labelText}>· {l}</div>)}
            </div>
          )}
        </div>
      )}

      {recentRecords.filter((r) => r.date !== todayRecord?.date && r.observations.length + r.experiences.length > 0).slice(0, 4).map((r) => (
        <div key={r.date}>
          <div style={sectionTitle}>{r.date}</div>
          <div style={card}>
            {[...r.observations, ...r.experiences].slice(0, 4).map((item, i) => (
              <div key={i} style={labelText}>· {item}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div style={{ height: 3, background: "rgba(148,163,184,0.15)", borderRadius: 2, overflow: "hidden", margin: "4px 0" }}>
      <div style={{
        height: "100%",
        width: `${Math.round(value * 100)}%`,
        background: value >= 0.65 ? "#34d399" : value >= 0.45 ? "#67e8f9" : "rgba(148,163,184,0.5)",
        borderRadius: 2,
      }} />
    </div>
  );
}

function TraitCard({ trait }: { trait: LeluTrait }) {
  return (
    <div style={{ ...card, padding: "8px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "rgba(226,232,240,0.9)" }}>{trait.name}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: statusColors[trait.status] ?? "#e2e8f0" }}>{trait.status}</span>
          <span style={{ fontSize: 12, color: "rgba(148,163,184,0.6)" }}>
            {directionSymbols[trait.developmentDirection] ?? "·"}
          </span>
        </div>
      </div>
      <ConfidenceBar value={trait.confidence} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontSize: 10, color: "rgba(148,163,184,0.5)" }}>{trait.description.slice(0, 60)}…</span>
        <span style={{ fontSize: 10, color: "rgba(148,163,184,0.5)" }}>{trait.evidenceCount} obs</span>
      </div>
    </div>
  );
}

function GrowthView({ state, sandboxMode, onSandboxToggle }: {
  state: LeluIdentityState;
  sandboxMode: boolean;
  onSandboxToggle: () => void;
}) {
  const groups: Record<string, LeluTrait[]> = {
    established: [],
    emerging: [],
    candidate: [],
    "evolving/declining": [],
    retired: [],
  };

  for (const trait of state.traits) {
    if (trait.status === "evolving" || trait.status === "declining") {
      groups["evolving/declining"].push(trait);
    } else if (trait.status === "retired") {
      groups.retired.push(trait);
    } else {
      groups[trait.status]?.push(trait);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "rgba(148,163,184,0.7)" }}>Sandbox Mode</span>
        <button
          onClick={onSandboxToggle}
          style={{
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            cursor: "pointer",
            border: sandboxMode ? "1px solid #67e8f9" : "1px solid rgba(148,163,184,0.3)",
            background: sandboxMode ? "rgba(103,232,249,0.1)" : "rgba(255,255,255,0.03)",
            color: sandboxMode ? "#67e8f9" : "rgba(148,163,184,0.6)",
          }}
        >
          {sandboxMode ? "ON — changes staged" : "OFF — apply directly"}
        </button>
      </div>

      {state.pendingSandboxChanges.length > 0 && (
        <>
          <div style={sectionTitle}>Pending ({state.pendingSandboxChanges.length})</div>
          {state.pendingSandboxChanges.map((c) => (
            <div key={c.id} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={labelText}>{c.description.slice(0, 80)}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => { LeluIdentity.getInstance().commitSandboxChange(c.id); window.location.reload(); }}
                  style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "1px solid #34d399", background: "transparent", color: "#34d399", cursor: "pointer" }}
                >Apply</button>
                <button
                  onClick={() => { LeluIdentity.getInstance().dismissSandboxChange(c.id); window.location.reload(); }}
                  style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "1px solid #f87171", background: "transparent", color: "#f87171", cursor: "pointer" }}
                >Dismiss</button>
              </div>
            </div>
          ))}
        </>
      )}

      {(["established", "emerging", "candidate", "evolving/declining"] as const).map((group) => {
        const traits = groups[group];
        if (traits.length === 0) return null;
        return (
          <div key={group}>
            <div style={sectionTitle}>{group}</div>
            {traits.map((t) => <TraitCard key={t.id} trait={t} />)}
          </div>
        );
      })}
    </div>
  );
}

function RelationshipView({ state }: { state: LeluIdentityState }) {
  const { relationshipContext: rc } = state;

  const sections: Array<{ label: string; items: string[] }> = [
    { label: "Interaction Patterns", items: rc.interactionPatterns },
    { label: "Shared Interests", items: rc.sharedInterests },
    { label: "Collaboration Patterns", items: rc.collaborationPatterns },
    { label: "Complementary Patterns", items: rc.complementaryPatterns },
    { label: "How LÉLU Supports", items: rc.howLeluSupportsUser },
    { label: "How LÉLU Challenges", items: rc.howLeluChallengesUser },
    { label: "Communication Patterns", items: rc.communicationPatterns },
    { label: "Open Uncertainties", items: rc.uncertainties },
  ];

  const hasContent = sections.some((s) => s.items.length > 0);

  if (!hasContent) {
    return <div style={emptyText}>No relationship observations recorded yet.</div>;
  }

  return (
    <div>
      {sections.filter((s) => s.items.length > 0).map((s) => (
        <div key={s.label}>
          <div style={sectionTitle}>{s.label}</div>
          <div style={card}>
            {s.items.map((item, i) => (
              <div key={i} style={{ ...labelText, marginBottom: 3 }}>· {item}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuestionsView({ state }: { state: LeluIdentityState }) {
  if (state.curiosities.length === 0) {
    return <div style={emptyText}>No curiosities recorded yet.</div>;
  }

  return (
    <div>
      <div style={sectionTitle}>Current Curiosities ({state.curiosities.length})</div>
      {[...state.curiosities].reverse().map((q, i) => (
        <div key={i} style={{ ...card, ...labelText }}>
          {i + 1}. {q}
        </div>
      ))}
    </div>
  );
}

function HistoryView({ state }: { state: LeluIdentityState }) {
  const history = [...state.developmentHistory].reverse();

  if (history.length === 0) {
    return <div style={emptyText}>No development history recorded yet.</div>;
  }

  return (
    <div>
      {history.map((snapshot, i) => (
        <div key={i} style={{ ...card, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "#a78bfa" }}>{snapshot.date}</span>
            <span style={{ fontSize: 10, color: "rgba(148,163,184,0.5)" }}>
              {new Date(snapshot.snapshotAt).toLocaleTimeString()}
            </span>
          </div>
          <div style={{ ...labelText, marginBottom: 6 }}>{snapshot.description}</div>
          {snapshot.traitChanges.length > 0 && (
            <div>
              {snapshot.traitChanges.map((tc, j) => (
                <div key={j} style={{ fontSize: 11, color: "rgba(148,163,184,0.6)", marginBottom: 2 }}>
                  {tc.traitName}: {tc.previousStatus} → {tc.newStatus}
                  {" "}({tc.previousConfidence.toFixed(2)} → {tc.newConfidence.toFixed(2)})
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- MAIN PANEL ----

export default function GenesisIdentityPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<IdentityTab>("identity");
  const [state, setState] = useState<LeluIdentityState | null>(null);

  useEffect(() => {
    const identity = LeluIdentity.getInstance();
    setState(identity.getState());
  }, []);

  const handleSandboxToggle = () => {
    if (!state) return;
    const identity = LeluIdentity.getInstance();
    identity.setSandboxMode(!state.sandboxMode);
    setState(identity.getState());
  };

  const tabs: Array<{ id: IdentityTab; label: string }> = [
    { id: "identity", label: "Identity" },
    { id: "journal", label: "Journal" },
    { id: "growth", label: "Growth" },
    { id: "relationship", label: "Relationship" },
    { id: "questions", label: "Questions" },
    { id: "history", label: "History" },
  ];

  return (
    <GenesisWindowFrame label="LÉLU" title="Identity" onClose={onClose}>
      <div style={panelStyle}>
        <div style={tabBarStyle}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              style={tabStyle(activeTab === tab.id)}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!state ? (
          <div style={emptyText}>Loading identity…</div>
        ) : (
          <>
            {activeTab === "identity" && <IdentityView state={state} />}
            {activeTab === "journal" && <JournalView />}
            {activeTab === "growth" && (
              <GrowthView
                state={state}
                sandboxMode={state.sandboxMode}
                onSandboxToggle={handleSandboxToggle}
              />
            )}
            {activeTab === "relationship" && <RelationshipView state={state} />}
            {activeTab === "questions" && <QuestionsView state={state} />}
            {activeTab === "history" && <HistoryView state={state} />}
          </>
        )}
      </div>
    </GenesisWindowFrame>
  );
}
