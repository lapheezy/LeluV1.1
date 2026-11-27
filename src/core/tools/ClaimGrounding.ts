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
 * Mission 44.7 generalised the same principle to every operational
 * family the registry actually exposes — repository/GitHub, laboratory,
 * engineering studio, runtime, provider health, voice, workspace, memory,
 * browser/research, agents, build/lint/test, deployment, files/artifacts
 * — because a stale laboratory answer was only the first of them.
 *
 * Every claim is classified by the evidence behind it:
 *
 *   · current-turn — a tool ran successfully in this turn (grounded);
 *   · earlier-turn — a real tool result exists earlier in this
 *     conversation (historical, and said to be historical);
 *   · memory       — the sentence itself attributes it to memory;
 *   · inference    — the sentence itself hedges ("I think", "likely");
 *   · unverified   — nothing supports it.
 *
 * Conservative on purpose: it looks for specific outcome claims about
 * specific tools, and ignores lines that are negated or hypothetical
 * ("would have", "not reached", "next step", "if you'd like"). A miss is
 * better than accusing her of something she did.
 */

/** The evidence class behind one claim, as the checker can see it. */
export type ClaimEvidence = "current-turn" | "earlier-turn" | "memory" | "inference" | "unverified";

interface ClaimRule {
  /** The operational family this claim belongs to (reporting and tests). */
  family: string;
  /** Model-facing tool names that substantiate the claim. */
  tools: string[];
  /** What the user is told was not verified. */
  label: string;
  /** An affirmative claim of this tool's result. */
  claim: RegExp;
  /**
   * The claim asserts FRESHNESS ("the result just returned"), not just a
   * result. A trailing "not verified" note is not enough for one of these:
   * the user asked what the state IS, so the reply must not present an old
   * answer as a new check. See freshnessCorrection().
   */
  fresh?: boolean;
}

