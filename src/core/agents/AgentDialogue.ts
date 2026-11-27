/**
 * ==========================================================
 * LÉLU — AGENT CONVERSATIONS (WP13)
 *
 * Direct (two agents), group (three or more) and private self-dialogue
 * (one agent proposing, critiquing and revising its own work).
 *
 * Nothing here is a second store or a second runtime:
 *   - every turn is an AgentRunner.run → AIService.delegate call, so it
 *     goes through the real provider chain, the budget gate, the resource
 *     policy and the conversation registry like any agent task;
 *   - every turn is persisted as that agent's own AgentStore task (with a
 *     `dialogue` reference) and execution (the reply). The transcript is
 *     READ BACK from those records across the participants;
 *   - the dialogue's lifecycle (active, paused, completed, terminated…) is
 *     its ConversationRegistry record, and pause/terminate are enforced by
 *     the ResourcePolicy at the model-call gate.
 *
 * Each agent speaks with its own system prompt (identity, personality,
 * instructions, memory access) — AIService.agentSystemPrompt — so distinct
 * identities stay distinct. A turn that no provider answered is shown as
 * offline, a failed one as failed; nothing is filled in.
 * ==========================================================
 */

import AgentStore from "./AgentStore";
import AgentRunner from "./AgentRunner";
import type { AgentDialogueKind, AgentDialogueRef, LeluAgent } from "./AgentTypes";
import ConversationRegistry, { type ConversationRecord } from "../observability/ConversationRegistry";
import ResourcePolicy from "../observability/ResourcePolicy";

export type TurnState = "complete" | "running" | "queued" | "failed" | "offline" | "interrupted";

export interface DialogueTurn {
  turn: number;
  agentId: string;
  agentName: string;
  role?: AgentDialogueRef["role"];
  state: TurnState;
  text: string | null;
  provider: string | null;
  model: string | null;
  at: number;
  error?: string;
}

export interface DialogueSummary {
  id: string;
  kind: AgentDialogueKind;
  topic: string;
  participants: string[];
  status: ConversationRecord["status"] | "queued";
  turns: number;
  record: ConversationRecord | undefined;
}

const SELF_ROLES: Array<NonNullable<AgentDialogueRef["role"]>> = ["propose", "critique", "revise"];
const TYPE: Record<AgentDialogueKind, "agent-direct" | "agent-group" | "self-dialogue"> = { direct: "agent-direct", group: "agent-group", self: "self-dialogue" };
const TRANSCRIPT_CHARS = 3000;

export default class AgentDialogue {
  private static instance: AgentDialogue | null = null;
  static getInstance(): AgentDialogue {
    return (AgentDialogue.instance ??= new AgentDialogue());
  }

  private get store() {
    return AgentStore.getInstance();
  }
  /** Turns being run right now (a dialogue runs one turn at a time). */
  private running = new Set<string>();

