import assert from "node:assert/strict";
import test from "node:test";

import {
  COSMOS_ATMOSPHERE_CYCLE_SECONDS,
  sampleCosmosAtmosphere,
} from "../src/app/scene/genesis/cosmos/CosmosAtmosphere";

test("Cosmos atmosphere follows one ordered continuous cycle", () => {
  const phases = new Set<string>();
  for (let index = 0; index < 160; index += 1) {
    phases.add(sampleCosmosAtmosphere(index).phase);
  }

  assert.deepEqual([...phases], [
    "deep-black-space",
    "core-colors",
    "sunset",
    "static",
    "storm",
    "hurricane",
    "dissipation",
    "rainbow",
  ]);
});

test("Cosmos atmosphere is continuous at the cycle boundary", () => {
  const before = sampleCosmosAtmosphere(COSMOS_ATMOSPHERE_CYCLE_SECONDS - 0.0001);
  const after = sampleCosmosAtmosphere(COSMOS_ATMOSPHERE_CYCLE_SECONDS + 0.0001);

  for (const key of [
    "intensity",
    "coreColors",
    "sunset",
    "static",
    "storm",
    "hurricane",
    "lightning",
    "hueShift",
  ] as const) {
    assert.ok(Math.abs(before[key] - after[key]) < 0.002, `${key} jumped at cycle boundary`);
  }

  assert.equal(after.phase, "deep-black-space");
});

test("atmosphere sampling does not mutate persistent universe data", () => {
  const first = sampleCosmosAtmosphere(12.5);
  const second = sampleCosmosAtmosphere(12.5);
  assert.deepEqual(second, first);
});
