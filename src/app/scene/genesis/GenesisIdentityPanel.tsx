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
import CuriosityEngine from "../../../core/curiosity/CuriosityEngine";
import CuriosityLedger from "../../../core/curiosity/CuriosityLedger";
import type { Curiosity, CuriosityStatus } from "../../../core/curiosity/Curiosity";
import { summarizeDevelopment } from "../../../core/identity/DevelopmentSummary";

type IdentityTab = "identity" | "journal" | "growth" | "relationship" | "questions" | "history";

// ---- STYLES ----

// The frame's own body scrolls (as in the Memory panel). A second scroller
// with a percentage max-height stretched the frame past the viewport and
// pushed its header and tabs off-screen.
const panelStyle: CSSProperties = {
  padding: "4px 2px",
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

function CapabilitiesSection() {
  const rows = CuriosityEngine.getInstance().capabilityStates();
  const strategies = CuriosityEngine.getInstance().strategies().filter((item) => item.status !== "superseded");
  if (rows.length === 0 && strategies.length === 0) return null;
  // "Unknown — no executor" is honest but uninformative one by one; it is
  // summarised, so the states that carry real knowledge stay visible.
  const notAvailable = rows.filter((row) => row.state !== "available" && row.basis !== "no-executor");
  const unknownCount = rows.filter((row) => row.basis === "no-executor").length;
  const available = rows.filter((row) => row.state === "available").length;
  const verified = rows.filter((row) => row.basis === "verified-use").length;
  const colour: Record<string, string> = {
    unavailable: "#f87171",
    permission_required: "#fbbf24",
    revalidation_needed: "#67e8f9",
    temporarily_failed: "#fbbf24",
    unknown: "rgba(148,163,184,0.6)",
  };
  const shown = [...notAvailable].sort((a, b) => (a.basis === "learned" ? -1 : 0) - (b.basis === "learned" ? -1 : 0)).slice(0, 6);
  return (
    <>
      <div style={sectionTitle}>What I can and cannot use ({available} available{verified ? `, ${verified} verified by use` : ""})</div>
      {shown.map((row) => (
        <div key={row.tool} style={{ ...card, ...labelText }}>
          <span style={{ color: colour[row.state] ?? "inherit" }}>{row.tool} · {row.state.replace("_", " ")}</span>
          <div style={{ fontSize: 11, color: "rgba(148,163,184,0.6)" }}>{row.reason}</div>
        </div>
      ))}
      {unknownCount > 0 && (
        <div style={{ ...card, ...labelText, color: "rgba(148,163,184,0.7)" }}>
          {unknownCount} catalogued capabilities cannot be called as tools — whether they work is unknown.
        </div>
      )}
      {strategies.map((item) => (
        <div key={item.id} style={{ ...card, ...labelText }}>
          Strategy: when {item.forTool} cannot be used, {item.alternative} stands in.
          <div style={{ fontSize: 11, color: "rgba(148,163,184,0.6)" }}>
            {item.status === "current" ? "Verified on a real request" : "Works, but not yet verified on a real request"}
            {item.coverage === "partial" ? ` · does not take ${item.missingInputs?.join(", ")}` : item.coverage === "full" ? " · takes every input" : ""}
          </div>
        </div>
      ))}
    </>
  );
}

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

      <CapabilitiesSection />
    </div>
  );
}

function SummaryList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={card}>
      <div style={{ ...labelText, marginBottom: 4, color: "rgba(148,163,184,0.6)", fontSize: 10, letterSpacing: "0.08em" }}>{label.toUpperCase()}</div>
      {items.slice(0, 6).map((item, i) => <div key={i} style={{ ...labelText, wordBreak: "break-word" }}>· {item}</div>)}
    </div>
  );
}

function DaySummary({ record }: { record: LeluDailyRecord }) {
  const summary = summarizeDevelopment(record);
  if (summary.empty) return <div style={emptyText}>No meaningful development recorded.</div>;
  return (
    <div>
      <SummaryList label="Learned" items={summary.learned} />
      <SummaryList label="Pursued" items={summary.pursued} />
      <SummaryList label="Discovered capabilities" items={summary.capabilitiesDiscovered} />
      <SummaryList label="Assumptions changed" items={summary.assumptionsChanged} />
      <SummaryList label="Unresolved" items={summary.unresolved} />
      <SummaryList label="Developing" items={[...summary.gotBetterAt, ...summary.emergingPatterns]} />
      <SummaryList label="Proposed to Heru" items={summary.proposals} />
    </div>
  );
}

