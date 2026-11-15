/**
 * ==========================================================
 * LÉLU — THE INTERFACE CATALOG (Mission 17)
 *
 * One list of every complete interface LÉLU has. Each entry is an
 * EXISTING implementation in this repository — nothing here is a
 * mock-up, a screenshot or a new application:
 *
 *   cosmos        the living Cosmos (Genesis V1 world)  GenesisScene.tsx
 *   lelu-room     LÉLU's Room (Genesis V2)               GenesisLab.tsx
 *   lelu-system   LÉLU System UI (legacy)                LivingSystemUI.tsx
 *   og-inner-sky  Original LÉLU · Inner Sky (legacy)     og/routes/app/*
 *   og-core       Original LÉLU · Core (legacy)          og/routes/core.tsx
 *
 * Every interface is BOTH a standalone experience (its own entry
 * point, `href`) and a region a composition can contain. They share
 * one runtime: the same GenesisCore, AIService, conversations and
 * avatar. Nothing in this file holds state; it only describes.
 *
 * Pure: no React, no DOM, no storage. Safe to import from tools.
 * ==========================================================
 */

export type InterfaceFamily = "cosmos" | "legacy";

/** How the interface is reached on its own. */
export type StandaloneEntry =
  /** A scene inside the Genesis shell (same page, same runtime). */
  | { kind: "scene"; scene: "cosmos" | "room" | "system" }
  /** A route of the app (same SPA, same runtime singletons). */
  | { kind: "route"; path: string };

export interface InterfaceEntry {
  id: InterfaceId;
  name: string;
  /** The heading it is listed under in the Infinite Library. */
  category: "Cosmos" | "Legacy UIs";
  family: InterfaceFamily;
  description: string;
  /** Lucide icon name, resolved in the view. */
  icon: string;
  /** The visual identity a composition preserves at its seams. */
  identity: { accent: string; background: string };
  /** Draws its own WebGL canvas when mounted (counts against the one-3D-region budget). */
  webgl: boolean;
  standalone: StandaloneEntry;
  /** Deep link that opens it alone. Relative to the app's base URL. */
  href: string;
  /** Where it lives, so anyone can check it is the real thing. */
  source: string;
  /** What it shares with every other interface. Always the same runtime. */
  shares: string[];
  /** Plain words for what it can do, for search and for LÉLU's tools. */
  keywords: string[];
}

export type InterfaceId = "cosmos" | "lelu-room" | "lelu-system" | "og-inner-sky" | "og-core";

const SHARED = ["GenesisCore state", "conversations", "AIService / providers", "agents", "memory", "LÉLU's avatar"];

export const INTERFACES: readonly InterfaceEntry[] = [
  {
    id: "cosmos",
    name: "Cosmos",
    category: "Cosmos",
    family: "cosmos",
    description: "Her living universe — the Neural Map, galaxies, rooms and objects.",
    icon: "Orbit",
    identity: { accent: "#7dd3fc", background: "#020617" },
    webgl: true,
    standalone: { kind: "scene", scene: "cosmos" },
    href: "?interface=cosmos",
    source: "src/app/scene/genesis/GenesisScene.tsx (GenesisV1Workspace)",
    shares: SHARED,
    keywords: ["genesis v1", "universe", "neural map", "galaxies", "world", "space"],
  },
  {
    id: "lelu-room",
    name: "LÉLU's Room",
    category: "Cosmos",
    family: "cosmos",
    description: "Her own room in the Cosmos — Genesis V2: the Core, Creation Studio, Research Lab and Vault.",
    icon: "Layers",
    identity: { accent: "#c084fc", background: "#07021a" },
    webgl: true,
    standalone: { kind: "scene", scene: "room" },
    href: "?interface=lelu-room",
    source: "src/app/scene/genesis/GenesisLab.tsx (Genesis V2)",
    shares: SHARED,
    keywords: ["genesis v2", "her room", "her world", "lab", "core evolution", "heartbeat"],
  },
  {
    id: "lelu-system",
    name: "LÉLU System UI",
    category: "Legacy UIs",
    family: "legacy",
    description: "The living-system view: Heartbeat, Matrix, Nerve, Neuron and Core.",
    icon: "Activity",
    identity: { accent: "#34d399", background: "#01080a" },
    webgl: false,
    standalone: { kind: "scene", scene: "system" },
    href: "?interface=lelu-system",
    source: "src/app/scene/genesis/LivingSystemUI.tsx + LivingSystemVisuals.tsx",
    shares: SHARED,
    keywords: ["system", "heartbeat", "ecg", "matrix", "nerve", "neuron", "core", "legacy"],
  },
  {
    id: "og-inner-sky",
    name: "Original LÉLU · Inner Sky",
    category: "Legacy UIs",
    family: "legacy",
    description: "The original LÉLU companion app: Home, Chats, Agents, Memory Garden, Files, Projects.",
    icon: "Sun",
    identity: { accent: "#fbbf24", background: "#0b1120" },
    webgl: false,
    standalone: { kind: "route", path: "/og/app" },
    href: "og/app",
    source: "src/og/routes/app/* (AppShell)",
    shares: SHARED,
    keywords: ["original", "og", "classic", "inner sky", "chats", "memory garden", "legacy"],
  },
  {
    id: "og-core",
    name: "Original LÉLU · Core",
    category: "Legacy UIs",
    family: "legacy",
    description: "The original Core: tap the Core, long-press to speak.",
    icon: "Sparkles",
    identity: { accent: "#fb923c", background: "#050a12" },
    webgl: false,
    standalone: { kind: "route", path: "/og/core" },
    href: "og/core",
    source: "src/og/routes/core.tsx",
    shares: SHARED,
    keywords: ["original", "og", "core", "solar core", "legacy"],
  },
];

export const INTERFACE_CATEGORIES = ["Cosmos", "Legacy UIs"] as const;

export function interfaceById(id: string): InterfaceEntry | undefined {
  return INTERFACES.find((entry) => entry.id === id);
}

export function isInterfaceId(id: unknown): id is InterfaceId {
  return typeof id === "string" && INTERFACES.some((entry) => entry.id === id);
}

/** Case-insensitive match on name, description and keywords. */
export function searchInterfaces(query: string): InterfaceEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...INTERFACES];
  return INTERFACES.filter(
    (entry) =>
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.category.toLowerCase().includes(q) ||
      entry.keywords.some((k) => k.includes(q)),
  );
}

/**
 * Resolve a loose phrase ("genesis v2", "the old system ui", "original
 * lelu") to one interface, or null. Used by the tools so LÉLU can be asked
 * in words; an ambiguous phrase is refused rather than guessed.
 */
export function resolveInterface(phrase: string): InterfaceEntry | null {
  const p = phrase.trim().toLowerCase();
  if (!p) return null;
  const exact = interfaceById(p);
  if (exact) return exact;
  const byName = INTERFACES.find((entry) => entry.name.toLowerCase() === p);
  if (byName) return byName;
  if (/\bv2\b|genesis 2|room|her world|lab\b/.test(p)) return interfaceById("lelu-room")!;
  if (/system/.test(p)) return interfaceById("lelu-system")!;
  if (/inner sky|original|\bog\b|classic|old lelu|old lélu/.test(p)) return /core/.test(p) ? interfaceById("og-core")! : interfaceById("og-inner-sky")!;
  if (/cosmos|v1\b|genesis 1|universe|neural map/.test(p)) return interfaceById("cosmos")!;
  const hits = searchInterfaces(p);
  return hits.length === 1 ? hits[0] : null;
}
