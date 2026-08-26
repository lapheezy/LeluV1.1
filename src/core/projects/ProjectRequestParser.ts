/**
 * ==========================================================
 * LÉLU
 * PROJECT REQUEST PARSER
 *
 * Turns the user's full instruction into the structured
 * project record. The complete instruction is ALWAYS
 * preserved verbatim in `originalRequest` — never truncated.
 * `objective` keeps the full instruction text too, so the
 * cognition/runtime can act on the real request, not a
 * keyword fragment.
 * ==========================================================
 */

export interface ParsedProjectRequest {
  /** Short, human-readable title (derived, never the source of truth). */
  name: string;
  /** The user's complete instruction, verbatim. */
  originalRequest: string;
  /** The full instruction after the project trigger, intact. */
  objective: string;
  /** Context captured at creation time. */
  context: string;
  /** Concrete tasks derived from the instruction. */
  actionableTasks: string[];
  priority: "P0" | "P1" | "P2";
  /** Subsystem this project targets. */
  location: string;
  /** Ordered execution plan. */
  executionPlan: string[];
}

const TRIGGER =
  /\b(?:start|create|build|make|set up|open|begin|launch)\s+(?:a\s+|an\s+)?project\s+(?:to|that|which|for|about|on|around|in|inside)\s+/i;

const FILLER_PREFIX =
  /^(?:please\s+)?(?:i\s+(?:want|need|would like|'d like)\s+(?:you\s+)?(?:to\s+)?|can\s+you\s+|could\s+you\s+|help\s+me\s+)/i;

const META_SENTENCES =
  /\b(?:you\s+have\s+access\s+to|you\s+can\s+work\s+on|feel\s+free\s+to|you\s+may|i\s+give\s+you\s+permission|go\s+ahead\s+and)\b/i;

/** Sentence-level separators — used to derive a readable title. */
const CLAUSE_SPLIT =
  /\s+(?:and\s+then|then|after\s+that|also|plus|meanwhile)\s+|\.\s+|;\s+|,\s+and\s+/i;

/** Task-level separators — also splits plain " and " so each task is atomic. */
const TASK_SPLIT =
  /\s+and\s+then\s+|\s+and\s+|\s+then\s+|\s+after\s+that\s+|\s+also\s+|\s+plus\s+|\s+meanwhile\s+|\.\s+|;\s+/i;

function sentenceCase(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function titleCaseWords(words: string[]): string {
  const lower = new Set(["a", "an", "and", "or", "the", "of", "to", "for", "in", "on", "with"]);
  return words
    .map((word, index) => {
      if (index > 0 && lower.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export default class ProjectRequestParser {
  /**
   * Parse the full prompt. The complete instruction is preserved
   * verbatim; every derived field keeps the real meaning of the
   * request instead of a truncated keyword fragment.
   */
  public parse(prompt: string): ParsedProjectRequest {
    const originalRequest = prompt.trim();
    const instruction = this.extractInstruction(originalRequest);
    const objective = this.cleanObjective(instruction) || this.cleanObjective(originalRequest);

    return {
      name: this.deriveName(objective) || "My Project",
      originalRequest,
      objective,
      context: "",
      actionableTasks: this.deriveTasks(objective),
      priority: this.derivePriority(objective),
      location: this.deriveLocation(objective),
      executionPlan: this.defaultExecutionPlan(),
    };
  }

  /** The instruction after the project trigger — full, not truncated. */
  private extractInstruction(prompt: string): string {
    const match = prompt.match(TRIGGER);
    if (match && match.index !== undefined) {
      const after = prompt.slice(match.index + match[0].length).trim();
      if (after.length > 0) {
        return after;
      }
    }
    // Fallback: everything after the word "project" when the phrasing
    // doesn't match the trigger regex ("new project: upgrade the UI").
    const projectIndex = prompt.search(/\bproject\b/i);
    if (projectIndex !== -1) {
      const tail = prompt.slice(projectIndex + "project".length).replace(/^[\s:,-]+/, "").trim();
      if (tail.length >= 4) {
        return tail;
      }
    }
    return prompt;
  }

  private cleanObjective(instruction: string): string {
    return sentenceCase(instruction.replace(FILLER_PREFIX, "").trim()).slice(0, 800);
  }

  /** Short title from the first meaningful clause — readable, never mid-word. */
  private deriveName(objective: string): string {
    const firstClause = objective
      .split(CLAUSE_SPLIT)[0]
      .replace(/^[^a-z0-9]+/i, "")
      .replace(/[^a-z0-9]+$/i, "")
      .trim();
    if (!firstClause) {
      return "My Project";
    }
    const words = firstClause
      .split(/\s+/)
      .filter((word) => /^[a-z0-9]+$/i.test(word))
      .slice(0, 6);
    if (words.length === 0) {
      return "My Project";
    }
    return titleCaseWords(words);
  }

  private deriveTasks(objective: string): string[] {
    const chunks = objective
      .split(TASK_SPLIT)
      .map((chunk) => chunk.replace(META_SENTENCES, "").trim())
      .map((chunk) => chunk.replace(/^[^a-z0-9]+/i, "").trim())
      .filter((chunk) => chunk.length >= 4)
      .map((chunk) => (chunk.endsWith(".") ? chunk.slice(0, -1) : chunk))
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1));
    return chunks.slice(0, 8);
  }

  private derivePriority(objective: string): "P0" | "P1" | "P2" {
    if (/\b(?:urgent|asap|immediately|right now|critical|top priority)\b/i.test(objective)) {
      return "P0";
    }
    if (/\b(?:eventually|whenever|someday|later|if you have time)\b/i.test(objective)) {
      return "P2";
    }
    return "P1";
  }

  private deriveLocation(objective: string): string {
    // Sandbox/execution targets take precedence: "start the project in
    // Sandbox and use my avatar" is a sandbox execution command, not a
    // pure avatar cosmetic task. Only when the request actually asks for
    // execution — "research sandbox games" stays a research topic.
    if (
      /\b(?:sandbox|workspace)\b/i.test(objective) &&
      /\b(?:start|build|create|make|execute|run|work on|implement|develop|write|code|render|simulat|animat|full ?screen|use)\b/i.test(objective)
    ) {
      return "sandbox";
    }
    if (/\b(?:avatar|portrait|embodi|appearance|reference image)\b/i.test(objective)) return "avatar";
    if (/\b(?:ui|interface|user interface|visual|panel|layout|composer|chat box|window|screen)\b/i.test(objective)) return "ui";
    if (/\b(?:memory|remember|recall)\b/i.test(objective)) return "memory";
    if (/\b(?:news|headline|current events|breaking)\b/i.test(objective)) return "news";
    if (/\b(?:agent|executive|forge|delegate)\b/i.test(objective)) return "agents";
    if (/\b(?:cosmos|scene|3d|planet|galaxy|render|world)\b/i.test(objective)) return "cosmos";
    if (/\b(?:api|provider|integration|tool)\b/i.test(objective)) return "api";
    if (/\b(?:code|bug|fix|test|build|feature|refactor)\b/i.test(objective)) return "engineering";
    return "general";
  }

  private defaultExecutionPlan(): string[] {
    return [
      "Understand the objective and recall relevant memory",
      "Consult the executive board for the execution plan",
      "Select and execute the applicable tools and APIs",
      "Validate the results and update project state",
      "Remember the outcome and report back to you",
    ];
  }
}
