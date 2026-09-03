/**
 * ==========================================================
 * LÉLU
 * MEMORY BRIDGE
 *
 * Connects memory + cognition + user model. Retrieval happens
 * BEFORE generation, but the retrieved memories are first
 * evaluated and synthesized by the MemorySynthesizer — they
 * inform Lélu's understanding instead of being pasted into the
 * prompt verbatim. A memory only appears in the context when it
 * is relevant to THIS request; a request for more detail gets a
 * deeper subset (progressive disclosure).
 * ==========================================================
 */

import type Brain from "../brain/Brain";
import type UserManager from "./user/UserManager";
import type { AIRequest } from "../providers/AIProvider";
import AgentEventBus from "./agent/AgentEvents";
import ProjectStore from "./projects/ProjectStore";
import AgentStore from "./agents/AgentStore";
import AvatarStore from "./avatar/AvatarProfile";
import SupabasePersistence from "./persistence/SupabasePersistence";

export default class MemoryBridge {
  constructor(
    private readonly brain: Brain,
    private readonly user: UserManager,
  ) {}

  /**
   * Retrieve + evaluate + synthesize memory context and attach it
   * to the request before any provider generates a response.
   */
  public async enrich(request: AIRequest): Promise<AIRequest> {
    const memories = await this.brain.recall(request.prompt);
    const reflection = await this.brain.reflect();
    const conversation = this.brain.getConversation().context();
    const cognition = this.brain.cognitiveState();
    const profile = this.user.context();

    const synthesized = this.brain.synthesizeContext(request.prompt, memories, {
      deep: /(everything|all you (?:remember|know)|more detail|more details|tell me more|elaborate|expand|tell me everything)/i.test(request.prompt),
      profile,
      conversation: {
        lastTopic: conversation.lastTopic,
        recentMessages: conversation.recentMessages,
      },
    });

    const context = this.buildContext(
      synthesized,
      reflection,
      conversation,
      cognition,
    );

    // MERGE, never replace. `request.context` already carries the live
    // cognitive context (self-model, projects, agents, capabilities,
    // autonomous self-study state) that AIService assembled for this
    // turn. Overwriting it here silently threw all of that away, so the
    // model only ever saw memory — never LÉLU's actual runtime state.
    const merged = [request.context?.trim(), context.trim()]
      .filter((part): part is string => Boolean(part && part.length > 0))
      .join("\n\n");

    if (merged.length === 0) {
      return request;
    }

    return {
      ...request,
      context: merged,
      // The conversation turns in `request.messages` are the dialogue so
      // far and are left exactly as they are. Only the behavioural rules
      // are prepended as a system turn — the context itself already
      // reaches the provider through `context`, so repeating it here
      // would send the same text twice.
      messages: [
        {
          role: "system",
          content:
`You are Lélu.

You have an evolving memory and cognition model.

Rules:

- The context you are given is your memory and your live runtime state: known facts about the user, about yourself, and our history.
- The messages before this one are the actual conversation. Read them: do not ask for something the user has already told you, and do not repeat a question you have already asked.
- If the user corrects a fact, the correction wins — treat the older version as stale.
- Use context to understand and personalize — do NOT dump it back or announce "I remember that..." unless it is genuinely useful.
- Never invent personal information that is not in the context.
- Answer the user's actual question with the minimum sufficient relevant information first; go deeper only when asked.
- Keep answers concise and natural.`,
        },
        ...(request.messages ?? []),
      ],
    };
  }

  private buildContext(
    synthesized: {
      context: string;
      used: unknown[];
      rejected: number;
      contradictions: string[];
      notes: string[];
    },
    reflection: any,
    conversation: any,
    cognition: any,
  ): string {
    const sections: string[] = [];

    if (synthesized.context) {
      sections.push(synthesized.context);
    }

    if (reflection?.summary && reflection.memories?.length) {
      sections.push(`## Reflection\n${reflection.summary}`);
    }

    if (conversation?.lastTopic) {
      sections.push(`## Current Thread\nTopic: ${conversation.lastTopic}`);
    }

    if (cognition) {
      const formatted = this.formatCognition(cognition);
      if (formatted) {
        sections.push(`## Cognitive State\n${formatted}`);
      }
    }

    // REAL project + agent context from the persistent stores — LÉLU
    // knows what work exists and which specialists are available.
    const projectContext = this.formatProjects();
    if (projectContext) {
      sections.push(`## Projects\n${projectContext}`);
    }

    const agentContext = this.formatAgents();
    if (agentContext) {
      sections.push(`## Agents\n${agentContext}`);
    }

    const avatarContext = this.formatAvatar();
    if (avatarContext) {
      sections.push(`## Self\n${avatarContext}`);
    }

    return sections.join("\n\n");
  }