  /** Open a dialogue. Nothing is said until a turn is run. */
  start(input: { kind: AgentDialogueKind; participants: string[]; topic: string; initiator?: "user" | "lelu" | "agent"; parentConversationId?: string | null }): DialogueSummary {
    const participants = [...new Set(input.participants)].filter((id) => this.store.get(id));
    if (input.kind === "self" && participants.length !== 1) throw new Error("A self-dialogue has exactly one agent.");
    if (input.kind === "direct" && participants.length !== 2) throw new Error("A direct conversation has exactly two agents.");
    if (input.kind === "group" && participants.length < 3) throw new Error("A group conversation needs at least three agents.");
    const topic = input.topic.trim();
    if (!topic) throw new Error("A conversation needs a topic.");
    const id = `dialogue:${input.kind}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const names = participants.map((p) => this.store.get(p)!.name);
    ConversationRegistry.getInstance().open({
      id,
      type: TYPE[input.kind],
      initiator: input.initiator ?? "user",
      purpose: topic.slice(0, 200),
      title: input.kind === "self" ? `${names[0]} · private self-dialogue: ${topic.slice(0, 60)}` : `${names.join(" ↔ ")}: ${topic.slice(0, 60)}`,
      parentId: input.parentConversationId ?? null,
      participants: participants.map((p) => `agent:${p}`),
    });
    // Opened, nothing run yet.
    ConversationRegistry.getInstance().settle(id, { ok: true });
    return this.summary(id)!;
  }

  /** Who speaks next: round-robin for direct/group, propose→critique→revise for self. */
  private next(ref: { kind: AgentDialogueKind; participants: string[] }, turn: number): { agentId: string; role?: AgentDialogueRef["role"] } {
    if (ref.kind === "self") return { agentId: ref.participants[0], role: SELF_ROLES[Math.min(turn, SELF_ROLES.length - 1)] };
    return { agentId: ref.participants[turn % ref.participants.length] };
  }

  private prompt(agent: LeluAgent, ref: { kind: AgentDialogueKind; participants: string[]; topic: string }, history: DialogueTurn[], role?: AgentDialogueRef["role"]): string {
    let transcript = history
      .filter((t) => t.state === "complete" && t.text)
      .map((t) => `${t.agentName}${t.role ? ` (${t.role})` : ""}: ${t.text}`)
      .join("\n\n");
    if (transcript.length > TRANSCRIPT_CHARS) transcript = `…${transcript.slice(-TRANSCRIPT_CHARS)}`;
    if (ref.kind === "self") {
      const step =
        role === "propose"
          ? "Write your first, concrete answer."
          : role === "critique"
            ? "Critique your previous answer honestly: what is wrong, missing or unsupported? Do not rewrite it yet."
            : "Write the improved answer, fixing what your critique found.";
      return [
        `This is your private self-dialogue (only you and the owner see it). Topic: ${ref.topic}`,
        transcript ? `Your work so far:\n${transcript}` : "",
        `${step} At most 150 words.`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    const others = ref.participants.filter((p) => p !== agent.id).map((p) => {
      const a = this.store.get(p);
      return a ? `${a.name} (${a.role})` : p;
    });
    return [
      `You are in a ${ref.kind === "group" ? "group" : "direct"} conversation with ${others.join(", ")}. Topic: ${ref.topic}`,
      transcript ? `The conversation so far:\n${transcript}` : "You speak first.",
      "Reply as yourself, from your own expertise, in at most 120 words. Address the others directly, build on or challenge what they said, and never speak for them.",
    ].join("\n\n");
  }

  /** Run one turn: a real model call through AgentRunner. */
  async step(dialogueId: string): Promise<DialogueTurn> {
    const summary = this.summary(dialogueId);
    if (!summary) throw new Error("No such conversation.");
    const control = ResourcePolicy.getInstance().workloadState(dialogueId);
    if (control?.state === "terminated" || summary.status === "terminated") throw new Error("This conversation was terminated.");
    if (control?.state === "paused" || summary.status === "paused") throw new Error("This conversation is paused. Resume it first.");
    if (summary.status === "completed") throw new Error("This conversation has ended.");
    if (this.running.has(dialogueId)) throw new Error("A turn is already running in this conversation.");
    const history = this.history(dialogueId);
    const turn = history.length;
    const { agentId, role } = this.next(summary, turn);
    const agent = this.store.get(agentId);
    if (!agent) throw new Error("A participant no longer exists.");
    const ref: AgentDialogueRef = { id: dialogueId, kind: summary.kind, turn, participants: summary.participants, topic: summary.topic, ...(role ? { role } : {}) };
    const previous = history.at(-1)?.agentId;
    this.running.add(dialogueId);
    try {
      await AgentRunner.getInstance().run(agentId, this.prompt(agent, summary, history, role), undefined, undefined, {
        delegatedBy: summary.kind === "self" || !previous || previous === agentId ? (summary.record?.initiator === "user" ? "user" : "lelu") : previous,
        dialogue: ref,
        routeReason: `${summary.kind} conversation turn ${turn + 1}`,
      });
    } finally {
      this.running.delete(dialogueId);
    }
    return this.history(dialogueId).find((t) => t.turn === turn)!;
  }

  /** Run up to `turns` turns, stopping at the first failure, pause or termination. */
  async run(dialogueId: string, turns: number): Promise<DialogueTurn[]> {
    const out: DialogueTurn[] = [];
    for (let i = 0; i < Math.min(12, Math.max(1, turns)); i++) {
      const t = await this.step(dialogueId);
      out.push(t);
      if (t.state !== "complete") break;
    }
    return out;
  }

  end(dialogueId: string, how: "completed" | "terminated" = "completed"): void {
    ConversationRegistry.getInstance().setStatus(dialogueId, how);
    if (how === "terminated") ResourcePolicy.getInstance().control(dialogueId, "terminated", { reason: "ended by the owner" });
  }

  /** The transcript, read back from the participants' AgentStore tasks and executions. */
  history(dialogueId: string): DialogueTurn[] {
    const turns: DialogueTurn[] = [];
    for (const agent of this.store.list())
      for (const task of agent.tasks) {
        if (task.dialogue?.id !== dialogueId) continue;
        const exec = task.executionId ? agent.executions.find((e) => e.id === task.executionId) : undefined;
        const offline = exec?.offline === true;
        turns.push({
          turn: task.dialogue.turn,
          agentId: agent.id,
          agentName: agent.name,
          role: task.dialogue.role,
          state: task.status === "complete" ? (offline ? "offline" : "complete") : task.status === "running" ? "running" : task.status === "queued" ? "queued" : task.status === "interrupted" ? "interrupted" : "failed",
          text: exec?.result ?? null,
          provider: exec?.provider ?? null,
          model: exec?.model ?? null,
          at: task.completedAt ?? task.createdAt,
          ...(task.error ? { error: task.error } : {}),
        });
      }
    return turns.sort((a, b) => a.turn - b.turn || a.at - b.at);
  }

  summary(dialogueId: string): DialogueSummary | undefined {
    const record = ConversationRegistry.getInstance().get(dialogueId);
    if (!record) return undefined;
    const kind: AgentDialogueKind = record.type === "self-dialogue" ? "self" : record.type === "agent-group" ? "group" : "direct";
    const participants = record.participants.filter((p) => p.startsWith("agent:")).map((p) => p.slice(6));
    const control = ResourcePolicy.getInstance().workloadState(dialogueId);
    const turns = this.history(dialogueId).length;
    return {
      id: dialogueId,
      kind,
      topic: record.purpose,
      participants,
      status: control?.state === "paused" ? "paused" : control?.state === "terminated" ? "terminated" : turns === 0 && record.status === "idle" ? "queued" : record.status,
      turns,
      record,
    };
  }

  /** Every agent conversation, newest activity first; optionally one agent's. */
  list(agentId?: string): DialogueSummary[] {
    return ConversationRegistry.getInstance()
      .list({ type: ["agent-direct", "agent-group", "self-dialogue"], ...(agentId ? { participant: `agent:${agentId}` } : {}) })
      .map((r) => this.summary(r.id)!)
      .filter(Boolean);
  }

  /** Pause / resume a dialogue: enforced at the model-call gate. */
  pause(dialogueId: string): void {
    ResourcePolicy.getInstance().control(dialogueId, "paused", { reason: "paused by the owner" });
    ConversationRegistry.getInstance().setStatus(dialogueId, "paused");
  }

  resume(dialogueId: string): void {
    ResourcePolicy.getInstance().control(dialogueId, "resume");
    ConversationRegistry.getInstance().setStatus(dialogueId, "idle");
  }
}
