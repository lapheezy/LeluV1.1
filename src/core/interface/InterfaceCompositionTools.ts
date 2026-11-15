/**
 * ==========================================================
 * LÉLU — INTERFACE COMPOSITION TOOLS (Mission 17)
 *
 * The interface ecosystem offered to LÉLU through the SAME pipeline as
 * every other capability: ToolRegistry describes, ToolDispatcher runs
 * (registerExecutor), the activity timeline shows the real result.
 *
 *   interface.list     read: every interface and composition
 *   interface.open     open one interface, or a composition, on screen
 *   interface.compose  make / clone / vary / merge / split compositions
 *
 * Nothing here calls the network. Opening needs the Genesis shell to be
 * mounted (interfaceLaunch); without it the tool fails and says why.
 * Composing only ever ADDS compositions — a source is never changed,
 * and built-ins cannot be changed at all.
 * ==========================================================
 */

import type { ToolDefinition } from "../tools/ToolRegistry";
import { registerExecutor, type ToolExecutor } from "../tools/ToolDispatcher";
import { INTERFACES, resolveInterface, type InterfaceId } from "./InterfaceCatalog";
import InterfaceCompositionStore from "./InterfaceCompositionStore";
import { VARIANT_STYLES, regionName, type VariantStyle } from "./interfaceComposition";
import { requestLaunch } from "./interfaceLaunch";

const def = (id: string, name: string, description: string, riskLevel: 0 | 1, inputSchema: Record<string, unknown>): ToolDefinition => ({
  id,
  name,
  description,
  category: "Cosmos",
  permissions: riskLevel === 0 ? ["READ"] : ["READ", "WRITE"],
  riskLevel,
  available: true,
  inputSchema,
});

const LIST_SCHEMA = { type: "object", properties: {}, additionalProperties: false };
const OPEN_SCHEMA = {
  type: "object",
  properties: {
    interface: { type: "string", description: `An interface id or name: ${INTERFACES.map((i) => i.id).join(", ")}` },
    composition: { type: "string", description: "A composition id from interface.list (opens it as one continuous interface)" },
    close: { type: "boolean", description: "Close the open composition and return to the Cosmos" },
  },
  additionalProperties: false,
};
const COMPOSE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["create", "clone", "variants", "merge", "split"] },
    name: { type: "string" },
    interfaces: { type: "array", items: { type: "string" }, description: "For create: interface ids or names, in order" },
    source: { type: "string", description: "Composition id for clone / variants / split / merge (first)" },
    other: { type: "string", description: "Second composition id for merge" },
    styles: { type: "array", items: { type: "string", enum: VARIANT_STYLES } },
    at: { type: "number", description: "For split: the region index the second part starts at" },
  },
  required: ["action"],
  additionalProperties: false,
};

export const INTERFACE_TOOLS: ToolDefinition[] = [
  def("interface.list", "List Interfaces", "Every LÉLU interface (Cosmos, LÉLU's Room / Genesis V2, LÉLU System UI, Original LÉLU) and every saved interface composition, with ids.", 0, LIST_SCHEMA),
  def("interface.open", "Open an Interface", "Open one LÉLU interface on its own, or open a composition as one continuous scrollable interface, or close it and return to the Cosmos.", 0, OPEN_SCHEMA),
  def("interface.compose", "Compose Interfaces", "Make a new interface composition from interfaces, clone one, generate alternative arrangements (classic, cinematic, minimal, spatial), merge two, or split one. Sources are never changed.", 1, COMPOSE_SCHEMA),
];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function describeAll(): string {
  const lines = INTERFACES.map((i) => `• ${i.name} [${i.id}] — ${i.category}. ${i.description}`);
  const comps = InterfaceCompositionStore.list().map(
    (c) => `• ${c.name} [${c.id}]${c.builtIn ? " (built-in)" : ""}: ${c.regions.map(regionName).join(" → ")} (${c.flow})`,
  );
  return [`Interfaces (${INTERFACES.length}):`, ...lines, "", `Compositions (${comps.length}):`, ...comps].join("\n");
}

