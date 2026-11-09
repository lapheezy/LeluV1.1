/**
 * ==========================================================
 * LÉLU HOME — THE APP CATALOG
 *
 * One list of LÉLU's applications for the home: the primary row, the
 * app library and the workspace cards all read it. Every entry is an
 * EXISTING Genesis panel (GenesisInterface's MODULE_RENDERERS) — no new
 * applications, no decorative tiles. Opening one goes through the same
 * GenesisCore.openPanel the rest of the app uses.
 * ==========================================================
 */

import type { GenesisPanel } from "../GenesisCore";

export type AppGroup = "creativity" | "development" | "research" | "business" | "system";

export interface HomeApp {
  id: GenesisPanel;
  label: string;
  /** Short line for the library and workspace cards. */
  hint: string;
  /** Icon key (lucide-react name, resolved in the view). */
  icon: string;
  group: AppGroup;
}

export const APPS: HomeApp[] = [
  { id: "chat", label: "Chat", hint: "Talk with LÉLU", icon: "MessageCircle", group: "business" },
  { id: "browser", label: "Browser", hint: "Browse and research", icon: "Compass", group: "research" },
  { id: "visualstudio", label: "Studio", hint: "Sketch, render, avatar", icon: "Box", group: "creativity" },
  { id: "creation", label: "Documents", hint: "Docs, decks and spreadsheets", icon: "FileText", group: "business" },
  { id: "projects", label: "Files", hint: "Projects and their files", icon: "Folder", group: "business" },
  { id: "agents", label: "Agents", hint: "Her agents at work", icon: "Workflow", group: "business" },
  { id: "sketch", label: "Sketch", hint: "Draw with LÉLU", icon: "PenLine", group: "creativity" },
  { id: "render", label: "Render", hint: "Images and 3D", icon: "Aperture", group: "creativity" },
  { id: "video", label: "Video", hint: "Watch and make video", icon: "Film", group: "creativity" },
  { id: "avatar", label: "Avatar", hint: "Her look and presence", icon: "UserRound", group: "creativity" },
  { id: "engineering", label: "Code", hint: "Engineering workspace", icon: "Code2", group: "development" },
  { id: "command", label: "Engineering Command", hint: "Acquisitions, workforce and capabilities", icon: "Workflow", group: "development" },
  { id: "evolution", label: "Self Development", hint: "What she is improving", icon: "Sparkles", group: "development" },
  { id: "cognitive-trace", label: "Trace", hint: "Her reasoning, step by step", icon: "Activity", group: "development" },
  { id: "diagnostics", label: "Engines", hint: "Runtime engines", icon: "Gauge", group: "development" },
  { id: "logs", label: "Logs", hint: "What ran, and when", icon: "ScrollText", group: "development" },
  { id: "knowledge", label: "Knowledge", hint: "What she has learned", icon: "BookOpen", group: "research" },
  { id: "reasoning", label: "Reasoning", hint: "Think a problem through", icon: "Lightbulb", group: "research" },
  { id: "earth", label: "Earth", hint: "Live planet data", icon: "Globe2", group: "research" },
  { id: "memory", label: "Memory", hint: "What she remembers", icon: "Brain", group: "research" },
  { id: "executive", label: "Executive", hint: "Executive board and goals", icon: "Crown", group: "business" },
  { id: "briefings", label: "Briefings", hint: "Her briefings for you", icon: "Newspaper", group: "business" },
  { id: "notifications", label: "Updates", hint: "Proposals and approvals", icon: "Bell", group: "business" },
  { id: "cognition", label: "Cognition", hint: "Her mind, live", icon: "Orbit", group: "system" },
  { id: "history", label: "History", hint: "Past conversations", icon: "History", group: "system" },
  { id: "identity", label: "Identity", hint: "Who she is", icon: "Fingerprint", group: "system" },
  { id: "device", label: "Device", hint: "This device", icon: "Smartphone", group: "system" },
  { id: "genesisv2", label: "Genesis V2", hint: "Her 3D world", icon: "Layers", group: "system" },
  { id: "settings", label: "Settings", hint: "Preferences", icon: "Settings", group: "system" },
];

/** The primary row, in the reference's order. "workspaces" is the home's own windows view. */
export const PRIMARY: Array<GenesisPanel | "workspaces"> = ["chat", "browser", "visualstudio", "workspaces", "agents", "projects"];

export const GROUPS: Array<{ id: AppGroup; label: string; icon: string }> = [
  { id: "creativity", label: "Creativity", icon: "Flower2" },
  { id: "development", label: "Development", icon: "Code2" },
  { id: "research", label: "Research", icon: "Layers3" },
  { id: "business", label: "Business", icon: "BarChart3" },
  { id: "system", label: "System", icon: "Settings2" },
];

export function appFor(id: string): HomeApp | undefined {
  return APPS.find((app) => app.id === id);
}
