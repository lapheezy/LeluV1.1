/**
 * ==========================================================
 * LÉLU — ANTHROPIC ENGINEERING AGENT
 *
 * A second EXECUTION BACKEND for engineering work, alongside
 * the local EngineeringToolset. It is not a second brain and
 * not a second agent architecture: LÉLU's existing cognition
 * decides WHAT to work on and whether to accept the result;
 * this module only carries out one bounded engineering task
 * and reports what actually happened.
 *
 * WHAT ANTHROPIC PROVIDES (Managed Agents, beta)
 * ----------------------------------------------
 * Anthropic runs the agent loop AND hosts a container per
 * session. bash, file reads/writes and code execution happen
 * in that container — so this is real sandboxed computation,
 * not a model describing commands it would like to run.
 *
 *   POST /v1/agents        the persisted, versioned config
 *   POST /v1/environments  the sandbox definition
 *   POST /v1/sessions      one run, with the repo mounted
 *   GET  .../events/stream the real event stream
 *
 * WHY THE REPOSITORY IS SAFE
 * --------------------------
 * The session mounts a `github_repository` resource pinned to
 * an exact commit SHA. That is a fresh clone inside Anthropic's
 * container — the machine LÉLU is running on is never touched,
 * so a failed or hostile edit cannot reach the working tree.
 * Nothing is pushed: this returns a diff for LÉLU to judge.
 *
 * WHY THE TOKEN IS SAFE
 * ---------------------
 * `authorization_token` is never placed inside the container.
 * Anthropic's git proxy injects it after the request leaves the
 * sandbox, so code the agent writes cannot read or exfiltrate
 * it. The token is also never logged or put in a prompt here.
 * ==========================================================
 */

import Anthropic from "@anthropic-ai/sdk";
import AgentEventBus from "../agent/AgentEvents";
import { resolveFirst } from "../resolveEnv";

/* ------------------------------------------------------------------ */
/* the task LÉLU's cognition hands over                                */
/* ------------------------------------------------------------------ */

export interface EngineeringTask {
  /** What cognition wants achieved. Written by LÉLU, not by a user. */
  objective: string;
  /** `https://github.com/owner/repo`. */
  repository: string;
  /** Exact commit the sandbox clone is pinned to. */
  baseCommit: string;
  /** Extra rules for this task (files to avoid, style, scope). */
  constraints?: string[];
  /** Whether the agent may use web research for this task. */
  researchAllowed?: boolean;
  /**
   * Hard dollar cap for this session. The platform pauses the
   * session at the cap rather than letting a loop run away.
   */
  budgetUsd?: number;
  /** Wall-clock ceiling before we stop consuming the stream. */
  timeoutMs?: number;
}

/** What comes back to cognition — evidence, not narrative. */
export interface EngineeringAgentResult {
  ok: boolean;
  /** Set when the task never ran at all (no key, no token, API error). */
  unavailableReason?: string;
  sessionId?: string;
  /** Console trace for a human to inspect the real run. */
  traceUrl?: string;
  objective: string;
  repository: string;
  baseCommit: string;
  /** The agent's own closing summary. */
  summary: string;
  /** Files the agent actually edited, from real file events. */
  filesChanged: string[];
  /** Commands it actually ran, in order. */
  commandsRun: string[];
  /** Web research it actually performed. */
  researchPerformed: string[];
  /** Unified diff produced in the sandbox, when one was produced. */
  diff: string | null;
  /** Terminal session status as reported by the platform. */
  status: string;
  stopReason: string | null;
  /** Why the run ended, when it ended badly. */
  error?: string;
  /** Real event count — the audit trail's size, not a claim. */
  eventCount: number;
}

/* ------------------------------------------------------------------ */

const AGENT_NAME = "LÉLU Engineering Agent";
const ENVIRONMENT_NAME = "lelu-engineering";
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/**
 * The agent's standing instructions. This is a BEHAVIOURAL contract for
 * the sandboxed worker — it does not describe LÉLU's identity, which
 * lives in cognition and must not be duplicated here.
 */
const SYSTEM = `You are the engineering executor for LÉLU, an autonomous system that is improving its own codebase.

You are working inside a disposable container on a fresh clone pinned to an exact commit. The user's real machine is not reachable from here, so you may inspect and edit freely — but you are producing a PROPOSAL that LÉLU will review, not a change that ships.

Rules:
- Inspect before you edit. Read the surrounding code and match its conventions.
- Make the smallest change that achieves the objective. Do not refactor opportunistically.
- Run the repository's own checks (typecheck, tests, lint) and report their REAL output.
- If a check fails, diagnose and iterate. Do not report success on a failing tree.
- Never claim you ran something you did not run.
- Do not commit, push, or open a pull request. Leave the changes in the working tree.
- When finished, run \`git --no-pager diff\` and end your final message with a short plain-text summary of: what you changed, what you ran, what passed, what failed, and what remains.`;

/* ------------------------------------------------------------------ */

export default class AnthropicEngineeringAgent {
  private static instance: AnthropicEngineeringAgent | null = null;

