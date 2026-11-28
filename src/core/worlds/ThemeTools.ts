/**
 * theme.set: LÉLU switches the Cosmos and every chat variant to a theme family, or back to the primary
 * Cosmos (see cosmosTheme.ts). Without a theme, reports the current one and the choices.
 */
import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import { currentTheme, PRIMARY, setTheme, themeIn, themes } from "./cosmosTheme";

export const THEME_TOOLS: ToolDefinition[] = [
  {
    id: "theme.set",
    name: "Theme of the Cosmos and chats",
    description: `Switch the Cosmos and every chat variant to a theme, or back to the primary Cosmos ("${PRIMARY}"). Themes: ${themes().map((t) => t.id).join(", ")}. Without \`theme\`, reports the current one.`,
    category: "Worlds",
    permissions: ["WRITE"],
    riskLevel: 0,
    available: true,
    executionRoute: "ThemeTools.theme.set",
  },
];

export const THEME_EXECUTORS: Array<{ id: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<ToolExecutionResult> }> = [
  {
    id: "theme.set",
    parameters: { type: "object", properties: { theme: { type: "string" } }, required: [] },
    run: async (args) => {
      const asked = String(args.theme ?? args.family ?? "");
      const id = asked ? (themes().some((t) => t.id === asked) ? asked : themeIn(asked)) : null;
      if (!asked) return { ok: true, content: `Theme now: ${themes().find((t) => t.id === currentTheme())?.label}. Choices: ${themes().map((t) => t.label).join(", ")}.` };
      if (!id) return { ok: false, content: `There is no theme called "${asked}". Choices: ${themes().map((t) => t.label).join(", ")}.` };
      const r = setTheme(id);
      return { ok: r.ok, content: r.theme === PRIMARY ? "Back to the primary Cosmos. Every chat variant follows." : `The Cosmos and every chat variant are now in the ${r.label} theme. "Back to the primary Cosmos" returns.`, data: r };
    },
  },
];

export function registerThemeTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of THEME_TOOLS) registry.register(tool);
}
