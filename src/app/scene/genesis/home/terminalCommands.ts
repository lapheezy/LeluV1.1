/**
 * ==========================================================
 * LÉLU HOME — RETRO TERMINAL COMMAND LINE
 *
 * Parses what she types at the terminal prompt and runs it through
 * the systems that already own each action — CosmosNavigation,
 * CosmosFocus, CosmosObjectStore, the scale flight, GenesisCore's
 * panels, her conversation — handed in as a context so this file
 * stays pure and testable. Nothing here invents state: every reply
 * line is read back from the context after the action.
 *
 * Anything that is not a command goes to LÉLU's conversation
 * (the same "lelu-open-universe" draft the Ask module sends).
 * ==========================================================
 */

export type ScaleName = "planet" | "solar" | "stellar" | "galactic";
export const SCALES: ScaleName[] = ["planet", "solar", "stellar", "galactic"];

export interface TerminalNode {
  id: string;
  label: string;
  level: string;
  parentId: string | null;
}

export interface TerminalObject {
  id: string;
  name: string;
}

/** The real systems, as the command line needs them. */
export interface TerminalContext {
  nodes(): TerminalNode[];
  currentNodeId(): string;
  navigateTo(id: string): boolean;
  back(): boolean;
  objects(): TerminalObject[];
  focus(target: { kind: "node" | "object"; id: string } | null): void;
  focused(): { kind: "node" | "object"; id: string } | null;
  flyScale(scale: ScaleName): void;
  scale(): string;
  camera(): { x: number; y: number; z: number };
  sector(): { x: number; y: number; z: number };
  world(): { phase: string; progress: number; cycle: number };
  panels(): Array<{ id: string; label: string }>;
  openPanel(id: string): void;
  immersive(): void;
  openStudio(): void;
  arrange(): void;
  themes(): Array<{ id: string; name: string }>;
  selectTheme(id: string): boolean;
  hasUnsavedTheme(): boolean;
  ask(text: string): void;
}

export interface CommandResult {
  /** Lines to print, each with a tone the theme colours. */
  lines: Array<{ text: string; tone: "out" | "ok" | "warn" | "error" | "head" }>;
  /** The log should be emptied first ("clear"). */
  clear?: boolean;
}

export const COMMANDS: Array<{ name: string; usage: string; help: string }> = [
  { name: "help", usage: "help", help: "List the commands." },
  { name: "where", usage: "where", help: "Coordinates, sector, region, scale and world phase." },
  { name: "ls", usage: "ls", help: "Destinations inside the current region." },
  { name: "goto", usage: "goto <name>", help: "Navigate to a destination (galaxy, planet, room)." },
  { name: "back", usage: "back", help: "Return to the previous destination." },
  { name: "select", usage: "select <name>", help: "Select a destination or a spatial object." },
  { name: "deselect", usage: "deselect", help: "Clear the selection." },
  { name: "scale", usage: "scale <planet|solar|stellar|galactic>", help: "Fly the camera to a scale." },
  { name: "open", usage: "open <app>", help: "Open an app (chat, browser, studio, settings…)." },
  { name: "look", usage: "look", help: "Hide the terminal and look at the Cosmos." },
  { name: "theme", usage: "theme [name]", help: "List themes, or switch to one." },
  { name: "appearance", usage: "appearance", help: "Open the Terminal Appearance Studio." },
  { name: "layout", usage: "layout", help: "Arrange the Home / switch to another layout." },
  { name: "ask", usage: "ask <text>", help: "Send text to LÉLU's conversation." },
  { name: "clear", usage: "clear", help: "Clear this log." },
];

export function parseCommand(input: string): { cmd: string; arg: string } {
  const text = input.trim();
  const space = text.search(/\s/);
  if (space < 0) return { cmd: text.toLowerCase(), arg: "" };
  return { cmd: text.slice(0, space).toLowerCase(), arg: text.slice(space + 1).trim() };
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(2));

/** Best match by id, exact label, then label prefix, then label substring (case-insensitive). */
export function findByName<T>(items: T[], query: string, id: (t: T) => string, label: (t: T) => string): T | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    items.find((t) => id(t).toLowerCase() === q) ??
    items.find((t) => label(t).toLowerCase() === q) ??
    items.find((t) => label(t).toLowerCase().startsWith(q)) ??
    items.find((t) => label(t).toLowerCase().includes(q))
  );
}

/** Commands that complete for a prefix (Tab). */
export function completeCommand(prefix: string): string[] {
  const p = prefix.trim().toLowerCase();
  return COMMANDS.map((c) => c.name).filter((n) => n.startsWith(p));
}

