/**
 * ==========================================================
 * LÉLU
 * ENGINEERING TOOLSET — the structured tool surface for the
 * Engineering Agent and the self-development loop.
 *
 * Every tool returns a structured `ToolResult` (ok / output /
 * data / error) and is recorded in EngineeringMemory, so tool
 * execution is observable and retrievable — never a black box.
 *
 *   filesystem  → list / read / search / create / edit / delete /
 *                 move files in the virtual sandbox
 *   development → run / test / syntax-check / preview (isolated
 *                 worker) + typecheck / test / inspect (workspace)
 *   versioning  → snapshot / diff / rollback / candidate patch
 *   analysis    → architecture / capabilities / diagnostics /
 *                 previous attempts
 *
 * All tools respect the sandbox boundary: file edits touch only
 * SandboxFS, execution happens in the isolated worker, and
 * workspace commands are whitelisted + autonomy-gated.
 * ==========================================================
 */

import SandboxFS from "../engineering/SandboxFS";
import SandboxRuntime from "../engineering/SandboxRuntime";
import WorkspaceRuntime from "../engineering/WorkspaceRuntime";
import VersionHistory from "./VersionHistory";
import SelfCode from "./SelfCode";
import ArchitectureMap from "./ArchitectureMap";
import CapabilityRegistry from "./CapabilityRegistry";
import SelfDiagnostics from "./SelfDiagnostics";
import EngineeringMemory, { normalizeTopic } from "./EngineeringMemory";

export interface ToolResult {
  ok: boolean;
  tool: string;
  output: string;
  data?: unknown;
  error?: string;
}

export default class EngineeringToolset {
  private static instance: EngineeringToolset | null = null;

  private readonly fs = SandboxFS.getInstance();
  private readonly runtime = SandboxRuntime.getInstance();
  private readonly workspace = WorkspaceRuntime.getInstance();
  private readonly versions = VersionHistory.getInstance();
  private readonly selfCode = SelfCode.getInstance();
  private readonly memory = EngineeringMemory.getInstance();

  private constructor() {}

  public static getInstance(): EngineeringToolset {
    if (!EngineeringToolset.instance) {
      EngineeringToolset.instance = new EngineeringToolset();
    }
    return EngineeringToolset.instance;
  }

  /* ------------------------------ helpers ------------------------------ */

  private result(tool: string, ok: boolean, output: string, data?: unknown, error?: string): ToolResult {
    this.memory.record({
      kind: "tool-run",
      topic: normalizeTopic(tool),
      summary: output.slice(0, 160),
      outcome: ok ? "success" : "failure",
      detail: error,
    });
    return { ok, tool, output, data, error };
  }

  /* ------------------------------ filesystem ---------------------------- */

  public listFiles(): ToolResult {
    const paths = this.fs.filePaths();
    return this.result(
      "fs.list",
      true,
      `${paths.length} file(s) in the sandbox:\n${paths.map((path) => `  ${path}`).join("\n") || "  (empty)"}`,
      { paths },
    );
  }

  public readFile(path: string): ToolResult {
    const content = this.fs.read(path);
    return content === null
      ? this.result("fs.read", false, `File not found: ${path}`, undefined, "not found")
      : this.result("fs.read", true, `${path} (${content.length} chars)`, { path, content });
  }

  public searchFiles(query: string): ToolResult {
    const queryLower = query.toLowerCase();
    const matches = this.fs
      .filePaths()
      .filter((path) => path.toLowerCase().includes(queryLower))
      .sort();
    const contentMatches: string[] = [];
    for (const path of this.fs.filePaths()) {
      const content = this.fs.read(path);
      if (content && content.toLowerCase().includes(queryLower)) {
        contentMatches.push(path);
      }
    }
    const all = [...new Set([...matches, ...contentMatches])];
    return this.result(
      "fs.search",
      true,
      `${all.length} match(es) for "${query}":\n${all.map((path) => `  ${path}`).join("\n") || "  (none)"}`,
      { matches: all },
    );
  }

  public createFile(path: string, content = ""): ToolResult {
    const write = this.fs.write(path, content);
    return this.result("fs.create", write.ok, write.ok ? `Created ${path}.` : `Create failed: ${write.error}`, { path });
  }

  public editFile(path: string, content: string): ToolResult {
    const exists = this.fs.read(path) !== null;
    const write = this.fs.write(path, content);
    return this.result(
      "fs.edit",
      write.ok,
      write.ok ? `Edited ${path}.` : `Edit failed: ${write.error}`,
      { path, existedBefore: exists },
    );
  }

  public deleteFile(path: string): ToolResult {
    this.fs.remove(path);
    return this.result("fs.delete", true, `Deleted ${path}.`, { path });
  }

  public moveFile(from: string, to: string): ToolResult {
    const content = this.fs.read(from);
    if (content === null) {
      return this.result("fs.move", false, `Source not found: ${from}`, undefined, "not found");
    }
    const write = this.fs.write(to, content);
    if (!write.ok) {
      return this.result("fs.move", false, `Move failed: ${write.error}`);
    }
    this.fs.remove(from);
    return this.result("fs.move", true, `Moved ${from} → ${to}.`, { from, to });
  }

  /* ------------------------------ development --------------------------- */

  public async runFile(path: string): Promise<ToolResult> {
    const run = await this.runtime.runFile(path);
    return this.result(
      "dev.run",
      run.ok,
      `${run.ok ? "Run succeeded" : `Run failed (exit ${run.exitCode})`} in ${run.durationMs} ms.\n\n${run.stdout}${run.stderr ? `\n[stderr]\n${run.stderr}` : ""}`,
      run,
    );
  }

