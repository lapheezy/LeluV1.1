/**
 * Two home-layout defects (desktop + iPhone, measured in screenshots):
 *  - the Spatial menu started OPEN on desktop and covered Notifications and
 *    App Library right after guest entry;
 *  - the Cosmos portal name chips (DOM overlays from the 3D scene) showed
 *    through and over the home's glass cards on iPhone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { announceHome, homeInFront } from "../src/app/scene/genesis/home/homePresence";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the Spatial menu starts collapsed and closes on an outside tap", () => {
  const nav = read("src/app/scene/spatial/SpatialNavigator.tsx");
  assert.match(nav, /const \[open, setOpen\] = useState\(false\);/);
  assert.doesNotMatch(nav, /useState\(\(\) => !compact\)/);
  assert.match(nav, /addEventListener\("pointerdown", onPointerDown, true\)/);
});

test("portal name chips hide while the home is in front", () => {
  assert.equal(homeInFront(), false);
  const leave = announceHome();
  assert.equal(homeInFront(), true);
  leave();
  assert.equal(homeInFront(), false);
  const portals = read("src/app/scene/spatial/SpatialPortals.tsx");
  assert.match(portals, /showLabel=\{wide && !homeShowing\}/);
  assert.match(read("src/app/scene/genesis/home/CosmosHome.tsx"), /useEffect\(\(\) => announceHome\(\), \[\]\)/);
});
