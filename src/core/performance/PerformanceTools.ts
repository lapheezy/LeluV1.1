/**
 * performance.mode: LÉLU sets lightweight / full weight / auto, or reports what the device is doing.
 */
import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import { describePerformance, getPerformance, setPerformanceMode, type PerformanceModeId } from "./PerformanceMode";

export const PERFORMANCE_TOOLS: ToolDefinition[] = [
  {
    id: "performance.mode",
    name: "Lightweight / full weight",
    description: 'Set how heavy you render: "light" (lightweight: light sky, no heavy blur or ambient motion), "full" (full weight at the device\'s own ceiling; refused on software GL) or "auto" (you adjust to the device: GPU, CPU, memory, screen, measured frame rate). Without `mode`, reports the current state.',
    category: "Performance",
    permissions: ["WRITE"],
    riskLevel: 0,
    available: true,
    executionRoute: "PerformanceTools.performance.mode",
  },
];

export const PERFORMANCE_EXECUTORS: Array<{ id: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<ToolExecutionResult> }> = [
  {
    id: "performance.mode",
    parameters: { type: "object", properties: { mode: { type: "string", enum: ["auto", "light", "full"] }, reason: { type: "string" } }, required: [] },
    run: async (args) => {
      const mode = String(args.mode ?? "");
      if (!["auto", "light", "full"].includes(mode)) return { ok: true, content: describePerformance(), data: getPerformance() };
      setPerformanceMode(mode as PerformanceModeId, "lelu", String(args.reason ?? "asked in the chat"));
      // Let the app apply it and publish what the renderer did.
      await new Promise((r) => setTimeout(r, 600));
      const s = getPerformance();
      return { ok: !(mode === "full" && s.effective?.refused), content: describePerformance(s), data: s };
    },
  },
];

export function registerPerformanceTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of PERFORMANCE_TOOLS) registry.register(tool);
}
