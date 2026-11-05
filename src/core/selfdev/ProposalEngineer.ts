/**
 * ==========================================================
 * LÉLU
 * PROPOSAL ENGINEER — turns an approved proposal into code
 *
 * The step the self-development loop was missing. develop() used
 * to run syntax and tests on the sandbox exactly as it was, so a
 * proposal reached "Ready" without a line written for it. This
 * module produces the change:
 *
 *   1. select   — the model picks the relevant source and test
 *                 files from the REAL tree (paths it cannot invent:
 *                 anything not in the listing is dropped)
 *   2. inspect  — those files are read from the isolated copy
 *   3. implement — the model returns a plan and exact
 *                 search/replace edits (or new files)
 *   4. validate — every search must match exactly once; edits may
 *                 only touch inspected files or create new files
 *                 under src/ or tests/
 *
 * It generates and validates; it never writes. The loop stages the
 * result in the workspace copy and runs the checks. The model is
 * reached through AIService.reason — the same provider chain as the
 * rest of LÉLU — and the provider/model that actually answered is
 * reported, not assumed.
 * ==========================================================
 */

import AIService from "../AIService";
import type { ImprovementProposal } from "./ImprovementQueue";

export interface GeneratedFile {
  path: string;
  content: string;
  created: boolean;
}

export interface GenerationResult {
  ok: boolean;
  error?: string;
  /** "provider/model" of the response that produced the change. */
  agent?: string;
  plan?: string;
  filesInspected: string[];
  files: GeneratedFile[];
  /** Existing or newly created test files relevant to the change. */
  tests: string[];
}

/** How the loop gives this module access to the copy, without coupling it to the transport. */
export interface ProposalSourceAccess {
  /** Project-relative source paths the model may choose from. */
  listSources(): Promise<string[]>;
  /** Project-relative test files (tests/*.test.ts[x]). */
  listTests(): Promise<string[]>;
  read(path: string): Promise<string | null>;
}

type Reason = (prompt: string, options: { system?: string; maxTokens?: number; temperature?: number }) => Promise<{
  text: string;
  provider?: string;
  model?: string;
}>;

const MAX_FILES = 6;
const MAX_TESTS = 4;
const MAX_FILE_CHARS = 60_000;
const NEW_FILE_PATTERN = /^(src|tests)\/[A-Za-z0-9_./-]+\.(ts|tsx)$/;

const SYSTEM = [
  "You are LÉLU's engineering agent, working on LÉLU's own TypeScript/React codebase.",
  "You implement ONE approved improvement proposal as a small, concrete, reviewable change.",
  "Make the smallest change that genuinely advances the proposal. Preserve all unrelated code.",
  "Never invent files, APIs or imports that are not shown to you, except new files you create.",
  "Answer with ONE JSON object and nothing else.",
].join(" ");

export function normalizePath(path: string): string {
  return path.trim().replace(/^\.?\/+/, "");
}