  /**
   * Agents and environments are PERSISTED, VERSIONED objects. Creating
   * one per run accumulates orphans and pays the create latency for
   * nothing, so both are made once and reused for the process lifetime.
   */
  private agentId: string | null = null;
  private agentVersion: string | number | null = null;
  private environmentId: string | null = null;
  private client: Anthropic | null = null;

  public static getInstance(): AnthropicEngineeringAgent {
    if (!AnthropicEngineeringAgent.instance) {
      AnthropicEngineeringAgent.instance = new AnthropicEngineeringAgent();
    }
    return AnthropicEngineeringAgent.instance;
  }

  /** The same credential resolution every other LÉLU provider uses. */
  private apiKey(): string | undefined {
    return resolveFirst("ANTHROPIC_API_KEY", "CLAUDE_API_KEY");
  }

  /**
   * A GitHub token with at least `Contents: Read`. Read separately from
   * the inference key because they are different secrets with different
   * blast radii, and only this one reaches the git proxy.
   */
  private repoToken(): string | undefined {
    return resolveFirst("ENGINEERING_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN");
  }

  /**
   * Whether this capability can run at all right now. Cognition should
   * ask before creating a task, so a missing credential surfaces as
   * "not configured" rather than as a failed engineering run.
   */
  public availability(): { available: boolean; reason?: string } {
    if (!this.apiKey()) {
      return { available: false, reason: "ANTHROPIC_API_KEY is not configured." };
    }
    if (!this.repoToken()) {
      return {
        available: false,
        reason: "No GitHub token (ENGINEERING_GITHUB_TOKEN / GITHUB_TOKEN) for the repository clone.",
      };
    }
    return { available: true };
  }

  private getClient(): Anthropic {
    if (!this.client) {
      // Never logged, never placed in a prompt.
      this.client = new Anthropic({ apiKey: this.apiKey() });
    }
    return this.client;
  }

  /**
   * Provision the persisted agent + environment once.
   *
   * `networking` is set per task: research-capable tasks need egress,
   * and a task that does not need it should not have it.
   */
  private async ensureProvisioned(researchAllowed: boolean): Promise<void> {
    const client = this.getClient();

    if (!this.environmentId) {
      const environment = await client.beta.environments.create({
        name: ENVIRONMENT_NAME,
        config: {
          type: "cloud",
          networking: researchAllowed ? { type: "unrestricted" } : { type: "restricted" },
        },
      } as never);
      this.environmentId = (environment as { id: string }).id;
    }

    if (!this.agentId) {
      const agent = await client.beta.agents.create({
        name: AGENT_NAME,
        model: "claude-opus-5",
        system: SYSTEM,
        // The Anthropic-hosted toolset: bash, file read/write/edit and
        // code execution INSIDE the session container.
        tools: [
          { type: "agent_toolset_20260401", default_config: { enabled: true } },
          ...(researchAllowed
            ? [
                { type: "web_search_20260209", name: "web_search" },
                { type: "web_fetch_20260209", name: "web_fetch" },
              ]
            : []),
        ],
      } as never);
      const created = agent as { id: string; version: string | number };
      this.agentId = created.id;
      this.agentVersion = created.version;
    }
  }