const RULES: ClaimRule[] = [
  {
    family: "typecheck",
    tools: ["project_validate", "workspace_typecheck"],
    label: "the type-check result",
    claim: /\b(type[- ]?check(?:ed|ing)?|project_validate|tsc)\b[^\n|]*?(?:\|[^\n|]*?)?\b(pass(?:ed|es)?|succeed(?:ed|s)?|exit(?:ed)? (?:code )?0|clean|no errors)\b/i,
  },
  {
    family: "build",
    tools: ["studio.build", "studio_build", "workspace_build"],
    label: "the build result",
    claim: /\b(build|bundle|compil(?:e|ed|ing))\b[^\n|]*?(?:\|[^\n|]*?)?\b(pass(?:ed|es)?|succeed(?:ed|s)?|finish(?:ed)?|complet(?:e|ed)|exit(?:ed)? (?:code )?0|clean|no errors)\b/i,
  },
  {
    family: "tests",
    tools: ["project_validate", "workspace_test", "studio.test", "studio_test"],
    label: "the test results",
    claim: /\b(tests?|test suite)\b[^\n|]*?(?:\|[^\n|]*?)?\b(all )?(pass(?:ed|es|ing)?|green|\d+\/\d+)\b/i,
  },
  {
    family: "lint",
    tools: ["project_validate", "workspace_typecheck", "workspace_build", "studio_build"],
    label: "the lint result",
    claim: /\blint(?:er|ing)?\b[^\n]{0,60}\b(clean|pass(?:ed|es)?|no (?:warnings?|errors?|issues?)|0 (?:warnings?|errors?))\b/i,
  },
  {
    family: "preview",
    tools: ["project_preview", "studio.preview", "studio_preview"],
    label: "the running preview",
    claim: /\b(preview(?: server)?\b[^\n]*?\b(served|running|started|up|live) (?:at|on)\b|served at https?:\/\/127\.0\.0\.1:53\d\d)/i,
  },
  {
    family: "diff",
    tools: ["project_diff"],
    label: "the diff",
    claim: /\b(project_diff\b[^\n]*?\|[^\n]*?\b(reports?|shows?)|the diff (?:reports|shows|contains|confirms))\b/i,
  },
  {
    family: "capture",
    tools: ["browser_capture"],
    label: "the screenshot / layout report",
    claim: /\b(captured|layout report)\b[^\n]*?\b(shows?|flags?|no (?:warning|problem)s?|\d+ problems?)\b/i,
  },
  {
    family: "apply",
    tools: ["project_apply"],
    label: "applying the change to the real project",
    claim: /\bapplied (?:it |the (?:change|fix|edit) )?to the (?:real|main) (?:project|codebase)\b/i,
  },
  {
    // First person, or an object that is a change: a quoted commit SUBJECT or
    // date ("'Record the checkpoint' (committed 2026-11-26T13:39Z)") is an
    // existing git fact, not a claim that this turn made one — measured on a
    // phone in Mission 44.6, where it produced a note that was wrong in the
    // other direction.
    family: "commit",
    tools: ["project_commit", "github_commits"],
    label: "the commit",
    claim:
      /\b(?:(?:i|we) (?:have )?(?:just )?committed\b|created (?:a |the )?commit\b|committed (?:the|this|it|that|these|my|your) (?:change|fix|edit|work|file|files|diff|code)\b)/i,
  },
  {
    // Measured live on a phone (Mission 44.6): asked "which branch were we
    // just talking about, and what is the HEAD commit on it?", the reply
    // opened "From the laboratory repository tool result just returned: the
    // current branch is mission/44-4-recovery-acceptance and the HEAD commit
    // is adaa97a" — two turns stale, from a turn that called no lab tool at
    // all, and true of no branch in this workspace.
    //
    // The tool names are the REGISTRY'S OWN (lab.repository, lab.history, …)
    // as the model sees them (`toolNameForModel` replaces the dot). Mission
    // 44.6 listed five names that no module declares — lab_status, lab_tree,
    // lab_journal, lab_cycle, lab_execute — so a real lab run could not have
    // backed its own claim, and the correction printed tools that do not
    // exist. tests/claim-grounding-families.test.ts now fails if a rule ever
    // names a tool the source does not declare.
    family: "laboratory",
    tools: ["lab_repository", "lab_history", "lab_file", "lab_diff", "lab_verification", "lab_experiment", "lab_preview", "lab_discoveries"],
    label: "a laboratory result you say you just received",
    fresh: true,
    claim:
      /\b(?:tool result (?:i )?just (?:returned|received|got)|just returned (?:from|by) (?:the )?(?:laboratory|lab)\b|from the laboratory (?:repository |status |journal |history |tree )?tool result|just (?:checked|queried|read) (?:the )?(?:repository|lab|journal))\b/i,
  },
  {
    family: "github",
    tools: [
      "github_repos",
      "github_files",
      "github_branches",
      "github_commits",
      "github_prs",
      "project_git",
      "project_commit",
      "repo_status",
      "repo_inspect",
      "lab_repository",
    ],
    label: "the GitHub / repository state",
    claim:
      /\b(?:i )?(?:pushed|pushing) (?:it |that |the (?:commit|branch|change) )?to (?:github|origin|the remote)\b|\b(?:the )?(?:remote|origin)(?: branch)? (?:now )?(?:has|contains|points)\b|\b(?:i )?(?:opened|created) (?:a )?(?:pull request|pr)\b|\bthe (?:repository|repo) (?:is|shows|reports|has)\b[^\n]{0,40}\b(?:clean|up to date|in sync|no (?:changes|uncommitted))\b|\b(?:verified|checked) (?:that )?the (?:branch|commit|remote)\b/i,
  },
  {
    family: "runtime",
    tools: ["project_preview", "studio_preview", "lab_preview", "system_config", "selfdev_analyze"],
    label: "the running server / runtime state",
    claim:
      /\b(?:dev|development|preview) server\b[^\n]{0,40}\b(?:is |it'?s )?(?:running|up|live|listening)\b|\bscheduler (?:is |it'?s )?(?:running|started|active)\b|\b(?:the )?runtime (?:is|looks) (?:healthy|operational|fine)\b/i,
  },
  {
    // "Never present old provider health as current health." A provider's
    // status is cached by the registry and survives restarts, so a sentence
    // about it needs a check behind it in THIS turn.
    family: "provider-health",
    tools: ["system_config", "tools_catalog", "selfdev_analyze", "capability_discover"],
    label: "current provider health",
    claim:
      /\b(?:all |every )?(?:ai )?providers?\b[^\n]{0,50}\b(?:healthy|operational|available|working|responding)\b|\b(?:no|zero) providers? (?:is |are )?(?:failing|cooling|down)\b|\b(?:groq|openrouter|cerebras|mistral|fireworks|gemini|github models) (?:is|are) (?:healthy|operational|available|up)\b/i,
  },
  {
    family: "voice",
    tools: ["device_tts", "device_microphone", "device_camera"],
    label: "the voice / speech result",
    claim:
      /\b(?:i )?transcribed (?:your|the|that) (?:recording|audio|voice|message)\b|\bthe transcription (?:says|reads|is)\b|\b(?:i )?synthesi[sz]ed (?:the |your )?(?:speech|audio|voice)\b|\b(?:the )?(?:voice|tts) (?:sidecar|service|engine) (?:is )?(?:running|up|available|ready)\b/i,
  },
  {
    family: "workspace",
    tools: ["environment_manage_workspace", "environment_save_state", "environment_restore_state", "project_manage"],
    label: "the workspace operation",
    claim: /\b(?:i )?(?:created|switched to|restored|saved) (?:the |your )?workspace\b|\b(?:the )?workspace (?:was |is )?(?:created|restored|saved|switched)\b/i,
  },
  {
    family: "memory",
    tools: ["memory_store", "memory_recall"],
    label: "the memory operation",
    claim:
      /\b(?:i(?:'ve| have)? )?(?:saved|stored|wrote|kept) (?:that|this|it) (?:to|in) (?:my )?memory\b|\b(?:i )?(?:checked|searched|looked in) (?:my )?memory\b/i,
  },
  {
    family: "research",
    tools: ["research_web", "browser_read"],
    label: "the page you say you read",
    claim:
      /\b(?:i )?(?:read|opened|fetched) (?:the |that |this )?(?:page|site|article)\b|\bthe (?:page|site|article) (?:says|states|shows|reports)\b|\bsearch results (?:show|indicate|say)\b|\b(?:i )?searched the web\b/i,
  },
  {
    family: "agents",
    tools: ["agent_delegate", "agent_status", "agent_resume", "task_start", "task_status", "task_resume"],
    label: "the agent / task run",
    claim:
      /\b(?:the )?agent (?:has )?(?:finished|completed|executed|ran|is running)\b|\b(?:i )?(?:delegated|dispatched) (?:this|it|the (?:task|work|job))\b|\bthe (?:task|job) (?:is )?(?:running|queued|completed|done)\b/i,
  },
  {
    family: "deployment",
    tools: ["studio_deploy", "github_auth", "system_config"],
    label: "the deployment / integration status",
    claim:
      /\b(?:deployed|published) (?:it|this|the (?:app|site|build|preview))\b|\b(?:it|the (?:app|site)) (?:is|went|now) (?:live|deployed|published)\b|\b(?:supabase|database|integration) (?:is )?(?:connected|linked|set up|configured)\b/i,
  },
  {
    family: "files",
    tools: [
      "project_write",
      "project_edit",
      "project_apply",
      "project_copy",
      "project_delete",
      "artifact_create",
      "artifact_edit",
      "sandbox_write",
      "studio_write",
      "studio_create",
    ],
    label: "the file or artifact change",
    claim:
      /\b(?:i )?(?:created|wrote|edited|updated|added|deleted) (?:the |a |your )?(?:file|artifact|component|module|page|document)\b|\bthe file (?:now )?(?:contains|has|includes)\b/i,
  },
];

/**
 * The family/tool coverage of the rule table, for tests and diagnostics.
 * Deliberately read-only: a rule's regex is not an API.
 */
export const CLAIM_FAMILIES: ReadonlyArray<{ family: string; label: string; tools: readonly string[] }> =
  RULES.map((rule) => ({ family: rule.family, label: rule.label, tools: rule.tools }));

/** Language that asserts the result is from THIS turn. */
const FRESH_LANGUAGE =
  /\b(?:just (?:now )?(?:returned|checked|ran|queried|verified|confirmed|read)|just returned|just now|right now|as of (?:now|this (?:turn|moment))|this turn'?s? (?:result|check)|freshly)\b/i;

/** The sentence itself attributes the claim to persisted memory. */
const MEMORY_MARKER = /\b(?:from (?:my )?memory|in (?:my |persisted )?memory|i remember (?:that )?|as i recall(?:ed)? from memory)\b/i;

/** The sentence itself hedges: an inference, not a measurement. */
const INFERENCE_MARKER =
  /\b(?:i (?:think|believe|suspect|assume)|probably|likely|presumably|as far as i know|my guess|it seems|it looks like|appears to)\b/i;

/** Lines that describe what did NOT happen, or what could happen. */
const NOT_A_CLAIM = /\b(would have|not reached|wasn[’']?t|was not|didn[’']?t|did not|couldn[’']?t|could not|never|unable|not run|no\s+(?:run|change|edit)|nothing (?:was|to)|next steps?|if you[’']?d like|i can|i will|i[’']?ll|will run|to do|remains?|pending|planned|should)\b|\byou (?:pasted|sent|shared|gave|provided)\b/i;

/** A tool result that already exists earlier in this conversation. */
export interface EarlierToolRun {
  tool: string;
  /** When it ran, when the conversation carries a timestamp. */
  at?: number;
}

export interface UngroundedClaim {
  family: string;
  label: string;
  tools: string[];
  line: string;
  /** Where the claim's support actually comes from. */
  evidence: ClaimEvidence;
  /** The claim asserts the result is fresh — see ClaimRule.fresh. */
  fresh?: boolean;
}

/**
 * Affirmative claims in `reply` about results of tools that did not run
 * successfully in this turn. `executed` are the model-facing tool names
 * that ran, with their outcome; `earlierRuns` are tool results already in
 * the conversation (a real check, from an earlier turn).
 */
export function ungroundedClaims(
  reply: string,
  executed: ReadonlyArray<{ tool: string; ok: boolean }>,
  earlierRuns: ReadonlyArray<EarlierToolRun> = [],
): UngroundedClaim[] {
  const ran = new Set(executed.filter((entry) => entry.ok).map((entry) => entry.tool));
  const earlier = new Map<string, EarlierToolRun>();
  for (const run of earlierRuns) if (!earlier.has(run.tool)) earlier.set(run.tool, run);
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
      if (!rule.claim.test(line)) continue;
      // A earlier real result is evidence of something — just not of NOW.
      const historical = rule.tools.some((tool) => earlier.has(tool));
      const evidence: ClaimEvidence = INFERENCE_MARKER.test(line)
        ? "inference"
        : MEMORY_MARKER.test(line)
          ? "memory"
          : historical
            ? "earlier-turn"
            : "unverified";
      found.set(rule.label, {
        family: rule.family,
        label: rule.label,
        tools: rule.tools,
        line: line.slice(0, 200),
        evidence,
        ...(rule.fresh || FRESH_LANGUAGE.test(line) ? { fresh: true } : {}),
      });
    }
  }
  return [...found.values()];
}

/** How many claims fall into each evidence class (for reply metadata). */
export function claimEvidenceCounts(claims: readonly UngroundedClaim[]): Partial<Record<ClaimEvidence, number>> {
  const counts: Partial<Record<ClaimEvidence, number>> = {};
  for (const claim of claims) counts[claim.evidence] = (counts[claim.evidence] ?? 0) + 1;
  return counts;
}

/** A short, human age for an earlier run ("about 3 minutes ago"). */
function ageText(at: number | undefined, now: number): string {
  if (typeof at !== "number" || !Number.isFinite(at) || at > now) return "";
  const seconds = Math.max(1, Math.round((now - at) / 1000));
  if (seconds < 90) return `about ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minutes ago`;
  return `about ${Math.round(minutes / 60)} hours ago`;
}

/**
 * What a reply must say BEFORE itself when it claims a fresh result that no
 * tool in this turn produced.
 *
 * The trailing grounding note is a footnote; for a freshness claim the wrong
 * part is the answer, and a reader who stops at the first sentence has already
 * been misled. So the correction leads, names the tools that did not run, and
 * says what the text below actually is (recall, not a check).
 */
/**
 * The rule table names a tool by every alias that can substantiate it
 * (`studio.build` and `studio_build` are the same tool). The reader gets one
 * model-facing name per tool, in the order the rules declare them.
 */
function uniqueTools(claims: readonly UngroundedClaim[]): string[] {
  return [...new Set(claims.flatMap((claim) => claim.tools.map((tool) => tool.replace(/\./g, "_"))))];
}

export function freshnessCorrection(
  claims: readonly UngroundedClaim[],
  options: { now?: number; earlierRuns?: ReadonlyArray<EarlierToolRun> } = {},
): string {
  const fresh = claims.filter((claim) => claim.fresh && claim.evidence !== "current-turn");
  if (fresh.length === 0) return "";
  const tools = uniqueTools(fresh).slice(0, 4).join(", ");
  const historical = fresh.some((claim) => claim.evidence === "earlier-turn");
  const age = historical
    ? ageText(
        Math.max(0, ...(options.earlierRuns ?? []).map((run) => run.at ?? 0)),
        options.now ?? Date.now(),
      )
    : "";
  return (
    `⚠️ Nothing was checked in this turn — no tool ran (${tools} did not run), so the ` +
    "statement below is recalled from earlier in this conversation, not the current state. " +
    (historical && age ? `The last real result in this conversation is ${age}. ` : "") +
    "Ask again and I'll look it up.\n\n"
  );
}

/** The note a reply carries when it claims results no tool produced. */
export function groundingNote(claims: readonly UngroundedClaim[]): string {
  const unverified = claims.filter((claim) => claim.evidence === "unverified");
  const historical = claims.filter((claim) => claim.evidence === "earlier-turn");
  const parts: string[] = [];
  if (unverified.length > 0) {
    const what = unverified.map((claim) => claim.label).join(", ");
    const tools = uniqueTools(unverified).join(" / ");
    parts.push(
      `\n\n⚠️ Not verified: this reply describes ${what}, but ${tools} did not run successfully in this turn. ` +
        "Treat those statements as unconfirmed.",
    );
  }
  if (historical.length > 0) {
    const what = historical.map((claim) => claim.label).join(", ");
    const tools = uniqueTools(historical).join(" / ");
    parts.push(
      `\n\n⚠️ History, not a fresh check: this reply describes ${what}, supported by an earlier ${tools} result ` +
        "in this conversation. Nothing re-checked it in this turn.",
    );
  }
  return parts.join("");
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
  const plain = reply.replace(/[‐-―−]/g, "-").replace(/[  ]/g, " ");
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
