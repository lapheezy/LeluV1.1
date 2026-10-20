/**
 * ==========================================================
 * LÉLU — FIND LEAKED HANDLES
 *
 * A diagnostic, not a fix. Preload it into a process that
 * will not exit and it names the owner:
 *
 *   npx tsx --import ./scripts/find-leaked-handles.mjs \
 *       --test tests/<file>.test.ts
 *
 * It wraps setInterval/setTimeout to record where each timer
 * was created, then prints the ones still REFERENCED when the
 * work is done — a referenced timer is precisely what makes
 * Node refuse to exit, and an unref'd one is correctly absent.
 *
 * This is how the three owners behind the hung cognition suite
 * were identified (ProjectScheduler, ExecutiveRuntime, and the
 * knowledge-provider race's rejection timer) rather than
 * guessed at. tests/background-lifecycles.test.ts is the guard
 * that keeps them fixed; this is the tool for the next one.
 * ==========================================================
 */

// Preloaded into the test process; records where each timer was created and
// reports the ones still alive when the tests are done.
const live = new Map();
const realInterval = globalThis.setInterval;
const realTimeout = globalThis.setTimeout;
const realClearInterval = globalThis.clearInterval;
const realClearTimeout = globalThis.clearTimeout;

globalThis.setInterval = (...args) => {
  const h = realInterval(...args);
  live.set(h, "setInterval\n" + new Error().stack.split("\n").slice(2, 6).join("\n"));
  return h;
};
globalThis.setTimeout = (...args) => {
  const h = realTimeout(...args);
  live.set(h, "setTimeout\n" + new Error().stack.split("\n").slice(2, 6).join("\n"));
  return h;
};
globalThis.clearInterval = (h) => { live.delete(h); return realClearInterval(h); };
globalThis.clearTimeout = (h) => { live.delete(h); return realClearTimeout(h); };

let reported = false;
const dump = () => {
  if (reported) return;
  reported = true;
  // Referenced AND not already fired. hasRef() alone still reports true for
  // a one-shot that has already run, so without the _destroyed check every
  // `await new Promise(r => setTimeout(r, 50))` in the file under test shows
  // up as a leak and buries the real one.
  const survivors = [...live.entries()].filter(
    ([h]) => h && typeof h === "object" && h.hasRef?.() && h._destroyed !== true,
  );
  console.log("SURVIVING_TIMERS " + survivors.length);
  for (const [, where] of survivors.slice(0, 4)) console.log("TIMER_AT " + where.replace(/\n/g, " | "));
};
realTimeout(() => { dump(); process.exit(0); }, 25000).unref();
process.on("beforeExit", dump);
