/**
 * ==========================================================
 * LÉLU
 * COGNITIVE STATE RESOLVER
 *
 * "What are you thinking about today?"
 *
 * This stage answers questions about LÉLU's own cognition by
 * READING the state her autonomous self-study loop has already
 * produced. It is the chat route's window onto cognition — not a
 * trigger for it.
 *
 * Guarantees, and why they matter:
 *
 *   • It calls SelfStudyEngine.getCognitiveState(), which is a pure
 *     read: no cycle is run, the loop is not started, no provider is
 *     called, nothing is mutated. Asking the question can therefore
 *     never be what produced the answer.
 *
 *   • The answer is composed deterministically from that state, for
 *     the same reason ExecutiveRuntime answers "what are you doing?"
 *     from measured telemetry: the model never gets to guess what
 *     LÉLU is thinking about. Cognition reports itself.
 *
 *   • The same state is served whether or not the user has sent a
 *     message recently, and survives a reload — getCognitiveState()
 *     falls back to the durable trace.
 *
 *   • It surfaces STRUCTURE — focus, active investigation, why that
 *     one, discoveries, unresolved questions, understanding, next
 *     step — as conclusions and observations. It never emits a
 *     hidden reasoning trace.
 *
 * It must run BEFORE BrainResolver: "what are you thinking about"
 * contains "what are you", which the identity matcher would
 * otherwise claim and answer with the identity statement.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import SelfStudyEngine, { type CognitiveStateView } from "../cognition/SelfStudyEngine";

/**
 * Questions about what LÉLU is thinking/studying/learning.
 *
 * Deliberately does NOT claim "what are you doing" or "are you
 * working" — those are operational-status questions already owned by
 * ExecutiveRuntime, and stealing them would change existing behaviour.
 */
const COGNITION_PHRASES =
  /(thinking about|on your mind|what are you (studying|learning|investigating|exploring|curious about|focused on|focusing on)|what have you (learned|discovered|found out)|your (current )?(cognitive state|focus|self.?study|investigation)|what are you trying to (understand|figure out)|what don'?t you understand|what questions do you have)/;

function isQuestionForm(text: string): boolean {
  return /\?/.test(text) || /^(who|what|why|how|do|does|can|could|would|tell|show|describe)\b/.test(text);
}

/** True when the prompt asks about LÉLU's own cognition. */
export function isCognitiveStateQuestion(prompt: string): boolean {
  const clean = (prompt ?? "").trim().toLowerCase().replace(/é/g, "e");
  return COGNITION_PHRASES.test(clean) && isQuestionForm(clean);
}

export default class CognitiveStateResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt ?? "";
    if (!isCognitiveStateQuestion(prompt)) {
      return { handled: false };
    }

    // PURE READ. No cycle, no loop start, no provider, no mutation.
    const state = SelfStudyEngine.getInstance().getCognitiveState();

    context.logger.info("CognitiveStateResolver", "Reported existing cognitive state", {
      readFrom: state.source,
      loopRunning: state.running,
      cycle: state.cycle,
      persistedCycle: state.persistedCycle,
      triggeredCycle: false,
    });

    const response: AIResponse = {
      text: this.compose(state),
      provider: "cognition",
      model: "self-study-state",
      processingTime: Date.now() - context.started,
      metadata: {
        source: "SelfStudyEngine.getCognitiveState",
        category: "cognitive-state",
        confidence: 1,
        // Explicit, machine-checkable proof for the integration test:
        // this answer REPORTED cognition, it did not create it.
        readOnly: true,
        triggeredCognition: false,
        loopRunningBeforeRequest: state.running,
        cycleAtRequest: state.cycle,
        stateSource: state.source,
      },
    };

    return { handled: true, response };
  }

  /**
   * Compose the answer from real state. Structured conclusions and
   * observations only — never a reasoning transcript.
   */
  private compose(state: CognitiveStateView): string {
    if (state.source === "none") {
      return [
        "I don't have a completed self-study cycle to report yet.",
        state.running
          ? "My cognitive loop is running and scheduling its own cycles — the first one hasn't finished."
          : "My cognitive loop isn't currently scheduling cycles.",
        `I'm carrying ${state.carried} question(s) in my buffer.`,
      ].join(" ");
    }

    const parts: string[] = [];

    const when = state.lastCycleAt
      ? `${Math.max(0, Math.round((Date.now() - state.lastCycleAt) / 1000))}s ago`
      : "recently";
    parts.push(
      `I've been working on my own, without being asked. ${state.cycle} self-study cycle(s) this session (last one finished ${when}), and my loop ${
        state.running ? "is still scheduling the next one" : "is not currently scheduling itself"
      }.`,
    );

    if (state.focus) {
      parts.push(
        [
          "**What I'm focused on**",
          `${state.focus.question}`,
          `${state.focus.whySelected}`,
        ].join("\n"),
      );
    }

    if (state.investigation) {
      const origin =
        state.investigation.evidenceOrigin === "development-runtime"
          ? "the real development runtime — the files on disk right now"
          : state.investigation.evidenceOrigin === "static-snapshot"
            ? "a build-time static snapshot, not the live workspace, so it may be behind the working tree"
            : "my own internal runtime state";
      parts.push(
        [
          "**How I'm investigating it**",
          `I used ${state.investigation.agent} through ${state.investigation.tool}, and gathered ${state.investigation.evidenceCount} observation(s) from ${origin}.`,
          state.investigation.provider
            ? `I evaluated that evidence through ${state.investigation.provider}.`
            : "No AI provider was reachable, so I evaluated the evidence directly rather than stopping.",
          state.investigation.conclusion ? `What it established: ${state.investigation.conclusion}` : "",
          `${state.investigation.learned ? "I learned something from it" : "It didn't settle anything conclusive"}, and long-term memory was ${
            state.investigation.memoryConsolidated ? "updated" : "not updated"
          }.`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    if (state.discoveries.length > 0) {
      parts.push(
        ["**What I've found recently**", ...state.discoveries.slice(0, 5).map((item) => `- ${item}`)].join("\n"),
      );
    }

    if (state.unresolved.length > 0) {
      parts.push(
        [
          "**What I still don't know**",
          ...state.unresolved.slice(0, 5).map((item) => `- ${item}`),
        ].join("\n"),
      );
    }

    parts.push(
      [
        "**Where I stand**",
        `${state.understanding.knowledgeEntries} things recorded, ${state.understanding.verified} of them verified or tested, ${state.understanding.openGaps} still untrusted.`,
        state.understanding.runtimeReachable
          ? "I can read my own source from the real development runtime."
          : "I can only read a build-time snapshot of my source right now — the development runtime isn't reachable, so I'm treating what I read as possibly stale.",
        state.understanding.agents.length > 0
          ? `Agents and tools I've been using: ${state.understanding.agents.join(", ")}.`
          : "",
        state.understanding.mission.length > 0
          ? `I'm working from: ${state.understanding.mission.join(" · ")}.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    if (state.nextIntended) {
      parts.push(
        [
          "**What I'm going to look at next**",
          state.nextIntended.question,
          state.nextIntended.whySelected,
        ].join("\n"),
      );
    }
    parts.push(`I'm carrying ${state.carried} open question(s).`);

    return parts.join("\n\n");
  }
}
