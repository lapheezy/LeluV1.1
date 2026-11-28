import { test } from "node:test";
import assert from "node:assert/strict";
import { experience, setExperience, ORIGINAL_SCREENS } from "../src/core/experience/ExperienceMode";
import { INTERFACES } from "../src/core/interface/InterfaceCatalog";

test("unified is the default; OG is one flag that switches back", () => {
  assert.equal(experience(), "unified");
  setExperience("og");
  assert.equal(experience(), "og");
  setExperience("unified");
  assert.equal(experience(), "unified");
});

test("every standalone original in the interface catalog can be opened from OG access", () => {
  const ids = new Set(ORIGINAL_SCREENS.map((o) => o.id));
  for (const i of INTERFACES.filter((x) => x.id !== "cosmos")) assert.ok(ids.has(i.id), `no OG entry for ${i.id}`);
  for (const o of ORIGINAL_SCREENS) if (o.open.kind === "href") assert.match(o.open.href, /^\/(og\/|\?interface=)/);
});
