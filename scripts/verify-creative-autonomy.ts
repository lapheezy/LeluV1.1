/**
 * M16.3 WP03 — creative autonomy evidence at DISPATCH level.
 *
 * Runs the real path: intent → couture.objects → dispatchToolCall →
 * AutonomyGate → CreativeObjects store → persisted state. No mocked executor,
 * no direct store writes from the test, no model.
 *
 * Evidence class: DISPATCH (plus TEST for the assertions).
 * It is NOT browser/visual evidence — q.v. the WP03 report.
 *
 *   npx tsx scripts/verify-creative-autonomy.ts
 */

/* A browser storage shim, installed BEFORE the store module loads, so the same
 * persistence path the app uses (localStorage) is exercised and a reload can be
 * simulated by re-reading it. */
const memory = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
} as Storage;

type Result = { ok: boolean; content: string; data?: unknown };

async function main() {
  const { default: CreativeObjects } = await import("../src/core/couture/objects");
  const { default: CreativeObjectBridge } = await import("../src/core/cosmos/CreativeObjectBridge");
  const { registerCoutureTools } = await import("../src/core/couture/CoutureTools");
  const { dispatchToolCall, toolNameForModel } = await import("../src/core/tools/ToolDispatcher");
  const { compileCreativeObjectPlan } = await import("../src/core/couture/intents");
  const { getCreativeSelection } = await import("../src/core/couture/selection");
  const { objectWorldBox } = await import("../src/core/couture/layout");

  registerCoutureTools();
  const store = CreativeObjects.getInstance();

  const run = async (tool: string, args: Record<string, unknown>, index = 0): Promise<Result> => {
    const result = await dispatchToolCall(
      { id: `wp03-${index}-${Date.now()}`, name: toolNameForModel(tool), arguments: args },
      `wp03-${Date.now()}`,
      undefined as never,
      { path: "direct" },
    );
    return result as Result;
  };

  const steps: Array<Record<string, unknown>> = [];
  const check = (name: string, ok: boolean, detail: unknown) => {
    steps.push({ name, ok, detail });
    if (!ok) throw new Error(`FAILED: ${name} — ${JSON.stringify(detail)}`);
  };

  /* ---- build the three objects through the real design tool ---- */
  const chair = await run("couture.design", { action: "product", template: "chair", name: "Oak side chair" });
  const pendant = await run("couture.design", { action: "product", template: "pendant", name: "Copper pendant" });
  const gown = await run("couture.design", {
    action: "build-garment",
    name: "Cosmos gown",
    material: "velvet-silk",
    style: { category: "gown", sleeves: "long", length: "floor", silhouette: "fit-and-flare" },
  }, 1);
  check("three creations built", chair.ok && pendant.ok && gown.ok, [chair.content.slice(0, 80), pendant.ok, gown.ok]);

  const chairId = (chair.data as { objectId: string }).objectId;
  const pendantId = (pendant.data as { objectId: string }).objectId;
  const gownId = (gown.data as { objectId: string }).objectId;

  for (const [i, id] of [chairId, pendantId, gownId].entries()) {
    const placed = await run("couture.objects", { action: "place-in-cosmos", object: id, position: [i * 900 - 900, -2600, 0] }, 10 + i);
    check(`placed ${id}`, placed.ok, placed.content);
  }

  /* ---- 1. selection is a pointer, never a mutation ---- */
  const chairBefore = store.get(chairId)!;
  const revisionBefore = chairBefore.revision;
  const selected = await run("couture.objects", { action: "select", object: "chair" }, 20);
  const selectVerification = (selected.data as { verification: { storeChanged: boolean; before: { revision: number }; after: { revision: number } } }).verification;
  check("select resolved the canonical chair", getCreativeSelection()?.objectId === chairId, getCreativeSelection());
  check("select changed nothing", selectVerification.storeChanged === false && selectVerification.after.revision === revisionBefore, selectVerification);

  /* ---- 2. focus requests framing without touching the object ---- */
  const focused = await run("couture.objects", { action: "focus", object: chairId }, 21);
  check("focus executed", focused.ok, focused.content);

  /* ---- 3. rotation, with verification of the authoritative state ---- */
  const rotated = await run("couture.objects", { action: "rotate", object: chairId, rotation: [0, 0, 90] }, 22);
  const rotateVerification = (rotated.data as { verification: { after: { rotation: number[] }; storeChanged: boolean; persisted: boolean } }).verification;
  check("rotation committed", rotated.ok && rotateVerification.after.rotation[2] === 90, rotateVerification);
  check("rotation reported as a real store change", rotateVerification.storeChanged && rotateVerification.persisted, rotateVerification);
  check("rotation did not move it", JSON.stringify(store.get(chairId)!.transform.position) === JSON.stringify(chairBefore.transform.position), store.get(chairId)!.transform.position);

  /* ---- 4. scaling ---- */
  const scaled = await run("couture.objects", { action: "scale", object: "pendant", scale: 2 }, 23);
  const scaleVerification = (scaled.data as { verification: { after: { scale: number[] } } }).verification;
  check("pendant doubled", scaled.ok && Math.abs(scaleVerification.after.scale[0] - 2) < 1e-6, scaleVerification.after.scale);
  check("pendant kept its identity", store.get(pendantId)?.id === pendantId, pendantId);

  /* ---- 5. relative placement computed from real geometry ---- */
  const moved = await run("couture.objects", { action: "move", object: gownId, relativeTo: "chair", relation: "behind", gap: 200 }, 24);
  const gownBox = objectWorldBox(store.get(gownId)!);
  const chairBox = objectWorldBox(store.get(chairId)!);
  check("relative move executed", moved.ok, moved.content);
  check(
    "gown is behind the chair with clear space",
    Boolean(gownBox && chairBox) && gownBox!.max[2] <= chairBox!.min[2] + 1e-6,
    { gownZ: gownBox?.max[2], chairZ: chairBox?.min[2] },
  );

  /* ---- 6. a compound instruction, compiled then dispatched ---- */
  const plan = compileCreativeObjectPlan("select the pendant, make it twice as large and move it beside the chair", {
    selectedId: null,
  });
  check("compound instruction compiled", Boolean(plan) && plan!.steps.length === 3, plan?.steps.map((s) => s.label));
  const compound: Result[] = [];
  for (const [i, step] of (plan?.steps ?? []).entries()) {
    compound.push(await run(step.tool, step.args as Record<string, unknown>, 40 + i));
  }
  check("every compound step ran", compound.every((r) => r.ok), compound.map((r) => r.ok));

  /* ---- 7. ambiguity is refused, not guessed ---- */
  const duplicate = await run("couture.objects", { action: "duplicate", object: "chair", name: "Oak side chair" }, 50);
  check("a second chair exists", duplicate.ok, duplicate.content);
  const countBefore = store.list({ includeArchived: true }).length;
  const ambiguous = await run("couture.objects", { action: "move", object: "chair", delta: [100, 0, 0] }, 51);
  check("two chairs → refused with candidates", ambiguous.ok === false && /matches 2 objects/.test(ambiguous.content), ambiguous.content);
  check("the refusal moved nothing", store.list({ includeArchived: true }).length === countBefore, { countBefore, after: store.list({ includeArchived: true }).length });

  /* ---- 8. persistence: an actual reload ---- */
  const expected = {
    chair: { position: [...store.get(chairId)!.transform.position], rotation: [...store.get(chairId)!.transform.rotation] },
    pendant: { position: [...store.get(pendantId)!.transform.position], scale: [...store.get(pendantId)!.transform.scale] },
    gown: { position: [...store.get(gownId)!.transform.position] },
    count: store.list({ includeArchived: true }).length,
  };
  store.reload();
  const reloaded = store.list({ includeArchived: true });
  check("every object survived the reload", reloaded.length === expected.count, { expected: expected.count, got: reloaded.length });
  check("chair position and rotation survived", JSON.stringify(store.get(chairId)?.transform.position) === JSON.stringify(expected.chair.position) && JSON.stringify(store.get(chairId)?.transform.rotation) === JSON.stringify(expected.chair.rotation), store.get(chairId)?.transform);
  check("pendant scale survived", JSON.stringify(store.get(pendantId)?.transform.scale) === JSON.stringify(expected.pendant.scale), store.get(pendantId)?.transform.scale);
  check("gown placement survived", JSON.stringify(store.get(gownId)?.transform.position) === JSON.stringify(expected.gown.position), store.get(gownId)?.transform.position);

  /* ---- 9. provenance: the bridge mirrored the canonical objects ---- */
  const listed = CreativeObjectBridge.listing("cosmos-core", { store });
  check("canonical objects are the ones in the cosmos", listed.length >= 3, listed.map((entry) => entry.objectId));

  console.log(
    JSON.stringify(
      {
        ok: true,
        evidence: "DISPATCH",
        chairId,
        pendantId,
        gownId,
        steps,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
