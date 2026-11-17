/**
 * WP6 — controlled performance experiment.
 *
 *   npx tsx scripts/asre/wp6-benchmark.ts [--trials 5] [--res 0.008]
 *
 * Hypothesis under test: incremental (component-reusing) reconstruction
 * reduces work and time without sacrificing quality.
 *
 * Identical input for every strategy: the base character, then the same
 * 10 edits; identical lattice; same machine. Each trial runs in a FRESH
 * child process (cold start: JIT cold, caches empty, workers spawned),
 * then repeats the session in that process with caches cleared (warm JIT).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_CHARACTER, withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec";
import { ComponentCache, buildComponent, buildWholeObject, codesIou, occupancyCodes, plan, type BuiltComponent, type CharacterBuild, type Lattice } from "../../src/core/asre/character/build";
import { COMPONENTS, COMPONENT_ORDER, contextFor, type ComponentId } from "../../src/core/asre/character/components";
import { Scheduler, expectedGain, type SchedTask } from "../../src/core/asre/scheduler/Scheduler";
import { ComponentPool } from "./pool";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const RES = Number(arg("--res", "0.008"));
const LATTICE: Lattice = { resolution: RES, originCells: [Math.floor(-0.96 / RES), Math.floor(-0.07 / RES), Math.floor(-0.66 / RES)], dims: [Math.ceil(1.92 / RES), Math.ceil(2.16 / RES), Math.ceil(1.32 / RES)] };

const EDITS: Array<[string, Parameters<typeof withChanges>[1]]> = [
  ["hair: bob", { hair: { style: "bob" } }],
  ["sleeves: long", { clothing: { top: "longsleeve" } }],
  ["hair colour", { materials: { hair: [0.55, 0.12, 0.08] } }],
  ["glasses", { accessories: { head: ["glasses"], body: [] } }],
  ["pose: wave", { pose: "wave" }],
  ["body: tall", { body: { height: 1.84, legRatio: 0.5 } }],
  ["hair: ponytail", { hair: { style: "ponytail" } }],
  ["bottom: skirt", { clothing: { bottom: "skirt" } }],
  ["hat + glasses", { accessories: { head: ["hat", "glasses"], body: [] } }],
  ["pose: relaxed", { pose: "relaxed" }],
];
function session(): CharacterSpec[] {
  const states = [BASE_CHARACTER];
  for (const [, e] of EDITS) states.push(withChanges(states[states.length - 1], e));
  return states;
}

/** What a viewer needs for a first usable preview. */
const IMPORTANCE: Record<ComponentId, number> = {
  head: 1, face: 1, hair: 0.9, torso: 0.85, "clothing.top": 0.8, arms: 0.6, legs: 0.6, "clothing.bottom": 0.6, pelvis: 0.5, neck: 0.5,
  hands: 0.3, feet: 0.3, "clothing.shoes": 0.3, "accessories.head": 0.4, "accessories.body": 0.3,
};
const USABLE: ComponentId[] = (Object.keys(IMPORTANCE) as ComponentId[]).filter((k) => IMPORTANCE[k] >= 0.5);

type Strategy = "whole-object" | "component" | "incremental" | "adaptive-parallel";
interface StateResult { ms: number; firstUsableMs: number | null; regenerated: number; recolored: number; reused: number; samples: number; codes: Set<number> | null; triangles: number }

async function runState(strategy: Strategy, spec: CharacterSpec, cache: ComponentCache, pool: ComponentPool | null, sched: Scheduler): Promise<StateResult> {
  const t0 = performance.now();
  if (strategy === "whole-object") {
    const w = buildWholeObject(spec, LATTICE);
    const ms = performance.now() - t0;
    return { ms, firstUsableMs: ms, regenerated: COMPONENT_ORDER.length, recolored: 0, reused: 0, samples: w.samples, codes: w.codes, triangles: w.mesh.indices.length / 3 };
  }
  const p = plan(spec, LATTICE);
  const built = new Map<ComponentId, BuiltComponent>();
  let firstUsable: number | null = null;
  const mark = () => {
    if (firstUsable === null && USABLE.every((u) => built.has(u))) firstUsable = performance.now() - t0;
  };
  if (strategy === "component" || strategy === "incremental") {
    const c = strategy === "component" ? null : cache;
    for (const id of COMPONENT_ORDER) {
      built.set(id, buildComponent(id, p, c, LATTICE));
      mark();
    }
  } else {
    // adaptive parallel: cached and recolourable work on the main thread, the rest scheduled on workers
    const toBuild: ComponentId[] = [];
    for (const id of COMPONENT_ORDER) {
      const hasFull = cache.get(p.keys[id]);
      const hasGeo = cache.get(`geo:${p.geometryKeys[id]}`);
      if (hasFull || hasGeo) built.set(id, buildComponent(id, p, cache, LATTICE));
      else toBuild.push(id);
    }
    mark();
    const tasks: SchedTask<BuiltComponent>[] = toBuild.map((id) => {
      const shape = COMPONENTS[id].build(contextFor(spec, p.sk));
      const size = shape ? ((shape.hi[0] - shape.lo[0]) * (shape.hi[1] - shape.lo[1]) * (shape.hi[2] - shape.lo[2])) / RES ** 3 : 1;
      return {
        id, kind: `component:${id}`, size, priorMs: size * 2e-4,
        // components are pure functions of the spec: dependencies were resolved at invalidation time, none block execution
        deps: [],
        gain: expectedGain({ importance: IMPORTANCE[id], confidence: 0, missing: 1 }),
        memoryMB: 50,
        run: async () => {
          if (!shape) {
            const empty = buildComponent(id, p, cache, LATTICE);
            built.set(id, empty);
            return empty;
          }
          const { component } = await pool!.build(spec, id, LATTICE);
          cache.set(component.key, component.local!);
          cache.set(`geo:${component.geometryKey}`, component.local!);
          built.set(id, component);
          mark();
          return component;
        },
      };
    });
    await sched.run(tasks, { slots: pool!.size, memoryBudgetMB: Math.floor(os.freemem() / 2 ** 20 / 2) });
    mark();
  }
  const ms = performance.now() - t0;
  const comps = COMPONENT_ORDER.map((id) => built.get(id)!);
  const b: CharacterBuild = { components: comps, regenerated: [], recolored: [], reused: [], ms };
  return {
    ms,
    firstUsableMs: firstUsable,
    regenerated: comps.filter((c) => c.action === "regenerated").length,
    recolored: comps.filter((c) => c.action === "recolored").length,
    reused: comps.filter((c) => c.action === "reused").length,
    samples: comps.reduce((s, c) => s + (c.action === "regenerated" ? c.local!.samples : 0), 0),
    codes: occupancyCodes(b, LATTICE),
    triangles: comps.reduce((s, c) => s + c.local!.mesh.indices.length / 3, 0),
  };
}

