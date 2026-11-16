/**
 * ==========================================================
 * LÉLU — SESSION 3D: GROUNDED STUDIO MEMORY
 *
 * What LÉLU remembers about engineering is not a transcript she
 * writes about herself. It is a read model over records the studio
 * already persists from measured events:
 *
 *   • StudioLibrary  — objectives, versions, real build/test exit codes
 *   • StudioPipeline — which stage passed, with what evidence
 *   • StudioApprovals — what is waiting on a person, and until when
 *
 * Every line this module returns can be traced to one of those
 * records. Nothing is inferred, and nothing new is stored: a second
 * memory of the same work would be a second thing to disagree.
 * ==========================================================
 */

import StudioApprovals from "./StudioApprovals";
import StudioLibrary from "./StudioLibrary";
import StudioPipeline from "./StudioPipeline";
import { STUDIO_PHASE_LABELS, STUDIO_PHASES, type StudioProject } from "./StudioProjectTypes";

/** The first useful line of a failed process, not the whole log. */
function failureLine(project: StudioProject): string | null {
  const failed = [...project.builds].reverse().find((build) => !build.ok);
  if (!failed) return null;
  const line =
    failed.output
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => /error|failed|cannot|not found|exception/i.test(entry)) ??
    failed.output.split("\n").map((entry) => entry.trim()).find(Boolean) ??
    "no output was produced";
  return `build exit ${failed.exitCode}: ${line.slice(0, 200)}`;
}

function lastGoodBuild(project: StudioProject): string | null {
  const build = [...project.builds].reverse().find((record) => record.ok);
  if (!build) return null;
  return `${build.bytes} B in ${build.durationMs} ms`;
}

function projectLine(project: StudioProject, pipeline: StudioPipeline, approvals: StudioApprovals): string {
  const state = pipeline.state(project.id);
  const completed = pipeline.completed(project.id);
  const next = pipeline.next(project.id);
  const pending = approvals.pending(project.id);
  const failedTest = [...project.tests].reverse().find((test) => !test.ok);

  const objective =
    project.documentation.trim().split("\n")[0]?.slice(0, 220) || "No objective recorded yet.";

  const parts = [
    `- ${project.name} [${project.slug}] — ${project.kind} on ${project.engine}.`,
    `  objective: ${objective}`,
    `  progress: ${completed.length}/${STUDIO_PHASES.length} stages` +
      (completed.length
        ? ` (${completed.map((phase) => STUDIO_PHASE_LABELS[phase]).join(", ")})`
        : " — no stage has passed yet") +
      `; next: ${STUDIO_PHASE_LABELS[next] ?? next}.`,
  ];

  if (project.versions.length > 0) {
    const version = project.versions.at(-1)!;
    parts.push(`  current version: ${version.label} — ${version.files} files, ${version.bytes} B.`);
  }
  if (failedTest) {
    parts.push(`  last failing test run: exit ${failedTest.exitCode}, ${failedTest.failed} failed.`);
  }
  if (project.tests.length > 0) {
    const test = project.tests.at(-1)!;
    parts.push(`  last test run: ${test.passed} passed, ${test.failed} failed (exit ${test.exitCode}).`);
  }
  const failure = failureLine(project);
  if (failure) parts.push(`  last build failure: ${failure}`);
  const good = lastGoodBuild(project);
  if (good) parts.push(`  last successful build: ${good}.`);
  if (project.previewUrl) parts.push(`  live preview: ${project.previewUrl}`);
  if (pending.length > 0) {
    parts.push(
      `  WAITING ON A PERSON: ${pending
        .map((approval) => `${approval.action} (${approval.id}, ${Math.max(0, Math.round((approval.expiresAt - Date.now()) / 60000))} min left)`)
        .join("; ")}.`,
    );
  }
  if (state.blockedBy) {
    parts.push(`  workflow is blocked on ${state.blockedBy}; LÉLU cannot grant it.`);
  }
  if (project.deployments.length > 0) {
    const deployment = project.deployments.at(-1)!;
    parts.push(
      `  last deployment: ${deployment.environment} ${deployment.status} at ${deployment.target || "no target"}.`,
    );
  }
  return parts.join("\n");
}

/**
 * A compact, grounded engineering state for the model's context.
 * Read-only: assembling context never builds, tests or deploys anything.
 */
export function describeStudioWork(limit = 3): string {
  try {
    const library = StudioLibrary.getInstance();
    const pipeline = StudioPipeline.getInstance();
    const approvals = StudioApprovals.getInstance();
    const projects = library.list().slice(0, limit);

    if (projects.length === 0) {
      return "No studio project exists yet. Nothing has been built in the studio.";
    }

    return projects.map((project) => projectLine(project, pipeline, approvals)).join("\n");
  } catch {
    return "Studio state is unavailable in this runtime.";
  }
}

/** The pending approvals across every project, from the live queue. */
export function pendingStudioApprovals(): string {
  try {
    const pending = StudioApprovals.getInstance()
      .list()
      .filter((approval) => approval.status === "pending");
    if (pending.length === 0) return "No studio approval is waiting on a person.";
    return pending
      .map(
        (approval) =>
          `- ${approval.action} for ${approval.projectId}: ${approval.reason} (${approval.id})`,
      )
      .join("\n");
  } catch {
    return "Studio approvals are unavailable in this runtime.";
  }
}