function JournalView() {
  const [records, setRecords] = useState<LeluDailyRecord[]>([]);

  useEffect(() => {
    setRecords(DailyRecord.getInstance().getRecent(7));
  }, []);

  if (records.length === 0) {
    return <div style={emptyText}>No development recorded yet. A quiet stretch is valid — nothing is invented to fill it.</div>;
  }

  return (
    <div>
      {records.map((record, index) => (
        <div key={record.date}>
          <div style={sectionTitle}>
            {index === 0 ? `Latest · ${record.date}` : record.date}
            {record.reflection ? ` · reflected${record.reflection.meaningful ? "" : " — no meaningful development"}` : ""}
          </div>
          <DaySummary record={record} />
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

function GrowthView({ state, sandboxMode, onSandboxToggle, onChanged }: {
  state: LeluIdentityState;
  sandboxMode: boolean;
  onSandboxToggle: () => void;
  onChanged: () => void;
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
                  onClick={() => { LeluIdentity.getInstance().commitSandboxChange(c.id); onChanged(); }}
                  style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "1px solid #34d399", background: "transparent", color: "#34d399", cursor: "pointer" }}
                >Apply</button>
                <button
                  onClick={() => { LeluIdentity.getInstance().dismissSandboxChange(c.id); onChanged(); }}
                  style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "1px solid #f87171", background: "transparent", color: "#f87171", cursor: "pointer" }}
                >Dismiss</button>
              </div>
            </div>
          ))}
        </>
      )}

      <DevelopmentalEvidenceSection />

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