  public async runTests(): Promise<ToolResult> {
    const run = await this.runtime.test();
    const passed = run.tests.filter((test) => test.passed).length;
    return this.result(
      "dev.test",
      run.ok,
      `${passed}/${run.tests.length} test(s) passed (exit ${run.exitCode}).\n\n${run.stdout}${run.stderr ? `\n[stderr]\n${run.stderr}` : ""}`,
      run,
    );
  }

  public async syntaxCheck(): Promise<ToolResult> {
    const run = await this.runtime.syntaxCheck();
    const failed = run.syntax.filter((entry) => !entry.ok);
    return this.result(
      "dev.syntax",
      run.ok,
      `${run.syntax.length - failed.length}/${run.syntax.length} file(s) compile.\n${failed.map((entry) => `  ✗ ${entry.path}: ${entry.error}`).join("\n")}`,
      run,
    );
  }

  public async previewHtml(): Promise<ToolResult> {
    const run = await this.runtime.preview();
    return this.result(
      "dev.preview",
      run.previewHtml !== null,
      run.previewHtml !== null ? `Assembled ${run.previewHtml.length} chars of preview HTML.` : run.stdout,
      { previewHtml: run.previewHtml },
    );
  }

  public async workspaceTypecheck(): Promise<ToolResult> {
    const run = await this.workspace.run("typecheck");
    return this.result(
      "dev.typecheck",
      run.ok,
      run.ok ? `Typecheck passed in ${run.durationMs} ms.` : `Typecheck failed.\n\n${run.stderr || run.stdout}`,
      run,
    );
  }

  public async workspaceTest(): Promise<ToolResult> {
    const run = await this.workspace.run("test");
    return this.result("dev.workspace-test", run.ok, run.ok ? "Workspace tests passed." : run.stdout || run.stderr, run);
  }

  public async workspaceInspect(): Promise<ToolResult> {
    const run = await this.workspace.run("inspect");
    return this.result("dev.inspect", run.ok, run.stdout || run.stderr, run);
  }

  /* ------------------------------ versioning ---------------------------- */

  public createSnapshot(label: string, improvementId?: string): ToolResult {
    const snapshot = this.versions.snapshotSandbox(label, improvementId);
    return this.result("version.snapshot", true, `Snapshot "${label}" (${Object.keys(snapshot.files).length} file(s)).`, snapshot);
  }

  public async diffWorkingCopy(sandboxPath: string): Promise<ToolResult> {
    const patch = await this.selfCode.patchFor(sandboxPath);
    return patch
      ? this.result("version.diff", true, patch.changed ? `Diff for ${patch.path}:\n${patch.diff}` : `${patch.path} unchanged.`, patch)
      : this.result("version.diff", false, `No working copy diff for ${sandboxPath}.`, undefined, "no working copy");
  }

  public rollback(snapshotId: string): ToolResult {
    const rollback = this.versions.rollback(snapshotId);
    return this.result("version.rollback", rollback.ok, rollback.ok ? "Sandbox rolled back." : `Rollback failed: ${rollback.error}`, rollback);
  }

  public async createCandidate(improvementId?: string): Promise<ToolResult> {
    const patch = await this.selfCode.buildPatchText();
    const snapshot = this.versions.snapshotSandbox(`Candidate ${new Date().toLocaleString()}`, improvementId);
    return this.result(
      "version.candidate",
      true,
      `Candidate created (snapshot ${snapshot.id}). Patch:\n\n${patch.slice(0, 6000)}`,
      { snapshot, patch },
    );
  }

  /* ------------------------------ analysis ------------------------------ */

  public inspectArchitecture(): ToolResult {
    const map = ArchitectureMap.getInstance();
    const lines = map.list().map((subsystem) => `- ${subsystem.id}: ${subsystem.name} [${subsystem.status}] → provides ${subsystem.provides.join(", ")}`);
    return this.result("analysis.architecture", true, `${map.list().length} subsystem(s):\n${lines.join("\n")}`, map.snapshot());
  }

  public inspectCapabilities(): ToolResult {
    const registry = CapabilityRegistry.getInstance();
    const counts = registry.statusCounts();
    return this.result(
      "analysis.capabilities",
      true,
      `Capability statuses: ${Object.entries(counts)
        .map(([status, count]) => `${status}=${count}`)
        .join(", ")}.`,
      registry.list(),
    );
  }

  public async inspectDiagnostics(): Promise<ToolResult> {
    const report = await SelfDiagnostics.getInstance().run();
    return this.result(
      "analysis.diagnostics",
      report.healthy,
      `Diagnostics: ${report.summary.ok} ok, ${report.summary.info} info, ${report.summary.warn} warn, ${report.summary.error} error.`,
      report,
    );
  }

  public inspectPreviousAttempts(topic?: string): ToolResult {
    const entries = topic ? this.memory.retrieve(topic) : this.memory.list().slice(0, 40);
    return this.result(
      "analysis.history",
      true,
      `${entries.length} previous engineering record(s)${topic ? ` for "${topic}"` : ""}:\n${entries
        .map((entry) => `- [${entry.outcome}] ${entry.topic}: ${entry.summary}`)
        .join("\n")}`,
      entries,
    );
  }

  /** All tool-run history (the execution log). */
  public executionLog(): ToolResult {
    const entries = this.memory.list().filter((entry) => entry.kind === "tool-run").slice(0, 60);
    return this.result("analysis.log", true, `${entries.length} tool run(s) recorded.`, entries);
  }
}
