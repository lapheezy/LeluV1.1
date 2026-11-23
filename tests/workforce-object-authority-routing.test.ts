/**
 * Workforce consolidation (WP03) — one sentence, one object authority.
 *
 * Claude's CosmosObjectStore (constructions in the Cosmos) and Freebuff's
 * CreativeObjects (couture creations) both understand "rotate it 90 degrees".
 * After the merge the couture compiler ran first and claimed every such
 * sentence, so Cosmos objects stopped responding to words. The rule now: the
 * sentence goes to the store its object names resolve in.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";
import CreativeObjects from "../src/core/couture/objects";
import CosmosObjectStore from "../src/core/cosmos/objects/CosmosObjectStore";
import { buildGearbox } from "../src/core/creative/kit/build";

const cube = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };

test("a sentence naming a couture creation is compiled for the couture store", () => {
  const couture = CreativeObjects.getInstance();
  couture.create({
    kind: "product",
    name: "Pendant",
    parts: [{ id: "p1", label: "body", mesh: cube as never, materialId: "gold", color: "#d4af37", opacity: 1, thin: false, componentId: "c1" }],
  });
  const plan = compileDirect("rotate the pendant 90 degrees");
  assert.equal(plan?.steps[0].tool, "couture.objects");
});

test("a sentence naming a Cosmos construction stays with the Cosmos store, even when couture creations exist", () => {
  const store = CosmosObjectStore.getInstance();
  const g = buildGearbox({ teethIn: 12, teethOut: 24 }).program!;
  store.spawn({ name: "Gearbox", scene: g.scene, domain: g.domain, builder: g.builder, partCount: g.parts.length, source: { artifactId: "art_route", rev: 1 } });
  assert.ok(CreativeObjects.getInstance().list().length > 0, "a couture creation exists");
  const plan = compileDirect("rotate the gearbox 90 degrees");
  assert.match(String(plan?.steps[0].tool), /^cosmos\.object\./);
});

test("a pronoun goes to couture only when this turn's referent is a couture creation", () => {
  const pendant = CreativeObjects.getInstance().list().find((o) => o.name === "Pendant")!;
  const withReferent = compileDirect("rotate it 90 degrees", { referentId: pendant.id });
  assert.equal(withReferent?.steps[0].tool, "couture.objects");
  const without = compileDirect("rotate it 90 degrees", { referentId: "not-a-couture-object" });
  assert.notEqual(without?.steps[0].tool, "couture.objects");
});