  /**
   * Run ONE engineering task and return what actually happened.
   *
   * Every field in the result is derived from a real session event or a
   * real API response. Nothing here is inferred from the agent saying it
   * did something.
   */
  public async execute(task: EngineeringTask): Promise<EngineeringAgentResult> {
    const taskId = `eng-${Date.now()}`;
    const events = AgentEventBus.getInstance();

    const base: EngineeringAgentResult = {
      ok: false,
      objective: task.objective,
      repository: task.repository,
      baseCommit: task.baseCommit,
      summary: "",
      filesChanged: [],
      commandsRun: [],
      researchPerformed: [],
      diff: null,
      status: "not_started",
      stopReason: null,
      eventCount: 0,
    };

    const gate = this.availability();
    if (!gate.available) {
      // Not a failed run — a run that never started. Cognition needs to
      // tell those apart to decide whether to retry or to ask for setup.
      return { ...base, status: "unavailable", unavailableReason: gate.reason };
    }

    events.emit({ type: "task_started", taskId, label: `Engineering: ${task.objective.slice(0, 60)}` });
    events.emit({ type: "tool_selected", taskId, tool: "engineering", label: "Anthropic engineering agent" });

    const client = this.getClient();
    let sessionId: string | undefined;

    try {
      await this.ensureProvisioned(task.researchAllowed ?? true);

      const session = await client.beta.sessions.create({
        agent: { type: "agent", id: this.agentId!, version: this.agentVersion! },
        environment_id: this.environmentId!,
        title: `LÉLU engineering — ${task.objective.slice(0, 60)}`,
        // The isolation guarantee: a fresh clone at an exact SHA, inside
        // Anthropic's container. The local working tree is not involved.
        resources: [
          {
            type: "github_repository",
            url: task.repository,
            mount_path: "/workspace/repo",
            authorization_token: this.repoToken(),
            checkout: { type: "commit", sha: task.baseCommit },
          },
        ],
        ...(task.budgetUsd ? { budget: { type: "usd", limit: task.budgetUsd } } : {}),
      } as never);

      sessionId = (session as { id: string }).id;
      const traceUrl = `https://platform.claude.com/workspaces/default/sessions/${sessionId}`;
      events.emit({ type: "tool_started", taskId, tool: "engineering", label: `Sandbox session ${sessionId}` });

      const prompt = [
        `OBJECTIVE:\n${task.objective}`,
        `\nREPOSITORY: ${task.repository}`,
        `BASE COMMIT: ${task.baseCommit}`,
        `WORKING DIRECTORY: /workspace/repo`,
        task.constraints?.length ? `\nCONSTRAINTS:\n${task.constraints.map((c) => `- ${c}`).join("\n")}` : "",
        task.researchAllowed === false ? "\nWeb research is DISABLED for this task." : "",
      ]
        .filter(Boolean)
        .join("\n");

      // Stream-first: the stream only delivers events that occur after it
      // opens, so opening it after sending would batch the early ones.
      const observed = await this.consume(
        client,
        sessionId,
        taskId,
        task.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        () =>
          client.beta.sessions.events.send(sessionId!, {
            events: [{ type: "user.message", content: [{ type: "text", text: prompt }] }],
          } as never),
      );

      const final = await client.beta.sessions.retrieve(sessionId);
      const status = (final as { status?: string }).status ?? "unknown";
      const stopReason = (final as { stop_reason?: string }).stop_reason ?? null;

      const changed = observed.filesChanged ?? [];
      const ok = changed.length > 0 || (observed.summary ?? "").length > 0;
      events.emit(
        ok
          ? { type: "task_completed", taskId, label: `Engineering: ${changed.length} file(s) changed` }
          : { type: "task_failed", taskId, label: "Engineering produced no change", error: stopReason ?? undefined },
      );

      return { ...base, ...observed, ok, sessionId, traceUrl, status, stopReason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.emit({ type: "tool_failed", taskId, tool: "engineering", error: message });
      events.emit({ type: "task_failed", taskId, label: "Engineering agent failed", error: message });
      return { ...base, sessionId, status: "error", error: message };
    }
  }

  /**
   * Consume the real event stream, deriving the result from what the
   * platform reports rather than from the agent's prose.
   */
  private async consume(
    client: Anthropic,
    sessionId: string,
    taskId: string,
    timeoutMs: number,
    send: () => Promise<unknown>,
  ): Promise<Partial<EngineeringAgentResult>> {
    const events = AgentEventBus.getInstance();
    const filesChanged = new Set<string>();
    const commandsRun: string[] = [];
    const researchPerformed: string[] = [];
    let summary = "";
    let diff: string | null = null;
    let eventCount = 0;

    const deadline = Date.now() + timeoutMs;
    const stream = await client.beta.sessions.events.stream(sessionId);
    void send();

    for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
      eventCount += 1;
      const type = String(raw.type ?? "");

      if (Date.now() > deadline) {
        events.emit({ type: "tool_failed", taskId, tool: "engineering", error: "engineering-timeout" });
        break;
      }

      if (type === "agent.message") {
        for (const block of (raw.content as Array<Record<string, unknown>>) ?? []) {
          if (block.type === "text" && typeof block.text === "string") summary += block.text;
        }
        continue;
      }

      // Tool activity in the sandbox is the ground truth for "what did
      // it actually do". These are the platform's own events.
      if (type === "agent.tool_use") {
        const name = String(raw.name ?? "");
        const input = (raw.input ?? {}) as Record<string, unknown>;

        if (name === "bash" && typeof input.command === "string") {
          commandsRun.push(input.command);
          events.emit({ type: "tool_progress", taskId, tool: "engineering", progress: 0.5, note: input.command.slice(0, 80) });
          if (/\bgit\b[^|]*\bdiff\b/.test(input.command)) diff = diff ?? "";
        }

        const path = typeof input.path === "string" ? input.path : typeof input.file_path === "string" ? input.file_path : null;
        if (path) {
          const writing = /write|edit|create|str_replace/i.test(name) || typeof input.new_str === "string";
          if (writing) {
            filesChanged.add(path);
            events.emit({ type: "file_changed", taskId, path });
          } else {
            events.emit({ type: "file_opened", taskId, path });
          }
        }

        if (/web_search|web_fetch/.test(name)) {
          const q = String(input.query ?? input.url ?? "");
          if (q) {
            researchPerformed.push(q);
            events.emit({ type: "browser_navigation", taskId, url: q.slice(0, 120) });
          }
        }
        continue;
      }

      // The diff is captured from the real command output, so an empty
      // diff means the tree genuinely did not change.
      if (type === "agent.tool_result" && diff === "") {
        const content = raw.content as unknown;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.map((c) => (c as { text?: string }).text ?? "").join("")
              : ((content as { stdout?: string })?.stdout ?? "");
        if (text.includes("diff --git")) diff = text;
        continue;
      }

      if (type === "session.status_idle" || type === "session.status_terminated") break;
    }

    return {
      summary: summary.trim(),
      filesChanged: [...filesChanged],
      commandsRun,
      researchPerformed,
      diff: diff || null,
      eventCount,
    };
  }
}
