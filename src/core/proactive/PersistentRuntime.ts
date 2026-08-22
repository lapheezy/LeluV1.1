/**
 * ==========================================================
 * LÉLU
 * PERSISTENT RUNTIME — the autonomous event loop
 *
 * Bridges external/internal events into the EXISTING ProactiveCore:
 *
 *   event (project change / agent completion / routine / watch)
 *     → PersistentRuntime
 *     → ProactiveCore (priority + confidence + settings)
 *     → NotificationProvider (dedup + deep-link + history)
 *     → MultiChatStore (route to the right conversation)
 *
 * HONEST PLATFORM LIMIT — this web adapter is a foreground loop:
 * it evaluates on a timer and immediately after the tab returns
 * to the foreground. Web pages cannot run arbitrary code while
 * backgrounded. True background execution (closed tab / device
 * sleep) needs a native/desktop adapter or a remote push server,
 * which is isolated here behind the RuntimeAdapter interface so
 * it can be added without changing callers.
 * ==========================================================
 */

import ProactiveCore from "./ProactiveCore";
import ProjectStore from "../projects/ProjectStore";
import AgentStore from "../agents/AgentStore";
import NotificationProvider from "../notifications/NotificationProvider";
import MultiChatStore from "../multichat/MultiChatStore";
import KvStore from "../storage/KvStore";

const KEY = "proactive.runtime.checkpoint.v1";
const TICK_MS = 30_000;

/** Platform adapter — replace/extend for native or remote execution. */
export interface RuntimeAdapter {
  start(loop: () => void): void;
  stop(): void;
}

/** Web adapter: foreground interval + visibility-change catch-up. */
export class ForegroundRuntimeAdapter implements RuntimeAdapter {
  private timer: number | null = null;
  private loop: (() => void) | null = null;

  public start(loop: () => void): void {
    if (this.timer !== null) {
      return;
    }
    this.loop = loop;
    loop();
    this.timer = window.setInterval(() => loop(), TICK_MS);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  public stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.loop = null;
  }

  private handleVisibility = (): void => {
    if (document.visibilityState === "visible") {
      this.loop?.();
    }
  };
}

export default class PersistentRuntime {
  private static instance: PersistentRuntime | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly adapter: RuntimeAdapter = new ForegroundRuntimeAdapter();

  private constructor() {}

  public static getInstance(): PersistentRuntime {
    if (!PersistentRuntime.instance) {
      PersistentRuntime.instance = new PersistentRuntime();
    }
    return PersistentRuntime.instance;
  }

  public start(): void {
    this.adapter.start(() => this.tick());
  }

  public stop(): void {
    this.adapter.stop();
  }

  /* ------------------------------ evaluate ------------------------------ */

  private tick(): void {
    // No background execution on the web: hidden tab => nothing runs.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    const proactive = ProactiveCore.getInstance();
    const settings = proactive.getSettings();

    const now = Date.now();
    const checkpoint = this.kv.get<{ lastCheck: number }>(KEY)?.lastCheck ?? now;

    // Respect controls: OFF or Quiet means do not initiate.
    if (!settings.enabled || settings.notificationLevel === "quiet") {
      this.checkpoint(now);
      return;
    }

    try {
      if (settings.projectUpdates) {
        this.evaluateProjectChanges(checkpoint);
      }
      if (settings.suggestions || settings.routineLearning) {
        this.evaluateAgentCompletions(checkpoint);
      }
      if (settings.routineLearning && settings.notificationLevel !== "normal") {
        this.evaluateRoutines();
      }
    } catch (error) {
      console.error("[Lélu PersistentRuntime] evaluation failed (contained)", error);
    } finally {
      this.checkpoint(now);
    }
  }

  private evaluateProjectChanges(checkpoint: number): void {
    const projects = ProjectStore.getInstance().list();
    for (const project of projects) {
      if (project.status !== "active") {
        continue;
      }
      if (project.updatedAt <= checkpoint) {
        continue;
      }
      const proactive = ProactiveCore.getInstance();
      const provider = NotificationProvider.getInstance();
      const conversationId = this.conversationForProject(project.id);

      const record = provider.notify({
        title: `Project update: ${project.name}`,
        body: `${project.description || "An active project"} was updated.`,
        conversationId,
        tag: `project:${project.id}`,
        priority: 3,
        system: true,
      });

      if (record) {
        proactive.logEvent({
          trigger: "project_change",
          source: `project:${project.name}`,
          priority: 3,
          confidence: 0.9,
          presented: record.title,
        });
      }
    }
  }

  private evaluateAgentCompletions(checkpoint: number): void {
    const agents = AgentStore.getInstance().list();
    const proactive = ProactiveCore.getInstance();
    const provider = NotificationProvider.getInstance();

    for (const agent of agents) {
      for (const execution of agent.executions) {
        if (execution.createdAt <= checkpoint) {
          continue;
        }
        const conversationId = this.conversationForProject(agent.projectId ?? undefined);
        const record = provider.notify({
          title: `${agent.name} finished`,
          body: execution.result.slice(0, 160) || "A task completed.",
          conversationId,
          tag: `agent:${agent.id}:${execution.id}`,
          priority: 4,
          system: true,
        });

        if (record) {
          proactive.logEvent({
            trigger: "agent_completion",
            source: `agent:${agent.name}`,
            priority: 4,
            confidence: 0.85,
            presented: record.title,
          });
        }
      }
    }
  }

  private evaluateRoutines(): void {
    const proactive = ProactiveCore.getInstance();
    const provider = NotificationProvider.getInstance();
    for (const routine of proactive.timeSensitiveRoutines()) {
      const record = provider.notify({
        title: `Routine: ${routine.key}`,
        body: "You usually work on this around this time.",
        tag: `routine:${routine.key}`,
        priority: 2,
        system: false,
      });
      if (record) {
        proactive.logEvent({
          trigger: "routine",
          source: `routine:${routine.key}`,
          priority: 2,
          confidence: routine.confidence,
          presented: record.title,
        });
      }
    }
  }

  /** Route a proactive event to a conversation linked to a project. */
  private conversationForProject(projectId?: string): string | undefined {
    if (!projectId) {
      return undefined;
    }
    const store = MultiChatStore.getInstance();
    const conversation = store.list().find((item) => item.projectId === projectId);
    return conversation?.id;
  }

  private checkpoint(ts: number): void {
    this.kv.set(KEY, { lastCheck: ts });
  }
}
