/**
 * ==========================================================
 * LÉLU
 * UI SPEC — the interface evolution language
 *
 * A UISpec is a data-defined component: sections of typed
 * elements (labels, inputs, buttons, selects, toggles, lists,
 * chips, badges, grids, rows, alerts). The RuntimeUI renderer
 * turns a spec into a live, interactive panel — so LÉLU can
 * design, preview, iterate on, and persist interface candidates
 * without ever touching production JSX.
 *
 * This is a real mechanism (validation + persistent store + live
 * renderer), scoped honestly: it renders data-defined UI, not
 * arbitrary code.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type UISpecElement =
  | { type: "label"; text: string; variant?: "title" | "subtitle" | "body" | "caption" }
  | { type: "text"; key: string; label: string; placeholder?: string; value?: string }
  | { type: "button"; key: string; label: string; variant?: "primary" | "ghost" }
  | { type: "select"; key: string; label: string; options: string[]; value?: string }
  | { type: "toggle"; key: string; label: string; value?: boolean }
  | { type: "list"; key: string; items: string[] }
  | { type: "chips"; key: string; items: string[] }
  | { type: "badge"; key: string; text: string; tone?: "ok" | "warn" | "error" | "info" }
  | { type: "alert"; tone: "info" | "warn" | "error"; text: string }
  | { type: "divider" }
  | { type: "spacer"; height?: number }
  | { type: "row"; elements: UISpecElement[] }
  | { type: "column"; elements: UISpecElement[] }
  | { type: "grid"; columns: number; elements: UISpecElement[] };

export interface UISpecSection {
  title?: string;
  elements: UISpecElement[];
}

export interface UISpec {
  id: string;
  name: string;
  description: string;
  sections: UISpecSection[];
  version: string;
  createdAt: number;
  updatedAt: number;
}

const KEY = "lelu.uilab.v1";

/** Validate a spec draft — returns a list of human-readable problems. */
export function validateSpec(spec: Omit<UISpec, "id" | "createdAt" | "updatedAt">): string[] {
  const problems: string[] = [];
  if (!spec.name.trim()) {
    problems.push("A spec needs a name.");
  }
  if (!Array.isArray(spec.sections) || spec.sections.length === 0) {
    problems.push("A spec needs at least one section.");
    return problems;
  }
  const walk = (elements: UISpecElement[], path: string) => {
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      const at = `${path}[${index}]`;
      if (
        element.type === "text" ||
        element.type === "button" ||
        element.type === "select" ||
        element.type === "toggle"
      ) {
        if (!element.key) {
          problems.push(`${at} (${element.type}) needs a key.`);
        }
      }
      if (element.type === "select" && (!element.options || element.options.length === 0)) {
        problems.push(`${at} (select) needs at least one option.`);
      }
      if (element.type === "grid" && (!element.columns || element.columns < 1)) {
        problems.push(`${at} (grid) needs a positive column count.`);
      }
      if (element.type === "row" || element.type === "column" || element.type === "grid") {
        walk(element.elements, at);
      }
    }
  };
  spec.sections.forEach((section, sectionIndex) => {
    walk(section.elements, `sections[${sectionIndex}].elements`);
  });
  return problems;
}

export function defaultSpec(): Omit<UISpec, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "Untitled interface",
    description: "A data-defined interface candidate.",
    version: "0.1",
    sections: [
      {
        title: "Welcome",
        elements: [
          { type: "label", text: "New Interface", variant: "title" },
          { type: "label", text: "Designed in the UI Evolution Lab.", variant: "body" },
          { type: "divider" },
          { type: "text", key: "name", label: "Name", placeholder: "Type something…", value: "" },
          { type: "row", elements: [
            { type: "button", key: "save", label: "Save", variant: "primary" },
            { type: "button", key: "cancel", label: "Cancel" },
          ] },
        ],
      },
    ],
  };
}

export default class UISpecStore {
  private static instance: UISpecStore | null = null;
  private specs: UISpec[];

  private constructor() {
    this.specs = KvStore.getInstance().get<UISpec[]>(KEY) ?? [];
  }

  public static getInstance(): UISpecStore {
    if (!UISpecStore.instance) {
      UISpecStore.instance = new UISpecStore();
    }
    return UISpecStore.instance;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.specs);
    } catch {
      // best-effort
    }
  }

  public list(): UISpec[] {
    return [...this.specs].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public get(id: string): UISpec | undefined {
    return this.specs.find((spec) => spec.id === id);
  }

  public create(input: Omit<UISpec, "id" | "createdAt" | "updatedAt">): UISpec {
    const created: UISpec = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.specs = [created, ...this.specs];
    this.persist();
    return created;
  }

  public update(id: string, patch: Partial<Omit<UISpec, "id" | "createdAt">>): UISpec | undefined {
    let updated: UISpec | undefined;
    this.specs = this.specs.map((spec) => {
      if (spec.id !== id) {
        return spec;
      }
      updated = { ...spec, ...patch, updatedAt: Date.now() };
      return updated;
    });
    this.persist();
    return updated;
  }

  public remove(id: string): void {
    this.specs = this.specs.filter((spec) => spec.id !== id);
    this.persist();
  }
}
