import assert from "node:assert/strict";
import test from "node:test";

import { assetRefsFromLedger, describeAssets, fallbackCharacterAsset } from "../src/core/studio/StudioAssets";
import { engineCapabilities, recommendEngine } from "../src/core/studio/StudioEngines";
import StudioApprovals from "../src/core/studio/StudioApprovals";
import StudioLibrary, { contentHash } from "../src/core/studio/StudioLibrary";
import { asksForStudioBuild, asksForStudioChange } from "../src/core/studio/StudioIntent";
import { describeStudioWork, pendingStudioApprovals } from "../src/core/studio/StudioMemory";
import StudioPipeline from "../src/core/studio/StudioPipeline";
import { describeSecretFindings, refuseReasonForWrite, scanForSecrets } from "../src/core/studio/StudioSecurity";

/* A store with no browser in it, shaped exactly like KvStore. */
function memoryStore() {
  const data = new Map<string, unknown>();
  return {
    get<T>(key: string): T | null {
      return (data.get(key) as T | undefined) ?? null;
    },
    set(key: string, value: unknown): void {
      data.set(key, value);
    },
  };
}

/* ------------------------------ engine choice ----------------------------- */

test("a website or an application is not given a game engine", () => {
  for (const kind of ["website", "application"] as const) {
    const recommendation = recommendEngine({ kind, targets: ["web"] });
    assert.equal(recommendation.engine, "web");
    assert.equal(recommendation.supported, true);
    assert.ok(recommendation.rejected.some((item) => item.engine === "unreal"));
  }
});

test("a 3D browser game chooses web technologies and can be built here", () => {
  const recommendation = recommendEngine({ kind: "game", dimension: "3d", targets: ["web"] });
  assert.equal(recommendation.engine, "web");
  assert.equal(recommendation.supported, true);
  assert.match(recommendation.stack, /three\.js/);
  assert.ok(recommendation.rationale.length >= 2);
});

test("a native 2D mobile game with multiplayer is recommended Godot, and reported unbuildable here", () => {
  const recommendation = recommendEngine({
    kind: "game",
    dimension: "2d",
    targets: ["mobile"],
    multiplayer: true,
  });
  assert.equal(recommendation.engine, "godot");
  assert.equal(recommendation.supported, false, "no godot binary in this runtime");
  const godot = engineCapabilities().find((capability) => capability.id === "godot");
  assert.equal(godot?.status, "not-installed");
  assert.match(godot?.detail ?? "", /not installed on this runtime/);
});

test("photoreal desktop at team scale recommends Unreal and says it is not available", () => {
  const recommendation = recommendEngine({
    kind: "game",
    dimension: "3d",
    targets: ["desktop"],
    photoreal: true,
    teamSize: 20,
  });
  assert.equal(recommendation.engine, "unreal");
  assert.equal(recommendation.supported, false);
  assert.ok(recommendation.rejected.every((item) => item.reason.length > 0));
});

test("the engine probe changes the answer, not the wording", () => {
  const requirements = { kind: "game", dimension: "2d", targets: ["desktop"], multiplayer: true } as const;
  const absent = recommendEngine({ ...requirements, targets: ["desktop"] });
  const present = recommendEngine(
    { ...requirements, targets: ["desktop"] },
    { godotInstalled: true, unityInstalled: false, unrealInstalled: false },
  );
  assert.equal(absent.supported, false);
  assert.equal(present.supported, true);
  assert.equal(present.engine, "godot");
});

/* -------------------------------- library -------------------------------- */

test("the library records real versions, builds, tests and deployments", () => {
  const library = StudioLibrary.resetForTests(memoryStore());
  const project = library.create({
    name: "Aurora Site",
    kind: "website",
    engine: "web",
    stack: "static",
    root: ".lelu-studio/aurora-site",
  });
  assert.equal(library.get(project.id)?.slug, "aurora-site");

  const version = library.recordVersion(project.id, { "index.html": "<h1>A</h1>", "styles.css": "h1{}" }, "first");
  assert.equal(version?.files, 2);
  assert.match(version?.hash ?? "", /^[0-9a-f]{8}$/);

  library.recordBuild(project.id, {
    at: 1,
    ok: true,
    exitCode: 0,
    durationMs: 12,
    output: "built",
    artifact: "dist",
    bytes: 100,
  });
  library.recordTest(project.id, { at: 2, ok: true, exitCode: 0, passed: 9, failed: 0, durationMs: 40, output: "ok" });
  library.recordDeployment(project.id, { at: 3, environment: "preview", target: "deploy/preview", status: "prepared" });

  const stored = library.get("aurora-site");
  assert.equal(stored?.builds.at(-1)?.ok, true);
  assert.equal(stored?.tests.at(-1)?.passed, 9);
  assert.equal(stored?.deployments.at(-1)?.status, "prepared");
  assert.match(library.describe(project.id), /Last build exited 0 \(passed\)/);
});

test("the same file set hashes the same, and a change hashes differently", () => {
  assert.equal(contentHash({ a: "1", b: "2" }), contentHash({ b: "2", a: "1" }));
  assert.notEqual(contentHash({ a: "1" }), contentHash({ a: "2" }));
});

