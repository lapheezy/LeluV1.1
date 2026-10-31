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

/* ----------------- a claimed result must match what was measured ----------------- */

/** The latest measurement of one capture target under one set of conditions. */
export interface MeasuredCapture {
  target: "app" | "preview" | "url";
  conditions: string;
  /** Every problem seen in any load of the page. */
  problems: number;
  /** Those seen in every load (the rest depend on the app's state at load). */
  stableProblems?: number;
}

export interface ContradictedClaim {
  line: string;
  target: "app" | "preview";
  claimed: number;
  measured: MeasuredCapture[];
}

const COUNT_CLAIM = /\b(no|zero|\d+)\s+(?:layout\s+)?(?:problems?|warnings?|findings?|issues?)\b/gi;
const PREVIEW_WORDS = /\b(preview|sandbox|workspace copy|after (?:the |my )?(?:edit|fix|change))\b/i;
const APP_WORDS = /\b(live app|original|your app|my app|own app|before)\b/i;

/**
 * Lines where a reply states how many problems a capture of the preview
 * or the app showed, and no capture of that target measured that number.
 *
 * Measured in self-improvement run 15: the captures LÉLU ran read 10 (app)
 * and 9 (preview); her verdict table said the preview, and "the live app
 * after edit", showed "0 problems" — "the expected outcome is met". Every
 * tool had run, so a check on whether tools ran saw nothing wrong; the
 * numbers were simply not the ones measured.
 *
 * Conservative: lines that are negated or hypothetical are skipped, and so
 * is a line naming both targets with more than one count (ambiguous).
 */
export function contradictedCaptureClaims(reply: string, captures: readonly MeasuredCapture[]): ContradictedClaim[] {
  const plain = reply.replace(/[‐-―−]/g, "-").replace(/[    ]/g, " ");
  const found: ContradictedClaim[] = [];
  for (const raw of plain.split(/\n+/)) {
    const line = raw.trim();
    if (!line || NOT_A_CLAIM.test(line)) continue;
    const counts = [...line.matchAll(COUNT_CLAIM)].map((match) => (/^(no|zero)$/i.test(match[1]) ? 0 : Number(match[1])));
    if (counts.length === 0) continue;
    const mentionsPreview = PREVIEW_WORDS.test(line);
    const mentionsApp = APP_WORDS.test(line);
    if (mentionsPreview && mentionsApp && counts.length > 1) continue;
    const target = mentionsPreview ? "preview" : mentionsApp ? "app" : null;
    if (!target) continue;
    let measured = captures.filter((capture) => capture.target === target);
    // A line naming a panel or viewport is about captures under THOSE
    // conditions: run 15's "Preview … | phone | Avatar | 0 problems" is not
    // borne out by a 0 measured with no panel open.
    for (const pattern of [/panel (\w+)/, /^(\w+)/]) {
      const named = [...new Set(measured.map((capture) => pattern.exec(capture.conditions)?.[1]).filter((name): name is string => Boolean(name)))]
        .filter((name) => new RegExp(`\\b${name}\\b`, "i").test(line));
      if (named.length) measured = measured.filter((capture) => named.includes(pattern.exec(capture.conditions)?.[1] ?? ""));
    }
    if (measured.length === 0) continue;
    for (const claimed of counts) {
      if (!measured.some((capture) => capture.problems === claimed || capture.stableProblems === claimed)) {
        found.push({ line: line.slice(0, 200), target, claimed, measured });
        break;
      }
    }
  }
  return found;
}

/** The note a reply carries when its numbers are not the measured ones. */
export function contradictionNote(claims: readonly ContradictedClaim[]): string {
  if (claims.length === 0) return "";
  const first = claims[0];
  const measured = first.measured.map((capture) => `${capture.problems} at ${capture.conditions}`).join("; ");
  return (
    `\n\n⚠️ Contradicted by measurement: this reply says the ${first.target === "preview" ? "preview" : "app"} showed ` +
    `${first.claimed} problem(s), but the latest capture${first.measured.length > 1 ? "s" : ""} of it measured ${measured}.` +
    `${claims.length > 1 ? ` (${claims.length} such statements.)` : ""} Treat those numbers, and any verdict resting on them, as wrong.`
  );
}
