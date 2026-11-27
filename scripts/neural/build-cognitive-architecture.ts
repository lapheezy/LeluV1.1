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
  const nodes = [...subsystems.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, s]) => ({
      id,
      path: id === "core-root" ? "src/core/*.ts" : `src/core/${id}`,
      function: FUNCTION_OF[id] ?? "unclassified",
      files: s.files,
      lines: s.lines,
    }));
  return {
    generatedBy: "scripts/neural/build-cognitive-architecture.ts",
    evidence: {
      nodes: "directory exists in src/core; file and line counts measured from the source",
      edges: "static relative imports between subsystems, counted (inferred wiring, not runtime calls)",
      function: "editorial classification of each directory (FUNCTION_OF in the generator)",
      activity: "not measured here: no runtime telemetry is read by this generator",
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