test("a duplicate slug is refused instead of overwriting a project", () => {
  const library = StudioLibrary.resetForTests(memoryStore());
  library.create({ name: "Same", kind: "website", engine: "web", stack: "static", root: "a" });
  assert.throws(() => library.create({ name: "Same", kind: "website", engine: "web", stack: "static", root: "b" }));
});

/* -------------------------------- approvals ------------------------------- */

test("a protected action needs a person, and an approval expires", () => {
  const approvals = StudioApprovals.resetForTests();
  assert.throws(() =>
    approvals.request({ projectId: "p1", action: "deploy", reason: "because it is ready to go live" }),
  );

  const approval = approvals.request({
    projectId: "p1",
    action: "production-deploy",
    reason: "Publish the built site to the production host.",
  });
  assert.equal(approval.status, "pending");
  assert.equal(approvals.authorizationFor("p1", "production-deploy"), null);

  approvals.decide(approval.id, "approved", "owner@example.com");
  assert.equal(approvals.authorizationFor("p1", "production-deploy")?.decidedBy, "owner@example.com");
  assert.equal(approvals.authorizationFor("p2", "production-deploy"), null, "scoped to one project");
  assert.throws(() => approvals.decide(approval.id, "approved", "someone else"), /already approved/);
});

test("denying an approval leaves no authority behind", () => {
  const approvals = StudioApprovals.resetForTests();
  const approval = approvals.request({
    projectId: "p1",
    action: "secret-management",
    reason: "Add a server API key for the payments provider.",
  });
  approvals.decide(approval.id, "denied", "owner@example.com");
  assert.equal(approvals.authorizationFor("p1", "secret-management"), null);
});

/* -------------------------------- pipeline -------------------------------- */

test("stages cannot be skipped and need real evidence", () => {
  const pipeline = StudioPipeline.resetForTests(memoryStore());
  const early = pipeline.advance({ projectId: "p1", phase: "build", evidence: { exitCode: 0 } });
  assert.equal(early.ok, false);
  assert.match(early.ok === false ? early.error : "", /generate/);

  const noEvidence = pipeline.advance({ projectId: "p1", phase: "understand", evidence: {} });
  assert.equal(noEvidence.ok, false);
  assert.match(noEvidence.ok === false ? noEvidence.error : "", /requirements/);
});

test("a full workflow records each stage in order", () => {
  const pipeline = StudioPipeline.resetForTests(memoryStore());
  const stages = [
    ["understand", { requirements: "responsive site" }],
    ["research", { findings: "three references" }],
    ["architect", { decisions: "static + Node API" }],
    ["generate", { files: 6 }],
    ["build", { exitCode: 0 }],
    ["integrate", { connections: "backend api" }],
    ["test", { exitCode: 0, passed: 9 }],
    ["debug", { outcome: "no defects found" }],
    ["preview", { url: "/api/studio/serve/x/" }],
    ["approve", { approvalId: "approval-1" }],
  ] as const;
  for (const [phase, evidence] of stages) {
    const result = pipeline.advance({ projectId: "p1", phase, evidence });
    assert.equal(result.ok, true, `${phase}: ${result.ok ? "" : result.error}`);
  }
  assert.equal(pipeline.next("p1"), "deploy");
  assert.match(pipeline.describe("p1"), /understand ✓/);
});

