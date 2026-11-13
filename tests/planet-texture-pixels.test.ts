/**
 * The procedural planet maps are pure pixel functions now (so they can be
 * generated in a worker): deterministic, the right size, the Earth opaque,
 * clouds and city lights transparent where the old per-pixel fill left
 * nothing. Browser pixel-equality with the old fillRect version was checked
 * live (0 differing channels on all three maps).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cityLightsPixels, cloudPixels, earthSurfacePixels } from "../src/app/scene/genesis/render/PlanetTextures";

const hash = (p: Uint8ClampedArray) => p.reduce((h, v) => (Math.imul(h, 31) + v) | 0, 7);

test("each map is deterministic and sized size*size*4", () => {
  for (const fn of [earthSurfacePixels, cloudPixels, cityLightsPixels]) {
    const a = fn(48);
    assert.equal(a.length, 48 * 48 * 4);
    assert.equal(hash(a), hash(fn(48)), `${fn.name} is deterministic`);
  }
});

test("the Earth is opaque; clouds and lights keep transparent gaps", () => {
  const earth = earthSurfacePixels(48);
  for (let i = 3; i < earth.length; i += 4) assert.equal(earth[i], 255);
  for (const fn of [cloudPixels, cityLightsPixels]) {
    const p = fn(64);
    let transparent = 0;
    for (let i = 3; i < p.length; i += 4) {
      if (p[i] === 0) {
        transparent++;
        assert.equal(p[i - 3] + p[i - 2] + p[i - 1], 0, "a transparent pixel is (0,0,0,0), as an alpha-0 fill left it");
      }
    }
    assert.ok(transparent > 0, `${fn.name} has transparent regions`);
  }
});