export const INTERFACE_EXECUTORS: ToolExecutor[] = [
  {
    id: "interface.list",
    parameters: LIST_SCHEMA,
    run: async () => ({ ok: true, content: describeAll(), data: { interfaces: INTERFACES.map((i) => i.id), compositions: InterfaceCompositionStore.list().map((c) => c.id) } }),
  },
  {
    id: "interface.open",
    parameters: OPEN_SCHEMA,
    run: async (args) => {
      if (args.close === true) {
        const r = requestLaunch({ kind: "close-composition" });
        return { ok: r.ok, content: r.detail };
      }
      const comp = str(args.composition);
      if (comp) {
        if (!InterfaceCompositionStore.get(comp)) return { ok: false, content: `No composition "${comp}". Use interface.list for ids.` };
        const r = requestLaunch({ kind: "composition", id: comp });
        return { ok: r.ok, content: r.detail };
      }
      const phrase = str(args.interface);
      const entry = resolveInterface(phrase);
      if (!entry) return { ok: false, content: `"${phrase}" is not one interface. One of: ${INTERFACES.map((i) => `${i.name} (${i.id})`).join(", ")}.` };
      const r = requestLaunch({ kind: "interface", id: entry.id });
      return { ok: r.ok, content: r.detail };
    },
  },
  {
    id: "interface.compose",
    parameters: COMPOSE_SCHEMA,
    run: async (args) => {
      const action = str(args.action);
      const S = InterfaceCompositionStore;
      if (action === "create") {
        const raw = Array.isArray(args.interfaces) ? args.interfaces.map(str) : [];
        const ids: InterfaceId[] = [];
        for (const phrase of raw) {
          const entry = resolveInterface(phrase);
          if (!entry) return { ok: false, content: `"${phrase}" is not one interface. Nothing was created.` };
          ids.push(entry.id);
        }
        if (ids.length === 0) return { ok: false, content: "create needs at least one interface." };
        const c = S.create(str(args.name) || "New composition", ids);
        return { ok: true, content: `Created “${c.name}” [${c.id}]: ${c.regions.map(regionName).join(" → ")}.`, data: { id: c.id } };
      }
      const source = str(args.source);
      if (!source || !S.get(source)) return { ok: false, content: `${action} needs an existing composition id in "source".` };
      if (action === "clone") {
        const c = S.clone(source)!;
        return { ok: true, content: `Cloned into “${c.name}” [${c.id}] — an independent copy; the source is unchanged.`, data: { id: c.id } };
      }
      if (action === "variants") {
        const styles = (Array.isArray(args.styles) ? args.styles.map(str) : VARIANT_STYLES).filter((s): s is VariantStyle => (VARIANT_STYLES as string[]).includes(s));
        const made = S.variants(source, styles.length ? styles : VARIANT_STYLES);
        return { ok: true, content: `Made ${made.length} alternatives:\n${made.map((c) => `• ${c.name} [${c.id}]: ${c.regions.map(regionName).join(" → ")} (${c.flow}, ${c.seam})`).join("\n")}`, data: { ids: made.map((c) => c.id) } };
      }
      if (action === "merge") {
        const other = str(args.other);
        const c = other ? S.merge(source, other) : null;
        return c ? { ok: true, content: `Merged into “${c.name}” [${c.id}]. Both sources are unchanged.`, data: { id: c.id } } : { ok: false, content: `merge needs a second existing composition id in "other".` };
      }
      if (action === "split") {
        const at = typeof args.at === "number" ? Math.round(args.at) : NaN;
        const parts = Number.isFinite(at) ? S.split(source, at) : null;
        return parts ? { ok: true, content: `Split into “${parts[0].name}” and “${parts[1].name}”. The source is unchanged.`, data: { ids: parts.map((p) => p.id) } } : { ok: false, content: "split needs `at` between 1 and the number of regions − 1." };
      }
      return { ok: false, content: `Unknown action "${action}". One of: create, clone, variants, merge, split.` };
    },
  },
];

export function registerInterfaceCompositionTools(): void {
  for (const executor of INTERFACE_EXECUTORS) {
    const definition = INTERFACE_TOOLS.find((t) => t.id === executor.id);
    if (!definition) continue;
    const added = registerExecutor(executor, definition);
    if (!added.ok) console.warn(`[InterfaceCompositionTools] ${executor.id} was not registered: ${added.reason}`);
  }
}
