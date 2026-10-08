/**
 * ==========================================================
 * LÉLU
 * GENESIS COGNITION PANEL — the Cognition workspace
 *
 * The persistent cognitive layer, editable and inspectable:
 *   SELF      — LÉLU's evolving self-model
 *   KNOWLEDGE — the knowledge library with statuses + gaps
 *   QUEUE     — the internal work queue (8 categories)
 *   SYSTEM    — the real system environment model
 *   AUTONOMY  — the autonomy gate + cognitive loop cycle
 *
 * All data comes from the persistent stores; nothing here is
 * hard-coded display text.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import SelfModel, { type SelfModelState } from "../../../core/cognition/SelfModel";
import KnowledgeLibrary, {
  KNOWLEDGE_DOMAINS,
  KNOWLEDGE_STATUS_LABELS,
  type KnowledgeDomain,
  type KnowledgeEntry,
  type KnowledgeStatus,
} from "../../../core/cognition/KnowledgeLibrary";
import WorkQueue, {
  QUEUE_CATEGORIES,
  QUEUE_CATEGORY_LABELS,
  type QueueCategory,
  type QueueItem,
} from "../../../core/cognition/WorkQueue";
import SystemEnvironment, { type SystemEnvironmentState } from "../../../core/cognition/SystemEnvironment";
import AutonomyGate, { AUTONOMY_LEVELS } from "../../../core/cognition/AutonomyGate";
import CognitiveLoop, { type CognitiveCycleReport } from "../../../core/cognition/CognitiveLoop";
import SelfStudy, {
  type SelfStudyCycleRecord,
  type SelfKnowledgeGap,
  type SelfStudyProposal,
  type SelfStudyWorkingState,
} from "../../../core/cognition/SelfStudy";
import ProjectMission, { type MissionState } from "../../../core/cognition/ProjectMission";

const labelStyle: CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  opacity: 0.62,
  marginBottom: 4,
  display: "block",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "white",
  fontSize: 12.5,
  outline: "none",
  fontFamily: "inherit",
};

const chipButton: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 999,
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "6px 12px",
  fontSize: 11.5,
  cursor: "pointer",
  fontFamily: "inherit",
};

type Tab = "self" | "study" | "knowledge" | "queue" | "system" | "autonomy";

const TABS: { id: Tab; label: string }[] = [
  { id: "self", label: "Self" },
  { id: "study", label: "Self-study" },
  { id: "knowledge", label: "Knowledge" },
  { id: "queue", label: "Queue" },
  { id: "system", label: "System" },
  { id: "autonomy", label: "Autonomy" },
];

interface GenesisCognitionPanelProps {
  onClose: () => void;
}

export default function GenesisCognitionPanel({ onClose }: GenesisCognitionPanelProps) {
  const selfModel = useMemo(() => SelfModel.getInstance(), []);
  const knowledge = useMemo(() => KnowledgeLibrary.getInstance(), []);
  const queue = useMemo(() => WorkQueue.getInstance(), []);
  const environment = useMemo(() => SystemEnvironment.getInstance(), []);
  const gate = useMemo(() => AutonomyGate.getInstance(), []);
  const loop = useMemo(() => CognitiveLoop.getInstance(), []);
  const study = useMemo(() => SelfStudy.getInstance(), []);
  const mission = useMemo(() => ProjectMission.getInstance(), []);

  const [tab, setTab] = useState<Tab>("self");
  const [selfState, setSelfState] = useState<SelfModelState>(() => selfModel.get());
  const [entries, setEntries] = useState<KnowledgeEntry[]>(() => knowledge.list());
  const [queueItems, setQueueItems] = useState<QueueItem[]>(() => queue.list());
  const [envState, setEnvState] = useState<SystemEnvironmentState>(() => environment.get());
  const [autonomyLevel, setAutonomyLevel] = useState<number>(() => gate.getLevel());
  const [report, setReport] = useState<CognitiveCycleReport | null>(() => loop.getLastReport());
  const [studyRecord, setStudyRecord] = useState<SelfStudyCycleRecord | null>(() => study.getLastCycle());
  const [studyWorking, setStudyWorking] = useState<SelfStudyWorkingState>(() => study.getWorkingState());
  const [studyGaps, setStudyGaps] = useState<SelfKnowledgeGap[]>(() => study.getGaps());
  const [studyProposals, setStudyProposals] = useState<SelfStudyProposal[]>(() => study.pendingAuthorization());
  const [missionState, setMissionState] = useState<MissionState>(() => mission.get());
  const [studyBusy, setStudyBusy] = useState(false);
  const [loopRunning, setLoopRunning] = useState(true);
  const [search, setSearch] = useState("");
  const [addField, setAddField] = useState("");
  const [addTarget, setAddTarget] = useState<keyof SelfModelState>("goals");
  const [queueDraft, setQueueDraft] = useState({ title: "", category: "NEXT" as QueueCategory, detail: "" });
  const [knowledgeDraft, setKnowledgeDraft] = useState({
    domain: "ai" as KnowledgeDomain,
    title: "",
    detail: "",
    status: "unverified" as KnowledgeStatus,
  });

  const refresh = useCallback(() => {
    setSelfState(selfModel.get());
    setEntries(knowledge.list());
    setQueueItems(queue.list());
    setEnvState(environment.get());
    setAutonomyLevel(gate.getLevel());
    // Short-term cognitive state changes mid-cycle, so it is polled with
    // everything else rather than only on cycle completion — otherwise
    // the panel would show "idle" during the phase it is watching.
    setStudyWorking(study.getWorkingState());
    setStudyGaps(study.getGaps());
    setStudyProposals(study.pendingAuthorization());
    setMissionState(mission.get());
  }, [environment, gate, knowledge, mission, queue, selfModel, study]);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 2000);
    const unsubscribe = loop.subscribe(setReport);
    const unsubscribeStudy = study.subscribe(setStudyRecord);
    return () => {
      window.clearInterval(interval);
      unsubscribe();
      unsubscribeStudy();
    };
  }, [loop, refresh, study]);

  const SELF_FIELDS: { key: keyof SelfModelState; label: string; color?: string }[] = [
    { key: "goals", label: "Goals" },
    { key: "longTermObjectives", label: "Long-term objectives" },
    { key: "learning", label: "Learning" },
    { key: "experiments", label: "Experiments" },
    { key: "discoveries", label: "Discoveries" },
    { key: "limitations", label: "Limitations" },
    { key: "improvements", label: "Improvements" },
    { key: "hypotheses", label: "Hypotheses" },
    { key: "unfinished", label: "Unfinished" },
    { key: "knows", label: "Knows" },
    { key: "capabilities", label: "Capabilities" },
    { key: "unavailable", label: "Unavailable" },
  ];

  const filteredEntries = search.trim()
    ? knowledge.search(search)
    : entries;

  function addSelfItem() {
    const value = addField.trim();
    if (!value) return;
    if (addTarget === "goals") selfModel.addGoal(value);
    else if (addTarget === "learning") selfModel.addLearning(value);
    else if (addTarget === "hypotheses") selfModel.addHypothesis(value);
    else if (addTarget === "improvements") selfModel.addImprovement(value);
    else if (addTarget === "unfinished") selfModel.addUnfinished(value);
    else if (addTarget === "discoveries") selfModel.recordDiscovery(value);
    else if (addTarget === "experiments") selfModel.recordExperiment(value);
    else selfModel.update({ [addTarget]: [...(selfState[addTarget] as string[]), value] } as Partial<SelfModelState>);
    setAddField("");
    refresh();
  }

  function removeSelfItem(field: keyof SelfModelState, value: string) {
    selfModel.removeItemByField(field, value);
    refresh();
  }

  function addQueueItem() {
    if (!queueDraft.title.trim()) return;
    queue.add({
      category: queueDraft.category,
      title: queueDraft.title.trim(),
      detail: queueDraft.detail.trim() || undefined,
      autonomy: 1,
    });
    setQueueDraft({ title: "", category: queueDraft.category, detail: "" });
    refresh();
  }

  function addKnowledgeEntry() {
    if (!knowledgeDraft.title.trim()) return;
    knowledge.add({
      domain: knowledgeDraft.domain,
      title: knowledgeDraft.title.trim(),
      detail: knowledgeDraft.detail.trim() || "—",
      status: knowledgeDraft.status,
      source: "manual",
    });
    setKnowledgeDraft({ ...knowledgeDraft, title: "", detail: "" });
    refresh();
  }

  const counts = queue.counts();
  const gaps = knowledge.gaps();
  const statusCounts = knowledge.statusCounts();

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Cognition"
      title="Cognition · persistent mind"
      onClose={onClose}
      width="min(96vw, 1100px)"
      maxHeight="min(90vh, 920px)"
      elevation="focus"
    >
      {/* tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={tab === item.id ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
            style={{ borderRadius: 999, padding: "7px 14px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            {item.label}
            {item.id === "knowledge" && gaps.length > 0 ? ` · ${gaps.length} gaps` : ""}
            {item.id === "queue" ? ` · ${counts.NOW + counts.NEXT}` : ""}
          </button>
        ))}
      </div>

      <div style={{ maxHeight: "min(72vh, 720px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* ------------------------------------------------ SELF */}
        {tab === "self" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14, background: "rgba(255,255,255,0.03)" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <span style={labelStyle}>Name</span>
                  <input
                    value={selfState.identity.name}
                    onChange={(event) => {
                      selfModel.update({ identity: { ...selfState.identity, name: event.target.value } });
                      refresh();
                    }}
                    style={fieldStyle}
                  />
                </div>
                <div style={{ flex: 3, minWidth: 260 }}>
                  <span style={labelStyle}>Self-description</span>
                  <input
                    value={selfState.identity.summary}
                    onChange={(event) => {
                      selfModel.update({ identity: { ...selfState.identity, summary: event.target.value } });
                      refresh();
                    }}
                    style={fieldStyle}
                  />
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6 }}>
                Last updated {new Date(selfState.updatedAt).toLocaleString()}
              </div>
            </div>

            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  value={addField}
                  onChange={(event) => setAddField(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addSelfItem();
                  }}
                  placeholder="Add to self-model…"
                  style={{ ...fieldStyle, flex: 1, minWidth: 200 }}
                />
                <select value={addTarget} onChange={(event) => setAddTarget(event.target.value as keyof SelfModelState)} style={{ ...fieldStyle, width: 190 }}>
                  {SELF_FIELDS.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addSelfItem} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.2)" }}>
                  Add
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
              {SELF_FIELDS.map((field) => {
                const items = selfState[field.key] as string[];
                return (
                  <div key={field.key} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
                    <div style={labelStyle}>
                      {field.label} · {items.length}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {items.length === 0 ? <span style={{ fontSize: 11.5, opacity: 0.5 }}>Empty</span> : null}
                      {items.map((item) => (
                        <span
                          key={item}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 11,
                            border: "1px solid rgba(255,255,255,0.14)",
                            borderRadius: 999,
                            padding: "4px 8px 4px 10px",
                            background: "rgba(255,255,255,0.04)",
                          }}
                        >
                          {item}
                          <button
                            type="button"
                            onClick={() => removeSelfItem(field.key, item)}
                            aria-label={`Remove ${item}`}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "rgba(248,113,113,0.9)",
                              cursor: "pointer",
                              fontSize: 10,
                              padding: 0,
                            }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------ KNOWLEDGE */}
        {tab === "knowledge" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <span style={labelStyle}>Search knowledge</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="filesystems, agents, canvas…" style={fieldStyle} />
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <span style={labelStyle}>Status mix</span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", paddingBottom: 4 }}>
                  {(Object.keys(statusCounts) as KnowledgeStatus[]).map((status) => (
                    <span key={status} style={{ fontSize: 10, borderRadius: 999, padding: "2px 8px", background: "rgba(255,255,255,0.06)", opacity: 0.85 }}>
                      {KNOWLEDGE_STATUS_LABELS[status]}: {statusCounts[status]}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {gaps.length > 0 ? (
              <div style={{ border: "1px solid rgba(250, 204, 21, 0.35)", borderRadius: 12, padding: 12, background: "rgba(250, 204, 21, 0.06)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, color: "#fde68a" }}>
                  Knowledge gaps · {gaps.length} — the cognitive loop proposes learning for these
                </div>
                {gaps.map((gap) => (
                  <div key={gap.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12 }}>
                    <span style={{ flex: 1 }}>{gap.title}</span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{gap.domain}</span>
                    <button
                      type="button"
                      onClick={() => {
                        knowledge.setStatus(gap.id, "learned");
                        refresh();
                      }}
                      style={{ ...chipButton, padding: "3px 10px", fontSize: 10.5 }}
                    >
                      Mark learned
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={labelStyle}>Add knowledge entry</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select
                  value={knowledgeDraft.domain}
                  onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, domain: event.target.value as KnowledgeDomain })}
                  style={{ ...fieldStyle, width: 150 }}
                >
                  {KNOWLEDGE_DOMAINS.map((domain) => (
                    <option key={domain.id} value={domain.id}>
                      {domain.label}
                    </option>
                  ))}
                </select>
                <input
                  value={knowledgeDraft.title}
                  onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, title: event.target.value })}
                  placeholder="Title"
                  style={{ ...fieldStyle, flex: 2, minWidth: 160 }}
                />
                <select
                  value={knowledgeDraft.status}
                  onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, status: event.target.value as KnowledgeStatus })}
                  style={{ ...fieldStyle, width: 130 }}
                >
                  {(Object.keys(KNOWLEDGE_STATUS_LABELS) as KnowledgeStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {KNOWLEDGE_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
                <input
                  value={knowledgeDraft.detail}
                  onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, detail: event.target.value })}
                  placeholder="Detail"
                  style={{ ...fieldStyle, flex: 3, minWidth: 160 }}
                />
                <button type="button" onClick={addKnowledgeEntry} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.2)" }}>
                  Add
                </button>
              </div>
            </div>

            {KNOWLEDGE_DOMAINS.map((domain) => {
              const domainEntries = filteredEntries.filter((entry) => entry.domain === domain.id);
              if (domainEntries.length === 0) return null;
              return (
                <div key={domain.id} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{domain.label}</span>
                    <span style={{ fontSize: 10.5, opacity: 0.55 }}>{domain.description}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {domainEntries.map((entry) => (
                      <div key={entry.id} style={{ display: "flex", gap: 8, alignItems: "center", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "7px 10px", background: "rgba(255,255,255,0.02)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{entry.title}</div>
                          <div style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.4 }}>{entry.detail}</div>
                        </div>
                        <select
                          value={entry.status}
                          onChange={(event) => {
                            knowledge.setStatus(entry.id, event.target.value as KnowledgeStatus);
                            refresh();
                          }}
                          style={{ ...fieldStyle, width: 118, padding: "5px 8px", fontSize: 11 }}
                        >
                          {(Object.keys(KNOWLEDGE_STATUS_LABELS) as KnowledgeStatus[]).map((status) => (
                            <option key={status} value={status}>
                              {KNOWLEDGE_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            knowledge.remove(entry.id);
                            refresh();
                          }}
                          aria-label={`Delete ${entry.title}`}
                          style={{ border: "none", background: "transparent", color: "rgba(248,113,113,0.85)", cursor: "pointer", fontSize: 11 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* ------------------------------------------------ QUEUE */}
        {tab === "queue" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={labelStyle}>Add to queue</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select
                  value={queueDraft.category}
                  onChange={(event) => setQueueDraft({ ...queueDraft, category: event.target.value as QueueCategory })}
                  style={{ ...fieldStyle, width: 170 }}
                >
                  {QUEUE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <input
                  value={queueDraft.title}
                  onChange={(event) => setQueueDraft({ ...queueDraft, title: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addQueueItem();
                  }}
                  placeholder="Item title"
                  style={{ ...fieldStyle, flex: 2, minWidth: 160 }}
                />
                <input
                  value={queueDraft.detail}
                  onChange={(event) => setQueueDraft({ ...queueDraft, detail: event.target.value })}
                  placeholder="Detail (optional)"
                  style={{ ...fieldStyle, flex: 3, minWidth: 160 }}
                />
                <button type="button" onClick={addQueueItem} style={{ ...chipButton, background: "rgba(34, 211, 238, 0.2)" }}>
                  Add
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
              {QUEUE_CATEGORIES.map((category) => {
                const items = queueItems.filter((item) => item.category === category && item.status === "open");
                return (
                  <div key={category} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: category === "NOW" ? "#fbbf24" : category === "REVIEW" ? "#a78bfa" : category === "BLOCKED" ? "#f87171" : "rgba(148,163,184,0.6)",
                          boxShadow: "0 0 6px currentColor",
                        }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        {QUEUE_CATEGORY_LABELS[category]}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 10.5, opacity: 0.55 }}>{items.length}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.length === 0 ? <span style={{ fontSize: 11.5, opacity: 0.5 }}>Empty</span> : null}
                      {items.map((item) => (
                        <div key={item.id} style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>{item.title}</div>
                          {item.detail ? <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.35 }}>{item.detail}</div> : null}
                          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            <select
                              value={item.category}
                              onChange={(event) => {
                                queue.move(item.id, event.target.value as QueueCategory);
                                refresh();
                              }}
                              style={{ ...fieldStyle, width: 96, padding: "4px 6px", fontSize: 10.5 }}
                            >
                              {QUEUE_CATEGORIES.map((target) => (
                                <option key={target} value={target}>
                                  {target}
                                </option>
                              ))}
                            </select>
                            <button type="button" onClick={() => { queue.complete(item.id); refresh(); }} style={{ ...chipButton, padding: "4px 10px", fontSize: 10.5 }}>
                              Done
                            </button>
                            <button type="button" onClick={() => { queue.drop(item.id); refresh(); }} style={{ ...chipButton, padding: "4px 10px", fontSize: 10.5, borderColor: "rgba(248,113,113,0.4)", color: "#fca5a5" }}>
                              Drop
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------ SYSTEM */}
        {tab === "system" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
                Real environment · refreshed {new Date(envState.updatedAt).toLocaleTimeString()}
              </div>
              <button
                type="button"
                onClick={() => {
                  void environment.refresh().then(refresh);
                }}
                style={{ ...chipButton, padding: "5px 12px", fontSize: 11 }}
              >
                Refresh
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
              {(
                [
                  ["Operating system", envState.os],
                  ["Browser", envState.browser],
                  ["Platform", envState.platform],
                  ["Language", envState.language],
                  ["Online", envState.online ? "Yes" : "No"],
                  ["CPU cores", envState.cpuCores !== null ? String(envState.cpuCores) : "Unknown"],
                  ["Device memory", envState.memoryGB !== null ? `${envState.memoryGB} GB` : "Unknown"],
                  ["Screen", envState.screen ? `${envState.screen.width}×${envState.screen.height} · dpr ${envState.screen.dpr}` : "Unknown"],
                  ["Touch input", envState.screen?.touch ? "Yes" : "No"],
                  ["WebGL", envState.gpu.webgl ? "Available" : "Unavailable"],
                  ["WebGPU", envState.gpu.webgpu ? "Available" : "Unavailable"],
                  ["GPU renderer", envState.gpu.renderer ?? "Unknown"],
                  ["Display mode", envState.environment],
                  [
                    "Storage used",
                    envState.storage?.availableBytes !== null && envState.storage?.availableBytes !== undefined
                      ? `${(envState.storage.availableBytes / 1024).toFixed(1)} KB used`
                      : "Estimate unavailable",
                  ],
                  [
                    "Storage quota",
                    envState.storage?.quotaBytes !== null && envState.storage?.quotaBytes !== undefined
                      ? `${(envState.storage.quotaBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
                      : "Unknown",
                  ],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: "10px 12px" }}>
                  <div style={labelStyle}>{label}</div>
                  <div style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------ SELF-STUDY */}
        {tab === "study" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* MISSION — the anchor every priority below is derived from */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={labelStyle}>Project mission · north star</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.85, marginTop: 6 }}>
                {missionState.northStar}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {missionState.programs.map((program) => (
                  <span
                    key={program.id}
                    style={{
                      fontSize: 10,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.15)",
                      opacity: program.status === "active" ? 1 : 0.6,
                    }}
                  >
                    {program.name} · {program.status}
                  </span>
                ))}
              </div>
            </div>

            {/* CURRENT COGNITIVE FOCUS — live, mid-cycle */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={labelStyle}>
                Current focus · {studyWorking.phase === "idle" ? "between cycles" : `phase: ${studyWorking.phase}`}
              </div>
              <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9 }}>
                {studyWorking.objective ?? studyRecord?.objective ?? "No objective formed yet."}
              </div>
              {studyWorking.agent || studyRecord?.agent ? (
                <div style={{ fontSize: 11, marginTop: 6, opacity: 0.7 }}>
                  Agent: {studyWorking.agent ?? studyRecord?.agent}
                </div>
              ) : null}
              <button
                type="button"
                disabled={studyBusy}
                onClick={() => {
                  setStudyBusy(true);
                  void study
                    .runCycle()
                    .then(setStudyRecord)
                    .finally(() => {
                      setStudyBusy(false);
                      refresh();
                    });
                }}
                style={{ ...chipButton, marginTop: 10, opacity: studyBusy ? 0.5 : 1 }}
              >
                {studyBusy ? "Studying…" : "Run a study cycle now"}
              </button>
            </div>

            {/* LAST CYCLE — the evidence chain */}
            {studyRecord ? (
              <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
                <div style={labelStyle}>
                  Cycle {studyRecord.cycle} · {studyRecord.ok ? "complete" : `failed at ${studyRecord.reachedPhase}`}
                </div>
                {studyRecord.subsystem ? (
                  <div style={{ fontSize: 12, marginTop: 6 }}>Studied: {studyRecord.subsystem}</div>
                ) : null}

                {studyRecord.missionReasons.length > 0 ? (
                  <div style={{ fontSize: 11, marginTop: 8, opacity: 0.7 }}>
                    Chosen because: {studyRecord.missionReasons.join(" · ")}
                  </div>
                ) : null}

                {studyRecord.evidence.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={labelStyle}>Evidence</div>
                    {studyRecord.evidence.map((item, index) => (
                      <div key={`${item.label}-${index}`} style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>
                        <span style={{ opacity: 0.55 }}>[{item.kind}]</span> {item.label}
                      </div>
                    ))}
                  </div>
                ) : null}

                {studyRecord.conclusion ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={labelStyle}>Conclusion</div>
                    <div style={{ fontSize: 11, lineHeight: 1.6, opacity: 0.85, whiteSpace: "pre-wrap" }}>
                      {studyRecord.conclusion.slice(0, 900)}
                    </div>
                  </div>
                ) : null}

                {/* A contradiction is the most important thing on this
                    panel when it exists — old belief vs new evidence. */}
                {studyRecord.contradiction ? (
                  <div
                    style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(255,180,80,0.4)",
                      background: "rgba(255,180,80,0.08)",
                    }}
                  >
                    <div style={labelStyle}>Contradiction detected</div>
                    <div style={{ fontSize: 11, marginTop: 4, opacity: 0.9 }}>{studyRecord.contradiction}</div>
                  </div>
                ) : null}

                {studyRecord.memoryWrites.length > 0 ? (
                  <div style={{ fontSize: 11, marginTop: 10, opacity: 0.7 }}>
                    Memory written: {studyRecord.memoryWrites.join(" · ")}
                  </div>
                ) : null}
                {studyRecord.agentSkippedReason ? (
                  <div style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>
                    Agent note: {studyRecord.agentSkippedReason}
                  </div>
                ) : null}
                {studyRecord.nextObjective ? (
                  <div style={{ fontSize: 11, marginTop: 6, opacity: 0.8 }}>
                    Next objective: {studyRecord.nextObjective}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* WAITING ON THE USER — the authorization boundary */}
            {studyProposals.length > 0 ? (
              <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
                <div style={labelStyle}>Awaiting your authorization ({studyProposals.length})</div>
                {studyProposals.slice(0, 6).map((proposal) => (
                  <div key={proposal.id} style={{ fontSize: 11, marginTop: 8, opacity: 0.85 }}>
                    <span style={{ opacity: 0.6 }}>[requires L{proposal.requiresLevel}]</span> {proposal.proposal}
                    <button
                      type="button"
                      onClick={() => {
                        study.clearProposal(proposal.id);
                        refresh();
                      }}
                      style={{ ...chipButton, marginLeft: 8, fontSize: 10 }}
                    >
                      Dismiss
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {/* OPEN QUESTIONS — what she still does not know */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={labelStyle}>
                Knowledge gaps · {studyGaps.filter((gap) => gap.status === "open").length} open of {studyGaps.length}
              </div>
              {studyGaps.slice(0, 12).map((gap) => (
                <div
                  key={gap.id}
                  style={{
                    fontSize: 11,
                    marginTop: 6,
                    opacity: gap.status === "open" ? 0.9 : 0.45,
                    display: "flex",
                    gap: 8,
                  }}
                >
                  <span style={{ opacity: 0.6, minWidth: 28 }}>[{gap.priority}]</span>
                  <span>
                    {gap.question}
                    {gap.status !== "open" ? ` · ${gap.status}` : ""}
                    {gap.attempts > 0 ? ` · ${gap.attempts} attempt(s)` : ""}
                  </span>
                </div>
              ))}
              {studyGaps.length === 0 ? (
                <div style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>
                  No gaps computed yet — run a study cycle.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------ AUTONOMY */}
        {tab === "autonomy" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={labelStyle}>Autonomy level · currently {gate.describe(autonomyLevel)}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8, marginTop: 8 }}>
                {AUTONOMY_LEVELS.map((level) => {
                  const active = autonomyLevel === level.level;
                  const reachable = level.level <= autonomyLevel;
                  return (
                    <button
                      key={level.level}
                      type="button"
                      onClick={() => {
                        gate.setLevel(level.level);
                        setAutonomyLevel(level.level);
                      }}
                      style={{
                        textAlign: "left",
                        border: active
                          ? "1px solid rgba(125, 211, 252, 0.55)"
                          : reachable
                            ? "1px solid rgba(255,255,255,0.14)"
                            : "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 12,
                        padding: "10px 12px",
                        background: active ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.03)",
                        color: reachable ? "white" : "rgba(160,178,200,0.55)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                        L{level.level} — {level.label} {active ? "✓" : ""}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 3, lineHeight: 1.45 }}>{level.description}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65, lineHeight: 1.5 }}>
                The cognitive loop runs at Observe/Suggest (L0–L1) no matter what. The Engineering workspace operates inside
                the sandbox (L2). Levels above the configured one always land in REVIEW for your approval.
              </div>
            </div>

            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Cognitive loop · cycle {report?.cycle ?? 0}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (loopRunning) {
                      loop.stop();
                      setLoopRunning(false);
                    } else {
                      loop.start();
                      setLoopRunning(true);
                    }
                  }}
                  style={{ ...chipButton, padding: "5px 12px", fontSize: 11 }}
                >
                  {loopRunning ? "Pause loop" : "Resume loop"}
                </button>
                <button
                  type="button"
                  onClick={() => void loop.runOnce()}
                  style={{ ...chipButton, padding: "5px 12px", fontSize: 11, background: "rgba(34, 211, 238, 0.2)" }}
                >
                  Run cycle now
                </button>
              </div>
              {report ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(
                      [
                        ["Memories", report.observed.memories],
                        ["Projects", report.observed.projects],
                        ["Agents", report.observed.agents],
                        ["Queue open", report.observed.queueOpen],
                        ["Queue done", report.observed.queueDone],
                        ["Knowledge", report.observed.knowledgeEntries],
                        ["Gaps", report.observed.knowledgeGaps],
                        ["Sandbox files", report.observed.sandboxFiles],
                      ] as [string, number][]
                    ).map(([label, value]) => (
                      <span key={label} style={{ fontSize: 10.5, borderRadius: 999, padding: "3px 10px", background: "rgba(255,255,255,0.06)" }}>
                        {label}: {value}
                      </span>
                    ))}
                  </div>
                  {report.selfUpdates.length > 0 ? (
                    <div>
                      <div style={labelStyle}>Self-model updates</div>
                      {report.selfUpdates.map((update) => (
                        <div key={update} style={{ fontSize: 11.5, opacity: 0.85, padding: "2px 0" }}>
                          • {update}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {report.suggestions.length > 0 ? (
                    <div>
                      <div style={labelStyle}>Proposals this cycle</div>
                      {report.suggestions.map((suggestion) => (
                        <div key={suggestion} style={{ fontSize: 11.5, opacity: 0.85, padding: "2px 0" }}>
                          • {suggestion}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, opacity: 0.55 }}>No new proposals this cycle — everything observed is stable.</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, opacity: 0.55 }}>No cycle has run yet — press “Run cycle now”.</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </GenesisWindowFrame>
  );
}