export function runCommand(input: string, ctx: TerminalContext): CommandResult {
  const { cmd, arg } = parseCommand(input);
  const out = (text: string, tone: CommandResult["lines"][number]["tone"] = "out") => ({ text, tone });
  if (!cmd) return { lines: [] };
  switch (cmd) {
    case "help":
    case "?":
      return { lines: [out("COMMANDS", "head"), ...COMMANDS.map((c) => out(`${c.usage.padEnd(38)} ${c.help}`)), out("Anything else is sent to LÉLU.")] };
    case "clear":
    case "cls":
      return { lines: [], clear: true };
    case "where":
    case "status": {
      const c = ctx.camera();
      const s = ctx.sector();
      const node = ctx.nodes().find((n) => n.id === ctx.currentNodeId());
      const w = ctx.world();
      return {
        lines: [
          out(`POS    x ${fmt(c.x)}  y ${fmt(c.y)}  z ${fmt(c.z)}`),
          out(`SECTOR [${s.x}, ${s.y}, ${s.z}]`),
          out(`REGION ${node ? `${node.label} (${node.level})` : "—"}`),
          out(`SCALE  ${ctx.scale().toUpperCase()}`),
          out(`WORLD  ${w.phase} ${Math.round(w.progress * 100)}% · cycle ${w.cycle}`),
        ],
      };
    }
    case "ls":
    case "dir": {
      const here = ctx.currentNodeId();
      const kids = ctx.nodes().filter((n) => n.parentId === here);
      if (!kids.length) return { lines: [out("Nothing below this region. 'back' goes up.", "warn")] };
      return { lines: kids.map((n) => out(`${n.level.padEnd(7)} ${n.label}`)) };
    }
    case "goto":
    case "cd": {
      if (!arg) return { lines: [out("Usage: goto <name>", "warn")] };
      if (arg === "..") return runCommand("back", ctx);
      const node = findByName(ctx.nodes(), arg, (n) => n.id, (n) => n.label);
      if (!node) return { lines: [out(`No destination matches "${arg}". Try 'ls'.`, "error")] };
      if (!ctx.navigateTo(node.id)) return { lines: [out(`Could not navigate to ${node.label}.`, "error")] };
      ctx.focus({ kind: "node", id: node.id });
      return { lines: [out(`→ ${node.label} (${node.level})`, "ok")] };
    }
    case "back": {
      if (!ctx.back()) return { lines: [out("Already at the start of the trail.", "warn")] };
      const node = ctx.nodes().find((n) => n.id === ctx.currentNodeId());
      return { lines: [out(`← ${node?.label ?? ctx.currentNodeId()}`, "ok")] };
    }
    case "select": {
      if (!arg) return { lines: [out("Usage: select <name>", "warn")] };
      const object = findByName(ctx.objects(), arg, (o) => o.id, (o) => o.name);
      if (object) {
        ctx.focus({ kind: "object", id: object.id });
        return { lines: [out(`Selected object ${object.name}`, "ok")] };
      }
      const node = findByName(ctx.nodes(), arg, (n) => n.id, (n) => n.label);
      if (node) {
        ctx.focus({ kind: "node", id: node.id });
        return { lines: [out(`Selected ${node.label} (${node.level})`, "ok")] };
      }
      return { lines: [out(`Nothing matches "${arg}".`, "error")] };
    }
    case "deselect":
      ctx.focus(null);
      return { lines: [out("Selection cleared.", "ok")] };
    case "scale":
    case "zoom": {
      const s = SCALES.find((x) => x.startsWith(arg.toLowerCase()) && arg);
      if (!s) return { lines: [out(`Usage: scale <${SCALES.join("|")}>`, "warn")] };
      ctx.flyScale(s);
      return { lines: [out(`Flying to ${s.toUpperCase()} scale…`, "ok")] };
    }
    case "open":
    case "run": {
      const panel = findByName(ctx.panels(), arg, (p) => p.id, (p) => p.label);
      if (!arg || !panel) return { lines: [out(arg ? `No app called "${arg}".` : "Usage: open <app>", arg ? "error" : "warn"), out(`Apps: ${ctx.panels().map((p) => p.id).join(", ")}`)] };
      ctx.openPanel(panel.id);
      return { lines: [out(`Opening ${panel.label}…`, "ok")] };
    }
    case "look":
      ctx.immersive();
      return { lines: [out("Looking at the Cosmos. Tap the orb to come back.", "ok")] };
    case "appearance":
    case "studio":
    case "colors":
    case "colours":
      ctx.openStudio();
      return { lines: [out("Terminal Appearance Studio open.", "ok")] };
    case "layout":
    case "arrange":
      ctx.arrange();
      return { lines: [out("Arranging: pick another presentation or layout in the bar above.", "ok")] };
    case "theme": {
      const themes = ctx.themes();
      if (!arg) return { lines: [out("THEMES", "head"), ...themes.map((t) => out(`  ${t.name}`))] };
      const theme = findByName(themes, arg, (t) => t.id, (t) => t.name);
      if (!theme) return { lines: [out(`No theme called "${arg}".`, "error")] };
      if (ctx.hasUnsavedTheme()) return { lines: [out("You have unsaved appearance changes. Save or revert them in the studio first ('appearance').", "warn")] };
      ctx.selectTheme(theme.id);
      return { lines: [out(`Theme: ${theme.name}`, "ok")] };
    }
    case "ask":
      if (!arg) return { lines: [out("Usage: ask <text>", "warn")] };
      ctx.ask(arg);
      return { lines: [out("→ sent to LÉLU's conversation", "ok")] };
    default:
      ctx.ask(input.trim());
      return { lines: [out("→ sent to LÉLU's conversation", "ok")] };
  }
}
