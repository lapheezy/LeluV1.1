/**
 * ==========================================================
 * LÉLU
 * PROJECT INTERPRETER — cognition decides what a project
 * request means; the parser is only a fallback
 *
 * The regression this fixes:
 *
 *   "Create a project brief for a pendant collection in that metal."
 *
 * ProjectRequestParser took everything after the word "project",
 * kept the first six words, and minted a project literally called
 * "Brief for a Pendant Collection in". ProjectResolver then returned
 * `handled: true`, so the model NEVER SAW the sentence — which is why
 * "that metal" could not resolve. A string parser cannot know what
 * "that", "it" or "the collection" refer to, and it was the authority.
 *
 * This module puts interpretation back where it belongs. It hands the
 * REAL conversation and the REAL project state to the existing
 * provider chain (AIService.reason → the same ProviderResolver and
 * AIProviderRegistry as chat) and asks for a structured decision:
 *
 *   - is this a new project or a change to an existing one?
 *   - which existing project does it refer to?
 *   - what do the pronouns/references resolve to?
 *   - what is the real title, objective and set of tasks?
 *   - or is the reference unresolvable, so LÉLU should ask?
 *
 * No new provider system, no new store: it reasons through the one
 * runtime and writes through the one ProjectStore.
 * ==========================================================
 */

import AIService from "../AIService";
import type { LeluProject } from "./ProjectStore";

export type ProjectAction = "create" | "update" | "clarify" | "none";

export interface ProjectDecision {
  action: ProjectAction;
  /** Existing project this refers to, when action is "update". */
  projectId?: string;
  /** Human title. For "update" this may rename, or be omitted. */
  name?: string;
  /** What the project is for, with references already resolved. */
  objective?: string;
  /** Concrete tasks, references resolved. */
  tasks?: string[];
  /** Facts the request establishes about the project (material, scope…). */
  attributes?: Record<string, string>;
  /** What the model resolved each reference to — for the audit trail. */
  resolvedReferences?: Record<string, string>;
  /** When action is "clarify": the single question worth asking. */
  question?: string;
  /** Why this decision — surfaced in logs, never invented state. */
  reasoning?: string;
  /** The user asked for work to actually start, not just be planned. */
  execute?: boolean;
  /** True when a provider produced this, false for the local fallback. */
  fromModel: boolean;
}

/**
 * Words that are references, not values. If one of these survives into a
 * title, objective or attribute, the reference was NOT resolved and the
 * decision must not be written to project state — that is precisely how
 * "a pendant collection in that metal" became a project called
 * "…Collection in". The guard is system-side on purpose: it must hold
 * whatever a model returns.
 */
const UNRESOLVED_REFERENCE =
  /^(?:that|this|those|these|it|them|the)\b|\b(?:that|this|those|these)\s+(?:one|metal|material|colour|color|size|thing|item|design|collection)\b/i;

/** Does this text still contain an ungrounded reference? */
export function containsUnresolvedReference(text: string | undefined): boolean {
  if (!text) return false;
  return UNRESOLVED_REFERENCE.test(text.trim());
}

/** Turns handed to the interpreter as grounding. */
export interface GroundingTurn {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM = `You interpret a user's project request inside LÉLU.

You are given the recent conversation and LÉLU's real current projects.
Decide what the LATEST user message actually means.

Resolve every reference from the conversation:
- pronouns ("it", "that", "them", "this one")
- deictic phrases ("that metal", "the collection", "those designs")
- implicit continuations ("make it larger", "add three more")

Rules:
- If the message refers to an EXISTING project, action is "update" and you MUST return its exact projectId from the list given.
- If it genuinely starts something new, action is "create".
- If a reference cannot be resolved from the conversation, action is "clarify" and you return ONE specific question. Never guess a value.
- Titles must be real, readable names for the thing — never a truncated fragment of the sentence.
- Objectives and tasks must have references already substituted (if the user said platinum earlier and now says "that metal", write "platinum").
- Never invent facts the conversation does not contain.

Reply with ONLY a JSON object, no prose, no code fence:
{"action":"create|update|clarify|none","projectId":"...","name":"...","objective":"...","tasks":["..."],"attributes":{"key":"value"},"resolvedReferences":{"that metal":"platinum"},"execute":true|false,"question":"...","reasoning":"..."}

Set "execute" to true only when the user asked for work to actually begin now ("start working on it", "run it", "go ahead").`;

export default class ProjectInterpreter {
  /**
   * Interpret the request against the real conversation and project
   * state. Never throws: when no provider answers, the caller falls back
   * to the parser, which is explicitly a lesser signal.
   */
  public async interpret(
    message: string,
    turns: GroundingTurn[],
    projects: LeluProject[],
  ): Promise<ProjectDecision | null> {
    const projectList = projects.length > 0
      ? projects
          .map((project) => {
            const attributes = project.context ? ` | known: ${project.context}` : "";
            return `- id=${project.id} | name="${project.name}" | status=${project.status} | objective="${project.objective || project.description || ""}"${attributes}`;
          })
          .join("\n")
      : "(no projects exist yet)";

    const transcript = turns.length > 0
      ? turns.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`).join("\n")
      : "(no earlier conversation)";

    const prompt = [
      "LÉLU'S CURRENT PROJECTS:",
      projectList,
      "",
      "RECENT CONVERSATION (oldest first):",
      transcript,
      "",
      `LATEST USER MESSAGE: ${message}`,
      "",
      "Return the JSON decision.",
    ].join("\n");

    try {
      const response = await AIService.getInstance().reason(prompt, {
        system: SYSTEM,
        temperature: 0,
        maxTokens: 700,
      });

      const succeeded =
        response.metadata?.success !== false &&
        response.provider !== "offline" &&
        response.text.trim().length > 0;
      if (!succeeded) return null;

      const decision = this.parseDecision(response.text);
      if (!decision) return null;

      // A model naming a project that does not exist is a hallucination:
      // only ids actually present may be updated.
      if (decision.action === "update" && !projects.some((p) => p.id === decision.projectId)) {
        return { ...decision, action: "create", projectId: undefined };
      }
      return decision;
    } catch {
      return null;
    }
  }

  /** Pull the JSON object out of a model reply, tolerating stray prose. */
  private parseDecision(text: string): ProjectDecision | null {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;

    try {
      const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      const action = String(raw.action ?? "").toLowerCase();
      if (!["create", "update", "clarify", "none"].includes(action)) return null;

      const tasks = Array.isArray(raw.tasks)
        ? raw.tasks.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 12)
        : undefined;

      return {
        action: action as ProjectAction,
        projectId: typeof raw.projectId === "string" && raw.projectId.trim() ? raw.projectId.trim() : undefined,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : undefined,
        objective: typeof raw.objective === "string" ? raw.objective.trim().slice(0, 800) : undefined,
        tasks,
        attributes: this.stringMap(raw.attributes),
        resolvedReferences: this.stringMap(raw.resolvedReferences),
        question: typeof raw.question === "string" && raw.question.trim() ? raw.question.trim().slice(0, 300) : undefined,
        execute: raw.execute === true,
        reasoning: typeof raw.reasoning === "string" ? raw.reasoning.trim().slice(0, 400) : undefined,
        fromModel: true,
      };
    } catch {
      return null;
    }
  }

  private stringMap(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string" && item.trim()) out[key] = item.trim().slice(0, 200);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