async function child(strategy: Strategy) {
  const pool = strategy === "adaptive-parallel" ? new ComponentPool(Math.min(4, os.cpus().length)) : null;
  const sched = new Scheduler();
  const passes = [];
  for (const pass of ["cold", "warm"] as const) {
    const cache = new ComponentCache();
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    const states = session();
    const results: StateResult[] = [];
    for (const s of states) results.push(await runState(strategy, s, cache, pool, sched));
    const wallMs = performance.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    // quality (outside the timed region): final state vs the whole-object build of the same state
    const final = results[results.length - 1];
    const truth = strategy === "whole-object" ? final.codes! : buildWholeObject(states[states.length - 1], LATTICE).codes;
    passes.push({
      pass,
      wallMs,
      cpuMs: (cpu.user + cpu.system) / 1000,
      peakRssMB: process.resourceUsage().maxRSS / 1024,
      firstUsableMs: results[0].firstUsableMs,
      initialFinalMs: results[0].ms,
      editLatencyMs: results.slice(1).map((r) => r.ms),
      regenerated: results.slice(1).reduce((s, r) => s + r.regenerated, 0),
      recolored: results.slice(1).reduce((s, r) => s + r.recolored, 0),
      reused: results.slice(1).reduce((s, r) => s + r.reused, 0),
      samplesEvaluated: results.reduce((s, r) => s + r.samples, 0),
      finalTriangles: final.triangles,
      finalCells: final.codes!.size,
      finalIouVsWhole: codesIou(final.codes!, truth),
    });
  }
  await pool?.close();
  console.log(JSON.stringify({ strategy, passes }));
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  return { median: +q(0.5).toFixed(1), q1: +q(0.25).toFixed(1), q3: +q(0.75).toFixed(1), min: +s[0].toFixed(1), max: +s[s.length - 1].toFixed(1), n: s.length };
}

async function parent() {
  const trials = Number(arg("--trials", "5"));
  const strategies: Strategy[] = ["whole-object", "component", "incremental", "adaptive-parallel"];
  const raw: Record<string, unknown[]> = {};
  const self = fileURLToPath(import.meta.url);
  for (let t = 0; t < trials; t++)
    for (const s of strategies) {
      // interleave strategies across trials so drift in machine load hits all of them
      const r = spawnSync(process.execPath, ["--import", "tsx", self, "--child", s, "--res", String(RES)], { encoding: "utf8", maxBuffer: 1 << 26 });
      if (r.status !== 0) throw new Error(`${s} trial ${t}: ${r.stderr.slice(-2000)}`);
      const line = JSON.parse(r.stdout.trim().split("\n").pop()!);
      (raw[s] ??= []).push(line.passes);
      console.error(`trial ${t + 1}/${trials} ${s}: cold ${Math.round(line.passes[0].wallMs)} ms, warm ${Math.round(line.passes[1].wallMs)} ms`);
    }
  const summary: Record<string, Record<string, unknown>> = {};
  for (const s of strategies) {
    for (const pass of [0, 1]) {
      const ps = (raw[s] as Array<Array<Record<string, number & number[]>>>).map((p) => p[pass]);
      summary[`${s}/${pass ? "warm" : "cold"}`] = {
        wallMs: stats(ps.map((p) => p.wallMs)),
        cpuMs: stats(ps.map((p) => p.cpuMs)),
        peakRssMB: stats(ps.map((p) => p.peakRssMB)),
        firstUsableMs: stats(ps.map((p) => p.firstUsableMs)),
        initialFinalMs: stats(ps.map((p) => p.initialFinalMs)),
        editLatencyMs: stats(ps.flatMap((p) => p.editLatencyMs)),
        regeneratedComponents: ps[0].regenerated,
        recoloredComponents: ps[0].recolored,
        reusedComponents: ps[0].reused,
        samplesEvaluated: ps[0].samplesEvaluated,
        finalTriangles: ps[0].finalTriangles,
        finalIouVsWhole: Math.min(...ps.map((p) => p.finalIouVsWhole)),
      };
    }
  }
  const env = { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memGB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version, lattice: LATTICE, trials, edits: EDITS.map(([l]) => l) };
  const out = path.resolve(path.dirname(self), "../../artifacts/asre/wp6");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "benchmark.json"), JSON.stringify({ env, summary, raw }, null, 1));
  console.log(JSON.stringify({ env, summary }, null, 1));
}

if (process.argv.includes("--child")) await child(arg("--child", "") as Strategy);
else await parent();
