/**
 * ==========================================================
 * LÉLU — RESOURCE INTELLIGENCE TOOLS
 *
 * The conversational face of /api/resources, layered onto the existing
 * dispatcher the same way the Mission 8 workforce tools are
 * (CommandCenterToolDefinitions / CommandCenterExecutors). They feed the
 * existing acquisition pipeline; they do not replace it:
 *
 *   resources.gaps      what this request needs that LÉLU cannot do yet,
 *                       checked against the LIVE tool registry, plus the
 *                       installed modules that could close it (reuse first)
 *   resources.discover  public no-key search: npm · GitHub · GitLab
 *   resources.evaluate  license, maintenance, deps, size, install scripts,
 *                       vulnerabilities (OSV), class, overlap → verdict
 *   resources.sandbox   an isolated proof of concept (no network, no secrets,
 *                       reads only its own folder, no child processes)
 *   resources.register  record a capability whose tool is executable AND
 *                       whose sandbox proof passed
 *   resources.audit     LÉLU's own dependencies: vulnerable, deprecated,
 *                       abandoned, behind, paid SDKs, duplicates
 *
 * None of them calls a model: every answer is structured data.
 * ==========================================================
 */
import type { ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutor } from "../tools/ToolDispatcher";
import { sessionAuthHeader } from "../persistence/sessionAuth";

const def = (id: string, name: string, description: string, permissions: ToolDefinition["permissions"], riskLevel: ToolDefinition["riskLevel"]): ToolDefinition =>
  ({ id, name, description, category: "Acquisition", permissions, riskLevel, available: true, executionRoute: `/api/resources/${id.split(".")[1]}`, dependency: "resource intelligence API (/api/resources)" }) as ToolDefinition;

export const RESOURCE_TOOL_DEFINITIONS: ToolDefinition[] = [
  def("resources.gaps", "Find Missing Capabilities", "Say exactly which capability a request needs that LÉLU does not have yet (checked against her live tools), and which installed modules could provide it without a new dependency.", ["READ"], 0),
  def("resources.discover", "Discover Open-Source Resources", "Search public sources (npm, GitHub, GitLab) for free open-source tools for a capability. No keys, no cost; GitHub's free search is rate limited.", ["READ", "EXTERNAL_ACTION"], 0),
  def("resources.evaluate", "Evaluate Resources", "Evaluate npm/PyPI packages or GitHub repos: license, maintenance, dependencies, size, install scripts, known vulnerabilities, local/browser/public/free-limited/local-inference/paid class, overlap with what is installed. Ranked verdicts; paid ones are blocked.", ["READ", "EXTERNAL_ACTION"], 0),
  def("resources.sandbox", "Test a Resource in Isolation", "Install a package (scripts disabled) or link an installed module into a throwaway sandbox and run a small proof of concept with no network, no secrets, no child processes and file access only inside the sandbox. probe:true proves the isolation.", ["READ", "EXECUTE"], 1),
  def("resources.register", "Register a Verified Capability", "Record a new capability once its tool is executable and its sandbox proof passed: provenance, version, license and tests go into the capability registry.", ["WRITE"], 1),
  def("resources.audit", "Audit LÉLU's Dependencies", "Check LÉLU's own dependencies for vulnerabilities, deprecation, abandonment, major versions behind, paid-API SDKs and duplicates. Findings only — nothing is replaced automatically.", ["READ", "EXTERNAL_ACTION"], 0),
];