/** The first balanced JSON object in a model reply (fenced or bare). */
export function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < body.length; index += 1) {
    const char = body[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(body.slice(start, index + 1)) as unknown;
          return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface RawEdit {
  path?: unknown;
  search?: unknown;
  replace?: unknown;
  create?: unknown;
}

/**
 * Apply the model's edits to the inspected contents. Pure: returns the
 * resulting files, or the first reason the edit set is unusable.
 */
export function applyEdits(
  originals: Record<string, string>,
  edits: RawEdit[],
): { ok: true; files: GeneratedFile[] } | { ok: false; error: string } {
  const working: Record<string, string> = { ...originals };
  const created = new Set<string>();
  const touched = new Set<string>();
  for (const [index, edit] of edits.entries()) {
    const path = typeof edit.path === "string" ? normalizePath(edit.path) : "";
    if (!path) return { ok: false, error: `Edit ${index + 1} has no path.` };
    if (typeof edit.create === "string") {
      if (path in originals) return { ok: false, error: `Edit ${index + 1} would replace the whole existing file ${path}; existing files take search/replace edits.` };
      if (!NEW_FILE_PATTERN.test(path) || path.split("/").includes("..")) {
        return { ok: false, error: `Edit ${index + 1} creates ${path}, outside src/ or tests/ or not a .ts/.tsx file.` };
      }
      working[path] = edit.create;
      created.add(path);
      touched.add(path);
      continue;
    }
    if (!(path in working)) return { ok: false, error: `Edit ${index + 1} targets ${path}, which was not inspected.` };
    if (typeof edit.search !== "string" || typeof edit.replace !== "string" || edit.search.length === 0) {
      return { ok: false, error: `Edit ${index + 1} on ${path} needs non-empty "search" and a "replace" string.` };
    }
    const occurrences = working[path].split(edit.search).length - 1;
    if (occurrences !== 1) {
      return {
        ok: false,
        error: `Edit ${index + 1} on ${path}: the search text matches ${occurrences} times (it must match exactly once).`,
      };
    }
    working[path] = working[path].replace(edit.search, () => edit.replace as string);
    touched.add(path);
  }
  const files = [...touched]
    .filter((path) => created.has(path) || working[path] !== originals[path])
    .map((path) => ({ path, content: working[path], created: created.has(path) }));
  return { ok: true, files };
}

function describeProposal(proposal: ImprovementProposal): string {
  return [
    `Title: ${proposal.title}`,
    `Problem: ${proposal.problem}`,
    `Observation: ${proposal.observation}`,
    `Evidence: ${proposal.evidence}`,
    `Proposed solution: ${proposal.proposedSolution}`,
    `Expected benefit: ${proposal.expectedBenefit}`,
    proposal.capabilityId ? `Target capability id: ${proposal.capabilityId}` : "",
    `Test plan: ${proposal.testPlan}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(normalizePath) : [];
}

export default class ProposalEngineer {
  constructor(
    private readonly reason: Reason = (prompt, options) => AIService.getInstance().reason(prompt, options),
  ) {}

  public async generate(
    proposal: ImprovementProposal,
    source: ProposalSourceAccess,
    progress: (label: string) => void = () => undefined,
  ): Promise<GenerationResult> {
    const empty = (error: string, extra: Partial<GenerationResult> = {}): GenerationResult => ({
      ok: false,
      error,
      filesInspected: [],
      files: [],
      tests: [],
      ...extra,
    });

    /* 1. select ------------------------------------------------------- */
    progress("Listing the project's real source and test files");
    const [sources, tests] = await Promise.all([source.listSources(), source.listTests()]);
    if (sources.length === 0) return empty("The project's source listing was empty — nothing to inspect.");
    const known = new Set(sources);
    const knownTests = new Set(tests);

    progress("Choosing the files this change needs");
    const selection = await this.reason(
      [
        "Pick the files to inspect for this approved proposal.",
        "",
        describeProposal(proposal),
        "",
        `Source files (choose up to ${MAX_FILES}):`,
        sources.join("\n"),
        "",
        `Test files (choose up to ${MAX_TESTS} that exercise the chosen sources; may be none):`,
        tests.join("\n") || "(none)",
        "",
        'Reply as JSON: {"files": ["path", ...], "tests": ["tests/x.test.ts", ...], "why": "one sentence"}',
      ].join("\n"),
      { system: SYSTEM, maxTokens: 800, temperature: 0 },
    );
    const picked = extractJson(selection.text ?? "");
    if (!picked) return empty(`The model did not return a file selection (${selection.provider ?? "no provider"}).`);
    const chosen = strings(picked.files).filter((path) => known.has(path)).slice(0, MAX_FILES);
    const chosenTests = strings(picked.tests).filter((path) => knownTests.has(path)).slice(0, MAX_TESTS);
    if (chosen.length === 0) {
      return empty("The model chose no file that exists in the project, so there is nothing to change.");
    }

    /* 2. inspect ------------------------------------------------------ */
    const originals: Record<string, string> = {};
    for (const path of chosen) {
      progress(`Reading ${path}`);
      const content = await source.read(path);
      if (content !== null && content.length <= MAX_FILE_CHARS) originals[path] = content;
    }
    const filesInspected = Object.keys(originals);
    if (filesInspected.length === 0) {
      return empty("None of the chosen files could be read from the workspace copy.", { filesInspected });
    }

    /* 3. implement ---------------------------------------------------- */
    progress(`Writing the change (${filesInspected.length} file(s) in context)`);
    const implementation = await this.reason(
      [
        "Implement this approved proposal.",
        "",
        describeProposal(proposal),
        "",
        "Files (exact current content):",
        ...filesInspected.map((path) => `\n=== ${path} ===\n${originals[path]}`),
        "",
        chosenTests.length ? `Relevant existing tests: ${chosenTests.join(", ")}` : "No existing test was identified.",
        "",
        "Rules:",
        "- Edit existing files ONLY with search/replace: `search` is an exact, unique snippet of the current file (include enough lines to be unique); `replace` is its new text.",
        "- New files: {\"path\": \"src/...ts\" or \"tests/...test.ts\", \"create\": \"full content\"}.",
        "- Add or extend a node:test test under tests/ that checks the change when that is feasible (import from ../src/...).",
        "- Keep the change small and self-contained; it must typecheck.",
        "",
        'Reply as JSON: {"plan": "what you change and why, 2-5 sentences", "edits": [{"path": "...", "search": "...", "replace": "..."} or {"path": "...", "create": "..."}], "tests": ["tests/..."]}',
      ].join("\n"),
      { system: SYSTEM, maxTokens: 8000, temperature: 0 },
    );
    const agent = `${implementation.provider ?? "unknown"}/${implementation.model ?? "unknown"}`;
    const answer = extractJson(implementation.text ?? "");
    if (!answer) {
      return empty(`The model (${agent}) did not return a usable JSON change.`, { agent, filesInspected, tests: chosenTests });
    }
    const plan = typeof answer.plan === "string" ? answer.plan : "";
    const edits = Array.isArray(answer.edits) ? (answer.edits as RawEdit[]) : [];
    if (edits.length === 0) {
      return empty(`The model (${agent}) proposed no edits.`, { agent, plan, filesInspected, tests: chosenTests });
    }

    /* 4. validate ----------------------------------------------------- */
    const applied = applyEdits(originals, edits);
    if (!applied.ok) {
      return empty(`The generated edits are unusable: ${applied.error}`, { agent, plan, filesInspected, tests: chosenTests });
    }
    if (applied.files.length === 0) {
      return empty(`The generated edits change nothing (${agent}).`, { agent, plan, filesInspected, tests: chosenTests });
    }
    const newTests = applied.files
      .filter((file) => file.created && /^tests\/[A-Za-z0-9_.-]+\.test\.tsx?$/.test(file.path))
      .map((file) => file.path);
    const relevantTests = [...new Set([...chosenTests, ...strings(answer.tests).filter((path) => knownTests.has(path)), ...newTests])];

    return { ok: true, agent, plan, filesInspected, files: applied.files, tests: relevantTests };
  }
}
