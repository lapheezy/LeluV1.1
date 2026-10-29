/**
 * ==========================================================
 * LÉLU — A CLAIMED RESULT MUST HAVE A TOOL BEHIND IT
 *
 * Measured in the self-improvement acceptance run: LÉLU's reply carried
 * a table saying the type-check "Passed (exit 0)", the preview was
 * "served at http://127.0.0.1:5310", the preview capture showed the fix
 * and "the diff reports a single change" — and the recorded tool calls
 * for that turn contain no project_validate, no project_preview and no
 * project_diff. The evidence was written, not produced.
 *
 * This compares what a reply CLAIMS a tool produced with what actually
 * ran in the turn (ProviderResolver's own record). An affirmative claim
 * with no successful run of that tool behind it is reported, and the
 * reply carries a visible "not verified" note — the user sees it, and so
 * does anyone checking her work.
 *
 * Conservative on purpose: it looks for specific outcome claims about
 * specific tools, and ignores lines that are negated or hypothetical
 * ("would have", "not reached", "next step", "if you'd like"). A miss is
 * better than accusing her of something she did.
 * ==========================================================
 */

interface ClaimRule {
  /** Model-facing tool names that substantiate the claim. */
  tools: string[];
  /** What the user is told was not verified. */
  label: string;
  /** An affirmative claim of this tool's result. */
  claim: RegExp;
}

const RULES: ClaimRule[] = [
  {
    tools: ["project_validate", "workspace_typecheck"],
    label: "the type-check result",
    claim: /\b(type[- ]?check(?:ed|ing)?|project_validate|tsc)\b[^\n|]*?(?:\|[^\n|]*?)?\b(pass(?:ed|es)?|succeed(?:ed|s)?|exit(?:ed)? (?:code )?0|clean|no errors)\b/i,
  },
  {
    tools: ["project_validate", "workspace_test"],
    label: "the test results",
    claim: /\b(tests?|test suite)\b[^\n|]*?(?:\|[^\n|]*?)?\b(all )?(pass(?:ed|es|ing)?|green|\d+\/\d+)\b/i,
  },
  {
    tools: ["project_preview"],
    label: "the running preview",
    claim: /\b(preview(?: server)?\b[^\n]*?\b(served|running|started|up) at|served at https?:\/\/127\.0\.0\.1:53\d\d)/i,
  },
  {
    tools: ["project_diff"],
    label: "the diff",
    claim: /\b(project_diff\b[^\n]*?\|[^\n]*?\b(reports?|shows?)|the diff (?:reports|shows|contains|confirms))\b/i,
  },
  {
    tools: ["browser_capture"],
    label: "the screenshot / layout report",
    claim: /\b(captured|layout report)\b[^\n]*?\b(shows?|flags?|no (?:warning|problem)s?|\d+ problems?)\b/i,
  },
  {
    tools: ["project_apply"],
    label: "applying the change to the real project",
    claim: /\bapplied (?:it |the (?:change|fix|edit) )?to the (?:real|main) (?:project|codebase)\b/i,
  },
  {
    tools: ["project_commit", "github_commits"],
    label: "the commit",
    claim: /\b(committed|created (?:a |the )?commit)\b/i,
  },
];

/** Lines that describe what did NOT happen, or what could happen. */
const NOT_A_CLAIM = /\b(would have|not reached|wasn[’']?t|was not|didn[’']?t|did not|couldn[’']?t|could not|never|unable|not run|no\s+(?:run|change|edit)|nothing (?:was|to)|next steps?|if you[’']?d like|i can|i will|i[’']ll|will run|to do|remains?|pending|planned|should)\b/i;

export interface UngroundedClaim {
  label: string;
  tools: string[];
  line: string;
}

/**
 * Affirmative claims in `reply` about results of tools that did not run
 * successfully in this turn. `executed` are the model-facing tool names
 * that ran, with their outcome.
 */
export function ungroundedClaims(reply: string, executed: ReadonlyArray<{ tool: string; ok: boolean }>): UngroundedClaim[] {
  const ran = new Set(executed.filter((entry) => entry.ok).map((entry) => entry.tool));
  const found = new Map<string, UngroundedClaim>();
  // Models write typographic text: "type‑check" with a non-breaking
  // hyphen, "exit 0" with a narrow no-break space (both in the run).
  const plain = reply.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u00a0\u2007\u2009\u202f]/g, " ");
  for (const raw of plain.split(/\n+/)) {
    const line = raw.trim();
    if (!line || NOT_A_CLAIM.test(line)) continue;
    for (const rule of RULES) {
      if (found.has(rule.label)) continue;
      if (rule.tools.some((tool) => ran.has(tool))) continue;
      if (rule.claim.test(line)) found.set(rule.label, { label: rule.label, tools: rule.tools, line: line.slice(0, 200) });
    }
  }
  return [...found.values()];
}

/** The note a reply carries when it claims results no tool produced. */
export function groundingNote(claims: readonly UngroundedClaim[]): string {
  if (claims.length === 0) return "";
  const what = claims.map((claim) => claim.label).join(", ");
  const tools = [...new Set(claims.flatMap((claim) => claim.tools))].join(" / ");
  return (
    `\n\n⚠️ Not verified: this reply describes ${what}, but ${tools} did not run successfully in this turn. ` +
    "Treat those statements as unconfirmed."
  );
}
