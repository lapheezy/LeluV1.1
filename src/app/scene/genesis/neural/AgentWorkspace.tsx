/**
 * ==========================================================
 * LÉLU — AN AGENT'S OWN WORKSPACE (WP13), inside V3
 *
 * Everything is the agent's real record (AgentStore) and its real
 * conversations (AgentDialogue → registry + its own tasks). Controls write
 * the existing authorities: pause/resume through the ResourcePolicy (which
 * the gate and AgentRunner enforce), tools and goals through
 * AgentStore.update, conversations through AgentDialogue (real model turns).
 * ==========================================================
 */

import { useEffect, useState } from "react";
import AgentStore from "../../../../core/agents/AgentStore";
import AgentDialogue, { type DialogueSummary } from "../../../../core/agents/AgentDialogue";
import type { AgentTool, LeluAgent } from "../../../../core/agents/AgentTypes";
import ResourcePolicy from "../../../../core/observability/ResourcePolicy";
import ConversationRegistry from "../../../../core/observability/ConversationRegistry";
import { agentState } from "../../../../core/neural/multiverse/Aspects";
import { UsageView } from "../usage/usageView";

const ALL_TOOLS: AgentTool[] = ["chat", "research", "browse", "sketch", "render", "video", "file", "projects", "memory", "device", "sandbox", "engineering"];
const when = (t?: number) => (t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function useAgent(id: string): LeluAgent | undefined {
  const [, set] = useState(0);
  useEffect(() => {
    const bump = () => set((n) => n + 1);
    const offs = [AgentStore.getInstance().subscribe(bump), ConversationRegistry.getInstance().subscribe(bump), ResourcePolicy.getInstance().subscribe(bump)];
    return () => offs.forEach((o) => o());
  }, []);
  return AgentStore.getInstance().get(id);
}

export default function AgentWorkspace({ agentId }: { agentId: string }) {
  const agent = useAgent(agentId);
  const [tab, setTab] = useState<"profile" | "history" | "conversations">("profile");
  const [goal, setGoal] = useState("");
  const [topic, setTopic] = useState("");
  const [partners, setPartners] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!agent) return <p className="mv-hint">This agent is no longer in the Agent Store.</p>;
  const store = AgentStore.getInstance();
  const policy = ResourcePolicy.getInstance();
  const paused = Boolean(policy.get().agents[agent.id]?.paused);
  const state = agentState(agent, paused);
  const dialogues: DialogueSummary[] = AgentDialogue.getInstance().list(agent.id);
  const others = store.list().filter((a) => a.id !== agent.id && a.status !== "archived");
  const done = agent.tasks.filter((t) => t.status === "complete").length;
  const failed = agent.tasks.filter((t) => t.status === "failed").length;

  const startTalk = async () => {
    const d = AgentDialogue.getInstance();
    const kind = partners.length === 0 ? "self" : partners.length === 1 ? "direct" : "group";
    try {
      const s = d.start({ kind, participants: [agent.id, ...partners], topic, initiator: "user" });
      setBusy(s.id);
      setOpen(s.id);
      setTab("conversations");
      await d.run(s.id, kind === "self" ? 3 : partners.length + 1);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const step = async (id: string) => {
    setBusy(id);
    try {
      await AgentDialogue.getInstance().step(id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="aw" data-agent-workspace={agent.id} data-agent-state={state}>
      <h3>{agent.name}</h3>
      <p className="mv-kind">
        {agent.role} · <span data-state={state} className={`aw-state aw-${state}`}>{state}</span> · {agent.provider ?? "default provider chain"}
      </p>
      <div className="aw-controls">
        <button type="button" data-aw-pause onClick={() => policy.setAgent(agent.id, { paused: !paused })}>
          {paused ? "Resume agent" : "Pause agent"}
        </button>
        <button type="button" onClick={() => UsageView.open(dialogues[0]?.id ?? null)}>Usage</button>
      </div>
      <nav className="aw-tabs">
        {(["profile", "history", "conversations"] as const).map((t) => (
          <button key={t} type="button" data-on={tab === t ? "true" : "false"} data-aw-tab={t} onClick={() => setTab(t)}>
            {t}
            {t === "conversations" ? ` (${dialogues.length})` : t === "history" ? ` (${agent.tasks.length})` : ""}
          </button>
        ))}
      </nav>

      {tab === "profile" ? (
        <div className="aw-profile">
          <p className="aw-desc">{agent.description || agent.instructions.slice(0, 220)}</p>
          <dl>
            <div><dt>Personality</dt><dd>{agent.personality || "—"}</dd></div>
            <div><dt>Capabilities</dt><dd>{agent.capabilities.join(", ") || "—"}</dd></div>
            <div><dt>Knowledge</dt><dd>{agent.knowledge.join(", ") || "—"}</dd></div>
            <div><dt>Memory</dt><dd>{agent.memoryAccess}</dd></div>
            <div><dt>Reliability</dt><dd>{done + failed ? `${Math.round((done / (done + failed)) * 100)}% of ${done + failed} finished tasks` : "no finished task to measure"}</dd></div>
            <div><dt>Since</dt><dd>{when(agent.createdAt)}</dd></div>
          </dl>
          <h4>Goals</h4>
          <ul className="aw-goals">
            {(agent.goals ?? []).map((g, i) => (
              <li key={i}>
                {g}{" "}
                <button type="button" aria-label="Remove goal" onClick={() => store.update(agent.id, { goals: (agent.goals ?? []).filter((_, j) => j !== i) })}>✕</button>
              </li>
            ))}
          </ul>
          <span className="mv-row">
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Add a goal" aria-label="New goal" />
            <button type="button" data-aw-add-goal onClick={() => (goal.trim() ? (store.update(agent.id, { goals: [...(agent.goals ?? []), goal.trim()] }), setGoal("")) : null)}>Add</button>
          </span>
          <h4>Tools (restrict or grant)</h4>
          <div className="aw-tools">
            {ALL_TOOLS.map((t) => (
              <label key={t}>
                <input type="checkbox" checked={agent.tools.includes(t)} onChange={(e) => store.update(agent.id, { tools: e.target.checked ? [...agent.tools, t] : agent.tools.filter((x) => x !== t) })} /> {t}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "history" ? (
        <ol className="aw-history" data-aw-history={agent.tasks.length}>
          {[...agent.tasks].reverse().slice(0, 60).map((t) => {
            const exec = t.executionId ? agent.executions.find((e) => e.id === t.executionId) : undefined;
            return (
              <li key={t.id} data-task-status={t.status}>
                <b>{t.status}</b> {when(t.completedAt ?? t.createdAt)} · {t.dialogue ? `${t.dialogue.kind} conversation, turn ${t.dialogue.turn + 1}` : t.label.slice(0, 90)}
                {exec ? <small> · {exec.provider}/{exec.model}{exec.offline ? " (offline)" : ""}</small> : null}
                {t.error ? <small className="aw-err"> · {t.error.slice(0, 120)}</small> : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {tab === "conversations" ? (
        <div className="aw-convos">
          <fieldset>
            <legend>Start a conversation</legend>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic" aria-label="Conversation topic" />
            <div className="aw-partners">
              {others.map((a) => (
                <label key={a.id}>
                  <input type="checkbox" checked={partners.includes(a.id)} onChange={(e) => setPartners(e.target.checked ? [...partners, a.id] : partners.filter((p) => p !== a.id))} /> {a.name}
                </label>
              ))}
            </div>
            <button type="button" data-aw-start disabled={!topic.trim() || busy !== null} onClick={() => void startTalk()}>
              {partners.length === 0 ? "Start private self-dialogue" : partners.length === 1 ? "Start direct conversation" : `Start group conversation (${partners.length + 1})`}
            </button>
          </fieldset>
          {dialogues.map((d) => (
            <article key={d.id} data-aw-dialogue={d.id} data-status={d.status}>
              <header>
                <button type="button" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  {d.kind === "self" ? "self" : d.kind} · {d.topic.slice(0, 60)} <small>({d.turns} turns, {busy === d.id ? "running" : d.status})</small>
                </button>
              </header>
              {open === d.id ? (
                <>
                  <ol className="um-transcript">
                    {AgentDialogue.getInstance().history(d.id).map((t) => (
                      <li key={t.turn} data-turn-state={t.state}>
                        <b>{t.agentName}</b>
                        {t.role ? ` · ${t.role}` : ""} <small>[{t.state}{t.provider ? ` · ${t.provider}/${t.model}` : ""}]</small>
                        <p>{t.text ?? t.error ?? ""}</p>
                      </li>
                    ))}
                    {busy === d.id ? <li data-turn-state="running"><i>a turn is running…</i></li> : null}
                  </ol>
                  <div className="aw-controls">
                    <button type="button" data-aw-step disabled={busy !== null || d.status === "paused" || d.status === "terminated" || d.status === "completed"} onClick={() => void step(d.id)}>Next turn</button>
                    {d.status === "paused" ? (
                      <button type="button" onClick={() => AgentDialogue.getInstance().resume(d.id)}>Resume</button>
                    ) : (
                      <button type="button" onClick={() => AgentDialogue.getInstance().pause(d.id)}>Pause</button>
                    )}
                    <button type="button" onClick={() => AgentDialogue.getInstance().end(d.id)}>End</button>
                    <button type="button" className="aw-danger" onClick={() => AgentDialogue.getInstance().end(d.id, "terminated")}>Terminate</button>
                  </div>
                </>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
