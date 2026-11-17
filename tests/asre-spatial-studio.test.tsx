/**
 * Mission 5 WP03 — the Spatial Studio is a mode of the ONE Visual Studio and
 * mounts its four workspaces. (The full click-through against a running
 * server is scripts/asre/m5-ui-flow.cjs; its screenshots are in docs/asre/m5.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import GenesisSpatialStudio, { openSpatialTab } from "../src/app/scene/genesis/spatial/GenesisSpatialStudio";

test("spatial studio renders four workspaces, opening on the requested one", () => {
  const html = renderToStaticMarkup(<GenesisSpatialStudio />);
  for (const t of ["reconstruct", "numerical", "create", "render"]) assert.match(html, new RegExp(`data-spatial-tab="${t}"`));
  assert.match(html, /data-lelu-spatial-studio="reconstruct"/);
  openSpatialTab("create");
  assert.match(renderToStaticMarkup(<GenesisSpatialStudio />), /data-lelu-spatial-studio="create"/);
});

test("it is a lazy mode of the existing Visual Studio and of the command palette, not a separate page", () => {
  const vs = readFileSync("src/app/scene/genesis/GenesisVisualStudio.tsx", "utf8");
  assert.match(vs, /lazy\(\(\) => import\("\.\/spatial\/GenesisSpatialStudio"\)\)/);
  assert.match(vs, /key: "spatial"/);
  assert.match(readFileSync("src/app/scene/genesis/GenesisCommandPalette.tsx", "utf8"), /openStudioMode\("spatial"\)/);
});

test("no workspace fakes progress: progress and steps come only from the server job", () => {
  for (const f of ["ReconstructWorkspace", "NumericalWorkspace", "CreationWorkspace", "RenderWorkspace"]) {
    const src = readFileSync(`src/app/scene/genesis/spatial/${f}.tsx`, "utf8");
    assert.doesNotMatch(src, /Math\.random|setInterval\(/, `${f} has no simulated timers or random progress`);
    assert.match(src, /AsreClient\./, `${f} talks to the real service`);
  }
});
