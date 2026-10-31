/**
 * ==========================================================
 * LÉLU — AGENCY TOOLS
 *
 * The tools that let the model (in chat, in an agent, in a
 * workflow) act as an orchestrator rather than a single turn:
 *
 *   capability.discover  what can be done now, and how well
 *   agent.list           who can be delegated to
 *   agent.delegate       hand a sub-task to a specialist agent
 *   task.start           run a multi-step plan (validated,
 *                        checkpointed, approval-gated)
 *   task.status          a task's real state, step by step
 *   task.cancel / task.resume
 *   approval.list        decisions waiting on the human
 *   reflection.run       evaluate recent work now
 *
 * There is deliberately NO tool that approves anything. An
 * approval is a human decision; a model that could grant its own
 * would make the gate decorative.
 *
 * Executors import their subsystems lazily: the dispatcher imports
 * this module, and those subsystems import the dispatcher.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult, ToolExecutor } from "../tools/ToolDispatcher";
import type { PlanStepInput } from "./TaskPlanner";

const definition = (
  id: string,
  name: string,
  description: string,
  riskLevel: 0 | 1,
  inputSchema?: Record<string, unknown>,
): ToolDefinition => ({
  id,
  name,
  description,
  category: "Agency",
  permissions: riskLevel === 0 ? ["READ"] : ["WRITE"],
  riskLevel,
  available: true,
  ...(inputSchema ? { inputSchema } : {}),
});

export const AGENTIC_TOOLS: ToolDefinition[] = [
  definition("capability.discover", "Discover Capabilities", "List the tools and agents LÉLU can use right now, whether each is ready, needs approval or is blocked (and why), and how each has performed", 0),
  definition("agent.list", "List Agents", "The specialist agents work can be delegated to, with their roles", 0),
  definition("agent.delegate", "Delegate to Agent", "Give one sub-task to a specialist agent and get its answer back", 1),
  definition("task.start", "Run Multi-Step Task", "Execute a plan of tool / agent / reasoning steps with dependencies, retries and verification; sensitive steps wait for the user's approval", 1),
  definition("task.status", "Task Status", "The verified, step-by-step state of a multi-step task", 0),
  definition("task.cancel", "Cancel Task", "Stop a running or waiting task", 1),
  definition("task.resume", "Resume Task", "Continue a paused or interrupted task from its last completed step", 1),
  definition("approval.list", "Pending Approvals", "Actions waiting for the user's decision", 0),
  definition("reflection.run", "Reflect Now", "Evaluate recent tasks and tool failures, record lessons, and propose improvements", 1),
];

export function registerAgenticTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of AGENTIC_TOOLS) registry.register(tool);
}

const str = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === "string" ? (args[key] as string).trim() : "";

/** How long task.start waits inline before handing back a running task. */
const INLINE_WAIT_MS = 90_000;

const STEP_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Short id, e.g. s1. Later steps reference it." },
    title: { type: "string" },
    tool: { type: "string", description: "Tool id (exactly one of tool / agent / prompt)." },
    args: { type: "object", description: "Arguments for the tool." },
    agent: { type: "string", description: "Agent name to delegate to." },
    instruction: { type: "string", description: "What the agent should do." },
    prompt: { type: "string", description: "A reasoning instruction for a model." },
    dependsOn: { type: "array", items: { type: "string" }, description: "Earlier step ids; default is the previous step." },
    verify: {
      type: "object",
      properties: {
        operator: { type: "string", enum: ["not-empty", "contains", "not-contains", "equals"] },
        value: { type: "string" },
      },
      required: ["operator"],
    },
  },
  required: ["title"],
};

