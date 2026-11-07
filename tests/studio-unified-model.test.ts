/**
 * ==========================================================
 * LÉLU — ONE STUDIO MODEL
 *
 * The two studio implementations must project into ONE project
 * record without inventing anything: a document keeps every
 * revision and export, software keeps every measured build, test,
 * version and deployment, and the legacy payloads both stores
 * wrote stay readable. Exactly one architecture may run.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_STUDIO,
  PRIMARY_STUDIO,
  StudioArchitectureRegistry,
  canonicalId,
  fromCreationArtifact,
  fromSoftwareProject,
  migrateLegacyStudio,
  splitCanonicalId,
  toSoftwareProject,
  type CanonicalStudioProject,
} from "../src/core/studio/StudioModel";
import type { StudioArtifact } from "../src/core/studio/StudioStore";
import type { ArtifactSpec } from "../src/core/studio/StudioTypes";
import type { StudioProject } from "../src/core/studio/StudioProjectTypes";

const documentSpec: ArtifactSpec = {
  kind: "document",
  title: "Focus Ledger",
  blocks: [{ type: "paragraph", text: "Measured, not invented." }],
};

const artifact: StudioArtifact = {
  id: "art_abc123",
  title: "Focus Ledger",
  kind: "document",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  conversationId: "conv-7",
  revisions: [
    { rev: 1, spec: documentSpec, at: 1_700_000_000_000, note: "created", by: "user" },
    {
      rev: 2,
      spec: { ...documentSpec, title: "Focus Ledger v2" },
      at: 1_700_000_100_000,
      note: "retitled",
      by: "lelu",
      basedOn: 1,
    },
  ],
  exports: [
    {
      rev: 2,
      format: "docx",
      filename: "focus-ledger.docx",
      sha256: "abc",
      size: 4096,
      ok: true,
      at: 1_700_000_100_000,
      checks: [],
    },
  ],
  original: { name: "source.docx", format: "docx", sha256: "def", size: 2048 },
};

const softwareProject: StudioProject = {
  id: "focus-ledger",
  slug: "focus-ledger",
  name: "Focus Ledger",
  kind: "application",
  engine: "web",
  stack: "vite + react",
  root: ".lelu-studio/focus-ledger",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_200_000,
  versions: [
    { id: "v1", label: "first", createdAt: 1_700_000_050_000, files: 12, bytes: 9000, hash: "aa11" },
  ],
  builds: [
    {
      id: "b1",
      at: 1_700_000_060_000,
      ok: true,
      exitCode: 0,
      durationMs: 12_000,
      output: "built",
      artifact: "dist",
      bytes: 55_000,
    },
  ],
  tests: [{ id: "t1", at: 1_700_000_070_000, ok: true, exitCode: 0, passed: 4, failed: 0, durationMs: 300, output: "ok" }],
  assets: [{ id: "a1", source: "meshy", path: "assets/hero.glb", kind: "model", state: "present" }],
  deployments: [
    { id: "d1", at: 1_700_000_080_000, environment: "preview", target: "preview", status: "published", url: "https://x.test" },
  ],
  documentation: "# Focus Ledger",
  previewUrl: "https://x.test",
  lastOpenedAt: 1_700_000_090_000,
  discoveredBuilt: false,
  discovered: false,
};

test("a creation artifact becomes one canonical project that keeps every revision and export", () => {
  const project = fromCreationArtifact(artifact);
  assert.equal(project.architecture, "creation");
  assert.equal(project.id, canonicalId("creation", "art_abc123"));
  assert.equal(project.kind, "document");
  assert.equal(project.documents.length, 1);
  assert.equal(project.revision, 2, "the latest revision number, not a count of one");
  assert.equal(project.conversationId, "conv-7", "the chat association survives");
  const document = project.documents[0];
  assert.equal(document.revisions.length, 2, "revisions are never collapsed");
  assert.equal(document.revisions[1].basedOn, 1);
  assert.equal(document.exports[0].format, "docx");
  assert.deepEqual(document.original, artifact.original, "an imported file's bytes stay described");
});

test("a software project keeps every measured fact, and round-trips without re-measuring", () => {
  const canonical = fromSoftwareProject(softwareProject);
  assert.equal(canonical.architecture, "software");
  assert.equal(canonical.kind, "application");
  assert.equal(canonical.software?.engine, "web");
  assert.equal(canonical.software?.root, softwareProject.root);
  assert.equal(canonical.software?.builds[0].exitCode, 0);
  assert.equal(canonical.software?.tests[0].passed, 4);
  assert.equal(canonical.software?.deployments[0].status, "published");
  assert.equal(canonical.revision, 1, "the version count is the revision");

  const back = toSoftwareProject(canonical);
  assert.deepEqual(back, softwareProject, "a round trip changes nothing it measured");
});

test("a creation project does not fabricate a software record", () => {
  const canonical = fromCreationArtifact(artifact);
  assert.equal(canonical.software, undefined);
  assert.equal(toSoftwareProject(canonical), null);
});

test("legacy payloads from both stores stay readable, and unreadable entries are counted", () => {
  const fromCreationKey = migrateLegacyStudio([artifact, { nonsense: true }]);
  assert.equal(fromCreationKey.projects.length, 1);
  assert.equal(fromCreationKey.projects[0].architecture, "creation");
  assert.equal(fromCreationKey.skipped, 1, "a broken record is reported, not coerced");

  const wrapped = migrateLegacyStudio({ artifacts: [artifact] });
  assert.equal(wrapped.projects.length, 1);

  const fromLibrary = migrateLegacyStudio({ projects: [softwareProject] });
  assert.equal(fromLibrary.projects.length, 1);
  assert.equal(fromLibrary.projects[0].architecture, "software");

  const asMap = migrateLegacyStudio({ projects: { "focus-ledger": softwareProject } });
  assert.equal(asMap.projects.length, 1);

  assert.deepEqual(migrateLegacyStudio(null), { projects: [], skipped: 0 });
  assert.deepEqual(migrateLegacyStudio("garbage"), { projects: [], skipped: 1 });
});

test("canonical ids cannot collide across architectures and can be split again", () => {
  const creation = canonicalId("creation", "same");
  const software = canonicalId("software", "same");
  assert.notEqual(creation, software);
  assert.deepEqual(splitCanonicalId(creation), { architecture: "creation", localId: "same" });
  assert.deepEqual(splitCanonicalId(software), { architecture: "software", localId: "same" });
  assert.equal(splitCanonicalId("art_1"), null);
});

test("exactly one studio architecture runs, and the backup is activatable after release", () => {
  const registry = StudioArchitectureRegistry.getInstance();
  registry.reset();
  assert.equal(registry.current(), null, "nothing is running until something starts it");

  const primary = registry.ensurePrimary();
  assert.equal(primary, PRIMARY_STUDIO);
  assert.equal(registry.ensurePrimary(), PRIMARY_STUDIO, "starting the primary twice is idempotent, not a second init");
  assert.equal(registry.isActive(PRIMARY_STUDIO), true);
  assert.equal(registry.isActive(BACKUP_STUDIO), false);

  assert.throws(
    () => registry.activate(BACKUP_STUDIO),
    /already running/,
    "the backup may not start beside the primary: that is two stores",
  );

  registry.release(PRIMARY_STUDIO);
  assert.equal(registry.activate(BACKUP_STUDIO), BACKUP_STUDIO, "released primary, backup restored");
  assert.equal(registry.isActive(PRIMARY_STUDIO), false);
  registry.reset();
});

test("the canonical record is the only shape callers need to know", () => {
  const projects: CanonicalStudioProject[] = [
    fromCreationArtifact(artifact),
    fromSoftwareProject(softwareProject),
  ];
  for (const project of projects) {
    assert.equal(typeof project.id, "string");
    assert.ok(project.id.includes(":"), "identity is architecture-scoped");
    assert.ok(project.createdAt > 0 && project.updatedAt > 0);
    assert.ok(Array.isArray(project.documents));
    assert.equal(typeof project.meta, "object");
  }
});
