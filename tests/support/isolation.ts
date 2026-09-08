/**
 * ==========================================================
 * LÉLU — TEST ISOLATION
 *
 * Some tests drive cognition BY HAND: they call runCycle()
 * once and then assert on the state that cycle produced.
 *
 * That only means anything if nothing else is running cycles
 * at the same time — and something usually is. Booting LÉLU
 * starts the continuous self-study loop and the autonomous
 * objective runtime, and a test file that boots her leaves
 * them running for whatever runs next.
 *
 * The failure this prevents is quiet, which is what makes it
 * worth a helper. SelfStudyEngine.runCycle() never overlaps
 * cycles: called while one is in flight it returns the
 * PREVIOUS report instead of running. So a hand-driven cycle
 * silently does nothing, the state the test then reads is
 * blank or stale, and the assertion fails on a null a
 * millisecond later — pointing at the assertion rather than
 * at the loop that swallowed the cycle.
 *
 * Stopping the loops is not enough on its own: a cycle
 * already in flight keeps running after its loop is stopped.
 * This waits for it.
 * ==========================================================
 */

import CognitiveLoop from "../../src/core/cognition/CognitiveLoop";
import SelfStudyEngine from "../../src/core/cognition/SelfStudyEngine";
import AgentCognitionRuntime from "../../src/core/cognition/AgentCognitionRuntime";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stop every background cognition loop and wait until nothing is
 * mid-cycle. Idempotent, and safe to call when nothing is running.
 *
 * Returns false if a cycle was still in flight when the wait ran out,
 * so a caller can assert on it rather than proceed on an assumption.
 */
export async function stopBackgroundCognition(timeoutMs = 120_000): Promise<boolean> {
  // Stopping the cognitive loop also stops the self-study engine it
  // starts; the explicit call covers a loop started directly.
  CognitiveLoop.getInstance().stop();
  const study = SelfStudyEngine.getInstance();
  study.stop();
  AgentCognitionRuntime.getInstance().stop();

  const deadline = Date.now() + timeoutMs;
  while (study.isBusy() && Date.now() < deadline) {
    await sleep(100);
  }
  return !study.isBusy();
}

/** True when nothing is scheduling or running cognition in the background. */
export function backgroundCognitionIsQuiet(): boolean {
  const study = SelfStudyEngine.getInstance();
  return !study.isRunning() && !study.isBusy() && !AgentCognitionRuntime.getInstance().isRunning();
}
