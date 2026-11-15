/**
 * ==========================================================
 * LÉLU — the context a tool-loop CONTINUATION round needs
 *
 * Round 0 of a tool turn carries LÉLU's full self-state ("Memory context":
 * executive state, self state, capabilities, agents, projects, workflows,
 * autonomous cognition…) so the model can decide what to do. Measured on a
 * real 3D world-building turn: that block was 12.5 KB of a ~25 KB request
 * and was re-sent unchanged on every one of five rounds, while the task
 * itself (question + tool calls + results) was under 2.3 KB. Against Groq's
 * 8,000 tokens/minute per key, that repetition — not the work — is what
 * exhausted capacity.
 *
 * A continuation round is mid-job: it reads tool results and decides the
 * next call or the answer. It keeps everything EXCEPT the known
 * self-description sections below. Unrecognized sections are always kept
 * (live research, spending notes, cross-chat references), as are the
 * safety-relevant ones (executive state, actions requiring confirmation,
 * autonomy level, the current thread). Round 0 is untouched.
 * ==========================================================
 */

/** Self-description sections that do not change what the next tool call or the answer should be. */
const DROP_ON_CONTINUATION = [
  /^LÉLU SELF STATE\b/i,
  /^CAPABILITY STATUS\b/i,
  /^VISUAL OBSERVATION\b/i,
  /^VISUAL WORKSPACE\b/i,
  /^YOUR CONFIGURATION\b/i,
  /^AVAILABLE WORKFLOWS\b/i,
  /^WORKFLOW ACTIVITY\b/i,
  /^YOUR OWN AUTONOMOUS WORK\b/i,
  /^PENDING SELF-IMPROVEMENTS\b/i,
  /^RECENT EXECUTION EVENTS\b/i,
  /^LÉLU AUTONOMOUS COGNITION\b/i,
  /^ACTIVE AGENTS\b/i,
  /^ACTIVE PROJECTS\b/i,
  /^STUDIO PROJECTS\b/i,
  /^ENGINEERING WORKSPACE\b/i,
  /^Reflection\b/,
  /^Cognitive State\b/,
  /^Projects\b/,
  /^Agents\b/,
  /^Self\b/,
  /^Creative capability\b/,
  /^Memory context\b/,
];

/**
 * Is this turn asking to pick a workstream back up, rather than asking about
 * the world? Resume turns must be answered from the ledger, not from a
 * self-description block that is re-sent on every round.
 */
export function isMissionResume(prompt: string | undefined): boolean {
  if (!prompt) return false;
  return (
    /\b(missions?|workstreams?|continuity|ledger|brief|blockers?)\b/i.test(prompt) &&
    /\b(resume|resuming|pick up|continue|read|retrieve|find|blocked|blocking)\b/i.test(prompt)
  );
}

/** The request context for a continuation round; unchanged when there is nothing to drop. */
export function continuationContext(context: string | undefined): string | undefined {
  if (!context || !context.includes("\n## ")) return context;
  const sections = context.split(/\n(?=## )/);
  const kept = sections.filter((section) => {
    if (!section.startsWith("## ")) return true;
    const title = section.slice(3).split("\n", 1)[0].trim();
    return !DROP_ON_CONTINUATION.some((pattern) => pattern.test(title));
  });
  if (kept.length === sections.length) return context;
  return `${kept.join("\n")}\n\n(Self-description sections are omitted on this continuation round: they were given at the start of this task and have not changed.)`;
}

/**
 * The context a mission-RESUME turn needs.
 *
 * A resume asks what was already recorded, so the ledger tools are the
 * source of truth. The full self-description block is not: measured on the
 * blocked Mission 14 retry, it was ~21 KB of a ~23 KB request, and it was
 * re-sent while the model was trying to read two small mission records. Keep
 * live retrieval if it is present (it is evidence for this turn); otherwise
 * replace the block with a short statement of where the facts come from.
 */
export function missionResumeContext(context: string | undefined): string | undefined {
  if (!context || context.trim().length === 0) return context;
  const live = /## LIVE RETRIEVAL RESULTS[\s\S]*?(?=\n## |$)/i.exec(context)?.[0]?.trim();
  return (
    "Mission resumption: the persistent mission ledger is the source of truth for this turn. " +
    "Use the continuity tools to find the record, read its brief and persist any update. " +
    "Self-description and unrelated context are omitted because they are not evidence about the mission." +
    (live ? `\n\n${live}` : "")
  );
}
