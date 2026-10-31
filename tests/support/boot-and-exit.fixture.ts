/**
 * ==========================================================
 * LÉLU — BOOT-AND-EXIT FIXTURE
 *
 * Not a test. A child process for tests/background-lifecycles.test.ts
 * to run and watch.
 *
 * It does the two things that used to leave a referenced handle
 * behind: it boots the runtime (which starts ExecutiveRuntime's
 * self-state loop) and it runs one cognition research pass
 * (which raced every knowledge provider against a timeout).
 *
 * It also starts continuous cognition and then deliberately does
 * NOT stop it. That is the point, not an oversight: a real test
 * file calling teardown is already covered by the files that do
 * (see live-state-integration.test.ts, whose after() hook asserts
 * cognition went quiet). What this fixture pins is the other half
 * — that FORGETTING to stop a heartbeat cannot wedge a process,
 * because a heartbeat is not a reason to stay alive.
 *
 * Then it simply returns. Whether this process ever exits is the
 * assertion: nothing here calls process.exit(), so if any owner
 * left a referenced timer, interval, socket or listener alive,
 * Node will sit here forever and the parent test will fail on its
 * own timeout. That is the only way to prove "terminates
 * naturally" — a force-exit flag or a longer timeout would hide
 * exactly the defect under test.
 * ==========================================================
 */

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import AIService from "../../src/core/AIService";
import StudyAgentRouter from "../../src/core/cognition/StudyAgentRouter";
import StudyObjectives from "../../src/core/cognition/StudyObjectives";
import SelfStudyEngine from "../../src/core/cognition/SelfStudyEngine";
import CognitiveLoop from "../../src/core/cognition/CognitiveLoop";
const service = AIService.getInstance();
await service.initialize();

// One real research pass. Providers are almost certainly unreachable from
// a test environment — that is fine and is in fact the interesting case,
// because a failing provider is what leaves a timeout behind.
const objective = StudyObjectives.getInstance().add({
  question: "What keeps a Node process alive after its work is done?",
  detail: "Exercises the knowledge-provider race so a leaked deadline shows up.",
  origin: "mission",
  domain: "research",
  priority: 50,
  createdInCycle: 0,
});
if (!objective) {
  throw new Error("could not create the research objective the fixture needs");
}
const investigation = await StudyAgentRouter.getInstance().investigate(objective);
// Printed so the parent test can assert the research pass really ran.
// Either outcome is fine — ok:false is the interesting one, because an
// unreachable provider is what used to leave a deadline timer behind.
console.log(`BOOT_AND_EXIT_RESEARCH tool=${investigation.tool} ok=${investigation.ok}`);

// Start the continuous loops and walk away without stopping them.
CognitiveLoop.getInstance().start();
SelfStudyEngine.getInstance().start();

console.log("BOOT_AND_EXIT_REACHED_END");
