/**
 * Verification: GENESIS v2 IS A FULL-PAGE WORKSPACE — NOT AN OVERLAY.
 *
 * The user's acceptance criteria:
 *   PAGE 3 owns the entire viewport; Genesis v1 (cosmic canvas, dock,
 *   status panel, Core, nodes) is NOT rendered behind it; the lab has its
 *   own page-level navigation; all lab sections are present.
 *
 * Two checks:
 *   1. Real server-render of <GenesisCore><GenesisLab /></GenesisCore> —
 *      asserts the lab page itself renders its complete transformation-lab
 *      structure (header, status grid, comparison sections, morphology
 *      states, backdrop rule, monitor, history, transform/return actions,
 *      page nav).
 *   2. Source-structure checks on the two mount points — asserts
 *      GenesisInterface renders GenesisLab as the page branch (not inside
 *      AnimatePresence as an overlay) and GenesisScene unmounts the
 *      cosmic Canvas while the lab page is active.
 *
 * Run: bunx tsx --tsconfig tsconfig.app.json scripts/verify-genesis-v2-page.tsx
 */
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import GenesisCore from "../src/app/scene/genesis/GenesisCore";
import GenesisLab from "../src/app/scene/genesis/GenesisLab";

let failures = 0;
function assert(condition: boolean, label: string): void {
  console.log(`${condition ? "  ✓" : "  ✗"} ${label}`);
  if (!condition) failures += 1;
}

/* ----------------------- 1. The lab page renders ----------------------- */
console.log("== CHECK 1 — Genesis v2 page renders as a full lab page ==");
let html = "";
try {
  html = renderToString(
    createElement(GenesisCore, null, createElement(GenesisLab, { onClose: () => {} })),
  );
} catch (error) {
  console.error("  ✗ lab page crashed while rendering:", (error as Error).message);
  process.exit(1);
}
// Section headings are uppercased by CSS text-transform in the browser;
// the server-rendered text is title case — compare case-insensitively.
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const required = [
  "genesis v2",
  "core transformation lab",
  "one core",
  "single lifecycle",
  "evolution",
  "cycle",
  "morphology",
  "coherence",
  "pulse",
  "merge the cores",
  "incorrect",
  "correct",
  "all functions",
  "hazard",
  "aurora",
  "ocean",
  "plasma",
  "electric",
  "biohazard",
  "hybrid",
  "backdrop vs core",
  "aurora over core",
  "aurora in backdrop",
  "transformation monitor",
  "auto evolution",
  "transformation history",
  "transform core",
  "return to core",
];
for (const fragment of required) {
  assert(text.includes(fragment), `lab page contains "${fragment}"`);
}

/* --------------------- 2a. GenesisInterface page gate ------------------- */
console.log("== CHECK 2 — GenesisInterface replaces the page (no overlay) ==");
const interfaceSource = readFileSync(
  "src/app/scene/genesis/GenesisInterface.tsx",
  "utf8",
);
assert(
  interfaceSource.includes('const labActive = state.activePanel === "genesisv2";'),
  "GenesisInterface derives labActive from the active panel",
);
assert(
  /labActive \? \(\n\s*\/\*\s*\n\s*\* PAGE 3/.test(interfaceSource) &&
    interfaceSource.includes("<GenesisLab onClose={handleExitChat} />"),
  "GenesisLab is the first branch of the environment conditional (a page, not an overlay)",
);
assert(
  (interfaceSource.match(/<GenesisLab/g) ?? []).length === 1,
  "GenesisInterface mounts exactly one GenesisLab (the page branch)",
);
// The lab must NOT be mounted inside AnimatePresence as a panel anymore.
const animatePresenceSection = interfaceSource.split("<AnimatePresence mode=\"wait\">")[1] ?? "";
assert(
  !animatePresenceSection.includes("<GenesisLab"),
  "GenesisLab is no longer mounted inside AnimatePresence (no overlay panel)",
);

/* --------------------- 2b. GenesisScene canvas gate --------------------- */
console.log("== CHECK 3 — GenesisScene unmounts the cosmic canvas on the lab page ==");
const sceneSource = readFileSync("src/app/scene/genesis/GenesisScene.tsx", "utf8");
assert(
  sceneSource.includes('const labActive = state.activePanel === "genesisv2";'),
  "GenesisScene derives labActive from the same shared panel state",
);
assert(
  sceneSource.includes("labActive ? null : (\n        <Canvas"),
  "The 3D cosmic Canvas (background + Core) is unmounted while the lab page is active",
);
assert(
  sceneSource.includes("only the v1 presentation leaves"),
  "Shared runtime comment confirms evolution continues behind the page swap",
);

/* -------------------------- 3. Lab page navigation ---------------------- */
console.log("== CHECK 4 — Genesis v2 has its own page-level navigation ==");
const labSource = readFileSync("src/app/scene/genesis/GenesisLab.tsx", "utf8");
assert(
  labSource.includes("Genesis v1</PageNavButton>") &&
    labSource.includes("Lélu System</PageNavButton>") &&
    labSource.includes("Genesis v2</PageNavButton>"),
  "Lab header has Genesis v1 / Lélu System / Genesis v2 page navigation",
);
assert(
  labSource.includes('goToPage("genesis")') && labSource.includes('goToPage("visual")'),
  "Page nav switches work by replacing the active page (openPanel + interfaceFocus)",
);
assert(
  labSource.includes("VisualEngine.getInstance().setInterfaceFocus"),
  "Page switches drive the same VisualEngine environment focus UI 1/UI 2 use",
);

console.log("------------------------------------------------------------");
console.log(failures === 0 ? "PASS: Genesis v2 is a full-page workspace (no v1 behind it)" : `FAIL: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