async function call(route: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  if (typeof fetch === "undefined") throw new Error("no network client in this runtime");
  const response = await fetch(`/api/resources/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sessionAuthHeader() },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

const str = (args: Record<string, unknown>, key: string) => (typeof args[key] === "string" ? (args[key] as string).trim() : "");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).filter(Boolean) : typeof value === "string" && value ? [value] : []);

async function liveTools(): Promise<string[]> {
  const [{ default: ToolRegistry }, dispatcher] = await Promise.all([import("../tools/ToolRegistry"), import("../tools/ToolDispatcher")]);
  const executable = new Set(dispatcher.executableToolIds());
  return ToolRegistry.getInstance().available().map((tool) => tool.id).filter((id) => executable.has(id));
}

export const RESOURCE_EXECUTORS: ToolExecutor[] = [
  {
    id: "resources.gaps",
    parameters: { type: "object", properties: { request: { type: "string", description: "What the user asked for." } }, required: ["request"] },
    run: async (args) => {
      const request = str(args, "request");
      if (!request) return { ok: false, content: "resources.gaps needs the request text." };
      const { data } = await call("gap", { request, tools: await liveTools() });
      const missing = (data.missing as Array<{ id: string; label: string; reuseAvailable: string[]; search: string[] }>) ?? [];
      const covered = (data.covered as Array<{ label: string; tool: string }>) ?? [];
      const lines = [
        ...covered.map((c) => `Covered: ${c.label} — ${c.tool}`),
        ...missing.map((m) => `MISSING: ${m.label}. ${m.reuseAvailable.length ? `Installed and reusable: ${m.reuseAvailable.join(", ")}.` : "Nothing installed provides it."} Search: ${m.search.join(" | ")}`),
      ];
      return { ok: true, content: lines.length ? lines.join("\n") : "This request needs nothing outside LÉLU's current capabilities (no known gap signature matched).", data };
    },
  },
  {
    id: "resources.discover",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The capability to look for, in a few words (e.g. \"stl exporter\")." },
        sources: { type: "array", items: { type: "string", enum: ["npm", "github", "gitlab"] } },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    run: async (args) => {
      const { status, data } = await call("discover", { query: str(args, "query"), sources: strings(args.sources), limit: args.limit });
      if (status !== 200) return { ok: false, content: String(data.error ?? `discover failed (${status})`) };
      const results = (data.results as Array<{ source: string; name: string; description?: string; license?: string; updated?: string; stars?: number }>) ?? [];
      const errors = Object.entries((data.errors as Record<string, string>) ?? {}).map(([s, e]) => `${s}: ${e}`);
      return {
        ok: results.length > 0,
        content:
          (results.length
            ? results.map((r) => `[${r.source}] ${r.name}${r.license ? ` (${r.license})` : ""}${r.updated ? `, updated ${r.updated.slice(0, 10)}` : ""}${r.stars !== undefined ? `, ★${r.stars}` : ""} — ${(r.description ?? "").slice(0, 100)}`).join("\n")
            : "No relevant resource found.") + (errors.length ? `\nUnavailable sources: ${errors.join("; ")}` : ""),
        data,
      };
    },
  },
  {
    id: "resources.evaluate",
    parameters: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, description: "Package names (npm/PyPI) or owner/repo (GitHub)." },
        source: { type: "string", enum: ["npm", "pypi", "github"] },
      },
      required: ["names"],
    },
    run: async (args) => {
      const { status, data } = await call("evaluate", { names: strings(args.names), source: str(args, "source") || "npm" });
      if (status !== 200) return { ok: false, content: String(data.error ?? `evaluate failed (${status})`) };
      const summary = (data.summary as string[]) ?? [];
      const errors = Object.entries((data.errors as Record<string, string>) ?? {}).map(([n, e]) => `${n}: ${e}`);
      return { ok: summary.length > 0, content: [...summary, ...(errors.length ? [`Could not evaluate: ${errors.join("; ")}`] : [])].join("\n"), data };
    },
  },
  {
    id: "resources.sandbox",
    parameters: {
      type: "object",
      properties: {
        package: { type: "string", description: "npm package to install into the sandbox (scripts disabled)." },
        version: { type: "string" },
        reuse: { type: "string", description: "An INSTALLED module path to test instead, e.g. three/examples/jsm/exporters/STLExporter.js." },
        code: { type: "string", description: "An ES module proof of concept. Exit non-zero on failure; print the evidence." },
        probe: { type: "boolean", description: "Run the built-in isolation probe instead of code." },
      },
    },
    run: async (args) => {
      const { data } = await call("sandbox", { package: str(args, "package") || undefined, version: str(args, "version") || undefined, reuse: str(args, "reuse") || undefined, code: str(args, "code"), probe: args.probe === true });
      if (data.refused) return { ok: false, content: `Sandbox refused: ${String(data.refused)}`, data };
      const isolation = data.isolation as Record<string, string> | undefined;
      return {
        ok: data.ok === true,
        content:
          `Sandbox ${data.ok ? "PASSED" : "FAILED"} (id ${String(data.id)}, ${String(data.durationMs)} ms; network: ${isolation?.network ?? "?"}).` +
          `\nstdout: ${String(data.stdout ?? "").trim().slice(0, 1500) || "(none)"}` +
          `${data.stderr ? `\nstderr: ${String(data.stderr).trim().slice(-800)}` : ""}`,
        data,
      };
    },
  },
  {
    id: "resources.register",
    parameters: {
      type: "object",
      properties: {
        capability: { type: "string", description: "Capability id, e.g. 3d-export-stl." },
        name: { type: "string" },
        tool: { type: "string", description: "The executable tool that provides it, e.g. world.export." },
        sandboxId: { type: "string", description: "The id of the passing sandbox run that proved it." },
        source: { type: "string", description: "What provides it (package@version or installed module) and its license." },
      },
      required: ["capability", "tool", "sandboxId"],
    },
    run: async (args) => {
      const capability = str(args, "capability");
      const tool = str(args, "tool");
      const sandboxId = str(args, "sandboxId");
      if (!(await liveTools()).includes(tool)) return { ok: false, content: `Not registered: "${tool}" is not an executable tool, so the capability would be a claim, not a capability.` };
      const { status, data } = await call("verified", { sandboxId });
      if (status !== 200) return { ok: false, content: `Not registered: ${String(data.error ?? "no passing sandbox run with that id")}.` };
      const { default: CapabilityRegistry } = await import("../selfdev/CapabilityRegistry");
      const registry = CapabilityRegistry.getInstance();
      const entry = {
        name: str(args, "name") || capability,
        description: `Verified by resource intelligence: sandbox ${sandboxId} passed; provided by ${str(args, "source") || tool}.`,
        status: "available" as const,
        requiredTools: [tool],
        dependencies: [str(args, "source")].filter(Boolean),
        tests: [`sandbox ${sandboxId}`],
        version: new Date().toISOString().slice(0, 10),
      };
      if (registry.get(capability)) registry.update(capability, entry);
      else registry.add({ id: capability, requiredProviders: [], requiredAgents: [], requiredKnowledge: [], limitations: [], ...entry });
      return { ok: true, content: `Registered capability "${capability}" → ${tool} (proof: sandbox ${sandboxId}).`, data: registry.get(capability) };
    },
  },
  {
    id: "resources.audit",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { status, data } = await call("audit", {});
      if (status !== 200) return { ok: false, content: String(data.error ?? `audit failed (${status})`) };
      const findings = (data.findings as Array<{ name: string; kind: string; detail: string }>) ?? [];
      return {
        ok: true,
        content: `Checked ${String(data.checked)} dependencies; ${findings.length} finding(s) — nothing was changed:\n${findings.map((f) => `- ${f.name} [${f.kind}] ${f.detail}`).join("\n")}`,
        data,
      };
    },
  },
];

/* ----------------------------------------------------------------------------
 * The conversational scan: gap → reuse → discover → evaluate, no model call.
 * -------------------------------------------------------------------------- */

export interface ResourceScan {
  text: string;
  gaps: Array<{ id: string; label: string; reuseAvailable: string[] }>;
  evaluated: number;
  discovered: number;
}

const packageOf = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

/**
 * Answers "find a free open-source tool for X" / "what are you missing to
 * do X" with real findings. Returns null when there is nothing real to say
 * (no gap, no discovery result), so the caller can fall back.
 */
export async function scanForResources(prompt: string, fallbackQuery: string): Promise<ResourceScan | null> {
  const gap = await call("gap", { request: prompt, tools: await liveTools() });
  const missing = ((gap.data.missing as Array<{ id: string; label: string; reuseAvailable: string[]; search: string[] }>) ?? []);
  const covered = ((gap.data.covered as Array<{ label: string; tool: string }>) ?? []);
  // Covered and nothing missing: no search at all — never scan without purpose.
  if (covered.length && !missing.length) {
    return { text: covered.map((c) => `Already covered: ${c.label} — my ${c.tool} tool does it now. No new dependency needed.`).join("\n"), gaps: [], evaluated: 0, discovered: 0 };
  }
  const queries = missing.length ? missing.flatMap((m) => m.search.slice(0, 1)) : [fallbackQuery];
  const discoveries = await Promise.all(queries.slice(0, 2).map((query) => call("discover", { query, sources: ["npm", "github"], limit: 5 })));
  const results = discoveries.flatMap((d) => (d.data.results as Array<{ source: string; name: string; description?: string; stars?: number; license?: string }>) ?? []);
  const reuse = missing.flatMap((m) => m.reuseAvailable.map(packageOf));
  const npmNames = [...new Set([...reuse, ...results.filter((r) => r.source === "npm").map((r) => r.name)])].slice(0, 5);
  const evaluation = npmNames.length ? await call("evaluate", { names: npmNames, source: "npm" }) : { data: {} as Record<string, unknown> };
  const summary = (evaluation.data.summary as string[]) ?? [];
  const repos = results.filter((r) => r.source === "github").slice(0, 3);
  if (!missing.length && !covered.length && !summary.length && !repos.length) return null;

  const lines: string[] = [];
  for (const c of covered) lines.push(`Already covered: ${c.label} — my ${c.tool} tool does it now.`);
  for (const m of missing) {
    lines.push(`Missing capability: ${m.label}.`);
    if (m.reuseAvailable.length) lines.push(`Installed already, reusable with no new dependency: ${m.reuseAvailable.join(", ")}.`);
  }
  if (summary.length) {
    lines.push("", "Evaluated (public registry data, no keys, no model call):");
    summary.forEach((line, i) => lines.push(`${i + 1}. ${line}`));
  }
  if (repos.length) {
    lines.push("", "Also on GitHub:");
    for (const r of repos) lines.push(`- ${r.name}${r.license ? ` (${r.license})` : ""}${r.stars !== undefined ? `, ★${r.stars}` : ""} — ${(r.description ?? "").slice(0, 90)}`);
  }
  const errors = discoveries.flatMap((d) => Object.entries((d.data.errors as Record<string, string>) ?? {}).map(([s, e]) => `${s}: ${e}`));
  if (errors.length) lines.push("", `Unavailable right now: ${errors.join("; ")}.`);
  if (missing.length) {
    lines.push(
      "",
      "Next: I can prove the best option in my isolated sandbox (no network, no secrets, no access outside it) before anything touches my runtime. " +
        "Integration into production needs your approval; paid options stay blocked unless you authorize them.",
    );
  }
  return { text: lines.join("\n"), gaps: missing, evaluated: summary.length, discovered: results.length };
}
