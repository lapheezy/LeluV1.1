/**
 * Builds the evidence behind Neural Map V2 (LÉLU's cognitive architecture).
 *
 * Every subsystem node is a real directory under src/core (or the files at
 * its root), with its file and line counts. Every edge between subsystems is
 * a real static import, counted. Nothing here is telemetry: the output says
 * what the code CONTAINS and how it is WIRED, not what is running. The
 * function each subsystem is filed under (perception, memory, …) is an
 * editorial classification, recorded as such.
 *
 *   npx tsx scripts/neural/build-cognitive-architecture.ts
 *
 * Writes src/core/neural/multiverse/cognitiveArchitecture.generated.json.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "../..");
const CORE = join(ROOT, "src/core");
const OUT = join(CORE, "neural/multiverse/cognitiveArchitecture.generated.json");

/** Editorial: which cognitive function each src/core directory serves. */
export const FUNCTION_OF: Record<string, string> = {
  perception: "perception", voice: "perception", media: "perception", browser: "perception", visual: "perception",
  memory: "memory", persistence: "memory", storage: "memory", data: "memory", sync: "memory", graph: "memory", neural: "memory",
  cognition: "cognition", reasoning: "cognition", identity: "cognition", curiosity: "cognition", model: "cognition",
  security: "evaluation", sentinel: "evaluation", observability: "evaluation", perf: "evaluation",
  planning: "planning", tasks: "planning", workflows: "planning", orchestrator: "planning", executive: "planning",
  conversation: "conversation", multichat: "conversation", notifications: "conversation",
  tools: "tools", capabilities: "tools", skills: "tools", native: "tools", agentic: "tools", apiEcosystem: "tools", integration: "tools", acquisition: "tools",
  "core-root": "provider-routing", router: "provider-routing",
  proactive: "reflection", "operational-intelligence": "reflection",
  spend: "feedback", user: "feedback",
  selfdev: "development", engineering: "development", build: "development", forge: "development", agents: "development", agent: "development",
  avatar: "embodiment", asre: "embodiment", atelier: "embodiment", couture: "embodiment", creative: "embodiment", studio: "embodiment",
  geometry: "embodiment", earth: "embodiment", world: "embodiment", cosmos: "embodiment", spatial: "embodiment", interface: "embodiment", ui: "embodiment",
  runtime: "runtime", env: "runtime", config: "runtime", workspace: "runtime", projects: "runtime", caretaker: "runtime",
};

const SOURCE = /\.(ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (SOURCE.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** The subsystem a src/core file belongs to: its first directory, or core-root. */
function subsystemOf(file: string): string | null {
  const rel = relative(CORE, file);
  if (rel.startsWith("..")) return null;
  const parts = rel.split(sep);
  return parts.length === 1 ? "core-root" : parts[0];
}

const IMPORT = /(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

/**
 * Measured CHANGE activity (not processing): commits touching each subsystem
 * per day, over the history this clone has. The window is reported as it is
 * (a shallow clone has a short one); nothing is extrapolated.
 */
export function changeHistory(): { from: string; to: string; days: number; perSubsystem: Record<string, { commits: number; lastChanged: string; daily: number[] }> } {
  let out = "";
  try {
    out = execFileSync("git", ["log", "--format=@%cs %H", "--name-only", "--", "src/core"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return { from: "", to: "", days: 0, perSubsystem: {} };
  }
  // In a shallow clone the boundary commits have no parent here, so git shows
  // them as adding every file: they are not changes and are skipped.
  let shallow = new Set<string>();
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd: ROOT, encoding: "utf8" }).trim();
    shallow = new Set(readFileSync(resolve(ROOT, gitDir, "shallow"), "utf8").split("\n").filter(Boolean));
  } catch {
    /* not shallow */
  }
  const commits: Array<{ day: string; subs: Set<string> }> = [];
  let skipping = false;
  for (const line of out.split("\n")) {
    if (line.startsWith("@")) {
      const [day, hash] = line.slice(1).split(" ");
      skipping = shallow.has(hash);
      if (!skipping) commits.push({ day, subs: new Set() });
    } else if (!skipping && line.startsWith("src/core/") && commits.length) {
      const rest = line.slice("src/core/".length).split("/");
      commits.at(-1)!.subs.add(rest.length === 1 ? "core-root" : rest[0]);
    }
  }
  if (!commits.length) return { from: "", to: "", days: 0, perSubsystem: {} };
  const days = commits.map((c) => c.day).sort();
  const from = days[0];
  const to = days.at(-1)!;
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const perSubsystem: Record<string, { commits: number; lastChanged: string; daily: number[] }> = {};
  for (const c of commits)
    for (const sub of c.subs) {
      const r = (perSubsystem[sub] ??= { commits: 0, lastChanged: c.day, daily: new Array(span).fill(0) });
      r.commits += 1;
      if (c.day > r.lastChanged) r.lastChanged = c.day;
      r.daily[Math.round((Date.parse(c.day) - Date.parse(from)) / 86_400_000)] += 1;
    }
  return { from, to, days: span, perSubsystem };
}

export function build() {
  const files = walk(CORE);
  const subsystems = new Map<string, { files: number; lines: number }>();
  const edges = new Map<string, number>();
  for (const f of files) {
    const from = subsystemOf(f)!;
    const text = readFileSync(f, "utf8");
    const s = subsystems.get(from) ?? { files: 0, lines: 0 };
    s.files += 1;
    s.lines += text.split("\n").length;
    subsystems.set(from, s);
    for (const m of text.matchAll(IMPORT)) {
      const to = subsystemOf(resolve(dirname(f), m[1]));
      if (!to || to === from) continue;
      const key = `${from}|${to}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const history = changeHistory();
  const nodes = [...subsystems.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, s]) => ({
      id,
      path: id === "core-root" ? "src/core/*.ts" : `src/core/${id}`,
      function: FUNCTION_OF[id] ?? "unclassified",
      files: s.files,
      lines: s.lines,
      commits: history.perSubsystem[id]?.commits ?? 0,
      lastChanged: history.perSubsystem[id]?.lastChanged ?? null,
      daily: history.perSubsystem[id]?.daily ?? new Array(history.days).fill(0),
    }));
  return {
    generatedBy: "scripts/neural/build-cognitive-architecture.ts",
    history: { from: history.from, to: history.to, days: history.days, note: "commits touching each subsystem per day, from this clone's git history; change activity, not runtime processing" },
    evidence: {
      nodes: "directory exists in src/core; file and line counts measured from the source",
      edges: "static relative imports between subsystems, counted (inferred wiring, not runtime calls)",
      function: "editorial classification of each directory (FUNCTION_OF in the generator)",
      history: "git commits touching each subsystem (measured change activity, not runtime processing)",
      activity: "not measured here: live activity is read at runtime from the event bus, never from this file",
    },
    nodes,
    edges: [...edges.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, imports]) => {
        const [from, to] = key.split("|");
        return { from, to, imports };
      }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const data = build();
  writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`);
  console.log(`wrote ${relative(ROOT, OUT)}: ${data.nodes.length} subsystems, ${data.edges.length} import edges`);
}
