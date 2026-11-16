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
];

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