export const AGENTIC_EXECUTORS: ToolExecutor[] = [
  {
    id: "capability.discover",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match against ids, names and descriptions." },
        kind: { type: "string", enum: ["tool", "agent"] },
        usableOnly: { type: "boolean", description: "Only capabilities that can be used now (default true)." },
      },
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const catalog = await import("./CapabilityCatalog");
      let found = args.usableOnly === false ? catalog.listCapabilities() : catalog.usableCapabilities();
      const kind = str(args, "kind");
      if (kind === "tool" || kind === "agent") found = found.filter((c) => c.kind === kind);
      const query = str(args, "query");
      if (query) found = catalog.findCapabilities(query, found);
      return {
        ok: true,
        content: `${found.length} capabilit${found.length === 1 ? "y" : "ies"}:\n${catalog.describeCapabilities(found.slice(0, 60))}`,
        data: found.map(({ parameters: _parameters, ...rest }) => rest),
      };
    },
  },
  {
    id: "agent.list",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { default: AgentStore } = await import("../agents/AgentStore");
      const agents = AgentStore.getInstance().runnable();
      if (agents.length === 0) return { ok: true, content: "No agents are enabled.", data: [] };
      return {
        ok: true,
        content: agents.map((a) => `- ${a.name} (${a.role || "specialist"}): ${a.description}`).join("\n"),
        data: agents.map((a) => ({ id: a.id, name: a.name, role: a.role })),
      };
    },
  },
  {
    id: "agent.delegate",
    parameters: {
      type: "object",
      properties: {
        agent: { type: "string", description: "The agent's name (see agent.list)." },
        task: { type: "string", description: "The sub-task, stated completely — the agent does not see this conversation." },
      },
      required: ["agent", "task"],
    },
    run: async (args) => {
      const agent = str(args, "agent");
      const task = str(args, "task");
      if (!agent || !task) return { ok: false, content: "agent.delegate needs both an agent and a task." };
      const { delegateToAgent } = await import("./TaskExecutor");
      const result = await delegateToAgent(agent, task, `delegate-${Date.now()}`);
      return { ok: result.ok, content: result.ok ? `${agent} answered:\n${result.content}` : result.content };
    },
  },
  {
    id: "task.start",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What the whole task achieves." },
        steps: { type: "array", items: STEP_SCHEMA, description: "The plan, in order. At most 12 steps." },
        wait: { type: "boolean", description: "Wait for the result (default true). Long tasks keep running in the background either way." },
      },
      required: ["goal", "steps"],
    },
    run: async (args) => {
      const goal = str(args, "goal");
      if (!goal) return { ok: false, content: "task.start needs a goal." };
      const [{ validatePlan, createTask }, { default: TaskExecutor }] = await Promise.all([
        import("./TaskPlanner"),
        import("./TaskExecutor"),
      ]);
      const validation = validatePlan((args.steps as PlanStepInput[]) ?? []);
      if (!validation.ok) {
        return { ok: false, content: `The plan was not started — fix these and try again:\n- ${validation.errors.join("\n- ")}` };
      }
      const task = createTask(goal, validation, "model");
      const executor = TaskExecutor.getInstance();
      const run = executor.run(task.id);
      if (args.wait === false) {
        return { ok: true, content: `Task ${task.id} started (${validation.steps.length} steps). Check it with task.status.`, data: { taskId: task.id } };
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finished = await Promise.race([
        run,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), INLINE_WAIT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      const current = finished ?? task;
      const report = executor.report(current);
      const ok = current.status === "completed" || current.status === "waiting" || current.status === "running";
      const suffix =
        current.status === "waiting"
          ? "\nThe task is paused until the user approves or rejects the pending action; it continues by itself after they decide."
          : current.status === "running"
            ? "\nStill running in the background; check with task.status."
            : "";
      return { ok, content: `Task ${task.id}\n${report}${suffix}`, data: { taskId: task.id, status: current.status } };
    },
  },
  {
    id: "task.status",
    parameters: {
      type: "object",
      properties: { taskId: { type: "string", description: "Omit for the most recent task." } },
    },
    run: async (args) => {
      const [{ default: TaskEngine }, { default: TaskExecutor }] = await Promise.all([
        import("../tasks/TaskEngine"),
        import("./TaskExecutor"),
      ]);
      const wanted = str(args, "taskId");
      const tasks = TaskEngine.getInstance().list().filter((t) => t.steps.some((s) => s.action));
      const task = wanted ? TaskEngine.getInstance().get(wanted) : tasks[0];
      if (!task) return { ok: false, content: wanted ? `No task ${wanted}.` : "No multi-step task has run yet." };
      return { ok: true, content: `Task ${task.id} [${task.status}]\n${TaskExecutor.getInstance().report(task)}`, data: { status: task.status } };
    },
  },
  {
    id: "task.cancel",
    parameters: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
    run: async (args) => {
      const { default: TaskExecutor } = await import("./TaskExecutor");
      const task = TaskExecutor.getInstance().cancel(str(args, "taskId"), "cancelled on request");
      return task ? { ok: true, content: `Cancelling task ${task.id} (${task.goal}).` } : { ok: false, content: "No such task." };
    },
  },
  {
    id: "task.resume",
    parameters: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
    run: async (args) => {
      const { default: TaskExecutor } = await import("./TaskExecutor");
      const executor = TaskExecutor.getInstance();
      const task = await executor.resume(str(args, "taskId"));
      return task ? { ok: true, content: executor.report(task), data: { status: task.status } } : { ok: false, content: "No such task." };
    },
  },
  {
    id: "approval.list",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { default: ApprovalGate } = await import("./ApprovalGate");
      const pending = ApprovalGate.getInstance().pending();
      if (pending.length === 0) return { ok: true, content: "Nothing is waiting for approval.", data: [] };
      return {
        ok: true,
        content:
          "Waiting for the user's decision (only the user can approve):\n" +
          pending.map((p) => `- ${p.title} — ${p.tool} (task ${p.taskId})`).join("\n"),
        data: pending.map((p) => ({ id: p.id, tool: p.tool, taskId: p.taskId })),
      };
    },
  },
  {
    id: "reflection.run",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { default: DailyReflection } = await import("./DailyReflection");
      const result = await DailyReflection.getInstance().run("on-request");
      return { ok: true, content: result.summary, data: result };
    },
  },
];