function DevelopmentalEvidenceSection() {
  const daily = DailyRecord.getInstance();
  const today = daily.getRecent(1)[0];
  const pending = today && !today.reflection ? today.developmentalEvidence ?? [] : [];
  const lastReflected = daily.getAll().filter((record) => record.reflection).at(-1);
  return (
    <>
      <div style={sectionTitle}>Developmental evidence</div>
      {pending.length === 0 ? (
        <div style={{ ...emptyText, padding: "4px 0 8px" }}>None awaiting reflection.</div>
      ) : (
        pending.map((item) => (
          <div key={`${item.traitId}-${item.unitId}`} style={{ ...card, ...labelText }}>
            {item.traitId} · awaiting tonight's reflection
            <div style={{ fontSize: 11, color: "rgba(148,163,184,0.6)" }}>{item.observation}</div>
          </div>
        ))
      )}
      {lastReflected?.reflection && (
        <div style={{ ...card, ...labelText }}>
          Last reflection ({lastReflected.date}):{" "}
          {lastReflected.reflection.meaningful
            ? lastReflected.reflection.traitChanges
                .map((change) => `${change.traitName} ${change.previousConfidence.toFixed(2)}→${change.newConfidence.toFixed(2)}${change.previousStatus !== change.newStatus ? ` (${change.previousStatus}→${change.newStatus})` : ""}`)
                .join(", ") || `${lastReflected.reflection.staged} change(s) staged`
            : "no meaningful development detected"}
        </div>
      )}
    </>
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

const QUESTION_GROUPS: Array<{ label: string; statuses: CuriosityStatus[]; limit: number }> = [
  { label: "Waiting for Heru", statuses: ["asking"], limit: 10 },
  { label: "Investigating", statuses: ["retrieving", "investigating", "verifying", "learned", "applied"], limit: 10 },
  { label: "Revisiting", statuses: ["revisiting"], limit: 6 },
  { label: "Curious about", statuses: ["queued", "identified"], limit: 12 },
  { label: "Resolved", statuses: ["resolved"], limit: 8 },
  { label: "Unresolved", statuses: ["blocked", "expired", "dismissed"], limit: 8 },
];

function CuriosityDetail({ id }: { id: string }) {
  const explanation = CuriosityEngine.getInstance().explain(id);
  if (!explanation) return null;
  const rows: Array<[string, string | string[]]> = [
    ["Detected", explanation.detected],
    ["Why it matters", explanation.why],
    ["Route", explanation.route],
    ["Potential action", explanation.potentialAction],
    ["Tools", explanation.tools],
    ["Permission", explanation.permissions],
    ["Evidence", explanation.evidence],
    ["Verification", explanation.confidence],
    ["Learning", explanation.learning],
    ["Applied", explanation.applied],
    ["Personality impact", explanation.personalityImpact],
    ["Re-evaluations", explanation.reevaluations],
  ];
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid rgba(148,163,184,0.12)", paddingTop: 6 }}>
      {rows.map(([label, value]) => {
        const items = Array.isArray(value) ? value : [value];
        if (items.length === 0) return null;
        return (
          <div key={label} style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "rgba(148,163,184,0.55)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
            {items.map((item, index) => (
              <div key={index} style={{ fontSize: 11, color: "rgba(203,213,225,0.85)", lineHeight: 1.45, wordBreak: "break-word" }}>{item}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function QuestionsView({ state }: { state: LeluIdentityState }) {
  const [curiosities, setCuriosities] = useState<Curiosity[]>(() => CuriosityLedger.getInstance().list());
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const ledger = CuriosityLedger.getInstance();
    return ledger.subscribe(() => setCuriosities(ledger.list()));
  }, []);

  if (curiosities.length === 0 && state.curiosities.length === 0) {
    return <div style={emptyText}>No curiosities yet. A quiet stretch is valid — nothing is invented to fill it.</div>;
  }

  return (
    <div>
      {QUESTION_GROUPS.map((group) => {
        const items = curiosities.filter((item) => group.statuses.includes(item.status)).slice(0, group.limit);
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            <div style={sectionTitle}>{group.label} ({items.length})</div>
            {items.map((item) => (
              <div
                key={item.id}
                style={{ ...card, cursor: state.sandboxMode ? "pointer" : "default" }}
                onClick={() => state.sandboxMode && setOpen(open === item.id ? null : item.id)}
              >
                <div style={labelText}>{item.hostQuestion?.text ?? item.question}</div>
                <div style={{ fontSize: 10, color: "rgba(148,163,184,0.55)", marginTop: 3 }}>
                  {item.category} · {item.status}
                  {item.verification ? ` · ${item.verification.verdict} ${item.verification.confidence.toFixed(2)}` : ""}
                  {item.learning?.retrievable ? " · remembered" : ""}
                  {item.blockedReason ? ` · ${item.blockedReason}` : ""}
                </div>
                {item.learning && group.label === "Resolved" && (
                  <div style={{ ...labelText, fontSize: 11, marginTop: 4, color: "rgba(167,243,208,0.85)" }}>
                    {item.learning.summary.slice(0, 220)}
                    {(item.reevaluations?.length ?? 0) > 0 ? ` · re-checked ${item.reevaluations!.length}×` : ""}
                  </div>
                )}
                {state.sandboxMode && open === item.id && <CuriosityDetail id={item.id} />}
              </div>
            ))}
          </div>
        );
      })}
      {state.curiosities.length > 0 && (
        <>
          <div style={sectionTitle}>From reflection ({state.curiosities.length})</div>
          {[...state.curiosities].reverse().map((q, i) => (
            <div key={i} style={{ ...card, ...labelText }}>{q}</div>
          ))}
        </>
      )}
      {state.sandboxMode && <div style={{ ...emptyText, fontSize: 11 }}>Sandbox Mode: click a question to see its full trace.</div>}
    </div>
  );
}

function ReevaluationHistory() {
  const items = CuriosityLedger.getInstance()
    .list()
    .flatMap((c) => [
      ...(c.reevaluations ?? []).map((item) => ({ at: item.at, text: `${item.outcome === "superseded" ? "Superseded" : item.outcome === "confirmed" ? "Re-checked, still true" : "Re-checked, inconclusive"}: ${item.after}` })),
    ])
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  if (items.length === 0) return null;
  return (
    <>
      <div style={sectionTitle}>Re-evaluations</div>
      {items.map((item, i) => (
        <div key={i} style={{ ...card, ...labelText }}>
          <span style={{ fontSize: 10, color: "rgba(148,163,184,0.5)" }}>{new Date(item.at).toLocaleString()}</span>
          <div>{item.text}</div>
        </div>
      ))}
    </>
  );
}

function HistoryView({ state }: { state: LeluIdentityState }) {
  const history = [...state.developmentHistory].reverse();
  const hasReevaluations = CuriosityLedger.getInstance().list().some((c) => (c.reevaluations ?? []).length > 0);

  if (history.length === 0 && !hasReevaluations) {
    return <div style={emptyText}>No development history recorded yet.</div>;
  }

  return (
    <div>
      <ReevaluationHistory />
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
    setState({ ...identity.getState() });
  };

  // getState() returns the same mutated object, so a copy is what makes React re-render.
  const refresh = () => setState({ ...LeluIdentity.getInstance().getState() });

  const tabs: Array<{ id: IdentityTab; label: string }> = [
    { id: "identity", label: "Identity" },
    { id: "journal", label: "Journal" },
    { id: "growth", label: "Growth" },
    { id: "relationship", label: "Relationship" },
    { id: "questions", label: "Questions" },
    { id: "history", label: "History" },
  ];

  return (
    <GenesisWindowFrame eyebrow="LÉLU" title="Identity" onClose={onClose} maxHeight="min(52vh, 480px)">
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
                onChanged={refresh}
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
