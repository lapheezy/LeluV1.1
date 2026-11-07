/**
 * ==========================================================
 * LÉLU — SESSION 3C: STUDIO TOOL EXECUTORS
 *
 * The studio's hands for LÉLU's own cognition. Every executor calls the
 * real runtime and records what came back in the project library and the
 * workflow — no executor writes "done" on its own authority.
 *
 * Approval is the exception, deliberately: the model can ASK for one and
 * can never grant it. There is no executor here that decides an approval.
 * ==========================================================
 */

import type { ToolExecutionResult, ToolExecutor } from "../tools/ToolDispatcher";
import StudioApprovals, { PROTECTED_ACTION_LABELS } from "./StudioApprovals";
import StudioLibrary from "./StudioLibrary";
import { fetchPersistedStudioProjects } from "./StudioPersistence";
import StudioPipeline from "./StudioPipeline";
import StudioRuntime from "./StudioRuntime";
import { describeAssets } from "./StudioAssets";
import { engineCapabilities, recommendEngine } from "./StudioEngines";
import {
  STUDIO_PHASE_LABELS,
  STUDIO_PHASES,
  type StudioPhase,
  type StudioRequirements,
} from "./StudioProjectTypes";

function str(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? (args[key] as string) : "";
}

function num(args: Record<string, unknown>, key: string, fallback: number): number {
  return typeof args[key] === "number" ? (args[key] as number) : fallback;
}

function projectRef(args: Record<string, unknown>): string {
  return str(args, "project") || str(args, "slug");
}

function requirementsFrom(args: Record<string, unknown>): StudioRequirements {
  const kind = str(args, "kind");
  const targets: StudioRequirements["targets"] = Array.isArray(args.targets)
    ? (args.targets.map(String).filter((target) =>
        ["web", "pwa", "mobile", "desktop"].includes(target),
      ) as StudioRequirements["targets"])
    : ["web"];
  return {
    kind: kind === "application" || kind === "game" ? kind : "website",
    dimension: str(args, "dimension") === "2d" ? "2d" : str(args, "dimension") === "3d" ? "3d" : undefined,
    targets,
    multiplayer: args.multiplayer === true,
    photoreal: args.photoreal === true,
    teamSize: num(args, "teamSize", 1),
    assetPipeline: args.assetPipeline === true,
  };
}

