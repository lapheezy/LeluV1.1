import assert from "node:assert/strict";
import test from "node:test";

import {
  SCALE_ORDER,
  SCALE_PRESETS,
  scaleFromDistance,
  scaleFromPhrase,
} from "../src/app/scene/genesis/cosmos/CosmosScales";

test("scaleFromDistance derives the correct scale from camera distance", () => {
  assert.equal(scaleFromDistance(0), "planet");
  assert.equal(scaleFromDistance(6.8), "planet");
  assert.equal(scaleFromDistance(29.9), "planet");
  assert.equal(scaleFromDistance(30), "solar");
  assert.equal(scaleFromDistance(142.5), "solar");
  assert.equal(scaleFromDistance(159.9), "solar");
  assert.equal(scaleFromDistance(160), "stellar");
  assert.equal(scaleFromDistance(298.7), "stellar");
  assert.equal(scaleFromDistance(699.9), "stellar");
  assert.equal(scaleFromDistance(700), "galactic");
  assert.equal(scaleFromDistance(1137), "galactic");
  assert.equal(scaleFromDistance(1e9), "galactic");
});

test("scaleFromPhrase maps spoken destinations to scales", () => {
  assert.equal(scaleFromPhrase("solar system"), "solar");
  assert.equal(scaleFromPhrase("the sun"), "solar");
  assert.equal(scaleFromPhrase("stars"), "stellar");
  assert.equal(scaleFromPhrase("stellar space"), "stellar");
  assert.equal(scaleFromPhrase("the nebula"), "stellar");
  assert.equal(scaleFromPhrase("galaxy"), "galactic");
  assert.equal(scaleFromPhrase("the milky way"), "galactic");
  assert.equal(scaleFromPhrase("intergalactic space"), "galactic");
  assert.equal(scaleFromPhrase("the cosmos"), "galactic");
  assert.equal(scaleFromPhrase("the universe"), "galactic");
  assert.equal(scaleFromPhrase("outer space"), "galactic");
  assert.equal(scaleFromPhrase("the earth"), "planet");
  assert.equal(scaleFromPhrase("the planet"), "planet");
  assert.equal(scaleFromPhrase("tokyo"), null);
  assert.equal(scaleFromPhrase("miami"), null);
});

test("scale presets are consistent with their distance ranges", () => {
  // Each non-planet preset's camera must sit inside its own distance
  // band (measured from the origin), so flying there genuinely lands
  // in the scale the HUD will then report.
  for (const scale of SCALE_ORDER) {
    const preset = SCALE_PRESETS[scale];
    const [x, y, z] = preset.position;
    const distance = Math.sqrt(x * x + y * y + z * z);
    const [min, max] = preset.distanceRange;
    assert.ok(distance >= min, `${scale} preset distance ${distance} < min ${min}`);
    assert.ok(distance <= max, `${scale} preset distance ${distance} > max ${max}`);
    assert.ok(preset.duration > 0, `${scale} must have a positive fly duration`);
  }
});
