/** workspace.format: LÉLU arranges her sign-in workspace in a format (one of the layout kinds). */
import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import { FORMATS, formatIn, setWorkspaceFormat, workspaceFormat } from "./briefing";

export const WORKSPACE_FORMAT_TOOLS: ToolDefinition[] = [
  {
    id: "workspace.format",
    name: "Arrange my workspace",
    description: `Arrange your workspace (recent updates, previous work, self development, future work & tasks) in a format: ${FORMATS.map((f) => f.name).join(", ")}. Without \`format\`, reports the current one.`,
    category: "Workspace",
    permissions: ["WRITE"],
    riskLevel: 0,
    available: true,
    executionRoute: "WorkspaceFormatTools.workspace.format",
  },
];

export const WORKSPACE_FORMAT_EXECUTORS: Array<{ id: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<ToolExecutionResult> }> = [
  {
    id: "workspace.format",
    parameters: { type: "object", properties: { format: { type: "string" }, reason: { type: "string" } }, required: [] },
    run: async (args) => {
      const asked = String(args.format ?? "");
      const name = (id: string) => FORMATS.find((f) => f.id === id)?.name ?? id;
      if (!asked) return { ok: true, content: `Workspace format: ${name(workspaceFormat().id)}. Formats: ${FORMATS.map((f) => f.name).join(", ")}.` };
      const id = FORMATS.some((f) => f.id === asked) ? asked : formatIn(asked);
      if (!id || !setWorkspaceFormat(id, "lelu", String(args.reason ?? "asked in the chat"))) return { ok: false, content: `There is no format called "${asked}". Formats: ${FORMATS.map((f) => f.name).join(", ")}.` };
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lelu-workspace-open"));
      return { ok: true, content: `Your workspace is now arranged as ${name(id)}. Scroll down from the Cosmos (or "Your workspace ↓") to see it.` };
    },
  },
];

export function registerWorkspaceFormatTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of WORKSPACE_FORMAT_TOOLS) registry.register(tool);
}
