/**
 * ==========================================================
 * LÉLU — RUNTIME SKILL CATALOGUE
 *
 * Mission 14, phase 4. The investigation found a real gap:
 * `.agents/skills` and `skills-lock.json` existed, but nothing in
 * the running app could name or read a skill. Cognition therefore
 * reported skills as UNAVAILABLE, which was honest and useless.
 *
 * This is a CATALOGUE, not an executor. It reads the real SKILL.md
 * bodies that ship with the app, at build time, and exposes their
 * declared name, description and source. Every entry is
 * `invocable: false`, because a skill body is authoring guidance,
 * not a dispatcher executor — listing one must never be read as
 * "LÉLU can run this". Invocation is a separate capability that
 * this slice does not claim.
 *
 * No skill is invented: the list is derived from files on disk.
 * In a plain Node test runner Vite's glob is absent, so the list is
 * empty there, and the self-model says so rather than fabricating
 * a catalogue.
 * ==========================================================
 */

import type { MissionEvidence } from "../operational-intelligence/evidence.ts";

export interface RuntimeSkill {
  id: string;
  name: string;
  description: string;
  /** Where the body came from, e.g. `.agents/skills/supabase/SKILL.md`. */
  source: string;
  /** The file is present in the bundle; execution is not claimed. */
  evidence: MissionEvidence;
  invocable: false;
  /** Why invocation is not offered. */
  reason: string;
}

function skillFiles(): Record<string, string> {
  try {
    // This literal must stay literal: Vite replaces `import.meta.glob(...)`
    // at build time. Under `tsx`/Node the function is absent, the call
    // throws, and the catch keeps the catalogue honestly empty.
    return import.meta.glob("../../../.agents/skills/*/SKILL.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as unknown as Record<string, string>;
  } catch {
    return {};
  }
}

function frontmatter(raw: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    let value = pair[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[pair[1]] = value;
  }
  return fields;
}

const truncate = (text: string, max = 400): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Parse one real SKILL.md. Exported so a fixture can prove the parser. */
export function parseSkillFile(raw: string, path: string, id?: string): RuntimeSkill | null {
  const fields = frontmatter(raw);
  const derivedId = id ?? /([^/]+)\/SKILL\.md$/.exec(path)?.[1] ?? "";
  if (!derivedId) return null;
  const name = fields.name?.trim() || derivedId;
  const description = fields.description?.trim();
  return {
    id: derivedId,
    name,
    description: description
      ? truncate(description)
      : "No description is declared in this skill's frontmatter.",
    source: path.replace(/^.*?(\.agents\/skills\/)/, "$1"),
    evidence: "REPORTED",
    invocable: false,
    reason:
      "The skill body is authoring guidance. No dispatcher executor is registered for it, " +
      "so LÉLU can read its catalogue entry but cannot invoke it.",
  };
}

export class SkillRegistry {
  private readonly skills: RuntimeSkill[];

  constructor(files: Record<string, string> = skillFiles()) {
    this.skills = Object.entries(files)
      .map(([path, raw]) => parseSkillFile(raw, path))
      .filter((skill): skill is RuntimeSkill => skill !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  public list(): RuntimeSkill[] {
    return [...this.skills];
  }

  public get(id: string): RuntimeSkill | undefined {
    return this.skills.find((skill) => skill.id === id || skill.name === id);
  }

  public invocable(): RuntimeSkill[] {
    return this.skills.filter((skill) => skill.invocable);
  }
}

let instance: SkillRegistry | null = null;

export default class SkillRegistryStore {
  public static getInstance(): SkillRegistry {
    if (!instance) instance = new SkillRegistry();
    return instance;
  }

  public static setForTests(registry: SkillRegistry | null): void {
    instance = registry;
  }
}