export const studioToolExecutors: ToolExecutor[] = [
  {
    id: "studio.engine",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["website", "application", "game"] },
        dimension: { type: "string", enum: ["2d", "3d"] },
        targets: {
          type: "array",
          items: { type: "string", enum: ["web", "pwa", "mobile", "desktop"] },
          description: "Where the result must run.",
        },
        multiplayer: { type: "boolean" },
        photoreal: { type: "boolean" },
        teamSize: { type: "number", description: "People who will work in the engine editor." },
      },
      required: ["kind"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const requirements = requirementsFrom(args);
      const runtime = StudioRuntime.getInstance();
      const health = await runtime.health();
      const probe = {
        godotInstalled: health.capabilities.godot,
        unityInstalled: health.capabilities.unity,
        unrealInstalled: health.capabilities.unreal,
      };
      const recommendation = recommendEngine(requirements, probe);
      const capabilities = engineCapabilities(probe);
      return {
        ok: true,
        content:
          `Engine: ${recommendation.label} (${recommendation.supported ? "buildable here" : "NOT buildable in this runtime"}).\n` +
          `Stack: ${recommendation.stack}\n` +
          recommendation.rationale.map((line) => `• ${line}`).join("\n") +
          "\nRejected: " +
          recommendation.rejected
            .map((item) => `${item.label} — ${item.reason}`)
            .join(" | ") +
          "\nRuntime capabilities: " +
          capabilities.map((capability) => `${capability.id}: ${capability.status}`).join(", "),
        data: { recommendation, capabilities, health },
      };
    },
  },
  {
    id: "studio.list",
    parameters: { type: "object", properties: {} },
    run: async (): Promise<ToolExecutionResult> => {
      const library = StudioLibrary.getInstance();
      const disk = await fetchPersistedStudioProjects();
      if (disk !== null) {
        if (disk.length === 0) {
          return {
            ok: true,
            content:
              "No studio project exists on disk yet. Use studio.create to scaffold a website, application or game " +
              "(the runtime copies a real template onto disk).",
          };
        }
        const diskBySlug = new Map(disk.map((entry) => [entry.slug, entry]));
        const projects = library.syncFromDisk(disk);
        return {
          ok: true,
          content: projects
            .map((project) => {
              const entry = diskBySlug.get(project.slug);
              if (project.discovered) {
                return `${project.name} [${project.slug}] — on disk, ${entry?.files ?? 0} files, ` +
                  `${entry?.built ? "built" : "not built"}, last modified ` +
                  `${new Date(entry?.updatedAt ?? project.updatedAt).toISOString()}`;
              }
              return `${project.name} [${project.slug}] — ${project.kind}, ${project.engine}, ` +
                `${project.versions.length} version(s), last build ${project.builds.at(-1)?.ok ? "passed" : "none/failed"}, ` +
                `disk ${entry?.files ?? 0} files${entry?.built ? ", built" : ""}`;
            })
            .join("\n"),
          data: projects,
        };
      }
      const recorded = library.list();
      if (recorded.length === 0) {
        return {
          ok: true,
          content:
            "No studio project exists yet. Use studio.create to scaffold a website, application or game " +
            "(the runtime copies a real template onto disk).",
        };
      }
      return {
        ok: true,
        content: recorded
          .map(
            (project) =>
              `${project.name} [${project.slug}] — ${project.kind}, ${project.engine}, ` +
              `${project.versions.length} version(s), last build ${project.builds.at(-1)?.ok ? "passed" : "none/failed"}`,
          )
          .join("\n"),
        data: recorded,
      };
    },
  },
  {
    id: "studio.create",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["website", "application", "game"] },
        name: { type: "string", description: "Human-readable project name." },
        dimension: { type: "string", enum: ["2d", "3d"] },
      },
      required: ["kind", "name"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const runtime = StudioRuntime.getInstance();
      const kind = str(args, "kind");
      const name = str(args, "name");
      if (kind !== "website" && kind !== "application" && kind !== "game") {
        return { ok: false, content: "kind must be website, application or game." };
      }
      if (!name.trim()) return { ok: false, content: "A project needs a name." };

      const recommendation = recommendEngine(requirementsFrom({ ...args, kind }));
      const created = await runtime.scaffold({ kind, name, requirements: args });
      if (!created.ok || !created.slug) {
        return { ok: false, content: `Nothing was created: ${created.error ?? "the runtime refused."}` };
      }
      const project = StudioLibrary.getInstance().create({
        name,
        kind,
        engine: recommendation.engine,
        stack: recommendation.stack,
        root: created.root ?? `.lelu-studio/${created.slug}`,
        documentation: `${name} — scaffolded from the ${kind} template. ${recommendation.rationale[0]}`,
      });
      if (kind === "game") {
        const assets = await runtime.assets();
        if (assets.ok) {
          StudioLibrary.getInstance().recordAssets(project.id, assets.assets as never);
        }
      }
      return {
        ok: true,
        content:
          `Created "${project.name}" (${created.slug}) with ${created.files} real files at ${created.root}. ` +
          `Engine: ${recommendation.label}. Next: studio.build, then studio.test.`,
        data: { project, created },
      };
    },
  },
  {
    id: "studio.files",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project slug or id." },
        path: { type: "string", description: "Directory inside the project, default '.'." },
      },
      required: ["project"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const slug = project?.slug ?? ref;
      const listing = await StudioRuntime.getInstance().tree(slug, str(args, "path") || ".");
      if (!listing.ok) return { ok: false, content: `Nothing was listed: ${listing.error}` };
      return {
        ok: true,
        content: listing.entries
          .map((entry) => `${entry.type === "dir" ? "dir " : "file"} ${entry.path}${entry.size ? ` (${entry.size} B)` : ""}`)
          .join("\n"),
        data: { entries: listing.entries },
      };
    },
  },
  {
    id: "studio.read",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        path: { type: "string" },
      },
      required: ["project", "path"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const read = await StudioRuntime.getInstance().read(project?.slug ?? ref, str(args, "path"));
      if (!read.ok) return { ok: false, content: `Nothing was read: ${read.error}` };
      return { ok: true, content: read.content ?? "" };
    },
  },
  {
    id: "studio.write",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["project", "path", "content"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const content = str(args, "content");
      if (!content) return { ok: false, content: "A write needs content; nothing was written." };
      const written = await StudioRuntime.getInstance().write(project?.slug ?? ref, str(args, "path"), content);
      if (!written.ok) return { ok: false, content: `Not written: ${written.error}` };
      return { ok: true, content: `Wrote ${str(args, "path")} (${content.length} characters) in ${project?.slug ?? ref}.` };
    },
  },
  {
    id: "studio.build",
    parameters: {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const slug = project?.slug ?? ref;
      const built = await StudioRuntime.getInstance().build(slug);
      if (project) {
        const version = (built as { version?: { files: number; bytes: number; hash: string } }).version;
        if (version) {
          StudioLibrary.getInstance().recordVersionManifest(project.id, {
            ...version,
            note: built.ok ? "source at the last passing build" : "source at the last build attempt",
          });
        }
        StudioLibrary.getInstance().recordBuild(project.id, {
          at: Date.now(),
          ok: built.ok,
          exitCode: built.exitCode,
          durationMs: built.durationMs,
          output: built.output,
          artifact: built.artifact,
          bytes: built.bytes,
        });
        StudioPipeline.getInstance().advance({
          projectId: project.id,
          phase: "build",
          evidence: { exitCode: built.exitCode, artifact: built.artifact, bytes: built.bytes },
          ok: built.ok,
          note: built.ok ? "build passed" : `build exited ${built.exitCode}`,
        });
      }
      return {
        ok: built.ok,
        content:
          `Build exited ${built.exitCode} in ${built.durationMs} ms.` +
          (built.artifact ? ` Output: ${built.artifact} (${built.bytes} bytes).` : " No build output was written.") +
          `\n\n${built.output.slice(0, 4000)}`,
        data: built,
      };
    },
  },
  {
    id: "studio.test",
    parameters: {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const slug = project?.slug ?? ref;
      const run = await StudioRuntime.getInstance().test(slug);
      if (project) {
        StudioLibrary.getInstance().recordTest(project.id, {
          at: Date.now(),
          ok: run.ok,
          exitCode: run.exitCode,
          passed: run.passed,
          failed: run.failed,
          durationMs: run.durationMs,
          output: run.output,
        });
        StudioPipeline.getInstance().advance({
          projectId: project.id,
          phase: "test",
          evidence: { exitCode: run.exitCode, passed: run.passed, failed: run.failed },
          ok: run.ok,
        });
      }
      return {
        ok: run.ok,
        content:
          `Tests: ${run.passed} passed, ${run.failed} failed (exit ${run.exitCode}) in ${run.durationMs} ms.\n\n` +
          run.output.slice(0, 4000),
        data: run,
      };
    },
  },
  {
    id: "studio.preview",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        build: { type: "boolean", description: "Build first (default true)." },
      },
      required: ["project"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const slug = project?.slug ?? ref;
      const runtime = StudioRuntime.getInstance();
      if (args.build !== false) {
        const built = await runtime.build(slug);
        if (!built.ok) {
          return {
            ok: false,
            content: `No preview: the build exited ${built.exitCode}, so there is nothing to serve.`,
            data: built,
          };
        }
      }
      const url = runtime.previewUrl(slug);
      const served = await fetch(url, { method: "GET" }).then(
        (response) => response.ok,
        () => false,
      );
      if (!served) {
        return {
          ok: false,
          content: `The preview URL ${url} did not respond. The build output may be missing.`,
        };
      }
      if (project) {
        StudioLibrary.getInstance().update(project.id, { previewUrl: url });
        StudioPipeline.getInstance().advance({
          projectId: project.id,
          phase: "preview",
          evidence: { url },
          note: "preview served from the real build output",
        });
      }
      return { ok: true, content: `Preview is live at ${url} — served from ${slug}/dist.`, data: { url } };
    },
  },
  {
    id: "studio.assets",
    parameters: { type: "object", properties: {} },
    run: async (): Promise<ToolExecutionResult> => {
      const assets = await StudioRuntime.getInstance().assets();
      if (!assets.ok) return { ok: false, content: assets.error ?? "Assets unavailable." };
      return {
        ok: true,
        content:
          describeAssets(assets.assets as never) +
          "\n" +
          assets.assets
            .map((asset) => `- ${asset.id} [${asset.state}] ${asset.source}: ${asset.note ?? asset.path}`)
            .join("\n"),
        data: assets,
      };
    },
  },
  {
    id: "studio.approval",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        action: {
          type: "string",
          enum: Object.keys(PROTECTED_ACTION_LABELS),
        },
        reason: { type: "string", description: "Exactly what would happen, and why." },
      },
      required: ["project", "action", "reason"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const slug = project?.slug ?? ref;
      const runtime = StudioRuntime.getInstance();
      const requested = await runtime.requestApproval({
        slug,
        action: str(args, "action"),
        reason: str(args, "reason"),
      });
      if (!requested.ok) return { ok: false, content: `No approval was requested: ${requested.error}` };
      const client = StudioApprovals.getInstance().request({
        projectId: project?.id ?? ref,
        action: str(args, "action"),
        reason: str(args, "reason"),
      });
      return {
        ok: true,
        content:
          `Approval requested (${client.id}) for ${PROTECTED_ACTION_LABELS[client.action]}. ` +
          "It is pending — a person has to approve it in the Studio panel. Nothing was changed.",
        data: { approval: client, serverApprovalId: requested.approvalId },
      };
    },
  },
  {
    id: "studio.deploy",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        environment: { type: "string", enum: ["preview", "production"] },
        approvalId: { type: "string", description: "Required for production." },
      },
      required: ["project", "environment"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const slug = project?.slug ?? ref;
      const environment = str(args, "environment") === "production" ? "production" : "preview";
      const deployed = await StudioRuntime.getInstance().deploy({
        slug,
        environment,
        approvalId: str(args, "approvalId") || undefined,
      });
      if (project) {
        StudioLibrary.getInstance().recordDeployment(project.id, {
          at: Date.now(),
          environment,
          target: deployed.target,
          status: deployed.status,
          url: deployed.url,
          note: deployed.note ?? deployed.error,
        });
        StudioPipeline.getInstance().advance({
          projectId: project.id,
          phase: "deploy",
          evidence: { deploymentId: deployed.target || "none", environment, status: deployed.status },
          ok: deployed.ok && deployed.status !== "blocked",
        });
      }
      if (!deployed.ok) {
        return {
          ok: false,
          content:
            `Not deployed: ${deployed.error}` +
            (environment === "production"
              ? " A production deployment needs a live human approval; ask with studio.approval first."
              : ""),
          data: deployed,
        };
      }
      return {
        ok: true,
        content: `${environment} deployment ${deployed.status} at ${deployed.target}. ${deployed.note ?? ""}`,
        data: deployed,
      };
    },
  },
  {
    id: "studio.workflow",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        action: { type: "string", enum: ["status", "advance"] },
        phase: { type: "string", enum: [...STUDIO_PHASES] },
        evidence: {
          type: "object",
          description: "Stage evidence: requirements, findings, decisions, files, exitCode, connections, outcome, approvalId, url, deploymentId, plan.",
        },
        note: { type: "string" },
      },
      required: ["project"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const ref = projectRef(args);
      const project = StudioLibrary.getInstance().get(ref);
      const pipeline = StudioPipeline.getInstance();
      const projectId = project?.id ?? ref;
      if (str(args, "action") !== "advance") {
        return {
          ok: true,
          content:
            pipeline.describe(projectId) +
            ` Completed stages: ${pipeline.completed(projectId).join(", ") || "none"}.`,
          data: { state: pipeline.state(projectId), next: pipeline.next(projectId) },
        };
      }
      const phase = str(args, "phase") as StudioPhase;
      if (!STUDIO_PHASES.includes(phase)) {
        return { ok: false, content: `Unknown phase "${str(args, "phase")}".` };
      }
      const evidence =
        args.evidence && typeof args.evidence === "object"
          ? (args.evidence as Record<string, unknown>)
          : {};
      const result = pipeline.advance({
        projectId,
        phase,
        evidence,
        note: str(args, "note") || undefined,
      });
      if (!result.ok) return { ok: false, content: `Not recorded: ${result.error}`, data: result.state };
      return {
        ok: true,
        content: `Recorded ${STUDIO_PHASE_LABELS[phase]}. ${pipeline.describe(projectId)}`,
        data: result.state,
      };
    },
  },
];