  private formatCognition(cognition: any): string {
    const output: string[] = [];

    if (cognition.workspaces?.length) {
      output.push(
        `Workspaces: ${cognition.workspaces.map((space: any) => space.name).join(", ")}`,
      );
    }

    if (cognition.nodes?.length) {
      output.push(
        `Recent knowledge nodes: ${cognition.nodes
          .slice(-5)
          .map((node: any) => node.label)
          .join(", ")}`,
      );
    }

    return output.join("\n");
  }

  /** Active projects with real content, newest first, capped. */
  private formatProjects(): string {
    const projects = ProjectStore.getInstance()
      .list()
      .filter((project) => project.status === "active" && project.items.length > 0)
      .slice(0, 4);
    if (projects.length === 0) {
      return "";
    }
    return projects
      .map((project) => {
        const kinds = [...new Set(project.items.map((item) => item.kind))].join(", ");
        return `- ${project.name}${project.description ? ` — ${project.description}` : ""} (${project.items.length} item(s): ${kinds})`;
      })
      .join("\n");
  }

  /** Runnable agents, so LÉLU knows her specialists. */
  private formatAgents(): string {
    const agents = AgentStore.getInstance().runnable().slice(0, 8);
    if (agents.length === 0) {
      return "";
    }
    return agents
      .map((agent) => `- ${agent.name} (${agent.role})${agent.capabilities.length > 0 ? ` — ${agent.capabilities.join(", ")}` : ""}`)
      .join("\n");
  }

  /** LÉLU's persistent visual identity (single source with the memory seed). */
  private formatAvatar(): string {
    const store = AvatarStore.getInstance();
    const profile = store.get();
    return `I am ${profile.identity.name}. ${profile.identity.selfDescription}`;
  }

  /**
   * Learn conversation (consolidation happens inside the Brain's
   * MemoryEngine, which decides what is durable enough to persist).
   */
  /**
   * Sentences in which the assistant asserts it COMPLETED a retrieval
   * action. Present tense ("I'm searching") is an intention and is not
   * matched; only claims of a finished action are, because only those
   * would be stored as though the action had happened.
   */
  private static readonly ACTION_CLAIM =
    /\b(?:I|I've|I have)\s+(?:just\s+)?(?:searched|looked\s+up|checked|fetched|retrieved|pulled\s+up|queried|browsed|read)\b[^.!?]*[.!?]/gi;

  /**
   * Did a tool actually produce a result for this turn?
   *
   * AgentEventBus keeps a bounded history precisely so cognition can
   * read what really happened; a completed tool_result for this taskId
   * is the evidence that an action claim is true.
   */
  private executionBackedBy(taskId: string | undefined): boolean {
    if (!taskId) return false;
    return AgentEventBus.getInstance()
      .recent(80)
      .some(
        (event) =>
          event.type === "tool_result" &&
          event.taskId === taskId &&
          event.status !== "error" &&
          Array.isArray((event as { results?: unknown[] }).results) &&
          ((event as { results: unknown[] }).results.length > 0),
      );
  }

  public async learn(prompt: string, response: string, taskId?: string): Promise<void> {
    // PROVENANCE. The model can write "I searched the Elpheru RSS feed"
    // whether or not anything ran, and persisting that verbatim turns a
    // sentence into a remembered fact — LÉLU would later recall having
    // done work she never did. An action claim is only durable when a
    // real tool_result for this turn backs it.
    const verified = this.executionBackedBy(taskId);
    let learnable = response;
    let redactedClaims = 0;

    if (!verified) {
      learnable = response.replace(MemoryBridge.ACTION_CLAIM, () => {
        redactedClaims += 1;
        return "";
      }).replace(/\s{2,}/g, " ").trim();

      if (redactedClaims > 0) {
        console.warn(
          "[MemoryBridge] Dropped %d unverified action claim(s) before storing — " +
            "no tool_result backed this turn.",
          redactedClaims,
        );
      }
    }

    // Nothing durable survived the redaction: the reply was ONLY an
    // unbacked claim, so there is no fact worth remembering.
    if (learnable.length === 0 && redactedClaims > 0) return;

    const learned = await this.brain.learn(prompt, learnable, "conversation", [], {
      source: "lelu-chat",
      // Provenance travels with the memory so a later reader can tell a
      // recorded action from a reported one.
      executionVerified: verified,
      ...(redactedClaims > 0 ? { redactedActionClaims: redactedClaims } : {}),
    });

    if (learned) {
      void SupabasePersistence.getInstance().persistMemories([learned]);
    }

    AgentEventBus.getInstance().emit({
      type: "memory_update",
      taskId: taskId ?? String(Date.now()),
      category: "conversation",
    });
  }
}