test("a production deployment is refused without a human approval", () => {
  const pipeline = StudioPipeline.resetForTests(memoryStore());
  for (const [phase, evidence] of [
    ["understand", { requirements: "x" }],
    ["research", { findings: "x" }],
    ["architect", { decisions: "x" }],
    ["generate", { files: 1 }],
    ["build", { exitCode: 0 }],
    ["integrate", { connections: "x" }],
    ["test", { exitCode: 0 }],
    ["debug", { outcome: "none" }],
    ["preview", { url: "/x" }],
    ["approve", { approvalId: "a" }],
  ] as const) {
    pipeline.advance({ projectId: "p1", phase, evidence });
  }
  const refused = pipeline.advance({
    projectId: "p1",
    phase: "deploy",
    evidence: { deploymentId: "d", environment: "production" },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.state.blockedBy, "production-deploy");
});

/* --------------------------------- assets --------------------------------- */

test("Session 3B's unrun Meshy jobs are reported as awaiting approval, never as models", () => {
  const refs = assetRefsFromLedger(
    {
      jobs: [
        { id: "forge-c4c1e9c2", asset: "leluverse/assets/characters/lelu_character", workflow: "multi-image-to-3d", state: "awaiting_approval", purpose: "base model" },
        { id: "forge-ca8f7b98", asset: "leluverse/assets/characters/lelu_character", workflow: "rigging", state: "awaiting_approval" },
      ],
    },
    ["leluverse/assets/characters/lelu_character/references/face.png"],
  );
  const model = refs.find((ref) => ref.id === "forge-c4c1e9c2");
  assert.equal(model?.state, "awaiting_approval");
  assert.match(model?.note ?? "", /no .*glb.* file exists/i);
  assert.ok(refs.some((ref) => ref.id === "lelu-character-references" && ref.state === "present"));
  assert.match(describeAssets(refs), /NOT in the build/);
});

test("a completed job with a real file is present; one without is called out", () => {
  const refs = assetRefsFromLedger(
    {
      jobs: [
        { id: "done-with-file", state: "completed", params: { target_formats: ["glb"] } },
        { id: "done-without-file", state: "completed", params: { target_formats: ["glb"] } },
      ],
    },
    ["models/done-with-file.glb"],
  );
  assert.equal(refs.find((ref) => ref.id === "done-with-file")?.state, "present");
  assert.equal(refs.find((ref) => ref.id === "done-without-file")?.state, "awaiting_approval");
});

test("the fallback character asset is described as procedural, not as the rig", () => {
  const fallback = fallbackCharacterAsset();
  assert.equal(fallback.source, "procedural");
  assert.match(fallback.note ?? "", /Rigged GLB not available/);
});

/* -------------------------------- security -------------------------------- */

test("a frontend file that inlines a credential is refused", () => {
  const refusal = refuseReasonForWrite('const key = "sk-abcdefghijklmnopqrstuvwxyz012345";');
  assert.ok(refusal);
  assert.match(refusal ?? "", /expose a credential/);

  const vite = refuseReasonForWrite('const stripe = "VITE_STRIPE_KEY=pk_live_1234567890abcdef";');
  assert.ok(vite);
});

test("reading a secret from the server environment is allowed", () => {
  assert.equal(refuseReasonForWrite("const key = process.env.STRIPE_SECRET_KEY;"), null);
  assert.equal(refuseReasonForWrite("export const name = 'Aurora';"), null);
  assert.deepEqual(scanForSecrets("const safe = 1;"), []);
});

test("the refusal names the line and the variable, never the value", () => {
  const findings = scanForSecrets('const x = 1;\nconst apiKey = "sk-live_abcdefghijklmnopqrstuvwxyz";');
  assert.ok(findings.length >= 1);
  const described = describeSecretFindings(findings);
  assert.match(described, /line 2/);
  assert.equal(described.includes("sk-live_abcdefghijklmnopqrstuvwxyz"), false);
});

/* --------------------------- grounded studio memory ---------------------- */

test("studio memory says nothing was built rather than inventing a project", () => {
  StudioLibrary.resetForTests(memoryStore());
  StudioPipeline.resetForTests(memoryStore());
  StudioApprovals.resetForTests();
  assert.match(describeStudioWork(), /No studio project exists yet/);
  assert.match(pendingStudioApprovals(), /No studio approval/);
});

test("studio memory reports the objective, real stage progress and a pending human approval", () => {
  const store = memoryStore();
  const library = StudioLibrary.resetForTests(store);
  const pipeline = StudioPipeline.resetForTests(store);
  const approvals = StudioApprovals.resetForTests();

  const project = library.create({
    name: "Memory Probe",
    kind: "application",
    engine: "web",
    stack: "static UI + Node HTTP API",
    root: ".lelu-studio/memory-probe",
    documentation: "A small task board for a two-person team.\nSecond line is not the objective.",
  });
  pipeline.advance({ projectId: project.id, phase: "understand", evidence: { requirements: "tasks, owners" } });
  pipeline.advance({ projectId: project.id, phase: "research", evidence: { findings: "no backend needed" } });
  approvals.request({
    projectId: project.id,
    action: "production-deploy",
    reason: "Publish the built board so the team can use it.",
  });

  const brief = describeStudioWork();
  assert.match(brief, /Memory Probe \[memory-probe\] — application on web/);
  assert.match(brief, /objective: A small task board/);
  assert.match(brief, /progress: 2\/12 stages/);
  assert.match(brief, /next: Architect/);
  assert.match(brief, /WAITING ON A PERSON: production-deploy/);
  assert.match(pendingStudioApprovals(), /production-deploy/);
});

/* ------------------------------ studio intent ---------------------------- */

test("a software build request belongs to the studio when studio_create is offered", () => {
  assert.equal(
    asksForStudioBuild(
      "Create a Focus Ledger 3E application with a dashboard, task tracking, priorities and completion statistics.",
      true,
    ),
    true,
  );
  assert.equal(asksForStudioBuild("Build me a small website with a contact form.", true), true);
  assert.equal(asksForStudioBuild("Make a 3D browser game.", true), true);
});

test("non-software project work and an unavailable studio keep the project path", () => {
  assert.equal(asksForStudioBuild("Start a project to research pendant collections.", true), false);
  assert.equal(asksForStudioBuild("Make the collection larger and add three designs.", true), false);
  assert.equal(asksForStudioBuild("Create a dashboard application.", false), false);
});

test("a follow-up change to an existing studio project keeps the studio tools", () => {
  assert.equal(asksForStudioChange("Add a status filter to the Focus Ledger.", true), true);
  assert.equal(asksForStudioChange("Fix the tests and preview the application.", true), true);
  assert.equal(asksForStudioChange("Start a project to research pendant collections.", true), false);
  assert.equal(asksForStudioChange("Add a status filter to the Focus Ledger.", false), false);
});
